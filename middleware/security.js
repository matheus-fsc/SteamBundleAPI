const helmet = require('helmet');
const compression = require('compression');

const requestLogger = (req, res, next) => {
    const start = Date.now();
    const originalSend = res.send;
    res.send = function(data) {
        const duration = Date.now() - start;
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - ${res.statusCode} - ${duration}ms`);
        if (req.originalUrl.includes('/force-update') || req.originalUrl.includes('/update-details') || req.originalUrl.includes('/test-update')) {
            console.log(`🔧 [ADMIN] Endpoint administrativo: ${req.originalUrl} - IP: ${req.ip}`);
        }
        originalSend.call(this, data);
    };
    next();
};

const validateInput = (req, res, next) => {
    if (req.query.page && isNaN(parseInt(req.query.page))) {
        return res.status(400).json({ error: 'Parâmetro page deve ser um número' });
    }
    if (req.query.limit && isNaN(parseInt(req.query.limit))) {
        return res.status(400).json({ error: 'Parâmetro limit deve ser um número' });
    }
    if (req.query.limit && parseInt(req.query.limit) > 100) {
        return res.status(400).json({ error: 'Limite máximo de 100 itens por página' });
    }
    next();
};

const corsOptions = {
    origin: function (origin, callback) {
        const allowedOrigins = [
            'http://localhost:3000',
            'http://localhost:3001',
            'https://bundles-set-seven.vercel.app',
            'https://bundles-set.vercel.app',
            'https://steambundleapi.onrender.com',
            /\.render\.com$/,
            /\.vercel\.app$/,
            /\.netlify\.app$/,
            /localhost:\d+$/
        ];
        if (!origin) return callback(null, true);
        const isAllowed = allowedOrigins.some(allowedOrigin => {
            if (typeof allowedOrigin === 'string') {
                return origin === allowedOrigin;
            }
            if (allowedOrigin instanceof RegExp) {
                return allowedOrigin.test(origin);
            }
            return false;
        });
        if (process.env.NODE_ENV === 'production' && !isAllowed) {
            console.log(`🚫 CORS bloqueado para origin: ${origin}`);
            const msg = 'A política CORS não permite acesso deste origin.';
            return callback(new Error(msg), false);
        }
        console.log(`✅ CORS permitido para origin: ${origin || 'sem origin'}`);
        return callback(null, true);
    },
    credentials: true,
    methods: ['GET'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
};

module.exports = {
    requestLogger,
    validateInput,
    corsOptions
};
