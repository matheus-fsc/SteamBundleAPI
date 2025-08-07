/**
 * Configurações Avançadas do Scraping
 * Permite ajustes finos baseados no ambiente e performance
 */

const fs = require('fs');
const path = require('path');

class ScrapingConfigManager {
    constructor() {
        this.configFile = path.join(__dirname, 'scraping-config.json');
        this.defaultConfig = {
            // Configurações de timing
            delays: {
                betweenRequests: 750,
                afterError: 2000,
                afterRateLimit: 10000,
                afterAgeGate: 3000,
                randomVariation: 2000
            },
            
            // Configurações de timeout
            timeouts: {
                request: 25000,
                nsfw: 15000,
                fallback: 12000
            },
            
            // Configurações de retry
            retries: {
                maxAttempts: 3,
                delayMultiplier: 2,
                backoffStrategy: 'exponential' // 'linear' ou 'exponential'
            },
            
            // Configurações de fallback
            fallback: {
                enabled: true,
                maxApps: 15,
                batchSize: 3,
                delay: 800
            },
            
            // Configurações de extração
            extraction: {
                enableMultipleSelectors: true,
                enableFallbackDescription: true,
                enablePriceNormalization: true,
                maxDescriptionLength: 500
            },
            
            // Configurações de performance
            performance: {
                parallelBundles: 2,
                conservativeMode: false,
                enableGarbageCollection: true,
                monitorPerformance: true
            },
            
            // Configurações de log
            logging: {
                level: 'info', // 'debug', 'info', 'warn', 'error'
                enableFileLogging: true,
                enableConsoleColors: true,
                logPerformanceMetrics: true
            },
            
            // Configurações específicas por ambiente
            environments: {
                development: {
                    delays: { betweenRequests: 500 },
                    logging: { level: 'debug' },
                    performance: { parallelBundles: 1 }
                },
                production: {
                    delays: { betweenRequests: 1000 },
                    performance: { conservativeMode: true },
                    logging: { level: 'warn' }
                },
                testing: {
                    delays: { betweenRequests: 200 },
                    retries: { maxAttempts: 1 },
                    fallback: { maxApps: 5 }
                }
            }
        };
        
        this.currentConfig = this.loadConfig();
    }

    /**
     * Carrega configuração do arquivo ou usa padrão
     */
    loadConfig() {
        try {
            if (fs.existsSync(this.configFile)) {
                const fileConfig = JSON.parse(fs.readFileSync(this.configFile, 'utf8'));
                return this.mergeConfigs(this.defaultConfig, fileConfig);
            }
        } catch (error) {
            console.warn('⚠️ Erro ao carregar configuração, usando padrão:', error.message);
        }
        
        return { ...this.defaultConfig };
    }

    /**
     * Mescla configurações recursivamente
     */
    mergeConfigs(defaultConfig, userConfig) {
        const merged = { ...defaultConfig };
        
        for (const [key, value] of Object.entries(userConfig)) {
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                merged[key] = this.mergeConfigs(defaultConfig[key] || {}, value);
            } else {
                merged[key] = value;
            }
        }
        
