/**
 * Sistema de Log Persistente para Render
 * Armazena logs críticos na Storage API ao invés do console
 * Resolve limitações do console do Render (5min de retenção)
 */

class PersistentLogger {
    constructor() {
        this.storageApiUrl = process.env.STORAGE_API_URL;
        this.storageApiKey = process.env.STORAGE_API_KEY;
        this.sessionId = this.generateSessionId();
        this.logBuffer = [];
        this.maxBufferSize = 50; // Envia logs em lotes
        this.isEnabled = process.env.PERSISTENT_LOGGING !== 'false';
        
        console.log(`📝 [PERSISTENT LOGGER] Iniciado - Sessão: ${this.sessionId}`);
    }

    generateSessionId() {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substr(2, 8);
        return `session_${timestamp}_${random}`;
    }

    /**
     * Log crítico - sempre persiste
     */
    critical(operation, message, data = null) {
        this.log('CRITICAL', operation, message, data);
        // Console para emergências
        console.log(`🚨 [CRITICAL] ${operation}: ${message}`);
    }

    /**
     * Log de progresso - apenas principais marcos
     */
    progress(operation, message, data = null) {
        this.log('PROGRESS', operation, message, data);
        // Console mínimo
        if (data?.milestone) {
            console.log(`📊 [PROGRESS] ${message}`);
        }
    }

    /**
     * Log de erro - sempre persiste e exibe
     */
    error(operation, message, error = null) {
        const errorData = error ? {
            name: error.name,
            message: error.message,
            stack: error.stack?.split('\n').slice(0, 5).join('\n')
        } : null;
        
        this.log('ERROR', operation, message, errorData);
        console.error(`❌ [ERROR] ${operation}: ${message}`, error?.message || '');
    }

    /**
     * Log básico - apenas persiste, sem console
     */
    info(operation, message, data = null) {
        this.log('INFO', operation, message, data);
    }

    /**
     * Método interno de log
     */
    log(level, operation, message, data = null) {
        if (!this.isEnabled) return;

        const logEntry = {
            session_id: this.sessionId,
            timestamp: new Date().toISOString(),
            level,
            operation,
            message,
            data: data ? JSON.stringify(data) : null,
            server_info: {
                memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                uptime_s: Math.round(process.uptime()),
                pid: process.pid
            }
        };

        this.logBuffer.push(logEntry);

        // Envia em lotes para otimizar
        if (this.logBuffer.length >= this.maxBufferSize) {
            this.flushLogs();
        }
    }

    /**
     * Força envio dos logs pendentes
     */
    async flushLogs() {
        if (this.logBuffer.length === 0) return;

        const logsToSend = [...this.logBuffer];
        this.logBuffer = [];

        try {
            await this.sendToStorage(logsToSend);
        } catch (error) {
            // Falha silenciosa - logs voltam pro buffer
            this.logBuffer.unshift(...logsToSend);
            console.error(`⚠️ [LOGGER] Falha ao enviar logs:`, error.message);
        }
    }

    /**
     * Envia logs para a Storage API
     */
    async sendToStorage(logs) {
        if (!this.storageApiUrl || !this.storageApiKey) {
            throw new Error('Storage API não configurada');
        }

        // Enviar logs individualmente para o endpoint admin
        for (const logEntry of logs) {
            try {
                const response = await fetch(`${this.storageApiUrl}/api/admin?operation=process-logs`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': this.storageApiKey
                    },
                    body: JSON.stringify({
                        process_name: 'SteamBundleAPI',
                        session_id: logEntry.session_id,
                        log_level: logEntry.level.toLowerCase(),
                        message: `[${logEntry.operation}] ${logEntry.message}`,
                        data: {
                            timestamp: logEntry.timestamp,
                            server_info: logEntry.server_info,
                            original_data: logEntry.data ? JSON.parse(logEntry.data) : null
                        }
                    }),
                    timeout: 10000
                });

                if (!response.ok) {
                    throw new Error(`Storage API error: ${response.status}`);
                }
            } catch (error) {
                // Falha silenciosa individual - continua com próximo log
                console.error(`⚠️ [LOGGER] Falha ao enviar log individual:`, error.message);
            }
        }
    }

    /**
     * Finaliza sessão de log
     */
    async finalize(summary = null) {
        // Log final com resumo
        this.critical('SESSION_END', 'Sessão de logging finalizada', {
            total_logs: this.logBuffer.length,
            session_duration: Math.round(process.uptime()),
            summary
        });

        // Força envio final
        await this.flushLogs();
        
        console.log(`📝 [PERSISTENT LOGGER] Sessão finalizada: ${this.sessionId}`);
    }

    /**
     * Cria marco de progresso para operações longas
     */
    milestone(operation, message, current, total, additionalData = null) {
        const percentage = Math.round((current / total) * 100);
        
        this.progress(operation, `${message} (${current}/${total} - ${percentage}%)`, {
            milestone: true,
            current,
            total,
            percentage,
            ...additionalData
        });
    }

    /**
     * Log de performance/timing
     */
    timing(operation, duration, details = null) {
        const formattedDuration = duration > 1000 
            ? `${Math.round(duration/1000)}s` 
            : `${duration}ms`;

        this.info('TIMING', `${operation} completado em ${formattedDuration}`, {
            duration_ms: duration,
            ...details
        });
    }
}

// Singleton para uso global
let loggerInstance = null;

function getLogger() {
    if (!loggerInstance) {
        loggerInstance = new PersistentLogger();
    }
    return loggerInstance;
}

module.exports = { PersistentLogger, getLogger };
