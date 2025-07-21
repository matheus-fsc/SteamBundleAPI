const fs = require('fs');
const os = require('os');

// Health check endpoint
const healthCheck = (req, res) => {
    const health = {
        status: 'UP',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: {
            used: process.memoryUsage().heapUsed / 1024 / 1024, // MB
            total: process.memoryUsage().heapTotal / 1024 / 1024, // MB
            system: os.totalmem() / 1024 / 1024 / 1024, // GB
            free: os.freemem() / 1024 / 1024 / 1024 // GB
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

    // Verifica se os arquivos essenciais existem
    if (!health.files.bundlesExists || !health.files.bundlesDetailedExists) {
        health.status = 'DEGRADED';
    }

    // Verifica uso de memória
    if (health.memory.used > 500) { // Mais de 500MB
        health.status = 'WARNING';
    }

    res.status(health.status === 'UP' ? 200 : 503).json(health);
};

// Middleware para capturar erros não tratados
const errorHandler = (err, req, res, next) => {
    console.error(`[ERROR] ${new Date().toISOString()} - ${err.stack}`);
    
    // Não vazar detalhes do erro em produção
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

// Middleware para rotas não encontradas
const notFoundHandler = (req, res) => {
    res.status(404).json({ 
        error: 'Endpoint não encontrado',
        message: `A rota ${req.method} ${req.originalUrl} não existe.`,
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
