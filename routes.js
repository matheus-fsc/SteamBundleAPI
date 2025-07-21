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
const BUNDLES_FILE = 'bundles.json';
const BUNDLES_DETAILED_FILE = 'bundleDetailed.json';

// Rota principal para verificar se a API está funcionando
router.get('/', (req, res) => {
    res.json({ message: 'API conectada com sucesso!' });
});

// 🚀 Endpoint smart (agora é um alias para compatibilidade)
router.get('/api/bundles-smart', async (req, res) => {
    // Redireciona internamente para o endpoint principal
    req.url = '/api/bundles-detailed';
    router.handle(req, res, () => {});
});

// Endpoint para servir o JSON básico (com verificação inteligente)
router.get('/api/bundles', async (req, res) => {
    try {
        if (fs.existsSync(BUNDLES_FILE)) {
            const data = fs.readFileSync(BUNDLES_FILE, 'utf-8');
            const basicData = JSON.parse(data);
            
            // Adiciona informações de status
            const status = getCurrentDataStatus();
            const response = {
                ...basicData,
                hasDetailedVersion: status.hasDetailedBundles,
                lastDetailedUpdate: status.lastDetailedUpdate,
                recommendUpgrade: status.hasDetailedBundles ? 'Use /api/bundles-detailed para dados completos' : null
            };
            
            res.json(response);
            console.log(`📦 Bundles básicas enviadas (${basicData.totalBundles} total)`);
        } else {
            res.status(500).json({ error: 'Arquivo de bundles não encontrado' });
        }
    } catch (error) {
        console.error('Erro ao ler o arquivo de bundles:', error);
        res.status(500).json({ error: 'Erro ao ler o arquivo de bundles' });
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

            // Estrutura compatível com o endpoint antigo
            responseData = {
                totalBundles: detailedData.totalBundles,
                bundles: detailedData.bundles.slice(startIndex, endIndex),
                page: page,
                totalPages: Math.ceil(detailedData.bundles.length / limit),
                hasNext: endIndex < detailedData.bundles.length,
                hasPrev: page > 1,
                lastUpdate: detailedData.last_update,
                updateTriggered: false
            };
        } else if (status.hasBasicBundles && fs.existsSync(BUNDLES_FILE)) {
            // Se só tem dados básicos, retorna eles com estrutura compatível
            const basicData = JSON.parse(fs.readFileSync(BUNDLES_FILE, 'utf-8'));
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const startIndex = (page - 1) * limit;
            const endIndex = page * limit;

            responseData = {
                totalBundles: basicData.totalBundles,
                bundles: basicData.bundles.slice(startIndex, endIndex),
                page: page,
                totalPages: Math.ceil(basicData.bundles.length / limit),
                hasNext: endIndex < basicData.bundles.length,
                hasPrev: page > 1,
                lastUpdate: null,
                updateTriggered: false,
                dataType: 'basic'
            };
        } else {
            return res.status(500).json({ error: 'Nenhum dado de bundles encontrado' });
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
        res.status(500).json({ error: 'Erro ao ler o arquivo de bundles detalhado' });
    }
});

