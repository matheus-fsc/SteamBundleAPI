const express = require('express');
const fs = require('fs');
const { fetchAndSaveBundles, totalBundlesCount } = require('./services/fetchBundles');
const { updateBundlesWithDetails } = require('./services/updateBundles');
const { authenticateApiKey, adminRateLimit } = require('./middleware/auth');
const { validateInput } = require('./middleware/security');
const { 
    getCurrentDataStatus, 
    removeDuplicatesFromBasicBundles, 
    removeDuplicatesFromDetailedBundles 
} = require('./middleware/dataValidation');

const router = express.Router();
const BUNDLES_DETAILED_FILE = 'bundleDetailed.json';

// Helper function for next scheduled update (usa a função global do server.js se disponível)
function getNextScheduledUpdate() {
    // Usa a função global configurada no server.js se disponível
    if (typeof global.getNextScheduledUpdate === 'function') {
        return global.getNextScheduledUpdate();
    }
    
    // Fallback para compatibilidade se a função global não estiver disponível
    const now = new Date();
    const nextUpdate = new Date(now.getTime() + 6 * 60 * 60 * 1000); // 6 hours from now
    return nextUpdate.toISOString();
}

// Rota principal para verificar se a API está funcionando
router.get('/', (req, res) => {
    const status = getCurrentDataStatus();
    
    // Adiciona headers informativos
    res.set({
        'X-API-Status': 'online',
        'X-Data-Freshness': status.dataAge ? `${status.dataAge}h old` : 'fresh',
        'X-Update-Needed': status.needsUpdate ? 'yes' : 'no'
    });
    
    res.json({ 
        message: 'API conectada com sucesso!',
        status: 'online',
        data_summary: {
            basic_bundles: status.basicBundlesCount,
            detailed_bundles: status.detailedBundlesCount,
            data_age_hours: status.dataAge,
            needs_update: status.needsUpdate,
            duplicates_detected: status.duplicatesDetected
        },
        endpoints: {
            public: [
                '/api/bundles-detailed - Bundles com detalhes completos (endpoint principal)',
                '/api/steam-stats - Estatísticas da API'
            ],
            admin: [
                '/api/force-update - Atualização completa (requer API key)',
                '/api/clean-duplicates - Limpeza de duplicatas (requer API key)'
            ],
            backup: [
                '/api/bundles-old - Backup dos bundles básicos (durante atualizações)',
                '/api/bundles-detailed-old - Backup dos bundles detalhados (durante atualizações)'
            ]
        }
    });
});

// 📁 ENDPOINTS DE BACKUP (servidos durante atualizações)
router.get('/api/bundles-old', async (req, res) => {
    try {
        const BUNDLES_OLD_FILE = 'bundles-old.json';
        
        if (fs.existsSync(BUNDLES_OLD_FILE)) {
            const data = fs.readFileSync(BUNDLES_OLD_FILE, 'utf-8');
            const backupData = JSON.parse(data);
            
            // Headers informativos para backup
            res.set({
                'X-Data-Type': 'backup-basic',
                'X-Total-Count': backupData.totalBundles?.toString() || '0',
                'X-Backup-Status': 'available',
                'X-Warning': 'Este é um backup - dados podem estar desatualizados'
            });
            
            const response = {
                ...backupData,
                metadata: {
                    data_type: 'backup_basic',
                    backup_timestamp: backupData.last_update || 'unknown',
                    warning: 'Dados de backup servidos durante atualização da API',
                    recommendation: 'Tente novamente em alguns minutos para dados atualizados',
                    status: 'backup_mode'
                }
            };
            
            res.json(response);
            console.log(`📁 Backup de bundles básicos enviado (${backupData.totalBundles} total)`);
        } else {
            res.status(404).json({ 
                error: 'Backup de bundles básicos não encontrado',
                message: 'Nenhum backup disponível no momento',
                suggestion: 'Use /api/bundles-detailed para dados atuais'
            });
        }
    } catch (error) {
        console.error('Erro ao ler backup de bundles básicos:', error);
        res.status(500).json({ 
            error: 'Erro ao ler backup de bundles básicos',
            fallback: 'Use /api/bundles-detailed para dados atuais'
        });
    }
});

