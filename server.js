const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const cron = require('node-cron');
const moment = require('moment-timezone');
const fs = require('fs');

const { fetchAndSaveBundles } = require('./services/fetchBundles');
const { updateBundlesWithDetails, checkAndResumeUpdate } = require('./services/updateBundles');
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

const checkLastVerification = () => {
    console.log('🔍 Verificando status dos arquivos de bundles...');
    const bundlesExists = fs.existsSync(BUNDLES_FILE);
    const bundlesDetailedExists = fs.existsSync(BUNDLES_DETAILED_FILE);
    console.log(`📋 bundles.json: ${bundlesExists ? '✅ Existe' : '❌ Não encontrado'}`);
    console.log(`📄 bundleDetailed.json: ${bundlesDetailedExists ? '✅ Existe' : '❌ Não encontrado'}`);
    
    // --- NOVA LÓGICA DE VERIFICAÇÃO INTELIGENTE ---
    if (!bundlesExists && !bundlesDetailedExists) {
        console.log('🚨 Ambos os arquivos ausentes - iniciando coleta completa do início...');
        fetchAndSaveBundles();
        return;
    }
    
    if (bundlesExists && !bundlesDetailedExists) {
        console.log('🔍 bundles.json existe, mas bundleDetailed.json não. Verificando integridade...');
        try {
            const bundlesData = JSON.parse(fs.readFileSync(BUNDLES_FILE, 'utf-8'));
            
            // Verifica se o arquivo bundles.json está completo
            if (!bundlesData.bundles || !Array.isArray(bundlesData.bundles) || bundlesData.bundles.length === 0) {
                console.log('⚠️ bundles.json existe mas está vazio ou corrompido - reiniciando coleta completa...');
                fetchAndSaveBundles();
                return;
            }
            
            // Verifica se tem a estrutura mínima esperada
            const hasValidStructure = bundlesData.bundles.every(bundle => 
                bundle.Link && typeof bundle.Link === 'string' && bundle.Link.includes('/bundle/')
            );
            
            if (!hasValidStructure) {
                console.log('⚠️ bundles.json existe mas tem estrutura inválida - reiniciando coleta completa...');
                fetchAndSaveBundles();
                return;
            }
            
            console.log(`✅ bundles.json está íntegro (${bundlesData.bundles.length} bundles)`);
            console.log('🚀 bundleDetailed.json ausente - iniciando apenas atualização detalhada...');
            
            // Executa apenas a atualização detalhada via updateController
            setTimeout(() => {
                updateController.executeControlledUpdate(
                    () => updateBundlesWithDetails('brazilian'), 
                    'missing-detailed-file'
                ).catch(error => {
                    console.error('❌ Erro ao executar atualização detalhada:', error.message);
                });
            }, 2000);
            return;
            
        } catch (error) {
            console.log('⚠️ Erro ao ler bundles.json - reiniciando coleta completa...', error.message);
            fetchAndSaveBundles();
            return;
        }
    }
    
    if (!bundlesExists && bundlesDetailedExists) {
        console.log('⚠️ bundleDetailed.json existe mas bundles.json não - situação inconsistente');
        console.log('🚨 Reiniciando coleta completa para garantir consistência...');
        fetchAndSaveBundles();
        return;
    }
    
    // Se ambos existem, faz a verificação de tempo normal
    if (bundlesExists && bundlesDetailedExists) {
        console.log('✅ Ambos os arquivos existem - verificando timestamp...');
        
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
