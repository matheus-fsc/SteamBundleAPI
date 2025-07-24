const { storageSyncManager } = require('../services/storageSync');
const healthCheck = async (req, res) => {
    const health = {
        status: 'UP',
        timestamp: new Date().toISOString(),
        dependencies: {
            storage_api: {
                status: 'UNKNOWN',
                url: process.env.STORAGE_API_URL
            }
        }
    };

    try {
        // Ping na sua API de Storage
        const storageStatus = await storageSyncManager.testConnection();
        if (storageStatus.success) {
            health.dependencies.storage_api.status = 'UP';
        } else {
            health.dependencies.storage_api.status = 'DOWN';
            health.status = 'DEGRADED';
        }
    } catch (error) {
        health.dependencies.storage_api.status = 'DOWN';
        health.status = 'DEGRADED';
    }

    res.status(health.status === 'UP' ? 200 : 503).json(health);
};
const errorHandler = (err, req, res, next) => {
    console.error(`[ERROR] ${new Date().toISOString()} - ${err.stack}`);
    if (process.env.NODE_ENV === 'production') {
        res.status(500).json({ 
            error: 'Erro interno do servidor',
            message: 'Algo deu errado. Tente novamente mais tarde.'
        });
    } else {
        res.status(500).json({ 
            error: 'Erro interno do servidor',
            message: err.message,
            stack: err.stack
        });
    }
};
const notFoundHandler = (req, res) => {
    res.status(404).json({ 
        error: 'Endpoint nÃ£o encontrado',
        message: `A rota ${req.method} ${req.originalUrl} nÃ£o existe.`,
        availableEndpoints: [
            'GET /',
            'GET /health',
            'GET /api/bundles',
            'GET /api/bundles-detailed',
            'GET /api/bundles-detailed-all'
        ]
    });
};
module.exports = {
    healthCheck,
    errorHandler,
    notFoundHandler
};
