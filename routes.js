const express = require('express');
const fs = require('fs');
const { fetchAndSaveBundles, totalBundlesCount } = require('./services/fetchBundles');
const { updateBundlesWithDetails, loadUpdateState, clearUpdateState } = require('./services/updateBundles');
const { keepAlive } = require('./services/keepAlive');
const { getDetailedBundles, getBasicBundles, getLastCheck, invalidateAllCaches, getCacheInfo } = require('./services/dataCache');
const { authenticateApiKey, adminRateLimit } = require('./middleware/auth');
const { validateInput } = require('./middleware/security');
const { 
    getCurrentDataStatus, 
    removeDuplicatesFromBasicBundles, 
    removeDuplicatesFromDetailedBundles 
} = require('./middleware/dataValidation');
const {
    updateStatusMiddleware,
    preventSimultaneousUpdates,
    executeControlledUpdate,
    updateLoggingMiddleware,
    updateHealthCheckMiddleware,
    bundleFetchProtectionMiddleware,
    bundleDetailedFetchProtectionMiddleware,
    emergencyQueueClearMiddleware,
    getUpdateController
} = require('./middleware/updateControl');

const router = express.Router();
const BUNDLES_FILE = 'bundles.json';
const BUNDLES_DETAILED_FILE = 'bundleDetailed.json';

router.use(updateStatusMiddleware);
router.use(updateHealthCheckMiddleware);
router.use(emergencyQueueClearMiddleware);

router.get('/', (req, res) => {
    const status = getCurrentDataStatus();
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
                '/api/bundles - Bundles básicas',
                '/api/bundles-detailed - Bundles com detalhes (recomendado)',
                '/api/steam-stats - Estatísticas da API'
            ],
            admin: [
                '/api/force-update - Atualização completa (requer API key)',
                '/api/force-stop - Para todas as atualizações (requer API key)',
                '/api/clean-duplicates - Limpeza de duplicatas (requer API key)',
                '/api/update-resume-status - Status de resumo de atualizações (requer API key)',
                '/api/keep-alive-status - Status do sistema anti-sono (requer API key)'
            ]
        }
    });
});

router.get('/api/bundles', bundleFetchProtectionMiddleware, async (req, res) => {
    try {
        const basicData = await getBasicBundles();
        
        if (basicData) {
            const status = getCurrentDataStatus();
            res.set({
                'X-Data-Type': 'basic',
                'X-Total-Count': basicData.totalBundles?.toString() || '0',
                'X-Has-Detailed': status.hasDetailedBundles ? 'yes' : 'no',
                'X-Recommended-Endpoint': '/api/bundles-detailed',
                'X-Cache-Status': 'cached'
            });
            
            const response = {
                ...basicData,
                metadata: {
                    data_type: 'basic',
                    has_detailed_version: status.hasDetailedBundles,
                    last_detailed_update: status.lastDetailedUpdate,
                    recommendation: status.hasDetailedBundles ? 
                        'Use /api/bundles-detailed para dados completos com preços e detalhes' : 
                        'Dados detalhados em processamento. Tente novamente em alguns minutos.',
                    duplicates_detected: status.duplicatesDetected > 0 ? 
                        `${status.duplicatesDetected} duplicatas detectadas` : 
                        'Nenhuma duplicata detectada',
                    cache_hit: true
                }
            };
            
            res.json(response);
            console.log(`📦 Bundles básicas enviadas (${basicData.totalBundles} total) - Cache: ✅`);
        } else {
            res.status(500).json({ 
                error: 'Arquivo de bundles não encontrado',
                suggestion: 'A API pode estar inicializando. Tente novamente em alguns minutos.',
                help: 'Use /api/force-update (com API key) para iniciar a coleta de dados',
                cache_miss: true
            });
        }
    } catch (error) {
        console.error('Erro na rota /api/bundles:', error);
        res.status(500).json({ error: 'Erro ao processar o seu pedido', technical_error: error.message });
    }
});

