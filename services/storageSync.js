const axios = require('axios');
const moment = require('moment-timezone');

class StorageSyncManager {
    constructor() {
        this.storageApiUrl = process.env.STORAGE_API_URL || 'https://bundleset-api-storage.vercel.app';
        this.apiKey = process.env.STORAGE_API_KEY;
        this.timeout = parseInt(process.env.STORAGE_TIMEOUT) || 30000;
        this.maxRetries = parseInt(process.env.STORAGE_MAX_RETRIES) || 3;
        this.chunkSize = parseInt(process.env.STORAGE_CHUNK_SIZE) || 1000;
        this.timezone = 'America/Sao_Paulo';
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

    async syncBasicBundles(bundles) {
        const syncData = {
            bundles: bundles,
            updateStatus: {
                bundles: {
                    isComplete: true,
                    totalRecords: bundles.length,
                    recordsReceived: bundles.length
                }
            },
            requestMetadata: {
                timestamp: moment().tz(this.timezone).format(),
                source: 'fetchBundles',
                type: 'basic_bundles'
            }
        };

        return await this.makeRequest('/api/sync', syncData);
    }

    async syncDetailedBundlesChunk(bundlesDetailed, chunkInfo) {
        const syncData = {
            bundlesDetailed: bundlesDetailed,
            updateStatus: {
                bundlesDetailed: {
                    totalRecords: chunkInfo.totalRecords,
                    recordsReceived: bundlesDetailed.length
                }
            },
            requestMetadata: {
                timestamp: moment().tz(this.timezone).format(),
                source: 'updateBundles',
                type: 'detailed_bundles_chunk',
                chunkInfo: chunkInfo
            }
        };

        return await this.makeRequest('/api/sync', syncData);
    }

    async syncFinalData(bundlesDetailed, totalExpected) {
        const syncData = {
            bundlesDetailed: bundlesDetailed,
            updateStatus: {
                bundlesDetailed: {
                    isComplete: true,
                    totalRecords: totalExpected,
                    recordsReceived: bundlesDetailed.length
                }
            },
            requestMetadata: {
                timestamp: moment().tz(this.timezone).format(),
                source: 'updateBundles',
                type: 'detailed_bundles_final'
            }
        };

        return await this.makeRequest('/api/sync', syncData);
    }

    calculateChunkInfo(bundlesDetailed, currentIndex, totalExpected) {
        const chunkNumber = Math.floor(currentIndex / this.chunkSize) + 1;
        const totalChunks = Math.ceil(totalExpected / this.chunkSize);
        const isLastChunk = chunkNumber === totalChunks;
        
        return {
            isChunk: true,
            chunkNumber: chunkNumber,
            totalChunks: totalChunks,
            chunkSize: bundlesDetailed.length,
            isLastChunk: isLastChunk,
            totalRecords: totalExpected
        };
    }

    shouldSyncDetailedChunk(currentBundlesLength) {
        return currentBundlesLength >= this.chunkSize;
    }

    async cleanupLocalFiles(filePaths) {
        const fs = require('fs').promises;
        const fsSync = require('fs');
        
        for (const filePath of filePaths) {
            try {
                if (fsSync.existsSync(filePath)) {
                    await fs.unlink(filePath);
                    console.log(`🧹 Arquivo removido: ${filePath}`);
                }
            } catch (error) {
                console.warn(`⚠️ Erro ao remover ${filePath}:`, error.message);
            }
        }
    }

    async makeRequest(endpoint, data, retryCount = 0) {
        try {
            const response = await axios.post(`${this.storageApiUrl}${endpoint}`, data, {
                timeout: this.timeout,
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.apiKey
                }
            });

            console.log(`✅ Sincronização bem-sucedida - ${endpoint}`);
            return response.data;
        } catch (error) {
            if (retryCount < this.maxRetries) {
                console.warn(`⚠️ Tentativa ${retryCount + 1}/${this.maxRetries + 1} falhou, tentando novamente...`);
                await this.delay(1000 * (retryCount + 1)); // Backoff exponencial
                return await this.makeRequest(endpoint, data, retryCount + 1);
            }
            
            console.error(`❌ Erro na sincronização após ${this.maxRetries + 1} tentativas:`, error.message);
            throw error;
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Métodos para consultar dados específicos das novas rotas
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

    async getAllData() {
        try {
            const response = await axios.get(`${this.storageApiUrl}/api/data`, {
                timeout: this.timeout
            });
            return response.data;
        } catch (error) {
            console.error('❌ Erro ao buscar todos os dados:', error.message);
            throw error;
        }
    }
}

const storageSyncManager = new StorageSyncManager();

module.exports = { storageSyncManager };
