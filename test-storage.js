// test-storage.js - Teste de conectividade com Storage API
require('dotenv').config();
const { storageSyncManager } = require('./services/storageSync');

async function testStorageConnection() {
    console.log('🧪 Testando conectividade com Storage API...\n');
    
    try {
        // 1. Validar configuração
        console.log('1️⃣ Validando configuração...');
        storageSyncManager.validateConfig();
        console.log('✅ Configuração válida\n');
        
        // 2. Testar conectividade
        console.log('2️⃣ Testando conectividade...');
        const connectivity = await storageSyncManager.testConnection();
        
        if (connectivity.success) {
            console.log('✅ Conectividade OK');
            console.log(`📊 Status: ${connectivity.status}`);
            if (connectivity.latency) {
                console.log(`⏱️ Latência: ${connectivity.latency}`);
            }
        } else {
            console.log('❌ Falha na conectividade');
            console.log(`🔍 Erro: ${connectivity.error}`);
            return;
        }
        
        console.log('\n3️⃣ Testando sincronização com dados de exemplo...');
        
        // 3. Teste com dados de exemplo
        const testBundles = [
            { Nome: "Test Bundle 1", Link: "https://store.steampowered.com/bundle/12345/" },
            { Nome: "Test Bundle 2", Link: "https://store.steampowered.com/bundle/67890/" }
        ];
        
        const result = await storageSyncManager.syncBasicBundles(testBundles);
        console.log('✅ Sincronização de teste bem-sucedida!');
        console.log('📄 Resposta:', JSON.stringify(result, null, 2));
        
        console.log('\n🎉 Todos os testes passaram! O storage está funcionando corretamente.');
        
    } catch (error) {
        console.error('\n❌ Erro durante os testes:');
        console.error(`🔍 Mensagem: ${error.message}`);
        console.error(`📋 Stack: ${error.stack}`);
        process.exit(1);
    }
}

// Executar teste
testStorageConnection();