router.get('/api/bundles-detailed-old', validateInput, async (req, res) => {
    try {
        const BUNDLES_DETAILED_OLD_FILE = 'bundleDetailed-old.json';
        
        if (fs.existsSync(BUNDLES_DETAILED_OLD_FILE)) {
            const data = JSON.parse(fs.readFileSync(BUNDLES_DETAILED_OLD_FILE, 'utf-8'));
            
            // Paginação (mantém compatibilidade)
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const startIndex = (page - 1) * limit;
            const endIndex = page * limit;

            // Headers informativos para backup detalhado
            res.set({
                'X-Data-Type': 'backup-detailed',
                'X-Total-Count': data.totalBundles?.toString() || '0',
                'X-Current-Page': page.toString(),
                'X-Total-Pages': Math.ceil(data.bundles.length / limit).toString(),
                'X-Backup-Status': 'available',
                'X-Warning': 'Dados de backup - podem estar desatualizados'
            });

            const responseData = {
                totalBundles: data.totalBundles,
                bundles: data.bundles.slice(startIndex, endIndex),
                page: page,
                totalPages: Math.ceil(data.bundles.length / limit),
                hasNext: endIndex < data.bundles.length,
                hasPrev: page > 1,
                lastUpdate: data.last_update,
                updateTriggered: false,
                dataType: 'backup',
                metadata: {
                    data_quality: 'backup_detailed',
                    backup_timestamp: data.last_update || 'unknown',
                    message: 'Servindo backup durante atualização da API',
                    warning: 'Dados podem estar desatualizados',
                    recommendation: 'Recarregue em alguns minutos para dados atualizados',
                    status: {
                        current_status: 'serving_backup_data',
                        reason: 'api_update_in_progress',
                        user_action: 'aguarde finalização da atualização',
                        estimated_time: '5-15 minutos'
                    }
                }
            };
            
            res.json(responseData);
            console.log(`📁 Backup detalhado enviado - Página ${page} (${responseData.bundles.length} itens)`);
        } else {
            res.status(404).json({ 
                error: 'Backup de bundles detalhados não encontrado',
                message: 'Nenhum backup disponível no momento',
                suggestion: 'Use /api/bundles-detailed para dados atuais ou aguarde a finalização da atualização'
            });
        }
    } catch (error) {
        console.error('Erro ao ler backup de bundles detalhados:', error);
        res.status(500).json({ 
            error: 'Erro ao ler backup de bundles detalhados',
            fallback: 'Use /api/bundles-detailed para dados atuais'
        });
    }
});

// 🤖 ENDPOINT INTELIGENTE: Serve dados atuais ou backup automaticamente
router.get('/api/bundles-smart', validateInput, async (req, res) => {
    try {
        // Verifica se há uma atualização em progresso
        const updateController = require('./services/updateController');
        const isUpdating = updateController.isUpdateInProgress();
        
        // Se está atualizando e backup existe, serve o backup
        if (isUpdating && fs.existsSync('bundleDetailed-old.json')) {
            console.log('🤖 [SMART] Atualização em progresso - servindo backup automaticamente');
            
            // Redireciona internamente para o endpoint de backup
            req.url = '/api/bundles-detailed-old';
            
            // Adiciona header indicando que é um redirecionamento automático
            res.set('X-Smart-Redirect', 'backup-auto-served');
            
            return router.handle(req, res, () => {});
        }
        
        // Caso contrário, serve dados normais
        console.log('🤖 [SMART] Servindo dados normais');
        req.url = '/api/bundles-detailed';
        res.set('X-Smart-Redirect', 'normal-data-served');
        
        return router.handle(req, res, () => {});
        
    } catch (error) {
        console.error('Erro no endpoint smart:', error);
        // Em caso de erro, serve dados normais como fallback
        req.url = '/api/bundles-detailed';
        return router.handle(req, res, () => {});
    }
});

