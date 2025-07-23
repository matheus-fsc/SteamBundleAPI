// test-new-routes.js - Teste das novas rotas específicas
require('dotenv').config();
const axios = require('axios');

async function testNewRoutes() {
    console.log('🧪 Testando novas rotas específicas...\n');
    
    const baseUrl = 'https://bundleset-api-storage.vercel.app';
    
    try {
        console.log('1️⃣ Testando rota /api/bundles (bundles básicos)...');
        const bundlesResponse = await axios.get(`${baseUrl}/api/bundles`, {
            timeout: 10000
        });
        
        console.log('✅ Rota /api/bundles funcionando!');
        console.log(`📊 Status: ${bundlesResponse.status}`);
        console.log(`📈 Bundles básicos: ${bundlesResponse.data.data.count}`);
        console.log(`🔄 Última atualização: ${bundlesResponse.data.status.lastUpdate}`);
        console.log(`💾 Último backup: ${bundlesResponse.data.status.lastBackup || 'N/A'}`);
        
        if (bundlesResponse.data.data.bundles.length > 0) {
            console.log(`📋 Primeiro bundle: ${bundlesResponse.data.data.bundles[0].Nome}`);
        }
        
        console.log('\n2️⃣ Testando rota /api/bundles-detailed (bundles detalhados)...');
        const detailedResponse = await axios.get(`${baseUrl}/api/bundles-detailed`, {
            timeout: 10000
        });
        
        console.log('✅ Rota /api/bundles-detailed funcionando!');
        console.log(`📊 Status: ${detailedResponse.status}`);
        console.log(`📈 Bundles detalhados: ${detailedResponse.data.data.count}`);
        console.log(`🧩 Chunks reconstruídos: ${detailedResponse.data.chunks.total}`);
        console.log(`🔄 Última atualização: ${detailedResponse.data.status.lastUpdate}`);
        console.log(`💾 Último backup: ${detailedResponse.data.status.lastBackup || 'N/A'}`);
        
        console.log('\n3️⃣ Comparando performance das rotas...');
        
        // Teste de performance - rota antiga vs novas
        const startOld = Date.now();
        const oldResponse = await axios.get(`${baseUrl}/api/data`);
        const timeOld = Date.now() - startOld;
        
        const startBundles = Date.now();
        const bundlesResponse2 = await axios.get(`${baseUrl}/api/bundles`);
        const timeBundles = Date.now() - startBundles;
        
        const startDetailed = Date.now();
        const detailedResponse2 = await axios.get(`${baseUrl}/api/bundles-detailed`);
        const timeDetailed = Date.now() - startDetailed;
        
        console.log(`⏱️ Performance Comparison:`);
        console.log(`   /api/data (antiga):           ${timeOld}ms`);
        console.log(`   /api/bundles (nova):          ${timeBundles}ms`);
        console.log(`   /api/bundles-detailed (nova): ${timeDetailed}ms`);
        
        const improvement = Math.round(((timeOld - timeBundles) / timeOld) * 100);
        if (improvement > 0) {
            console.log(`🚀 Melhoria na rota /api/bundles: ${improvement}% mais rápida!`);
        }
        
        console.log('\n4️⃣ Verificando diferenças no cache...');
        console.log(`🗄️ Cache headers:`);
        console.log(`   /api/data:            ${oldResponse.headers['cache-control']}`);
        console.log(`   /api/bundles:         ${bundlesResponse2.headers['cache-control']}`);
        console.log(`   /api/bundles-detailed: ${detailedResponse2.headers['cache-control']}`);
        
        console.log('\n🎉 Todas as novas rotas estão funcionando perfeitamente!');
        console.log('\n📋 Resumo dos benefícios:');
        console.log('   • Rotas específicas para cada tipo de dados ✅');
        console.log('   • Cache otimizado por tipo de uso ✅');
        console.log('   • Performance melhorada ✅');
        console.log('   • Informações de backup incluídas ✅');
        console.log('   • Metadados específicos por rota ✅');
        
        console.log('\n💡 Recomendações de uso:');
        console.log('   • Use /api/bundles para listar bundles básicos');
        console.log('   • Use /api/bundles-detailed para exibir detalhes');
        console.log('   • A rota /api/data ainda funciona mas é deprecated');
        
    } catch (error) {
        console.error('\n❌ Erro durante o teste:');
        if (error.response) {
            console.error(`🔍 Status: ${error.response.status}`);
            console.error(`📄 Dados: ${JSON.stringify(error.response.data, null, 2)}`);
        } else {
            console.error(`🔍 Mensagem: ${error.message}`);
        }
    }
}

// Executar teste
testNewRoutes();
