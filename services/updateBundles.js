const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const fsSync = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const moment = require('moment-timezone');
const { removeDuplicatesFromDetailedBundles } = require('../middleware/dataValidation');
const { keepAlive } = require('./keepAlive');

/**
 * Steam Bundle Update Service V6.2 - Sistema Otimizado para Render Free
 * - Otimização específica para 0.1 core e 500MB RAM do Render Free
 * - Paralelismo reduzido (max 4, inicial 2) para recursos limitados
 * - Delays aumentados para dar tempo de CPU processar (500-8000ms)
 * - Salvamento menos frequente para economizar I/O (25 lotes)
 * - Detecção automática de conteúdo NSFW via redirecionamento para login
 * - Categorização automática de bundles adultos como "NSFW/Adult Content"
 * - Circuit breaker inteligente para MAX_RETRIES_REACHED (conta como 3 falhas)
 * - Sistema adaptativo CONSERVADOR com detecção de degradação precoce
 * - Retry queue para falhas elegíveis com límites inteligentes
 * - Age verification automático + JSON otimizado para status rápido
 * - Persistência automática da fila de falhas durante checkpoints
 */

// --- CONSTANTES ---
const BUNDLES_FILE = 'bundles.json';
const BUNDLES_DETAILED_FILE = './bundleDetailed.json';
const UPDATE_STATE_FILE = './updateState.json';
const TIMEZONE = 'America/Sao_Paulo';
const LOG_FILE = path.join(__dirname, 'scraping_debug.log');
const ADAPTIVE_LOG_FILE = path.join(__dirname, 'adaptive_performance.log');
const FAILED_BUNDLES_FILE = path.join(__dirname, 'failed_bundles_queue.json');

const STEAM_API_CONFIG = {
    DELAY_BETWEEN_REQUESTS: parseInt(process.env.STEAM_API_DELAY) || 500,
    REQUEST_TIMEOUT: parseInt(process.env.REQUEST_TIMEOUT) || 20000,
    MAX_RETRIES: parseInt(process.env.MAX_RETRIES) || 3,
    PARALLEL_BUNDLES: 3, // REDUZIDO: Render Free tem apenas 0.1 core
    STEAM_APP_DELAY: 300 // Delay entre chamadas da API de apps
};

const SAVE_INTERVAL_BATCHES = 25; // Aumentado para economizar I/O
const MEMORY_CHECK_INTERVAL_BATCHES = 5; // Mais conservador
const MAX_MEMORY_USAGE_MB = 200; // Reduzido para Render Free (500MB total)
const CONSECUTIVE_FAILURE_THRESHOLD = 3; // Mais sensível
const CIRCUIT_BREAKER_DELAY = 30000; // 30s (menos tempo parado)

// --- CIRCUIT BREAKER ADAPTATIVO ---
const ADAPTIVE_CIRCUIT_BREAKER = {
    PERFORMANCE_DROP_THRESHOLD: 0.20,    // Queda de 20% na taxa de sucesso
    SEVERE_FAILURE_THRESHOLD: 0.50,      // Taxa de sucesso abaixo de 50%
    RECOVERY_DELAY: 45000,               // 45 segundos de pausa para recuperação
    MIN_BATCHES_FOR_DETECTION: 3,        // Mínimo de lotes para detectar problema
    RECOVERY_CONFIG_MULTIPLIER: 2        // Multiplicador para configuração conservadora
};

// --- SISTEMA ADAPTATIVO DE PERFORMANCE - OTIMIZADO PARA RENDER FREE ---
const ADAPTIVE_CONFIG = {
    // Configurações de delay (em ms) - OTIMIZADO PARA 0.1 CORE
    MIN_DELAY: 500,        // Aumentado para dar tempo de CPU processar
    MAX_DELAY: 8000,       // Aumentado para casos problemáticos
    INITIAL_DELAY: 1500,   // Mais conservador para Render
    DELAY_STEP: 300,       // Ajustes mais suaves
    
    // Configurações de paralelismo - MUITO LIMITADO PARA RENDER FREE
    MIN_PARALLEL: 1,
    MAX_PARALLEL: 4,       // MÁXIMO 4 para 0.1 core (muito conservador)
    INITIAL_PARALLEL: 2,   // Inicia com apenas 2 parallel
    
    // Configurações de estabilidade - MAIS DADOS PARA DECISÕES
    STABILITY_WINDOW: 8,   // Menos lotes para análise (economiza RAM)
    SUCCESS_RATE_TARGET: 0.85, 
    OPTIMIZATION_INTERVAL: 8,  // Otimiza menos frequentemente
    
    // Configurações de ajuste - EXTREMAMENTE CONSERVADOR
    AGGRESSIVE_INCREASE_THRESHOLD: 0.98, // Apenas com 98% de sucesso
    GENTLE_INCREASE_THRESHOLD: 0.92,     // 92% para ajustes leves
    DECREASE_THRESHOLD: 0.75,            // Detecta problemas mais cedo
    
    // Configurações de segurança RENDER FREE
    MAX_PARALLEL_INCREASE: 1,            // Máximo +1 parallel por vez
    MAX_DELAY_DECREASE: 200,             // Máximo -200ms por vez
    DEGRADATION_ALERT_THRESHOLD: 0.20,   // Alerta se cair 20%
    
    // Log de performance
    LOG_INTERVAL: 20  // Log menos frequente para economizar I/O
};

