/**
 * Sistema de Backup e Continuidade de Serviço
 * Blue-Green Deployment para atualizações sem interrupção
 */

const axios = require('axios');

class BackupSystem {
    constructor() {
        this.STORAGE_API_URL = process.env.STORAGE_API_URL || 'https://bundleset-api-storage.vercel.app';
        this.STORAGE_API_KEY = process.env.STORAGE_API_KEY;
    }

    /**
     * Cria tabelas de backup necessárias
     */
    async createBackupTables() {
        console.log('🏗️ Criando sistema de backup tables...');

        const backupSchema = {
            action: 'create_backup_system',
            tables: [
                {
                    name: 'bundles_backup',
                    based_on: 'bundles',
                    description: 'Backup da tabela principal para continuidade durante updates'
                },
                {
                    name: 'bundles_active', 
                    based_on: 'bundles',
                    description: 'Tabela ativa que será servida durante updates'
                },
                {
                    name: 'system_status',
                    columns: [
                        'id SERIAL PRIMARY KEY',
                        'active_table VARCHAR(50) NOT NULL', // 'bundles', 'bundles_backup', 'bundles_active'
                        'update_status VARCHAR(20) DEFAULT \'idle\'', // 'idle', 'updating', 'switching'
                        'last_backup_at TIMESTAMP',
                        'last_update_at TIMESTAMP',
                        'total_records INTEGER DEFAULT 0',
                        'backup_records INTEGER DEFAULT 0',
                        'created_at TIMESTAMP DEFAULT NOW()',
                        'updated_at TIMESTAMP DEFAULT NOW()'
                    ]
                }
            ]
        };

        try {
            const response = await axios.post(`${this.STORAGE_API_URL}/api/admin?operation=create_backup_system`, {}, {
                headers: {
                    'x-api-key': this.STORAGE_API_KEY,
                    'Content-Type': 'application/json'
                },
                timeout: 60000
            });

            console.log('✅ Sistema de backup criado:', response.data);
            return { success: true, data: response.data };

        } catch (error) {
            console.error('❌ Erro ao criar sistema de backup:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Executa backup da tabela principal antes de atualização
     */
    async performBackup() {
        console.log('💾 Iniciando backup da tabela bundles...');

        try {
            // 1. Copiar bundles para bundles_backup
            const backupResponse = await axios.post(`${this.STORAGE_API_URL}/api/admin?operation=backup_table`, {
                source_table: 'bundles',
                backup_table: 'bundles_backup'
            }, {
                headers: {
                    'x-api-key': this.STORAGE_API_KEY,
                    'Content-Type': 'application/json'
                },
                timeout: 120000 // 2 minutos
            });

            console.log('✅ Backup realizado:', backupResponse.data);

            // 2. Atualizar status do sistema
            await this.updateSystemStatus('idle', 'bundles', {
                last_backup_at: new Date().toISOString(),
                backup_records: backupResponse.data.records_copied || 0
            });

            return { success: true, records: backupResponse.data.records_copied };

        } catch (error) {
            console.error('❌ Erro no backup:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Inicia processo de atualização (modo Blue-Green)
     */
    async startUpdate() {
        console.log('🔄 Iniciando processo de atualização Blue-Green...');

        try {
            // 1. Fazer backup antes de começar
            const backupResult = await this.performBackup();
            if (!backupResult.success) {
                throw new Error(`Backup falhou: ${backupResult.error}`);
            }

            // 2. Mudar API para usar tabela de backup enquanto atualiza principal
            await this.switchActiveTable('bundles_backup');

            // 3. Marcar sistema como "updating"
            await this.updateSystemStatus('updating', 'bundles_backup');

            console.log('✅ Sistema preparado para atualização. API usando bundles_backup.');
            return { success: true, active_table: 'bundles_backup' };

        } catch (error) {
            console.error('❌ Erro ao iniciar atualização:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Finaliza processo de atualização e volta para tabela principal
     */
    async finishUpdate() {
        console.log('✅ Finalizando processo de atualização...');

        try {
            // 1. Mudar API de volta para tabela principal
            await this.switchActiveTable('bundles');

            // 2. Marcar sistema como "idle"
            await this.updateSystemStatus('idle', 'bundles', {
                last_update_at: new Date().toISOString()
            });

            console.log('✅ Atualização finalizada. API usando bundles novamente.');
            return { success: true, active_table: 'bundles' };

        } catch (error) {
            console.error('❌ Erro ao finalizar atualização:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Muda qual tabela a API deve usar
     */
    async switchActiveTable(tableName) {
        console.log(`🔀 Mudando tabela ativa para: ${tableName}`);

        try {
            const response = await axios.post(`${this.STORAGE_API_URL}/api/admin?operation=switch_active_table`, {
                table_name: tableName
            }, {
                headers: {
                    'x-api-key': this.STORAGE_API_KEY,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            });

            console.log(`✅ Tabela ativa mudada para: ${tableName}`);
            return response.data;

        } catch (error) {
            console.error(`❌ Erro ao mudar tabela ativa: ${error.message}`);
            throw error;
        }
    }

    /**
     * Atualiza status do sistema
     */
    async updateSystemStatus(updateStatus, activeTable, extraData = {}) {
        try {
            await axios.post(`${this.STORAGE_API_URL}/api/admin?operation=update_system_status`, {
                update_status: updateStatus,
                active_table: activeTable,
                ...extraData
            }, {
                headers: {
                    'x-api-key': this.STORAGE_API_KEY,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            });

        } catch (error) {
            console.warn(`⚠️ Erro ao atualizar status: ${error.message}`);
        }
    }

    /**
     * Verifica status atual do sistema
     */
    async getSystemStatus() {
        try {
            const response = await axios.get(`${this.STORAGE_API_URL}/api/admin?operation=system-status`, {
                headers: {
                    'x-api-key': this.STORAGE_API_KEY
                },
                timeout: 15000
            });

            return response.data;

        } catch (error) {
            console.error('❌ Erro ao obter status:', error.message);
            return null;
        }
    }

    /**
     * Restaura sistema a partir do backup em caso de falha
     */
    async emergencyRestore() {
        console.log('🚨 RESTAURAÇÃO DE EMERGÊNCIA - Copiando backup para principal...');

        try {
            // 1. Copiar bundles_backup para bundles
            const restoreResponse = await axios.post(`${this.STORAGE_API_URL}/api/admin?operation=restore_from_backup`, {
                source_table: 'bundles_backup',
                target_table: 'bundles'
            }, {
                headers: {
                    'x-api-key': this.STORAGE_API_KEY,
                    'Content-Type': 'application/json'
                },
                timeout: 120000
            });

            // 2. Voltar API para tabela principal
            await this.switchActiveTable('bundles');

            // 3. Marcar como idle
            await this.updateSystemStatus('idle', 'bundles');

            console.log('✅ Restauração de emergência concluída:', restoreResponse.data);
            return { success: true, records: restoreResponse.data.records_restored };

        } catch (error) {
            console.error('❌ ERRO CRÍTICO na restauração:', error.message);
            return { success: false, error: error.message };
        }
    }
}

module.exports = BackupSystem;
