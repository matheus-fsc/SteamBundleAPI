/**
 * Serviço de Controle de Atualizações
 * Gerencia o estado e coordenação de atualizações para prevenir conflitos
 */

class UpdateController {
    constructor() {
        this.updateState = {
            isUpdating: false,
            updateType: null, // 'basic' | 'detailed' | 'force-basic' | 'force-detailed' | etc.
            startTime: null,
            lastUpdateAttempt: null,
            updatePromise: null,
            requestCount: 0 // Contador de requisições durante atualização
        };
        
        // Configurações
        this.config = {
            minTimeBetweenUpdates: 30000, // 30 segundos
            maxUpdateDuration: 900000,    // 15 minutos
            logPrefix: '[UPDATE CONTROLLER]'
        };
    }

    /**
     * Verifica se uma atualização está em andamento
     */
    isUpdateInProgress() {
        // Verifica se a atualização não está "travada" há muito tempo
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

    /**
     * Marca início de atualização
     */
    startUpdate(type) {
        this.updateState.isUpdating = true;
        this.updateState.updateType = type;
        this.updateState.startTime = new Date();
        this.updateState.lastUpdateAttempt = new Date();
        this.updateState.requestCount = 0;
        
        console.log(`${this.config.logPrefix} Iniciando atualização "${type}"...`);
        return this.updateState.startTime;
    }

    /**
     * Marca fim de atualização
     */
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

    /**
     * Força reset do estado (em caso de travamento)
     */
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

    /**
     * Incrementa contador de requisições durante atualização
     */
    incrementRequestCount() {
        if (this.updateState.isUpdating) {
            this.updateState.requestCount++;
        }
    }

    /**
     * Verifica se pode iniciar uma nova atualização
     */
    canTriggerUpdate() {
        // Se já está atualizando, não pode
        if (this.isUpdateInProgress()) {
            return false;
        }

        // Se última tentativa foi muito recente, não pode
        if (this.updateState.lastUpdateAttempt) {
            const timeSinceLastAttempt = new Date() - this.updateState.lastUpdateAttempt;
            return timeSinceLastAttempt >= this.config.minTimeBetweenUpdates;
        }

        return true;
    }

    /**
     * Executa atualização de forma controlada
     */
    async executeControlledUpdate(updateFunction, type) {
        // Se já está atualizando, retorna a Promise existente
        if (this.updateState.isUpdating && this.updateState.updatePromise) {
            console.log(`⏳ ${this.config.logPrefix} Atualização "${type}" já em andamento, aguardando conclusão...`);
            this.incrementRequestCount();
            return this.updateState.updatePromise;
        }

        // Se não pode iniciar nova atualização
        if (!this.canTriggerUpdate()) {
            const timeSinceLastAttempt = Math.round((new Date() - this.updateState.lastUpdateAttempt) / 1000);
            console.log(`⏱️ ${this.config.logPrefix} Ignorando atualização "${type}" - última tentativa há ${timeSinceLastAttempt}s (mín: ${this.config.minTimeBetweenUpdates/1000}s)`);
            return Promise.resolve({ skipped: true, reason: 'too_recent' });
        }

        this.startUpdate(type);
        
        // Cria a Promise de atualização
        this.updateState.updatePromise = this._executeUpdate(updateFunction, type);
        
        return this.updateState.updatePromise;
    }

    /**
     * Executa a atualização com tratamento de erro
     */
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

    /**
     * Retorna o status atual do controlador
     */
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

    /**
     * Retorna informações de diagnóstico
     */
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
}

// Singleton para garantir uma única instância
const updateController = new UpdateController();

module.exports = updateController;
