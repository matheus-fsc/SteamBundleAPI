/**
 * Monitor de Performance para Scraping Melhorado
 * Acompanha métricas em tempo real e sugere otimizações
 */

const fs = require('fs').promises;
const path = require('path');

class ScrapingPerformanceMonitor {
    constructor() {
        this.metrics = {
            totalBundles: 0,
            successfulBundles: 0,
            failedBundles: 0,
            totalTime: 0,
            averageTime: 0,
            successRate: 0,
            
            // Métricas de qualidade dos dados
            withDescription: 0,
            withFormattedPrice: 0,
            withImages: 0,
            withTags: 0,
            fallbackUsed: 0,
            nsfwDetected: 0,
            
            // Métricas de erro
            errorsByType: {},
            
            // Performance por lote
            batchPerformance: [],
            
            startTime: Date.now()
        };
        
        this.logFile = path.join(__dirname, 'services', 'logs', 'performance_monitor.log');
        this.lastReport = Date.now();
        this.reportInterval = 30000; // Relatório a cada 30s
        
        console.log('📊 Monitor de Performance do Scraping inicializado');
    }

    /**
     * Registra o resultado de um bundle processado
     */
    recordBundleResult(bundleId, result, processingTime) {
        this.metrics.totalBundles++;
        this.metrics.totalTime += processingTime;
        this.metrics.averageTime = this.metrics.totalTime / this.metrics.totalBundles;
        
        if (result.success) {
            this.metrics.successfulBundles++;
            const pageDetails = result.data?.page_details || {};
            
            // Qualidade dos dados
            if (pageDetails.description) this.metrics.withDescription++;
            if (pageDetails.formatted_price) this.metrics.withFormattedPrice++;
            if (pageDetails.header_image && pageDetails.capsule_image) this.metrics.withImages++;
            if (pageDetails.gênero && pageDetails.gênero.length > 0) this.metrics.withTags++;
            if (result.extractionFailed) this.metrics.fallbackUsed++;
            if (result.nsfwDetected) this.metrics.nsfwDetected++;
            
        } else {
            this.metrics.failedBundles++;
            const errorType = result.reason || 'UNKNOWN_ERROR';
            this.metrics.errorsByType[errorType] = (this.metrics.errorsByType[errorType] || 0) + 1;
        }
        
        this.metrics.successRate = (this.metrics.successfulBundles / this.metrics.totalBundles) * 100;
        
        // Gera relatório periódico
        if (Date.now() - this.lastReport >= this.reportInterval) {
            this.generatePeriodicReport();
            this.lastReport = Date.now();
        }
    }

    /**
     * Registra performance de um lote
     */
    recordBatchPerformance(batchIndex, batchSize, successCount, batchTime) {
        const batchSuccessRate = (successCount / batchSize) * 100;
        const avgTimePerBundle = batchTime / batchSize;
        
        this.metrics.batchPerformance.push({
            batchIndex,
            batchSize,
            successCount,
            successRate: batchSuccessRate,
            totalTime: batchTime,
            avgTimePerBundle,
            timestamp: Date.now()
        });
        
        // Mantém apenas os últimos 20 lotes para análise
        if (this.metrics.batchPerformance.length > 20) {
            this.metrics.batchPerformance.shift();
        }
    }

    /**
     * Gera relatório periódico
     */
    generatePeriodicReport() {
        const elapsed = (Date.now() - this.metrics.startTime) / 1000;
        const bundlesPerSecond = this.metrics.totalBundles / elapsed;
        
        console.log('\n' + '='.repeat(60));
        console.log('📊 RELATÓRIO DE PERFORMANCE - ' + new Date().toLocaleTimeString());
        console.log('='.repeat(60));
        console.log(`⏱️  Tempo decorrido: ${elapsed.toFixed(1)}s`);
        console.log(`📦 Bundles processados: ${this.metrics.totalBundles}`);
        console.log(`✅ Taxa de sucesso: ${this.metrics.successRate.toFixed(1)}%`);
        console.log(`🚀 Velocidade: ${bundlesPerSecond.toFixed(2)} bundles/s`);
        console.log(`⏱️  Tempo médio por bundle: ${this.metrics.averageTime.toFixed(0)}ms`);
        
        console.log('\n📈 QUALIDADE DOS DADOS:');
        console.log(`   📝 Com descrição: ${this.getPercentage(this.metrics.withDescription, this.metrics.successfulBundles)}`);
        console.log(`   💰 Com preço formatado: ${this.getPercentage(this.metrics.withFormattedPrice, this.metrics.successfulBundles)}`);
        console.log(`   🖼️  Com imagens: ${this.getPercentage(this.metrics.withImages, this.metrics.successfulBundles)}`);
        console.log(`   🏷️  Com tags: ${this.getPercentage(this.metrics.withTags, this.metrics.successfulBundles)}`);
        console.log(`   🔄 Usaram fallback: ${this.getPercentage(this.metrics.fallbackUsed, this.metrics.successfulBundles)}`);
        console.log(`   🔞 NSFW detectados: ${this.getPercentage(this.metrics.nsfwDetected, this.metrics.successfulBundles)}`);
        
        if (Object.keys(this.metrics.errorsByType).length > 0) {
            console.log('\n❌ TIPOS DE ERRO:');
            Object.entries(this.metrics.errorsByType)
                .sort(([,a], [,b]) => b - a)
                .forEach(([type, count]) => {
                    console.log(`   • ${type}: ${count} (${((count / this.metrics.failedBundles) * 100).toFixed(1)}%)`);
                });
        }
        
        // Análise de tendência dos últimos lotes
        if (this.metrics.batchPerformance.length >= 5) {
            const recent = this.metrics.batchPerformance.slice(-5);
            const avgRecentSuccess = recent.reduce((sum, b) => sum + b.successRate, 0) / recent.length;
            const avgRecentTime = recent.reduce((sum, b) => sum + b.avgTimePerBundle, 0) / recent.length;
            
            console.log('\n📊 TENDÊNCIA (últimos 5 lotes):');
            console.log(`   🎯 Taxa de sucesso média: ${avgRecentSuccess.toFixed(1)}%`);
            console.log(`   ⏱️  Tempo médio por bundle: ${avgRecentTime.toFixed(0)}ms`);
        }
        
        // Recomendações automáticas
        this.generateRecommendations();
        
        console.log('='.repeat(60) + '\n');
    }