// 📜 Endpoint legacy (comportamento antigo sem inteligência)
router.get('/api/bundles-detailed-legacy', validateInput, (req, res) => {
    try {
        if (fs.existsSync(BUNDLES_DETAILED_FILE)) {
            const data = JSON.parse(fs.readFileSync(BUNDLES_DETAILED_FILE, 'utf-8'));
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const startIndex = (page - 1) * limit;
            const endIndex = page * limit;

            const result = {
                totalBundles: data.totalBundles,
                bundles: data.bundles.slice(startIndex, endIndex),
                page: page,
                totalPages: Math.ceil(data.bundles.length / limit),
                hasNext: endIndex < data.bundles.length,
                hasPrev: page > 1,
                lastUpdate: data.last_update
            };

            res.json(result);
            console.log(`📄 [LEGACY] Página ${page} enviada (${result.bundles.length} itens)`);
        } else {
            res.status(500).json({ error: 'Arquivo de bundles detalhado não encontrado' });
        }
    } catch (error) {
        console.error('Erro ao ler o arquivo de bundles detalhado:', error);
        res.status(500).json({ error: 'Erro ao ler o arquivo de bundles detalhado' });
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
        
        await fetchAndSaveBundles();
        console.log('fetchAndSaveBundles concluído.');

        await updateBundlesWithDetails();
        console.log('updateBundlesWithDetails concluído.');

        res.json({ 
            message: 'Atualização forçada concluída com sucesso.', 
            totalBundles: totalBundlesCount,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Erro ao forçar a atualização:', error);
        res.status(500).json({ error: 'Erro ao forçar a atualização' });
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
                message: 'Use o endpoint /api/update-details para atualização completa'
            });
        }

        console.log(`[TEST] Iniciando atualização de teste com ${limit} bundles...`);
        
        const result = await updateBundlesWithDetails('brazilian', limit);
        
        res.json({ 
            message: `Teste concluído com ${limit} bundles.`,
            timestamp: new Date().toISOString(),
            ...result
        });
        
        console.log(`🧪 Teste concluído: ${result.processedBundles} bundles processados.`);
    } catch (error) {
        console.error('❌ Erro no teste de atualização:', error);
        res.status(500).json({ error: 'Erro no teste de atualização' });
    }
});

// 📊 NOVO: Endpoint para obter estatísticas da API Steam
router.get('/api/steam-stats', (req, res) => {
    try {
        const status = getCurrentDataStatus();
        
        // Lê estatísticas dos arquivos se existirem
        let stats = {
            steam_api_config: {
                delay_between_requests: process.env.STEAM_API_DELAY || 1500,
                delay_between_app_requests: process.env.STEAM_APP_DELAY || 100,
                max_apps_per_bundle: process.env.MAX_APPS_PER_BUNDLE || 50,
                request_timeout: process.env.REQUEST_TIMEOUT || 10000,
                max_retries: process.env.MAX_RETRIES || 3
            },
            data_status: status,
            files: {
                bundles_exists: fs.existsSync('bundles.json'),
                bundles_detailed_exists: fs.existsSync('bundleDetailed.json'),
                bundles_test_exists: fs.existsSync('bundleDetailed_test.json')
            }
        };

        if (fs.existsSync('bundleDetailed.json')) {
            const data = JSON.parse(fs.readFileSync('bundleDetailed.json', 'utf-8'));
            stats.production = {
                total_bundles: data.totalBundles,
                last_update: data.last_update,
                is_test_mode: data.isTestMode || false,
                duplicates_removed: data.duplicatesRemoved || 0
            };
        }

        if (fs.existsSync('bundleDetailed_test.json')) {
            const testData = JSON.parse(fs.readFileSync('bundleDetailed_test.json', 'utf-8'));
            stats.test = {
                total_bundles: testData.totalBundles,
                last_update: testData.last_update,
                processed_count: testData.processedCount
            };
        }

        res.json(stats);
    } catch (error) {
        console.error('Erro ao obter estatísticas:', error);
        res.status(500).json({ error: 'Erro ao obter estatísticas' });
    }
});

// 🧹 NOVO: Endpoint para remover duplicatas manualmente (PROTEGIDO)
router.get('/api/clean-duplicates', authenticateApiKey, adminRateLimit, async (req, res) => {
    try {
        console.log('🧹 [ADMIN] Iniciando limpeza de duplicatas...');
        
        const basicResult = removeDuplicatesFromBasicBundles();
        const detailedResult = removeDuplicatesFromDetailedBundles();
        
        const result = {
            message: 'Limpeza de duplicatas concluída',
            basic_bundles: {
                duplicates_removed: basicResult.removed,
                total_remaining: basicResult.total
            },
            detailed_bundles: {
                duplicates_removed: detailedResult.removed,
                total_remaining: detailedResult.total
            },
            total_duplicates_removed: basicResult.removed + detailedResult.removed,
            timestamp: new Date().toISOString()
        };
        
        res.json(result);
        console.log(`🧹 Limpeza concluída: ${result.total_duplicates_removed} duplicatas removidas`);
        
    } catch (error) {
        console.error('❌ Erro na limpeza de duplicatas:', error);
        res.status(500).json({ error: 'Erro na limpeza de duplicatas' });
    }
});

module.exports = router;