// --- SISTEMA DE RETRY QUEUE ---
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
    constructor() {
        this.failedQueue = new Map(); // bundleId -> {bundle, reason, attempts, lastAttempt}
        this.retryAttempts = 0;
        this.retrySuccess = 0;
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
            
            await fsPromises.writeFile(FAILED_BUNDLES_FILE, JSON.stringify(queueData, null, 2), 'utf-8');
            console.log(`💾 Queue de falhas salva: ${queueData.totalFailed} bundles (${queueData.retryable} para retry)`);
        } catch (error) {
            console.error('❌ Erro ao salvar queue de falhas:', error.message);
        }
    }
    
    async loadFailedQueue() {
        try {
            if (fsSync.existsSync(FAILED_BUNDLES_FILE)) {
                const queueData = JSON.parse(fsSync.readFileSync(FAILED_BUNDLES_FILE, 'utf-8'));
                
                for (const item of queueData.bundles || []) {
                    this.failedQueue.set(item.bundleId, {
                        ...item,
                        reasons: new Set(item.reasons || [])
                    });
                }
                
                console.log(`📂 Queue de falhas carregada: ${this.failedQueue.size} bundles`);
                return true;
            }
        } catch (error) {
            console.warn('⚠️ Erro ao carregar queue de falhas:', error.message);
        }
        return false;
    }
    
    async clearFailedQueue() {
        try {
            if (fsSync.existsSync(FAILED_BUNDLES_FILE)) {
                await fsPromises.unlink(FAILED_BUNDLES_FILE);
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
}

class AdaptivePerformanceManager {
    constructor() {
        this.currentDelay = ADAPTIVE_CONFIG.INITIAL_DELAY;
        this.currentParallel = ADAPTIVE_CONFIG.INITIAL_PARALLEL;
        this.batchHistory = [];
        this.optimizationAttempts = 0;
        this.bestConfig = null;
        this.lastOptimization = 0;
        this.failedBundles = new Set();
        
        // Circuit Breaker Adaptativo
        this.lastOptimizationPerformance = null;
        this.adaptiveCircuitBreakerActive = false;
        this.lastRecoveryTime = 0;
        
        console.log('🧠 Sistema Adaptativo inicializado (OTIMIZADO RENDER FREE):');
        console.log(`   ⏱️  Delay inicial: ${this.currentDelay}ms (RENDER CONSERVADOR)`);
        console.log(`   🔄 Paralelismo inicial: ${this.currentParallel} (LIMITADO 0.1 CORE)`);
        console.log(`   🚀 Configuração: Otimizações a cada ${ADAPTIVE_CONFIG.OPTIMIZATION_INTERVAL} lotes`);
        console.log(`   ⚡ Limites: ${ADAPTIVE_CONFIG.MIN_DELAY}-${ADAPTIVE_CONFIG.MAX_DELAY}ms, ${ADAPTIVE_CONFIG.MIN_PARALLEL}-${ADAPTIVE_CONFIG.MAX_PARALLEL} parallel`);
        console.log(`   🛡️ Circuit Breaker: Proteção contra degradação adaptativa ativa`);
        console.log(`   💾 Render Free: 0.1 core, 500MB RAM - Configuração ultra-otimizada`);
    }
    
    recordBatchResult(batchIndex, successCount, totalCount, batchTime, failedIds = []) {
        const successRate = successCount / totalCount;
        const result = {
            batchIndex,
            successCount,
            totalCount,
            successRate,
            batchTime,
            delay: this.currentDelay,
            parallel: this.currentParallel,
            timestamp: Date.now(),
            failedIds
        };
        
        // Registra bundles que falharam
        failedIds.forEach(id => this.failedBundles.add(id));
        
        this.batchHistory.push(result);
        
        // Mantém apenas os últimos resultados para análise
        if (this.batchHistory.length > ADAPTIVE_CONFIG.STABILITY_WINDOW * 2) {
            this.batchHistory = this.batchHistory.slice(-ADAPTIVE_CONFIG.STABILITY_WINDOW * 2);
        }
        
        return result;
    }
    
    calculateCurrentPerformance() {
        if (this.batchHistory.length === 0) return null;
        
        const recentBatches = this.batchHistory.slice(-ADAPTIVE_CONFIG.STABILITY_WINDOW);
        const totalSuccess = recentBatches.reduce((sum, batch) => sum + batch.successCount, 0);
        const totalAttempts = recentBatches.reduce((sum, batch) => sum + batch.totalCount, 0);
        const avgTime = recentBatches.reduce((sum, batch) => sum + batch.batchTime, 0) / recentBatches.length;
        const successRate = totalSuccess / totalAttempts;
        
        return {
            successRate,
            avgBatchTime: avgTime,
            totalBatches: recentBatches.length,
            bundlesPerSecond: totalSuccess / (avgTime * recentBatches.length / 1000),
            efficiency: successRate * (1000 / avgTime) // Combina sucesso e velocidade
        };
    }
    
    shouldOptimize(batchIndex) {
        return (batchIndex - this.lastOptimization) >= ADAPTIVE_CONFIG.OPTIMIZATION_INTERVAL 
               && this.batchHistory.length >= ADAPTIVE_CONFIG.STABILITY_WINDOW;
    }
    
    // Detecta se a última otimização causou degradação severa
    detectAdaptiveCircuitBreaker() {
        if (!this.lastOptimizationPerformance || this.batchHistory.length < ADAPTIVE_CIRCUIT_BREAKER.MIN_BATCHES_FOR_DETECTION) {
            return false;
        }
        
        const currentPerformance = this.calculateCurrentPerformance();
        if (!currentPerformance) return false;
        
        const performanceDrop = this.lastOptimizationPerformance.successRate - currentPerformance.successRate;
        const isSevereFailure = currentPerformance.successRate < ADAPTIVE_CIRCUIT_BREAKER.SEVERE_FAILURE_THRESHOLD;
        const isSignificantDrop = performanceDrop > ADAPTIVE_CIRCUIT_BREAKER.PERFORMANCE_DROP_THRESHOLD;
        
        if (isSevereFailure || isSignificantDrop) {
            console.log(`🚨 CIRCUIT BREAKER ADAPTATIVO ATIVADO!`);
            console.log(`   📉 Performance anterior: ${(this.lastOptimizationPerformance.successRate * 100).toFixed(1)}% sucesso`);
            console.log(`   📉 Performance atual: ${(currentPerformance.successRate * 100).toFixed(1)}% sucesso`);
            console.log(`   ⚠️  Queda detectada: ${(performanceDrop * 100).toFixed(1)}%`);
            console.log(`   🛡️ Iniciando recuperação conservadora...`);
            
            return true;
        }
        
        return false;
    }
    
    // Força configuração conservadora para recuperação
    forceConservativeRecovery() {
        const oldDelay = this.currentDelay;
        const oldParallel = this.currentParallel;
        
        // Configuração muito conservadora
        this.currentDelay = Math.min(ADAPTIVE_CONFIG.MAX_DELAY, this.currentDelay * ADAPTIVE_CIRCUIT_BREAKER.RECOVERY_CONFIG_MULTIPLIER);
        this.currentParallel = Math.max(ADAPTIVE_CONFIG.MIN_PARALLEL, Math.floor(this.currentParallel / ADAPTIVE_CIRCUIT_BREAKER.RECOVERY_CONFIG_MULTIPLIER));
        
        this.adaptiveCircuitBreakerActive = true;
        this.lastRecoveryTime = Date.now();
        
        console.log(`🛡️ RECUPERAÇÃO FORÇADA: ${oldDelay}ms/${oldParallel}p → ${this.currentDelay}ms/${this.currentParallel}p`);
        
        return {
            oldDelay,
            oldParallel,
            newDelay: this.currentDelay,
            newParallel: this.currentParallel
        };
    }
    
    // Verifica se pode sair do modo de recuperação
    checkRecoveryExit() {
        if (!this.adaptiveCircuitBreakerActive) return false;
        
        const currentPerformance = this.calculateCurrentPerformance();
        if (!currentPerformance) return false;
        
        // Sai do modo de recuperação se:
        // 1. Performance melhorou significativamente (>80% sucesso)
        // 2. Passou tempo suficiente (pelo menos 5 lotes)
        const hasGoodPerformance = currentPerformance.successRate > 0.80;
        const hasEnoughBatches = this.batchHistory.length >= 5;
        
        if (hasGoodPerformance && hasEnoughBatches) {
            this.adaptiveCircuitBreakerActive = false;
            console.log(`✅ SAINDO DO MODO RECUPERAÇÃO: Performance estabilizada em ${(currentPerformance.successRate * 100).toFixed(1)}%`);
            return true;
        }
        
        return false;
    }
    
    // Aplica configuração conservadora após detectar degradação
    applyConservativeConfiguration() {
        const oldDelay = this.currentDelay;
        const oldParallel = this.currentParallel;
        
        // Volta para configuração conservadora
        this.currentDelay = Math.min(ADAPTIVE_CONFIG.MAX_DELAY, this.currentDelay * 2);
        this.currentParallel = Math.max(ADAPTIVE_CONFIG.MIN_PARALLEL, Math.floor(this.currentParallel / 2));
        
        console.log(`🛡️ CONFIGURAÇÃO CONSERVADORA APLICADA: ${oldDelay}ms/${oldParallel}p → ${this.currentDelay}ms/${this.currentParallel}p`);
        
        return {
            oldDelay,
            oldParallel,
            newDelay: this.currentDelay,
            newParallel: this.currentParallel
        };
    }
    
    optimizeSettings(batchIndex) {
        const performance = this.calculateCurrentPerformance();
        if (!performance) return false;
        
        // Salva performance antes da otimização para detectar degradação
        this.lastOptimizationPerformance = { ...performance };
        
        const { successRate, avgBatchTime, efficiency } = performance;
        let changed = false;
        let reasoning = [];
        
        // Salva melhor configuração encontrada
        if (!this.bestConfig || efficiency > this.bestConfig.efficiency) {
            this.bestConfig = {
                delay: this.currentDelay,
                parallel: this.currentParallel,
                successRate,
                efficiency,
                avgBatchTime,
                batchIndex
            };
            reasoning.push(`🏆 Nova melhor config (eficiência: ${efficiency.toFixed(2)})`);
        }
        
        // Detecta degradação antes de otimizar
        if (this.lastOptimizationPerformance) {
            const performanceDrop = this.lastOptimizationPerformance.successRate - performance.successRate;
            if (performanceDrop > ADAPTIVE_CONFIG.DEGRADATION_ALERT_THRESHOLD) {
                console.log(`⚠️  DEGRADAÇÃO DETECTADA: Performance caiu ${(performanceDrop * 100).toFixed(1)}% após última otimização`);
                console.log(`   � Anterior: ${(this.lastOptimizationPerformance.successRate * 100).toFixed(1)}% → Atual: ${(performance.successRate * 100).toFixed(1)}%`);
                // Reverte para configuração mais conservadora
                this.applyConservativeConfiguration();
                return true;
            }
        }
        
        // === LÓGICA CONSERVADORA E GRADUAL ===
        if (successRate >= ADAPTIVE_CONFIG.AGGRESSIVE_INCREASE_THRESHOLD) {
            // Excelente performance (95%+) - aumenta GRADUALMENTE
            if (this.currentParallel < ADAPTIVE_CONFIG.MAX_PARALLEL) {
                const increase = Math.min(ADAPTIVE_CONFIG.MAX_PARALLEL_INCREASE, ADAPTIVE_CONFIG.MAX_PARALLEL - this.currentParallel);
                this.currentParallel += increase;
                reasoning.push(`🚀 Paralelismo +${increase} (excelente: ${(successRate * 100).toFixed(1)}%)`);
                changed = true;
            } else if (this.currentDelay > ADAPTIVE_CONFIG.MIN_DELAY) {
                const decrease = Math.min(ADAPTIVE_CONFIG.MAX_DELAY_DECREASE, this.currentDelay - ADAPTIVE_CONFIG.MIN_DELAY);
                this.currentDelay -= decrease;
                reasoning.push(`⏱️  Delay -${decrease}ms (performance excelente)`);
                changed = true;
            }
        } else if (successRate >= ADAPTIVE_CONFIG.GENTLE_INCREASE_THRESHOLD) {
            // Boa performance (90%+) - aumenta MUITO GRADUALMENTE
            if (avgBatchTime < 12000 && this.currentParallel < ADAPTIVE_CONFIG.MAX_PARALLEL) {
                this.currentParallel += 1; // Apenas +1
                reasoning.push(`📈 Paralelismo +1 (tempo bom: ${(avgBatchTime/1000).toFixed(1)}s)`);
                changed = true;
            } else if (this.currentDelay > ADAPTIVE_CONFIG.MIN_DELAY + 200) { // Mantém margem de segurança
                this.currentDelay = Math.max(this.currentDelay - 200, ADAPTIVE_CONFIG.MIN_DELAY + 200);
                reasoning.push(`⏱️  Delay -200ms (performance boa)`);
                changed = true;
            }
        } else if (successRate < ADAPTIVE_CONFIG.DECREASE_THRESHOLD) {
            // Performance ruim (< 80%) - reação IMEDIATA e FORTE
            if (this.currentParallel > ADAPTIVE_CONFIG.MIN_PARALLEL) {
                const decrease = Math.max(1, Math.floor(this.currentParallel / 2)); // Reduz pela metade
                this.currentParallel = Math.max(this.currentParallel - decrease, ADAPTIVE_CONFIG.MIN_PARALLEL);
                reasoning.push(`🐌 Paralelismo -${decrease} (sucesso baixo: ${(successRate * 100).toFixed(1)}%)`);
                changed = true;
            }
            if (this.currentDelay < ADAPTIVE_CONFIG.MAX_DELAY) {
                this.currentDelay = Math.min(this.currentDelay + 600, ADAPTIVE_CONFIG.MAX_DELAY); // +600ms imediato
                reasoning.push(`🛑 Delay +600ms (performance ruim)`);
                changed = true;
            }
        } else {
            // Performance ok (80-90%) - mantém configuração ou ajuste mínimo
            if (avgBatchTime > 20000) { // Se está muito lento
                if (this.currentDelay > ADAPTIVE_CONFIG.MIN_DELAY + 400) {
                    this.currentDelay = Math.max(this.currentDelay - 100, ADAPTIVE_CONFIG.MIN_DELAY + 400);
                    reasoning.push(`⏱️  Delay -100ms (muito lento: ${(avgBatchTime/1000).toFixed(1)}s)`);
                    changed = true;
                }
            }
        }
        
        if (changed) {
            this.optimizationAttempts++;
            this.lastOptimization = batchIndex;
            
            const logMessage = `OTIMIZAÇÃO #${this.optimizationAttempts} - Lote ${batchIndex}: ` +
                             `${(successRate * 100).toFixed(1)}% sucesso, ${(avgBatchTime/1000).toFixed(1)}s/lote | ` +
                             `Config: ${this.currentDelay}ms, ${this.currentParallel} parallel | ` +
                             `Motivo: ${reasoning.join(', ')}`;
            
            console.log(`🧠 OTIMIZAÇÃO #${this.optimizationAttempts} (Lote ${batchIndex}):`);
            console.log(`   📊 Performance: ${(successRate * 100).toFixed(1)}% sucesso, ${(avgBatchTime/1000).toFixed(1)}s/lote`);
            console.log(`   ⚙️  Nova config: ${this.currentDelay}ms delay, ${this.currentParallel} parallel`);
            console.log(`   💡 Motivo: ${reasoning.join(', ')}`);
            
            // Log para arquivo para análise posterior
            appendToAdaptiveLog(logMessage);
            
            return true;
        }
        
        return false;
    }
    
    logDetailedStats(batchIndex) {
        if (batchIndex % ADAPTIVE_CONFIG.LOG_INTERVAL !== 0) return;
        
        const performance = this.calculateCurrentPerformance();
        if (!performance) return;
        
        console.log(`\n📈 RELATÓRIO ADAPTATIVO - Lote ${batchIndex}:`);
        console.log(`   🎯 Taxa de sucesso: ${(performance.successRate * 100).toFixed(1)}%`);
        console.log(`   ⏱️  Tempo médio/lote: ${(performance.avgBatchTime/1000).toFixed(1)}s`);
        console.log(`   🚀 Bundles/segundo: ${performance.bundlesPerSecond.toFixed(2)}`);
        console.log(`   ⚡ Eficiência: ${performance.efficiency.toFixed(2)}`);
        console.log(`   ⚙️  Config atual: ${this.currentDelay}ms, ${this.currentParallel} parallel`);
        
        if (this.bestConfig) {
            console.log(`   🏆 Melhor config: ${this.bestConfig.delay}ms, ${this.bestConfig.parallel} parallel (lote ${this.bestConfig.batchIndex})`);
        }
        
        if (this.failedBundles.size > 0) {
            console.log(`   ❌ Bundles problemáticos: ${this.failedBundles.size} únicos`);
        }
        
        console.log(`   🔧 Otimizações: ${this.optimizationAttempts}\n`);
    }
    
    getFailedBundlesReport() {
        return {
            count: this.failedBundles.size,
            ids: Array.from(this.failedBundles)
        };
    }
    
    getCurrentConfig() {
        return {
            delay: this.currentDelay,
            parallel: this.currentParallel,
            optimizations: this.optimizationAttempts,
            bestConfig: this.bestConfig
        };
    }
}

console.log('🔧 Configurações da API Steam (OTIMIZADA):', STEAM_API_CONFIG);
console.log(`💾 Modo Render Free: Salvamento a cada ${SAVE_INTERVAL_BATCHES} lotes`);

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Função para limpar/resetar o log (Render Free - evita crescimento infinito)
const resetLog = async () => {
    try {
        if (fsSync.existsSync(LOG_FILE)) {
            await fsPromises.unlink(LOG_FILE);
            console.log('🗑️ Log anterior removido para economizar espaço (Render Free)');
        }
    } catch (error) {
        console.warn('⚠️ Erro ao limpar log anterior:', error.message);
    }
};

// 🆕 Função para rotacionar logs adaptativos (evita crescimento infinito)
const rotateAdaptiveLog = async () => {
    const ADAPTIVE_LOG_OLD_FILE = path.join(__dirname, 'adaptive_performance-old.log');
    
    try {
        // Se existe log adaptativo atual
        if (fsSync.existsSync(ADAPTIVE_LOG_FILE)) {
            // Remove log -old anterior se existir
            if (fsSync.existsSync(ADAPTIVE_LOG_OLD_FILE)) {
                await fsPromises.unlink(ADAPTIVE_LOG_OLD_FILE);
            }
            
            // Move log atual para -old
            await fsPromises.rename(ADAPTIVE_LOG_FILE, ADAPTIVE_LOG_OLD_FILE);
            console.log('🔄 Log adaptativo rotacionado: atual → old');
        }
    } catch (error) {
        console.warn('⚠️ Erro ao rotacionar log adaptativo:', error.message);
    }
};

// Função auxiliar para o logger
const appendToLog = async (message) => {
    const timestamp = new Date().toISOString();
    try {
        await fsPromises.appendFile(LOG_FILE, `[${timestamp}] ${message}\n`);
    } catch (error) {
        console.error('Falha ao escrever no ficheiro de log:', error);
    }
};

// Função para log adaptativo com controle de tamanho
const appendToAdaptiveLog = async (message) => {
    const timestamp = new Date().toISOString();
    
    try {
        // Verifica tamanho do arquivo antes de escrever
        let shouldRotate = false;
        let fileSizeMB = 0;
        
        if (fsSync.existsSync(ADAPTIVE_LOG_FILE)) {
            const stats = await fsPromises.stat(ADAPTIVE_LOG_FILE);
            fileSizeMB = stats.size / (1024 * 1024);
            
            // Se arquivo > 5MB, rotaciona (conservador para Render Free)
            if (fileSizeMB > 5) {
                shouldRotate = true;
            }
        }
        
        if (shouldRotate) {
            console.log(`📊 Log adaptativo grande (${Math.round(fileSizeMB * 100) / 100}MB), rotacionando...`);
            await rotateAdaptiveLog();
        }
        
        await fsPromises.appendFile(ADAPTIVE_LOG_FILE, `[${timestamp}] ${message}\n`);
    } catch (error) {
        console.error('Falha ao escrever no log adaptativo:', error);
    }
};

/**
 * [NOVO - FALLBACK] Busca detalhes via API de apps quando o scraping falha.
 * @param {number[]} appIds - Array de IDs de aplicativos do bundle.
 * @returns {Promise<object>} - Objeto com gêneros, categorias, etc., agregados.
 */
const getDetailsFromApps = async (appIds) => {
    if (!appIds || appIds.length === 0) {
        return { genres: [], categories: [], developers: [] };
    }

    const allGenres = new Set();
    const allCategories = new Set();
    const allDevelopers = new Set();
    
    // Limita e processa em lotes menores para evitar erro 400
    const appIdsToProcess = appIds.slice(0, 20); // Reduzido de 30 para 20
    const batchSize = 5; // Processa 5 apps por vez

    try {
        for (let i = 0; i < appIdsToProcess.length; i += batchSize) {
            const batch = appIdsToProcess.slice(i, i + batchSize);
            
            // Tenta requisição individual se o lote falhar
            for (const appId of batch) {
                try {
                    // Sem parâmetros cc e l para evitar erro 400
                    const url = `https://store.steampowered.com/api/appdetails?appids=${appId}`;
                    const response = await axios.get(url, { 
                        timeout: 10000,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        }
                    });
                    
                    const appData = response.data;
                    const details = appData[appId];
                    
                    if (details && details.success && details.data) {
                        details.data.genres?.forEach(g => allGenres.add(g.description));
                        details.data.categories?.forEach(c => allCategories.add(c.description));
                        details.data.developers?.forEach(d => allDevelopers.add(d));
                    }
                    
                    await delay(500); // Aumento do delay para evitar rate limiting
                    
                } catch (singleError) {
                    // Log apenas se não for erro conhecido
                    if (!singleError.response || singleError.response.status !== 400) {
                        await appendToLog(`FALLBACK INFO: App ${appId} falhou (${singleError.response?.status || 'timeout'}), continuando...`);
                    }
                }
            }
            
            // Pausa entre lotes
            await delay(1000);
        }

    } catch (error) {
        await appendToLog(`ERRO DE FALLBACK: Falha geral ao buscar appdetails. Erro: ${error.message}`);
    }

    return {
        genres: Array.from(allGenres),
        categories: Array.from(allCategories),
        developers: Array.from(allDevelopers)
    };
};

const loadUpdateState = () => {
    try {
        if (fsSync.existsSync(UPDATE_STATE_FILE)) {
            const state = JSON.parse(fsSync.readFileSync(UPDATE_STATE_FILE, 'utf-8'));
            console.log(`📋 Estado de atualização encontrado: ${state.status} (${state.completed}/${state.total})`);
            return state;
        }
    } catch (error) {
        console.warn('⚠️ Erro ao carregar estado de atualização:', error.message);
    }
    return null;
};

const saveUpdateState = async (state) => {
    try {
        const stateWithTimestamp = {
            ...state,
            lastSaved: new Date().toISOString(),
            lastActivity: new Date().toISOString()
        };
        await fs.writeFile(UPDATE_STATE_FILE, JSON.stringify(stateWithTimestamp, null, 2), 'utf-8');
    } catch (error) {
        console.error('❌ Erro ao salvar estado de atualização:', error.message);
    }
};

const clearUpdateState = async () => {
    try {
        await fs.unlink(UPDATE_STATE_FILE);
        console.log('🗑️ Estado de atualização limpo');
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.warn('⚠️ Erro ao limpar estado de atualização:', error.message);
        }
    }
};

