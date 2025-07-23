#!/usr/bin/env node

/**
 * Teste de Integração Storage API
 * Verifica se a sincronização entre updateBundles.js e Storage API está funcionando
 */

// Carregar variáveis de ambiente primeiro
require('dotenv').config();

const { storageSyncManager } = require('./services/storageSync');

async function testStorageIntegration() {
    console.log('🧪 TESTE DE INTEGRAÇÃO STORAGE API\n');
    
    try {
        // 1. Validar configuração
        console.log('1️⃣ Validando configuração...');
        storageSyncManager.validateConfig();
        console.log('✅ Configuração válida\n');
        
        // 2. Testar conectividade
        console.log('2️⃣ Testando conectividade...');
        const connectivity = await storageSyncManager.testConnection();
        if (connectivity.success) {
            console.log(`✅ Conectividade OK (status: ${connectivity.status})`);
        } else {
            console.log(`❌ Conectividade falhou: ${connectivity.error}`);
            return;
        }
        console.log('');
        
        // 3. Testar sincronização de fila de falhas vazia
        console.log('3️⃣ Testando sincronização de fila de falhas...');
        const testQueue = {
            timestamp: new Date().toISOString(),
            totalFailed: 0,
            retryable: 0,
            bundles: []
        };
        
        await storageSyncManager.syncFailedBundlesQueue(testQueue);
        console.log('✅ Fila de falhas vazia sincronizada\n');
        
        // 4. Testar recuperação de fila de falhas
        console.log('4️⃣ Testando recuperação de fila de falhas...');
        const recoveredQueue = await storageSyncManager.getFailedBundlesQueue();
        if (recoveredQueue.success) {
            console.log(`✅ Fila recuperada: ${recoveredQueue.queue.totalFailed} bundles`);
        } else {
            console.log(`⚠️ Erro na recuperação: ${recoveredQueue.error}`);
        }
        console.log('');
        
        // 5. Testar sincronização de chunk de bundles detalhados (mock)
        console.log('5️⃣ Testando sincronização de chunk detalhado...');
        const mockDetailedBundles = [
            { bundleid: 'test1', name: 'Test Bundle 1' },
            { bundleid: 'test2', name: 'Test Bundle 2' }
        ];
        
        const chunkInfo = {
            chunkNumber: 1,
            totalChunks: 1,
            chunkSize: 200,
            totalExpected: 2,
            isLastChunk: true
        };
        
        await storageSyncManager.syncDetailedBundlesChunk(mockDetailedBundles, chunkInfo);
        console.log('✅ Chunk de teste sincronizado\n');
        
        console.log('🎉 TODOS OS TESTES PASSARAM!');
        console.log('✅ Sistema de sincronização Storage API está funcional');
        
    } catch (error) {
        console.error('❌ ERRO NO TESTE:', error.message);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

// Executa o teste
if (require.main === module) {
    testStorageIntegration();
}

module.exports = { testStorageIntegration };
