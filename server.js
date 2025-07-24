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

// Funções auxiliares para status e agendamento (agora com acesso às constantes)
function getNextScheduledUpdate() {
    const now = moment().tz(TIMEZONE);
    const nextRun = getNextCronExecution(cronExpression, now);
    return nextRun.format('DD/MM/YYYY HH:mm:ss');
}

function getNextCronExecution(cronExpr, fromTime) {
    const [minute, hour, day, month, dayOfWeek] = cronExpr.split(' ');
    let next = fromTime.clone().add(1, 'day').startOf('day').hour(parseInt(hour)).minute(parseInt(minute));
    
    if (dayOfWeek !== '*') {
        const targetDays = dayOfWeek.split(',').map(d => parseInt(d));
        while (!targetDays.includes(next.day())) {
            next.add(1, 'day');
        }
        next.hour(parseInt(hour)).minute(parseInt(minute));
    }
    
    return next;
}

// Torna as funções disponíveis globalmente para uso em routes.js
global.getNextScheduledUpdate = getNextScheduledUpdate;
global.getNextCronExecution = getNextCronExecution;

const checkLastVerification = async () => {
    console.log('🔍 Verificando status dos dados no Storage API...');
    
    try {
        // Testa conectividade com Storage API
        const connectivity = await storageSyncManager.testConnection();
        if (!connectivity.success) {
            console.log('❌ Storage API indisponível - executando coleta completa...');
            fetchAndSaveBundles();
            return;
        }
        
        console.log('✅ Storage API conectado');
        
        // Verifica dados básicos (bundles) com retry automático
        let bundlesData = null;
        try {
            console.log('📡 Verificando bundles básicos com retry...');
            bundlesData = await loadStorageDataWithRetry('bundles', 3);
        } catch (error) {
            console.log('⚠️ Erro ao buscar dados básicos após retry:', error.message);
        }
        
        // Verifica dados detalhados (bundlesDetailed) com retry automático
        let detailedData = null;
        try {
            console.log('📡 Verificando bundles detalhados com retry...');
            detailedData = await loadStorageDataWithRetry('bundlesDetailed', 3);
        } catch (error) {
            console.log('⚠️ Erro ao buscar dados detalhados após retry:', error.message);
        }
        
        const hasBundles = bundlesData && bundlesData.bundles && bundlesData.bundles.length > 0;
        const hasDetailed = detailedData && detailedData.bundles && detailedData.bundles.length > 0;
        
        console.log(`📋 Bundles básicos: ${hasBundles ? `✅ ${bundlesData.bundles.length} registros` : '❌ Não encontrados'}`);
        console.log(`📄 Bundles detalhados: ${hasDetailed ? `✅ ${detailedData.bundles.length} registros` : '❌ Não encontrados'}`);
        
        // --- NOVA LÓGICA DE VERIFICAÇÃO COM STORAGE API ---
        if (!hasBundles && !hasDetailed) {
            console.log('🚨 Ambas as tabelas vazias/ausentes - iniciando coleta completa do início...');
            fetchAndSaveBundles();
            return;
        }
        
        if (hasBundles && !hasDetailed) {
            console.log('🔍 Bundles básicos existem, mas detalhados não. Verificando integridade...');
            
            // Verifica se os dados básicos têm estrutura válida
            const hasValidStructure = bundlesData.bundles.every(bundle => 
                bundle.Link && typeof bundle.Link === 'string' && bundle.Link.includes('/bundle/')
            );
            
            if (!hasValidStructure) {
                console.log('⚠️ Dados básicos no Storage têm estrutura inválida - reiniciando coleta completa...');
                fetchAndSaveBundles();
                return;
            }
            
            console.log(`✅ Dados básicos íntegros (${bundlesData.bundles.length} bundles)`);
            console.log('🚀 Dados detalhados ausentes - iniciando apenas atualização detalhada...');
            
            // Executa apenas a atualização detalhada via updateController
            setTimeout(() => {
                updateController.executeControlledUpdate(
                    () => updateBundlesWithDetails('brazilian'), 
                    'missing-detailed-data'
                ).catch(error => {
                    console.error('❌ Erro ao executar atualização detalhada:', error.message);
                });
            }, 2000);
            return;
        }
        
        if (!hasBundles && hasDetailed) {
            console.log('⚠️ Dados detalhados existem mas básicos não - situação inconsistente');
            console.log('🚨 Reiniciando coleta completa para garantir consistência...');
            fetchAndSaveBundles();
            return;
        }
        
        // Se ambos existem, verifica se estão atualizados
        if (hasBundles && hasDetailed) {
            console.log('✅ Ambos os conjuntos de dados existem - verificando atualização...');
            
            // Verifica timestamp da última atualização
            const lastUpdateTimestamp = bundlesData.metadata?.last_update || detailedData.metadata?.last_update;
            
            if (lastUpdateTimestamp) {
                const lastUpdate = moment.tz(lastUpdateTimestamp, TIMEZONE);
                const now = moment().tz(TIMEZONE);
                const hoursSinceLastUpdate = now.diff(lastUpdate, 'hours');
                
                console.log(`⏰ Última atualização: ${lastUpdate.format('DD/MM/YYYY HH:mm:ss')} (${hoursSinceLastUpdate}h atrás)`);
                
                // Determina se precisa atualizar baseado no modo e horário
                const needsUpdate = shouldUpdateNow(lastUpdate, now, scheduleMode);
                
                if (needsUpdate.shouldUpdate) {
                    console.log(`🔄 ${needsUpdate.reason} - iniciando atualização...`);
                    fetchAndSaveBundles();
                } else {
                    console.log(`✅ ${needsUpdate.reason}`);
                    console.log(`📅 Próxima atualização agendada: ${getNextScheduledUpdate()}`);
                    
                    // Verifica se dados estão completos
                    const isComplete = detailedData.metadata?.isComplete || detailedData.isComplete;
                    if (!isComplete) {
                        console.log('⚠️ Dados detalhados incompletos detectados - verificando recuperação...');
                        setTimeout(() => {
                            checkAndResumeUpdate().catch(error => {
                                console.error('❌ Erro ao verificar recuperação:', error.message);
                            });
                        }, 1000);
                    }
                }
            } else {
                console.log('📝 Timestamp de atualização não encontrado - iniciando verificação inicial...');
                fetchAndSaveBundles();
            }
        }
        
    } catch (error) {
        console.error('❌ Erro durante verificação do Storage API:', error.message);
        console.log('🔄 Fallback: verificando arquivos locais...');
        
        // Fallback para verificação local se Storage API falhar completamente
        checkLastVerificationLocal();
    }
};

