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
            interval: 8 * 60 * 1000,
            maxPings: 180,
            endpoints: [
                '/api/steam-stats',
                '/api/update-status',
                '/'
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
        console.log(`   ⏰ Ping a cada ${this.config.interval / 1000 / 60} minutos`);
        console.log(`   🎯 Máximo ${this.config.maxPings} pings (${this.config.maxPings * 8 / 60} horas)`);

        // Primeiro ping imediato
        this.ping();

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
     * Executa um ping para manter acordado
     */
    async ping() {
        if (!this.isActive) return;

        // Verifica limite máximo
        if (this.pingCount >= this.config.maxPings) {
            console.log('⏰ Keep-alive atingiu limite máximo, parando...');
            this.stop('max-pings-reached');
            return;
        }

        try {
            const endpoint = this.config.endpoints[this.pingCount % this.config.endpoints.length];
            const url = this.getBaseUrl() + endpoint;
            
            const startPing = Date.now();
            const response = await axios.get(url, {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Render-KeepAlive/1.0',
                    'X-Keep-Alive': 'true',
                    'X-Ping-Count': this.pingCount.toString()
                }
            });
            const pingDuration = Date.now() - startPing;

            this.pingCount++;
            this.lastPingTime = new Date();

            const totalMinutes = Math.round((new Date() - this.startTime) / 1000 / 60);
            
            console.log(`💓 Keep-alive ping #${this.pingCount}: ${endpoint} (${pingDuration}ms) - Ativo há ${totalMinutes}min`);

            // Log a cada 12 pings (96 minutos ~ 1.6 horas)
            if (this.pingCount % 12 === 0) {
                console.log(`📊 Keep-alive status: ${this.pingCount}/${this.config.maxPings} pings - ${totalMinutes}/1440 minutos`);
            }

        } catch (error) {
            console.warn(`⚠️ Keep-alive ping falhou: ${error.message}`);
            
            // Se falhar muitas vezes seguidas, para o sistema
            if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
                console.log('🔌 Servidor pode estar dormindo, tentando acordar...');
            }
        }
    }

    /**
     * Obtém a URL base da API
     */
    getBaseUrl() {
        // Em produção (Render), usa a própria URL
        if (process.env.RENDER_EXTERNAL_URL) {
            return process.env.RENDER_EXTERNAL_URL;
        }
        
        // Em desenvolvimento, usa localhost
        const port = process.env.PORT || 3000;
        return `http://localhost:${port}`;
    }

    /**
     * Status do keep-alive
     */
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
