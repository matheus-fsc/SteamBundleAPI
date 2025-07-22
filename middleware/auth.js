const rateLimit = require('express-rate-limit');
const authenticateApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.query.api_key;
    const validApiKey = process.env.API_KEY;
    if (!validApiKey) {
        return next();
    }
    if (!apiKey || apiKey !== validApiKey) {
        return res.status(401).json({ 
            error: 'API Key invÃ¡lida ou nÃ£o fornecida',
            message: 'Inclua sua API key no header X-API-Key ou no query parameter api_key',
            help: {
                header_example: 'X-API-Key: your-api-key-here',
                query_example: '?api_key=your-api-key-here',
                endpoints_requiring_auth: [
                    '/api/force-update',
                    '/api/update-details', 
                    '/api/test-update',
                    '/api/clean-duplicates'
                ]
            }
        });
    }
    next();
};
const adminRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: {
        error: 'Muitas requisiÃ§Ãµes administrativas. Tente novamente em 15 minutos.',
        retry_after: '15 minutes',
        current_limit: '5 requests per 15 minutes',
        tip: 'Use endpoints pÃºblicos para consultas frequentes'
    },
    standardHeaders: true,
    legacyHeaders: false,
});
const publicRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: {
        error: 'Muitas requisiÃ§Ãµes. Tente novamente em 15 minutos.',
        retry_after: '15 minutes',
        current_limit: '100 requests per 15 minutes',
        tip: 'Considere usar cache local para reduzir requisiÃ§Ãµes'
    },
    standardHeaders: true,
    legacyHeaders: false,
});
module.exports = {
    authenticateApiKey,
    adminRateLimit,
    publicRateLimit
};
