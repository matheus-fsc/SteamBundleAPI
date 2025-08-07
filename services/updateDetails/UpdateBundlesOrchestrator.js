const { AdaptivePerformanceManager } = require('./AdaptivePerformanceManager');
const { FailedBundlesManager } = require('./FailedBundlesManager');
const { BundleScrapingService } = require('./BundleScrapingService');
const { StateManager } = require('./StateManager');
const { StorageSyncService } = require('./StorageSyncService');
const { BundleFilterService } = require('./BundleFilterService');
const { getLogger } = require('../PersistentLogger');
const { storageSyncManager } = require('../storageSync');
const axios = require('axios');

/**
 * Orquestrador Principal de Atualização de Bundles
 * Coordena todos os módulos especializados para processamento otimizado
 */

class UpdateBundlesOrchestrator {
    constructor() {
        this.performanceManager = new AdaptivePerformanceManager();
        this.scrapingService = new BundleScrapingService();
        this.stateManager = new StateManager();
        this.syncService = new StorageSyncService(storageSyncManager);
        this.failedManager = new FailedBundlesManager(storageSyncManager);
        this.filterService = new BundleFilterService(storageSyncManager);
        this.logger = getLogger();
        
        // Log apenas inicialização - sem console poluído
        this.logger.info('ORCHESTRATOR_INIT', 'Orquestrador de Bundles inicializado');
    }

    // Helper para extrair o ID da Steam a partir do link do bundle
    _extractSteamIdFromLink(link) {
        if (!link) return null;
        const match = link.match(/\/bundle\/(\d+)/);
        return match ? match[1] : null;
    }

    async updateBundlesDetailed(bundlesToProcess, limitForTesting = null, language = 'portuguese') {
        const actualStartTime = Date.now();
        
        try {
            // 🔍 FILTRAR BUNDLES JÁ PROCESSADOS (CORREÇÃO CRÍTICA)
            this.logger.progress('BUNDLE_FILTER', 'Aplicando filtro de bundles já processados');
            console.log('🛡️ [ANTI-DUPLICAÇÃO] Aplicando filtro de bundles já processados...');
            const filterResult = await this.filterService.filterUnprocessedBundles(bundlesToProcess);
            
            if (filterResult.needsProcessing === 0) {
                this.logger.critical('PROCESS_COMPLETE', 'Todos os bundles básicos já possuem detalhes', filterResult);
                console.log('✅ [CONCLUÍDO] Todos os bundles básicos já possuem detalhes!');
                return {
                    success: true,
                    totalProcessed: 0,
                    totalBasic: filterResult.totalBasic,
                    alreadyProcessed: filterResult.alreadyProcessed,
                    skipped: filterResult.alreadyProcessed,
                    message: 'Nenhum bundle precisa ser processado - todos já têm detalhes!'
                };
            }
            
            // Usar apenas bundles não processados
            const actualBundlesToProcess = filterResult.unprocessedBundles;
            this.logger.milestone('BUNDLE_OPTIMIZATION', 'Otimização aplicada', 
                actualBundlesToProcess.length, filterResult.totalBasic, {
                    skipped: filterResult.alreadyProcessed,
                    optimization_percent: ((filterResult.alreadyProcessed / filterResult.totalBasic) * 100).toFixed(1)
                }
            );
            console.log(`✅ [OTIMIZADO] Processando apenas ${actualBundlesToProcess.length} bundles (pulando ${filterResult.alreadyProcessed} já processados)`);
            
            let updateState = this.stateManager.createInitialUpdateState(actualBundlesToProcess, limitForTesting, language);
            let consecutiveFailures = 0;
            let totalBatches = Math.ceil(actualBundlesToProcess.length / this.performanceManager.currentParallel);
            let currentChunkBundles = [];

            // Configuração para diferentes ambientes
            const isProduction = process.env.NODE_ENV === 'production';
            const renderConfig = isProduction ? {
                MAX_CHUNK_SIZE: 50,           
                SYNC_INTERVAL: 25,            
                MEMORY_CHECK_INTERVAL: 10,    
                GC_INTERVAL: 20              
            } : {
                MAX_CHUNK_SIZE: 100,           
                SYNC_INTERVAL: 50,            
                MEMORY_CHECK_INTERVAL: 20,    
                GC_INTERVAL: 50              
            };

            console.log(`\n🚀 Processando de 0 até ${actualBundlesToProcess.length} (${totalBatches} lotes)`);
            console.log(`💾 MODO ${isProduction ? 'PRODUÇÃO' : 'LOCAL'}: Sync a cada ${renderConfig.SYNC_INTERVAL} bundles`);

            for (let i = 0; i < actualBundlesToProcess.length; i += this.performanceManager.currentParallel) {
                const batchIndex = Math.floor(i / this.performanceManager.currentParallel);
                const batch = actualBundlesToProcess.slice(i, i + this.performanceManager.currentParallel);
                // Log de progresso apenas no milestone (não para cada lote)
                if (batchIndex % 10 === 0 || batchIndex === totalBatches - 1) {
                    this.logger.milestone('BATCH_PROGRESS', 'Processamento em andamento', 
                        batchIndex + 1, totalBatches, { current_batch_size: batch.length });
                    console.log(`\n🚀 Lote ${batchIndex + 1}/${totalBatches}: Processando ${batch.length} bundles...`);
                }
                
                const batchResult = await this._processBatch(batch, batchIndex, language);
                currentChunkBundles.push(...batchResult.successfulBundles);
                updateState.completed += batch.length;

                // Sync frequente para liberar memória
                if (currentChunkBundles.length >= renderConfig.SYNC_INTERVAL || 
                    (i + this.performanceManager.currentParallel >= actualBundlesToProcess.length)) {
                    
                    console.log(`📤 SYNC: ${currentChunkBundles.length} bundles (liberando memória)...`);
                    
                    try {
                        // Usar método de sync padrão
                        const syncResult = await this.syncService.performAutoSync(
                            currentChunkBundles,
                            {
                                ...updateState,
                                completed: i + batch.length,
                                totalBasic: filterResult.totalBasic,
                                alreadyProcessed: filterResult.alreadyProcessed
                            },
                            actualBundlesToProcess,
                            limitForTesting
                        );
                        
                        if (syncResult.synced) {
                            console.log(`✅ SYNC: Chunk enviado com sucesso - ${currentChunkBundles.length} bundles.`);
                            
                            // Marcar bundles como processados no cache
                            const bundleIds = currentChunkBundles.map(b => b.bundle_id || b.id);
                            this.filterService.markAsProcessed(bundleIds);
                            
                            currentChunkBundles = []; // Limpar array
                        }
                        
                    } catch (syncError) {
                        console.error(`❌ ERRO SYNC: ${syncError.message}`);
                    }
                }

                // Garbage collection periódico
                if (isProduction && batchIndex % renderConfig.GC_INTERVAL === 0) {
                    if (global.gc) {
                        console.log(`🗑️  Executando garbage collection...`);
                        global.gc();
                    }
                }

                consecutiveFailures = this._handleBatchFailures(batchResult, consecutiveFailures);
                if (this.performanceManager.shouldOptimize(batchIndex)) {
                    this.performanceManager.optimizeSettings(batchIndex);
                }
                
                this._logOptimizedProgress(batchIndex, updateState, actualBundlesToProcess, batchResult.batchTime, actualStartTime, currentChunkBundles.length);
                
                if (i + this.performanceManager.currentParallel < actualBundlesToProcess.length) {
                    const baseDelay = this.performanceManager.currentDelay;
                    const extraDelay = isProduction ? 500 : 0;
                    await this._delay(baseDelay + extraDelay);
                }
            }
            
            return await this._optimizedFinalization(currentChunkBundles, actualBundlesToProcess, updateState, limitForTesting, actualStartTime, filterResult);
        } catch (error) {
            console.error('❌ ERRO FATAL no processamento:', error);
            throw error;
        }
    }

