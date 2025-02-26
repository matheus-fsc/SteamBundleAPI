const express = require('express');
const fs = require('fs');
const { fetchAndSaveBundles, totalBundlesCount } = require('./fetchBundles');
const { updateBundlesWithDetails } = require('./updateBundles'); // Importar a função updateBundlesWithDetails

const router = express.Router();
const BUNDLES_FILE = 'bundles.json';
const BUNDLES_DETAILED_FILE = 'bundleDetailed.json';

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
router.get('/api/bundles-detailed', (req, res) => {
    try {
        if (fs.existsSync(BUNDLES_DETAILED_FILE)) {
            const data = JSON.parse(fs.readFileSync(BUNDLES_DETAILED_FILE, 'utf-8'));
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const startIndex = (page - 1) * limit;
            const endIndex = page * limit + 2;

            const result = {
                totalBundles: data.totalBundles,
                bundles: data.bundles.slice(startIndex, endIndex),
                page: page,
                totalPages: Math.ceil(data.bundles.length / limit)
            };

            res.json(result);
            console.log('Resposta detalhada enviada ao cliente');
        } else {
            res.status(500).json({ error: 'Arquivo de bundles detalhado não encontrado' });
        }
    } catch (error) {
        console.error('Erro ao ler o arquivo de bundles detalhado:', error);
        res.status(500).json({ error: 'Erro ao ler o arquivo de bundles detalhado' });
    }
});

// Endpoint para forçar uma atualização
router.get('/api/force-update', async (req, res) => {
    try {
        await fetchAndSaveBundles();
        res.json({ message: 'Atualização forçada concluída com sucesso.', totalBundles: totalBundlesCount });
        console.log('Atualização forçada concluída com sucesso.');
    } catch (error) {
        console.error('Erro ao forçar a atualização:', error);
        res.status(500).json({ error: 'Erro ao forçar a atualização' });
    }
});

// Endpoint para atualizar os detalhes das bundles
router.get('/api/update-details', async (req, res) => {
    try {
        await updateBundlesWithDetails();
        res.json({ message: 'Detalhes das bundles atualizados com sucesso.' });
        console.log('Detalhes das bundles atualizados com sucesso.');
    } catch (error) {
        console.error('Erro ao atualizar os detalhes das bundles:', error);
        res.status(500).json({ error: 'Erro ao atualizar os detalhes das bundles' });
    }
});

module.exports = router;