    /**
     * Gera recomendações baseadas nas métricas
     */
    generateRecommendations() {
        const recommendations = [];
        
        // Recomendações baseadas na taxa de sucesso
        if (this.metrics.successRate < 80) {
            recommendations.push('🔧 Taxa de sucesso baixa - considere aumentar os delays entre requisições');
        }
        
        // Recomendações baseadas na qualidade dos dados
        const descriptionRate = (this.metrics.withDescription / this.metrics.successfulBundles) * 100;
        if (descriptionRate < 50) {
            recommendations.push('📝 Muitas descrições faltando - verificar seletores de descrição');
        }
        
        const priceRate = (this.metrics.withFormattedPrice / this.metrics.successfulBundles) * 100;
        if (priceRate < 70) {
            recommendations.push('💰 Muitos preços faltando - verificar seletores de preço');
        }
        
        // Recomendações baseadas nos erros
        const timeoutErrors = this.metrics.errorsByType['TIMEOUT'] || 0;
        if (timeoutErrors > this.metrics.totalBundles * 0.1) {
            recommendations.push('⏱️ Muitos timeouts - considere aumentar o timeout das requisições');
        }
        
        const rateLimitErrors = this.metrics.errorsByType['RATE_LIMITED'] || 0;
        if (rateLimitErrors > 0) {
            recommendations.push('🚦 Rate limiting detectado - aumentar delays entre requisições');
        }
        
        // Recomendações baseadas no uso de fallback
        const fallbackRate = (this.metrics.fallbackUsed / this.metrics.successfulBundles) * 100;
        if (fallbackRate > 30) {
            recommendations.push('🔄 Muito uso de fallback - verificar seletores HTML principais');
        }
        
        if (recommendations.length > 0) {
            console.log('\n💡 RECOMENDAÇÕES:');
            recommendations.forEach(rec => console.log(`   ${rec}`));
        } else {
            console.log('\n✨ Performance ótima - nenhuma recomendação necessária');
        }
    }

    /**
     * Calcula porcentagem formatada
     */
    getPercentage(count, total) {
        if (total === 0) return '0 (0%)';
        const percentage = (count / total) * 100;
        return `${count} (${percentage.toFixed(1)}%)`;
    }

    /**
     * Salva relatório final
     */
    async generateFinalReport() {
        const finalReport = {
            timestamp: new Date().toISOString(),
            duration: (Date.now() - this.metrics.startTime) / 1000,
            metrics: this.metrics,
            performance: {
                bundlesPerSecond: this.metrics.totalBundles / ((Date.now() - this.metrics.startTime) / 1000),
                averageTime: this.metrics.averageTime,
                successRate: this.metrics.successRate
            },
            dataQuality: {
                descriptionRate: (this.metrics.withDescription / this.metrics.successfulBundles) * 100,
                priceRate: (this.metrics.withFormattedPrice / this.metrics.successfulBundles) * 100,
                imageRate: (this.metrics.withImages / this.metrics.successfulBundles) * 100,
                tagRate: (this.metrics.withTags / this.metrics.successfulBundles) * 100,
                fallbackRate: (this.metrics.fallbackUsed / this.metrics.successfulBundles) * 100
            }
        };
        
        const reportFile = `./performance-report-${Date.now()}.json`;
        await fs.writeFile(reportFile, JSON.stringify(finalReport, null, 2));
        
        console.log('\n📊 RELATÓRIO FINAL DE PERFORMANCE');
        console.log('='.repeat(50));
        console.log(`💾 Relatório salvo em: ${reportFile}`);
        console.log(`⏱️  Duração total: ${finalReport.duration.toFixed(1)}s`);
        console.log(`📦 Total processado: ${this.metrics.totalBundles} bundles`);
        console.log(`✅ Taxa de sucesso final: ${this.metrics.successRate.toFixed(1)}%`);
        console.log(`🚀 Performance final: ${finalReport.performance.bundlesPerSecond.toFixed(2)} bundles/s`);
        
        return reportFile;
    }

    /**
     * Log de evento específico
     */
    async logEvent(event, details) {
        const logEntry = `[${new Date().toISOString()}] ${event}: ${JSON.stringify(details)}\n`;
        try {
            await fs.appendFile(this.logFile, logEntry);
        } catch (error) {
            console.warn('⚠️ Erro ao escrever log de performance:', error.message);
        }
    }
}

module.exports = { ScrapingPerformanceMonitor };
