require('dotenv').config();
const axios = require('axios');
const moment = require('moment-timezone');

class StorageSyncManager {
    // [NOVO] Finaliza a sessão de DETALHES na API
    async finishDetailedSyncSession(sessionId) {
        const apiCall = () => axios.post(`${this.storageApiUrl}/api/finish?type=detailed`, {}, {
            headers: { 'x-api-key': this.apiKey, 'X-Session-ID': sessionId }
        });
        
        const response = await this._executeWithRetry(apiCall, `Finish Detailed Session ${sessionId}`);
        console.log(`✅ Sessão de detalhes ${sessionId} finalizada com sucesso na API!`);
        return response.data;
    }
    // [NOVO] Sincroniza a fila de falhas com a Storage API
    async syncFailedBundlesQueue(queueData) {
        const apiCall = () => axios.post(`${this.storageApiUrl}/api/failed-queue`, queueData, {
            headers: { 'x-api-key': this.apiKey, 'Content-Type': 'application/json' },
            timeout: this.timeout
        });

        await this._executeWithRetry(apiCall, 'Sync Failed Queue');
        console.log('✅ Fila de falhas sincronizada com o storage backend');
    }
    constructor() {
        this.storageApiUrl = process.env.STORAGE_API_URL || 'https://bundleset-api-storage.vercel.app';
        this.apiKey = process.env.STORAGE_API_KEY;
        this.timeout = parseInt(process.env.STORAGE_TIMEOUT) || 30000;
        this.maxRetries = parseInt(process.env.STORAGE_MAX_RETRIES) || 3;
        this.chunkSize = parseInt(process.env.STORAGE_CHUNK_SIZE) || 500;
        this.timezone = 'America/Sao_Paulo';
        // Valida a configuração assim que a classe é instanciada
        this.validateConfig();
    }

