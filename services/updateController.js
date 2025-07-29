const { storageSyncManager } = require('./storageSync'); // Importe o singleton

class UpdateController {
    /**
     * [NOVO - Placeholder] Verifica se há sessões de sincronização que não foram concluídas
     * e tenta retomá-las ou marcá-las como falhas.
     */
    async autoResumeIncompleteUpdates() {
        console.log(`${this.config.logPrefix} [AUTO-RESUME] Lógica de retomada de sessões ainda não implementada.`);
        // TODO: Implementar a lógica para:
        // 1. Chamar a API de storage para obter sessões com status "iniciada".
        // 2. Para cada sessão incompleta, decidir se deve ser reiniciada ou marcada como falha.
        // 3. Exemplo: const incompleteSessions = await storageSyncManager.getIncompleteSessions();
        return Promise.resolve();
    }
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

    /**
     * [ATUALIZADO] Verifica se as atualizações iniciais (básica e/ou detalhada) são necessárias.
     * @private
     */
    async _checkForInitialUpdate() {
        console.log(`${this.config.logPrefix} 🔍 Verificando a necessidade de atualização inicial ou de continuação...`);
        
        const healthCheck = await storageSyncManager.getStorageHealth();

        if (!healthCheck.success || !healthCheck.data?.tables?.details) {
            console.warn(`${this.config.logPrefix} ⚠️ Não foi possível verificar o estado das tabelas. A verificação será ignorada.`);
            return { needsBasicUpdate: false, needsDetailedUpdate: false };
        }

        const tables = healthCheck.data.tables.details;
        const bundlesTable = tables.bundles;

        let needsBasicUpdate = false;
        let needsDetailedUpdate = false;

        // Cenário 1: Base de dados completamente vazia.
        if (bundlesTable && bundlesTable.exists && bundlesTable.records === 0) {
            console.log(`${this.config.logPrefix} 🚀 DETETADO: A tabela 'bundles' está vazia. É necessária uma atualização completa.`);
            needsBasicUpdate = true;
            needsDetailedUpdate = true;
        } else if (bundlesTable && bundlesTable.exists) {
            console.log(`${this.config.logPrefix} ✅ Verificação concluída. A tabela principal parece estar preenchida.`);
        } else {
            console.log(`${this.config.logPrefix} ⚠️ Tabela principal não encontrada ou estado inválido. A verificação foi ignorada.`);
        }

        return { needsBasicUpdate, needsDetailedUpdate };
    }

    /**
     * [ATUALIZADO] Inicializa o controlador e retorna um estado de atualização detalhado.
     */
    async initialize() {
        console.log(`${this.config.logPrefix} 🚀 Inicializando controlador de atualizações...`);
        console.log(`${this.config.logPrefix} 📋 Configurações:`, {
            minTimeBetweenUpdates: `${this.config.minTimeBetweenUpdates/1000}s`,
            maxUpdateDuration: `${this.config.maxUpdateDuration/1000}s`
        });
        
        const { needsBasicUpdate, needsDetailedUpdate } = await this._checkForInitialUpdate();
        
        // A verificação de auto-resume continua a ser executada em paralelo
        setTimeout(async () => {
            console.log(`${this.config.logPrefix} 🔍 Iniciando verificação de auto-resume de sessões incompletas...`);
            await this.autoResumeIncompleteUpdates();
        }, 2000);
        
        console.log(`${this.config.logPrefix} ✅ Controlador inicializado.`);
        return { initialized: true, needsBasicUpdate, needsDetailedUpdate };
    }
}

const updateController = new UpdateController();
module.exports = updateController;
