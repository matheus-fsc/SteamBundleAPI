const fs = require('fs').promises;
const fsSync = require('fs');
const moment = require('moment-timezone');
const path = require('path');

/**
 * Gerenciador de Estado de Atualizações
 * Controla persistência de estado, checkpoints e recovery
 */

// --- CONFIGURAÇÕES DE ESTADO ---
const STATE_CONFIG = {
    TIMEZONE: 'America/Sao_Paulo',
    SAVE_INTERVAL_BATCHES: 8, // Aproximadamente 200 bundles (25 bundles por lote * 8 lotes = 200)
    MEMORY_CHECK_INTERVAL_BATCHES: 5, // Mais conservador
    MAX_MEMORY_USAGE_MB: 200, // Reduzido para Render Free (500MB total)
    CONSECUTIVE_FAILURE_THRESHOLD: 3 // Mais sensível
};


class StateManager {
    // [NOVO] Adicionado o constructor para inicializar as propriedades
    constructor() {
        this.UPDATE_STATE_FILE = path.join(__dirname, '../update_state.json');
        this.updateStateCache = null; // Cache em memória para o estado atual
    }

    // [NOVO] Método em falta para criar o estado inicial da atualização
    createInitialUpdateState(bundlesToProcess, limit, language) {
        const initialState = {
            sessionId: `details_sync_${Date.now()}`,
            status: 'running',
            total: bundlesToProcess.length,
            completed: 0,
            failed: 0,
            processedIds: [],
            startTime: new Date().toISOString(),
            lastProcessedIndex: -1,
            language: language,
            limit: limit,
            isResumed: false
        };
        console.log(`✨ Novo estado de atualização criado. Total a processar: ${initialState.total}`);
        this.updateStateCache = initialState; // Guarda o novo estado no cache
        return initialState;
    }

    loadUpdateState() {
        try {
            // Em ambiente Render Free, usa cache em memória
            if (this.updateStateCache) {
                console.log(`📋 Estado de atualização encontrado (cache): ${this.updateStateCache.status} (${this.updateStateCache.completed}/${this.updateStateCache.total})`);
                return this.updateStateCache;
            }
            
            // Fallback para arquivo local (desenvolvimento)
            if (fsSync.existsSync(this.UPDATE_STATE_FILE)) {
                const state = JSON.parse(fsSync.readFileSync(this.UPDATE_STATE_FILE, 'utf-8'));
                console.log(`📋 Estado de atualização encontrado (arquivo): ${state.status} (${state.completed}/${state.total})`);
                this.updateStateCache = state; // Cache em memória
                return state;
            }
        } catch (error) {
            console.warn('⚠️ Erro ao carregar estado de atualização:', error.message);
        }
        return null;
    }

    /**
     * Salva estado de atualização
     */
    async saveUpdateState(state) {
        try {
            const stateWithTimestamp = {
                ...state,
                lastSaved: new Date().toISOString(),
                lastActivity: new Date().toISOString()
            };
            
            // Prioridade: cache em memória (Render Free friendly)
            this.updateStateCache = stateWithTimestamp;
            
            // Fallback: salva em arquivo local para desenvolvimento
            try {
                await fs.writeFile(this.UPDATE_STATE_FILE, JSON.stringify(stateWithTimestamp, null, 2), 'utf-8');
            } catch (fileError) {
                console.warn('⚠️ Não foi possível salvar arquivo de estado (esperado no Render):', fileError.message);
            }
        } catch (error) {
            console.error('❌ Erro ao salvar estado de atualização:', error.message);
        }
    }

    /**
     * Limpa estado de atualização
     */
    async clearUpdateState() {
        try {
            // Limpa cache em memória (principal em Render Free)
            this.updateStateCache = null;
            console.log('🗑️ Estado de atualização limpo (cache)');
            
            // Fallback: limpa arquivo local para desenvolvimento
            try {
                await fs.unlink(this.UPDATE_STATE_FILE);
                console.log('🗑️ Estado de atualização limpo (arquivo)');
            } catch (fileError) {
                if (fileError.code !== 'ENOENT') {
                    console.warn('⚠️ Arquivo de estado não encontrado (esperado no Render):', fileError.message);
                }
            }
        } catch (error) {
            console.warn('⚠️ Erro ao limpar estado de atualização:', error.message);
        }
    }