// Endpoint principal para bundles detalhadas com sistema inteligente
router.get('/api/bundles-detailed', validateInput, async (req, res) => {
    try {
        const status = getCurrentDataStatus();
        
        // Sempre retorna os dados atuais primeiro
        let responseData = {
            updateTriggered: false
        };

        // Se tem dados detalhados, retorna eles
        if (status.hasDetailedBundles && fs.existsSync(BUNDLES_DETAILED_FILE)) {
            const detailedData = JSON.parse(fs.readFileSync(BUNDLES_DETAILED_FILE, 'utf-8'));
            
            // Paginação (mantém compatibilidade com o frontend)
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const startIndex = (page - 1) * limit;
            const endIndex = page * limit;

            // Adiciona headers informativos
            res.set({
                'X-Data-Type': 'detailed',
                'X-Total-Count': detailedData.totalBundles?.toString() || '0',
                'X-Current-Page': page.toString(),
                'X-Total-Pages': Math.ceil(detailedData.bundles.length / limit).toString(),
                'X-Data-Age-Hours': status.dataAge?.toString() || '0',
                'X-Background-Update': status.needsUpdate ? 'triggered' : 'not-needed',
                'X-Last-Update': detailedData.last_update || 'unknown'
            });

            // Estrutura compatível com o endpoint antigo
            responseData = {
                totalBundles: detailedData.totalBundles,
                bundles: detailedData.bundles.slice(startIndex, endIndex),
                page: page,
                totalPages: Math.ceil(detailedData.bundles.length / limit),
                hasNext: endIndex < detailedData.bundles.length,
                hasPrev: page > 1,
                lastUpdate: detailedData.last_update,
                updateTriggered: false,
                metadata: {
                    data_quality: 'detailed',
                    age_hours: status.dataAge,
                    duplicates_cleaned: detailedData.duplicatesRemoved || 0,
                    background_update_status: status.needsUpdate ? 
                        'Dados sendo atualizados em segundo plano...' : 
                        'Dados atualizados',
                    update_info: {
                        next_scheduled: getNextScheduledUpdate(),
                        auto_update_enabled: true,
                        last_update_formatted: status.lastUpdateFormatted
                    },
                    api_health: {
                        status: status.dataAge < 24 ? 'excellent' : status.dataAge < 48 ? 'good' : 'aging',
                        data_freshness: status.dataAge < 6 ? 'very_fresh' : 
                                       status.dataAge < 24 ? 'fresh' : 'aging',
                        recommendation: status.dataAge < 24 ? 
                            'Dados recentes e confiáveis' : 
                            'Considere usar /api/force-update se precisar dos dados mais recentes'
                    }
                }
            };
        } else {
            // Se não há dados detalhados, retorna erro apropriado
            return res.status(503).json({
                error: 'Dados detalhados não disponíveis',
                message: 'A API está coletando dados da Steam. Tente novamente em alguns minutos.',
                status: 'initializing',
                estimated_wait: '5-15 minutos',
                suggestion: 'Use /api/force-update (com API key) para iniciar a coleta de dados',
                updateTriggered: false,
                help: {
                    admin_action: 'Use /api/force-update com API key para iniciar a coleta',
                    estimated_time: 'Primeira execução pode levar 10-15 minutos',
                    check_status: 'Use /api/steam-stats para verificar o progresso'
                }
            });
        }

        // 🔄 Inicia atualização em segundo plano se necessário
        if (status.needsUpdate) {
            responseData.updateTriggered = true;
            
            // Executa atualização de forma assíncrona (não bloqueia a resposta)
            setImmediate(async () => {
                try {
                    console.log('🔄 [BACKGROUND] Iniciando atualização automática...');
                    if (!status.hasBasicBundles || status.basicBundlesCount < 100) {
                        console.log('🔄 [BACKGROUND] Atualizando bundles básicas...');
                        await fetchAndSaveBundles();
                    } else {
                        console.log('🔄 [BACKGROUND] Atualizando apenas detalhes...');
                        await updateBundlesWithDetails();
                    }
                    console.log('✅ [BACKGROUND] Atualização automática concluída');
                } catch (error) {
                    console.error('❌ [BACKGROUND] Erro na atualização automática:', error);
                }
            });
        }

        res.json(responseData);
        console.log(`📄 Página ${responseData.page} enviada (${responseData.bundles.length} itens) - Update: ${responseData.updateTriggered}`);
        
    } catch (error) {
        console.error('Erro ao ler o arquivo de bundles detalhado:', error);
        res.status(500).json({ 
            error: 'Erro ao ler o arquivo de bundles detalhado',
            technical_error: error.message,
            suggestion: 'Tente novamente em alguns segundos'
        });
    }
});