        return merged;
    }

    /**
     * Aplica configurações específicas do ambiente
     */
    applyEnvironmentConfig(environment = 'development') {
        const envConfig = this.currentConfig.environments[environment];
        if (envConfig) {
            console.log(`🔧 Aplicando configurações para ambiente: ${environment}`);
            this.currentConfig = this.mergeConfigs(this.currentConfig, envConfig);
        }
        
        return this.currentConfig;
    }

    /**
     * Otimiza configuração baseada em métricas de performance
     */
    optimizeBasedOnPerformance(metrics) {
        const optimizations = {};
        
        // Ajusta delays baseado na taxa de sucesso
        if (metrics.successRate < 70) {
            optimizations.delays = {
                ...this.currentConfig.delays,
                betweenRequests: Math.min(this.currentConfig.delays.betweenRequests * 1.5, 2000)
            };
            console.log('🔧 Aumentando delays devido à baixa taxa de sucesso');
        }
        
        // Ajusta timeouts baseado nos erros de timeout
        const timeoutErrors = metrics.errorsByType?.TIMEOUT || 0;
        if (timeoutErrors > metrics.totalBundles * 0.1) {
            optimizations.timeouts = {
                ...this.currentConfig.timeouts,
                request: Math.min(this.currentConfig.timeouts.request * 1.3, 40000)
            };
            console.log('🔧 Aumentando timeouts devido a muitos erros de timeout');
        }
        
        // Habilita modo conservador se muitos rate limits
        const rateLimitErrors = metrics.errorsByType?.RATE_LIMITED || 0;
        if (rateLimitErrors > 0) {
            optimizations.performance = {
                ...this.currentConfig.performance,
                conservativeMode: true,
                parallelBundles: 1
            };
            console.log('🔧 Ativando modo conservador devido a rate limiting');
        }
        
        // Ajusta configurações de fallback baseado no uso
        const fallbackRate = metrics.fallbackUsed / Math.max(metrics.successfulBundles, 1);
        if (fallbackRate > 0.5) {
            optimizations.fallback = {
                ...this.currentConfig.fallback,
                maxApps: Math.max(this.currentConfig.fallback.maxApps - 2, 5),
                delay: this.currentConfig.fallback.delay * 1.2
            };
            console.log('🔧 Ajustando configurações de fallback devido ao alto uso');
        }
        
        if (Object.keys(optimizations).length > 0) {
            this.currentConfig = this.mergeConfigs(this.currentConfig, optimizations);
            this.saveConfig();
            return true;
        }
        
        return false;
    }

    /**
     * Salva configuração atual no arquivo
     */
    saveConfig() {
        try {
            fs.writeFileSync(this.configFile, JSON.stringify(this.currentConfig, null, 2));
            console.log('💾 Configuração salva em:', this.configFile);
        } catch (error) {
            console.error('❌ Erro ao salvar configuração:', error.message);
        }
    }

    /**
     * Obtém configuração atual
     */
    getConfig() {
        return { ...this.currentConfig };
    }

    /**
     * Atualiza configuração específica
     */
    updateConfig(path, value) {
        const keys = path.split('.');
        let current = this.currentConfig;
        
        for (let i = 0; i < keys.length - 1; i++) {
            if (!current[keys[i]]) current[keys[i]] = {};
            current = current[keys[i]];
        }
        
        current[keys[keys.length - 1]] = value;
        this.saveConfig();
        
        console.log(`🔧 Configuração atualizada: ${path} = ${value}`);
    }

    /**
     * Reseta para configuração padrão
     */
    resetToDefault() {
        this.currentConfig = { ...this.defaultConfig };
        this.saveConfig();
        console.log('🔄 Configuração resetada para o padrão');
    }

    /**
     * Valida configuração atual
     */
    validateConfig() {
        const issues = [];
        
        // Valida delays
        if (this.currentConfig.delays.betweenRequests < 100) {
            issues.push('Delay entre requisições muito baixo (< 100ms)');
        }
        
        // Valida timeouts
        if (this.currentConfig.timeouts.request < 5000) {
            issues.push('Timeout de requisição muito baixo (< 5s)');
        }
        
        // Valida configurações de fallback
        if (this.currentConfig.fallback.maxApps > 20) {
            issues.push('Muitos apps para fallback (> 20)');
        }
        
        // Valida performance
        if (this.currentConfig.performance.parallelBundles > 5) {
            issues.push('Muitos bundles paralelos (> 5)');
        }
        
        if (issues.length > 0) {
            console.warn('⚠️ Problemas na configuração detectados:');
            issues.forEach(issue => console.warn(`   • ${issue}`));
            return false;
        }
        
        console.log('✅ Configuração válida');
        return true;
    }

    /**
     * Exibe configuração atual formatada
     */
    displayCurrentConfig() {
        console.log('\n🔧 CONFIGURAÇÃO ATUAL DO SCRAPING');
        console.log('='.repeat(50));
        console.log('⏱️  Delays:');
        console.log(`   Entre requisições: ${this.currentConfig.delays.betweenRequests}ms`);
        console.log(`   Após erro: ${this.currentConfig.delays.afterError}ms`);
        console.log(`   Após rate limit: ${this.currentConfig.delays.afterRateLimit}ms`);
        
        console.log('\n⏰ Timeouts:');
        console.log(`   Requisição: ${this.currentConfig.timeouts.request}ms`);
        console.log(`   NSFW: ${this.currentConfig.timeouts.nsfw}ms`);
        
        console.log('\n🔄 Retries:');
        console.log(`   Máximo tentativas: ${this.currentConfig.retries.maxAttempts}`);
        console.log(`   Estratégia: ${this.currentConfig.retries.backoffStrategy}`);
        
        console.log('\n🚀 Performance:');
        console.log(`   Bundles paralelos: ${this.currentConfig.performance.parallelBundles}`);
        console.log(`   Modo conservador: ${this.currentConfig.performance.conservativeMode ? 'SIM' : 'NÃO'}`);
        
        console.log('\n🔄 Fallback:');
        console.log(`   Habilitado: ${this.currentConfig.fallback.enabled ? 'SIM' : 'NÃO'}`);
        console.log(`   Máximo apps: ${this.currentConfig.fallback.maxApps}`);
        
        console.log('='.repeat(50) + '\n');
    }

    /**
     * Gera configuração otimizada para um cenário específico
     */
    generateOptimizedConfig(scenario) {
        const scenarios = {
            'high-volume': {
                performance: { parallelBundles: 3, conservativeMode: false },
                delays: { betweenRequests: 500 },
                fallback: { maxApps: 10 }
            },
            'stable': {
                performance: { parallelBundles: 2, conservativeMode: true },
                delays: { betweenRequests: 1000 },
                fallback: { maxApps: 15 }
            },
            'testing': {
                performance: { parallelBundles: 1, conservativeMode: false },
                delays: { betweenRequests: 200 },
                retries: { maxAttempts: 1 }
            }
        };
        
        const scenarioConfig = scenarios[scenario];
        if (scenarioConfig) {
            this.currentConfig = this.mergeConfigs(this.currentConfig, scenarioConfig);
            this.saveConfig();
            console.log(`🎯 Configuração otimizada para cenário: ${scenario}`);
            return true;
        }
        
        console.error(`❌ Cenário desconhecido: ${scenario}`);
        return false;
    }
}

// Instância singleton
const configManager = new ScrapingConfigManager();

module.exports = { 
    ScrapingConfigManager,
    configManager 
};
