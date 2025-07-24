const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

/**
 * Gerenciador de Bundles Falhados e Sistema de Retry
 * Controla fila de falhas, retry inteligente e sincronização com Storage API
 */

// --- CONFIGURAÇÕES DE RETRY ---
const RETRY_CONFIG = {
    // Configurações conservadoras para retry
    RETRY_DELAY: 3000, // 3 segundos entre requisições
    RETRY_PARALLEL: 1, // Processamento sequencial
    RETRY_TIMEOUT: 30000, // 30s timeout
    RETRY_MAX_ATTEMPTS: 2, // Máximo 2 tentativas no retry
    
    // Condições para considerar "falha definitiva"
    FAILURE_TYPES_TO_RETRY: [
        'MAX_RETRIES_REACHED',
        'INVALID_PAGE', 
        'EXTRACTION_FAILED',
        'TIMEOUT_ERROR',
        'NETWORK_ERROR',
        'AGE_VERIFICATION_FAILED',
        'AGE_VERIFICATION_FAILED_RETRY'
    ]
};

class FailedBundlesManager {
    constructor(storageSyncManager) {
        this.failedQueue = new Map(); // bundleId -> {bundle, reason, attempts, lastAttempt}
        this.retryAttempts = 0;
        this.retrySuccess = 0;
        this.storageSyncManager = storageSyncManager;
        
        // Setup de arquivos
        this.FAILED_BUNDLES_FILE = path.join(__dirname, '../failed_bundles_queue.json');
        this._ensureDataDirectory();
    }

    async _ensureDataDirectory() {
        try {
            const dataDir = path.dirname(this.FAILED_BUNDLES_FILE);
            await fs.mkdir(dataDir, { recursive: true });
        } catch (error) {
            console.warn('⚠️ Erro ao criar diretório de dados:', error.message);
        }
    }
    
    addFailedBundle(bundleId, bundle, reason, originalIndex) {
        const existing = this.failedQueue.get(bundleId);
        
        if (existing) {
            existing.attempts++;
            existing.lastAttempt = Date.now();
            existing.reasons.add(reason);
        } else {
            this.failedQueue.set(bundleId, {
                bundleId,
                bundle,
                reasons: new Set([reason]),
                attempts: 1,
                firstFailed: Date.now(),
                lastAttempt: Date.now(),
                originalIndex
            });
        }
    }
    
    shouldRetry(reason) {
        return RETRY_CONFIG.FAILURE_TYPES_TO_RETRY.includes(reason);
    }
    
    getRetryQueue() {
        return Array.from(this.failedQueue.values()).filter(item => 
            Array.from(item.reasons).some(reason => this.shouldRetry(reason))
        );
    }
    
    async saveFailedQueue() {
        try {
            const queueData = {
                timestamp: new Date().toISOString(),
                totalFailed: this.failedQueue.size,
                retryable: this.getRetryQueue().length,
                bundles: Array.from(this.failedQueue.values())
            };
            
            await fs.writeFile(this.FAILED_BUNDLES_FILE, JSON.stringify(queueData, null, 2), 'utf-8');
            console.log(`💾 Queue de falhas salva: ${queueData.totalFailed} bundles (${queueData.retryable} para retry)`);
        } catch (error) {
            console.error('❌ Erro ao salvar queue de falhas:', error.message);
        }
    }
    
