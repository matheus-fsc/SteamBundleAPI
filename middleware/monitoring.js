const fs = require('fs');
const os = require('os');
const healthCheck = (req, res) => {
    const health = {
        status: 'UP',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: {
            used: process.memoryUsage().heapUsed / 1024 / 1024,
            total: process.memoryUsage().heapTotal / 1024 / 1024,
            system: os.totalmem() / 1024 / 1024 / 1024,
            free: os.freemem() / 1024 / 1024 / 1024
        },
        cpu: {
            loadAverage: os.loadavg(),
            cores: os.cpus().length
        },
        files: {
            bundlesExists: fs.existsSync('bundles.json'),
            bundlesDetailedExists: fs.existsSync('bundleDetailed.json'),
            lastCheckExists: fs.existsSync('last_check.json')
        }
    };
    if (!health.files.bundlesExists || !health.files.bundlesDetailedExists) {
        health.status = 'DEGRADED';
    }
    if (health.memory.used > 500) {
        health.status = 'WARNING';
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
