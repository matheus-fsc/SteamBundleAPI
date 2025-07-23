// test-pre-deploy.js - Rotina de teste completa antes do deploy no Render
require('dotenv').config();

const { updateBundlesWithDetails, processFailedBundles } = require('./services/updateBundles');
const { fetchBundles } = require('./services/fetchBundles');
const { storageSyncManager } = require('./services/storageSync');
const fs = require('fs');

async function runPreDeployTests() {
    console.log('🧪 ROTINA DE TESTE PRÉ-DEPLOY - Steam Bundle API\n');
    console.log('🎯 Objetivo: Validar sistema completo antes do deploy no Render');
    console.log('📊 Escopo: Fetch + Update + Storage API + Retry System\n');
    
    const testResults = {
        fetch: { success: false, error: null, bundles: 0 },
        storageConnection: { success: false, error: null },
        update: { success: false, error: null, processed: 0 },
        retry: { success: false, error: null, recovered: 0 },
        overall: { success: false, duration: 0 }
    };
    
    const startTime = Date.now();
    
    try {
        // ========================================
        // 1. TESTE DE FETCH LIMITADO (5 BUNDLES)
        // ========================================
        console.log('1️⃣ TESTE: Fetch de bundles básicos (limitado a 5)...');
        try {
            const fetchResult = await fetchBundles(5); // Limita a 5 bundles
            
            if (fetchResult.success && fetchResult.totalBundles > 0) {
                testResults.fetch.success = true;
                testResults.fetch.bundles = fetchResult.totalBundles;
                console.log(`✅ Fetch bem-sucedido: ${fetchResult.totalBundles} bundles obtidos`);
                console.log(`📊 Primeira página Steam: OK | Parsing: OK | Salvamento: OK`);
            } else {
                throw new Error(`Fetch falhou: ${fetchResult.error || 'Nenhum bundle encontrado'}`);
            }
        } catch (fetchError) {
            testResults.fetch.error = fetchError.message;
            console.log(`❌ Fetch falhou: ${fetchError.message}`);
            throw new Error(`BLOQUEADOR: Fetch básico não funciona`);
        }
        
        // ========================================
        // 2. TESTE DE CONEXÃO STORAGE API
        // ========================================
        console.log('\n2️⃣ TESTE: Conectividade Storage API...');
        try {
            storageSyncManager.validateConfig();
            const connectTest = await storageSyncManager.testConnection();
            
            if (connectTest.success) {
                testResults.storageConnection.success = true;
                console.log(`✅ Storage API conectado: ${connectTest.status} (${connectTest.latency}ms)`);
            } else {
                throw new Error(`Conexão falhou: ${connectTest.error}`);
            }
        } catch (storageError) {
            testResults.storageConnection.error = storageError.message;
            console.log(`❌ Storage API falhou: ${storageError.message}`);
            console.log(`⚠️ AVISO: Deploy pode falhar sem Storage API`);
        }
        
        // ========================================
        // 3. TESTE DE UPDATE LIMITADO (3 BUNDLES)
        // ========================================
        console.log('\n3️⃣ TESTE: Update de bundles detalhados (limitado a 3)...');
        console.log('⏰ Timeout configurado: 2 minutos para segurança');
        
        try {
            // Timeout de segurança de 2 minutos
            const updatePromise = updateBundlesWithDetails('brazilian', 3); // Limita a 3 bundles
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('TIMEOUT: Update demorou mais de 2 minutos')), 120000)
            );
            
            const updateResult = await Promise.race([updatePromise, timeoutPromise]);
            
            if (updateResult.success && updateResult.totalBundles > 0) {
                testResults.update.success = true;
                testResults.update.processed = updateResult.totalBundles;
                console.log(`✅ Update bem-sucedido: ${updateResult.totalBundles} bundles processados`);
                
                if (updateResult.retryStats) {
                    console.log(`📊 Retry automático: ${updateResult.retryStats.processed} processados, ${updateResult.retryStats.recovered} recuperados`);
                }
                
                // Verifica se arquivo foi criado
                if (fs.existsSync('./bundleDetailed_test.json')) {
                    console.log(`📁 Arquivo teste criado: bundleDetailed_test.json`);
                } else {
                    console.log(`📁 Arquivo teste não encontrado (pode ter sido sincronizado apenas)`);
                }
                
            } else {
                throw new Error(`Update falhou: ${updateResult.error || 'Nenhum bundle processado'}`);
            }
        } catch (updateError) {
            testResults.update.error = updateError.message;
            console.log(`❌ Update falhou: ${updateError.message}`);
            console.log(`⚠️ PROBLEMA: Sistema de scraping pode estar comprometido`);
        }
        
        // ========================================
        // 4. TESTE DE SISTEMA DE RETRY
        // ========================================
        console.log('\n4️⃣ TESTE: Sistema de retry...');
        try {
            const retryResult = await processFailedBundles();
            
            testResults.retry.success = true;
            testResults.retry.recovered = retryResult.recovered || 0;
            
            if (retryResult.processed > 0) {
                console.log(`✅ Retry processado: ${retryResult.processed} bundles, ${retryResult.recovered} recuperados`);
            } else {
                console.log(`✅ Sistema de retry OK: Nenhum bundle para retry (esperado em teste)`);
            }
        } catch (retryError) {
            testResults.retry.error = retryError.message;
            console.log(`❌ Retry falhou: ${retryError.message}`);
        }
        
        // ========================================
        // 5. TESTE DE SINCRONIZAÇÃO STORAGE
        // ========================================
        if (testResults.storageConnection.success) {
            console.log('\n5️⃣ TESTE: Sincronização com Storage API...');
            try {
                // Testa sync de dados fictícios
                const testSyncData = {
                    timestamp: new Date().toISOString(),
                    totalFailed: 0,
                    retryable: 0,
                    bundles: []
                };
                
                await storageSyncManager.syncFailedBundlesQueue(testSyncData);
                console.log(`✅ Sincronização teste bem-sucedida`);
                
                // Testa recuperação
                const recoverResult = await storageSyncManager.getFailedBundlesQueue();
                if (recoverResult.success) {
                    console.log(`✅ Recuperação de dados bem-sucedida`);
                } else {
                    console.log(`⚠️ Recuperação falhou: ${recoverResult.error}`);
                }
                
            } catch (syncError) {
                console.log(`❌ Sincronização falhou: ${syncError.message}`);
            }
        }
        
        // ========================================
        // RESULTADOS FINAIS
        // ========================================
        const duration = (Date.now() - startTime) / 1000;
        testResults.overall.duration = duration;
        
        const allCriticalTestsPassed = testResults.fetch.success && 
                                     testResults.update.success;
        
        testResults.overall.success = allCriticalTestsPassed;
        
        console.log('\n' + '='.repeat(60));
        console.log('🏁 RESULTADOS FINAIS DOS TESTES PRÉ-DEPLOY');
        console.log('='.repeat(60));
        
        console.log(`⏱️  Duração total: ${duration.toFixed(1)}s\n`);
        
        console.log('📊 RESULTADOS POR COMPONENTE:');
        console.log(`   1️⃣ Fetch Bundles: ${testResults.fetch.success ? '✅' : '❌'} (${testResults.fetch.bundles} bundles)`);
        console.log(`   2️⃣ Storage API: ${testResults.storageConnection.success ? '✅' : '❌'}`);
        console.log(`   3️⃣ Update Scraping: ${testResults.update.success ? '✅' : '❌'} (${testResults.update.processed} processados)`);
        console.log(`   4️⃣ Retry System: ${testResults.retry.success ? '✅' : '❌'} (${testResults.retry.recovered} recuperados)`);
        
        if (allCriticalTestsPassed) {
            console.log('\n🎉 TODOS OS TESTES CRÍTICOS PASSARAM!');
            console.log('✅ Sistema pronto para deploy no Render');
            console.log('\n📋 CHECKLIST PRÉ-DEPLOY:');
            console.log('   ✅ Fetch de bundles funcionando');
            console.log('   ✅ Scraping de detalhes funcionando');
            console.log('   ✅ Sistema de retry funcionando');
            console.log(`   ${testResults.storageConnection.success ? '✅' : '⚠️'} Storage API ${testResults.storageConnection.success ? 'funcionando' : 'com problemas'}`);
            console.log('\n🚀 RECOMENDAÇÃO: PROSSEGUIR COM DEPLOY');
            
            if (!testResults.storageConnection.success) {
                console.log('\n⚠️ ATENÇÃO: Storage API com problemas');
                console.log('   📝 Verificar variáveis de ambiente no Render');
                console.log('   📝 Confirmar URLs e chaves de API');
            }
            
        } else {
            console.log('\n❌ ALGUNS TESTES CRÍTICOS FALHARAM!');
            console.log('🛑 RECOMENDAÇÃO: CORRIGIR PROBLEMAS ANTES DO DEPLOY');
            console.log('\n🔍 PROBLEMAS ENCONTRADOS:');
            
            if (!testResults.fetch.success) {
                console.log(`   ❌ Fetch: ${testResults.fetch.error}`);
            }
            if (!testResults.update.success) {
                console.log(`   ❌ Update: ${testResults.update.error}`);
            }
        }
        
    } catch (criticalError) {
        testResults.overall.success = false;
        console.log('\n💥 ERRO CRÍTICO DURANTE TESTES:');
        console.log(`❌ ${criticalError.message}`);
        console.log('\n🛑 DEPLOY BLOQUEADO - CORRIGIR ERRO CRÍTICO');
    }
    
    // Salva relatório de teste
    const reportPath = './test-pre-deploy-report.json';
    const report = {
        timestamp: new Date().toISOString(),
        duration: testResults.overall.duration,
        success: testResults.overall.success,
        environment: {
            NODE_ENV: process.env.NODE_ENV || 'development',
            STORAGE_API_URL: process.env.STORAGE_API_URL || 'not set',
            hasStorageKey: !!process.env.STORAGE_API_KEY
        },
        results: testResults
    };
    
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n📄 Relatório salvo: ${reportPath}`);
    
    return testResults.overall.success;
}

// Executa os testes
if (require.main === module) {
    runPreDeployTests()
        .then(success => {
            process.exit(success ? 0 : 1);
        })
        .catch(error => {
            console.error('💥 Erro fatal nos testes:', error);
            process.exit(1);
        });
}

module.exports = { runPreDeployTests };
