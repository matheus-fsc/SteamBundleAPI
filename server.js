// server.js (Corrigido)

const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const cron = require('node-cron');
const moment = require('moment-timezone');
const fs = require('fs');

// Serviços e Módulos (importados uma única vez)
const updateController = require('./services/updateController');
const { fetchAndSaveBundles } = require('./services/fetchBundles');
const { updateBundlesWithDetails } = require('./services/updateDetails/updateBundles-modular');
const routes = require('./routes');
const { requestLogger, corsOptions } = require('./middleware/security');
const { healthCheck, errorHandler, notFoundHandler } = require('./middleware/monitoring');
const { publicRateLimit } = require('./middleware/auth');

const app = express();

// Configurações do Express (helmet, compression, etc.)
app.set('trust proxy', 1);
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
app.use(compression());
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(requestLogger);
app.use(publicRateLimit);

// Configuração das Rotas
app.get('/health', healthCheck);
app.use('/', routes);
app.use(notFoundHandler);
app.use(errorHandler);

// Configuração do Agendador (Cron)
const TIMEZONE = process.env.TIMEZONE || 'America/Sao_Paulo';
const STEAM_UPDATE_SCHEDULE = {
    OPTIMIZED: '0 3 * * 3,5',
    DAILY: '0 3 * * *',
    WEEKLY: '0 3 * * 3'
};
const scheduleMode = process.env.UPDATE_SCHEDULE_MODE || 'OPTIMIZED';
const cronExpression = STEAM_UPDATE_SCHEDULE[scheduleMode] || STEAM_UPDATE_SCHEDULE.OPTIMIZED;

console.log(`🕐 Configuração de agendamento: ${scheduleMode}`);
console.log(`📅 Cron: ${cronExpression}`);

cron.schedule(cronExpression, async () => {
    console.log(`🔄 [CRON] Disparando atualização agendada (${scheduleMode})`);
    try {
        await updateController.executeControlledUpdate(fetchAndSaveBundles, 'cron-fetch-basic');
        await updateController.executeControlledUpdate(updateBundlesWithDetails, 'cron-fetch-detailed');
    } catch (error) {
        console.error('❌ [CRON] Erro durante a atualização agendada:', error.message);
    }
}, { timezone: TIMEZONE });

// Inicialização do Servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    // A inicialização do updateController já acontece quando o módulo é importado pela primeira vez.
});