// Função para determinar se deve atualizar agora
function shouldUpdateNow(lastCheck, now, mode) {
    const hoursSince = now.diff(lastCheck, 'hours');
    const daysSince = now.diff(lastCheck, 'days');
    
    // Se passou mais de 7 dias, sempre atualiza independente do modo
    if (daysSince >= 7) {
        return { shouldUpdate: true, reason: 'Mais de 7 dias desde a última verificação' };
    }
    
    // Se passou mais de 3 dias e não é modo conservador, atualiza
    if (daysSince >= 3 && mode !== 'WEEKLY') {
        return { shouldUpdate: true, reason: 'Mais de 3 dias desde a última verificação' };
    }
    
    // Se passou mais de 24h e é modo diário, atualiza
    if (hoursSince >= 24 && mode === 'DAILY') {
        return { shouldUpdate: true, reason: 'Modo diário: mais de 24h desde a última verificação' };
    }
    
    // Se é primeira execução do dia após um dia de atualização da Steam
    const today = now.day(); // 0=Dom, 1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex, 6=Sáb
    const yesterday = now.clone().subtract(1, 'day').day();
    
    if ((today === 3 || today === 5) && hoursSince >= 12) { // Qua ou Sex, e passou 12h
        const lastWasBeforeSteamUpdate = lastCheck.day() !== today;
        if (lastWasBeforeSteamUpdate) {
            return { shouldUpdate: true, reason: `Dia pós-atualização da Steam (${today === 3 ? 'Quarta' : 'Sexta'})` };
        }
    }
    
    return { 
        shouldUpdate: false, 
        reason: `Dados atualizados - próxima verificação conforme agendamento (${mode})` 
    };
}