router.get('/api/filter-options', validateInput, async (req, res) => {
    try {
        // Usar apenas dados detalhados (pós-migração para Storage API)
        let data = null;
        let dataType = 'detailed';
        
        if (fs.existsSync(BUNDLES_DETAILED_FILE)) {
            data = JSON.parse(fs.readFileSync(BUNDLES_DETAILED_FILE, 'utf-8'));
            dataType = 'detailed';
        }
        
        if (!data) {
            return res.status(503).json({ 
                error: 'Opções de filtro não disponíveis',
                message: 'Dados detalhados necessários para gerar filtros ainda não estão disponíveis',
                suggestion: 'A API está coletando dados. Tente novamente em alguns minutos.',
                status: 'initializing',
                cache_miss: true
            });
        }
        
        const bundles = data.bundles || [];
        const genres = new Set();
        const categories = new Set();
        const platforms = new Set();
        let minPrice = Infinity;
        let maxPrice = 0;
        let minDiscount = 100;
        let maxDiscount = 0;
        
        bundles.forEach(bundle => {
            if (bundle.genres && Array.isArray(bundle.genres)) {
                bundle.genres.forEach(genre => genres.add(genre));
            }
            if (bundle.categories && Array.isArray(bundle.categories)) {
                bundle.categories.forEach(category => categories.add(category));
            }
            if (bundle.available_windows) platforms.add('Windows');
            if (bundle.available_mac) platforms.add('Mac');
            if (bundle.available_linux) platforms.add('Linux');
            if (bundle.final_price && typeof bundle.final_price === 'number') {
                const priceInReais = bundle.final_price / 100;
                minPrice = Math.min(minPrice, priceInReais);
                maxPrice = Math.max(maxPrice, priceInReais);
            }
            if (bundle.discount_percent && typeof bundle.discount_percent === 'number') {
                minDiscount = Math.min(minDiscount, bundle.discount_percent);
                maxDiscount = Math.max(maxDiscount, bundle.discount_percent);
            }
        });
        
        if (minPrice === Infinity) minPrice = 0;
        if (minDiscount === 100) minDiscount = 0;
        
        const filterOptions = {
            genres: Array.from(genres).sort(),
            categories: Array.from(categories).sort(),
            platforms: Array.from(platforms).sort(),
            priceRange: {
                min: Math.floor(minPrice),
                max: Math.ceil(maxPrice)
            },
            discountRange: {
                min: minDiscount,
                max: maxDiscount
            },
            metadata: {
                totalBundles: bundles.length,
                dataSource: dataType,
                lastUpdate: data.last_update || null,
                cache_hit: true
            }
        };
        
        res.set({
            'X-Data-Source': dataType,
            'X-Total-Bundles': bundles.length.toString(),
            'X-Cache-Status': 'cached'
        });
        
        res.json(filterOptions);
        console.log(`🔍 Opções de filtro enviadas (${bundles.length} bundles analisados) - Source: ${dataType} - Cache: ✅`);
    } catch (error) {
        console.error('Erro ao gerar opções de filtro:', error);
        res.status(500).json({ 
            error: 'Erro ao gerar opções de filtro',
            technical_error: error.message
        });
    }
});

