const express = require('express');
const fs = require('fs');
const { fetchAndSaveBundles, totalBundlesCount } = require('./services/fetchBundles');
const { updateBundlesWithDetails } = require('./services/updateBundles');
const { authenticateApiKey, adminRateLimit } = require('./middleware/auth');
const { validateInput } = require('./middleware/security');

const router = express.Router();
const BUNDLES_FILE = 'bundles.json';
const BUNDLES_DETAILED_FILE = 'bundleDetailed.json';

// Rota principal para verificar se a API está funcionando
router.get('/', (req, res) => {
    res.json({ message: 'API conectada com sucesso!' });
});

// Endpoint para servir o JSON salvo
router.get('/api/bundles', (req, res) => {
    try {
        if (fs.existsSync(BUNDLES_FILE)) {
            const data = fs.readFileSync(BUNDLES_FILE, 'utf-8');
            res.json(JSON.parse(data));
            console.log('Resposta enviada ao cliente');
        } else {
            res.status(500).json({ error: 'Arquivo de bundles não encontrado' });
        }
    } catch (error) {
        console.error('Erro ao ler o arquivo de bundles:', error);
        res.status(500).json({ error: 'Erro ao ler o arquivo de bundles' });
    }
});

// Endpoint para servir o JSON detalhado com paginação
router.get('/api/bundles-detailed', validateInput, (req, res) => {
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
                hasPrev: page > 1
            };

            res.json(result);
            console.log(`Página ${page} de bundles detalhadas enviada ao cliente (${result.bundles.length} itens)`);
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
            console.log('JSON completo de bundles detalhados enviado ao cliente');
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
        console.log('Detalhes das bundles atualizados com sucesso.');
    } catch (error) {
        console.error('Erro ao atualizar os detalhes das bundles:', error);
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
        
        console.log(`Teste de atualização concluído: ${result.processedBundles} bundles processados.`);
    } catch (error) {
        console.error('Erro no teste de atualização:', error);
        res.status(500).json({ error: 'Erro no teste de atualização' });
    }
});

// 📊 NOVO: Endpoint para obter estatísticas da API Steam
router.get('/api/steam-stats', (req, res) => {
    try {
        // Lê estatísticas dos arquivos se existirem
        let stats = {
            steam_api_config: {
                delay_between_requests: process.env.STEAM_API_DELAY || 1500,
                delay_between_app_requests: process.env.STEAM_APP_DELAY || 100,
                max_apps_per_bundle: process.env.MAX_APPS_PER_BUNDLE || 50,
                request_timeout: process.env.REQUEST_TIMEOUT || 10000,
                max_retries: process.env.MAX_RETRIES || 3
            },
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
                is_test_mode: data.isTestMode || false
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

module.exports = router;