// --- VERIFICAÇÃO RÁPIDA DE STATUS ---
const quickStatusCheck = async (filePath) => {
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
};

const createInitialUpdateState = (bundlesToProcess, limitForTesting, language) => {
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
};

const getMemoryUsage = () => {
    const used = process.memoryUsage();
    return {
        rss: Math.round(used.rss / 1024 / 1024 * 100) / 100,
        heapUsed: Math.round(used.heapUsed / 1024 / 1024 * 100) / 100,
        heapTotal: Math.round(used.heapTotal / 1024 / 1024 * 100) / 100
    };
};

const saveDetailedBundlesData = async (detailedBundles, bundlesToProcess, isComplete = false, isTestMode = false, startTime, updateState = null) => {
    const memory = getMemoryUsage();
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
        last_update: moment().tz(TIMEZONE).format(),
        lastSaved: new Date().toISOString(),
        processingTimeSeconds: totalTime,
        bundlesPerSecond: detailedBundles.length / totalTime,
        
        // CONFIGURAÇÕES
        isTestMode: !!isTestMode,
        memoryUsage: memory,
        
        // DADOS PRINCIPAIS (no final para otimizar leitura)
        bundles: detailedBundles
    };
    
    const outputFile = isTestMode ? './bundleDetailed_test.json' : BUNDLES_DETAILED_FILE;
    
    try {
        await fs.writeFile(outputFile, JSON.stringify(result, null, 2), 'utf-8');
        
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
};

// Função específica para lidar com verificação de idade
const handleAgeVerification = async (bundlePageUrl, headers) => {
    try {
        console.log(`🔞 Detectada página de verificação de idade, enviando confirmação...`);
        
        // Dados para confirmar idade (18+)
        const ageVerificationData = {
            snr: '1_4_4__',
            sessionid: '', // Steam usa sessionid, mas pode funcionar vazio
            ageDay: '1',
            ageMonth: 'January',
            ageYear: '1990'
        };
        
        // Faz POST para confirmar idade
        const ageConfirmResponse = await axios.post(
            'https://store.steampowered.com/agecheckset/bundle/',
            new URLSearchParams(ageVerificationData),
            {
                headers: {
                    ...headers,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Referer': bundlePageUrl,
                    'Origin': 'https://store.steampowered.com'
                },
                timeout: 15000
            }
        );
        
        await delay(1000); // Pequeno delay após confirmação
        
        // Tenta acessar a página novamente
        const retryResponse = await axios.get(bundlePageUrl, { 
            headers, 
            timeout: 20000 
        });
        
        return retryResponse;
        
    } catch (error) {
        console.log(`❌ Erro ao lidar com verificação de idade: ${error.message}`);
        throw error;
    }
};

