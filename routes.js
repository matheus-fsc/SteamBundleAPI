
const express = require('express');
const { authenticateApiKey, adminRateLimit } = require('./middleware/auth');
const { validateInput } = require('./middleware/security');
const { storageSyncManager } = require('./services/storageSync');
const updateController = require('./services/updateController');
const { fetchAndSaveBundles } = require('./services/fetchBundles');
const { updateBundlesWithDetails } = require('./services/updateDetails/updateBundles-modular');

const router = express.Router();

// Proxy para bundles detalhadas
router.get('/api/bundles-detailed', validateInput, async (req, res) => {
    try {
        console.log('📡 [PROXY] Encaminhando requisição para a Storage API...');
        const detailedData = await storageSyncManager.getBundlesDetailed(req.query);
        res.json(detailedData);
    } catch (error) {
        console.error('❌ [PROXY] Erro ao buscar dados da Storage API:', error.message);
        res.status(502).json({ error: 'Erro ao comunicar com o serviço de dados.' });
    }
});

// Proxy para opções de filtro
router.get('/api/filter-options', validateInput, async (req, res) => {
    try {
        console.log('📡 [PROXY] Buscando opções de filtro na Storage API...');
        const filterOptions = await storageSyncManager.getFilterOptions(req.query);
        res.json(filterOptions);
    } catch (error) {
        console.error('❌ [PROXY] Erro ao buscar opções de filtro:', error.message);
        res.status(502).json({ error: 'Erro ao comunicar com o serviço de dados.' });
    }
});

// Proxy para estatísticas
router.get('/api/steam-stats', async (req, res) => {
    try {
        console.log('📡 [PROXY] Buscando estatísticas na Storage API...');
        const stats = await storageSyncManager.getSteamStats(req.query);
        res.json(stats);
    } catch (error) {
        console.error('❌ [PROXY] Erro ao buscar estatísticas:', error.message);
        res.status(502).json({ error: 'Erro ao comunicar com o serviço de dados.' });
    }
});

// Endpoint para forçar uma atualização (PROTEGIDO)
router.get('/api/force-update', authenticateApiKey, adminRateLimit, async (req, res) => {
    try {
        console.log('[ADMIN] Requisição de atualização forçada recebida.');
        updateController.executeControlledUpdate(fetchAndSaveBundles, 'force-update-basic');
        updateController.executeControlledUpdate(updateBundlesWithDetails, 'force-update-detailed');
        res.status(202).json({ 
            message: 'Atualização forçada iniciada em segundo plano.',
            status: updateController.getStatus() 
        });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao iniciar atualização forçada' });
    }
});

// Endpoint para atualizar os detalhes das bundles (PROTEGIDO)
router.get('/api/update-details', authenticateApiKey, adminRateLimit, async (req, res) => {
    try {
        console.log('[ADMIN] Iniciando atualização de detalhes...');
        updateController.executeControlledUpdate(updateBundlesWithDetails, 'admin-update-details');
        res.status(202).json({ 
            message: 'Atualização de detalhes iniciada em segundo plano.',
            status: updateController.getStatus() 
        });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao iniciar atualização de detalhes' });
    }
});

// Endpoint de teste para processar apenas algumas bundles (PROTEGIDO)
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
        updateController.executeControlledUpdate(() => updateBundlesWithDetails('english', limit), 'test-update');
        res.status(202).json({ 
            message: `Teste de atualização iniciado em segundo plano (${limit} bundles).`,
            status: updateController.getStatus() 
        });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao iniciar teste de atualização' });
    }
});

// Health check para keep-alive e monitoramento
router.get('/health', (req, res) => {
    try {
        const memoryUsage = process.memoryUsage();
        const uptime = process.uptime();
        
        res.status(200).json({
            status: 'healthy',
            uptime: Math.round(uptime),
            memory: {
                used: Math.round(memoryUsage.heapUsed / 1024 / 1024) + 'MB',
                total: Math.round(memoryUsage.heapTotal / 1024 / 1024) + 'MB'
            },
            timestamp: new Date().toISOString(),
            pid: process.pid,
            version: require('./package.json').version || '2.0.0'
        });
    } catch (error) {
        res.status(503).json({ 
            status: 'unhealthy', 
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Health check alternativo
router.get('/api/health', (req, res) => {
    res.redirect('/health');
});

// Status simples para keep-alive (ultra-leve)
router.get('/api/status', (req, res) => {
    try {
        // Resposta minimalista para reduzir carga durante scraping
        res.status(200).json({
            status: 'ok',
            timestamp: Date.now(),
            uptime: Math.round(process.uptime())
        });
    } catch (error) {
        res.status(500).json({ 
            status: 'error', 
            timestamp: Date.now()
        });
    }
});

// Keep-alive ainda mais leve (só para manter acordado)
router.get('/ping', (req, res) => {
    res.status(200).send('pong');
});

// Status completo (só usar quando necessário)
router.get('/api/full-status', (req, res) => {
    try {
        const status = updateController.getStatus();
        const memoryUsage = process.memoryUsage();
        
        res.status(200).json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            updateController: status.isUpdating ? 'active' : 'idle',
            memory: {
                used: Math.round(memoryUsage.heapUsed / 1024 / 1024) + 'MB',
                total: Math.round(memoryUsage.heapTotal / 1024 / 1024) + 'MB'
            },
            uptime: Math.round(process.uptime()),
            pid: process.pid
        });
    } catch (error) {
        res.status(500).json({ 
            status: 'error', 
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

module.exports = router;