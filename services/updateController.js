class UpdateController {
    constructor() {
        this.updateState = {
            isUpdating: false,
            updateType: null, 
            startTime: null,
            lastUpdateAttempt: null,
            updatePromise: null,
            requestCount: 0 
        };
        
        this.config = {
            minTimeBetweenUpdates: 30000, 
            maxUpdateDuration: 900000,    
            logPrefix: '[UPDATE CONTROLLER]'
        };
    }

    isUpdateInProgress() {
        if (this.updateState.isUpdating && this.updateState.startTime) {
            const elapsed = new Date() - this.updateState.startTime;
            if (elapsed > this.config.maxUpdateDuration) {
                console.warn(`${this.config.logPrefix} Atualização ${this.updateState.updateType} excedeu tempo limite (${Math.round(elapsed/1000)}s), resetando...`);
                this.forceReset();
                return false;
            }
        }
        
        return this.updateState.isUpdating;
    }

    startUpdate(type) {
        this.updateState.isUpdating = true;
        this.updateState.updateType = type;
        this.updateState.startTime = new Date();
        this.updateState.lastUpdateAttempt = new Date();
        this.updateState.requestCount = 0;
        
        console.log(`${this.config.logPrefix} Iniciando atualização "${type}"...`);
        return this.updateState.startTime;
    }

    endUpdate(success = true) {
        const duration = this.updateState.startTime ? 
            Math.round((new Date() - this.updateState.startTime) / 1000) : 0;
        
        const status = success ? '✅' : '❌';
        console.log(`${status} ${this.config.logPrefix} Atualização "${this.updateState.updateType}" finalizada em ${duration}s (${this.updateState.requestCount} requisições durante o processo)`);
        
        this.updateState.isUpdating = false;
        this.updateState.updateType = null;
        this.updateState.startTime = null;
        this.updateState.updatePromise = null;
        this.updateState.requestCount = 0;
        
        return { duration, success };
    }

    forceReset() {
        console.warn(`${this.config.logPrefix} Forçando reset do estado de atualização`);
        this.updateState = {
            isUpdating: false,
            updateType: null,
            startTime: null,
            lastUpdateAttempt: this.updateState.lastUpdateAttempt,
            updatePromise: null,
            requestCount: 0
        };
    }

    forceStop() {
        const wasUpdating = this.updateState.isUpdating;
        const currentType = this.updateState.updateType;
        const duration = this.updateState.startTime ? 
            Math.round((new Date() - this.updateState.startTime) / 1000) : 0;
        
        console.warn(`${this.config.logPrefix} 🛑 FORCE STOP solicitado - Parando todas as operações`);
        
        if (wasUpdating) {
            console.warn(`${this.config.logPrefix} Interrompendo atualização "${currentType}" após ${duration}s`);
        }

        this.updateState = {
            isUpdating: false,
            updateType: null,
            startTime: null,
            lastUpdateAttempt: new Date(), 
            updatePromise: null,
            requestCount: 0
        };

        return {
            wasUpdating,
            stoppedType: currentType,
            duration,
            timestamp: new Date().toISOString(),
            message: wasUpdating ? 
                `Operação "${currentType}" foi interrompida após ${duration}s` : 
                'Nenhuma operação estava em andamento'
        };
    }

    incrementRequestCount() {
        if (this.updateState.isUpdating) {
            this.updateState.requestCount++;
        }
    }

    canTriggerUpdate() {
        if (this.isUpdateInProgress()) {
            return false;
        }

        if (this.updateState.lastUpdateAttempt) {
            const timeSinceLastAttempt = new Date() - this.updateState.lastUpdateAttempt;
            return timeSinceLastAttempt >= this.config.minTimeBetweenUpdates;
        }

        return true;
    }

    async executeControlledUpdate(updateFunction, type) {
        if (this.updateState.isUpdating && this.updateState.updatePromise) {
            console.log(`⏳ ${this.config.logPrefix} Atualização "${type}" já em andamento, aguardando conclusão...`);
            this.incrementRequestCount();
            return this.updateState.updatePromise;
        }

        if (!this.canTriggerUpdate()) {
            const timeSinceLastAttempt = Math.round((new Date() - this.updateState.lastUpdateAttempt) / 1000);
            console.log(`⏱️ ${this.config.logPrefix} Ignorando atualização "${type}" - última tentativa há ${timeSinceLastAttempt}s (mín: ${this.config.minTimeBetweenUpdates/1000}s)`);
            return Promise.resolve({ skipped: true, reason: 'too_recent' });
        }

        this.startUpdate(type);
        
        this.updateState.updatePromise = this._executeUpdate(updateFunction, type);
        
        return this.updateState.updatePromise;
    }

    async _executeUpdate(updateFunction, type) {
        try {
            console.log(`🚀 ${this.config.logPrefix} Executando atualização "${type}"...`);
            const result = await updateFunction();
            this.endUpdate(true);
            return { success: true, result, type };
        } catch (error) {
            console.error(`❌ ${this.config.logPrefix} Erro na atualização "${type}":`, error.message);
            this.endUpdate(false);
            throw error;
        }
    }

    getStatus() {
        return {
            isUpdating: this.updateState.isUpdating,
            updateType: this.updateState.updateType,
            startTime: this.updateState.startTime,
            duration: this.updateState.startTime ? 
                Math.round((new Date() - this.updateState.startTime) / 1000) : null,
            lastUpdateAttempt: this.updateState.lastUpdateAttempt,
            canTriggerUpdate: this.canTriggerUpdate(),
            requestCount: this.updateState.requestCount,
            config: this.config
        };
    }

    getDiagnostics() {
        const status = this.getStatus();
        return {
            ...status,
            diagnostics: {
                isHealthy: !status.isUpdating || (status.duration && status.duration < this.config.maxUpdateDuration / 1000),
                recommendations: [
                    status.isUpdating && status.duration > 300 ? 
                        'Atualização em andamento há mais de 5 minutos - monitore' : null,
                    status.requestCount > 10 ? 
                        'Muitas requisições durante atualização - possível sobrecarga' : null,
                    !status.canTriggerUpdate && !status.isUpdating ? 
                        'Aguardando intervalo mínimo entre atualizações' : null
                ].filter(Boolean)
            }
        };
    }

    async autoResumeIncompleteUpdates() {
        console.log(`${this.config.logPrefix} 🔍 Verificando por atualizações incompletas...`);
        
        try {
            const { updateBundlesWithDetails, checkAndResumeUpdate } = require('./updateBundles');
            
            const hasIncompleteUpdate = await checkAndResumeUpdate();
            
            if (hasIncompleteUpdate && !this.isUpdateInProgress()) {
                console.log(`${this.config.logPrefix} 🔄 INICIANDO AUTO-RESUME de atualização incompleta em 5 segundos...`);
                console.log(`${this.config.logPrefix} ⏰ Aguardando inicialização completa do servidor...`);
                
                setTimeout(async () => {
                    try {
                        console.log(`${this.config.logPrefix} 🚀 Executando auto-resume da atualização detalhada...`);
                        
                        const result = await this.executeControlledUpdate(
                            () => updateBundlesWithDetails('brazilian'), 
                            'auto-resume-detailed'
                        );
                        
                        if (result.success) {
                            console.log(`${this.config.logPrefix} ✅ Auto-resume concluído com sucesso!`);
                            console.log(`${this.config.logPrefix} 📊 Resultado:`, result.result?.totalBundles ? `${result.result.totalBundles} bundles processados` : 'Processamento completo');
                        } else {
                            console.log(`${this.config.logPrefix} ⚠️ Auto-resume foi ignorado:`, result);
                        }
                    } catch (error) {
                        console.error(`${this.config.logPrefix} ❌ ERRO durante auto-resume:`, error.message);
                        console.error(`${this.config.logPrefix} 💡 A atualização pode ser reiniciada manualmente via endpoint /api/admin/update`);
                    }
                }, 5000);
                
                return { resumed: true, type: 'auto-resume-detailed', scheduled: true };
            } else if (hasIncompleteUpdate && this.isUpdateInProgress()) {
                console.log(`${this.config.logPrefix} ⏳ Atualização incompleta detectada, mas já há uma atualização em andamento`);
                return { resumed: false, reason: 'already_updating' };
            } else {
                console.log(`${this.config.logPrefix} ✅ Nenhuma atualização incompleta encontrada`);
                return { resumed: false, reason: 'no_incomplete_updates' };
            }
            
        } catch (error) {
            console.error(`${this.config.logPrefix} ❌ Erro durante verificação de auto-resume:`, error.message);
            return { resumed: false, reason: 'error', error: error.message };
        }
    }

    async initialize() {
        console.log(`${this.config.logPrefix} 🚀 Inicializando controlador de atualizações...`);
        console.log(`${this.config.logPrefix} 📋 Configurações:`, {
            minTimeBetweenUpdates: `${this.config.minTimeBetweenUpdates/1000}s`,
            maxUpdateDuration: `${this.config.maxUpdateDuration/1000}s`
        });
        
        setTimeout(async () => {
            console.log(`${this.config.logPrefix} 🔍 Iniciando verificação de auto-resume...`);
            const result = await this.autoResumeIncompleteUpdates();
            
            if (result.scheduled) {
                console.log(`${this.config.logPrefix} ⏰ Auto-resume agendado - atualização continuará automaticamente`);
            }
        }, 2000);
        
        console.log(`${this.config.logPrefix} ✅ Controlador inicializado`);
        return { initialized: true };
    }
}

const updateController = new UpdateController();

updateController.initialize().catch(error => {
    console.error('[UPDATE CONTROLLER] ❌ Erro durante inicialização:', error.message);
});

module.exports = updateController;
