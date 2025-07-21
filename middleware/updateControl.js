/**
 * Middleware de Controle de Atualizações
 * Integra o UpdateController com as rotas da API
 */

const updateController = require('../services/updateController');

/**
 * Sistema de fila para operações sequenciais
 * Garante que operações pesadas não executem simultaneamente
 */
class OperationQueue {
    constructor() {
        this.queue = [];
        this.running = false;
        this.currentOperation = null;
    }

    async add(operation, priority = 0) {
        return new Promise((resolve, reject) => {
            this.queue.push({
                operation,
                priority,
                resolve,
                reject,
                timestamp: Date.now()
            });

            // Ordena por prioridade (maior valor = maior prioridade)
            this.queue.sort((a, b) => b.priority - a.priority);
            
            this.processQueue();
        });
    }

    async processQueue() {
        if (this.running || this.queue.length === 0) {
            return;
        }

        this.running = true;
        const item = this.queue.shift();
        this.currentOperation = item;

        console.log(`🔄 [OPERATION QUEUE] Executando operação (fila: ${this.queue.length} pendentes)`);

        try {
            const result = await item.operation();
            item.resolve(result);
        } catch (error) {
            console.error(`❌ [OPERATION QUEUE] Erro na operação:`, error);
            item.reject(error);
        } finally {
            this.currentOperation = null;
            this.running = false;
            
            // Processa próximo item da fila
            setTimeout(() => this.processQueue(), 100); // Pequeno delay entre operações
        }
    }

    getStatus() {
        return {
            running: this.running,
            queueLength: this.queue.length,
            currentOperation: this.currentOperation ? {
                priority: this.currentOperation.priority,
                startTime: this.currentOperation.timestamp
            } : null
        };
    }

    clear() {
        this.queue.forEach(item => {
            item.reject(new Error('Fila de operações foi limpa'));
        });
        this.queue = [];
    }
}

// Instância global da fila de operações
const operationQueue = new OperationQueue();

/**
 * Middleware para operações sequenciais de fetch
 * Garante que bundles e bundleDetailed não executem simultaneamente
 */
const sequentialFetchMiddleware = (operationType, priority = 0) => {
    return async (req, res, next) => {
        const queueStatus = operationQueue.getStatus();
        
        // Adiciona headers informativos sobre a fila
        res.set({
            'X-Operation-Queue-Length': queueStatus.queueLength.toString(),
            'X-Operation-Queue-Running': queueStatus.running ? 'yes' : 'no',
            'X-Operation-Type': operationType
        });

        // Se há operações na fila e esta não é de alta prioridade, informa sobre a espera
        if (queueStatus.queueLength > 0 && priority < 5) {
            res.set({
                'X-Operation-Wait-Position': (queueStatus.queueLength + 1).toString(),
                'X-Operation-Estimated-Wait': `${queueStatus.queueLength * 3}s` // Estimativa de 3s por operação
            });
        }

        try {
            // Adiciona operação à fila
            await operationQueue.add(async () => {
                console.log(`🚀 [FETCH PROTECTION] Iniciando ${operationType} (prioridade: ${priority})`);
                
                // Simula a execução da operação (o next() será chamado dentro da fila)
                return new Promise((resolve) => {
                    // Override do res.end para capturar quando a resposta terminar
                    const originalEnd = res.end;
                    res.end = function(...args) {
                        console.log(`✅ [FETCH PROTECTION] Finalizando ${operationType}`);
                        resolve();
                        return originalEnd.apply(this, args);
                    };
                    
                    // Override do res.json para capturar quando a resposta for enviada
                    const originalJson = res.json;
                    res.json = function(data) {
                        console.log(`✅ [FETCH PROTECTION] Finalizando ${operationType} (JSON)`);
                        setTimeout(() => resolve(), 100); // Pequeno delay para garantir que a resposta foi enviada
                        return originalJson.call(this, data);
                    };
                    
                    next();
                });
            }, priority);

        } catch (error) {
            console.error(`❌ [FETCH PROTECTION] Erro em ${operationType}:`, error);
            res.status(503).json({
                error: 'Serviço temporariamente indisponível',
                message: 'Sistema de proteção contra sobrecarga ativo. Tente novamente em alguns segundos.',
                operation: operationType,
                retry_after: 5
            });
        }
    };
};

/**
 * Middleware específico para proteger operações de atualização de bundles
 */
const bundleFetchProtectionMiddleware = sequentialFetchMiddleware('bundle-fetch', 3);
const bundleDetailedFetchProtectionMiddleware = sequentialFetchMiddleware('bundle-detailed-fetch', 1);

/**
 * Middleware para limpeza da fila em caso de emergência
 */
const emergencyQueueClearMiddleware = (req, res, next) => {
    if (req.query.clearQueue === 'emergency' && req.method === 'POST') {
        console.log('🚨 [EMERGENCY] Limpando fila de operações por solicitação de emergência');
        operationQueue.clear();
        
        return res.json({
            success: true,
            message: 'Fila de operações foi limpa',
            timestamp: new Date().toISOString()
        });
    }
    next();
};

/**
 * Middleware para verificar status de atualizações
 * Adiciona headers informativos sobre o estado das atualizações
 */