router.get('/api/bundles-detailed-all', (req, res) => {
    try {
        if (fs.existsSync(BUNDLES_DETAILED_FILE)) {
            const data = JSON.parse(fs.readFileSync(BUNDLES_DETAILED_FILE, 'utf-8'));
            res.json(data);
            console.log(`📋 JSON completo enviado (${data.totalBundles} bundles)`);
        } else {
            res.status(500).json({ error: 'Arquivo de bundles detalhado não encontrado' });
        }
    } catch (error) {
        console.error('Erro ao ler o arquivo de bundles detalhado:', error);
        res.status(500).json({ error: 'Erro ao ler o arquivo de bundles detalhado' });
    }
});

// Endpoint para forçar uma atualização (PROTEGIDO)
router.get('/api/force-update', authenticateApiKey, adminRateLimit, async (req, res) => {
    try {
        console.log('[ADMIN] Iniciando atualização forçada...');
        
        const startTime = Date.now();
        const statusBefore = getCurrentDataStatus();
        
        // Informa o progresso
        res.set({
            'X-Operation': 'force-update',
            'X-Estimated-Duration': '5-15 minutes',
            'X-Background-Process': 'false'
        });
        
        await fetchAndSaveBundles();
        console.log('✅ fetchAndSaveBundles concluído.');

        await updateBundlesWithDetails();
        console.log('✅ updateBundlesWithDetails concluído.');
        
        const endTime = Date.now();
        const duration = Math.round((endTime - startTime) / 1000);
        const statusAfter = getCurrentDataStatus();

        res.json({ 
            message: 'Atualização forçada concluída com sucesso',
            operation_summary: {
                duration_seconds: duration,
                duration_formatted: `${Math.floor(duration / 60)}m ${duration % 60}s`,
                total_bundles_updated: totalBundlesCount,
                efficiency: `${Math.round(totalBundlesCount / duration)} bundles/segundo`
            },
            before_update: {
                basic_bundles: statusBefore.basicBundlesCount,
                detailed_bundles: statusBefore.detailedBundlesCount,
                data_age_hours: statusBefore.dataAge
            },
            after_update: {
                basic_bundles: statusAfter.basicBundlesCount,
                detailed_bundles: statusAfter.detailedBundlesCount,
                data_age_hours: statusAfter.dataAge,
                duplicates_detected: statusAfter.duplicatesDetected
            },
            improvements: {
                new_bundles_added: Math.max(0, statusAfter.basicBundlesCount - statusBefore.basicBundlesCount),
                details_added: Math.max(0, statusAfter.detailedBundlesCount - statusBefore.detailedBundlesCount),
                recommendation: statusAfter.duplicatesDetected > 0 ? 
                    'Execute /api/clean-duplicates para otimizar os dados' : 
                    'Dados atualizados e otimizados'
            },
            next_steps: [
                'Verifique /api/steam-stats para monitorar a qualidade dos dados',
                'Configure atualizações automáticas para manter os dados frescos',
                statusAfter.duplicatesDetected > 10 ? 'Execute limpeza de duplicatas regularmente' : null
            ].filter(Boolean),
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Erro ao forçar a atualização:', error);
        res.status(500).json({ 
            error: 'Erro ao forçar a atualização',
            technical_error: error.message,
            partial_success: 'Alguns dados podem ter sido atualizados',
            suggestion: 'Verifique /api/steam-stats para avaliar o estado atual dos dados'
        });
    }
});

// Endpoint para atualizar os detalhes das bundles (PROTEGIDO)
router.get('/api/update-details', authenticateApiKey, adminRateLimit, async (req, res) => {
    try {
        console.log('[ADMIN] Iniciando atualização de detalhes...');
        
        const result = await updateBundlesWithDetails();
        res.json({ 
            message: 'Detalhes das bundles atualizados com sucesso.',
            timestamp: new Date().toISOString(),
            ...result
        });
        console.log('✅ Detalhes das bundles atualizados.');
    } catch (error) {
        console.error('❌ Erro ao atualizar os detalhes das bundles:', error);
        res.status(500).json({ error: 'Erro ao atualizar os detalhes das bundles' });
    }
});

// 🧪 NOVO: Endpoint de teste para processar apenas algumas bundles (PROTEGIDO)
router.get('/api/test-update', authenticateApiKey, adminRateLimit, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        
        if (limit > 200) {
            return res.status(400).json({ 
                error: 'Limite máximo de 200 bundles para teste',
                message: 'Use o endpoint /api/update-details para atualização completa',
                current_limit: limit,
                maximum_allowed: 200,
                suggestion: 'Reduza o valor do parâmetro limit ou use /api/force-update para atualização completa'
            });
        }

        console.log(`[TEST] Iniciando atualização de teste com ${limit} bundles...`);
        
        const startTime = Date.now();
        const result = await updateBundlesWithDetails('brazilian', limit);
        const endTime = Date.now();
        const duration = Math.round((endTime - startTime) / 1000);
        
        // Adiciona headers informativos
        res.set({
            'X-Operation': 'test-update',
            'X-Bundles-Processed': result.processedBundles?.toString() || limit.toString(),
            'X-Duration-Seconds': duration.toString(),
            'X-Test-Mode': 'true'
        });
        
        res.json({ 
            message: `Teste concluído com sucesso`,
            test_summary: {
                bundles_requested: limit,
                bundles_processed: result.processedBundles || limit,
                duration_seconds: duration,
                duration_formatted: `${Math.floor(duration / 60)}m ${duration % 60}s`,
                processing_rate: `${Math.round((result.processedBundles || limit) / duration)} bundles/segundo`
            },
            results: {
                ...result,
                success_rate: result.processedBundles ? 
                    `${Math.round((result.processedBundles / limit) * 100)}%` : 
                    '100%',
                efficiency_score: duration < 60 ? 'excellent' : duration < 120 ? 'good' : 'needs_optimization'
            },
            recommendations: [
                duration > 120 ? 'Considere aumentar STEAM_API_DELAY para reduzir carga na API' : null,
                result.errors && result.errors.length > 0 ? 'Verifique os logs para erros específicos' : null,
                'Use este endpoint para testar configurações antes de atualizações completas',
                'Monitore /api/steam-stats para acompanhar a qualidade dos dados'
            ].filter(Boolean),
            next_steps: {
                full_update: '/api/force-update',
                check_status: '/api/steam-stats',
                production_endpoint: '/api/bundles-detailed'
            },
            timestamp: new Date().toISOString()
        });
        
        console.log(`🧪 Teste concluído: ${result.processedBundles} bundles processados em ${duration}s.`);
    } catch (error) {
        console.error('❌ Erro no teste de atualização:', error);
        res.status(500).json({ 
            error: 'Erro no teste de atualização',
            technical_error: error.message,
            test_parameters: {
                requested_limit: req.query.limit || 50,
                default_limit: 50,
                maximum_limit: 200
            },
            suggestion: 'Verifique os parâmetros e tente novamente com um limite menor'
        });
    }
});

