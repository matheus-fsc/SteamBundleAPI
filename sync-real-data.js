// sync-real-data.js - Sincronizar dados reais com Storage API
require('dotenv').config();

const { storageSyncManager } = require('./services/storageSync');
const fs = require('fs');

async function syncRealData() {
    console.log('🔄 SINCRONIZANDO DADOS REAIS COM STORAGE API\n');
    
    try {
        // 1. Carregar dados reais do backup
        console.log('1️⃣ Carregando dados reais do backup...');
        
        if (!fs.existsSync('./bundleDetailed-old.json')) {
            console.error('❌ Arquivo bundleDetailed-old.json não encontrado');
            return;
        }
        
        const backupData = JSON.parse(fs.readFileSync('./bundleDetailed-old.json', 'utf-8'));
        const realBundles = backupData.bundles || [];
        
        console.log(`📊 Dados carregados: ${realBundles.length} bundles reais`);
        console.log(`📈 Status: ${backupData.status}, Completo: ${backupData.isComplete}`);
        
        if (realBundles.length === 0) {
            console.error('❌ Nenhum bundle real encontrado no backup');
            return;
        }
        
        // 2. Amostra dos dados
        console.log('\n📋 Amostra dos dados reais:');
        realBundles.slice(0, 5).forEach((bundle, i) => {
            console.log(`   ${i + 1}. ${bundle.bundleid} - ${bundle.name}`);
        });
        
        // 3. Sincronizar dados reais com Storage API
        console.log(`\n2️⃣ Sincronizando ${realBundles.length} bundles reais...`);
        
        // Usa syncDetailedBundlesFinal para marcar como dados completos finais
        const syncResult = await storageSyncManager.syncDetailedBundlesFinal(realBundles, {
            totalExpected: realBundles.length,
            isComplete: true,
            source: 'backup_restoration'
        });
        
        console.log('✅ Sincronização concluída!');
        
        // 4. Verificar se dados foram salvos corretamente
        console.log('\n3️⃣ Verificando sincronização...');
        
        await new Promise(resolve => setTimeout(resolve, 2000)); // Aguarda 2s
        
        const verifyResult = await storageSyncManager.getBundlesDetailed();
        
        if (verifyResult && verifyResult.bundles) {
            console.log(`✅ Verificação: ${verifyResult.bundles.length} bundles no Storage API`);
            
            if (verifyResult.bundles.length === realBundles.length) {
                console.log('🎉 SUCESSO: Todos os bundles reais foram sincronizados!');
                
                console.log('\n📊 Primeiros bundles sincronizados:');
                verifyResult.bundles.slice(0, 3).forEach((bundle, i) => {
                    console.log(`   ${i + 1}. ${bundle.bundleid} - ${bundle.name}`);
                });
                
            } else {
                console.log(`⚠️ PARCIAL: ${verifyResult.bundles.length}/${realBundles.length} bundles sincronizados`);
            }
        } else {
            console.log('❌ Falha na verificação - não foi possível recuperar dados');
        }
        
        console.log('\n🔗 Teste no navegador: https://bundleset-api-storage.vercel.app/api/bundles-detailed');
        
    } catch (error) {
        console.error('❌ Erro durante sincronização:', error.message);
        console.error(error.stack);
    }
}

syncRealData();
