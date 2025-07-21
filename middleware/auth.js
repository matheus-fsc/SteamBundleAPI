const rateLimit = require('express-rate-limit');

// Middleware de autenticação por API Key
const authenticateApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.query.api_key;
    const validApiKey = process.env.API_KEY;

    // Se não há API key configurada, permite acesso (modo desenvolvimento)
    if (!validApiKey) {
        return next();
    }

    if (!apiKey || apiKey !== validApiKey) {
        return res.status(401).json({ 
            error: 'API Key inválida ou não fornecida',
            message: 'Inclua sua API key no header X-API-Key ou no query parameter api_key'
        });
    }

    next();
};

// Rate limiting mais rigoroso para endpoints administrativos
const adminRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 5, // máximo 5 requisições por IP a cada 15 minutos
    message: {
        error: 'Muitas requisições administrativas. Tente novamente em 15 minutos.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Rate limiting para endpoints públicos
const publicRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // máximo 100 requisições por IP a cada 15 minutos
    message: {
        error: 'Muitas requisições. Tente novamente em 15 minutos.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

module.exports = {
    authenticateApiKey,
    adminRateLimit,
    publicRateLimit
};