// Função principal para buscar detalhes de bundle
const fetchBundleDetails = async (bundleId, language = 'brazilian') => {
    const bundleApiUrl = `https://store.steampowered.com/actions/ajaxresolvebundles?bundleids=${bundleId}&cc=BR&l=${language}`;
    const bundlePageUrl = `https://store.steampowered.com/bundle/${bundleId}/`;

    const browserHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
    };

    for (let attempt = 1; attempt <= STEAM_API_CONFIG.MAX_RETRIES; attempt++) {
        try {
            const apiResponse = await axios.get(bundleApiUrl, { headers: browserHeaders });
            if (!apiResponse.data || !apiResponse.data[0]) {
                return { success: false, reason: 'API_NO_DATA' };
            }
            const bundleData = apiResponse.data[0];

            // Atraso mais longo e mais aleatório para parecer mais humano
            await delay(2500 + Math.random() * 3000); // Espera entre 2.5 e 5.5 segundos

            const pageResponse = await axios.get(bundlePageUrl, { headers: browserHeaders, timeout: STEAM_API_CONFIG.REQUEST_TIMEOUT });
            
            // 🆕 DETECÇÃO DE NSFW - Verifica se foi redirecionado para login
            const finalUrl = pageResponse.request?.res?.responseUrl || pageResponse.config.url;
            const isNSFWRedirect = finalUrl.includes('store.steampowered.com/login') && 
                                 (finalUrl.includes('agecheck') || finalUrl.includes('redir=agecheck'));
            
            if (isNSFWRedirect) {
                console.log(`🔞 NSFW DETECTADO: Bundle ${bundleId} - Redirecionado para login (conteúdo adulto)`);
                await appendToLog(`NSFW DETECTED: Bundle ID ${bundleId} - Redirecionado para ${finalUrl}`);
                
                // Retorna bundle com categorização manual NSFW
                return {
                    success: true,
                    data: { 
                        ...bundleData, 
                        page_details: {
                            gênero: ['NSFW', 'Adult Content'],
                            categoria: ['Adult Only'],
                            desenvolvedor: ['N/A - Adult Content'],
                            distribuidora: ['N/A - Adult Content'],
                            idiomas: ['N/A - Adult Content'],
                            descritores_de_conteúdo: ['Adult Content - Login Required'],
                            nsfw_detected: true,
                            redirect_url: finalUrl
                        }, 
                        processed_at: new Date().toISOString(), 
                        api_version: '6.0-conservative-nsfw-detection',
                        nsfw_auto_categorized: true
                    },
                    extractionFailed: false,
                    nsfwDetected: true
                };
            }
            
            let $ = cheerio.load(pageResponse.data);

            // Verificação de página de confirmação de idade
            const pageTitle = $('title').text();
            const hasAgeCheck = pageTitle.includes('Age Check') || 
                              $('form[action*="agecheckset"]').length > 0 ||
                              $('input[name="ageDay"]').length > 0 ||
                              $('.agegate').length > 0;

            if (hasAgeCheck) {
                console.log(`🔞 Detectada verificação de idade para Bundle ${bundleId}, processando...`);
                await appendToLog(`AGE VERIFICATION: Bundle ID ${bundleId} requer confirmação de idade`);
                
                try {
                    const retryResponse = await handleAgeVerification(bundlePageUrl, browserHeaders);
                    $ = cheerio.load(retryResponse.data);
                    console.log(`✅ Verificação de idade processada para Bundle ${bundleId}`);
                } catch (ageError) {
                    console.log(`❌ Falha na verificação de idade para Bundle ${bundleId}: ${ageError.message}`);
                    await appendToLog(`AGE VERIFICATION FAILED: Bundle ID ${bundleId} - ${ageError.message}`);
                    return { success: false, reason: 'AGE_VERIFICATION_FAILED' };
                }
            }

            // Validação de página: Verifica se a página recebida é a correta
            if (!pageTitle.includes(bundleData.name.substring(0, 10))) {
                await appendToLog(`AVISO DE VALIDAÇÃO: Título da página inválido para o Bundle ID ${bundleId} (Link: ${bundlePageUrl}). Provavelmente é uma página de erro/captcha.`);
                return { success: false, reason: 'INVALID_PAGE' };
            }

            const pageDetails = {};

            // --- LÓGICA DE EXTRAÇÃO PRECISA ---
            const findValuesForLabel = (label) => {
                const values = new Set();
                const labelElement = $(`.details_block b:contains("${label}")`);

                if (labelElement.length > 0) {
                    // Tenta encontrar um <span> adjacente primeiro (caso comum)
                    const span = labelElement.next('span');
                    if (span.length > 0) {
                        span.find('a').each((i, el) => values.add($(el).text().trim()));
                        return Array.from(values);
                    }

                    // Se não houver <span>, procura por links <a> soltos até o próximo <br>
                    let currentNode = labelElement[0].nextSibling;
                    while (currentNode && currentNode.tagName !== 'br') {
                        if (currentNode.type === 'tag' && currentNode.tagName === 'a') {
                            values.add($(currentNode).text().trim());
                        }
                        currentNode = currentNode.nextSibling;
                    }
                }
                return Array.from(values);
            };

            pageDetails.gênero = findValuesForLabel('Gênero:');
            pageDetails.desenvolvedor = findValuesForLabel('Desenvolvedor:');
            pageDetails.distribuidora = findValuesForLabel('Distribuidora:');
            pageDetails.série = findValuesForLabel('Série:');

            // Lógica para idiomas e descritores (mantida)
            const languagesText = $('.language_list').text();
            if (languagesText) {
                const cleanText = languagesText.replace(/Idiomas:/i, '').split('Os idiomas listados')[0];
                pageDetails.idiomas = cleanText.split(',').map(lang => lang.trim()).filter(Boolean);
            }
            const descriptors = $('.game_rating_area .descriptorText').html();
            if (descriptors) {
                pageDetails.descritores_de_conteúdo = descriptors.split('<br>').map(d => d.trim()).filter(Boolean);
            }

            // --- LÓGICA DE FALLBACK ---
            if (pageDetails.gênero.length === 0 && bundleData.appids && bundleData.appids.length > 0) {
                console.log(`⚠️  Scraping falhou para ${bundleData.name}. Ativando fallback via API de Apps...`);
                await appendToLog(`INFO: Ativando fallback para o Bundle ID ${bundleId} (Link: ${bundlePageUrl}).`);
                
                const detailsFromApps = await getDetailsFromApps(bundleData.appids);
                
                pageDetails.gênero = detailsFromApps.genres;
                pageDetails.categoria = detailsFromApps.categories;
                // Se o scraping não pegou desenvolvedor, usa o da API
                if (!pageDetails.desenvolvedor || pageDetails.desenvolvedor.length === 0) {
                    pageDetails.desenvolvedor = detailsFromApps.developers;
                }
            }

            const extractionSuccess = pageDetails.gênero && pageDetails.gênero.length > 0;
            if (!extractionSuccess) {
                 await appendToLog(`AVISO FINAL: Extração falhou para o Bundle ID ${bundleId} (Link: ${bundlePageUrl}), mesmo após o fallback.`);
                 console.log(`❌ [ID: ${bundleData.bundleid}] Falha na extração de ${bundleData.name}`);
            } else {
                console.log(`✅ [ID: ${bundleData.bundleid}] ${bundleData.name} (Gêneros: ${pageDetails.gênero.length}, Devs: ${pageDetails.desenvolvedor?.length || 0})`);
            }
            
            return {
                success: true,
                data: { 
                    ...bundleData, 
                    page_details: pageDetails, 
                    processed_at: new Date().toISOString(), 
                    api_version: '5.8-ultra-aggressive' 
                },
                extractionFailed: !extractionSuccess
            };

        } catch (error) {
            const statusCode = error.response?.status;
            
            // --- DETECÇÃO DE PÁGINAS NÃO ENCONTRADAS ---
            if (statusCode === 404 || statusCode === 410) {
                await appendToLog(`INFO: Bundle ID ${bundleId} - Página não encontrada (${statusCode}). Bundle possivelmente removido ou indisponível na região.`);
                console.log(`⚠️  [ID: ${bundleId}] Página não encontrada (${statusCode})`);
                return { success: false, reason: 'PAGE_NOT_FOUND' };
            }
            
            await appendToLog(`ERRO: Tentativa ${attempt} para o Bundle ID ${bundleId} (Link: ${bundlePageUrl}). Status: ${statusCode || 'desconhecido'}. Erro: ${error.message}`);
            
            if (attempt === STEAM_API_CONFIG.MAX_RETRIES) {
                console.log(`❌ [ID: ${bundleId}] Máximo de tentativas atingido`);
                return { success: false, reason: 'MAX_RETRIES_REACHED' };
            }
            await delay(5000 * attempt); // Aumenta a espera entre retentativas se houver erro
        }
    }
    return { success: false, reason: 'UNKNOWN_FAILURE' };
};

// Função específica para retry com configurações conservadoras
const retryFailedBundle = async (bundleId, language = 'brazilian') => {
    const bundleApiUrl = `https://store.steampowered.com/actions/ajaxresolvebundles?bundleids=${bundleId}&cc=BR&l=${language}`;
    const bundlePageUrl = `https://store.steampowered.com/bundle/${bundleId}/`;

    const conservativeHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
    };

    for (let attempt = 1; attempt <= RETRY_CONFIG.RETRY_MAX_ATTEMPTS; attempt++) {
        try {
            console.log(`🔄 RETRY [${attempt}/${RETRY_CONFIG.RETRY_MAX_ATTEMPTS}] Bundle ${bundleId}...`);
            
            // Delay mais longo para retry
            if (attempt > 1) {
                await delay(RETRY_CONFIG.RETRY_DELAY * attempt);
            }
            
            const apiResponse = await axios.get(bundleApiUrl, { 
                headers: conservativeHeaders,
                timeout: RETRY_CONFIG.RETRY_TIMEOUT
            });
            
            if (!apiResponse.data || !apiResponse.data[0]) {
                console.log(`⚠️  RETRY: Bundle ${bundleId} - API sem dados`);
                return { success: false, reason: 'API_NO_DATA_RETRY' };
            }
            
            const bundleData = apiResponse.data[0];

            // Delay muito conservador entre requisições
            await delay(RETRY_CONFIG.RETRY_DELAY + Math.random() * 2000); 

            const pageResponse = await axios.get(bundlePageUrl, { 
                headers: conservativeHeaders, 
                timeout: RETRY_CONFIG.RETRY_TIMEOUT 
            });
            
            // 🆕 DETECÇÃO DE NSFW NO RETRY - Verifica se foi redirecionado para login
            const finalUrl = pageResponse.request?.res?.responseUrl || pageResponse.config.url;
            const isNSFWRedirect = finalUrl.includes('store.steampowered.com/login') && 
                                 (finalUrl.includes('agecheck') || finalUrl.includes('redir=agecheck'));
            
            if (isNSFWRedirect) {
                console.log(`🔞 RETRY NSFW DETECTADO: Bundle ${bundleId} - Redirecionado para login (conteúdo adulto)`);
                await appendToLog(`RETRY NSFW DETECTED: Bundle ID ${bundleId} - Redirecionado para ${finalUrl}`);
                
                // Retorna bundle com categorização manual NSFW
                return {
                    success: true,
                    data: { 
                        ...bundleData, 
                        page_details: {
                            gênero: ['NSFW', 'Adult Content'],
                            categoria: ['Adult Only'],
                            desenvolvedor: ['N/A - Adult Content'],
                            distribuidora: ['N/A - Adult Content'],
                            idiomas: ['N/A - Adult Content'],
                            descritores_de_conteúdo: ['Adult Content - Login Required'],
                            nsfw_detected: true,
                            redirect_url: finalUrl
                        }, 
                        processed_at: new Date().toISOString(), 
                        api_version: '6.0-conservative-nsfw-detection-retry',
                        nsfw_auto_categorized: true,
                        retry_attempt: attempt
                    },
                    extractionFailed: false,
                    nsfwDetected: true
                };
            }
            
            let $ = cheerio.load(pageResponse.data);

            // Verificação de página de confirmação de idade no retry
            const pageTitle = $('title').text();
            const hasAgeCheck = pageTitle.includes('Age Check') || 
                              $('form[action*="agecheckset"]').length > 0 ||
                              $('input[name="ageDay"]').length > 0 ||
                              $('.agegate').length > 0;

            if (hasAgeCheck) {
                console.log(`🔞 RETRY: Detectada verificação de idade para Bundle ${bundleId}, processando...`);
                await appendToLog(`RETRY AGE VERIFICATION: Bundle ID ${bundleId} requer confirmação de idade`);
                
                try {
                    const retryResponse = await handleAgeVerification(bundlePageUrl, conservativeHeaders);
                    $ = cheerio.load(retryResponse.data);
                    console.log(`✅ RETRY: Verificação de idade processada para Bundle ${bundleId}`);
                } catch (ageError) {
                    console.log(`❌ RETRY: Falha na verificação de idade para Bundle ${bundleId}: ${ageError.message}`);
                    await appendToLog(`RETRY AGE VERIFICATION FAILED: Bundle ID ${bundleId} - ${ageError.message}`);
                    return { success: false, reason: 'AGE_VERIFICATION_FAILED_RETRY' };
                }
            }

            // Validação mais rigorosa na retry
            if (!pageTitle || pageTitle.includes('Error') || pageTitle.includes('503') || 
                !pageTitle.includes(bundleData.name.substring(0, Math.min(8, bundleData.name.length)))) {
                console.log(`⚠️  RETRY: Bundle ${bundleId} - Página inválida ou erro`);
                await appendToLog(`RETRY: Página inválida para Bundle ID ${bundleId} - Título: "${pageTitle}"`);
                continue; // Tenta novamente
            }

            const pageDetails = {};

            // Mesmo processo de extração da função original
            const findValuesForLabel = (label) => {
                const values = new Set();
                const labelElement = $(`.details_block b:contains("${label}")`);

                if (labelElement.length > 0) {
                    const span = labelElement.next('span');
                    if (span.length > 0) {
                        span.find('a').each((i, el) => values.add($(el).text().trim()));
                        return Array.from(values);
                    }

                    let currentNode = labelElement[0].nextSibling;
                    while (currentNode && currentNode.tagName !== 'br') {
                        if (currentNode.type === 'tag' && currentNode.tagName === 'a') {
                            values.add($(currentNode).text().trim());
                        }
                        currentNode = currentNode.nextSibling;
                    }
                }
                return Array.from(values);
            };

            pageDetails.gênero = findValuesForLabel('Gênero:');
            pageDetails.desenvolvedor = findValuesForLabel('Desenvolvedor:');
            pageDetails.distribuidora = findValuesForLabel('Distribuidora:');
            pageDetails.série = findValuesForLabel('Série:');

            const languagesText = $('.language_list').text();
            if (languagesText) {
                const cleanText = languagesText.replace(/Idiomas:/i, '').split('Os idiomas listados')[0];
                pageDetails.idiomas = cleanText.split(',').map(lang => lang.trim()).filter(Boolean);
            }
            
            const descriptors = $('.game_rating_area .descriptorText').html();
            if (descriptors) {
                pageDetails.descritores_de_conteúdo = descriptors.split('<br>').map(d => d.trim()).filter(Boolean);
            }

            // Fallback mais agressivo na retry
            if ((!pageDetails.gênero || pageDetails.gênero.length === 0) && bundleData.appids && bundleData.appids.length > 0) {
                console.log(`🔄 RETRY: Ativando fallback para Bundle ${bundleId}...`);
                await appendToLog(`RETRY: Fallback ativado para Bundle ID ${bundleId}`);
                
                const detailsFromApps = await getDetailsFromApps(bundleData.appids);
                
                pageDetails.gênero = detailsFromApps.genres;
                pageDetails.categoria = detailsFromApps.categories;
                if (!pageDetails.desenvolvedor || pageDetails.desenvolvedor.length === 0) {
                    pageDetails.desenvolvedor = detailsFromApps.developers;
                }
            }

            const extractionSuccess = pageDetails.gênero && pageDetails.gênero.length > 0;
            
            if (extractionSuccess) {
                console.log(`✅ RETRY SUCCESS: Bundle ${bundleId} processado com sucesso`);
                await appendToLog(`RETRY SUCCESS: Bundle ID ${bundleId} processado com sucesso após retry`);
            } else {
                console.log(`❌ RETRY FAILED: Bundle ${bundleId} - Extração ainda falhou`);
                await appendToLog(`RETRY FAILED: Bundle ID ${bundleId} - Extração falhou mesmo no retry`);
            }
            
            return {
                success: true,
                data: { 
                    ...bundleData, 
                    page_details: pageDetails, 
                    processed_at: new Date().toISOString(), 
                    api_version: '5.6-adaptive-retry',
                    retry_attempt: attempt
                },
                extractionFailed: !extractionSuccess
            };

        } catch (error) {
            const statusCode = error.response?.status;
            
            console.log(`❌ RETRY ERROR [${attempt}/${RETRY_CONFIG.RETRY_MAX_ATTEMPTS}]: Bundle ${bundleId} - ${error.message}`);
            await appendToLog(`RETRY ERROR: Tentativa ${attempt} para Bundle ID ${bundleId}. Status: ${statusCode || 'unknown'}. Erro: ${error.message}`);
            
            if (statusCode === 404 || statusCode === 410) {
                return { success: false, reason: 'PAGE_NOT_FOUND_RETRY' };
            }
            
            if (attempt === RETRY_CONFIG.RETRY_MAX_ATTEMPTS) {
                return { success: false, reason: 'MAX_RETRIES_REACHED_RETRY' };
            }
        }
    }
    
    return { success: false, reason: 'RETRY_FAILED' };
};