// Função de fallback para verificação local (se Storage API falhar)
const checkLastVerificationLocal = () => {
    console.log('🔍 [FALLBACK] Verificando arquivos locais...');
    const bundlesExists = fs.existsSync(BUNDLES_FILE);
    const bundlesDetailedExists = fs.existsSync(BUNDLES_DETAILED_FILE);
    console.log(`📋 bundles.json: ${bundlesExists ? '✅ Existe' : '❌ Não encontrado'}`);
    console.log(`📄 bundleDetailed.json: ${bundlesDetailedExists ? '✅ Existe' : '❌ Não encontrado'}`);
    
    if (!bundlesExists && !bundlesDetailedExists) {
        console.log('🚨 [FALLBACK] Ambos os arquivos ausentes - iniciando coleta completa...');
        fetchAndSaveBundles();
        return;
    }
    
    if (bundlesExists && !bundlesDetailedExists) {
        console.log('🔍 [FALLBACK] Apenas bundles.json existe - iniciando atualização detalhada...');
        setTimeout(() => {
            updateController.executeControlledUpdate(
                () => updateBundlesWithDetails('brazilian'), 
                'fallback-missing-detailed'
            ).catch(error => {
                console.error('❌ Erro ao executar atualização detalhada:', error.message);
            });
        }, 2000);
        return;
    }
    
    if (bundlesExists && bundlesDetailedExists) {
        console.log('✅ [FALLBACK] Ambos os arquivos existem - verificando timestamp...');
        
        if (fs.existsSync(LAST_CHECK_FILE)) {
            const lastCheckData = fs.readFileSync(LAST_CHECK_FILE, 'utf-8');
            const lastCheck = JSON.parse(lastCheckData).lastCheck;
            const now = moment().tz(TIMEZONE);
            const lastCheckMoment = moment.tz(lastCheck, TIMEZONE);
            const hoursSinceLastCheck = now.diff(lastCheckMoment, 'hours');
            
            console.log(`⏰ [FALLBACK] Última verificação: ${lastCheckMoment.format('DD/MM/YYYY HH:mm:ss')} (${hoursSinceLastCheck}h atrás)`);
            
            const needsUpdate = shouldUpdateNow(lastCheckMoment, now, scheduleMode);
            
            if (needsUpdate.shouldUpdate) {
                console.log(`🔄 [FALLBACK] ${needsUpdate.reason} - iniciando atualização...`);
                fetchAndSaveBundles();
            } else {
                console.log(`✅ [FALLBACK] ${needsUpdate.reason}`);
            }
        } else {
            console.log('📝 [FALLBACK] Timestamp não encontrado - iniciando verificação...');
            fetchAndSaveBundles();
        }
    }
};

console.log(`🕐 Configuração de agendamento: ${scheduleMode}`);
console.log(`📅 Cron: ${cronExpression} (${getScheduleDescription(scheduleMode)})`);

// Função para descrever o agendamento
function getScheduleDescription(mode) {
    const descriptions = {
        OPTIMIZED: 'Quartas e sextas às 3h (após atualizações da Steam)',
        DAILY: 'Todos os dias às 3h',
        WEEKLY: 'Apenas quartas às 3h'
    };
    return descriptions[mode] || descriptions.OPTIMIZED;
}

// Agenda a execução automática
cron.schedule(cronExpression, () => {
    console.log(`🔄 [CRON] Iniciando atualização automática agendada (${scheduleMode})`);
    console.log(`⏰ Horário: ${moment().tz(TIMEZONE).format('DD/MM/YYYY HH:mm:ss')}`);
    fetchAndSaveBundles();
}, {
    timezone: TIMEZONE
});

console.log(`✅ Agendamento ativo: ${getScheduleDescription(scheduleMode)}`);

// Aguarda um pouco antes da verificação para dar tempo do database processar dados recentes
setTimeout(async () => {
    await checkLastVerification();
    
    checkAndResumeUpdate().then(hasIncompleteUpdate => {
        if (hasIncompleteUpdate) {
            console.log('📋 Sistema pronto para continuar atualização incompleta');
        }
    }).catch(error => {
        console.error('❌ Erro ao verificar atualização incompleta:', error.message);
    });
}, 3000); // 3 segundos de delay

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
