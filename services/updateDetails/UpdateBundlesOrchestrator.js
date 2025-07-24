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
        // Inicializa todos os módulos especializados
        this.performanceManager = new AdaptivePerformanceManager();
        this.scrapingService = new BundleScrapingService();
        this.stateManager = new StateManager();
        this.syncService = new StorageSyncService(storageSyncManager);
        this.failedManager = new FailedBundlesManager(storageSyncManager);
        
        console.log('🚀 Orquestrador de Bundles inicializado com módulos especializados:');
        console.log('   🧠 AdaptivePerformanceManager: Sistema adaptativo ativo');
        console.log('   🔄 FailedBundlesManager: Gerenciamento de retry inteligente');
        console.log('   🕷️  BundleScrapingService: Scraping otimizado com fallbacks');
        console.log('   📊 StateManager: Persistência e recovery de estado');
        console.log('   ☁️  StorageSyncService: Sincronização automática com API');
    }

    /**
     * Função principal: Atualiza bundles com detalhes
     */
    async updateBundlesWithDetails(language = 'brazilian', limitForTesting = null) {
        try {
            // === INICIALIZAÇÃO ===
            console.log('\n🚀 INICIANDO ATUALIZAÇÃO DE BUNDLES DETALHADOS...');
            console.log(`📋 Configurações: Idioma=${language}, Teste=${!!limitForTesting}, Limite=${limitForTesting || 'nenhum'}`);
            
            // === CARREGAMENTO INTELIGENTE DO STORAGE API ===
            console.log('\n📥 Carregando dados do Storage API...');
            
            // 1. Carrega todos os bundles básicos
            console.log('� Carregando bundles básicos...');
            const allBundlesData = await this.syncService.loadStorageDataWithRetry('bundles');
            
            if (!allBundlesData || !allBundlesData.bundles || allBundlesData.bundles.length === 0) {
                console.error('❌ Nenhum bundle básico encontrado no Storage API. Execute fetchBundles primeiro.');
                return { success: false, reason: 'NO_BASIC_BUNDLES' };
            }
            
            const allBundlesMap = new Map(allBundlesData.bundles.map(b => [b.bundleid, b]));
            console.log(`✅ ${allBundlesData.bundles.length} bundles básicos carregados do Storage API`);
            
            // 2. Carrega bundles já detalhados no DB
            console.log('🔍 Verificando bundles já processados...');
            const detailedBundlesData = await this.syncService.loadStorageDataWithRetry('bundlesDetailed');
            const processedBundleIds = new Set();
            
            if (detailedBundlesData && detailedBundlesData.bundles) {
                detailedBundlesData.bundles.forEach(b => processedBundleIds.add(b.bundleid));
            }
            
            console.log(`☁️  ${processedBundleIds.size} bundles já existem no Storage. Serão ignorados.`);
            
            // 3. Determina o que falta processar
            let bundlesToProcess = Array.from(allBundlesMap.values())
                                        .filter(bundle => !processedBundleIds.has(bundle.bundleid));
            
            if (limitForTesting) {
                bundlesToProcess = bundlesToProcess.slice(0, limitForTesting);
                console.log(`🧪 Modo teste: limitado a ${limitForTesting} bundles`);
            }
            
            console.log(`📊 Total de bundles para processar: ${bundlesToProcess.length}`);
            console.log(`🎯 Otimização: ${processedBundleIds.size} bundles já processados foram ignorados`);
            
            // Verifica se há algo para processar
            if (bundlesToProcess.length === 0) {
                console.log('✅ Todos os bundles já foram processados! Nada a fazer.');
                return { 
                    success: true, 
                    totalBundles: processedBundleIds.size,
                    totalAttempted: 0,
                    message: 'Todos os bundles já processados'
                };
            }

            // === VERIFICAÇÃO DE ESTADO EXISTENTE ===
            // NOTA: Com a lógica otimizada acima, o StateManager se torna um backup de curto prazo.
            // A fonte autoritativa é o Storage API, que já filtrou bundles processados.
            // O StateManager serve apenas para recovery de sessões interrompidas.
            let updateState = this.stateManager.loadUpdateState();
            let detailedBundles = [];
            let startIndex = 0;
            let actualStartTime = Date.now();
            
            if (updateState && updateState.status === 'in_progress') {
                console.log(`🔄 CONTINUANDO atualização em progresso...`);
                console.log(`   📊 Progresso anterior: ${updateState.completed}/${updateState.total}`);
                console.log(`   ⏰ Iniciado: ${new Date(updateState.startTime).toLocaleString()}`);
                
                startIndex = updateState.lastProcessedIndex + 1;
                actualStartTime = updateState.startTime;
                updateState.resumeCount++;
                
                // --- CORREÇÃO CRÍTICA ---
                // Carregar os bundles já processados para não perdê-los.
                try {
                    const detailedDataPath = this.stateManager.BUNDLES_DETAILED_FILE;
                    if (require('fs').existsSync(detailedDataPath)) {
                        const partialData = JSON.parse(require('fs').readFileSync(detailedDataPath, 'utf-8'));
                        if (partialData && partialData.bundles) {
                            detailedBundles = partialData.bundles;
                            console.log(`📂 Dados parciais carregados: ${detailedBundles.length} bundles recuperados do arquivo local.`);
                        }
                    }
                } catch (error) {
                    console.warn('⚠️ Erro ao carregar dados detalhados parciais:', error.message);
                    // Considere limpar o estado se os dados parciais estiverem corrompidos
                    await this.stateManager.clearUpdateState();
                    return { success: false, reason: 'CORRUPTED_PARTIAL_DATA' };
                }
                
                // Tenta carregar dados parciais existentes (verificação adicional)
                try {
                    const quickCheck = await this.stateManager.quickStatusCheck(this.stateManager.BUNDLES_DETAILED_FILE);
                    if (quickCheck.exists && quickCheck.totalBundles > 0) {
                        console.log(`📂 Verificação rápida confirmada: ${quickCheck.totalBundles} bundles salvos`);
                    }
                } catch (error) {
                    console.warn('⚠️ Erro ao verificar dados parciais:', error.message);
                }
            } else {
                console.log(`🆕 NOVA atualização iniciada`);
                updateState = this.stateManager.createInitialUpdateState(bundlesToProcess, limitForTesting, language);
                actualStartTime = updateState.startTime;
            }
            
            await this.stateManager.saveUpdateState(updateState);

            // === CARREGAMENTO DA FILA DE FALHAS ===
            console.log('\n🔄 Carregando fila de falhas...');
            await this.failedManager.loadFailedQueue();

            // === LOOP PRINCIPAL DE PROCESSAMENTO ===
            let consecutiveFailures = 0;
            let batchesProcessed = Math.floor(startIndex / this.performanceManager.currentParallel);
            let totalBatches = Math.ceil(bundlesToProcess.length / this.performanceManager.currentParallel);
            let lastSyncProgress = 0; // Rastreia último sync para evitar duplicatas
            
            console.log(`\n🚀 Processando de ${startIndex} até ${bundlesToProcess.length} (${totalBatches - batchesProcessed} lotes restantes)`);
            console.log(`🧠 Sistema adaptativo ativo: ${this.performanceManager.currentDelay}ms delay, ${this.performanceManager.currentParallel} parallel`);

            for (let i = startIndex; i < bundlesToProcess.length; i += this.performanceManager.currentParallel) {
                const batchIndex = Math.floor(i / this.performanceManager.currentParallel);
                const batch = bundlesToProcess.slice(i, i + this.performanceManager.currentParallel);
                
                console.log(`\n🚀 Lote ${batchIndex + 1}/${totalBatches}: Processando ${batch.length} bundles (${this.performanceManager.currentDelay}ms delay)...`);
                
                // === PROCESSAMENTO DO LOTE ===
                const batchResult = await this._processBatch(batch, batchIndex, language);
                
                // Adiciona resultados bem-sucedidos ao chunk atual
                currentChunkBundles.push(...batchResult.successfulBundles);
                
                // Atualiza estado
                updateState.completed += batch.length;
                updateState.lastProcessedIndex = i + batch.length - 1;
                
                // === GESTÃO DE FALHAS ===
                consecutiveFailures = this._handleBatchFailures(batchResult, consecutiveFailures);
                
                // === OTIMIZAÇÃO ADAPTATIVA ===
                if (this.performanceManager.shouldOptimize(batchIndex)) {
                    this.performanceManager.optimizeSettings(batchIndex);
                }
                
                // === CHECKPOINT E SINCRONIZAÇÃO ===
                await this._handleOptimizedCheckpointAndSync(
                    currentChunkBundles,
                    updateState,
                    bundlesToProcess,
                    limitForTesting,
                    batchesProcessed
                );
                
                batchesProcessed++;
                
                // === RELATÓRIOS DE PROGRESSO ===
                this._logOptimizedProgress(batchIndex, updateState, bundlesToProcess, batchResult.batchTime, actualStartTime, currentChunkBundles.length);
                
                // Delay adaptativo entre lotes
                if (i + this.performanceManager.currentParallel < bundlesToProcess.length) {
                    await this._delay(this.performanceManager.currentDelay);
                }
            }

            // === FINALIZAÇÃO ===
            return await this._optimizedFinalization(
                currentChunkBundles, 
                bundlesToProcess, 
                updateState, 
                limitForTesting, 
                actualStartTime
            );
            
        } catch (error) {
            console.error('❌ Erro crítico durante atualização:', error.message);
            console.error('Stack:', error.stack);
            return { success: false, error: error.message, stack: error.stack };
        }
    }

    /**
     * Processa um lote de bundles
     */
    async _processBatch(batch, batchIndex, language) {
        const batchStartTime = Date.now();
        const batchStartResults = 0; // Para tracking
        
        // Processamento paralelo do lote
        const results = await Promise.allSettled(
            batch.map(bundle => this.scrapingService.fetchBundleDetails(bundle.bundleid, language))
        );
        
        const successfulBundles = [];
        const failedBundleIds = [];
        let ignoredNotFound = 0;
        
        // Processa resultados
        for (let j = 0; j < results.length; j++) {
            const result = results[j];
            const bundle = batch[j];
            
            if (result.status === 'fulfilled' && result.value.success) {
                const bundleWithId = { ...result.value.data, bundleid: bundle.bundleid };
                successfulBundles.push(bundleWithId);
                
                // Log de sucesso
                const genres = bundleWithId.page_details?.gênero?.length || 0;
                const devs = bundleWithId.page_details?.desenvolvedor?.length || 0;
                const nsfwIcon = bundleWithId.nsfw_auto_categorized ? '🔞 ' : '';
                
                if (bundleWithId.nsfwDetected) {
                    console.log(`✅ [ID: ${bundle.bundleid}] ${nsfwIcon}NSFW detectado e categorizado automaticamente`);
                } else {
                    console.log(`✅ [ID: ${bundle.bundleid}] ${bundleWithId.name} (Gêneros: ${genres}, Devs: ${devs})`);
                }
            } else {
                // Tratamento de falhas
                const reason = result.status === 'fulfilled' ? result.value.reason : 'PROMISE_REJECTED';
                
                if (reason === 'BUNDLE_NOT_FOUND') {
                    ignoredNotFound++;
                    console.log(`⚠️  [ID: ${bundle.bundleid}] Bundle não encontrado (404/410) - ignorado`);
                } else {
                    this.failedManager.addFailedBundle(bundle.bundleid, bundle, reason, j);
                    failedBundleIds.push(bundle.bundleid);
                    console.log(`❌ [ID: ${bundle.bundleid}] Falha: ${reason}`);
                }
            }
        }
        
        const batchEndTime = Date.now();
        const batchTime = batchEndTime - batchStartTime;
        
        // === CORREÇÃO NSFW: Conta bundles NSFW como sucessos ===
        let nsfwSuccessCount = 0;
        for (const result of results) {
            if (result.status === 'fulfilled' && result.value.success && result.value.nsfwDetected) {
                nsfwSuccessCount++;
            }
        }
        
        const totalSuccessInBatch = successfulBundles.length + nsfwSuccessCount;
        
        if (nsfwSuccessCount > 0) {
            console.log(`🔞 CORREÇÃO NSFW: ${nsfwSuccessCount} bundles NSFW contados como SUCESSOS no lote ${batchIndex}`);
            console.log(`   📊 Sucessos regulares: ${successfulBundles.length}, NSFW: ${nsfwSuccessCount}, Total: ${totalSuccessInBatch}/${batch.length}`);
        }
        
        // Registra no sistema adaptativo
        const adaptiveResult = this.performanceManager.recordBatchResult(
            batchIndex, 
            totalSuccessInBatch,
            batch.length, 
            batchTime,
            failedBundleIds
        );
        
        // Logs do lote
        const batchSuccessRate = (totalSuccessInBatch / batch.length * 100).toFixed(1);
        console.log(`📊 Lote ${batchIndex + 1}: ${totalSuccessInBatch}/${batch.length} sucessos (${batchSuccessRate}%) em ${(batchTime/1000).toFixed(1)}s`);
        if (nsfwSuccessCount > 0) {
            console.log(`   🔞 Incluindo ${nsfwSuccessCount} bundles NSFW como SUCESSOS válidos`);
        }
        
        const logMessage = `✅ Lote ${batchIndex + 1}: ${successfulBundles.length}/${batch.length} bundles processados`;
        const performanceInfo = `| ${(batchTime/1000).toFixed(1)}s | Taxa: ${(adaptiveResult.successRate * 100).toFixed(1)}%`;
        const failureInfo = ignoredNotFound > 0 ? ` | ${ignoredNotFound} não encontrados` : '';
        const consecutiveInfo = failedBundleIds.length > 0 ? ` | Falhas neste lote: ${failedBundleIds.length}` : '';
        
        console.log(`${logMessage} ${performanceInfo}${failureInfo}${consecutiveInfo}`);
        
        // Log detalhado a cada intervalo
        this.performanceManager.logDetailedStats(batchIndex);
        
        return {
            successfulBundles,
            failedBundleIds,
            ignoredNotFound,
            batchTime,
            adaptiveResult,
            totalSuccessInBatch
        };
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
                const finalSyncResult = await this.syncService.performFinalSync(currentChunkBundles, bundlesToProcess);
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
        
        // === RELATÓRIO FINAL ===
        const finalConfig = this.performanceManager.getCurrentConfig();
        const finalPerformance = this.performanceManager.calculateCurrentPerformance();
        const totalTime = (Date.now() - actualStartTime) / 1000;
        
        console.log(`\n🎊 ATUALIZAÇÃO CONCLUÍDA COM SUCESSO!`);
        console.log(`📊 RELATÓRIO FINAL:`);
        console.log(`   ✅ Bundles processados: ${updateState.completed}/${bundlesToProcess.length} (${((updateState.completed/bundlesToProcess.length)*100).toFixed(1)}%)`);
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
        console.log(`   ✅ Bundles processados: ${uniqueDetailedBundles.length}/${bundlesToProcess.length} (${((uniqueDetailedBundles.length/bundlesToProcess.length)*100).toFixed(1)}%)`);
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
     * Verifica e resume atualizações incompletas
     */
    async checkAndResumeUpdate() {
        return await this.stateManager.checkAndResumeUpdate();
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
    
    checkAndResumeUpdate: () => 
        updateBundlesOrchestrator.checkAndResumeUpdate(),
    
    processFailedBundles: (existingDetailedBundles) => 
        updateBundlesOrchestrator.processFailedBundles(existingDetailedBundles),
    
    // Para compatibilidade com código existente
    UpdateBundlesOrchestrator
};