    async _processBatch(batch, batchIndex, language) {
        const batchStartTime = Date.now();
        const batchResults = await Promise.allSettled(
            batch.map(bundle => this.scrapingService.fetchBundleDetails(bundle.id, language))
        );

        const successfulBundles = [];
        const failedBundles = [];

        batchResults.forEach((result, index) => {
            if (result.status === 'fulfilled' && result.value && result.value.success) {
                successfulBundles.push(result.value.data);
            } else {
                const originalBundle = batch[index];
                let errorDetails;
                
                if (result.status === 'rejected') {
                    errorDetails = `Rejected: ${result.reason?.message || result.reason || 'Promise rejected'}`;
                } else if (result.value) {
                    errorDetails = `Failed: ${result.value.reason || result.value.error || 'Unknown failure'} (Status: ${result.value.statusCode || 'N/A'})`;
                } else {
                    errorDetails = 'No response received';
                }
                
                console.log(`❌ [ID: ${originalBundle.id} | SteamID: ${this._extractSteamIdFromLink(originalBundle.link)}] Falha: ${errorDetails}`);
                failedBundles.push({
                    ...originalBundle,
                    error: errorDetails,
                    steam_id: this._extractSteamIdFromLink(originalBundle.link)
                });
            }
        });

        const batchTime = Date.now() - batchStartTime;
        this.performanceManager.recordBatchResult(
            batchIndex, 
            successfulBundles.length, 
            batch.length, 
            batchTime,
            failedBundles.map(b => b.id)
        );

        console.log(`📊 Lote ${batchIndex + 1}: ${successfulBundles.length}/${batch.length} sucessos (${(successfulBundles.length/batch.length*100).toFixed(1)}%) em ${(batchTime/1000).toFixed(1)}s`);

        return {
            successfulBundles,
            failedBundles,
            batchTime,
            successCount: successfulBundles.length,
            totalCount: batch.length
        };
    }

    _handleBatchFailures(batchResult, consecutiveFailures) {
        if (batchResult.successCount === 0) {
            consecutiveFailures++;
            if (consecutiveFailures >= 3) {
                console.warn(`⚠️  ${consecutiveFailures} lotes consecutivos falharam completamente. Pode haver problema de conectividade.`);
            }
        } else {
            consecutiveFailures = 0;
        }
        return consecutiveFailures;
    }

