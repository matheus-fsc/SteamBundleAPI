
require('dotenv').config();
const axios = require('axios');
const moment = require('moment-timezone');



class StorageSyncManager {
    constructor() {
        this.storageApiUrl = process.env.STORAGE_API_URL || 'https://bundleset-api-storage.vercel.app';
        this.apiKey = process.env.STORAGE_API_KEY;
        this.timeout = parseInt(process.env.STORAGE_TIMEOUT) || 30000;
        this.maxRetries = parseInt(process.env.STORAGE_MAX_RETRIES) || 3;
        this.chunkSize = parseInt(process.env.STORAGE_CHUNK_SIZE) || 500;
        this.timezone = 'America/Sao_Paulo';
    }

    /**
     * Sincroniza bundles básicos (usado pelo fetchBundles)
     * @param {Array} bundles Array de bundles básicos
     * @param {Object} statusMetadata Metadados sobre o status da sincronização
     */
    async syncBasicBundles(bundles, statusMetadata) {
        const payload = {
            bundles,
            ...statusMetadata
        };
        const response = await axios.post(
            `${this.storageApiUrl}/api/sync`,
            payload,
            {
                timeout: this.timeout,
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.apiKey
                }
            }
        );
        return response.data;
    }

    validateConfig() {
        if (!this.storageApiUrl) {
            throw new Error('STORAGE_API_URL não configurada');
        }
        if (!this.apiKey) {
            throw new Error('STORAGE_API_KEY não configurada');
        }
        console.log(`🔧 Storage API configurada: ${this.storageApiUrl}`);
    }

    async testConnection() {
        try {
            const response = await axios.get(`${this.storageApiUrl}/api/health`, {
                timeout: 5000,
                headers: {
                    'x-api-key': this.apiKey
                }
            });
            return {
                success: true,
                status: response.status,
                latency: response.data.latency || 'N/A'
            };
        } catch (error) {
            console.warn(`⚠️ Teste de conectividade falhou: ${error.message}`);
            return {
                success: false,
                error: error.message
            };
        }
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
