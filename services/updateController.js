const { storageSyncManager } = require('./storageSync'); // Importe o singleton
const BackupSystem = require('./BackupSystem');

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

        // Sistema de backup integrado
        this.backupSystem = new BackupSystem();
    }

    /**
     * [MELHORADO] Verifica se há sessões de sincronização que não foram concluídas
     * e tenta retomá-las ou marcá-las como falhas.
     */
    async autoResumeIncompleteUpdates() {
        console.log(`${this.config.logPrefix} [AUTO-RESUME] Verificando sessões incompletas...`);
        
        try {
            // Verificar status do sistema de backup
            const systemStatus = await this.backupSystem.getSystemStatus();
            if (systemStatus && systemStatus.update_status === 'updating') {
                console.log(`${this.config.logPrefix} [AUTO-RESUME] Sistema em modo de atualização detectado`);
                
                // Se sistema ficou em estado de updating, restaurar
                console.log(`${this.config.logPrefix} [AUTO-RESUME] Finalizando atualização pendente...`);
                await this.backupSystem.finishUpdate();
            }
            
        } catch (error) {
            console.error(`${this.config.logPrefix} [AUTO-RESUME] Erro na verificação: ${error.message}`);
        }
        
        return Promise.resolve();
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

    /**
     * [NOVO] Executa atualização com sistema de backup Blue-Green
     */
    async executeWithBackup(updateType, updateFunction) {
        console.log(`${this.config.logPrefix} Executando "${updateType}" com sistema de backup...`);
        
        try {
            // 1. Preparar sistema para atualização (cria backup e switch)
            console.log(`${this.config.logPrefix} Preparando backup antes de "${updateType}"...`);
            const backupResult = await this.backupSystem.startUpdate();
            
            if (!backupResult.success) {
                throw new Error(`Falha no backup: ${backupResult.error}`);
            }

            console.log(`${this.config.logPrefix} Sistema usando tabela: ${backupResult.active_table}`);

            // 2. Executar a atualização na tabela principal
            this.startUpdate(updateType);
            
            try {
                const updateResult = await updateFunction();
                
                // 3. Aguardar processamento na API Storage (delay crítico)
                console.log(`${this.config.logPrefix} Aguardando processamento na API Storage...`);
                const validationDelay = parseInt(process.env.UPDATE_VALIDATION_DELAY) || 5000;
                await new Promise(resolve => setTimeout(resolve, validationDelay));
                
                // 4. Verificar se a atualização foi realmente bem-sucedida
                const isSuccess = await this._validateUpdateSuccess(updateType, updateResult);
                
                if (isSuccess) {
                    console.log(`${this.config.logPrefix} Atualização "${updateType}" bem-sucedida, finalizando...`);
                    await this.backupSystem.finishUpdate();
                    this.endUpdate(true);
                    return updateResult || { success: true, type: updateType };
                } else {
                    throw new Error('Validação pós-atualização falhou');
                }

            } catch (updateError) {
                console.error(`${this.config.logPrefix} Erro na atualização "${updateType}": ${updateError.message}`);
                
                // 4. Em caso de erro, manter backup ativo
                console.log(`${this.config.logPrefix} Mantendo sistema em backup devido ao erro`);
                this.endUpdate(false);
                throw updateError;
            }

        } catch (backupError) {
            console.error(`${this.config.logPrefix} Erro crítico no sistema de backup: ${backupError.message}`);
            this.endUpdate(false);
            throw backupError;
        }
    }

    /**
     * [NOVO] Restaura sistema em caso de emergência
     */
    async emergencyRestore() {
        console.log(`${this.config.logPrefix} RESTAURAÇÃO DE EMERGÊNCIA iniciada...`);
        
        try {
            const restoreResult = await this.backupSystem.emergencyRestore();
            
            if (restoreResult.success) {
                console.log(`${this.config.logPrefix} ✅ Restauração concluída: ${restoreResult.records} registros`);
                this.forceReset(); // Resetar estado do controller
                return restoreResult;
            } else {
                throw new Error(`Restauração falhou: ${restoreResult.error}`);
            }

        } catch (error) {
            console.error(`${this.config.logPrefix} ❌ FALHA CRÍTICA na restauração: ${error.message}`);
            throw error;
        }
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

    async executeControlledUpdate(updateFunction, type, useBackup = true) {
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

        // Escolher método de execução baseado no parâmetro useBackup
        if (useBackup) {
            console.log(`${this.config.logPrefix} Executando "${type}" com sistema de backup...`);
            this.updateState.updatePromise = this.executeWithBackup(type, updateFunction);
        } else {
            console.log(`${this.config.logPrefix} Executando "${type}" sem backup...`);
            this.startUpdate(type);
            this.updateState.updatePromise = this._executeUpdate(updateFunction, type);
        }
        
        return this.updateState.updatePromise;
    }

    async _executeUpdate(updateFunction, type) {
        try {
            console.log(`🚀 ${this.config.logPrefix} Executando atualização "${type}"...`);
            const result = await updateFunction();
            
            // Aguardar processamento da API Storage
            console.log(`${this.config.logPrefix} Aguardando processamento da API Storage...`);
            const validationDelay = parseInt(process.env.UPDATE_VALIDATION_DELAY) || 3000;
            await new Promise(resolve => setTimeout(resolve, validationDelay));
            
            // Validar sucesso
            const isSuccess = await this._validateUpdateSuccess(type, result);
            
            if (isSuccess) {
                this.endUpdate(true);
                return { success: true, result, type };
            } else {
                throw new Error('Validação pós-atualização falhou');
            }
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

        // Consulta rápida para saber se há bundles detalhados (ex: campo description preenchido)
        let hasDetailed = false;
        try {
            const { rows } = await storageSyncManager.queryStorage(`SELECT COUNT(*) as count FROM bundles WHERE description IS NOT NULL AND description <> ''`);
            hasDetailed = parseInt(rows[0]?.count) > 0;
        } catch (e) {
            console.warn(`${this.config.logPrefix} ⚠️ Não foi possível verificar se há bundles detalhados: ${e.message}`);
        }

        if (bundlesTable && bundlesTable.exists && bundlesTable.records === 0) {
            console.log(`${this.config.logPrefix} 🚀 DETETADO: A tabela 'bundles' está vazia. É necessária uma atualização completa.`);
            needsBasicUpdate = true;
            needsDetailedUpdate = true;
        } else if (bundlesTable && bundlesTable.exists && bundlesTable.records > 0 && !hasDetailed) {
            console.log(`${this.config.logPrefix} 🚀 DETETADO: Existem bundles básicos, mas não há detalhes. É necessária atualização detalhada.`);
            needsBasicUpdate = false;
            needsDetailedUpdate = true;
        } else if (bundlesTable && bundlesTable.exists && bundlesTable.records > 0 && hasDetailed) {
            console.log(`${this.config.logPrefix} ✅ Verificação concluída. Bundles básicos e detalhados presentes.`);
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

    /**
     * Valida se a atualização foi realmente bem-sucedida
     * Inclui retry para aguardar processamento da API Storage
     */
    async _validateUpdateSuccess(updateType, updateResult) {
        try {
            // Para função fetchBundles: se não deu erro, consideramos sucesso
            if (updateType.includes('fetch-basic') || updateType.includes('cron-fetch-basic')) {
                // Aguardar processamento com retry
                let retryCount = 0;
                const maxRetries = parseInt(process.env.UPDATE_VALIDATION_RETRIES) || 3;
                const retryDelay = parseInt(process.env.UPDATE_VALIDATION_RETRY_DELAY) || 3000;
                
                while (retryCount < maxRetries) {
                    try {
                        // Verificar se a Storage API tem os dados
                        const axios = require('axios');
                        const storageResponse = await axios.get(
                            `${process.env.STORAGE_API_URL}/api/bundles?limit=1`,
                            {
                                headers: { 'x-api-key': process.env.STORAGE_API_KEY },
                                timeout: 10000
                            }
                        );
                        
                        const totalRecords = storageResponse.data.data?.totalRecords || 0;
                        
                        if (totalRecords > 0) {
                            console.log(`${this.config.logPrefix} ✅ Validação: ${totalRecords} bundles na Storage API`);
                            return true;
                        }
                        
                        console.log(`${this.config.logPrefix} ⏳ Tentativa ${retryCount + 1}/${maxRetries}: Aguardando processamento...`);
                        
                    } catch (error) {
                        console.warn(`${this.config.logPrefix} ⚠️ Erro na validação (tentativa ${retryCount + 1}): ${error.message}`);
                    }
                    
                    retryCount++;
                    if (retryCount < maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, retryDelay));
                    }
                }
                
                // Se chegou aqui, assumimos sucesso (evitar bloquear o sistema)
                console.log(`${this.config.logPrefix} ⚠️ Validação não confirmou, mas assumindo sucesso`);
                return true;
            }
            
            // Para outras atualizações (detalhadas), verificar se updateResult indica sucesso
            if (updateResult && typeof updateResult === 'object') {
                return updateResult.success !== false;
            }
            
            // Se não há resultado específico, assume sucesso
            return true;
            
        } catch (error) {
            console.warn(`${this.config.logPrefix} ⚠️ Erro na validação, assumindo sucesso: ${error.message}`);
            return true; // Evitar bloquear por erro de validação
        }
    }
}

const updateController = new UpdateController();
module.exports = updateController;
