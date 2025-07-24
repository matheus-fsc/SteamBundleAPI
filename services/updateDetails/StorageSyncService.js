/**
 * Serviço de Sincronização com Storage API
 * Controla upload incremental, limpeza de cache e sincronização automática
 */

class StorageSyncService {
    constructor(storageSyncManager) {
        this.storageSyncManager = storageSyncManager;
        this.SYNC_INTERVAL_BUNDLES = 200; // Sincroniza a cada 200 bundles
        this.lastSyncProgress = 0; // Rastreia última sincronização
        
        console.log('🔄 Serviço de Sincronização inicializado:');
        console.log(`   📊 Intervalo de sync: ${this.SYNC_INTERVAL_BUNDLES} bundles`);
        console.log(`   ☁️  Backend: Storage API com PostgreSQL`);
    }

    /**
     * Helper para carregar dados do Storage API com retry automático
     * Aguarda processamento do database com exponential backoff
     */
    async loadStorageDataWithRetry(dataType = 'bundles', maxRetries = 5) {
        // Para bundles detalhados, usa retry menor pois é normal não existirem ainda
        const baseDelay = dataType === 'bundlesDetailed' ? 2000 : 5000; // 2s vs 5s
        const actualMaxRetries = dataType === 'bundlesDetailed' ? 2 : maxRetries; // Apenas 2 tentativas para detailed

        for (let attempt = 1; attempt <= actualMaxRetries; attempt++) {
            try {
                let data;
                if (dataType === 'bundles') {
                    data = await this.storageSyncManager.getBundles(); // CORRIGIDO: usa /api/bundles em vez de /api/data
                } else if (dataType === 'bundlesDetailed') {
                    data = await this.storageSyncManager.getBundlesDetailed();
                }
                
                // CORRIGIDO: verifica a estrutura correta dos dados
                const bundles = data?.data?.bundles || data?.bundles;
                if (bundles && bundles.length > 0) {
                    console.log(`✅ ${bundles.length} ${dataType} carregados do Storage API (tentativa ${attempt})`);
                    return { bundles }; // Normaliza a estrutura de retorno
                }
                
                if (attempt < actualMaxRetries) {
                    const delay = baseDelay * Math.pow(1.2, attempt - 1); // Backoff mais suave
                    console.log(`⏳ Aguardando database processar ${dataType}... Tentativa ${attempt}/${actualMaxRetries} (aguardando ${delay/1000}s)`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            } catch (error) {
                console.warn(`⚠️ Erro na tentativa ${attempt} para carregar ${dataType}:`, error.message);
                if (attempt === actualMaxRetries) throw error;
                
                const delay = baseDelay * Math.pow(1.2, attempt - 1);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        
        return null; // Retorna null se não conseguiu carregar após todas as tentativas
    }

    /**
     * Verifica se deve sincronizar baseado no progresso
     */
    shouldSyncByProgress(updateState) {
        const shouldSync = updateState.completed > 0 && 
                          (updateState.completed % this.SYNC_INTERVAL_BUNDLES === 0) &&
                          (updateState.completed !== this.lastSyncProgress);
        
        return shouldSync;
    }

    /**
     * Sincronização automática baseada no progresso
     */
    async performAutoSync(detailedBundles, updateState, bundlesToProcess, isTestMode = false) {
        if (isTestMode || detailedBundles.length === 0) {
            return { synced: false, reason: 'test_mode_or_no_data' };
        }

        try {
            console.log(`🔄 SINCRONIZAÇÃO AUTO: Enviando ${detailedBundles.length} bundles para Storage API...`);
            
            const chunkInfo = {
                chunkNumber: Math.ceil(updateState.completed / this.SYNC_INTERVAL_BUNDLES),
                chunkSize: this.SYNC_INTERVAL_BUNDLES,
                totalBundles: detailedBundles.length,
                totalExpected: bundlesToProcess.length,
                isIncremental: true,
                progress: Math.round((updateState.completed / bundlesToProcess.length) * 100),
                processedCount: updateState.completed
            };
            
            await this.storageSyncManager.syncDetailedBundlesChunk(detailedBundles, chunkInfo);
            console.log(`✅ SYNC AUTO: Chunk ${chunkInfo.chunkNumber} enviado (${updateState.completed}/${bundlesToProcess.length} - ${chunkInfo.progress}%)`);
            
            // Marca último sync para evitar duplicatas
            this.lastSyncProgress = updateState.completed;
            
            // Limpa dados locais após sincronização
            const cleanupResult = await this.performLocalCleanup(detailedBundles);
            
            return { 
                synced: true, 
                chunkInfo, 
                cleanupResult,
                bundlesRemoved: cleanupResult.bundlesRemoved 
            };
            
        } catch (syncError) {
            console.error('❌ ERRO AUTO-SYNC:', syncError.message);
            console.log('💡 Continuando processamento - dados salvos localmente como fallback');
            return { synced: false, error: syncError.message };
        }
    }

    /**
     * Limpeza inteligente do cache local após sincronização
     */
    async performLocalCleanup(syncedBundles) {
        try {
            console.log(`🧹 Limpando bundles locais após sync (${syncedBundles.length} bundles)...`);
            
            // Identifica bundles sincronizados
            const syncedBundleIds = new Set(syncedBundles.map(b => b.bundleid));
            
            console.log(`✅ Local cleanup: ${syncedBundleIds.size} bundles marcados para remoção do cache local`);
            
            // Força garbage collection se disponível
            let gcResult = null;
            if (global.gc) {
                const memoryBefore = this._getMemoryUsage();
                global.gc();
                const memoryAfter = this._getMemoryUsage();
                gcResult = { before: memoryBefore, after: memoryAfter };
                console.log(`🧹 GC pós-sync: ${memoryBefore.heapUsed}MB → ${memoryAfter.heapUsed}MB`);
            }
            
            return {
                bundlesRemoved: syncedBundleIds.size,
                syncedBundleIds: Array.from(syncedBundleIds),
                gcResult
            };
            
        } catch (cleanupError) {
            console.warn(`⚠️ Erro na limpeza local pós-sync: ${cleanupError.message}`);
            return { bundlesRemoved: 0, error: cleanupError.message };
        }
    }

    /**
     * Sincronização final completa
     */
    async performFinalSync(detailedBundles, bundlesToProcess) {
        try {
            console.log(`🔄 SINCRONIZAÇÃO FINAL: Enviando ${detailedBundles.length} bundles finais para Storage API...`);
            
            // Sincronização final - envia todos os dados
            await this.storageSyncManager.syncDetailedBundlesFinal(detailedBundles, {
                totalExpected: bundlesToProcess.length,
                isComplete: true,
                finalSync: true
            });
            console.log('✅ SINCRONIZAÇÃO FINAL: Dados completos enviados para storage backend');
            
            return { synced: true, final: true };
            
        } catch (syncError) {
            console.error('❌ Erro na sincronização final com storage:', syncError.message);
            console.log('💡 Continuando com salvamento local como fallback');
            return { synced: false, error: syncError.message };
        }
    }

    /**
     * Limpa arquivos locais após sincronização completa
     */
    async cleanupLocalFiles(filesToClean) {
        try {
            console.log('🧹 Iniciando limpeza de arquivos locais após sincronização completa...');
            
            await this.storageSyncManager.cleanupLocalFiles(filesToClean);
            console.log('🧹 Arquivos locais limpos após sincronização completa');
            
            return { cleaned: true, files: filesToClean };
            
        } catch (cleanupError) {
            console.warn(`⚠️ Erro na limpeza final: ${cleanupError.message}`);
            return { cleaned: false, error: cleanupError.message };
        }
    }

    /**
     * Remove bundles já sincronizados do array local
     */
    removeSyncedBundlesFromLocal(detailedBundles, syncedBundleIds) {
        const initialCount = detailedBundles.length;
        const filtered = detailedBundles.filter(bundle => !syncedBundleIds.has(bundle.bundleid));
        const removedCount = initialCount - filtered.length;
        
        console.log(`📊 Cache local atualizado: ${removedCount} bundles removidos, ${filtered.length} restantes`);
        
        return { 
            filteredBundles: filtered, 
            removedCount, 
            remainingCount: filtered.length 
        };
    }

    /**
     * Obtém uso de memória
     */
    _getMemoryUsage() {
        const used = process.memoryUsage();
        return {
            rss: Math.round(used.rss / 1024 / 1024 * 100) / 100,
            heapUsed: Math.round(used.heapUsed / 1024 / 1024 * 100) / 100,
            heapTotal: Math.round(used.heapTotal / 1024 / 1024 * 100) / 100
        };
    }

    /**
     * Reset do contador de sincronização (para novos processos)
     */
    resetSyncProgress() {
        this.lastSyncProgress = 0;
        console.log('🔄 Contador de sincronização resetado');
    }

    /**
     * Status do serviço de sincronização
     */
    getSyncStatus() {
        return {
            syncInterval: this.SYNC_INTERVAL_BUNDLES,
            lastSyncProgress: this.lastSyncProgress,
            isActive: true
        };
    }
}

module.exports = {
    StorageSyncService
};
