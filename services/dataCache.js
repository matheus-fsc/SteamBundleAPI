const fs = require('fs').promises;
const path = require('path');

const BUNDLES_DETAILED_FILE = path.join(__dirname, '..', 'bundleDetailed.json');
const BUNDLES_BASIC_FILE = path.join(__dirname, '..', 'bundles.json');
const LAST_CHECK_FILE = path.join(__dirname, '..', 'last_check.json');

let detailedBundlesCache = {
    data: null,
    lastModified: 0,
};

let basicBundlesCache = {
    data: null,
    lastModified: 0,
};

let lastCheckCache = {
    data: null,
    lastModified: 0,
};

/**
 * Função genérica para obter dados usando cache inteligente
 * @param {string} filePath - Caminho do arquivo
 * @param {object} cache - Objeto de cache a ser usado
 * @param {string} cacheName - Nome do cache para logs
 * @returns {object|null} - Dados do arquivo ou null se não existir
 */
async function getCachedData(filePath, cache, cacheName) {
    try {
        const stats = await fs.stat(filePath);
        
        // Se o arquivo foi modificado desde a última vez que o lemos, atualiza o cache
        if (stats.mtimeMs > cache.lastModified) {
            console.log(`🔄 Atualizando cache: ${cacheName}...`);
            const fileContent = await fs.readFile(filePath, 'utf-8');
            cache.data = JSON.parse(fileContent);
            cache.lastModified = stats.mtimeMs;
            console.log(`✅ Cache atualizado: ${cacheName} (${(fileContent.length / 1024).toFixed(1)}KB)`);
        }
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log(`⚠️ Arquivo não encontrado: ${cacheName} - cache limpo`);
            cache.data = null;
            cache.lastModified = 0;
        } else {
            console.error(`❌ Erro ao ler arquivo para cache ${cacheName}:`, error.message);
        }
    }
    
    return cache.data;
}

/**
 * Obtém bundles detalhadas usando cache inteligente
 * @returns {object|null} - Dados das bundles detalhadas ou null
 */
async function getDetailedBundles() {
    return getCachedData(BUNDLES_DETAILED_FILE, detailedBundlesCache, 'bundles detalhadas');
}

/**
 * Obtém bundles básicas usando cache inteligente
 * @returns {object|null} - Dados das bundles básicas ou null
 */
async function getBasicBundles() {
    return getCachedData(BUNDLES_BASIC_FILE, basicBundlesCache, 'bundles básicas');
}

/**
 * Obtém dados do last check usando cache inteligente
 * @returns {object|null} - Dados do last check ou null
 */
async function getLastCheck() {
    return getCachedData(LAST_CHECK_FILE, lastCheckCache, 'last check');
}

/**
 * Força a invalidação de todos os caches
 * Útil após atualizações manuais dos arquivos
 */
function invalidateAllCaches() {
    console.log('🧹 Invalidando todos os caches...');
    detailedBundlesCache.lastModified = 0;
    basicBundlesCache.lastModified = 0;
    lastCheckCache.lastModified = 0;
    console.log('✅ Todos os caches invalidados');
}

/**
 * Força a invalidação de um cache específico
 * @param {string} cacheType - Tipo do cache: 'detailed', 'basic', 'lastCheck'
 */
function invalidateCache(cacheType) {
    switch (cacheType) {
        case 'detailed':
            detailedBundlesCache.lastModified = 0;
            console.log('🧹 Cache de bundles detalhadas invalidado');
            break;
        case 'basic':
            basicBundlesCache.lastModified = 0;
            console.log('🧹 Cache de bundles básicas invalidado');
            break;
        case 'lastCheck':
            lastCheckCache.lastModified = 0;
            console.log('🧹 Cache de last check invalidado');
            break;
        default:
            console.log('⚠️ Tipo de cache inválido:', cacheType);
    }
}

/**
 * Obtém informações sobre o status dos caches
 * @returns {object} - Informações dos caches
 */
function getCacheInfo() {
    return {
        detailedBundles: {
            cached: detailedBundlesCache.data !== null,
            lastModified: detailedBundlesCache.lastModified ? new Date(detailedBundlesCache.lastModified).toISOString() : null,
            dataSize: detailedBundlesCache.data ? `${JSON.stringify(detailedBundlesCache.data).length} chars` : 'N/A'
        },
        basicBundles: {
            cached: basicBundlesCache.data !== null,
            lastModified: basicBundlesCache.lastModified ? new Date(basicBundlesCache.lastModified).toISOString() : null,
            dataSize: basicBundlesCache.data ? `${JSON.stringify(basicBundlesCache.data).length} chars` : 'N/A'
        },
        lastCheck: {
            cached: lastCheckCache.data !== null,
            lastModified: lastCheckCache.lastModified ? new Date(lastCheckCache.lastModified).toISOString() : null,
            dataSize: lastCheckCache.data ? `${JSON.stringify(lastCheckCache.data).length} chars` : 'N/A'
        }
    };
}

module.exports = {
    getDetailedBundles,
    getBasicBundles,
    getLastCheck,
    invalidateAllCaches,
    invalidateCache,
    getCacheInfo
};
