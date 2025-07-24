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
    constructor() {
        // Arquivos de estado
        this.UPDATE_STATE_FILE = path.join(__dirname, '../updateState.json');
        this.BUNDLES_DETAILED_FILE = path.join(__dirname, '../bundleDetailed.json');
        
        // Cache em memória para o estado de atualização (Render Free friendly)
        this.updateStateCache = null;
        
        this._ensureDataDirectory();
        
        console.log('📊 Gerenciador de Estado inicializado:');
        console.log(`   💾 Intervalo de salvamento: ${STATE_CONFIG.SAVE_INTERVAL_BATCHES} lotes`);
        console.log(`   📊 Check de memória: ${STATE_CONFIG.MEMORY_CHECK_INTERVAL_BATCHES} lotes`);
        console.log(`   🚨 Limite de memória: ${STATE_CONFIG.MAX_MEMORY_USAGE_MB}MB`);
    }

    async _ensureDataDirectory() {
        try {
            const dataDir = path.dirname(this.UPDATE_STATE_FILE);
            await fs.mkdir(dataDir, { recursive: true });
        } catch (error) {
            console.warn('⚠️ Erro ao criar diretório de dados:', error.message);
        }
    }

    /**
     * Cria estado inicial de atualização
     */
    createInitialUpdateState(bundlesToProcess, limitForTesting, language) {
        return {
            status: 'in_progress',
            startTime: Date.now(),
            total: bundlesToProcess.length,
            completed: 0,
            lastProcessedIndex: -1,
            language: language,
            isTestMode: !!limitForTesting,
            processedBundles: [],
            errors: [],
            resumeCount: 0
        };
    }

    /**
     * Carrega estado de atualização
     */
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
    async saveDetailedBundlesData(detailedBundles, bundlesToProcess, isComplete = false, isTestMode = false, startTime, updateState = null) {
        const memory = this.getMemoryUsage();
        const totalTime = (Date.now() - startTime) / 1000;
        
        // --- ESTRUTURA OTIMIZADA: STATUS NO INÍCIO ---
        const result = {
            // STATUS E INFORMAÇÕES CRÍTICAS NO INÍCIO (para verificação rápida)
            isComplete: isComplete,
            status: isComplete ? 'completed' : 'in_progress',
            totalBundles: detailedBundles.length,
            processedCount: bundlesToProcess.length,
            
            // RESUMO DE ESTADO
            updateStatus: updateState ? {
                status: updateState.status,
                completed: updateState.completed,
                total: updateState.total,
                lastProcessedIndex: updateState.lastProcessedIndex,
                resumeCount: updateState.resumeCount,
                canResume: !isComplete
            } : null,
            
            // METADADOS TEMPORAIS
            last_update: moment().tz(STATE_CONFIG.TIMEZONE).format(),
            lastSaved: new Date().toISOString(),
            processingTimeSeconds: totalTime,
            bundlesPerSecond: detailedBundles.length / totalTime,
            
            // CONFIGURAÇÕES
            isTestMode: !!isTestMode,
            memoryUsage: memory,
            
            // DADOS PRINCIPAIS (no final para otimizar leitura)
            bundles: detailedBundles
        };
        
        const outputFile = isTestMode ? path.join(__dirname, '../data/bundleDetailed_test.json') : this.BUNDLES_DETAILED_FILE;
        
        try {
            // Salva arquivo local apenas se não for modo teste
            if (!isTestMode) {
                await fs.writeFile(outputFile, JSON.stringify(result, null, 2), 'utf-8');
            }
            
            if (isComplete) {
                console.log(`💾 ✅ Salvamento final: ${detailedBundles.length} bundles (${memory.heapUsed}MB)`);
            } else {
                console.log(`💾 🔄 Salvamento parcial: ${detailedBundles.length} bundles (${memory.heapUsed}MB) - Checkpoint: ${updateState?.completed}/${updateState?.total}`);
            }
        } catch (error) {
            console.error('❌ Erro ao salvar dados detalhados:', error.message);
            throw error;
        }
        
        return result;
    }

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

    /**
     * Verifica se há estado de atualização incompleta para recovery
     */
    async checkAndResumeUpdate() {
        try {
            // Verifica estado salvo
            const state = this.loadUpdateState();
            if (!state) {
                console.log('📭 Nenhum estado de atualização encontrado');
                return false;
            }

            // Verifica se atualização estava em progresso
            if (state.status !== 'in_progress') {
                console.log(`📊 Estado anterior: ${state.status} - nenhum resume necessário`);
                return false;
            }

            // Verifica se não é muito antigo (evita resume de estados corrompidos)
            const timeSinceStart = (Date.now() - state.startTime) / (1000 * 60);
            if (timeSinceStart > 120) { // Mais de 2 horas
                console.log(`⏰ Estado muito antigo (${Math.round(timeSinceStart)} min) - ignorando para segurança`);
                await this.clearUpdateState();
                return false;
            }

            // Verifica se há dados detalhados parciais
            const quickCheck = await this.quickStatusCheck(this.BUNDLES_DETAILED_FILE);
            if (quickCheck.exists && !quickCheck.isComplete) {
                console.log(`🔄 Atualização incompleta detectada:`);
                console.log(`   📊 Estado: ${state.completed}/${state.total} bundles processados`);
                console.log(`   📂 Arquivo: ${quickCheck.totalBundles || 'N/A'} bundles salvos`);
                console.log(`   ⏰ Iniciado há: ${Math.round(timeSinceStart)} minutos`);
                return true;
            }

            console.log('✅ Nenhuma atualização incompleta encontrada');
            return false;

        } catch (error) {
            console.error('❌ Erro ao verificar resume:', error.message);
            return false;
        }
    }

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