// Função para processar bundles que falharam
const processFailedBundles = async (existingDetailedBundles = []) => {
    const failedManager = new FailedBundlesManager();
    
    console.log('\n🔄 INICIANDO PROCESSAMENTO DE RETRY...');
    
    // Carrega queue de falhas salva
    const loaded = await failedManager.loadFailedQueue();
    if (!loaded) {
        console.log('📭 Nenhuma queue de falhas encontrada.');
        return { success: true, processed: 0, recovered: 0 };
    }
    
    const retryQueue = failedManager.getRetryQueue();
    if (retryQueue.length === 0) {
        console.log('📭 Nenhum bundle elegível para retry.');
        return { success: true, processed: 0, recovered: 0 };
    }
    
    console.log(`🎯 Processando ${retryQueue.length} bundles com configuração conservadora:`);
    console.log(`   ⏱️  Delay: ${RETRY_CONFIG.RETRY_DELAY}ms`);
    console.log(`   🔄 Paralelismo: ${RETRY_CONFIG.RETRY_PARALLEL} (sequencial)`);
    console.log(`   ⏰ Timeout: ${RETRY_CONFIG.RETRY_TIMEOUT}ms`);
    
    const retryStartTime = Date.now();
    const recoveredBundles = [];
    let processed = 0;
    let recovered = 0;
    
    // Ordena por número de tentativas (menos tentativas primeiro)
    retryQueue.sort((a, b) => a.attempts - b.attempts);
    
    for (const failedItem of retryQueue) {
        processed++;
        const { bundleId, bundle, reasons } = failedItem;
        
        console.log(`\n🔄 [${processed}/${retryQueue.length}] Retry Bundle ${bundleId}`);
        console.log(`   📋 Razões anteriores: ${Array.from(reasons).join(', ')}`);
        console.log(`   🔢 Tentativas anteriores: ${failedItem.attempts}`);
        
        try {
            const result = await retryFailedBundle(bundleId, 'brazilian');
            
            if (result.success) {
                recovered++;
                recoveredBundles.push(result.data);
                failedManager.retrySuccess++;
                
                console.log(`✅ [${processed}/${retryQueue.length}] Bundle ${bundleId} RECUPERADO!`);
                
                // Remove da queue de falhas
                failedManager.failedQueue.delete(bundleId);
            } else {
                console.log(`❌ [${processed}/${retryQueue.length}] Bundle ${bundleId} ainda falhou: ${result.reason}`);
                
                // Atualiza informações na queue
                failedManager.addFailedBundle(bundleId, bundle, result.reason, failedItem.originalIndex);
            }
            
            failedManager.retryAttempts++;
            
            // Log de progresso a cada 10 bundles
            if (processed % 10 === 0) {
                const elapsed = (Date.now() - retryStartTime) / 1000;
                const eta = (elapsed / processed) * (retryQueue.length - processed);
                console.log(`📊 Progresso retry: ${processed}/${retryQueue.length} | Recuperados: ${recovered} | ETA: ${eta.toFixed(1)}s`);
            }
            
            // Delay conservador entre processamentos
            if (processed < retryQueue.length) {
                await delay(RETRY_CONFIG.RETRY_DELAY);
            }
            
        } catch (error) {
            console.error(`❌ Erro durante retry do Bundle ${bundleId}:`, error.message);
            failedManager.addFailedBundle(bundleId, bundle, 'RETRY_EXCEPTION', failedItem.originalIndex);
        }
    }
    
    const totalTime = (Date.now() - retryStartTime) / 1000;
    const stats = failedManager.getStats();
    
    console.log(`\n🏁 RETRY CONCLUÍDO em ${totalTime.toFixed(1)}s:`);
    console.log(`   ✅ Bundles recuperados: ${recovered}/${retryQueue.length} (${(recovered/retryQueue.length*100).toFixed(1)}%)`);
    console.log(`   📊 Bundles restantes problemáticos: ${stats.total}`);
    console.log(`   🔄 Taxa de sucesso retry: ${stats.retrySuccess}/${stats.retryAttempts} (${(stats.retrySuccess/Math.max(1,stats.retryAttempts)*100).toFixed(1)}%)`);
    
    // Salva queue atualizada
    await failedManager.saveFailedQueue();
    
    // Atualiza o arquivo principal com os bundles recuperados
    if (recovered > 0) {
        console.log(`\n💾 Integrando ${recovered} bundles recuperados ao arquivo principal...`);
        
        try {
            const allBundles = [...existingDetailedBundles, ...recoveredBundles];
            const uniqueBundles = Array.from(new Map(allBundles.map(bundle => [bundle.bundleid, bundle])).values());
            
            const updatedData = {
                // STATUS E INFORMAÇÕES CRÍTICAS NO INÍCIO
                isComplete: true,
                status: 'completed',
                totalBundles: uniqueBundles.length,
                processedCount: uniqueBundles.length,
                
                // METADADOS TEMPORAIS
                last_update: moment().tz(TIMEZONE).format(),
                lastSaved: new Date().toISOString(),
                processingTimeSeconds: totalTime,
                bundlesPerSecond: recovered / totalTime,
                
                // CONFIGURAÇÕES
                isTestMode: false,
                retryStats: {
                    retryProcessed: processed,
                    retryRecovered: recovered,
                    retryTime: totalTime
                },
                
                // DADOS PRINCIPAIS (no final)
                bundles: uniqueBundles
            };
            
            await fs.writeFile(BUNDLES_DETAILED_FILE, JSON.stringify(updatedData, null, 2), 'utf-8');
            console.log(`✅ Arquivo principal atualizado: ${uniqueBundles.length} bundles totais`);
            
        } catch (error) {
            console.error('❌ Erro ao integrar bundles recuperados:', error.message);
        }
    }
    
    // Log final para arquivo
    await appendToLog(`=== RETRY CONCLUÍDO ===`);
    await appendToLog(`Processados: ${processed}, Recuperados: ${recovered}, Tempo: ${totalTime.toFixed(1)}s`);
    
    return { 
        success: true, 
        processed, 
        recovered, 
        totalTime,
        stats 
    };
};

