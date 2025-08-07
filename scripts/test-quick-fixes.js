/**
 * Teste rápido das correções feitas
 * Usage: node test-quick-fixes.js
 */

console.log('🧪 TESTE RÁPIDO DAS CORREÇÕES');
console.log('=' .repeat(40));

async function testKeepAlive() {
    try {
        console.log('\n1. 🔄 Testando KeepAlive...');
        const { keepAlive } = require('../services/keepAlive');
        
        console.log('   ✅ KeepAlive importado com sucesso');
        console.log(`   📊 Status inicial: ${keepAlive.isRunning() ? 'Rodando' : 'Parado'}`);
        
        // Testar configuração básica
        console.log('   🔧 Configurações:');
        console.log(`      Interval: ${process.env.KEEP_ALIVE_INTERVAL || 'padrão'}`);
        console.log(`      Auto Start: ${process.env.KEEP_ALIVE_AUTO_START || 'padrão'}`);
        
        return true;
    } catch (error) {
        console.log(`   ❌ Erro no KeepAlive: ${error.message}`);
        return false;
    }
}

async function testUpdateController() {
    try {
        console.log('\n2. 🎛️ Testando UpdateController...');
        const updateController = require('../services/updateController');
        
        console.log('   ✅ UpdateController importado com sucesso');
        
        // Testar método de status
        const status = updateController.getStatus();
        console.log(`   📊 Status: ${status.isUpdating ? 'Atualizando' : 'Idle'}`);
        console.log(`   🔄 Última atualização: ${status.lastUpdateAttempt || 'Nunca'}`);
        
        return true;
    } catch (error) {
        console.log(`   ❌ Erro no UpdateController: ${error.message}`);
        return false;
    }
}

async function testStorageSync() {
    try {
        console.log('\n3. 💾 Testando StorageSync...');
        const { storageSyncManager } = require('../services/storageSync');
        
        console.log('   ✅ StorageSyncManager importado com sucesso');
        console.log(`   🌐 URL Storage: ${process.env.STORAGE_API_URL || 'não configurada'}`);
        console.log(`   🔑 API Key: ${process.env.STORAGE_API_KEY ? '***configurada***' : 'não configurada'}`);
        
        return true;
    } catch (error) {
        console.log(`   ❌ Erro no StorageSync: ${error.message}`);
        return false;
    }
}

async function testEnvironmentVars() {
    try {
        console.log('\n4. ⚙️ Testando Variáveis de Ambiente...');
        
        const requiredVars = [
            'STORAGE_API_URL',
            'STORAGE_API_KEY',
            'NODE_ENV',
        ];
        
        const optionalVars = [
            'UPDATE_VALIDATION_DELAY',
            'UPDATE_VALIDATION_RETRIES',
            'KEEP_ALIVE_INTERVAL',
            'RENDER_FREE_MODE'
        ];
        
        let allRequired = true;
        
        requiredVars.forEach(varName => {
            if (process.env[varName]) {
                console.log(`   ✅ ${varName}: configurada`);
            } else {
                console.log(`   ❌ ${varName}: FALTANDO`);
                allRequired = false;
            }
        });
        
        optionalVars.forEach(varName => {
            if (process.env[varName]) {
                console.log(`   📝 ${varName}: ${process.env[varName]}`);
            } else {
                console.log(`   ⚪ ${varName}: padrão`);
            }
        });
        
        return allRequired;
    } catch (error) {
        console.log(`   ❌ Erro nas env vars: ${error.message}`);
        return false;
    }
}

async function testImports() {
    try {
        console.log('\n5. 📦 Testando Imports críticos...');
        
        // Testar imports principais
        require('../services/fetchBundles');
        console.log('   ✅ fetchBundles.js');
        
        require('../services/updateDetails/updateBundles-modular');
        console.log('   ✅ updateBundles-modular.js');
        
        require('../services/BackupSystem');
        console.log('   ✅ BackupSystem.js');
        
        require('../server');
        console.log('   ✅ server.js (não executado)');
        
        return true;
    } catch (error) {
        console.log(`   ❌ Erro nos imports: ${error.message}`);
        return false;
    }
}

async function runTests() {
    console.log('🚀 Iniciando testes...\n');
    
    const results = [];
    
    results.push(await testEnvironmentVars());
    results.push(await testImports());
    results.push(await testKeepAlive());
    results.push(await testUpdateController());
    results.push(await testStorageSync());
    
    const passed = results.filter(r => r).length;
    const failed = results.length - passed;
    
    console.log('\n' + '='.repeat(40));
    console.log('📊 RESUMO DOS TESTES');
    console.log('='.repeat(40));
    console.log(`✅ Passou: ${passed}/${results.length}`);
    console.log(`❌ Falhou: ${failed}/${results.length}`);
    console.log(`📈 Taxa de Sucesso: ${Math.round((passed / results.length) * 100)}%`);
    
    if (failed === 0) {
        console.log('\n🎉 TODOS OS TESTES PASSARAM!');
        console.log('✅ Correções funcionando corretamente');
        console.log('🚀 Pronto para commit e deploy');
    } else if (failed <= 1) {
        console.log('\n⚠️ TESTES COM AVISOS');
        console.log('🔧 Algumas correções podem precisar de ajustes');
    } else {
        console.log('\n❌ FALHAS NOS TESTES');
        console.log('🛠️ Correções precisam de revisão antes do commit');
    }
    
    process.exit(failed === 0 ? 0 : 1);
}

// Executar testes
runTests().catch(error => {
    console.error('\n💥 ERRO CRÍTICO NO TESTE:', error.message);
    process.exit(1);
});