    _logOptimizedProgress(batchIndex, updateState, bundlesToProcess, batchTime, actualStartTime, chunkSize) {
        const elapsed = (Date.now() - actualStartTime) / 1000;
        const avgTimePerBundle = elapsed / updateState.completed;
        const remaining = bundlesToProcess.length - updateState.completed;
        const eta = remaining * avgTimePerBundle;
        
        console.log(`💾 Memória: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB heap usado | Chunk: ${chunkSize} bundles`);
        console.log(`📈 Progresso: ${updateState.completed}/${bundlesToProcess.length} (${(updateState.completed/bundlesToProcess.length*100).toFixed(1)}%) | Tempo: ${elapsed.toFixed(1)}s | ETA: ${eta.toFixed(1)}s | Chunk: ${chunkSize}\n`);
    }

    async _optimizedFinalization(currentChunkBundles, actualBundlesToProcess, updateState, limitForTesting, actualStartTime, filterResult) {
        console.log('\n🏁 FINALIZANDO PROCESSAMENTO...');
        
        if (currentChunkBundles.length > 0) {
            console.log(`📤 FINALIZANDO: Enviando últimos ${currentChunkBundles.length} bundles...`);
            try {
                const finalSyncResult = await this.syncService.performAutoSync(
                    currentChunkBundles,
                    updateState,
                    actualBundlesToProcess,
                    limitForTesting
                );
                
                if (finalSyncResult.synced) {
                    console.log(`✅ SYNC FINAL: ${currentChunkBundles.length} bundles enviados com sucesso.`);
                }
            } catch (error) {
                console.error('❌ ERRO no sync final:', error.message);
            }
        }

        await this.syncService.finishDetailedSyncSession(updateState.sessionId);

        const finalConfig = this.performanceManager.getCurrentConfig();
        console.log(`\n🎯 PROCESSAMENTO CONCLUÍDO!`);
        console.log(`   ⏱️  Tempo total: ${((Date.now() - actualStartTime) / 1000 / 60).toFixed(1)} minutos`);
        console.log(`   📊 Processados: ${updateState.completed}/${actualBundlesToProcess.length} bundles (apenas não processados)`);
        console.log(`   🛡️ Bundles básicos totais: ${filterResult.totalBasic} (${filterResult.alreadyProcessed} já processados, ${actualBundlesToProcess.length} novos)`);
        console.log(`   🧠 Config final adaptativa: ${finalConfig.delay}ms delay, ${finalConfig.parallel} parallel`);
        
        if (finalConfig.bestConfig) {
            console.log(`   🏆 Melhor configuração encontrada: ${finalConfig.bestConfig.delay}ms, ${finalConfig.bestConfig.parallel} parallel (lote ${finalConfig.bestConfig.batchIndex})`);
        }

        const failedReport = this.performanceManager.getFailedBundlesReport();
        if (failedReport.count > 0) {
            console.log(`   ❌ Bundles problemáticos: ${failedReport.count} únicos`);
        }

        console.log(`✅ Sessão ${updateState.sessionId} finalizada com sucesso!`);

        // Aguardar um pouco para que a API processe a transferência para a tabela bundles
        console.log('⏳ Aguardando processamento da transferência para tabela bundles (10s)...');
        await this._delay(10000);

        // Atualizar status admin com retry
        const adminUrl = `${process.env.STORAGE_API_URL}/api/admin`;
        
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                await axios.post(adminUrl, {
                    data_type: 'bundlesDetailed',
                    is_complete: true,
                    total_records: filterResult.totalBasic || updateState.completed || 0,
                    last_session_id: updateState.sessionId,
                    attempt: attempt
                }, {
                    headers: {
                        'x-api-key': process.env.STORAGE_API_KEY || '',
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000 // 30s timeout
                });
                
                console.log(`✅ sync_status atualizado na API admin (bundlesDetailed) - Tentativa ${attempt}`);
                break; // Sucesso, sai do loop
                
            } catch (err) {
                console.warn(`⚠️ Falha na tentativa ${attempt}/3 ao atualizar sync_status:`, err.message);
                
                if (attempt < 3) {
                    console.log(`⏳ Aguardando 8s antes da próxima tentativa...`);
                    await this._delay(8000);
                } else {
                    console.error('❌ Todas as tentativas falharam ao atualizar sync_status (continuando mesmo assim)');
                }
            }
        }

        return { 
            completed: updateState.completed, 
            sessionId: updateState.sessionId,
            finalConfig: finalConfig
        };
    }

    async _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async processFailedBundles(existingDetailedBundles = []) {
        console.log('🔄 Processando bundles que falharam anteriormente...');
        
        const failedBundles = await this.failedManager.getFailedBundles();
        if (failedBundles.length === 0) {
            console.log('✅ Nenhum bundle falho encontrado para reprocessar.');
            return { processed: 0, successful: 0 };
        }

        console.log(`📋 Encontrados ${failedBundles.length} bundles falhos para reprocessar`);
        return await this.updateBundlesDetailed(failedBundles, null, 'pt');
    }
}

module.exports = UpdateBundlesOrchestrator;