const updateBundlesWithDetails = async (language = 'brazilian', limitForTesting = null) => {
    console.log('🚀 VERSÃO OTIMIZADA V5.8 ULTRA AGRESSIVA - Iniciando atualização...');
    if (limitForTesting) console.log(`🧪 MODO TESTE: Processando apenas ${limitForTesting} bundles`);
    
    // Inicializa os gerenciadores
    const performanceManager = new AdaptivePerformanceManager();
    const failedManager = new FailedBundlesManager();
    
    // --- LIMPEZA E ROTAÇÃO DE LOGS (RENDER FREE) ---
    if (!limitForTesting) {
        await resetLog(); // Remove log anterior para economizar espaço
        await rotateAdaptiveLog(); // Rotaciona log adaptativo atual → old
        await appendToLog(`=== NOVA ATUALIZAÇÃO INICIADA ===`);
        await appendToLog(`Versão: V6.2 Render Free Otimizada`);
        await appendToLog(`Timestamp: ${new Date().toISOString()}`);
        await appendToLog(`Language: ${language}`);
        await appendToAdaptiveLog(`=== NOVA SESSÃO ADAPTATIVA INICIADA ===`);
        await appendToAdaptiveLog(`Configuração: ${ADAPTIVE_CONFIG.MIN_DELAY}-${ADAPTIVE_CONFIG.MAX_DELAY}ms, ${ADAPTIVE_CONFIG.MIN_PARALLEL}-${ADAPTIVE_CONFIG.MAX_PARALLEL} parallel`);
        keepAlive.start('bundle-update');
    }
    
    // --- SISTEMA DE BACKUP PARA BUNDLEDETAILED.JSON ---
    const BUNDLES_DETAILED_OLD_FILE = './bundleDetailed-old.json';
    
    if (fsSync.existsSync(BUNDLES_DETAILED_FILE)) {
        try {
            console.log('📁 Arquivo bundleDetailed.json encontrado, criando backup...');
            
            // Remove backup antigo se existir
            if (fsSync.existsSync(BUNDLES_DETAILED_OLD_FILE)) {
                console.log('🗑️ Removendo backup antigo do bundleDetailed...');
                await fs.unlink(BUNDLES_DETAILED_OLD_FILE);
            }
            
            // Cria backup do arquivo atual
            await fs.rename(BUNDLES_DETAILED_FILE, BUNDLES_DETAILED_OLD_FILE);
            console.log(`✅ Backup criado: bundleDetailed.json → bundleDetailed-old.json`);
        } catch (backupError) {
            console.log(`⚠️ Erro ao criar backup do bundleDetailed.json: ${backupError.message}`);
            console.log('📄 Continuando sem backup (arquivo será sobrescrito)');
        }
    }
    
    try {
        // --- VERIFICAÇÃO RÁPIDA DE INTEGRIDADE ---
        if (fsSync.existsSync(BUNDLES_DETAILED_OLD_FILE)) {
            console.log('🔍 Verificação rápida do backup bundleDetailed-old.json...');
            
            const quickCheck = await quickStatusCheck(BUNDLES_DETAILED_OLD_FILE);
            
            if (quickCheck.quickCheck) {
                if (quickCheck.isComplete && quickCheck.status === 'completed') {
                    console.log(`✅ Backup válido e completo encontrado (${quickCheck.totalBundles} bundles)`);
                } else {
                    console.log(`📊 Backup parcial válido encontrado (${quickCheck.totalBundles} bundles processados)`);
                }
            } else {
                // Fallback para verificação completa se a rápida falhar
                console.log('🔄 Verificação rápida falhou, fazendo verificação completa...');
                try {
                    const existingData = JSON.parse(fsSync.readFileSync(BUNDLES_DETAILED_OLD_FILE, 'utf-8'));
                    
                    // Verifica estrutura básica
                    if (!existingData.bundles || !Array.isArray(existingData.bundles)) {
                        console.warn('⚠️ Backup bundleDetailed-old.json corrompido - removendo arquivo inválido...');
                        fsSync.unlinkSync(BUNDLES_DETAILED_OLD_FILE);
                    } else if (existingData.isComplete) {
                        console.log('✅ Backup válido e completo encontrado (verificação completa)');
                    } else {
                        console.log(`📊 Backup parcial válido encontrado (${existingData.bundles.length} bundles processados)`);
                    }
                } catch (parseError) {
                    console.warn('⚠️ Erro ao ler backup bundleDetailed-old.json - removendo arquivo corrompido:', parseError.message);
                    fsSync.unlinkSync(BUNDLES_DETAILED_OLD_FILE);
                }
            }
        }
        
        if (!fsSync.existsSync(BUNDLES_FILE)) {
            console.error('Arquivo bundles.json não encontrado.');
            return { success: false, error: 'Arquivo bundles.json não encontrado' };
        }
        
        const bundlesJson = JSON.parse(fsSync.readFileSync(BUNDLES_FILE, 'utf-8'));
        const bundlesToProcess = limitForTesting ? bundlesJson.bundles.slice(0, limitForTesting) : bundlesJson.bundles;
        
        let updateState = loadUpdateState();
        let detailedBundles = [];
        let startIndex = 0;
        let actualStartTime = Date.now();
        
        if (updateState && updateState.status === 'in_progress' && !limitForTesting) {
            console.log(`🔄 RESUMINDO atualização anterior:`);
            console.log(`   📊 Progresso anterior: ${updateState.completed}/${updateState.total}`);
            console.log(`   📅 Iniciado em: ${new Date(updateState.startTime).toLocaleString()}`);
            
            try {
                // --- VERIFICAÇÃO RÁPIDA DO ARQUIVO PRINCIPAL ---
                if (fsSync.existsSync(BUNDLES_DETAILED_FILE)) {
                    console.log(`   ⚡ Verificação rápida do arquivo bundleDetailed.json...`);
                    
                    const quickCheck = await quickStatusCheck(BUNDLES_DETAILED_FILE);
                    
                    if (quickCheck.quickCheck) {
                        if (quickCheck.isComplete && quickCheck.status === 'completed') {
                            console.warn('⚠️ Arquivo marcado como completo mas updateState indica progresso. Limpando estado...');
                            updateState = null;
                            detailedBundles = [];
                            startIndex = 0;
                        } else {
                            // Arquivo parcial - verifica consistência
                            const expectedBundles = Math.min(updateState.completed, bundlesToProcess.length);
                            const actualBundles = quickCheck.totalBundles;
                            
                            console.log(`   📊 Bundles esperados: ${expectedBundles}, Encontrados: ${actualBundles}`);
                            
                            if (actualBundles < expectedBundles * 0.8) { // Permite 20% de margem
                                console.warn(`   ⚠️ Discrepância nos dados: esperado ~${expectedBundles}, encontrado ${actualBundles}. Reiniciando...`);
                                updateState = null;
                                detailedBundles = [];
                                startIndex = 0;
                            } else {
                                // Precisa ler o arquivo completo para carregar os bundles
                                console.log(`   📂 Carregando dados completos para continuar...`);
                                const existingData = JSON.parse(fsSync.readFileSync(BUNDLES_DETAILED_FILE, 'utf-8'));
                                detailedBundles = existingData.bundles || [];
                                startIndex = updateState.lastProcessedIndex + 1;
                                updateState.resumeCount++;
                                console.log(`   ✅ ${detailedBundles.length} bundles já processados carregados`);
                                console.log(`   🎯 Continuando do índice ${startIndex}`);
                                
                                // 🆕 CARREGA FILA DE FALHAS SALVA
                                await failedManager.loadFailedQueue();
                                console.log(`   📋 Fila de falhas carregada: ${failedManager.failedQueue.size} bundles registrados`);
                            }
                        }
                    } else {
                        // Fallback para verificação completa
                        console.log(`   🔄 Verificação rápida falhou, fazendo verificação completa...`);
                        const existingData = JSON.parse(fsSync.readFileSync(BUNDLES_DETAILED_FILE, 'utf-8'));
                        
                        // Verifica se o arquivo tem estrutura válida
                        if (!existingData.bundles || !Array.isArray(existingData.bundles)) {
                            console.warn('⚠️ Arquivo bundleDetailed.json corrompido - estrutura inválida. Reiniciando do início...');
                            updateState = null;
                            detailedBundles = [];
                            startIndex = 0;
                        } 
                        // Verifica se não está marcado como completo mas tem estrutura válida
                        else if (!existingData.isComplete) {
                            // Verifica se o número de bundles corresponde ao progresso esperado
                            const expectedBundles = Math.min(updateState.completed, bundlesToProcess.length);
                            const actualBundles = existingData.bundles.length;
                            
                            console.log(`   📊 Bundles esperados: ${expectedBundles}, Encontrados: ${actualBundles}`);
                            
                            // Se há uma discrepância significativa, reinicia
                            if (actualBundles < expectedBundles * 0.8) { // Permite 20% de margem para bundles que falharam
                                console.warn(`⚠️ Discrepância nos dados: esperado ~${expectedBundles}, encontrado ${actualBundles}. Reiniciando do início...`);
                                updateState = null;
                                detailedBundles = [];
                                startIndex = 0;
                            } else {
                                // Arquivo parece válido, pode continuar
                                detailedBundles = existingData.bundles;
                                startIndex = updateState.lastProcessedIndex + 1;
                                updateState.resumeCount++;
                                console.log(`   ✅ ${detailedBundles.length} bundles já processados carregados`);
                                console.log(`   🎯 Continuando do índice ${startIndex}`);
                            }
                        } else {
                            // Arquivo marcado como completo, não deveria estar em estado 'in_progress'
                            console.warn('⚠️ Estado inconsistente: arquivo completo mas updateState indica progresso. Limpando estado...');
                            updateState = null;
                            detailedBundles = [];
                            startIndex = 0;
                        }
                    }
                } else {
                    // Arquivo principal não existe, verifica se há backup com dados parciais
                    console.log(`   ⚠️ Arquivo bundleDetailed.json não encontrado após backup...`);
                    
                    if (fsSync.existsSync(BUNDLES_DETAILED_OLD_FILE)) {
                        console.log(`   ⚡ Verificação rápida do backup para continuar...`);
                        
                        const backupQuickCheck = await quickStatusCheck(BUNDLES_DETAILED_OLD_FILE);
                        
                        if (backupQuickCheck.quickCheck) {
                            if (!backupQuickCheck.isComplete && backupQuickCheck.status === 'in_progress') {
                                const expectedBundles = Math.min(updateState.completed, bundlesToProcess.length);
                                const actualBundles = backupQuickCheck.totalBundles;
                                
                                console.log(`   � Backup: Bundles esperados: ${expectedBundles}, Encontrados: ${actualBundles}`);
                                
                                if (actualBundles >= expectedBundles * 0.7) { // 70% de margem para backup
                                    // Precisa carregar dados completos do backup
                                    console.log(`   📂 Carregando backup completo para continuar...`);
                                    const backupData = JSON.parse(fsSync.readFileSync(BUNDLES_DETAILED_OLD_FILE, 'utf-8'));
                                    detailedBundles = backupData.bundles;
                                    startIndex = updateState.lastProcessedIndex + 1;
                                    updateState.resumeCount++;
                                    console.log(`   ✅ RECUPERADO do backup: ${detailedBundles.length} bundles carregados`);
                                    console.log(`   🎯 Continuando do índice ${startIndex}`);
                                    
                                    // 🆕 CARREGA FILA DE FALHAS SALVA
                                    await failedManager.loadFailedQueue();
                                    console.log(`   📋 Fila de falhas carregada: ${failedManager.failedQueue.size} bundles registrados`);
                                } else {
                                    console.warn(`   ⚠️ Backup inconsistente: esperado ~${expectedBundles}, encontrado ${actualBundles}. Reiniciando...`);
                                    updateState = null;
                                    detailedBundles = [];
                                    startIndex = 0;
                                }
                            } else {
                                console.warn(`   ⚠️ Backup completo ou inválido para resumo. Reiniciando do início...`);
                                updateState = null;
                                detailedBundles = [];
                                startIndex = 0;
                            }
                        } else {
                            // Fallback para verificação completa do backup
                            console.log(`   🔄 Verificação rápida do backup falhou, fazendo verificação completa...`);
                            try {
                                const backupData = JSON.parse(fsSync.readFileSync(BUNDLES_DETAILED_OLD_FILE, 'utf-8'));
                                
                                if (backupData.bundles && Array.isArray(backupData.bundles) && !backupData.isComplete) {
                                    const expectedBundles = Math.min(updateState.completed, bundlesToProcess.length);
                                    const actualBundles = backupData.bundles.length;
                                    
                                    console.log(`   📊 Backup: Bundles esperados: ${expectedBundles}, Encontrados: ${actualBundles}`);
                                    
                                    if (actualBundles >= expectedBundles * 0.7) { // 70% de margem para backup
                                        // Pode continuar com os dados do backup
                                        detailedBundles = backupData.bundles;
                                        startIndex = updateState.lastProcessedIndex + 1;
                                        updateState.resumeCount++;
                                        console.log(`   ✅ RECUPERADO do backup: ${detailedBundles.length} bundles carregados`);
                                        console.log(`   🎯 Continuando do índice ${startIndex}`);
                                        
                                        // 🆕 CARREGA FILA DE FALHAS SALVA
                                        await failedManager.loadFailedQueue();
                                        console.log(`   📋 Fila de falhas carregada: ${failedManager.failedQueue.size} bundles registrados`);
                                    } else {
                                        console.warn(`   ⚠️ Backup inconsistente: esperado ~${expectedBundles}, encontrado ${actualBundles}. Reiniciando...`);
                                        updateState = null;
                                        detailedBundles = [];
                                        startIndex = 0;
                                    }
                                } else {
                                    console.warn(`   ⚠️ Backup inválido ou completo. Reiniciando do início...`);
                                    updateState = null;
                                    detailedBundles = [];
                                    startIndex = 0;
                                }
                            } catch (backupError) {
                                console.warn(`   ⚠️ Erro ao ler backup: ${backupError.message}. Reiniciando do início...`);
                                updateState = null;
                                detailedBundles = [];
                                startIndex = 0;
                            }
                        }
                    } else {
                        console.warn(`   ⚠️ Nenhum backup disponível. Reiniciando do início...`);
                        updateState = null;
                        detailedBundles = [];
                        startIndex = 0;
                    }
                }
            } catch (error) {
                console.warn('⚠️ Erro ao carregar progresso anterior (arquivo possivelmente corrompido), reiniciando:', error.message);
                updateState = null;
                detailedBundles = [];
                startIndex = 0;
            }
        }
        
        if (!updateState) {
            updateState = createInitialUpdateState(bundlesToProcess, limitForTesting, language);
            actualStartTime = updateState.startTime;
            console.log(`📊 Nova atualização iniciada: ${bundlesToProcess.length} bundles`);
        }
        
        saveUpdateState(updateState);
        
        let consecutiveFailures = 0; // Contador para o disjuntor
        let batchesProcessed = Math.floor(startIndex / performanceManager.currentParallel);
        let totalBatches = Math.ceil(bundlesToProcess.length / performanceManager.currentParallel);
        
        console.log(`🚀 Processando de ${startIndex} até ${bundlesToProcess.length} (${totalBatches - batchesProcessed} lotes restantes)`);
        console.log(`🧠 Sistema adaptativo ativo: ${performanceManager.currentDelay}ms delay, ${performanceManager.currentParallel} parallel`);
        
        // === CIRCUIT BREAKER OTIMIZADO PARA MAX_RETRIES ===
        // Falhas MAX_RETRIES_REACHED contam como 3 falhas para ativar circuit breaker mais rápido
        // 3+ MAX_RETRIES em um lote ativa pausa emergencial de 45s + config conservadora
        // Circuit breaker tradicional: 5 falhas consecutivas
        // Circuit breaker adaptativo: 20% queda de performance com recuperação de 45s
        
        for (let i = startIndex; i < bundlesToProcess.length; i += performanceManager.currentParallel) {
            const batch = bundlesToProcess.slice(i, i + performanceManager.currentParallel);
            const batchIndex = Math.floor(i / performanceManager.currentParallel);

            // --- LÓGICA DO DISJUNTOR INTELIGENTE ---
            if (consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD) {
                const failureReason = consecutiveFailures >= 8 ? 'críticas' : 'consecutivas';
                console.log(`🚨 Múltiplas falhas ${failureReason} (${consecutiveFailures}) detectadas. Pausando por ${CIRCUIT_BREAKER_DELAY / 1000} segundos para evitar bloqueio...`);
                await delay(CIRCUIT_BREAKER_DELAY);
                consecutiveFailures = 0; // Reseta o contador após a pausa
                
                // Força configuração mais conservadora após circuit breaker
                performanceManager.currentParallel = Math.max(1, Math.floor(performanceManager.currentParallel / 2));
                performanceManager.currentDelay = Math.min(ADAPTIVE_CONFIG.MAX_DELAY, performanceManager.currentDelay * 1.5);
                console.log(`🛡️ Config forçada pós circuit-breaker: ${performanceManager.currentDelay}ms, ${performanceManager.currentParallel} parallel`);
            }

            const batchStartTime = Date.now();
            console.log(`🚀 Lote ${batchIndex + 1}/${totalBatches}: Processando ${batch.length} bundles (${performanceManager.currentDelay}ms delay)...`);
            
            const batchPromises = batch.map(bundle => {
                const bundleIdMatch = bundle.Link.match(/\/bundle\/(\d+)/);
                if (!bundleIdMatch) return Promise.resolve({ success: false, reason: 'INVALID_LINK', bundleId: 'unknown' });
                return fetchBundleDetails(bundleIdMatch[1], language);
            });
            
            const results = await Promise.allSettled(batchPromises);
            const batchStartResults = detailedBundles.length;
            let ignoredNotFound = 0; // Contador para páginas não encontradas
            let failedBundleIds = []; // IDs que falharam neste lote

            for (let resultIndex = 0; resultIndex < results.length; resultIndex++) {
                const result = results[resultIndex];
                const bundle = batch[resultIndex];
                const bundleIdMatch = bundle?.Link?.match(/\/bundle\/(\d+)/);
                const bundleId = bundleIdMatch ? bundleIdMatch[1] : 'unknown';
                
                if (result.status === 'fulfilled') {
                    if (result.value.success) {
                        detailedBundles.push(result.value.data);
                        
                        // 🆕 NSFW detectado é considerado sucesso total (categorização automática)
                        if (result.value.nsfwDetected) {
                            consecutiveFailures = 0; // Reseta - NSFW é sucesso
                            console.log(`✅ [ID: ${bundleId}] NSFW detectado e categorizado automaticamente`);
                        }
                        // Se a extração falhou (mesmo com a página válida), conta como falha para o disjuntor
                        else if (result.value.extractionFailed) {
                            consecutiveFailures++;
                            failedBundleIds.push(bundleId);
                            // Adiciona à queue de retry se elegível
                            if (failedManager.shouldRetry('EXTRACTION_FAILED')) {
                                failedManager.addFailedBundle(bundleId, bundle, 'EXTRACTION_FAILED', i + resultIndex);
                            }
                        } else {
                            consecutiveFailures = 0; // Reseta em caso de sucesso total
                        }
                    } else {
                        // --- LÓGICA ATUALIZADA: ADICIONA FALHAS ELEGÍVEIS À QUEUE ---
                        if (result.value.reason === 'API_NO_DATA' || result.value.reason === 'PAGE_NOT_FOUND') {
                            // Bundle não existe ou página não encontrada - comportamento normal, não conta como falha
                            ignoredNotFound++;
                        } else {
                            // --- CIRCUIT BREAKER CRÍTICO PARA MAX_RETRIES ---
                            if (result.value.reason === 'MAX_RETRIES_REACHED') {
                                consecutiveFailures += 3; // Conta como 3 falhas para ativar circuit breaker mais rápido
                                failedBundleIds.push(bundleId);
                                console.log(`🚨 MAX_RETRIES detectado para Bundle ${bundleId} - Acelerando circuit breaker`);
                            } else {
                                // Outros tipos de falha contam como falha normal
                                consecutiveFailures++;
                                failedBundleIds.push(bundleId);
                            }
                            
                            // Adiciona à queue de retry se elegível
                            if (failedManager.shouldRetry(result.value.reason)) {
                                failedManager.addFailedBundle(bundleId, bundle, result.value.reason, i + resultIndex);
                                console.log(`📋 Bundle ${bundleId} adicionado à retry queue (${result.value.reason})`);
                            }
                        }
                    }
                } else {
                    // Se a promessa foi rejeitada, também conta como falha
                    consecutiveFailures++;
                    failedBundleIds.push(bundleId);
                    
                    // Adiciona à queue de retry
                    const errorReason = result.reason?.message?.includes('timeout') ? 'TIMEOUT_ERROR' : 'NETWORK_ERROR';
                    if (failedManager.shouldRetry(errorReason)) {
                        failedManager.addFailedBundle(bundleId, bundle, errorReason, i + resultIndex);
                        console.log(`📋 Bundle ${bundleId} adicionado à retry queue (${errorReason})`);
                    }
                }
            }

            const batchEndTime = Date.now();
            const batchTime = batchEndTime - batchStartTime;
            const successfulInBatch = detailedBundles.length - batchStartResults;
            
            // Registra resultado no sistema adaptativo
            const batchResult = performanceManager.recordBatchResult(
                batchIndex, 
                successfulInBatch, 
                batch.length, 
                batchTime,
                failedBundleIds
            );
            
            const logMessage = `✅ Lote ${batchIndex + 1}: ${successfulInBatch}/${batch.length} bundles processados`;
            const performanceInfo = `| ${(batchTime/1000).toFixed(1)}s | Taxa: ${(batchResult.successRate * 100).toFixed(1)}%`;
            const failureInfo = ignoredNotFound > 0 ? ` | ${ignoredNotFound} não encontrados` : '';
            const consecutiveInfo = failedBundleIds.length > 0 ? ` | ${consecutiveFailures} falhas consecutivas` : '';
            
            console.log(`${logMessage} ${performanceInfo}${failureInfo}${consecutiveInfo}`);
            
            // Log detalhado a cada intervalo
            performanceManager.logDetailedStats(batchIndex);
            
            // --- CIRCUIT BREAKER CRÍTICO PARA MAX_RETRIES ---
            const maxRetriesInBatch = results ? 
                results.slice(0, batch.length).filter(r => 
                    r.status === 'rejected' && 
                    r.value?.reason === 'MAX_RETRIES_REACHED'
                ).length : 0;
            
            if (maxRetriesInBatch >= 3) {
                console.log(`🚨 CIRCUIT BREAKER CRÍTICO: ${maxRetriesInBatch} bundles com MAX_RETRIES no lote - Ativando pausa emergencial...`);
                await sleep(45000); // 45 segundos de pausa emergencial
                
                // Força configuração conservadora
                performanceManager.applyConservativeConfiguration();
                console.log(`⚙️ Configuração conservadora aplicada após MAX_RETRIES crítico`);
            }
            
            // --- CIRCUIT BREAKER ADAPTATIVO ---
            if (performanceManager.detectAdaptiveCircuitBreaker()) {
                console.log(`🚨 CIRCUIT BREAKER ADAPTATIVO: Pausando ${ADAPTIVE_CIRCUIT_BREAKER.RECOVERY_DELAY / 1000}s para recuperação...`);
                await delay(ADAPTIVE_CIRCUIT_BREAKER.RECOVERY_DELAY);
                
                const recoveryConfig = performanceManager.forceConservativeRecovery();
                console.log(`🛡️ Configuração de recuperação aplicada: ${recoveryConfig.newDelay}ms, ${recoveryConfig.newParallel} parallel`);
                
                // Recalcula totalBatches após mudança forçada
                totalBatches = Math.ceil(bundlesToProcess.length / performanceManager.currentParallel);
                
                // Reseta contador de falhas consecutivas
                consecutiveFailures = 0;
                
                console.log(`✅ Recuperação adaptativa concluída. Continuando processamento...`);
            }
            
            // Otimização adaptativa (só se não estiver em recuperação)
            if (!performanceManager.adaptiveCircuitBreakerActive && performanceManager.shouldOptimize(batchIndex)) {
                const wasOptimized = performanceManager.optimizeSettings(batchIndex);
                if (wasOptimized) {
                    // Recalcula totalBatches se o paralelismo mudou
                    totalBatches = Math.ceil(bundlesToProcess.length / performanceManager.currentParallel);
                }
            }
            
            // Verifica se pode sair do modo de recuperação
            if (performanceManager.adaptiveCircuitBreakerActive) {
                performanceManager.checkRecoveryExit();
            }
            
            batchesProcessed++;
            
            updateState.completed = i + batch.length;
            updateState.lastProcessedIndex = Math.min(i + batch.length - 1, bundlesToProcess.length - 1);
            updateState.lastActivity = new Date().toISOString();
            
            const elapsed = (batchEndTime - actualStartTime) / 1000;
            const avgBatchTime = (batchEndTime - batchStartTime) / 1000;
            const remaining = totalBatches - batchIndex - 1;
            const estimatedTimeLeft = remaining * avgBatchTime;
            
            console.log(`📈 Progresso: ${updateState.completed}/${bundlesToProcess.length} | Tempo: ${elapsed.toFixed(1)}s | ETA: ${estimatedTimeLeft.toFixed(1)}s | Resumos: ${updateState.resumeCount}`);

            const memory = getMemoryUsage();
            const shouldSaveByInterval = batchesProcessed % SAVE_INTERVAL_BATCHES === 0;
            const shouldSaveByMemory = memory.heapUsed > MAX_MEMORY_USAGE_MB;
            
            if (shouldSaveByInterval || shouldSaveByMemory) {
                if (shouldSaveByMemory) console.log(`🚨 Memória alta (${memory.heapUsed}MB) - forçando salvamento`);
                
                const uniqueDetailedBundles = Array.from(new Map(detailedBundles.map(bundle => [bundle.bundleid, bundle])).values());
                await saveDetailedBundlesData(uniqueDetailedBundles, bundlesToProcess, false, limitForTesting, actualStartTime, updateState);
                await saveUpdateState(updateState);
                
                // 🆕 SALVA FILA DE FALHAS DURANTE O PROCESSAMENTO
                await failedManager.saveFailedQueue();
                console.log(`💾 Checkpoint: Dados + estado + fila de falhas salvos (${failedManager.failedQueue.size} falhas registradas)`);
                
                if (global.gc) {
                    global.gc();
                    const memoryAfterGC = getMemoryUsage();
                    console.log(`🧹 GC executado: ${memory.heapUsed}MB → ${memoryAfterGC.heapUsed}MB`);
                }
            }

            if (batchesProcessed % MEMORY_CHECK_INTERVAL_BATCHES === 0) {
                console.log(`📊 Memória: ${memory.heapUsed}MB | Detalhadas: ${detailedBundles.length} | Lotes: ${batchIndex + 1}/${totalBatches} | Checkpoint: ${updateState.completed}/${updateState.total}`);
            }

            if (i + performanceManager.currentParallel < bundlesToProcess.length) {
                await delay(performanceManager.currentDelay); // Usa delay adaptativo
            }
        }

        console.log(`🎉 Processamento concluído em ${(Date.now() - actualStartTime) / 1000}s`);
        
        // Relatório final do sistema adaptativo
        const finalConfig = performanceManager.getCurrentConfig();
        const failedReport = performanceManager.getFailedBundlesReport();
        const finalPerformance = performanceManager.calculateCurrentPerformance();
        const failedStats = failedManager.getStats();
        
        console.log(`\n🧠 RELATÓRIO FINAL ADAPTATIVO:`);
        console.log(`   ⚙️  Config final: ${finalConfig.delay}ms delay, ${finalConfig.parallel} parallel`);
        console.log(`   🔧 Otimizações realizadas: ${finalConfig.optimizations}`);
        if (finalConfig.bestConfig) {
            console.log(`   🏆 Melhor config encontrada: ${finalConfig.bestConfig.delay}ms, ${finalConfig.bestConfig.parallel} parallel`);
            console.log(`   📊 Melhor performance: ${(finalConfig.bestConfig.successRate * 100).toFixed(1)}% sucesso, eficiência ${finalConfig.bestConfig.efficiency.toFixed(2)}`);
        }
        if (finalPerformance) {
            console.log(`   📈 Performance final: ${(finalPerformance.successRate * 100).toFixed(1)}% sucesso, ${finalPerformance.bundlesPerSecond.toFixed(2)} bundles/s`);
        }
        if (failedReport.count > 0) {
            console.log(`   ❌ Bundles problemáticos: ${failedReport.count} únicos`);
            console.log(`   🔍 IDs problemáticos: ${failedReport.ids.slice(0, 10).join(', ')}${failedReport.count > 10 ? '...' : ''}`);
        }
        
        console.log(`\n📋 RELATÓRIO RETRY QUEUE:`);
        console.log(`   📊 Total de falhas: ${failedStats.total}`);
        console.log(`   🔄 Elegíveis para retry: ${failedStats.retryable}`);
        console.log(`   ❌ Falhas definitivas: ${failedStats.nonRetryable}`);
        console.log('');
        
        console.log('🔍 Removendo duplicatas das bundles detalhadas...');
        const uniqueDetailedBundles = Array.from(new Map(detailedBundles.map(bundle => [bundle.bundleid, bundle])).values());
        console.log(`📊 Bundles detalhadas: ${detailedBundles.length} processadas → ${uniqueDetailedBundles.length} únicas`);

        updateState.status = 'completed';
        updateState.completed = bundlesToProcess.length;
        updateState.endTime = Date.now();
        
        const result = await saveDetailedBundlesData(uniqueDetailedBundles, bundlesToProcess, true, limitForTesting, actualStartTime, updateState);
        
        if (!limitForTesting) {
            console.log('🔍 Verificação final de duplicatas...');
            const deduplication = removeDuplicatesFromDetailedBundles();
            if (deduplication.removed > 0) {
                result.totalBundles = deduplication.total;
                result.duplicatesRemoved = deduplication.removed;
                await fs.writeFile(BUNDLES_DETAILED_FILE, JSON.stringify(result, null, 2), 'utf-8');
                console.log(`🧹 ${deduplication.removed} duplicatas adicionais removidas pelo middleware`);
            } else {
                console.log(`✅ Nenhuma duplicata adicional encontrada.`);
            }
            
            await clearUpdateState();
            console.log(`🏁 Atualização COMPLETA com ${updateState.resumeCount} resumos`);
            
            // Salva queue de falhas para processamento posterior
            await failedManager.saveFailedQueue();
            
            // Log de finalização
            await appendToLog(`=== ATUALIZAÇÃO CONCLUÍDA COM SUCESSO ===`);
            await appendToLog(`Total processado: ${result.totalBundles} bundles`);
            await appendToLog(`Resumos realizados: ${updateState.resumeCount}`);
            await appendToLog(`Tempo total: ${((Date.now() - actualStartTime) / 1000).toFixed(1)}s`);
            await appendToLog(`Bundles para retry: ${failedStats.retryable}`);
            await appendToLog(`Finalizou em: ${new Date().toISOString()}`);
            
            // Log adaptativo final
            if (finalConfig.optimizations > 0) {
                const adaptiveLogMessage = `SESSÃO FINAL: ${finalConfig.optimizations} otimizações | ` +
                                         `Config final: ${finalConfig.delay}ms, ${finalConfig.parallel} parallel | ` +
                                         `Bundles problemáticos: ${failedReport.count} | ` +
                                         `Performance final: ${finalPerformance ? (finalPerformance.successRate * 100).toFixed(1) : 'N/A'}% | ` +
                                         `Retry queue: ${failedStats.retryable}`;
                await appendToAdaptiveLog(adaptiveLogMessage);
                
                if (failedReport.count > 0) {
                    await appendToAdaptiveLog(`BUNDLES PROBLEMÁTICOS: ${failedReport.ids.join(', ')}`);
                }
            }
            
            // --- PROCESSAMENTO AUTOMÁTICO DE RETRY ---
            if (!limitForTesting && failedStats.retryable > 0) {
                console.log(`\n🔄 Iniciando processamento automático de retry para ${failedStats.retryable} bundles...`);
                
                try {
                    const retryResult = await processFailedBundles(uniqueDetailedBundles);
                    
                    if (retryResult.success && retryResult.recovered > 0) {
                        console.log(`\n🎉 RETRY CONCLUÍDO: ${retryResult.recovered}/${retryResult.processed} bundles recuperados!`);
                        
                        // Atualiza resultado final
                        result.totalBundles += retryResult.recovered;
                        result.retryStats = {
                            processed: retryResult.processed,
                            recovered: retryResult.recovered,
                            time: retryResult.totalTime
                        };
                        
                        await appendToLog(`RETRY CONCLUÍDO: ${retryResult.recovered} bundles recuperados`);
                    } else {
                        console.log(`\n📊 RETRY CONCLUÍDO: Nenhum bundle adicional recuperado`);
                    }
                } catch (retryError) {
                    console.error(`❌ Erro durante processamento de retry:`, retryError.message);
                    await appendToLog(`ERRO NO RETRY: ${retryError.message}`);
                }
            }
            
            keepAlive.stop('update-completed');
        }
        
        return { success: true, ...result, resumeCount: updateState.resumeCount };
    } catch (error) {
        console.error('❌ Erro geral em updateBundlesWithDetails:', error);
        
        // 🆕 SALVA FILA DE FALHAS EM CASO DE ERRO
        if (failedManager) {
            try {
                await failedManager.saveFailedQueue();
                console.log(`💾 Fila de falhas salva em caso de erro: ${failedManager.failedQueue.size} bundles`);
            } catch (saveError) {
                console.warn(`⚠️ Erro ao salvar fila de falhas:`, saveError.message);
            }
        }
        
        // --- SISTEMA DE RESTAURAÇÃO DE BACKUP ---
        const BUNDLES_DETAILED_OLD_FILE = './bundleDetailed-old.json';
        
        if (fsSync.existsSync(BUNDLES_DETAILED_OLD_FILE)) {
            try {
                console.log('🔄 Erro durante atualização - tentando restaurar backup...');
                
                // Verifica se existe arquivo atual corrompido e remove
                if (fsSync.existsSync(BUNDLES_DETAILED_FILE)) {
                    console.log('🗑️ Removendo arquivo bundleDetailed.json corrompido...');
                    await fs.unlink(BUNDLES_DETAILED_FILE);
                }
                
                // Restaura o backup
                await fs.rename(BUNDLES_DETAILED_OLD_FILE, BUNDLES_DETAILED_FILE);
                console.log('✅ Backup restaurado com sucesso! Dados anteriores preservados.');
                
            } catch (restoreError) {
                console.error('❌ Erro ao restaurar backup do bundleDetailed.json:', restoreError.message);
                console.log('⚠️ Falha na restauração - dados podem estar indisponíveis temporariamente');
            }
        } else {
            console.log('⚠️ Nenhum backup disponível para restauração');
        }
        
        // Log de erro
        if (!limitForTesting) {
            await appendToLog(`=== ATUALIZAÇÃO FALHOU ===`);
            await appendToLog(`Erro: ${error.message}`);
            await appendToLog(`Timestamp: ${new Date().toISOString()}`);
            keepAlive.stop('update-error');
        }
        
        try {
            const errorState = loadUpdateState();
            if (errorState) {
                errorState.status = 'error';
                errorState.lastError = error.message;
                errorState.errorTime = new Date().toISOString();
                saveUpdateState(errorState);
            }
        } catch (stateError) {
            console.error('❌ Erro ao salvar estado de erro:', stateError.message);
        }
        
        return { success: false, error: error.message };
    }
};

