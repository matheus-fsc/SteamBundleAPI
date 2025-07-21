/**
 * Script de Teste de Performance para Render Free
 * Testa as configurações otimizadas para CPU limitado
 */

const axios = require('axios');

const API_BASE = process.env.API_URL || 'http://localhost:3000';
const API_KEY = process.env.API_KEY || 'be0c9fc4f7b53f7ce69a01f913dad4e0666eceb4e977688b33a7ec244cfb12ec';

const performanceTest = async () => {
    console.log('🧪 TESTE DE PERFORMANCE - Render Free Otimizado');
    console.log('================================================');
    
    try {
        // 1. Teste com limite pequeno para verificar velocidade
        console.log('\n1️⃣ Testando com 5 bundles...');
        const startTime = Date.now();
        
        const response = await axios.get(`${API_BASE}/api/test-update`, {
            params: {
                api_key: API_KEY,
                limit: 5
            },
            timeout: 60000
        });
        
        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;
        
        console.log(`✅ Teste concluído em ${duration}s`);
        console.log(`📊 Resultado:`, {
            bundles_processados: response.data.test_summary?.bundles_processed || 5,
            tempo_total: response.data.test_summary?.duration_seconds || duration,
            taxa_processamento: response.data.test_summary?.processing_rate || 'N/A',
            eficiencia: response.data.results?.efficiency_score || 'N/A'
        });
        
        // 2. Verificar configurações atuais
        console.log('\n2️⃣ Verificando configurações...');
        const statsResponse = await axios.get(`${API_BASE}/api/steam-stats`);
        const config = statsResponse.data.steam_api_config;
        
        console.log('🔧 Configurações atuais:');
        console.log(`   PARALLEL_BUNDLES: ${config.delay_between_requests}`);
        console.log(`   STEAM_API_DELAY: ${config.delay_between_requests}`);
        console.log(`   STEAM_APP_DELAY: ${config.delay_between_app_requests}`);
        console.log(`   MAX_APPS_PER_BUNDLE: ${config.max_apps_per_bundle}`);
        console.log(`   Performance Mode: ${config.performance_mode}`);
        
        // 3. Verificar status de resumo
        console.log('\n3️⃣ Verificando sistema de resumo...');
        try {
            const resumeResponse = await axios.get(`${API_BASE}/api/update-resume-status`, {
                params: { api_key: API_KEY }
            });
            
            if (resumeResponse.data.status === 'resume_available') {
                console.log(`📋 Atualização em progresso: ${resumeResponse.data.update_state.progress.percentage}%`);
                console.log(`⏱️ Tempo desde início: ${resumeResponse.data.update_state.timing.minutes_since_start}min`);
                console.log(`🔄 Número de resumos: ${resumeResponse.data.update_state.resume_info.resume_count}`);
            } else {
                console.log('✅ Nenhuma atualização em progresso');
            }
        } catch (error) {
            console.log('ℹ️ Status de resumo não disponível');
        }
        
        // 4. Recomendações baseadas no resultado
        console.log('\n4️⃣ Análise e recomendações:');
        const bundlesPerSecond = 5 / duration;
        
        if (bundlesPerSecond > 0.5) {
            console.log('🚀 EXCELENTE: Processamento rápido');
            console.log('   💡 Considere aumentar PARALLEL_BUNDLES para 4');
        } else if (bundlesPerSecond > 0.3) {
            console.log('✅ BOM: Processamento adequado para Render Free');
            console.log('   💡 Configurações estão otimizadas');
        } else if (bundlesPerSecond > 0.1) {
            console.log('⚠️ LENTO: Pode ser otimizado');
            console.log('   💡 Considere reduzir STEAM_API_DELAY para 500ms');
        } else {
            console.log('🐌 MUITO LENTO: Problema de performance');
            console.log('   💡 Verifique se há bloqueios da Steam API');
        }
        
        // 5. Estimativa para atualização completa
        const totalBundles = statsResponse.data.data_status?.basicBundlesCount || 9683;
        const estimatedTimeHours = (totalBundles / bundlesPerSecond) / 3600;
        
        console.log(`\n📊 ESTIMATIVAS PARA ATUALIZAÇÃO COMPLETA:`);
        console.log(`   Total de bundles: ${totalBundles}`);
        console.log(`   Taxa atual: ${bundlesPerSecond.toFixed(3)} bundles/s`);
        console.log(`   Tempo estimado: ${estimatedTimeHours.toFixed(1)} horas`);
        
        if (estimatedTimeHours > 24) {
            console.log('   ⚠️ Mais de 24h - muito longo para Render Free');
        } else if (estimatedTimeHours > 12) {
            console.log('   ⚡ 12-24h - aceitável com sistema de resumo');
        } else {
            console.log('   🚀 Menos de 12h - excelente para Render Free');
        }
        
    } catch (error) {
        console.error('❌ Erro no teste:', error.response?.data || error.message);
    }
};

// Executa o teste se chamado diretamente
if (require.main === module) {
    performanceTest();
}

module.exports = { performanceTest };
