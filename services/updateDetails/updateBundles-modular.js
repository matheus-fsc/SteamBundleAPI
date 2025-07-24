/**
 * MIGRAÇÃO PARA ARQUITETURA MODULAR V2
 * Este arquivo mantém compatibilidade com o updateBundles.js original
 * enquanto utiliza a nova arquitetura modular organizada em updateDetails/
 */

// Importações dos módulos reorganizados
const { AdaptivePerformanceManager } = require('./AdaptivePerformanceManager');
const { FailedBundlesManager } = require('./FailedBundlesManager');
const { BundleScrapingService } = require('./BundleScrapingService');
const { StateManager } = require('./StateManager');
const { StorageSyncService } = require('./StorageSyncService');
const { UpdateBundlesOrchestrator } = require('./UpdateBundlesOrchestrator');

// Importação do storage sync existente
const { storageSyncManager } = require('../storageSync');

console.log('🏗️  MIGRAÇÃO MODULAR V2 - Arquitetura reorganizada em updateDetails/');
console.log('');
console.log('📁 ESTRUTURA MODULAR:');
console.log('   📊 AdaptivePerformanceManager - Sistema de otimização adaptativa');
console.log('   ❌ FailedBundlesManager - Gerenciamento de falhas e retry');
console.log('   🌐 BundleScrapingService - Scraping e extração de dados');
console.log('   💾 StateManager - Gerenciamento de estado e persistência');
console.log('   ☁️  StorageSyncService - Sincronização com Storage API');
console.log('   🎭 UpdateBundlesOrchestrator - Orquestrador principal');
console.log('');

// Instanciação dos serviços
const storageSyncService = new StorageSyncService(storageSyncManager);
const stateManager = new StateManager();
const adaptiveManager = new AdaptivePerformanceManager();
const failedManager = new FailedBundlesManager(storageSyncManager);
const scrapingService = new BundleScrapingService();

// Orquestrador principal
const orchestrator = new UpdateBundlesOrchestrator({
    storageSyncService,
    stateManager,
    adaptiveManager,
    failedManager,
    scrapingService
});

/**
 * Função principal compatível com o sistema original
 */
const updateBundlesWithDetails = async (language = 'brazilian', limitForTesting = null) => {
    console.log('🚀 INICIANDO ATUALIZAÇÃO COM ARQUITETURA MODULAR V2');
    console.log(`📁 Módulos carregados de: services/updateDetails/`);
    console.log('');
    
    return await orchestrator.updateBundlesWithDetails(language, limitForTesting);
};

/**
 * Função para verificar e retomar atualizações incompletas
 */
const checkAndResumeUpdate = async () => {
    return await orchestrator.checkAndResumeUpdate();
};

/**
 * Função para processar fila de retry
 */
const processRetryQueue = async () => {
    return await orchestrator.processRetryQueue();
};

/**
 * Função para obter status do sistema
 */
const getSystemStatus = () => {
    return {
        modular: true,
        version: '2.0',
        architecture: 'updateDetails/',
        modules: {
            adaptive: !!adaptiveManager,
            failed: !!failedManager,
            scraping: !!scrapingService,
            state: !!stateManager,
            storage: !!storageSyncService,
            orchestrator: !!orchestrator
        },
        compatibility: 'Full backward compatibility maintained'
    };
};

console.log('✅ MIGRAÇÃO MODULAR CONCLUÍDA - Sistema pronto para uso');
console.log('');
console.log('🔧 FUNCIONALIDADES DISPONÍVEIS:');
console.log('   • updateBundlesWithDetails() - Função principal de atualização');
console.log('   • checkAndResumeUpdate() - Verificação e retomada de atualizações');
console.log('   • processRetryQueue() - Processamento de fila de retry');
console.log('   • getSystemStatus() - Status do sistema modular');
console.log('');
console.log('🎯 BENEFÍCIOS DA REFATORAÇÃO:');
console.log('   ✅ Código organizado em módulos especializados');
console.log('   ✅ Manutenção simplificada e isolada');
console.log('   ✅ Reutilização de componentes');
console.log('   ✅ Compatibilidade total com sistema anterior');
console.log('   ✅ Estrutura escalável para futuras expansões');
console.log('');

// Exportações para manter compatibilidade
module.exports = {
    updateBundlesWithDetails,
    checkAndResumeUpdate,
    processRetryQueue,
    getSystemStatus,
    
    // Acesso direto aos módulos se necessário
    modules: {
        orchestrator,
        adaptiveManager,
        failedManager,
        scrapingService,
        stateManager,
        storageSyncService
    }
};
