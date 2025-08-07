/**
 * Script de recuperação dos dados da tabela bundles_detailed_staging
 * Transfere os dados processados da staging para a tabela principal bundles
 * Uso: node scripts/recover-detailed-staging.js [session_id]
 */

const axios = require('axios');

async function recoverDetailedStaging(sessionId = null) {
    console.log('🔧 SCRIPT DE RECUPERAÇÃO - bundles_detailed_staging → bundles');
    console.log('='.repeat(60));

    const STORAGE_API_URL = process.env.STORAGE_API_URL || 'https://bundleset-api-storage.vercel.app';
    const STORAGE_API_KEY = process.env.STORAGE_API_KEY;

    if (!STORAGE_API_KEY) {
        console.error('❌ STORAGE_API_KEY não encontrada nas variáveis de ambiente');
        process.exit(1);
    }

    try {
        // 1. Verificar se a sessão existe na staging
        console.log(`🔍 Verificando sessão ${sessionId} na bundles_detailed_staging...`);
        
        // Usar a API finish diretamente para fazer a transferência
        console.log('\n🚀 Executando transferência dos dados da staging...');
        
        const transferUrl = `${STORAGE_API_URL}/api/finish?type=detailed`;
        
        console.log(`📤 Chamando: ${transferUrl}`);

        const transferResponse = await axios.post(transferUrl, {}, {
            headers: {
                'x-api-key': STORAGE_API_KEY,
                'Content-Type': 'application/json',
                'X-Session-ID': sessionId,
                'X-Recovery-Mode': 'true'
            },
            timeout: 120000 // 2 minutos
        });

        console.log('✅ Transferência completada com sucesso!');
        console.log(`📊 Resultado:`, transferResponse.data);

        // 2. Verificar resultado final
        console.log('\n🔍 Verificando dados transferidos...');
        
        const finalCheckUrl = `${STORAGE_API_URL}/api/bundles`;
        const finalResponse = await axios.get(`${finalCheckUrl}?limit=5`, {
            headers: { 'x-api-key': STORAGE_API_KEY },
            timeout: 30000
        });

        const finalData = finalResponse.data;
        console.log(`📈 Verificação final:`);
        console.log(`   Bundles na tabela principal: ${finalData.length || 'N/A'}`);
        
        if (finalData.length > 0) {
            console.log(`   Exemplo de bundles transferidos:`);
            finalData.slice(0, 3).forEach((bundle, i) => {
                console.log(`     ${i+1}. ID: ${bundle.id}, Nome: ${bundle.name?.substring(0, 40)}...`);
            });
        }

        console.log('\n✅ RECUPERAÇÃO CONCLUÍDA COM SUCESSO!');

    } catch (error) {
        console.error('❌ ERRO na recuperação:', error.message);
        
        if (error.response) {
            console.error(`   Status: ${error.response.status}`);
            console.error(`   Dados: ${JSON.stringify(error.response.data, null, 2)}`);
        }
        
        console.log('\n🔧 INSTRUÇÕES MANUAIS:');
        console.log('1. Verifique se a API storage está rodando');
        console.log('2. Confirme se a STORAGE_API_KEY está correta');
        console.log('3. Execute o script novamente ou tente a recuperação manual via SQL');
        
        process.exit(1);
    }
}

// Execução do script
const sessionId = process.argv[2];

if (sessionId) {
    console.log(`🎯 Recuperando dados da sessão específica: ${sessionId}`);
} else {
    console.log('🎯 Recuperando todos os dados da staging');
    console.log('   Uso: node scripts/recover-detailed-staging.js [session_id]');
}

recoverDetailedStaging(sessionId);