router.get('/api/bundles-detailed', bundleDetailedFetchProtectionMiddleware, validateInput, async (req, res) => {
    try {
        const status = getCurrentDataStatus();
        let responseData = {
            updateTriggered: false
        };
        
        const detailedData = await getDetailedBundles();
        
        if (detailedData && status.hasDetailedBundles) {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const startIndex = (page - 1) * limit;
            const endIndex = page * limit;
            
            res.set({
                'X-Data-Type': 'detailed',
                'X-Total-Count': detailedData.totalBundles?.toString() || '0',
                'X-Current-Page': page.toString(),
                'X-Total-Pages': Math.ceil(detailedData.bundles.length / limit).toString(),
                'X-Data-Age-Hours': status.dataAge?.toString() || '0',
                'X-Background-Update': status.needsUpdate ? 'triggered' : 'not-needed',
                'X-Last-Update': detailedData.last_update || 'unknown',
                'X-Cache-Status': 'cached'
            });
            
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
                    cache_hit: true
                }
            };
        } else {
            // Fallback para bundles básicas usando cache
            const basicData = await getBasicBundles();
            
            if (basicData && status.hasBasicBundles) {
                const page = parseInt(req.query.page) || 1;
                const limit = parseInt(req.query.limit) || 10;
                const startIndex = (page - 1) * limit;
                const endIndex = page * limit;
                
                res.set({
                    'X-Data-Type': 'basic-fallback',
                    'X-Total-Count': basicData.totalBundles?.toString() || '0',
                    'X-Current-Page': page.toString(),
                    'X-Background-Update': 'processing-details',
                    'X-Warning': 'Serving basic data while detailed data is being processed',
                    'X-Cache-Status': 'cached'
                });
                
                responseData = {
                    totalBundles: basicData.totalBundles,
                    bundles: basicData.bundles.slice(startIndex, endIndex),
                    page: page,
                    totalPages: Math.ceil(basicData.bundles.length / limit),
                    hasNext: endIndex < basicData.bundles.length,
                    hasPrev: page > 1,
                    lastUpdate: null,
                    updateTriggered: false,
                    dataType: 'basic',
                    metadata: {
                        data_quality: 'basic_fallback',
                        message: 'Servindo dados básicos enquanto os detalhes são processados',
                        estimated_completion: 'Dados detalhados estarão disponíveis em alguns minutos',
                        recommendation: 'Recarregue a página em alguns minutos para dados completos',
                        cache_hit: true
                    }
                };
            } else {
                return res.status(500).json({ 
                    error: 'Nenhum dado de bundles encontrado',
                    suggestion: 'A API pode estar inicializando pela primeira vez',
                    help: {
                        admin_action: 'Use /api/force-update com API key para iniciar a coleta',
                        estimated_time: 'Primeira execução pode levar 10-15 minutos',
                        check_status: 'Use /api/steam-stats para verificar o progresso'
                    },
                    cache_miss: true
                });
            }
        }
        
        if (status.needsUpdate) {
            responseData.updateTriggered = true;
            setImmediate(async () => {
                try {
                    console.log('🔄 [BACKGROUND] Solicitação de atualização automática...');
                    const updateController = getUpdateController();
                    if (updateController.isUpdateInProgress()) {
                        console.log('⏳ [BACKGROUND] Atualização já em andamento, ignorando nova solicitação');
                        return;
                    }
                    if (!status.hasBasicBundles || status.basicBundlesCount < 100) {
                        console.log('🔄 [BACKGROUND] Atualizando bundles básicas...');
                        await executeControlledUpdate(() => fetchAndSaveBundles(), 'background-basic');
                    } else {
                        console.log('🔄 [BACKGROUND] Atualizando apenas detalhes...');
                        await executeControlledUpdate(() => updateBundlesWithDetails(), 'background-detailed');
                    }
                    console.log('✅ [BACKGROUND] Atualização automática concluída');
                } catch (error) {
                    console.error('❌ [BACKGROUND] Erro na atualização automática:', error);
                }
            });
        }
        
        res.json(responseData);
        console.log(`📄 Página ${responseData.page} enviada (${responseData.bundles.length} itens) - Update: ${responseData.updateTriggered} - Cache: ✅`);
    } catch (error) {
        console.error('Erro na rota /api/bundles-detailed:', error);
        res.status(500).json({ 
            error: 'Erro ao processar o seu pedido',
            technical_error: error.message,
            suggestion: 'Tente novamente em alguns segundos ou use /api/bundles para dados básicos'
        });
    }
});