    /**
     * Verificação rápida de status de arquivo
     */
    async quickStatusCheck(filePath) {
        try {
            if (!fsSync.existsSync(filePath)) {
                return { exists: false };
            }
            
            // Lê apenas os primeiros 500 bytes para verificar status
            const fileHandle = await fs.open(filePath, 'r');
            const buffer = Buffer.alloc(500);
            const { bytesRead } = await fileHandle.read(buffer, 0, 500, 0);
            await fileHandle.close();
            
            const partialContent = buffer.toString('utf8', 0, bytesRead);
            
            // Procura pelos campos de status nos primeiros bytes
            const isCompleteMatch = partialContent.match(/"isComplete":\s*(true|false)/);
            const statusMatch = partialContent.match(/"status":\s*"([^"]+)"/);
            const totalBundlesMatch = partialContent.match(/"totalBundles":\s*(\d+)/);
            
            if (isCompleteMatch && statusMatch) {
                const isComplete = isCompleteMatch[1] === 'true';
                const status = statusMatch[1];
                const totalBundles = totalBundlesMatch ? parseInt(totalBundlesMatch[1]) : 0;
                
                console.log(`⚡ Verificação rápida de ${filePath}:`);
                console.log(`   📊 Status: ${status} | Completo: ${isComplete ? '✅' : '❌'} | Bundles: ${totalBundles}`);
                
                return {
                    exists: true,
                    isComplete,
                    status,
                    totalBundles,
                    quickCheck: true
                };
            } else {
                console.warn(`⚠️ Verificação rápida falhou para ${filePath} - formato não reconhecido`);
                return { exists: true, quickCheck: false };
            }
            
        } catch (error) {
            console.warn(`⚠️ Erro na verificação rápida de ${filePath}:`, error.message);
            return { exists: true, quickCheck: false };
        }
    }

    /**
     * Obtém uso de memória atual
     */
    getMemoryUsage() {
        const used = process.memoryUsage();
        return {
            rss: Math.round(used.rss / 1024 / 1024 * 100) / 100,
            heapUsed: Math.round(used.heapUsed / 1024 / 1024 * 100) / 100,
            heapTotal: Math.round(used.heapTotal / 1024 / 1024 * 100) / 100
        };
    }

    /**
     * Salva dados detalhados de bundles com metadados otimizados
     */

    /**
     * Verifica se deve salvar checkpoint baseado em configurações
     */
    shouldSaveCheckpoint(batchesProcessed, memory) {
        const shouldSaveByInterval = batchesProcessed % STATE_CONFIG.SAVE_INTERVAL_BATCHES === 0;
        const shouldSaveByMemory = memory.heapUsed > STATE_CONFIG.MAX_MEMORY_USAGE_MB;
        
        return { shouldSaveByInterval, shouldSaveByMemory };
    }

    /**
     * Verifica se deve fazer check de memória
     */
    shouldCheckMemory(batchesProcessed) {
        return batchesProcessed % STATE_CONFIG.MEMORY_CHECK_INTERVAL_BATCHES === 0;
    }

    // ...existing code...

    /**
     * Força garbage collection se disponível
     */
    forceGarbageCollection() {
        if (global.gc) {
            const memoryBefore = this.getMemoryUsage();
            global.gc();
            const memoryAfter = this.getMemoryUsage();
            console.log(`🧹 GC executado: ${memoryBefore.heapUsed}MB → ${memoryAfter.heapUsed}MB`);
            return { before: memoryBefore, after: memoryAfter };
        }
        return null;
    }
}

module.exports = {
    StateManager,
    STATE_CONFIG
};
