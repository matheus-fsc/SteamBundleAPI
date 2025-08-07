/**
 * SERVIÇO DE FILTRAGEM DE BUNDLES
 * Evita reprocessamento de bundles já detalhados
 */

class BundleFilterService {
    constructor(storageSyncManager) {
        this.storageSyncManager = storageSyncManager;
        this.processedBundlesCache = new Set();
        this.cacheExpiry = 5 * 60 * 1000; // 5 minutos
        this.lastCacheUpdate = 0;
    }

    /**
     * Filtra bundles que já foram processados para detalhes
     */
    async filterUnprocessedBundles(basicBundles) {
        console.log(`🔍 Verificando quais dos ${basicBundles.length} bundles básicos ainda precisam de detalhes...`);
        
        try {
            // Atualizar cache se necessário
            await this._updateCacheIfNeeded();
            
            // Filtrar bundles não processados
            const unprocessedBundles = basicBundles.filter(bundle => {
                const isProcessed = this.processedBundlesCache.has(bundle.id.toString());
                return !isProcessed;
            });
            
            console.log(`✅ Filtro aplicado: ${unprocessedBundles.length} bundles precisam de detalhes (${basicBundles.length - unprocessedBundles.length} já processados)`);
            
            if (unprocessedBundles.length === 0) {
                console.log('🎉 Todos os bundles já têm detalhes! Nenhum processamento necessário.');
            }
            
            return {
                unprocessedBundles,
                totalBasic: basicBundles.length,
                alreadyProcessed: basicBundles.length - unprocessedBundles.length,
                needsProcessing: unprocessedBundles.length
            };
            
        } catch (error) {
            console.error('❌ Erro ao filtrar bundles, processando todos por segurança:', error.message);
            // Em caso de erro, processar todos para não perder dados
            return {
                unprocessedBundles: basicBundles,
                totalBasic: basicBundles.length,
                alreadyProcessed: 0,
                needsProcessing: basicBundles.length,
                filterError: true
            };
        }
    }

    /**
     * Atualiza cache de bundles processados consultando a Storage API
     */
    async _updateCacheIfNeeded() {
        const now = Date.now();
        
        // Verificar se cache precisa ser atualizado
        if (now - this.lastCacheUpdate < this.cacheExpiry && this.processedBundlesCache.size > 0) {
            console.log(`📋 Cache válido: ${this.processedBundlesCache.size} bundles processados em cache`);
            return;
        }
        
        console.log('🔄 Atualizando cache de bundles processados...');
        
        try {
            // Buscar bundles detalhados da Storage API
            const detailedResponse = await this.storageSyncManager.getBundlesDetailed({
                fields: 'bundle_id',
                limit: 50000 // Limite alto para pegar todos
            });
            
            if (detailedResponse && detailedResponse.bundles) {
                this.processedBundlesCache.clear();
                
                detailedResponse.bundles.forEach(bundle => {
                    if (bundle.bundle_id) {
                        this.processedBundlesCache.add(bundle.bundle_id.toString());
                    }
                });
                
                this.lastCacheUpdate = now;
                console.log(`✅ Cache atualizado: ${this.processedBundlesCache.size} bundles detalhados encontrados na Storage API`);
            } else {
                console.log('⚠️ Nenhum bundle detalhado encontrado na Storage API');
                this.processedBundlesCache.clear();
                this.lastCacheUpdate = now;
            }
            
        } catch (error) {
            console.error('❌ Erro ao atualizar cache de bundles processados:', error.message);
            // Manter cache anterior em caso de erro
        }
    }

    /**
     * Marca bundles como processados no cache
     */
    markAsProcessed(bundleIds) {
        if (!Array.isArray(bundleIds)) {
            bundleIds = [bundleIds];
        }
        
        bundleIds.forEach(id => {
            this.processedBundlesCache.add(id.toString());
        });
        
        console.log(`✅ ${bundleIds.length} bundles marcados como processados no cache`);
    }

    /**
     * Força atualização do cache
     */
    async forceRefreshCache() {
        this.lastCacheUpdate = 0;
        await this._updateCacheIfNeeded();
    }

    /**
     * Obtém estatísticas do cache
     */
    getCacheStats() {
        return {
            cacheSize: this.processedBundlesCache.size,
            lastUpdate: new Date(this.lastCacheUpdate).toISOString(),
            cacheAge: Date.now() - this.lastCacheUpdate,
            isExpired: Date.now() - this.lastCacheUpdate > this.cacheExpiry
        };
    }
}

module.exports = { BundleFilterService };