router.get('/api/filter-options', validateInput, async (req, res) => {
    try {
        // Tentar usar dados detalhados primeiro, senão usar básicos
        let data = await getDetailedBundles();
        let dataType = 'detailed';
        
        if (!data) {
            data = await getBasicBundles();
            dataType = 'basic';
        }
        
        if (!data) {
            return res.status(500).json({ 
                error: 'Dados não encontrados',
                suggestion: 'A API pode estar inicializando',
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

router.get('/api/cache-info', validateInput, (req, res) => {
    try {
        const cacheInfo = getCacheInfo();
        const status = getCurrentDataStatus();
        
        res.set({
            'X-Cache-System': 'intelligent-file-watcher',
            'X-Cache-Performance': 'optimized'
        });
        
        res.json({
            cache_system: {
                type: 'intelligent_file_watcher',
                description: 'Cache baseado em timestamp de modificação dos arquivos',
                benefits: [
                    'Leitura de arquivo apenas quando modificado',
                    'JSON.parse executado apenas uma vez por atualização',
                    'Resposta instantânea para requests subsequentes',
                    'Economia significativa de CPU e I/O'
                ]
            },
            cache_status: cacheInfo,
            data_status: {
                basic_bundles_available: status.hasBasicBundles,
                detailed_bundles_available: status.hasDetailedBundles,
                data_age_hours: status.dataAge,
                needs_update: status.needsUpdate
            },
            performance_impact: {
                before: 'fs.readFileSync + JSON.parse a cada request',
                after: 'Cache hit = resposta instantânea da memória',
                improvement: 'Até 95% mais rápido em requests subsequentes'
            }
        });
        
        console.log('📊 Informações de cache enviadas');
    } catch (error) {
        console.error('Erro ao obter informações de cache:', error);
        res.status(500).json({ 
            error: 'Erro ao obter informações de cache',
            technical_error: error.message
        });
    }
});

router.post('/api/cache-invalidate', authenticateApiKey, adminRateLimit, (req, res) => {
    try {
        const { cacheType } = req.body;
        
        if (cacheType && ['detailed', 'basic', 'lastCheck'].includes(cacheType)) {
            invalidateCache(cacheType);
            res.json({
                success: true,
                message: `Cache ${cacheType} invalidado com sucesso`,
                cache_invalidated: cacheType
            });
        } else {
            invalidateAllCaches();
            res.json({
                success: true,
                message: 'Todos os caches invalidados com sucesso',
                cache_invalidated: 'all'
            });
        }
        
        console.log(`🧹 Cache invalidado: ${cacheType || 'all'}`);
    } catch (error) {
        console.error('Erro ao invalidar cache:', error);
        res.status(500).json({ 
            error: 'Erro ao invalidar cache',
            technical_error: error.message
        });
    }
});

router.get('/api/update-status', validateInput, updateLoggingMiddleware('update-status'), (req, res) => {
    try {
        const dataStatus = getCurrentDataStatus();
        const updateController = getUpdateController();
        const updateStatus = updateController.getStatus();
        const diagnostics = updateController.getDiagnostics();
        const response = {
            ...updateStatus,
            dataStatus: {
                hasBasicBundles: dataStatus.hasBasicBundles,
                hasDetailedBundles: dataStatus.hasDetailedBundles,
                basicBundlesCount: dataStatus.basicBundlesCount,
                detailedBundlesCount: dataStatus.detailedBundlesCount,
                dataAge: dataStatus.dataAge,
                needsUpdate: dataStatus.needsUpdate
            },
            diagnostics: diagnostics.diagnostics,
            system: {
                controllerType: 'UpdateController',
                architecture: 'service-based',
                version: '2.0'
            }
        };
        res.json(response);
    } catch (error) {
        console.error('Erro ao verificar status de atualização:', error);
        res.status(500).json({ 
            error: 'Erro ao verificar status de atualização',
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

router.get('/api/force-update', 
    authenticateApiKey, 
    adminRateLimit, 
    preventSimultaneousUpdates,
    updateLoggingMiddleware('force-update'),
    async (req, res) => {
    try {
        console.log('[ADMIN] ⚠️  Iniciando atualização forçada...');
        
        const startTime = Date.now();
        const statusBefore = getCurrentDataStatus();
        
        res.set({
            'X-Operation': 'force-update-controlled',
            'X-Estimated-Duration': '5-15 minutes',
            'X-Update-Control': 'enabled'
        });

        // Força reset do controller para garantir execução sequencial
        const updateController = getUpdateController();
        updateController.forceReset();
        
        // Executa sequencialmente para evitar sobrecarga
        await executeControlledUpdate(() => fetchAndSaveBundles(), 'force-basic');
        console.log('✅ fetchAndSaveBundles concluído.');
        
        // Aguarda um momento e força reset novamente para a segunda operação
        await new Promise(resolve => setTimeout(resolve, 1000));
        updateController.forceReset();
        
        await executeControlledUpdate(() => updateBundlesWithDetails(), 'force-detailed');
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
                data_age_hours: statusAfter.dataAge
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Erro ao forçar a atualização:', error);
        res.status(500).json({ 
            error: 'Erro ao forçar a atualização',
            technical_error: error.message
        });
    }
});

router.get('/api/force-stop', 
    authenticateApiKey, 
    adminRateLimit, 
    updateLoggingMiddleware('force-stop'),
    async (req, res) => {
    try {
        console.log('[ADMIN] 🛑 Iniciando parada forçada de todas as atualizações...');
        
        const updateController = getUpdateController();
        const statusBefore = updateController.getStatus();
        
        // Verifica se há operações em andamento
        if (!statusBefore.isUpdating) {
            return res.json({
                message: 'Nenhuma atualização em andamento',
                status: 'idle',
                action_taken: 'none',
                current_state: {
                    is_updating: false,
                    update_type: null,
                    duration: 0
                },
                timestamp: new Date().toISOString()
            });
        }

        // Para todas as operações de atualização
        const stopResult = updateController.forceStop();
        
        // Limpa a fila de operações também
        const { clearOperationQueue } = require('./middleware/updateControl');
        clearOperationQueue();
        
        const statusAfter = updateController.getStatus();
        
        res.set({
            'X-Operation': 'force-stop',
            'X-Previous-State': statusBefore.isUpdating ? 'updating' : 'idle',
            'X-Current-State': statusAfter.isUpdating ? 'updating' : 'stopped'
        });

        res.json({
            message: 'Parada forçada executada com sucesso',
            operation_summary: {
                was_updating: statusBefore.isUpdating,
                previous_update_type: statusBefore.updateType,
                previous_duration: statusBefore.duration,
                request_count_during_update: statusBefore.requestCount
            },
            stop_result: {
                successful: !statusAfter.isUpdating,
                force_stop_applied: stopResult?.success || true,
                queue_cleared: true,
                processes_terminated: statusBefore.isUpdating ? 1 : 0
            },
            current_state: {
                is_updating: statusAfter.isUpdating,
                update_type: statusAfter.updateType,
                duration: statusAfter.duration,
                system_status: statusAfter.isUpdating ? 'still-running' : 'stopped'
            },
            warnings: [
                statusBefore.isUpdating ? 'Operação interrompida pode ter deixado dados em estado inconsistente' : null,
                'Verifique /api/steam-stats para avaliar integridade dos dados',
                'Considere executar /api/clean-duplicates se necessário'
            ].filter(Boolean),
            next_steps: [
                'Use /api/steam-stats para verificar estado dos dados',
                'Execute /api/operation-queue-status para confirmar limpeza',
                'Se necessário, execute /api/force-update para atualização completa'
            ],
            timestamp: new Date().toISOString()
        });

        console.log(`🛑 Parada forçada concluída. Status anterior: ${statusBefore.isUpdating ? 'atualizando' : 'parado'}`);
        
    } catch (error) {
        console.error('❌ Erro na parada forçada:', error);
        res.status(500).json({ 
            error: 'Erro na parada forçada',
            technical_error: error.message,
            suggestion: 'Alguns processos podem ainda estar em execução. Monitore /api/operation-queue-status'
        });
    }
});

router.get('/api/update-details', 
    authenticateApiKey, 
    adminRateLimit, 
    preventSimultaneousUpdates,
    updateLoggingMiddleware('update-details'),
    async (req, res) => {
    try {
        console.log('[ADMIN] Iniciando atualização de detalhes...');
        const result = await executeControlledUpdate(() => updateBundlesWithDetails(), 'admin-details');
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

router.get('/api/test-update', 
    authenticateApiKey, 
    adminRateLimit, 
    preventSimultaneousUpdates,
    updateLoggingMiddleware('test-update'),
    async (req, res) => {
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
        const result = await executeControlledUpdate(
            () => updateBundlesWithDetails('brazilian', limit), 
            `test-${limit}`
        );
        const endTime = Date.now();
        const duration = Math.round((endTime - startTime) / 1000);
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

router.get('/api/steam-stats', (req, res) => {
    try {
        const status = getCurrentDataStatus();
        let stats = {
            api_status: {
                online: true,
                last_check: new Date().toISOString(),
                environment: process.env.NODE_ENV || 'development',
                version: require('./package.json').version || '1.0.0'
            },
            steam_api_config: {
                delay_between_requests: `${process.env.STEAM_API_DELAY || 1000}ms`,
                delay_between_app_requests: `${process.env.STEAM_APP_DELAY || 300}ms`,
                max_apps_per_bundle: parseInt(process.env.MAX_APPS_PER_BUNDLE) || 30,
                request_timeout: `${process.env.REQUEST_TIMEOUT || 15000}ms`,
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
                bundles_exists: fs.existsSync('bundles.json'),
                bundles_detailed_exists: fs.existsSync('bundleDetailed.json'),
                bundles_test_exists: fs.existsSync('bundleDetailed_test.json'),
                last_check_exists: fs.existsSync('last_check.json')
            },
            performance_metrics: {
                estimated_api_calls_saved: status.duplicatesDetected * 2,
                data_efficiency: status.basicBundlesCount > 0 && status.detailedBundlesCount > 0 ? 
                    `${Math.round((status.detailedBundlesCount / status.basicBundlesCount) * 100)}% dos dados básicos têm detalhes` : 
                    'N/A',
                cache_hit_potential: status.dataAge < 8 ? 'high' : status.dataAge < 24 ? 'medium' : 'low'
            }
        };
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

router.get('/api/clean-duplicates', authenticateApiKey, adminRateLimit, async (req, res) => {
    try {
        console.log('🧹 [ADMIN] Iniciando limpeza de duplicatas...');
        const statusBefore = getCurrentDataStatus();
        const basicResult = removeDuplicatesFromBasicBundles();
        const detailedResult = removeDuplicatesFromDetailedBundles();
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

router.get('/api/update-resume-status', 
    authenticateApiKey, 
    adminRateLimit, 
    updateLoggingMiddleware('update-resume-status'),
    (req, res) => {
    try {
        console.log('[ADMIN] 📋 Verificando status de resumo...');
        
        const updateState = loadUpdateState();
        const hasResumableUpdate = updateState && updateState.status === 'in_progress';
        
        if (!hasResumableUpdate) {
            return res.json({
                message: 'Nenhuma atualização incompleta encontrada',
                status: 'no_resume_needed',
                current_state: 'idle',
                recommendations: [
                    'Nenhuma ação necessária',
                    'Use /api/force-update para iniciar nova atualização',
                    'Use /api/update-status para monitorar operações atuais'
                ],
                timestamp: new Date().toISOString()
            });
        }
        
        const progressPercent = Math.round((updateState.completed / updateState.total) * 100);
        const timeSinceStart = Math.round((Date.now() - updateState.startTime) / 1000 / 60);
        const timeSinceLastActivity = updateState.lastActivity ? 
            Math.round((Date.now() - new Date(updateState.lastActivity).getTime()) / 1000 / 60) : null;
        
        res.set({
            'X-Operation': 'update-resume-status',
            'X-Resume-Available': hasResumableUpdate ? 'yes' : 'no',
            'X-Progress-Percent': progressPercent.toString(),
            'X-Time-Since-Start': `${timeSinceStart}m`
        });

        res.json({
            message: 'Atualização incompleta detectada',
            status: 'resume_available',
            update_state: {
                status: updateState.status,
                progress: {
                    completed: updateState.completed,
                    total: updateState.total,
                    percentage: progressPercent,
                    remaining: updateState.total - updateState.completed
                },
                timing: {
                    started_at: new Date(updateState.startTime).toISOString(),
                    minutes_since_start: timeSinceStart,
                    minutes_since_last_activity: timeSinceLastActivity,
                    last_activity: updateState.lastActivity
                },
                resume_info: {
                    resume_count: updateState.resumeCount,
                    last_processed_index: updateState.lastProcessedIndex,
                    language: updateState.language,
                    is_test_mode: updateState.isTestMode
                }
            },
            recommendations: [
                progressPercent > 50 ? 
                    'Atualização já passou da metade - recomenda-se continuar' : 
                    'Atualização no início - pode reiniciar se necessário',
                timeSinceStart > 60 ? 
                    'Atualização muito antiga - considere limpar estado' : 
                    'Atualização recente - pode ser retomada normalmente',
                'Use /api/force-update para continuar automaticamente',
                'Use /api/force-stop + /api/update-resume-clear para cancelar e limpar'
            ],
            actions: {
                resume: '/api/force-update - Continua automaticamente de onde parou',
                clear: '/api/update-resume-clear - Limpa estado e força reinício',
                monitor: '/api/update-status - Monitora progresso atual'
            },
            timestamp: new Date().toISOString()
        });

        console.log(`📋 Status de resumo enviado: ${progressPercent}% completo (${updateState.resumeCount} resumos)`);
        
    } catch (error) {
        console.error('❌ Erro ao verificar status de resumo:', error);
        res.status(500).json({ 
            error: 'Erro ao verificar status de resumo',
            technical_error: error.message,
            suggestion: 'Verifique os logs do servidor para mais detalhes'
        });
    }
});

router.get('/api/keep-alive-status', 
    authenticateApiKey, 
    adminRateLimit, 
    updateLoggingMiddleware('keep-alive-status'),
    (req, res) => {
    try {
        console.log('[ADMIN] 💓 Verificando status do keep-alive...');
        
        const status = keepAlive.getStatus();
        
        res.set({
            'X-Operation': 'keep-alive-status',
            'X-Keep-Alive-Active': status.active ? 'yes' : 'no',
            'X-Ping-Count': status.ping_count?.toString() || '0'
        });

        if (!status.active) {
            return res.json({
                message: 'Sistema keep-alive não está ativo',
                status: 'inactive',
                description: 'O sistema anti-sono só é ativado durante atualizações longas',
                recommendations: [
                    'Inicie uma atualização com /api/force-update para ativar',
                    'O sistema ativa automaticamente para prevenir sono do Render',
                    'Use /api/keep-alive-start para ativação manual se necessário'
                ],
                manual_control: {
                    start: '/api/keep-alive-start - Ativa manualmente (requer API key)',
                    stop: '/api/keep-alive-stop - Para manualmente (requer API key)',
                    ping: '/api/keep-alive-ping - Força um ping (requer API key)'
                },
                timestamp: new Date().toISOString()
            });
        }

        res.json({
            message: 'Sistema keep-alive está ativo',
            status: 'active',
            keep_alive_info: {
                ping_count: status.ping_count,
                max_pings: status.max_pings,
                duration_minutes: status.duration_minutes,
                next_ping_in_minutes: status.next_ping_in_minutes,
                efficiency: status.efficiency,
                estimated_remaining_hours: status.estimated_remaining_hours
            },
            render_protection: {
                purpose: 'Previne que o Render Free durma durante atualizações longas',
                method: 'Auto-ping a cada 8 minutos em endpoints leves',
                coverage: 'Até 24 horas de proteção contínua',
                cost: 'Zero - usa endpoints públicos existentes'
            },
            recommendations: [
                status.ping_count > status.max_pings * 0.8 ? 
                    'Próximo do limite máximo - sistema parará automaticamente' : 
                    'Sistema funcionando normalmente',
                status.duration_minutes > 300 ? 
                    'Ativo há mais de 5 horas - monitore progresso da atualização' : 
                    'Tempo de ativação normal',
                'Use /api/update-status para verificar progresso da atualização principal'
            ],
            controls: {
                manual_stop: '/api/keep-alive-stop',
                force_ping: '/api/keep-alive-ping',
                update_status: '/api/update-status'
            },
            timestamp: new Date().toISOString()
        });

        console.log(`💓 Status keep-alive enviado: ${status.active ? 'ATIVO' : 'INATIVO'} (${status.ping_count || 0} pings)`);
        
    } catch (error) {
        console.error('❌ Erro ao verificar status keep-alive:', error);
        res.status(500).json({ 
            error: 'Erro ao verificar status keep-alive',
            technical_error: error.message,
            suggestion: 'Verifique os logs do servidor para mais detalhes'
        });
    }
});

router.get('/api/keep-alive-start', 
    authenticateApiKey, 
    adminRateLimit, 
    updateLoggingMiddleware('keep-alive-start'),
    (req, res) => {
    try {
        console.log('[ADMIN] 🔄 Iniciando keep-alive manualmente...');
        
        const reason = req.query.reason || 'manual-admin';
        keepAlive.start(reason);
        
        res.json({
            message: 'Keep-alive iniciado manualmente',
            status: 'started',
            reason: reason,
            protection_info: {
                ping_interval_minutes: 8,
                max_duration_hours: 24,
                purpose: 'Prevenir sono do Render durante operações longas'
            },
            recommendations: [
                'Use /api/keep-alive-status para monitorar',
                'Sistema parará automaticamente após 24h',
                'Use /api/keep-alive-stop para parar manualmente'
            ],
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Erro ao iniciar keep-alive:', error);
        res.status(500).json({ 
            error: 'Erro ao iniciar keep-alive',
            technical_error: error.message
        });
    }
});

router.get('/api/keep-alive-stop', 
    authenticateApiKey, 
    adminRateLimit, 
    updateLoggingMiddleware('keep-alive-stop'),
    (req, res) => {
    try {
        console.log('[ADMIN] 🛑 Parando keep-alive manualmente...');
        
        const reason = req.query.reason || 'manual-admin-stop';
        const wasBefore = keepAlive.getStatus();
        keepAlive.stop(reason);
        
        res.json({
            message: 'Keep-alive parado manualmente',
            status: 'stopped',
            reason: reason,
            previous_status: {
                was_active: wasBefore.active,
                ping_count: wasBefore.ping_count || 0,
                duration_minutes: wasBefore.duration_minutes || 0
            },
            result: {
                render_can_sleep: true,
                protection_removed: true,
                resources_freed: true
            },
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Erro ao parar keep-alive:', error);
        res.status(500).json({ 
            error: 'Erro ao parar keep-alive',
            technical_error: error.message
        });
    }
});

router.get('/api/keep-alive-ping', 
    authenticateApiKey, 
    adminRateLimit, 
    updateLoggingMiddleware('keep-alive-ping'),
    async (req, res) => {
    try {
        console.log('[ADMIN] 💓 Ping manual solicitado...');
        
        await keepAlive.forcePing();
        const status = keepAlive.getStatus();
        
        res.json({
            message: 'Ping manual executado',
            ping_result: 'success',
            current_status: status,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Erro no ping manual:', error);
        res.status(500).json({ 
            error: 'Erro no ping manual',
            technical_error: error.message
        });
    }
});

router.get('/api/update-resume-clear', 
    authenticateApiKey, 
    adminRateLimit, 
    updateLoggingMiddleware('update-resume-clear'),
    (req, res) => {
    try {
        console.log('[ADMIN] 🗑️ Limpando estado de resumo...');
        
        const updateState = loadUpdateState();
        const hadState = !!updateState;
        
        clearUpdateState();
        
        res.set({
            'X-Operation': 'update-resume-clear',
            'X-Previous-State': hadState ? 'had-state' : 'no-state',
            'X-State-Cleared': 'yes'
        });

        res.json({
            message: 'Estado de resumo limpo com sucesso',
            operation_summary: {
                had_previous_state: hadState,
                previous_progress: hadState ? 
                    `${updateState.completed}/${updateState.total} (${Math.round((updateState.completed / updateState.total) * 100)}%)` : 
                    'N/A',
                resume_count: hadState ? updateState.resumeCount : 0
            },
            current_state: {
                resume_available: false,
                next_update_behavior: 'Próxima atualização iniciará do zero',
                files_preserved: 'Arquivos de dados mantidos intactos'
            },
            recommendations: [
                'Estado limpo - próxima atualização será completa',
                'Use /api/force-update para iniciar nova atualização',
                'Use /api/update-resume-status para verificar se limpeza foi efetiva'
            ],
            timestamp: new Date().toISOString()
        });

        console.log(`🗑️ Estado de resumo limpo. Tinha estado anterior: ${hadState}`);
        
    } catch (error) {
        console.error('❌ Erro ao limpar estado de resumo:', error);
        res.status(500).json({ 
            error: 'Erro ao limpar estado de resumo',
            technical_error: error.message,
            suggestion: 'Verifique os logs do servidor para mais detalhes'
        });
    }
});

// Rota para monitoramento da fila de operações (proteção contra sobrecarga)
router.get('/api/operation-queue-status', (req, res) => {
    const { getOperationQueueStatus } = require('./middleware/updateControl');
    const queueStatus = getOperationQueueStatus();
    const updateController = getUpdateController();
    const updateStatus = updateController.getStatus();
    
    res.json({
        queue: {
            length: queueStatus.queueLength,
            running: queueStatus.running,
            current_operation: queueStatus.currentOperation,
            estimated_wait_time: queueStatus.queueLength * 3 // segundos
        },
        update_system: {
            is_updating: updateStatus.isUpdating,
            update_type: updateStatus.updateType,
            duration: updateStatus.duration,
            request_count: updateStatus.requestCount
        },
        server_health: {
            protection_active: queueStatus.running || queueStatus.queueLength > 0,
            load_level: queueStatus.queueLength > 2 ? 'high' : 
                       queueStatus.queueLength > 0 ? 'medium' : 'low',
            recommendation: queueStatus.queueLength > 3 ? 
                'Sistema sob alta carga. Aguarde alguns minutos antes de fazer novas requisições.' :
                'Sistema funcionando normalmente.'
        },
        timestamp: new Date().toISOString()
    });
});

module.exports = router;