module.exports = { 
    updateBundlesWithDetails,
    processFailedBundles,
    loadUpdateState,
    saveUpdateState,
    clearUpdateState,
    checkAndResumeUpdate: async () => {
        const state = loadUpdateState();
        if (state && state.status === 'in_progress') {
            console.log('🔄 Atualização incompleta detectada na inicialização!');
            console.log(`   📊 Progresso: ${state.completed}/${state.total}`);
            console.log(`   📅 Iniciado: ${new Date(state.startTime).toLocaleString()}`);
            console.log(`   🔄 Resumos anteriores: ${state.resumeCount}`);
            
            const timeSinceStart = (Date.now() - state.startTime) / (1000 * 60);
            if (timeSinceStart > 60) {
                console.log('⏰ Atualização muito antiga, limpando estado...');
                await clearUpdateState();
                return false;
            }
            
            console.log('✅ Estado válido encontrado - a próxima atualização continuará automaticamente');
            return true;
        }
        return false;
    },
    // Função utilitária para processar apenas retry sem atualização completa
    retryFailedBundlesOnly: async () => {
        console.log('🔄 Executando processamento isolado de retry...');
        
        // Carrega bundles existentes
        let existingBundles = [];
        try {
            if (fsSync.existsSync(BUNDLES_DETAILED_FILE)) {
                const existingData = JSON.parse(fsSync.readFileSync(BUNDLES_DETAILED_FILE, 'utf-8'));
                existingBundles = existingData.bundles || [];
            }
        } catch (error) {
            console.warn('⚠️ Erro ao carregar bundles existentes:', error.message);
        }
        
        return await processFailedBundles(existingBundles);
    },
    // Função utilitária de verificação rápida de status
    quickStatusCheck
};