    async loadFailedQueue() {
        try {
            // 🆕 PRIORIDADE 1: Tenta carregar do Storage API (fonte autoritativa)
            console.log('🔄 Carregando fila de falhas do Storage API...');
            
            const storageResult = await this.storageSyncManager.getFailedBundlesQueue();
            
            if (storageResult.success && storageResult.queue && storageResult.queue.bundles) {
                console.log(`📥 Dados encontrados no Storage API: ${storageResult.queue.bundles.length} bundles`);
                
                // Carrega dados do storage na memória
                for (const item of storageResult.queue.bundles) {
                    this.failedQueue.set(item.bundleId, {
                        ...item,
                        reasons: new Set(item.reasons || [])
                    });
                }
                
                // Salva localmente como backup para futuras consultas offline
                await this.saveFailedQueue();
                
                console.log(`✅ Queue de falhas carregada do Storage API: ${this.failedQueue.size} bundles`);
                return true;
            } else {
                console.log('📭 Nenhuma fila encontrada no Storage API, tentando arquivo local...');
            }
            
            // FALLBACK: Carrega do arquivo local se Storage API falhar ou estiver vazio
            if (fsSync.existsSync(this.FAILED_BUNDLES_FILE)) {
                const queueData = JSON.parse(fsSync.readFileSync(this.FAILED_BUNDLES_FILE, 'utf-8'));
                
                for (const item of queueData.bundles || []) {
                    this.failedQueue.set(item.bundleId, {
                        ...item,
                        reasons: new Set(item.reasons || [])
                    });
                }
                
                console.log(`📂 Queue de falhas carregada do arquivo local: ${this.failedQueue.size} bundles`);
                
                // Se carregou dados locais, sincroniza de volta para o Storage API
                if (this.failedQueue.size > 0) {
                    console.log('🔄 Sincronizando dados locais com Storage API...');
                    await this.syncWithStorage();
                }
                
                return true;
            }
            
            console.log('📭 Nenhuma queue de falhas encontrada (Storage API ou local)');
            
        } catch (error) {
            console.warn('⚠️ Erro ao carregar queue de falhas:', error.message);
            console.log('🔄 Tentando carregar apenas do arquivo local como fallback...');
            
            // FALLBACK DE EMERGÊNCIA: Só arquivo local
            try {
                if (fsSync.existsSync(this.FAILED_BUNDLES_FILE)) {
                    const queueData = JSON.parse(fsSync.readFileSync(this.FAILED_BUNDLES_FILE, 'utf-8'));
                    
                    for (const item of queueData.bundles || []) {
                        this.failedQueue.set(item.bundleId, {
                            ...item,
                            reasons: new Set(item.reasons || [])
                        });
                    }
                    
                    console.log(`📂 Queue de falhas carregada do fallback local: ${this.failedQueue.size} bundles`);
                    return true;
                }
            } catch (fallbackError) {
                console.error('❌ Erro no fallback local:', fallbackError.message);
            }
        }
        return false;
    }
    
    async clearFailedQueue() {
        try {
            if (fsSync.existsSync(this.FAILED_BUNDLES_FILE)) {
                await fs.unlink(this.FAILED_BUNDLES_FILE);
                console.log('🗑️ Queue de falhas limpa');
            }
        } catch (error) {
            console.warn('⚠️ Erro ao limpar queue de falhas:', error.message);
        }
    }
    
    getStats() {
        const retryableCount = this.getRetryQueue().length;
        const nonRetryableCount = this.failedQueue.size - retryableCount;
        
        return {
            total: this.failedQueue.size,
            retryable: retryableCount,
            nonRetryable: nonRetryableCount,
            retryAttempts: this.retryAttempts,
            retrySuccess: this.retrySuccess
        };
    }

    // Sincroniza fila de falhas com Storage API
    async syncWithStorage() {
        try {
            const queueData = {
                timestamp: new Date().toISOString(),
                totalFailed: this.failedQueue.size,
                retryable: this.getRetryQueue().length,
                bundles: Array.from(this.failedQueue.entries()).map(([bundleId, data]) => ({
                    bundleId,
                    bundle: data.bundle,
                    reason: data.reason,
                    attempts: data.attempts,
                    lastAttempt: data.lastAttempt,
                    originalIndex: data.originalIndex,
                    canRetry: this.shouldRetry(data.reason)
                }))
            };

            console.log(`🔄 Sincronizando fila de falhas com storage (${queueData.totalFailed} bundles)...`);
            
            // Envia para storage usando o storageSyncManager
            await this.storageSyncManager.syncFailedBundlesQueue(queueData);
            
            console.log('✅ Fila de falhas sincronizada com storage backend');
            return true;
            
        } catch (error) {
            console.error('❌ Erro ao sincronizar fila de falhas com storage:', error.message);
            return false;
        }
    }

