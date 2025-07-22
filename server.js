const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const cron = require('node-cron');
const moment = require('moment-timezone');
const fs = require('fs');

const { fetchAndSaveBundles } = require('./services/fetchBundles');
const { updateBundlesWithDetails, checkAndResumeUpdate } = require('./services/updateBundles');
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

const checkLastVerification = () => {
    console.log('🔍 Verificando status dos arquivos de bundles...');
    const bundlesExists = fs.existsSync(BUNDLES_FILE);
    const bundlesDetailedExists = fs.existsSync(BUNDLES_DETAILED_FILE);
    console.log(`📋 bundles.json: ${bundlesExists ? '✅ Existe' : '❌ Não encontrado'}`);
    console.log(`📄 bundleDetailed.json: ${bundlesDetailedExists ? '✅ Existe' : '❌ Não encontrado'}`);
    if (!bundlesExists || !bundlesDetailedExists) {
        console.log('🚨 Arquivos essenciais ausentes - iniciando nova coleta de dados...');
        fetchAndSaveBundles();
        return;
    }
    if (fs.existsSync(LAST_CHECK_FILE)) {
        const lastCheckData = fs.readFileSync(LAST_CHECK_FILE, 'utf-8');
        const lastCheck = JSON.parse(lastCheckData).lastCheck;
        const now = moment().tz(TIMEZONE);
        const lastCheckMoment = moment.tz(lastCheck, TIMEZONE);
        const hoursSinceLastCheck = now.diff(lastCheckMoment, 'hours');
        console.log(`⏰ Última verificação: ${lastCheckMoment.format('DD/MM/YYYY HH:mm:ss')} (${hoursSinceLastCheck}h atrás)`);
        if (hoursSinceLastCheck >= 6) {
            console.log('🔄 Mais de 6 horas desde a última verificação - iniciando atualização...');
            fetchAndSaveBundles();
        } else {
            console.log(`✅ Dados atualizados - próxima verificação em ${6 - hoursSinceLastCheck}h`);
        }
    } else {
        console.log('📝 Arquivo de timestamp não encontrado - iniciando verificação inicial...');
        fetchAndSaveBundles();
    }
};

cron.schedule('0 */6 * * *', fetchAndSaveBundles, {
    timezone: TIMEZONE
});

checkLastVerification();

checkAndResumeUpdate().then(hasIncompleteUpdate => {
    if (hasIncompleteUpdate) {
        console.log('📋 Sistema pronto para continuar atualização incompleta');
    }
}).catch(error => {
    console.error('❌ Erro ao verificar atualização incompleta:', error.message);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
