// sync-real-data-chunks.js - Sincronizar dados reais em chunks menores
require('dotenv').config();

const { storageSyncManager } = require('./services/storageSync');
const fs = require('fs');

async function syncRealDataInChunks() {
    console.log('🔄 SINCRONIZANDO DADOS REAIS EM CHUNKS\n');
    
    try {
        // 1. Carregar dados reais
        console.log('1️⃣ Carregando dados reais...');
        const backupData = JSON.parse(fs.readFileSync('./bundleDetailed-old.json', 'utf-8'));
        const realBundles = backupData.bundles || [];
        
        console.log(`📊 ${realBundles.length} bundles reais encontrados`);
        
        // 2. Dividir em chunks de 50 bundles
        const chunkSize = 50;
        const chunks = [];
        
        for (let i = 0; i < realBundles.length; i += chunkSize) {
            chunks.push(realBundles.slice(i, i + chunkSize));
        }
        
        console.log(`📦 Dividido em ${chunks.length} chunks de ~${chunkSize} bundles`);
        
        // 3. Enviar chunks sequencialmente
        console.log('\n2️⃣ Enviando chunks...');
        
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const chunkNumber = i + 1;
            const isLastChunk = i === chunks.length - 1;
            
            console.log(`📤 Chunk ${chunkNumber}/${chunks.length}: ${chunk.length} bundles...`);
            
            try {
                if (isLastChunk) {
                    // Último chunk - marca como final
                    await storageSyncManager.syncDetailedBundlesFinal(chunk, {
                        totalExpected: realBundles.length,
                        isComplete: true
                    });
                } else {
                    // Chunk intermediário
                    const chunkInfo = {
                        chunkNumber: chunkNumber,
                        totalChunks: chunks.length,
                        chunkSize: chunk.length,
                        isLastChunk: false,
                        totalExpected: realBundles.length
                    };
                    
                    await storageSyncManager.syncDetailedBundlesChunk(chunk, chunkInfo);
                }
                
                console.log(`✅ Chunk ${chunkNumber} enviado com sucesso`);
                
                // Pequena pausa entre chunks
                if (!isLastChunk) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                
            } catch (chunkError) {
                console.error(`❌ Erro no chunk ${chunkNumber}:`, chunkError.message);
                throw chunkError;
            }
        }
        
        console.log('\n✅ Todos os chunks enviados!');
        
        // 4. Verificar resultado
        console.log('\n3️⃣ Aguardando e verificando resultado...');
        await new Promise(resolve => setTimeout(resolve, 3000)); // Aguarda 3s
        
        try {
            const verifyResult = await storageSyncManager.getBundlesDetailed();
            
            if (verifyResult && verifyResult.bundles) {
                console.log(`📊 Resultado: ${verifyResult.bundles.length} bundles no Storage API`);
                
                if (verifyResult.bundles.length >= realBundles.length) {
                    console.log('🎉 SUCESSO TOTAL! Todos os bundles foram sincronizados');
                } else {
                    console.log(`📈 PROGRESSO: ${verifyResult.bundles.length}/${realBundles.length} bundles sincronizados`);
                }
                
                console.log('\n📋 Amostra final:');
                verifyResult.bundles.slice(0, 5).forEach((bundle, i) => {
                    console.log(`   ${i + 1}. ${bundle.bundleid} - ${bundle.name}`);
                });
            } else {
                console.log('⚠️ Não foi possível verificar o resultado');
            }
        } catch (verifyError) {
            console.log('⚠️ Erro na verificação:', verifyError.message);
        }
        
        console.log('\n🔗 Teste: https://bundleset-api-storage.vercel.app/api/bundles-detailed');
        
    } catch (error) {
        console.error('❌ Erro geral:', error.message);
    }
}

syncRealDataInChunks();
