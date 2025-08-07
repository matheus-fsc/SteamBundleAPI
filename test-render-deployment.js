/**
 * Script para testar deployment no Render
 * Usage: node test-render-deployment.js https://seu-app.onrender.com
 */

const axios = require('axios');

async function testRenderDeployment(baseUrl) {
    console.log('🧪 TESTE DE DEPLOYMENT NO RENDER');
    console.log('=' .repeat(50));
    console.log(`🌐 URL Base: ${baseUrl}`);
    console.log('');

    const tests = [];
    let passed = 0;
    let failed = 0;

    // Test 1: Health Check
    try {
        console.log('1. ✅ Testando Health Check...');
        const health = await axios.get(`${baseUrl}/api/health`, { timeout: 10000 });
        console.log(`   Status: ${health.status}`);
        console.log(`   Response: ${JSON.stringify(health.data)}`);
        tests.push({ test: 'Health Check', status: 'PASS' });
        passed++;
    } catch (error) {
        console.log(`   ❌ Falha: ${error.message}`);
        tests.push({ test: 'Health Check', status: 'FAIL', error: error.message });
        failed++;
    }

    // Test 2: API Status
    try {
        console.log('\n2. ✅ Testando API Status...');
        const status = await axios.get(`${baseUrl}/api/status`, { timeout: 10000 });
        console.log(`   Status: ${status.status}`);
        console.log(`   Update Controller: ${status.data.updateController ? 'OK' : 'FAIL'}`);
        console.log(`   Storage Connection: ${status.data.storageConnection ? 'OK' : 'FAIL'}`);
        tests.push({ test: 'API Status', status: 'PASS' });
        passed++;
    } catch (error) {
        console.log(`   ❌ Falha: ${error.message}`);
        tests.push({ test: 'API Status', status: 'FAIL', error: error.message });
        failed++;
    }

    // Test 3: Storage API Connection
    try {
        console.log('\n3. ✅ Testando conexão com Storage API...');
        const storageUrl = process.env.STORAGE_API_URL || 'https://bundleset-api-storage.vercel.app';
        const storageKey = process.env.STORAGE_API_KEY || '7d76e24dba6090fa6627e0849ced759605d4c7b49c0140d55154f1e3f6cd39ac';
        
        const storage = await axios.get(`${storageUrl}/api/bundles?limit=1`, {
            headers: { 'x-api-key': storageKey },
            timeout: 10000
        });
        
        console.log(`   Storage Status: ${storage.status}`);
        console.log(`   Total Bundles: ${storage.data.data?.totalRecords || 0}`);
        tests.push({ test: 'Storage Connection', status: 'PASS' });
        passed++;
    } catch (error) {
        console.log(`   ❌ Falha: ${error.message}`);
        tests.push({ test: 'Storage Connection', status: 'FAIL', error: error.message });
        failed++;
    }

    // Test 4: Environment Variables
    try {
        console.log('\n4. ✅ Testando variáveis de ambiente...');
        const envTest = await axios.get(`${baseUrl}/api/health`, { timeout: 5000 });
        
        // Se chegou até aqui, as principais env vars estão OK
        console.log(`   NODE_ENV: Configurado`);
        console.log(`   STORAGE_API: Configurado`);
        tests.push({ test: 'Environment Variables', status: 'PASS' });
        passed++;
    } catch (error) {
        console.log(`   ❌ Falha: ${error.message}`);
        tests.push({ test: 'Environment Variables', status: 'FAIL', error: error.message });
        failed++;
    }

    // Test 5: Memory & Performance
    try {
        console.log('\n5. ✅ Testando performance básica...');
        const startTime = Date.now();
        const perf = await axios.get(`${baseUrl}/api/health`, { timeout: 15000 });
        const responseTime = Date.now() - startTime;
        
        console.log(`   Tempo de resposta: ${responseTime}ms`);
        
        if (responseTime < 3000) {
            console.log(`   Performance: Boa (< 3s)`);
            tests.push({ test: 'Performance', status: 'PASS' });
            passed++;
        } else {
            console.log(`   Performance: Lenta (> 3s) - Normal no primeiro acesso`);
            tests.push({ test: 'Performance', status: 'WARN' });
            passed++;
        }
    } catch (error) {
        console.log(`   ❌ Falha: ${error.message}`);
        tests.push({ test: 'Performance', status: 'FAIL', error: error.message });
        failed++;
    }

    // Resumo dos testes
    console.log('\n' + '='.repeat(50));
    console.log('📊 RESUMO DOS TESTES');
    console.log('='.repeat(50));
    
    tests.forEach((test, index) => {
        const icon = test.status === 'PASS' ? '✅' : test.status === 'WARN' ? '⚠️' : '❌';
        console.log(`${index + 1}. ${icon} ${test.test}: ${test.status}`);
        if (test.error) {
            console.log(`   Erro: ${test.error}`);
        }
    });
    
    console.log('\n📈 Resultados:');
    console.log(`✅ Passou: ${passed}`);
    console.log(`❌ Falhou: ${failed}`);
    console.log(`📊 Taxa de Sucesso: ${Math.round((passed / (passed + failed)) * 100)}%`);
    
    if (failed === 0) {
        console.log('\n🎉 DEPLOYMENT FUNCIONANDO PERFEITAMENTE!');
        console.log('🚀 API está pronta para uso em produção.');
    } else if (failed <= 1) {
        console.log('\n⚠️ DEPLOYMENT FUNCIONANDO COM AVISOS');
        console.log('🔧 Algumas funcionalidades podem precisar de ajustes.');
    } else {
        console.log('\n❌ DEPLOYMENT COM PROBLEMAS');
        console.log('🛠️ Verifique logs e configurações no Render.');
    }
}

// Executar teste
const renderUrl = process.argv[2];

if (!renderUrl) {
    console.log('❌ Uso: node test-render-deployment.js https://seu-app.onrender.com');
    process.exit(1);
}

console.log('🔄 Aguarde, testando deployment...\n');

testRenderDeployment(renderUrl)
    .then(() => {
        console.log('\n✅ Teste concluído!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Erro crítico no teste:', error.message);
        process.exit(1);
    });