    // =========================================================================
    // NOVO: Executor de Retentativas Privado
    // =========================================================================
    /**
     * Executa uma função de chamada de API com uma política de retentativa.
     * @private
     * @param {() => Promise<any>} apiCallFunction A função axios a ser executada.
     * @param {string} operationName Nome da operação para logs claros.
     * @returns {Promise<any>} O resultado da chamada da API.
     */
    async _executeWithRetry(apiCallFunction, operationName) {
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                // Tenta executar a chamada da API
                return await apiCallFunction();
            } catch (error) {
                const errorMessage = error.response ? `status ${error.response.status}` : error.message;
                console.warn(`⚠️ Falha na operação '${operationName}' (tentativa ${attempt}/${this.maxRetries}): ${errorMessage}`);
                
                if (attempt < this.maxRetries) {
                    // Delay exponencial para dar tempo à API de se recuperar/acordar
                    const delayTime = 10000 * attempt; // 10s, 20s, 30s
                    console.log(`⏳ Tentando novamente em ${delayTime / 1000}s...`);
                    await new Promise(resolve => setTimeout(resolve, delayTime));
                } else {
                    console.error(`❌ Falha final na operação '${operationName}' após ${this.maxRetries} tentativas.`);
                    // Lança o erro para que o processo principal saiba que falhou.
                    throw error;
                }
            }
        }
    }
    /**
     * Consulta o endpoint de saúde da API de Storage para verificar o status do banco de dados.
     */
    async getStorageHealth() {
        // ALTERADO: Agora usa o executor para ser mais robusto
        const apiCall = () => axios.get(`${this.storageApiUrl}/api/health`, {
            timeout: 10000,
            headers: { 'x-api-key': this.apiKey }
        });
        
        const response = await this._executeWithRetry(apiCall, 'Health Check');
        return { success: true, data: response.data };
    }


    // NOVO: Inicia uma sessão de sincronização na API
    async startSyncSession() {
        // ALTERADO: Agora é robusto e "acorda" a API antes de iniciar.
        console.log('☀️  Verificando e acordando a API de Storage antes de iniciar a sessão...');
        await this.getStorageHealth(); // O "wake-up call"
        console.log('✅ API de Storage está online.');

        const apiCall = () => axios.post(`${this.storageApiUrl}/api/sync/start`, {}, {
            headers: { 'x-api-key': this.apiKey }
        });
        
        const response = await this._executeWithRetry(apiCall, 'Start Session');
        console.log(`🚀 Sessão de sincronização iniciada: ${response.data.sessionId}`);
        return response.data.sessionId;
    }

    // NOVO: Envia um lote de bundles básicos para uma sessão existente
    async syncBasicBatch(bundles, sessionId) {
        // ALTERADO: Agora usa o executor
        const payload = { bundles };
        const apiCall = () => axios.post(`${this.storageApiUrl}/api/sync/basic-batch`, payload, {
            headers: { 'x-api-key': this.apiKey, 'X-Session-ID': sessionId }
        });

        await this._executeWithRetry(apiCall, `Sync Basic Batch (Session ${sessionId})`);
        console.log(`📦 Lote de ${bundles.length} bundles básicos enviado para a sessão ${sessionId}`);
    }

    // [CORRIGIDO] Finaliza a sessão, acionando o processamento na API
    async finishSyncSession(sessionId) {
        // A URL foi corrigida de '/api/sync/finish' para '/api/finish'
        const apiCall = () => axios.post(`${this.storageApiUrl}/api/finish`, {}, {
            headers: { 'x-api-key': this.apiKey, 'X-Session-ID': sessionId }
        });

        const response = await this._executeWithRetry(apiCall, `Finish Session ${sessionId}`);
        console.log(`✅ Sessão ${sessionId} finalizada com sucesso!`);
        return response.data;
    }

    validateConfig() {
        if (!this.storageApiUrl) throw new Error('STORAGE_API_URL não configurada');
        if (!this.apiKey) throw new Error('STORAGE_API_KEY não configurada');
        // Este log só precisa aparecer uma vez
        // console.log(`🔧 Storage API configurada: ${this.storageApiUrl}`);
    }
    
    // CORRIGIDO: A função delay deve apenas esperar, sem outra lógica.
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    // Método original syncBatch agora pode ser simplificado para usar o executor também
    async syncBatch(bundles, metadata = {}) {
        const payload = { bundles, metadata };
        const apiCall = () => axios.post(
            `${this.storageApiUrl}/api/bundles/detailed/batch`,
            payload,
            {
                timeout: this.timeout,
                headers: { 'Content-Type': 'application/json', 'x-api-key': this.apiKey }
            }
        );
        const response = await this._executeWithRetry(apiCall, `Sync Detailed Batch (Chunk ${metadata.chunkNumber})`);
        console.log(`✅ Batch detalhado sincronizado: chunk ${metadata.chunkNumber}`);
        return response;
    }

    // Os demais métodos (getBundles, getBundlesDetailed, etc.) permanecem os mesmos.
    // Se precisar, você pode envolvê-los com _executeWithRetry também.
    async getBundles() {
        // ...código original...
    }
    async getBundlesDetailed() {
        // ...código original...
    }
    async cleanupLocalFiles(filePaths) {
        // ...código original...
    }
    async testConnection() {
        // ...código original...
    }

    /**
     * Sincroniza um batch de bundles detalhados usando o novo endpoint simplificado
     * @param {Array} bundles Array de bundles detalhados
     * @param {Object} metadata { sessionId, chunkNumber, isLastChunk }
     */
    async syncBatch(bundles, metadata = {}) {
        if (!Array.isArray(bundles) || bundles.length === 0) {
            throw new Error('O parâmetro "bundles" deve ser um array não vazio.');
        }
        const payload = {
            bundles,
            metadata: {
                sessionId: metadata.sessionId,
                chunkNumber: metadata.chunkNumber,
                isLastChunk: metadata.isLastChunk
            }
        };
        let attempt = 0;
        while (attempt <= this.maxRetries) {
            try {
                const response = await axios.post(
                    `${this.storageApiUrl}/api/bundles/detailed/batch`,
                    payload,
                    {
                        timeout: this.timeout,
                        headers: {
                            'Content-Type': 'application/json',
                            'x-api-key': this.apiKey
                        }
                    }
                );
                console.log(`✅ Batch sincronizado: chunk ${metadata.chunkNumber} (isLastChunk: ${metadata.isLastChunk})`);
                return response.data;
            } catch (error) {
                attempt++;
                if (attempt > this.maxRetries) {
                    console.error(`❌ Erro ao sincronizar batch após ${this.maxRetries} tentativas:`, error.message);
                    throw error;
                }
                console.warn(`⚠️ Tentativa ${attempt}/${this.maxRetries} falhou, tentando novamente...`);
                await this.delay(1000 * attempt);
            }
        }
    }

    /**
     * Consulta bundles básicos usando a nova rota otimizada
     */
    async getBundles() {
        try {
            const response = await axios.get(`${this.storageApiUrl}/api/bundles`, {
                timeout: this.timeout
            });
            return response.data;
        } catch (error) {
            console.error('❌ Erro ao buscar bundles básicos:', error.message);
            throw error;
        }
    }

    /**
     * Consulta bundles detalhados usando a nova rota otimizada
     */
    async getBundlesDetailed() {
        try {
            const response = await axios.get(`${this.storageApiUrl}/api/bundles-detailed`, {
                timeout: this.timeout
            });
            return response.data;
        } catch (error) {
            console.error('❌ Erro ao buscar bundles detalhados:', error.message);
            throw error;
        }
    }

    /**
     * Limpa arquivos locais após sincronização bem-sucedida
     */
    async cleanupLocalFiles(filePaths) {
        const fs = require('fs');
        let cleaned = 0;
        for (const filePath of filePaths) {
            try {
                if (fs.existsSync(filePath)) {
                    await fs.promises.unlink(filePath);
                    cleaned++;
                    console.log(`🗑️ Arquivo local removido: ${filePath}`);
                }
            } catch (error) {
                console.warn(`⚠️ Erro ao remover ${filePath}:`, error.message);
            }
        }
        console.log(`🧹 Limpeza concluída: ${cleaned}/${filePaths.length} arquivos removidos`);
        return cleaned;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

const storageSyncManager = new StorageSyncManager();

module.exports = { storageSyncManager };
