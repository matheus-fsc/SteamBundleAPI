const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const cron = require('node-cron');
const moment = require('moment-timezone');
const fs = require('fs');

// Importar serviços
const { fetchAndSaveBundles } = require('./services/fetchBundles');
const { updateBundlesWithDetails } = require('./services/updateBundles');

// Importar rotas e middlewares
const routes = require('./routes');
const { requestLogger, corsOptions } = require('./middleware/security');
const { healthCheck, errorHandler, notFoundHandler } = require('./middleware/monitoring');
const { publicRateLimit } = require('./middleware/auth');

const app = express();

// Configuração para ambientes de produção com proxy reverso (Render, Heroku, etc.)
app.set('trust proxy', 1); // Confia no primeiro proxy

// Middlewares de segurança (devem vir primeiro)
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    }
}));

app.use(compression()); // Compressão gzip
app.use(cors(corsOptions)); // CORS personalizado
app.use(express.json({ limit: '10mb' })); // Limitar tamanho do body
app.use(requestLogger); // Logger personalizado
app.use(publicRateLimit); // Rate limiting

// Health check endpoint (sem rate limiting)
app.get('/health', healthCheck);

// Rotas principais
app.use('/', routes);

// Middlewares de erro (devem vir por último)
app.use(notFoundHandler);
app.use(errorHandler);

const LAST_CHECK_FILE = 'last_check.json';
const TIMEZONE = process.env.TIMEZONE || 'America/Sao_Paulo'; // Horário de Brasília

// Verificar a última verificação ao iniciar o servidor
const checkLastVerification = () => {
    if (fs.existsSync(LAST_CHECK_FILE)) {
        const lastCheckData = fs.readFileSync(LAST_CHECK_FILE, 'utf-8');
        const lastCheck = JSON.parse(lastCheckData).lastCheck;
        const now = moment().tz(TIMEZONE);
        const lastCheckMoment = moment.tz(lastCheck, TIMEZONE);

        // Se a última verificação foi há mais de 6 horas, faça uma nova verificação
        if (now.diff(lastCheckMoment, 'hours') >= 6) {
            fetchAndSaveBundles();
        } else {
            console.log('A última verificação foi realizada há menos de 6 horas.');
        }
    } else {
        // Se o arquivo não existir, faça uma nova verificação
        fetchAndSaveBundles();
    }
};

// Agendar a verificação para ocorrer a cada 6 horas
cron.schedule('0 */6 * * *', fetchAndSaveBundles, {
    timezone: TIMEZONE
});

checkLastVerification();

const PORT = process.env.PORT || 3000; // Porta dinâmica para o Render
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});