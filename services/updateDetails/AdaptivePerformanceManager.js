const fs = require('fs').promises;
const path = require('path');

/**
 * Sistema Adaptativo de Performance - Otimizado para Render Free
 * Gerencia delays, paralelismo e circuit breakers para ambiente de 0.1 core
 */

// --- CONFIGURAÇÕES ADAPTATIVAS ---
const ADAPTIVE_CONFIG = {
    // Configurações de delay (em ms) - OTIMIZADO PARA 0.1 CORE
    MIN_DELAY: 500,        // Aumentado para dar tempo de CPU processar
    MAX_DELAY: 8000,       // Aumentado para casos problemáticos
    INITIAL_DELAY: 1500,   // Mais conservador para Render
    DELAY_STEP: 300,       // Ajustes mais suaves
    
    // Configurações de paralelismo - MUITO LIMITADO PARA RENDER FREE
    MIN_PARALLEL: 2,
    MAX_PARALLEL: 6,       // MÁXIMO 4 para 0.1 core (muito conservador)
    INITIAL_PARALLEL: 4,   // Inicia com apenas 4 parallel

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

// --- CIRCUIT BREAKER ADAPTATIVO ---
const ADAPTIVE_CIRCUIT_BREAKER = {
    PERFORMANCE_DROP_THRESHOLD: 0.20,    // Queda de 20% na taxa de sucesso
    SEVERE_FAILURE_THRESHOLD: 0.50,      // Taxa de sucesso abaixo de 50%
    RECOVERY_DELAY: 45000,               // 45 segundos de pausa para recuperação
    MIN_BATCHES_FOR_DETECTION: 3,        // Mínimo de lotes para detectar problema
    RECOVERY_CONFIG_MULTIPLIER: 2        // Multiplicador para configuração conservadora
};

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
        
        // Setup de logs
        this.ADAPTIVE_LOG_FILE = path.join(__dirname, '../logs/adaptive_performance.log');
        this._ensureLogDirectory();
        
        console.log('🧠 Sistema Adaptativo inicializado (OTIMIZADO RENDER FREE):');
        console.log(`   ⏱️  Delay inicial: ${this.currentDelay}ms (RENDER CONSERVADOR)`);
        console.log(`   🔄 Paralelismo inicial: ${this.currentParallel} (LIMITADO 0.1 CORE)`);
        console.log(`   🚀 Configuração: Otimizações a cada ${ADAPTIVE_CONFIG.OPTIMIZATION_INTERVAL} lotes`);
        console.log(`   ⚡ Limites: ${ADAPTIVE_CONFIG.MIN_DELAY}-${ADAPTIVE_CONFIG.MAX_DELAY}ms, ${ADAPTIVE_CONFIG.MIN_PARALLEL}-${ADAPTIVE_CONFIG.MAX_PARALLEL} parallel`);
        console.log(`   🛡️ Circuit Breaker: Proteção contra degradação adaptativa ativa`);
        console.log(`   💾 Render Free: 0.1 core, 500MB RAM - Configuração ultra-otimizada`);
    }

    async _ensureLogDirectory() {
        try {
            const logDir = path.dirname(this.ADAPTIVE_LOG_FILE);
            await fs.mkdir(logDir, { recursive: true });
        } catch (error) {
            console.warn('⚠️ Erro ao criar diretório de logs:', error.message);
        }
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
                console.log(`   📉 Anterior: ${(this.lastOptimizationPerformance.successRate * 100).toFixed(1)}% → Atual: ${(performance.successRate * 100).toFixed(1)}%`);
                // Reverte para configuração mais conservadora
                this.applyConservativeConfiguration();
                return true;
            }
        }
        
        // === LÓGICA CONSERVADORA E GRADUAL ===
        if (successRate >= ADAPTIVE_CONFIG.AGGRESSIVE_INCREASE_THRESHOLD) {
            // Excelente performance (98%+) - aumenta GRADUALMENTE
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
            // Boa performance (92%+) - aumenta MUITO GRADUALMENTE
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
            // Performance ruim (< 75%) - reação IMEDIATA e FORTE
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
            // Performance ok (75-92%) - mantém configuração ou ajuste mínimo
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
            
            console.log(`🧠 OTIMIZAÇÃO #${this.optimizationAttempts} (Lote ${batchIndex}):`);
            console.log(`   📊 Performance: ${(successRate * 100).toFixed(1)}% sucesso, ${(avgBatchTime/1000).toFixed(1)}s/lote`);
            console.log(`   ⚙️  Nova config: ${this.currentDelay}ms delay, ${this.currentParallel} parallel`);
            console.log(`   💡 Motivo: ${reasoning.join(', ')}`);
            
            // Log para arquivo para análise posterior
            this._appendToAdaptiveLog(`OTIMIZAÇÃO #${this.optimizationAttempts} - Lote ${batchIndex}: ` +
                             `${(successRate * 100).toFixed(1)}% sucesso, ${(avgBatchTime/1000).toFixed(1)}s/lote | ` +
                             `Config: ${this.currentDelay}ms, ${this.currentParallel} parallel | ` +
                             `Motivo: ${reasoning.join(', ')}`);
            
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

    async _appendToAdaptiveLog(message) {
        const timestamp = new Date().toISOString();
        
        try {
            // Controla tamanho do arquivo de log
            await this._rotateAdaptiveLogIfNeeded();
            await fs.appendFile(this.ADAPTIVE_LOG_FILE, `[${timestamp}] ${message}\n`);
        } catch (error) {
            console.error('Erro ao escrever no log adaptativo:', error.message);
        }
    }

    async _rotateAdaptiveLogIfNeeded() {
        try {
            const stats = await fs.stat(this.ADAPTIVE_LOG_FILE);
            const fileSizeMB = stats.size / (1024 * 1024);
            
            // Se arquivo > 5MB, rotaciona (conservador para Render Free)
            if (fileSizeMB > 5) {
                const oldFile = this.ADAPTIVE_LOG_FILE.replace('.log', '-old.log');
                
                // Remove log antigo se existir
                try {
                    await fs.unlink(oldFile);
                } catch (e) {
                    // Arquivo não existe, ok
                }
                
                // Move log atual para old
                await fs.rename(this.ADAPTIVE_LOG_FILE, oldFile);
                console.log(`🔄 Log adaptativo rotacionado: ${Math.round(fileSizeMB * 100) / 100}MB`);
            }
        } catch (error) {
            // Arquivo não existe ainda, ok
        }
    }
}

module.exports = {
    AdaptivePerformanceManager,
    ADAPTIVE_CONFIG,
    ADAPTIVE_CIRCUIT_BREAKER
};
