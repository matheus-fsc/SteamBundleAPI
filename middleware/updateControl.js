/**
 * Middleware de Controle de AtualizaÃ§Ã            setTimeout(() => this.pr                'X-Operation-Estimated-Wait': `${queueStatus.queueLength * 3}s`cessQueue(), 100);es
 * Integra o UpdateController com as rotas da API
 */
const updateController = require('../services/updateController');
/**
 * Sistema de fila para operaÃ§Ãµes sequenciais
 * Garante que operaÃ§Ãµes pesadas nÃ£o executem simultaneamente
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
        console.log(`ðŸ”„ [OPERATION QUEUE] Executando operaÃ§Ã£o (fila: ${this.queue.length} pendentes)`);
        try {
            const result = await item.operation();
            item.resolve(result);
        } catch (error) {
            console.error(`âŒ [OPERATION QUEUE] Erro na operaÃ§Ã£o:`, error);
            item.reject(error);
        } finally {
            this.currentOperation = null;
            this.running = false;
            setTimeout(() => this.processQueue(), 100); // Pequeno delay entre operaÃ§Ãµes
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
            item.reject(new Error('Fila de operaÃ§Ãµes foi limpa'));
        });
        this.queue = [];
    }
}
const operationQueue = new OperationQueue();
/**
 * Middleware para operaÃ§Ãµes sequenciais de fetch
 * Garante que bundles e bundleDetailed nÃ£o executem simultaneamente
 */
const sequentialFetchMiddleware = (operationType, priority = 0) => {
    return async (req, res, next) => {
        const queueStatus = operationQueue.getStatus();
        res.set({
            'X-Operation-Queue-Length': queueStatus.queueLength.toString(),
            'X-Operation-Queue-Running': queueStatus.running ? 'yes' : 'no',
            'X-Operation-Type': operationType
        });
        if (queueStatus.queueLength > 0 && priority < 5) {
            res.set({
                'X-Operation-Wait-Position': (queueStatus.queueLength + 1).toString(),
                'X-Operation-Estimated-Wait': `${queueStatus.queueLength * 3}s` // Estimativa de 3s por operaÃ§Ã£o
            });
        }
        try {
            await operationQueue.add(async () => {
                console.log(`ðŸš€ [FETCH PROTECTION] Iniciando ${operationType} (prioridade: ${priority})`);
                return new Promise((resolve) => {
                    const originalEnd = res.end;
                    res.end = function(...args) {
                        console.log(`âœ… [FETCH PROTECTION] Finalizando ${operationType}`);
                        resolve();
                        return originalEnd.apply(this, args);
                    };
                    const originalJson = res.json;
                    res.json = function(data) {
                        console.log(`âœ… [FETCH PROTECTION] Finalizando ${operationType} (JSON)`);
                        setTimeout(() => resolve(), 100);
                        return originalJson.call(this, data);
                    };
                    next();
                });
            }, priority);
        } catch (error) {
            console.error(`âŒ [FETCH PROTECTION] Erro em ${operationType}:`, error);
            res.status(503).json({
                error: 'ServiÃ§o temporariamente indisponÃ­vel',
                message: 'Sistema de proteÃ§Ã£o contra sobrecarga ativo. Tente novamente em alguns segundos.',
                operation: operationType,
                retry_after: 5
            });
        }
    };
};
/**
 * Middleware especÃ­fico para proteger operaÃ§Ãµes de atualizaÃ§Ã£o de bundles
 */
const bundleFetchProtectionMiddleware = sequentialFetchMiddleware('bundle-fetch', 3);
const bundleDetailedFetchProtectionMiddleware = sequentialFetchMiddleware('bundle-detailed-fetch', 1);
/**
 * Middleware para limpeza da fila em caso de emergÃªncia
 */
const emergencyQueueClearMiddleware = (req, res, next) => {
    if (req.query.clearQueue === 'emergency' && req.method === 'POST') {
        console.log('ðŸš¨ [EMERGENCY] Limpando fila de operaÃ§Ãµes por solicitaÃ§Ã£o de emergÃªncia');
        operationQueue.clear();
        return res.json({
            success: true,
            message: 'Fila de operaÃ§Ãµes foi limpa',
            timestamp: new Date().toISOString()
        });
    }
    next();
};
/**
 * Middleware para verificar status de atualizaÃ§Ãµes
 * Adiciona headers informativos sobre o estado das atualizaÃ§Ãµes
 */
