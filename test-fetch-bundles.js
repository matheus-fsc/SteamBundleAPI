// test-fetch-bundles.js - Teste do processo completo de fetch com algumas páginas
require('dotenv').config();
const { fetchAndSaveBundles } = require('./services/fetchBundles');

async function testFetchBundles() {
    console.log('🧪 Testando processo completo de fetch de bundles...\n');
    
    try {
        // Temporariamente reduzir o escopo para teste
        process.env.FETCH_BUNDLES_CONCURRENT = '2'; // Apenas 2 páginas paralelas
        process.env.FETCH_BUNDLES_DELAY = '1000';   // 1 segundo de delay
        
        console.log('⚠️ MODO DE TESTE: Limitado a poucas páginas para validação');
        console.log('🚀 Iniciando fetch de bundles...\n');
        
        await fetchAndSaveBundles();
        
        console.log('\n🎉 Teste concluído com sucesso!');
        console.log('✅ Bundles foram coletados e sincronizados com o storage backend');
        
    } catch (error) {
        console.error('\n❌ Erro durante o teste:');
        console.error(`🔍 Mensagem: ${error.message}`);
        console.error(`📋 Stack: ${error.stack}`);
        process.exit(1);
    }
}

// Executar teste
testFetchBundles();
