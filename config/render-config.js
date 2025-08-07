/**
 * Configurações específicas para deploy no Render (512MB RAM)
 * Otimizações para ambiente com recursos limitados
 */

const RENDER_CONFIG = {
    // Detecta se está rodando no Render
    IS_RENDER: process.env.NODE_ENV === 'production' || process.env.RENDER === 'true',
    
    // Configurações de memória ultra-conservadoras
    MEMORY: {
        MAX_HEAP_SIZE: 400,           // 400MB de heap máximo
        WARNING_THRESHOLD: 350,       // Aviso aos 350MB
        CRITICAL_THRESHOLD: 450,      // Crítico aos 450MB
        GC_INTERVAL: 15,              // Garbage collection a cada 15 operações
        MEMORY_CHECK_FREQUENCY: 5     // Verifica memória a cada 5 operações
    },
    
    // Configurações de rede mais conservadoras
    NETWORK: {
        REQUEST_TIMEOUT: 30000,       // 30s timeout (conexão pode ser lenta)
        RETRY_DELAY: 2000,            // 2s entre retries
        MAX_RETRIES: 2,               // Máximo 2 tentativas
        CONNECTION_DELAY: 1000,       // 1s entre conexões
        CHUNK_DELAY: 1500            // 1.5s entre chunks
    },
    
    // Processamento em lotes pequenos
    BATCH: {
        MAX_PARALLEL: 2,              // Máximo 2 requisições paralelas
        CHUNK_SIZE: 25,               // Processa 25 bundles por vez
        SYNC_INTERVAL: 20,            // Sync a cada 20 bundles
        PAUSE_BETWEEN_CHUNKS: 2000    // 2s de pausa entre chunks
    },
    
    // Configurações de log reduzidas
    LOGGING: {
        MINIMAL_MODE: true,           // Log mínimo ativado
        LOG_INTERVAL: 25,             // Log a cada 25 operações
        DISABLE_VERBOSE: true,        // Desabilita logs verbosos
        FILE_LOG_ROTATION: 5          // Rotaciona logs aos 5MB
    },
    
    // Configurações específicas do Steam
    STEAM: {
        API_DELAY: 1200,              // 1.2s entre requests Steam
        PAGE_DELAY: 2000,             // 2s entre páginas
        RETRY_MULTIPLIER: 2.5,        // Multiplica delay em retries
        CONSERVATIVE_PARSING: true    // Parsing mais conservador
    }
};

/**
 * Aplica configurações baseadas no ambiente
 */
function applyRenderConfig() {
    if (!RENDER_CONFIG.IS_RENDER) {
        console.log('📍 Ambiente local detectado - usando configurações padrão');
        return false;
    }
    
    console.log('🏭 AMBIENTE RENDER DETECTADO - Aplicando otimizações');
    console.log('=' .repeat(50));
    
    // Configura Node.js para usar menos memória
    if (!process.env.NODE_OPTIONS) {
        process.env.NODE_OPTIONS = `--max-old-space-size=${RENDER_CONFIG.MEMORY.MAX_HEAP_SIZE}`;
    }
    
    // Configura variáveis de ambiente específicas
    process.env.REQUEST_TIMEOUT = RENDER_CONFIG.NETWORK.REQUEST_TIMEOUT.toString();
    process.env.STEAM_API_DELAY = RENDER_CONFIG.STEAM.API_DELAY.toString();
    process.env.MAX_RETRIES = RENDER_CONFIG.NETWORK.MAX_RETRIES.toString();
    process.env.CONSERVATIVE_SCRAPING = 'true';
    process.env.MINIMAL_LOGGING = 'true';
    
    console.log('⚙️  Configurações aplicadas:');
    console.log(`   💾 Max heap: ${RENDER_CONFIG.MEMORY.MAX_HEAP_SIZE}MB`);
    console.log(`   🌐 Request timeout: ${RENDER_CONFIG.NETWORK.REQUEST_TIMEOUT}ms`);
    console.log(`   ⏱️  Steam delay: ${RENDER_CONFIG.STEAM.API_DELAY}ms`);
    console.log(`   🔄 Max retries: ${RENDER_CONFIG.NETWORK.MAX_RETRIES}`);
    console.log(`   📦 Chunk size: ${RENDER_CONFIG.BATCH.CHUNK_SIZE}`);
    console.log(`   🔄 Sync interval: ${RENDER_CONFIG.BATCH.SYNC_INTERVAL}`);
    
    return true;
}

/**
 * Monitora uso de memória
 */
function checkMemoryUsage() {
    if (!RENDER_CONFIG.IS_RENDER) return null;
    
    const usage = process.memoryUsage();
    const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(usage.heapTotal / 1024 / 1024);
    
    const status = {
        heapUsedMB,
        heapTotalMB,
        isWarning: heapUsedMB > RENDER_CONFIG.MEMORY.WARNING_THRESHOLD,
        isCritical: heapUsedMB > RENDER_CONFIG.MEMORY.CRITICAL_THRESHOLD,
        shouldGC: heapUsedMB > RENDER_CONFIG.MEMORY.WARNING_THRESHOLD
    };
    
    if (status.isCritical) {
        console.warn(`🚨 MEMÓRIA CRÍTICA: ${heapUsedMB}MB/${RENDER_CONFIG.MEMORY.MAX_HEAP_SIZE}MB`);
    } else if (status.isWarning) {
        console.warn(`⚠️  MEMÓRIA ALTA: ${heapUsedMB}MB/${RENDER_CONFIG.MEMORY.MAX_HEAP_SIZE}MB`);
    }
    
    return status;
}

/**
 * Force garbage collection se disponível
 */
function forceGarbageCollection() {
    if (global.gc) {
        global.gc();
        return true;
    }
    return false;
}

/**
 * Pausa entre operações baseada na configuração
 */
async function renderDelay(type = 'default') {
    if (!RENDER_CONFIG.IS_RENDER) return;
    
    let delayMs;
    switch (type) {
        case 'network':
            delayMs = RENDER_CONFIG.NETWORK.CONNECTION_DELAY;
            break;
        case 'chunk':
            delayMs = RENDER_CONFIG.BATCH.PAUSE_BETWEEN_CHUNKS;
            break;
        case 'steam':
            delayMs = RENDER_CONFIG.STEAM.API_DELAY;
            break;
        default:
            delayMs = 1000;
    }
    
    await new Promise(resolve => setTimeout(resolve, delayMs));
}

module.exports = {
    RENDER_CONFIG,
    applyRenderConfig,
    checkMemoryUsage,
    forceGarbageCollection,
    renderDelay
};
