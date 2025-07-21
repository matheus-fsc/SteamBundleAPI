/**
 * Middleware de Controle de Atualizações
 * Integra o UpdateController com as rotas da API
 */

const updateController = require('../services/updateController');

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
 */
const preventSimultaneousUpdates = (req, res, next) => {
    if (updateController.isUpdateInProgress()) {
        const status = updateController.getStatus();
        
        return res.status(409).json({
            error: 'Atualização já em andamento',
            message: 'Uma atualização está sendo executada no momento. Aguarde sua conclusão antes de iniciar uma nova.',
            current_update: {
                type: status.updateType,
                started_at: status.startTime,
                duration_seconds: status.duration,
                request_count: status.requestCount
            },
            suggestions: [
                'Use /api/update-status para monitorar o progresso',
                'Aguarde a conclusão da atualização atual',
                status.duration > 600 ? 'Se a atualização estiver travada por mais de 10 minutos, contate o administrador' : null
            ].filter(Boolean),
            retry_after: 30 // Sugere tentar novamente em 30 segundos
        });
    }
    
    next();
};

/**
 * Wrapper para executar atualizações de forma controlada
 */
const executeControlledUpdate = async (updateFunction, type) => {
    return updateController.executeControlledUpdate(updateFunction, type);
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
    
    // Expõe o controller para uso direto quando necessário
    getUpdateController: () => updateController
};