// 📊 NOVO: Endpoint para obter estatísticas da API Steam
router.get('/api/steam-stats', (req, res) => {
    try {
        const status = getCurrentDataStatus();
        
        // Lê estatísticas dos arquivos se existirem
        let stats = {
            api_status: {
                online: true,
                last_check: new Date().toISOString(),
                environment: process.env.NODE_ENV || 'development',
                version: require('./package.json').version || '1.0.0'
            },
            steam_api_config: {
                delay_between_requests: `${process.env.STEAM_API_DELAY || 1500}ms`,
                delay_between_app_requests: `${process.env.STEAM_APP_DELAY || 100}ms`,
                max_apps_per_bundle: parseInt(process.env.MAX_APPS_PER_BUNDLE) || 50,
                request_timeout: `${process.env.REQUEST_TIMEOUT || 10000}ms`,
                max_retries: parseInt(process.env.MAX_RETRIES) || 3,
                performance_mode: process.env.STEAM_API_DELAY < 1000 ? 'fast' : 'balanced'
            },
            data_status: {
                ...status,
                health_score: (() => {
                    let score = 100;
                    if (status.duplicatesDetected > 0) score -= 10;
                    if (status.dataAge > 24) score -= 20;
                    if (!status.hasDetailedBundles) score -= 30;
                    if (!status.hasBasicBundles) score -= 40;
                    return Math.max(0, score);
                })(),
                recommendations: [
                    status.needsUpdate ? 'Dados precisam ser atualizados' : null,
                    status.duplicatesDetected > 0 ? 'Execute /api/clean-duplicates para otimizar' : null,
                    status.dataAge > 48 ? 'Dados muito antigos - considere atualização forçada' : null,
                    !status.hasDetailedBundles ? 'Execute /api/update-details para dados completos' : null
                ].filter(Boolean)
            },
            files: {
                bundles_detailed_exists: fs.existsSync('bundleDetailed.json'),
                bundles_test_exists: fs.existsSync('bundleDetailed_test.json'),
                last_check_exists: fs.existsSync('last_check.json'),
                storage_api_mode: true, // Migração para Storage API concluída
                legacy_bundles_file: false // bundles.json não mais usado
            },
            performance_metrics: {
                estimated_api_calls_saved: status.duplicatesDetected * 2,
                data_efficiency: status.basicBundlesCount > 0 && status.detailedBundlesCount > 0 ? 
                    `${Math.round((status.detailedBundlesCount / status.basicBundlesCount) * 100)}% dos dados básicos têm detalhes` : 
                    'N/A',
                cache_hit_potential: status.dataAge < 8 ? 'high' : status.dataAge < 24 ? 'medium' : 'low'
            }
        };

        // Adiciona headers informativos
        res.set({
            'X-Health-Score': stats.data_status.health_score.toString(),
            'X-Data-Age': status.dataAge?.toString() || '0',
            'X-Cache-Status': stats.performance_metrics.cache_hit_potential,
            'X-Update-Needed': status.needsUpdate ? 'yes' : 'no'
        });

        if (fs.existsSync('bundleDetailed.json')) {
            const data = JSON.parse(fs.readFileSync('bundleDetailed.json', 'utf-8'));
            stats.production = {
                total_bundles: data.totalBundles,
                last_update: data.last_update,
                is_test_mode: data.isTestMode || false,
                duplicates_removed: data.duplicatesRemoved || 0,
                update_frequency: (() => {
                    if (!data.last_update) return 'never';
                    const hoursSince = status.dataAge;
                    if (hoursSince < 8) return 'recent';
                    if (hoursSince < 24) return 'daily';
                    if (hoursSince < 168) return 'weekly';
                    return 'stale';
                })(),
                data_completeness: data.bundles ? 
                    `${data.bundles.filter(b => b.apps && b.apps.length > 0).length}/${data.totalBundles} bundles com detalhes de apps` : 
                    'N/A'
            };
        }

        if (fs.existsSync('bundleDetailed_test.json')) {
            const testData = JSON.parse(fs.readFileSync('bundleDetailed_test.json', 'utf-8'));
            stats.test = {
                total_bundles: testData.totalBundles,
                last_update: testData.last_update,
                processed_count: testData.processedCount,
                purpose: 'Dados de teste para validação de funcionalidade'
            };
        }

        res.json(stats);
    } catch (error) {
        console.error('Erro ao obter estatísticas:', error);
        res.status(500).json({ 
            error: 'Erro ao obter estatísticas',
            technical_error: error.message,
            fallback_info: {
                api_online: true,
                basic_functionality: 'available',
                suggestion: 'Alguns dados estatísticos podem estar indisponíveis temporariamente'
            }
        });
    }
});

