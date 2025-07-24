const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const cron = require('node-cron');
const moment = require('moment-timezone');
const fs = require('fs');

const { fetchAndSaveBundles } = require('./services/fetchBundles');
const { updateBundlesWithDetails, checkAndResumeUpdate, loadStorageDataWithRetry } = require('./services/updateBundles');
const { storageSyncManager } = require('./services/storageSync');
const updateController = require('./services/updateController'); // Importa para ativar auto-resume
const routes = require('./routes');
const { requestLogger, corsOptions } = require('./middleware/security');
const { healthCheck, errorHandler, notFoundHandler } = require('./middleware/monitoring');
const { publicRateLimit } = require('./middleware/auth');

const app = express();

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

app.get('/health', healthCheck);
app.use('/', routes);
app.use(notFoundHandler);
app.use(errorHandler);

const LAST_CHECK_FILE = 'last_check.json';
const BUNDLES_FILE = 'bundles.json';
const BUNDLES_DETAILED_FILE = 'bundleDetailed.json';
const TIMEZONE = process.env.TIMEZONE || 'America/Sao_Paulo';

// Configuração de horários para execução automática
const STEAM_UPDATE_SCHEDULE = {
    // Modo otimizado: apenas nos dias que a Steam atualiza (padrão)
    OPTIMIZED: '0 3 * * 3,5', // 3h da manhã nas quartas e sextas (após atualizações da Steam)
    
    // Modo diário: todas as madrugadas (se necessário maior frequência)
    DAILY: '0 3 * * *', // 3h da manhã todos os dias
    
    // Modo conservador: apenas uma vez por semana
    WEEKLY: '0 3 * * 3' // 3h da manhã apenas nas quartas
};

// Escolha o modo baseado na variável de ambiente
const scheduleMode = process.env.UPDATE_SCHEDULE_MODE || 'OPTIMIZED';
const cronExpression = STEAM_UPDATE_SCHEDULE[scheduleMode] || STEAM_UPDATE_SCHEDULE.OPTIMIZED;


const updateController = require('./services/updateController');
const { fetchAndSaveBundles } = require('./services/fetchBundles');
const { updateBundlesWithDetails } = require('./services/updateDetails/updateBundles-modular');

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
