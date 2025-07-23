// test-micro.js - Teste micro (< 10 segundos) apenas para validação de conectividade
require('dotenv').config();

const { storageSyncManager } = require('./services/storageSync');

async function microTest() {
    console.log('⚡ TESTE MICRO - Apenas conectividade (< 10 segundos)\n');
    
    const startTime = Date.now();
    let tests = [];
    
    // 1. Storage API Health
    console.log('1️⃣ Storage API Health Check...');
    try {
        const health = await storageSyncManager.testConnection();
        if (health.success) {
            console.log(`✅ Storage API: OK (${health.status})`);
            tests.push({ name: 'Storage Health', passed: true });
        } else {
            console.log('❌ Storage API: FALHOU');
            tests.push({ name: 'Storage Health', passed: false });
        }
    } catch (error) {
        console.log('❌ Storage API: ERRO -', error.message);
        tests.push({ name: 'Storage Health', passed: false });
    }
    
    // 2. Storage API Sync Test
    console.log('\n2️⃣ Storage API Sync Test...');
    try {
        const syncResult = await storageSyncManager.syncFailedBundlesQueue({
            timestamp: new Date().toISOString(),
            totalFailed: 0,
            retryable: 0,
            bundles: []
        });
        
        console.log('✅ Storage Sync: OK');
        tests.push({ name: 'Storage Sync', passed: true });
    } catch (error) {
        console.log('❌ Storage Sync: FALHOU -', error.message);
        tests.push({ name: 'Storage Sync', passed: false });
    }
    
    // 3. Environment Check
    console.log('\n3️⃣ Environment Variables...');
    const requiredEnvs = ['STORAGE_API_URL', 'STORAGE_API_KEY'];
    let envOK = true;
    
    requiredEnvs.forEach(env => {
        if (!process.env[env]) {
            console.log(`❌ ${env}: AUSENTE`);
            envOK = false;
        } else {
            console.log(`✅ ${env}: CONFIGURADO`);
        }
    });
    
    tests.push({ name: 'Environment', passed: envOK });
    
    // 4. File System Check
    console.log('\n4️⃣ File System Access...');
    const fs = require('fs');
    let fsOK = true;
    
    try {
        // Testa escrita
        fs.writeFileSync('./test-write.tmp', 'test');
        fs.unlinkSync('./test-write.tmp');
        console.log('✅ File System: READ/WRITE OK');
    } catch (error) {
        console.log('❌ File System: FALHOU -', error.message);
        fsOK = false;
    }
    
    tests.push({ name: 'File System', passed: fsOK });
    
    // Resultado
    const duration = (Date.now() - startTime) / 1000;
    const passed = tests.filter(t => t.passed).length;
    const total = tests.length;
    
    console.log(`\n🏁 RESULTADO: ${passed}/${total} testes passaram em ${duration.toFixed(1)}s`);
    
    tests.forEach(test => {
        const status = test.passed ? '✅' : '❌';
        console.log(`   ${status} ${test.name}`);
    });
    
    if (passed === total) {
        console.log('\n🎉 SISTEMA PRONTO PARA DEPLOY!');
        console.log('✅ Conectividade: OK');
        console.log('✅ Storage API: OK');
        console.log('✅ Environment: OK');
        console.log('✅ File System: OK');
        return true;
    } else {
        console.log('\n❌ SISTEMA NÃO PRONTO PARA DEPLOY');
        console.log(`⚠️ ${total - passed} problemas detectados`);
        return false;
    }
}

microTest()
    .then(success => {
        if (success) {
            console.log('\n🚀 Próximo passo: Deploy no Render!');
            process.exit(0);
        } else {
            console.log('\n🔧 Corrigir problemas antes do deploy');
            process.exit(1);
        }
    })
    .catch(error => {
        console.error('\n❌ Teste micro falhou:', error.message);
        process.exit(1);
    });
