/**
 * Sistema Keep-Alive para Render Free
 * Mantém a API acordada durante atualizações longas
 */

const axios = require('axios');

class RenderKeepAlive {
    constructor() {
        this.isActive = false;
        this.intervalId = null;
        this.pingCount = 0;
        this.startTime = null;
        this.lastPingTime = null;
        this.config = {
            interval: 12 * 60 * 1000, // 12 minutos (menos agressivo)
            maxPings: 120, // Reduzido para menos stress
            timeout: 15000, // Timeout maior para evitar 503
            endpoints: [
                '/ping',       // Endpoint ultra-leve
                '/api/status'  // Fallback
            ]
        };
    }

    /**
     * Inicia o sistema keep-alive
     */
    start(reason = 'background-task') {
        if (this.isActive) {
            console.log('⚡ Keep-alive já está ativo');
            return;
        }

        this.isActive = true;
        this.pingCount = 0;
        this.startTime = new Date();
        this.lastPingTime = new Date();

        console.log(`🔄 Keep-alive INICIADO: ${reason}`);
        console.log(`   ⏰ Ping a cada ${this.config.interval / 1000 / 60} minutos (MODO CONSERVADOR)`);
        console.log(`   🎯 Máximo ${this.config.maxPings} pings (${Math.round(this.config.maxPings * 12 / 60)} horas)`);
        console.log(`   🛡️ Endpoint ultra-leve: /ping`);

        // Aguardar 3 minutos antes do primeiro ping para deixar o servidor estabilizar
        setTimeout(() => {
            if (this.isActive) {
                this.ping();
            }
        }, 3 * 60 * 1000);

        // Configura pings regulares
        this.intervalId = setInterval(() => {
            this.ping();
        }, this.config.interval);
    }

    /**
     * Para o sistema keep-alive
     */
    stop(reason = 'task-completed') {
        if (!this.isActive) {
            return;
        }

        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        const duration = this.startTime ? Math.round((new Date() - this.startTime) / 1000 / 60) : 0;
        
        console.log(`🛑 Keep-alive PARADO: ${reason}`);
        console.log(`   📊 Total de pings: ${this.pingCount}`);
        console.log(`   ⏱️ Tempo ativo: ${duration} minutos`);
        console.log(`   💾 Memória economizada: ~${this.pingCount * 0.1}MB de logs`);

        this.isActive = false;
        this.pingCount = 0;
        this.startTime = null;
        this.lastPingTime = null;
    }

    /**
     * Executa um ping para manter acordado, com lógica de retentativa.
     */
    async ping() {
        if (!this.isActive) return;

        if (this.pingCount >= this.config.maxPings) {
            console.log('⏰ Keep-alive atingiu limite máximo, parando...');
            this.stop('max-pings-reached');
            return;
        }

        // --- INÍCIO DA MODIFICAÇÃO: LÓGICA DE RETENTATIVA ---
        const MAX_PING_RETRIES = 2; // Reduzido para menos stress
        const PING_RETRY_DELAY = 30000; // 30 segundos (mais tempo para servidor recuperar)

        for (let attempt = 1; attempt <= MAX_PING_RETRIES; attempt++) {
            try {
                // Usar endpoint mais leve primeiro
                const endpoint = this.config.endpoints[0]; // Sempre /api/status
                const url = this.getBaseUrl() + endpoint;
                
                const startPing = Date.now();
                await axios.get(url, {
                    timeout: this.config.timeout,
                    headers: {
                        'User-Agent': 'Render-KeepAlive-Lite/1.0',
                        'X-Keep-Alive': 'true',
                        'X-Ping-Count': this.pingCount.toString(),
                        'Connection': 'close' // Não manter conexão aberta
                    }
                });
                const pingDuration = Date.now() - startPing;

                this.pingCount++;
                this.lastPingTime = new Date();
                const totalMinutes = Math.round((new Date() - this.startTime) / 1000 / 60);
                
                // Log menos verboso para não poluir
                if (this.pingCount % 5 === 0 || pingDuration > 5000) {
                    console.log(`� Keep-alive ping #${this.pingCount}: ${endpoint} (${pingDuration}ms) - Ativo há ${totalMinutes}min`);
                }

                return; // SUCESSO: Sai do loop e da função.

            } catch (error) {
                const isServerBusy = error.response?.status === 503 || error.code === 'ECONNRESET';
                
                if (isServerBusy && attempt === 1) {
                    console.log(`⚡ Servidor ocupado (scraping), aguardando ${PING_RETRY_DELAY / 1000}s...`);
                } else {
                    console.warn(`⚠️ Keep-alive ping falhou (tentativa ${attempt}/${MAX_PING_RETRIES}): ${error.message}`);
                }
                
                if (attempt < MAX_PING_RETRIES) {
                    await new Promise(resolve => setTimeout(resolve, PING_RETRY_DELAY));
                } else {
                    console.log(`⏭️ Pulando ping #${this.pingCount} - servidor muito ocupado com scraping`);
                }
            }
        }
        // --- FIM DA MODIFICAÇÃO ---
    }

    /**
     * Obtém a URL base da API
     */
    getBaseUrl() {
        // Em produção (Render), usa a própria URL
        if (process.env.RENDER_EXTERNAL_URL) {
            return process.env.RENDER_EXTERNAL_URL;
        }
        
        // Render automaticamente define RENDER_SERVICE_URL
        if (process.env.RENDER_SERVICE_URL) {
            return process.env.RENDER_SERVICE_URL;
        }
        
        // Tentar construir URL do Render se temos o nome do serviço
        if (process.env.RENDER && process.env.NODE_ENV === 'production') {
            // Formato típico: https://nome-do-servico.onrender.com
            return 'https://steambundleapi.onrender.com';
        }
        
        // Em desenvolvimento, usa localhost
        const port = process.env.PORT || 3000;
        return `http://localhost:${port}`;
    }

    /**
     * Status do keep-alive
     */
    isRunning() {
        return this.isActive && this.intervalId !== null;
    }

    getStatus() {
        if (!this.isActive) {
            return {
                active: false,
                message: 'Keep-alive não está ativo'
            };
        }

        const duration = Math.round((new Date() - this.startTime) / 1000 / 60);
        const timeUntilNext = this.config.interval - ((new Date() - this.lastPingTime) % this.config.interval);
        const minutesUntilNext = Math.round(timeUntilNext / 1000 / 60);

        return {
            active: true,
            ping_count: this.pingCount,
            max_pings: this.config.maxPings,
            duration_minutes: duration,
            next_ping_in_minutes: minutesUntilNext,
            efficiency: `${this.pingCount}/${this.config.maxPings} pings (${Math.round((this.pingCount / this.config.maxPings) * 100)}%)`,
            estimated_remaining_hours: Math.round(((this.config.maxPings - this.pingCount) * 8) / 60 * 10) / 10
        };
    }
    
    async forcePing() {
        console.log('🔧 Ping manual solicitado...');
        await this.ping();
    }
}

// Singleton global
const keepAlive = new RenderKeepAlive();

module.exports = {
    keepAlive,
    RenderKeepAlive
};
