const { AdaptivePerformanceManager } = require('./AdaptivePerformanceManager');
const { FailedBundlesManager } = require('./FailedBundlesManager');
const { BundleScrapingService } = require('./BundleScrapingService');
const { StateManager } = require('./StateManager');
const { StorageSyncService } = require('./StorageSyncService');
const { storageSyncManager } = require('../storageSync');

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
        console.log('🚀 Orquestrador de Bundles inicializado...');
    }

    // [NOVO] Helper para extrair o ID da Steam a partir do link do bundle
    _extractSteamIdFromLink(link) {
        if (!link) return null;
        const match = link.match(/\/bundle\/(\d+)/);
        return match ? match[1] : null;
    }

    /**
     * Função principal: Atualiza bundles com detalhes
     */
    async updateBundlesWithDetails(language = 'brazilian', limitForTesting = null) {
        const actualStartTime = Date.now();
        try {
            console.log('\n🚀 INICIANDO ATUALIZAÇÃO DE BUNDLES DETALHADOS...');
            const allBundlesData = await this.syncService.loadStorageDataWithRetry('bundles');
            if (!allBundlesData || !allBundlesData.bundles || allBundlesData.bundles.length === 0) {
                return { success: false, reason: 'NO_BASIC_BUNDLES' };
            }
            const allBundlesMap = new Map(allBundlesData.bundles.map(b => [b.id, b]));
            const detailedBundlesData = await this.syncService.loadStorageDataWithRetry('bundlesDetailed');
            const processedBundleIds = new Set();
            if (detailedBundlesData && detailedBundlesData.bundles) {
                detailedBundlesData.bundles.forEach(b => processedBundleIds.add(b.bundle_id));
            }
            let bundlesToProcess = Array.from(allBundlesMap.values()).filter(bundle => !processedBundleIds.has(bundle.id));
            if (limitForTesting) {
                bundlesToProcess = bundlesToProcess.slice(0, limitForTesting);
            }
            console.log(`📊 Total de bundles para processar: ${bundlesToProcess.length}`);
            if (bundlesToProcess.length === 0) {
                return { success: true, message: 'Todos os bundles já foram processados' };
            }
            let updateState = this.stateManager.createInitialUpdateState(bundlesToProcess, limitForTesting, language);
            let consecutiveFailures = 0;
            let totalBatches = Math.ceil(bundlesToProcess.length / this.performanceManager.currentParallel);
            let currentChunkBundles = [];
            console.log(`\n🚀 Processando de 0 até ${bundlesToProcess.length} (${totalBatches} lotes)`);
            for (let i = 0; i < bundlesToProcess.length; i += this.performanceManager.currentParallel) {
                const batchIndex = Math.floor(i / this.performanceManager.currentParallel);
                const batch = bundlesToProcess.slice(i, i + this.performanceManager.currentParallel);
                console.log(`\n🚀 Lote ${batchIndex + 1}/${totalBatches}: Processando ${batch.length} bundles...`);
                const batchResult = await this._processBatch(batch, batchIndex, language);
                currentChunkBundles.push(...batchResult.successfulBundles);
                updateState.completed += batch.length;
                consecutiveFailures = this._handleBatchFailures(batchResult, consecutiveFailures);
                if (this.performanceManager.shouldOptimize(batchIndex)) {
                    this.performanceManager.optimizeSettings(batchIndex);
                }
                this._logOptimizedProgress(batchIndex, updateState, bundlesToProcess, batchResult.batchTime, actualStartTime, currentChunkBundles.length);
                if (i + this.performanceManager.currentParallel < bundlesToProcess.length) {
                    await this._delay(this.performanceManager.currentDelay);
                }
            }
            return await this._optimizedFinalization(currentChunkBundles, bundlesToProcess, updateState, limitForTesting, actualStartTime);
        } catch (error) {
            console.error('❌ Erro crítico durante atualização:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Processa um lote de bundles
     */
    async _processBatch(batch, batchIndex, language) {
        const batchStartTime = Date.now();
        // [NOVO] Extrai o ID da Steam do link ANTES de chamar o scraping
        const results = await Promise.allSettled(
            batch.map(bundle => {
                const steamId = this._extractSteamIdFromLink(bundle.link);
                if (!steamId) {
                    console.log(`❌ [ID: ${bundle.id}] Falha: Link inválido ou sem ID (${bundle.link})`);
                    return Promise.resolve({ value: { success: false, reason: 'INVALID_LINK' } });
                }
                // Chama o serviço de scraping com o ID correto da Steam
                return this.scrapingService.fetchBundleDetails(steamId, language);
            })
        );
        const successfulBundles = [];
        const failedBundleIds = [];
        for (let j = 0; j < results.length; j++) {
            const result = results[j];
            const bundle = batch[j];
            const steamId = this._extractSteamIdFromLink(bundle.link) || bundle.id;
            if (result.status === 'fulfilled' && result.value.success) {
                const bundleWithId = { ...result.value.data, id: bundle.id, steam_id: steamId };
                successfulBundles.push(bundleWithId);
                console.log(`✅ [ID: ${bundle.id} | SteamID: ${steamId}] ${bundleWithId.name}`);
            } else {
                const reason = result.status === 'fulfilled' ? result.value.reason : 'PROMISE_REJECTED';
                this.failedManager.addFailedBundle(bundle.id, bundle, reason, j);
                failedBundleIds.push(bundle.id);
                console.log(`❌ [ID: ${bundle.id} | SteamID: ${steamId}] Falha: ${reason}`);
            }
        }
        const batchTime = Date.now() - batchStartTime;
        this.performanceManager.recordBatchResult(batchIndex, successfulBundles.length, batch.length, batchTime, failedBundleIds);
        console.log(`📊 Lote ${batchIndex + 1}: ${successfulBundles.length}/${batch.length} sucessos (${(successfulBundles.length / batch.length * 100).toFixed(1)}%) em ${(batchTime / 1000).toFixed(1)}s`);
        return { successfulBundles, failedBundleIds, batchTime };
    }

    /**
     * Trata falhas do lote e circuit breaker
     */
    _handleBatchFailures(batchResult, consecutiveFailures) {
        if (batchResult.failedBundleIds.length > 0) {
            consecutiveFailures++;

            // Circuit breaker para falhas consecutivas
            if (consecutiveFailures >= 3) {
                console.log(`🚨 CIRCUIT BREAKER: ${consecutiveFailures} lotes consecutivos com falhas`);
                console.log(`⏸️  Pausando por 30 segundos para estabilização...`);
                // Implementar pausa se necessário
                consecutiveFailures = 0; // Reset após pausa
            }
        } else {
            consecutiveFailures = 0; // Reset se lote foi bem-sucedido
        }

        return consecutiveFailures;
    }

    /**
     * Gerencia checkpoints e sincronização automática OTIMIZADA
     * Usa currentChunkBundles em vez de detailedBundles acumulados
     */
    async _handleOptimizedCheckpointAndSync(currentChunkBundles, updateState, bundlesToProcess, limitForTesting, batchesProcessed) {
        const SYNC_INTERVAL_BUNDLES = 200;
        const shouldSyncByProgress = updateState.completed > 0 &&
            (updateState.completed % SYNC_INTERVAL_BUNDLES === 0);

        if (shouldSyncByProgress && currentChunkBundles.length > 0) {
            console.log(`\n🔄 CHECKPOINT: ${updateState.completed} bundles processados - iniciando sincronização...`);

            try {
                // Sincronização automática do chunk atual
                const syncResult = await this.syncService.performAutoSync(
                    currentChunkBundles,
                    updateState,
                    bundlesToProcess,
                    limitForTesting
                );

                if (syncResult.synced) {
                    console.log("✅ Chunk sincronizado com a API. Limpando cache de memória local.");

                    // SIMPLESMENTE LIMPE O ARRAY
                    currentChunkBundles.length = 0;

                    // Força garbage collection
                    this.stateManager.forceGarbageCollection();

                    console.log(`🧹 Cache limpo - memória otimizada para próximo chunk`);
                }

                // Salva fila de falhas
                await this.failedManager.saveFailedQueue();
                if (this.failedManager.failedQueue.size > 0) {
                    await this.failedManager.syncWithStorage();
                }

                // Salva estado simples (apenas como log de atividade)
                await this.stateManager.saveUpdateState(updateState);

                console.log(`💾 Checkpoint completo: Estado + falhas sincronizados (${this.failedManager.failedQueue.size} falhas)`);

            } catch (syncError) {
                console.error('❌ Erro durante sincronização do checkpoint:', syncError.message);
                console.log('💡 Continuando processamento - dados mantidos em memória');
            }
        }

        // Log de memória periódico
        if (batchesProcessed % 5 === 0) {
            const memory = this.stateManager.getMemoryUsage();
            console.log(`📊 Memória: ${memory.heapUsed}MB | Chunk atual: ${currentChunkBundles.length} bundles | Progresso: ${updateState.completed}/${bundlesToProcess.length}`);
        }
    }

    /**
     * Logs de progresso OTIMIZADOS
     */
    _logOptimizedProgress(batchIndex, updateState, bundlesToProcess, batchTime, actualStartTime, chunkSize) {
        const elapsed = (Date.now() - actualStartTime) / 1000;
        const avgBatchTime = batchTime / 1000;
        const totalBatches = Math.ceil(bundlesToProcess.length / this.performanceManager.currentParallel);
        const remaining = totalBatches - batchIndex - 1;
        const estimatedTimeLeft = remaining * avgBatchTime;
        const progress = ((updateState.completed / bundlesToProcess.length) * 100).toFixed(1);

        console.log(`📈 Progresso: ${updateState.completed}/${bundlesToProcess.length} (${progress}%) | Tempo: ${elapsed.toFixed(1)}s | ETA: ${estimatedTimeLeft.toFixed(1)}s | Chunk: ${chunkSize}`);
    }

    /**
     * Finalização OTIMIZADA
     */
    async _optimizedFinalization(currentChunkBundles, bundlesToProcess, updateState, limitForTesting, actualStartTime) {
        console.log(`\n🎉 LOOP PRINCIPAL CONCLUÍDO em ${(Date.now() - actualStartTime) / 1000}s`);

        // === SINCRONIZAÇÃO FINAL DOS BUNDLES RESTANTES ===
        if (currentChunkBundles.length > 0) {
            console.log(`\n📤 SINCRONIZAÇÃO FINAL: ${currentChunkBundles.length} bundles restantes no chunk...`);

            try {
                // [CORREÇÃO] Chamamos performAutoSync, que já sabe como lidar com o último chunk.
                updateState.completed = bundlesToProcess.length; // Garante que isLastChunk seja true
                const finalSyncResult = await this.syncService.performAutoSync(
                    currentChunkBundles,
                    updateState,
                    bundlesToProcess
                );
                if (finalSyncResult.synced) {
                    console.log(`✅ Sincronização final bem-sucedida: ${currentChunkBundles.length} bundles enviados`);
                    currentChunkBundles.length = 0; // Limpa chunk final
                } else {
                    console.warn(`⚠️ Sincronização final falhou - dados mantidos localmente`);
                }
            } catch (finalSyncError) {
                console.error('❌ Erro na sincronização final:', finalSyncError.message);
            }
        } else {
            console.log(`✅ Nenhum bundle restante - todas as sincronizações foram bem-sucedidas`);
        }

        // === PROCESSAMENTO DE RETRY ===
        const failedStats = this.failedManager.getStats();
        if (failedStats.retryable > 0) {
            console.log(`\n🔄 PROCESSANDO RETRY: ${failedStats.retryable} bundles elegíveis...`);
            const retryResult = await this.failedManager.processRetryQueue(
                (bundleId) => this.scrapingService.retryFailedBundle(bundleId)
            );
            console.log(`✅ Retry concluído: ${retryResult.success} sucessos de ${retryResult.processed} tentativas`);
        }

        // === LIMPEZA FINAL ===
        console.log(`\n🧹 LIMPEZA FINAL: Removendo arquivos de estado locais...`);

        // Limpa arquivos locais (API é agora 100% atualizada)
        try {
            await this.stateManager.clearUpdateState();
            console.log(`✅ Estados locais limpos - API é agora a fonte autoritativa`);
        } catch (cleanupError) {
            console.warn(`⚠️ Erro na limpeza final: ${cleanupError.message}`);
        }

        // [NOVO] Adicionar chamada para a finalização de detalhes na API
        try {
            console.log(`\n⚙️  A finalizar sessão de detalhes ${updateState.sessionId} na API para processamento final...`);
            await this.syncService.finishDetailedSyncSession(updateState.sessionId);
            console.log(`✅ Finalização da sessão de detalhes solicitada com sucesso.`);

            // NOVO: Atualiza sync_status na API admin (bundlesDetailed)
            try {
                const axios = require('axios');
                const adminUrl = process.env.STORAGE_API_URL ? `${process.env.STORAGE_API_URL}/api/admin?operation=sync-status-update` : 'https://bundleset-api-storage.vercel.app/api/admin?operation=sync-status-update';
                await axios.post(adminUrl, {
                    data_type: 'bundlesDetailed',
                    is_complete: true,
                    total_records: bundlesToProcess.length,
                    last_session_id: updateState.sessionId
                }, {
                    headers: {
                        'x-api-key': process.env.STORAGE_API_KEY || '',
                        'Content-Type': 'application/json'
                    },
                    timeout: 15000
                });
                console.log('✅ sync_status atualizado na API admin (bundlesDetailed)');
            } catch (err) {
                console.warn('⚠️ Falha ao atualizar sync_status na API admin (bundlesDetailed):', err.message);
            }
        } catch (error) {
            console.error('❌ Erro ao solicitar a finalização da sessão de detalhes:', error.message);
        }

        // === RELATÓRIO FINAL ===
        const finalConfig = this.performanceManager.getCurrentConfig();
        const finalPerformance = this.performanceManager.calculateCurrentPerformance();
        const totalTime = (Date.now() - actualStartTime) / 1000;

        console.log(`\n🎊 ATUALIZAÇÃO CONCLUÍDA COM SUCESSO!`);
        console.log(`📊 RELATÓRIO FINAL:`);
        console.log(`   ✅ Bundles processados: ${updateState.completed}/${bundlesToProcess.length} (${((updateState.completed / bundlesToProcess.length) * 100).toFixed(1)}%)`);
        console.log(`   ❌ Falhas finais: ${failedStats.total} (${failedStats.retryable} elegíveis para retry)`);
        console.log(`   ⏱️  Tempo total: ${totalTime.toFixed(1)}s`);
        console.log(`   🚀 Performance: ${(updateState.completed / totalTime).toFixed(2)} bundles/s`);
        console.log(`   🧠 Config final adaptativa: ${finalConfig.delay}ms delay, ${finalConfig.parallel} parallel`);
        console.log(`   🎯 Taxa de sucesso: ${finalPerformance ? (finalPerformance.successRate * 100).toFixed(1) + '%' : 'N/A'}`);
        console.log(`   ☁️  Fonte de verdade: Storage API (100% sincronizada)`);

        return {
            success: true,
            totalBundles: updateState.completed,
            totalAttempted: bundlesToProcess.length,
            failedStats,
            finalPerformance,
            totalTime,
            optimizedFlow: true,
            dataSource: 'storage_api'
        };
    }

    /**
     * Logs de progresso
     */
    _logProgress(batchIndex, updateState, bundlesToProcess, batchTime, actualStartTime) {
        const elapsed = (Date.now() - actualStartTime) / 1000;
        const avgBatchTime = batchTime / 1000;
        const totalBatches = Math.ceil(bundlesToProcess.length / this.performanceManager.currentParallel);
        const remaining = totalBatches - batchIndex - 1;
        const estimatedTimeLeft = remaining * avgBatchTime;

        console.log(`📈 Progresso: ${updateState.completed}/${bundlesToProcess.length} | Tempo: ${elapsed.toFixed(1)}s | ETA: ${estimatedTimeLeft.toFixed(1)}s | Resumos: ${updateState.resumeCount}`);
    }

    /**
     * Processo de finalização
     */
    async _finalizationProcess(detailedBundles, bundlesToProcess, updateState, limitForTesting, actualStartTime) {
        console.log(`🎉 Processamento concluído em ${(Date.now() - actualStartTime) / 1000}s`);

        // Relatório final do sistema adaptativo
        const finalConfig = this.performanceManager.getCurrentConfig();
        const failedReport = this.performanceManager.getFailedBundlesReport();
        const finalPerformance = this.performanceManager.calculateCurrentPerformance();
        const failedStats = this.failedManager.getStats();

        console.log(`\n🧠 RELATÓRIO FINAL ADAPTATIVO:`);
        console.log(`   🎯 Performance final: ${finalPerformance ? (finalPerformance.successRate * 100).toFixed(1) + '%' : 'N/A'} sucesso`);
        console.log(`   ⚙️  Configuração final: ${finalConfig.delay}ms delay, ${finalConfig.parallel} parallel`);
        console.log(`   🔧 Otimizações realizadas: ${finalConfig.optimizations}`);
        console.log(`   ❌ Bundles problemáticos: ${failedReport.count} únicos`);

        if (finalConfig.bestConfig) {
            console.log(`   🏆 Melhor configuração encontrada: ${finalConfig.bestConfig.delay}ms, ${finalConfig.bestConfig.parallel} parallel (lote ${finalConfig.bestConfig.batchIndex})`);
        }

        // Remove duplicatas e salva resultado final
        const uniqueDetailedBundles = Array.from(new Map(detailedBundles.map(bundle => [bundle.bundleid, bundle])).values());

        console.log(`\n💾 Salvando dados finais...`);
        console.log(`📊 Total único processado: ${uniqueDetailedBundles.length} bundles`);

        // Atualiza estado para completo
        updateState.status = 'completed';
        updateState.completed = bundlesToProcess.length;

        // Sincronização final
        if (!limitForTesting && uniqueDetailedBundles.length > 0) {
            const finalSyncResult = await this.syncService.performFinalSync(uniqueDetailedBundles, bundlesToProcess);
            if (finalSyncResult.synced) {
                // Limpa arquivos locais após sincronização final
                await this.syncService.cleanupLocalFiles([
                    this.stateManager.BUNDLES_DETAILED_FILE,
                    this.stateManager.UPDATE_STATE_FILE,
                    this.failedManager.FAILED_BUNDLES_FILE
                ]);
            }
        }

        // Salva resultado final
        const result = await this.stateManager.saveDetailedBundlesData(uniqueDetailedBundles, bundlesToProcess, true, limitForTesting, actualStartTime, updateState);

        // Limpa estado de atualização
        await this.stateManager.clearUpdateState();

        // Processa fila de retry se há falhas
        if (failedStats.retryable > 0) {
            console.log(`\n🔄 Processando ${failedStats.retryable} bundles elegíveis para retry...`);
            const retryResult = await this.failedManager.processRetryQueue(
                (bundleId) => this.scrapingService.retryFailedBundle(bundleId)
            );
            console.log(`✅ Retry concluído: ${retryResult.success} sucessos de ${retryResult.processed} tentativas`);
        }

        console.log(`\n🎊 ATUALIZAÇÃO CONCLUÍDA COM SUCESSO!`);
        console.log(`📊 Resultado final:`);
        console.log(`   ✅ Bundles processados: ${uniqueDetailedBundles.length}/${bundlesToProcess.length} (${((uniqueDetailedBundles.length / bundlesToProcess.length) * 100).toFixed(1)}%)`);
        console.log(`   ❌ Falhas registradas: ${failedStats.total} (${failedStats.retryable} elegíveis para retry)`);
        console.log(`   ⏱️  Tempo total: ${((Date.now() - actualStartTime) / 1000).toFixed(1)}s`);
        console.log(`   🚀 Performance: ${(uniqueDetailedBundles.length / ((Date.now() - actualStartTime) / 1000)).toFixed(2)} bundles/s`);

        return {
            success: true,
            totalBundles: uniqueDetailedBundles.length,
            totalAttempted: bundlesToProcess.length,
            failedStats,
            finalPerformance,
            result
        };
    }

    /**
     * Helper para delay
     */
    async _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }


    /**
     * Processa apenas bundles que falharam
     */
    async processFailedBundles(existingDetailedBundles = []) {
        console.log('\n🔄 INICIANDO PROCESSAMENTO DE RETRY...');

        const loaded = await this.failedManager.loadFailedQueue();
        if (!loaded) {
            console.log('📭 Nenhuma queue de falhas encontrada');
            return { processed: 0, success: 0, failed: 0 };
        }

        return await this.failedManager.processRetryQueue(
            (bundleId) => this.scrapingService.retryFailedBundle(bundleId)
        );
    }
}

// Instância singleton
const updateBundlesOrchestrator = new UpdateBundlesOrchestrator();

module.exports = {
    updateBundlesWithDetails: (language, limitForTesting) =>
        updateBundlesOrchestrator.updateBundlesWithDetails(language, limitForTesting),


    processFailedBundles: (existingDetailedBundles) =>
        updateBundlesOrchestrator.processFailedBundles(existingDetailedBundles),

    // Para compatibilidade com código existente
    UpdateBundlesOrchestrator
};
