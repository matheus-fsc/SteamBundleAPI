// test-retry-storage.js - Teste do sistema de retry com Storage API
require('dotenv').config();

async function testRetryStorageIntegration() {
    console.log('🧪 TESTE: Sistema de Retry + Storage API\n');
    
    try {
        // Simula a classe FailedBundlesManager
        const { storageSyncManager } = require('./services/storageSync');
        
        console.log('1️⃣ Testando carregamento da fila do Storage API...');
        
        const storageResult = await storageSyncManager.getFailedBundlesQueue();
        
        if (storageResult.success) {
            console.log('✅ Conexão com Storage API funcionando');
            console.log(`📊 Dados encontrados: ${storageResult.queue.bundles?.length || 0} bundles na fila`);
            console.log(`📅 Última atualização: ${storageResult.metadata?.lastUpdate || 'N/A'}`);
            
            if (storageResult.queue.bundles && storageResult.queue.bundles.length > 0) {
                console.log('\n📋 Bundles na fila de retry:');
                storageResult.queue.bundles.slice(0, 3).forEach((bundle, i) => {
                    console.log(`   ${i + 1}. Bundle ${bundle.bundleId} - Razões: ${bundle.reasons?.join(', ') || 'N/A'}`);
                });
                if (storageResult.queue.bundles.length > 3) {
                    console.log(`   ... e mais ${storageResult.queue.bundles.length - 3} bundles`);
                }
            } else {
                console.log('📭 Fila vazia - nenhum bundle para retry no momento');
            }
        } else {
            console.log('❌ Erro ao conectar com Storage API:', storageResult.error);
        }
        
        console.log('\n✅ Teste concluído - Sistema de retry adaptado para Storage API');
        
    } catch (error) {
        console.error('❌ Erro durante teste:', error.message);
    }
}

testRetryStorageIntegration();
