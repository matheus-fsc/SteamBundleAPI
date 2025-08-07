// server.js - Ponto de entrada principal da aplicação Scraper (Versão Definitiva)

const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const cron = require('node-cron');
const moment = require('moment-timezone');

// --- Serviços e Módulos ---
const { getLogger } = require('./services/PersistentLogger');
const updateController = require('./services/updateController');
const { fetchAndSaveBundles } = require('./services/fetchBundles');
const { updateBundlesWithDetails } = require('./services/updateDetails/updateBundles-modular');
const routes = require('./routes');

// --- Inicializar Logger Persistente ---
const logger = getLogger();
logger.critical('SERVER_START', 'Servidor Steam Bundle API iniciando...', {
    node_version: process.version,
    environment: process.env.NODE_ENV,
    render_mode: process.env.RENDER_FREE_MODE === 'true'
});

// --- Middlewares ---
const { requestLogger, corsOptions } = require('./middleware/security');
const { healthCheck, errorHandler, notFoundHandler } = require('./middleware/monitoring');
const { publicRateLimit } = require('./middleware/auth');


// ====================================================================
// 1. CONFIGURAÇÃO DO EXPRESS
// ====================================================================
const app = express();
app.set('trust proxy', 1);

// Middlewares de Segurança e Performance
app.use(helmet());
app.use(compression());
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(requestLogger);
app.use(publicRateLimit);


// ====================================================================
// 2. CONFIGURAÇÃO DAS ROTAS
// ====================================================================
app.get('/health', healthCheck);

// [NOVO] Rota para monitorizar o estado do processo de atualização
app.get('/api/update-status', (req, res) => {
  const status = updateController.getStatus();
  res.status(200).json(status);
});

app.use('/', routes); // Rotas principais da aplicação
app.use(notFoundHandler); // Middleware para rotas não encontradas (404)
app.use(errorHandler); // Middleware para tratamento de erros


// ====================================================================
// 3. CONFIGURAÇÃO DO AGENDADOR (CRON)
// ====================================================================
const TIMEZONE = process.env.TIMEZONE || 'America/Sao_Paulo';
const STEAM_UPDATE_SCHEDULE = {
    WEEKLY: '0 3 * * 0',      // 🎯 NOVO PADRÃO: Domingos às 3h (processo demorado)
    OPTIMIZED: '0 3 * * 3,5', // Quartas e sextas às 3h (legado)
    DAILY: '0 3 * * *',       // Todos os dias às 3h (só para dev/teste)
    BIWEEKLY: '0 3 * * 0/2'   // A cada 2 semanas no domingo
};
const scheduleMode = process.env.UPDATE_SCHEDULE_MODE || 'WEEKLY';
const cronExpression = STEAM_UPDATE_SCHEDULE[scheduleMode] || STEAM_UPDATE_SCHEDULE.OPTIMIZED;

console.log(`🕐 Configuração de agendamento: ${scheduleMode} (${cronExpression})`);

cron.schedule(cronExpression, async () => {
    const logger = getLogger();
    logger.critical('CRON_UPDATE', `Atualização agendada iniciada (${moment().tz(TIMEZONE).format('YYYY-MM-DD HH:mm:ss')})`);
    
    try {
        logger.milestone('CRON_UPDATE', 'Fase 1: Fetch básico iniciado', 1, 2);
        await updateController.executeControlledUpdate(fetchAndSaveBundles, 'cron-fetch-basic');
        
        logger.milestone('CRON_UPDATE', 'Fase 2: Detalhamento iniciado', 2, 2);
        await updateController.executeControlledUpdate(updateBundlesWithDetails, 'cron-fetch-detailed');
        
        logger.critical('CRON_UPDATE', 'Atualização agendada finalizada com sucesso');
    } catch (error) {
        logger.error('CRON_UPDATE', 'Erro durante atualização agendada', error);
    }
}, { timezone: TIMEZONE });


// ====================================================================
// 4. INICIALIZAÇÃO DO SERVIDOR E LÓGICA DE ARRANQUE
// ====================================================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
    logger.critical('SERVER_READY', `Servidor iniciado na porta ${PORT}`, {
        port: PORT,
        timestamp: new Date().toISOString()
    });
    console.log(`🚀 Servidor a ser executado na porta ${PORT}`);
    
    try {
        // [ATUALIZADO] Inicializa o controlador e obtém o estado detalhado
        const initStatus = await updateController.initialize();
        
        // [ATUALIZADO] Lógica de arranque resiliente
        if (initStatus.needsBasicUpdate || initStatus.needsDetailedUpdate) {
            console.log('✨ [ARRANQUE] A disparar atualização inicial ou de continuação...');
            
            setTimeout(async () => {
                try {
                    // Executa a atualização básica apenas se for necessária
                    if (initStatus.needsBasicUpdate) {
                        console.log('✨ [ARRANQUE] Etapa 1: A procurar bundles básicos...');
                        await updateController.executeControlledUpdate(fetchAndSaveBundles, 'initial-fetch-basic');
                        
                        // ✅ CORREÇÃO CRÍTICA: Verificar se agora precisa da atualização detalhada
                        console.log('🔍 [ARRANQUE] Verificando se é necessária atualização detalhada após fetch básico...');
                        const postBasicCheck = await updateController.checkForUpdatesNeeded();
                        
                        if (postBasicCheck.needsDetailedUpdate) {
                            console.log('✨ [ARRANQUE] Etapa 2: A procurar detalhes dos bundles (detectado automaticamente)...');
                            await updateController.executeControlledUpdate(updateBundlesWithDetails, 'initial-fetch-detailed');
                        } else {
                            console.log('ℹ️ [ARRANQUE] Atualização detalhada não necessária após fetch básico.');
                        }
                    }
                    
                    // Executa a atualização detalhada apenas se for necessária (caso original)
                    if (initStatus.needsDetailedUpdate) {
                        console.log('✨ [ARRANQUE] Etapa 2: A procurar detalhes dos bundles...');
                        await updateController.executeControlledUpdate(updateBundlesWithDetails, 'initial-fetch-detailed');
                    }

                    console.log('✅ [ARRANQUE] Rotinas de atualização inicial concluídas!');
                } catch (error) {
                    console.error('❌ [ARRANQUE] Erro durante a execução da atualização inicial agendada:', error.message);
                }
            }, 5000); // Atraso de 5 segundos
        }
    } catch (error) {
        console.error('❌ [ARRANQUE] Erro crítico durante a inicialização do UpdateController:', error.message);
    }
});