const updateStatusMiddleware = (req, res, next) => {
    const status = updateController.getStatus();
    
    // Adiciona headers informativos
    res.set({
        'X-Update-Status': status.isUpdating ? 
            `in-progress-${status.updateType}` : 'idle',
        'X-Update-Control': 'enabled',
        'X-Can-Trigger-Update': status.canTriggerUpdate ? 'yes' : 'no'
    });

    // Incrementa contador se estiver em atualização
    if (status.isUpdating) {
        updateController.incrementRequestCount();
        
        // Adiciona informações adicionais se estiver atualizando
        res.set({
            'X-Update-Duration': status.duration?.toString() || '0',
            'X-Update-Type': status.updateType || 'unknown',
            'X-Request-Count-During-Update': status.requestCount.toString()
        });
    }

    next();
};

/**
 * Middleware para proteger endpoints administrativos contra execução simultânea
 * Agora usa sistema de fila em vez de bloquear completamente
 */
const preventSimultaneousUpdates = async (req, res, next) => {
    const status = updateController.getStatus();
    
    // Se há atualização em andamento, adiciona à fila em vez de bloquear
    if (updateController.isUpdateInProgress()) {
        const queueStatus = operationQueue.getStatus();
        
        // Adiciona headers informativos sobre a fila
        res.set({
            'X-Queue-Position': (queueStatus.queueLength + 1).toString(),
            'X-Current-Update': status.updateType,
            'X-Estimated-Wait': `${(queueStatus.queueLength + 1) * 30}s`,
            'X-Queue-System': 'enabled'
        });
        
        console.log(`📋 [QUEUE] Adicionando operação à fila. Posição: ${queueStatus.queueLength + 1}`);
        
        // Envia resposta imediata informando sobre o enfileiramento
        return res.json({
            message: 'Operação adicionada à fila de execução',
            queue_info: {
                position: queueStatus.queueLength + 1,
                estimated_wait_seconds: (queueStatus.queueLength + 1) * 30,
                current_operation: {
                    type: status.updateType,
                    duration: status.duration,
                    started_at: status.startTime
                }
            },
            status: 'queued',
            recommendations: [
                'A operação será executada automaticamente quando a atual terminar',
                'Use /api/operation-queue-status para monitorar a fila',
                'Use /api/update-status para acompanhar o progresso da operação atual'
            ],
            next_steps: [
                'Aguarde a execução automática',
                'Monitore /api/operation-queue-status',
                'Não envie requisições duplicadas'
            ],
            timestamp: new Date().toISOString()
        });
    }
    
    next();
};

/**
 * Wrapper para executar atualizações de forma controlada
 * Agora integrado com sistema de fila
 */
const executeControlledUpdate = async (updateFunction, type) => {
    // Se não há atualização em andamento, executa diretamente
    if (!updateController.isUpdateInProgress()) {
        return updateController.executeControlledUpdate(updateFunction, type);
    }
    
    // Se há atualização em andamento, adiciona à fila
    console.log(`📋 [QUEUE] Adicionando "${type}" à fila de operações`);
    
    return operationQueue.add(async () => {
        console.log(`🚀 [QUEUE] Executando "${type}" da fila`);
        return updateController.executeControlledUpdate(updateFunction, type);
    }, 5); // Prioridade alta para operações de atualização
};

/**
 * Middleware para logging de operações de atualização
 */
const updateLoggingMiddleware = (operation) => {
    return (req, res, next) => {
        const originalSend = res.send;
        const originalJson = res.json;
        
        // Override do método send para capturar resposta
        res.send = function(data) {
            logUpdateOperation(req, res, operation, 'send');
            return originalSend.call(this, data);
        };
        
        // Override do método json para capturar resposta
        res.json = function(data) {
            logUpdateOperation(req, res, operation, 'json');
            return originalJson.call(this, data);
        };
        
        next();
    };
};

/**
 * Função de logging para operações de atualização
 */
const logUpdateOperation = (req, res, operation, method) => {
    const status = updateController.getStatus();
    const clientInfo = {
        ip: req.ip || req.connection?.remoteAddress || 'unknown',
        userAgent: req.get('User-Agent') || 'unknown',
        timestamp: new Date().toISOString()
    };
    
    console.log(`📊 [UPDATE MIDDLEWARE] ${operation} - Status: ${res.statusCode} - ` +
               `Update: ${status.isUpdating ? status.updateType : 'none'} - ` +
               `IP: ${clientInfo.ip}`);
};

/**
 * Middleware para adicionar diagnósticos de saúde do sistema de atualizações
 */
const updateHealthCheckMiddleware = (req, res, next) => {
    const diagnostics = updateController.getDiagnostics();
    
    // Se sistema não está saudável, adiciona warnings
    if (!diagnostics.diagnostics.isHealthy) {
        res.set({
            'X-Update-Health': 'warning',
            'X-Update-Warnings': diagnostics.diagnostics.recommendations.join('; ')
        });
    } else {
        res.set({
            'X-Update-Health': 'healthy'
        });
    }
    
    next();
};

module.exports = {
    updateStatusMiddleware,
    preventSimultaneousUpdates,
    executeControlledUpdate,
    updateLoggingMiddleware,
    updateHealthCheckMiddleware,
    
    // Novos middlewares de proteção contra sobrecarga
    sequentialFetchMiddleware,
    bundleFetchProtectionMiddleware,
    bundleDetailedFetchProtectionMiddleware,
    emergencyQueueClearMiddleware,
    
    // Utilitários da fila de operações
    getOperationQueueStatus: () => operationQueue.getStatus(),
    clearOperationQueue: () => operationQueue.clear(),
    
    // Expõe o controller para uso direto quando necessário
    getUpdateController: () => updateController
};