const updateStatusMiddleware = (req, res, next) => {
    const status = updateController.getStatus();
    res.set({
        'X-Update-Status': status.isUpdating ? 
            `in-progress-${status.updateType}` : 'idle',
        'X-Update-Control': 'enabled',
        'X-Can-Trigger-Update': status.canTriggerUpdate ? 'yes' : 'no'
    });
    if (status.isUpdating) {
        updateController.incrementRequestCount();
        res.set({
            'X-Update-Duration': status.duration?.toString() || '0',
            'X-Update-Type': status.updateType || 'unknown',
            'X-Request-Count-During-Update': status.requestCount.toString()
        });
    }
    next();
};
/**
 * Middleware para proteger endpoints administrativos contra execuÃ§Ã£o simultÃ¢nea
 * Sistema simplificado que permite forÃ§a-update executar sequencialmente
 */
const preventSimultaneousUpdates = async (req, res, next) => {
    const status = updateController.getStatus();
    if (req.path === '/api/force-update') {
        console.log(`ðŸ”§ [FORCE-UPDATE] Permitindo execuÃ§Ã£o mesmo com atualizaÃ§Ã£o em andamento`);
        return next();
    }
    if (updateController.isUpdateInProgress()) {
        const queueStatus = operationQueue.getStatus();
        return res.status(409).json({
            error: 'AtualizaÃ§Ã£o jÃ¡ em andamento',
            message: 'Uma atualizaÃ§Ã£o estÃ¡ sendo executada no momento. Aguarde sua conclusÃ£o antes de iniciar uma nova.',
            current_update: {
                type: status.updateType,
                started_at: status.startTime,
                duration_seconds: status.duration,
                request_count: status.requestCount
            },
            suggestions: [
                'Use /api/update-status para monitorar o progresso',
                'Aguarde a conclusÃ£o da atualizaÃ§Ã£o atual',
                'Use /api/force-update para operaÃ§Ãµes prioritÃ¡rias',
                status.duration > 600 ? 'Se a atualizaÃ§Ã£o estiver travada por mais de 10 minutos, contate o administrador' : null
            ].filter(Boolean),
            retry_after: 30
        });
    }
    next();
};
/**
 * Wrapper para executar atualizaÃ§Ãµes de forma controlada
 * VersÃ£o simplificada que executa sequencialmente dentro do mesmo contexto
 */
const executeControlledUpdate = async (updateFunction, type) => {
    console.log(`ï¿½ [CONTROLLED] Executando "${type}" de forma controlada`);
    return updateController.executeControlledUpdate(updateFunction, type);
};
/**
 * Middleware para logging de operaÃ§Ãµes de atualizaÃ§Ã£o
 */
const updateLoggingMiddleware = (operation) => {
    return (req, res, next) => {
        const originalSend = res.send;
        const originalJson = res.json;
        res.send = function(data) {
            logUpdateOperation(req, res, operation, 'send');
            return originalSend.call(this, data);
        };
        res.json = function(data) {
            logUpdateOperation(req, res, operation, 'json');
            return originalJson.call(this, data);
        };
        next();
    };
};
/**
 * FunÃ§Ã£o de logging para operaÃ§Ãµes de atualizaÃ§Ã£o
 */
const logUpdateOperation = (req, res, operation, method) => {
    const status = updateController.getStatus();
    const clientInfo = {
        ip: req.ip || req.connection?.remoteAddress || 'unknown',
        userAgent: req.get('User-Agent') || 'unknown',
        timestamp: new Date().toISOString()
    };
    console.log(`ðŸ“Š [UPDATE MIDDLEWARE] ${operation} - Status: ${res.statusCode} - ` +
               `Update: ${status.isUpdating ? status.updateType : 'none'} - ` +
               `IP: ${clientInfo.ip}`);
};
/**
 * Middleware para adicionar diagnÃ³sticos de saÃºde do sistema de atualizaÃ§Ãµes
 */
const updateHealthCheckMiddleware = (req, res, next) => {
    const diagnostics = updateController.getDiagnostics();
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
    sequentialFetchMiddleware,
    bundleFetchProtectionMiddleware,
    bundleDetailedFetchProtectionMiddleware,
    emergencyQueueClearMiddleware,
    getOperationQueueStatus: () => operationQueue.getStatus(),
    clearOperationQueue: () => operationQueue.clear(),
    getUpdateController: () => updateController
};