// 🧹 NOVO: Endpoint para remover duplicatas manualmente (PROTEGIDO)
router.get('/api/clean-duplicates', authenticateApiKey, adminRateLimit, async (req, res) => {
    try {
        console.log('🧹 [ADMIN] Iniciando limpeza de duplicatas...');
        
        // Verifica o status antes da limpeza
        const statusBefore = getCurrentDataStatus();
        
        const basicResult = removeDuplicatesFromBasicBundles();
        const detailedResult = removeDuplicatesFromDetailedBundles();
        
        // Verifica o status após a limpeza
        const statusAfter = getCurrentDataStatus();
        
        const result = {
            message: 'Limpeza de duplicatas concluída com sucesso',
            operation_summary: {
                total_duplicates_removed: basicResult.removed + detailedResult.removed,
                time_saved: `~${(basicResult.removed + detailedResult.removed) * 2} segundos em requisições futuras`,
                storage_saved: `~${Math.round((basicResult.removed + detailedResult.removed) * 0.5)} KB`
            },
            before_cleanup: {
                basic_bundles_count: statusBefore.basicBundlesCount,
                detailed_bundles_count: statusBefore.detailedBundlesCount,
                duplicates_detected: statusBefore.duplicatesDetected
            },
            cleanup_results: {
                basic_bundles: {
                    duplicates_removed: basicResult.removed,
                    total_remaining: basicResult.total,
                    efficiency_gain: basicResult.removed > 0 ? 
                        `${Math.round((basicResult.removed / (basicResult.total + basicResult.removed)) * 100)}% de duplicatas removidas` : 
                        'Nenhuma duplicata encontrada'
                },
                detailed_bundles: {
                    duplicates_removed: detailedResult.removed,
                    total_remaining: detailedResult.total,
                    efficiency_gain: detailedResult.removed > 0 ? 
                        `${Math.round((detailedResult.removed / (detailedResult.total + detailedResult.removed)) * 100)}% de duplicatas removidas` : 
                        'Nenhuma duplicata encontrada'
                }
            },
            after_cleanup: {
                basic_bundles_count: statusAfter.basicBundlesCount,
                detailed_bundles_count: statusAfter.detailedBundlesCount,
                duplicates_detected: statusAfter.duplicatesDetected
            },
            recommendations: [
                basicResult.removed > 10 ? 'Considere executar esta limpeza regularmente' : null,
                statusAfter.duplicatesDetected > 0 ? 'Ainda há duplicatas detectadas - execute novamente se necessário' : 'Base de dados limpa!',
                'Use /api/steam-stats para monitorar a qualidade dos dados'
            ].filter(Boolean),
            timestamp: new Date().toISOString()
        };
        
        // Adiciona headers informativos
        res.set({
            'X-Operation': 'duplicate-cleanup',
            'X-Duplicates-Removed': (basicResult.removed + detailedResult.removed).toString(),
            'X-Data-Quality': statusAfter.duplicatesDetected === 0 ? 'clean' : 'has-duplicates'
        });
        
        res.json(result);
        console.log(`🧹 Limpeza concluída: ${result.operation_summary.total_duplicates_removed} duplicatas removidas`);
        
    } catch (error) {
        console.error('❌ Erro na limpeza de duplicatas:', error);
        res.status(500).json({ 
            error: 'Erro na limpeza de duplicatas',
            technical_error: error.message,
            suggestion: 'Verifique os logs do servidor para mais detalhes'
        });
    }
});

module.exports = router;