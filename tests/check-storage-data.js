// check-storage-data.js - Verificar dados salvos no storage
require('dotenv').config();
const axios = require('axios');

async function checkStorageData() {
    console.log('🔍 Verificando dados salvos no storage...\n');
    
    try {
        // 1. Verificar dados básicos
        console.log('1️⃣ Consultando bundles básicos...');
        const bundlesResponse = await axios.get('https://bundleset-api-storage.vercel.app/api/data', {
            timeout: 10000
        });
        
        console.log('✅ Resposta recebida!');
        console.log(`📊 Status: ${bundlesResponse.status}`);
        
        if (bundlesResponse.data && bundlesResponse.data.bundles) {
            const bundles = bundlesResponse.data.bundles;
            console.log(`📈 Total de bundles no storage: ${bundles.length}`);
            
            if (bundles.length > 0) {
                console.log('\n📋 Primeiros 3 bundles salvos:');
                bundles.slice(0, 3).forEach((bundle, index) => {
                    console.log(`   ${index + 1}. ${bundle.Nome}`);
                    console.log(`      Link: ${bundle.Link}`);
                });
            }
        } else {
            console.log('⚠️ Estrutura de dados diferente da esperada');
            console.log('📄 Dados recebidos:', JSON.stringify(bundlesResponse.data, null, 2));
        }
        
        // 2. Verificar health
        console.log('\n2️⃣ Verificando health da API...');
        const healthResponse = await axios.get('https://bundleset-api-storage.vercel.app/api/health', {
            timeout: 5000
        });
        console.log('✅ Health OK:', healthResponse.data);
        
    } catch (error) {
        console.error('\n❌ Erro ao verificar storage:');
        if (error.response) {
            console.error(`🔍 Status: ${error.response.status}`);
            console.error(`📄 Dados: ${JSON.stringify(error.response.data, null, 2)}`);
        } else {
            console.error(`🔍 Mensagem: ${error.message}`);
        }
    }
}

// Executar verificação
checkStorageData();