    /**
     * Processa bundles que falharam usando configurações conservadoras de retry
     */
    async processRetryQueue(retryFunction) {
        const retryQueue = this.getRetryQueue();
        
        if (retryQueue.length === 0) {
            console.log('📭 Nenhum bundle elegível para retry');
            return { processed: 0, success: 0, failed: 0 };
        }

        console.log(`\n🔄 INICIANDO RETRY DE ${retryQueue.length} BUNDLES...`);
        console.log(`⚙️  Configuração conservadora: ${RETRY_CONFIG.RETRY_DELAY}ms delay, ${RETRY_CONFIG.RETRY_PARALLEL} parallel, timeout ${RETRY_CONFIG.RETRY_TIMEOUT}ms`);

        const results = [];
        let successCount = 0;
        let failedCount = 0;

        // Processamento sequencial para ser conservador
        for (const [index, failedItem] of retryQueue.entries()) {
            console.log(`\n🔄 RETRY [${index + 1}/${retryQueue.length}] Bundle ${failedItem.bundleId}:`);
            console.log(`   📊 Tentativas anteriores: ${failedItem.attempts}`);
            console.log(`   ❌ Razões: ${Array.from(failedItem.reasons).join(', ')}`);
            
            this.retryAttempts++;

            try {
                // Delay conservador entre retries
                if (index > 0) {
                    await new Promise(resolve => setTimeout(resolve, RETRY_CONFIG.RETRY_DELAY));
                }

                const retryResult = await retryFunction(failedItem.bundleId);

                if (retryResult.success) {
                    console.log(`✅ RETRY SUCESSO: Bundle ${failedItem.bundleId} processado com sucesso`);
                    
                    // Remove da fila de falhas
                    this.failedQueue.delete(failedItem.bundleId);
                    this.retrySuccess++;
                    successCount++;
                    
                    results.push({
                        bundleId: failedItem.bundleId,
                        success: true,
                        data: retryResult.data
                    });
                } else {
                    console.log(`❌ RETRY FALHOU: Bundle ${failedItem.bundleId} - ${retryResult.reason}`);
                    
                    // Atualiza informações da falha
                    const existingFailure = this.failedQueue.get(failedItem.bundleId);
                    if (existingFailure) {
                        existingFailure.attempts++;
                        existingFailure.lastAttempt = Date.now();
                        existingFailure.reasons.add(`RETRY_${retryResult.reason}`);
                    }
                    
                    failedCount++;
                    results.push({
                        bundleId: failedItem.bundleId,
                        success: false,
                        reason: retryResult.reason
                    });
                }

            } catch (error) {
                console.error(`❌ ERRO DURANTE RETRY: Bundle ${failedItem.bundleId} - ${error.message}`);
                
                // Atualiza informações da falha
                const existingFailure = this.failedQueue.get(failedItem.bundleId);
                if (existingFailure) {
                    existingFailure.attempts++;
                    existingFailure.lastAttempt = Date.now();
                    existingFailure.reasons.add('RETRY_ERROR');
                }
                
                failedCount++;
                results.push({
                    bundleId: failedItem.bundleId,
                    success: false,
                    reason: 'RETRY_ERROR',
                    error: error.message
                });
            }

            // Log de progresso a cada 10 retries
            if ((index + 1) % 10 === 0) {
                console.log(`📊 Progresso retry: ${index + 1}/${retryQueue.length} | Sucessos: ${successCount} | Falhas: ${failedCount}`);
            }
        }

        // Salva queue atualizada
        await this.saveFailedQueue();
        await this.syncWithStorage();

        const retryStats = this.getStats();
        console.log(`\n✅ RETRY CONCLUÍDO:`);
        console.log(`   📊 Processados: ${retryQueue.length} bundles`);
        console.log(`   ✅ Sucessos: ${successCount} (${((successCount/retryQueue.length)*100).toFixed(1)}%)`);
        console.log(`   ❌ Falhas: ${failedCount}`);
        console.log(`   📈 Taxa de sucesso total em retries: ${this.retrySuccess}/${this.retryAttempts} (${((this.retrySuccess/this.retryAttempts)*100).toFixed(1)}%)`);
        console.log(`   📋 Queue atual: ${retryStats.total} bundles (${retryStats.retryable} elegíveis para retry)`);

        return {
            processed: retryQueue.length,
            success: successCount,
            failed: failedCount,
            results,
            stats: retryStats
        };
    }
}

module.exports = {
    FailedBundlesManager,
    RETRY_CONFIG
};
