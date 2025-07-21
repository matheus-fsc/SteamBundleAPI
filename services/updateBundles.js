const axios = require('axios');
const fs = require('fs');
const moment = require('moment-timezone');
const { removeDuplicatesFromDetailedBundles } = require('../middleware/dataValidation');

const BUNDLES_FILE = 'bundles.json';
const BUNDLES_DETAILED_FILE = './bundleDetailed.json';
const TIMEZONE = 'America/Sao_Paulo';

// Configurações CONSERVADORAS com OTIMIZAÇÃO de lote
const STEAM_API_CONFIG = {
    DELAY_BETWEEN_REQUESTS: parseInt(process.env.STEAM_API_DELAY) || 2000, // 2s entre lotes de bundles
    DELAY_BETWEEN_APP_BATCHES: parseInt(process.env.STEAM_APP_DELAY) || 500, // 500ms entre lotes de apps
    MAX_APPS_PER_BUNDLE: parseInt(process.env.MAX_APPS_PER_BUNDLE) || 20,
    REQUEST_TIMEOUT: parseInt(process.env.REQUEST_TIMEOUT) || 15000,
    MAX_RETRIES: parseInt(process.env.MAX_RETRIES) || 3,
    PARALLEL_BUNDLES: parseInt(process.env.PARALLEL_BUNDLES) || 2,
    APP_DETAILS_BATCH_SIZE: 20, // NOVO: Tamanho do lote para a API appdetails (20 é um número seguro)
    SKIP_DETAILS_THRESHOLD: parseInt(process.env.SKIP_DETAILS_THRESHOLD) || 50
};

// CONFIGURAÇÕES PARA RENDER FREE (500MB RAM)
const SAVE_INTERVAL_BATCHES = 20;
const MEMORY_CHECK_INTERVAL_BATCHES = 5;
const MAX_MEMORY_USAGE_MB = 350;

console.log('🔧 Configurações da API Steam:', STEAM_API_CONFIG);
console.log(`💾 Modo Render Free: Salvamento a cada ${SAVE_INTERVAL_BATCHES} lotes`);

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const getMemoryUsage = () => {
    const used = process.memoryUsage();
    return {
        rss: Math.round(used.rss / 1024 / 1024 * 100) / 100,
        heapUsed: Math.round(used.heapUsed / 1024 / 1024 * 100) / 100,
        heapTotal: Math.round(used.heapTotal / 1024 / 1024 * 100) / 100
    };
};

const saveDetailedBundlesData = (detailedBundles, bundlesToProcess, isComplete = false, isTestMode = false, startTime) => {
    const memory = getMemoryUsage();
    const totalTime = (Date.now() - startTime) / 1000;
    const result = {
        last_update: moment().tz(TIMEZONE).format(),
        totalBundles: detailedBundles.length,
        isTestMode: !!isTestMode,
        processedCount: bundlesToProcess.length,
        processingTimeSeconds: totalTime,
        bundlesPerSecond: detailedBundles.length / totalTime,
        bundles: detailedBundles,
        isComplete: isComplete,
        lastSaved: new Date().toISOString(),
        memoryUsage: memory
    };
    const outputFile = isTestMode ? './bundleDetailed_test.json' : BUNDLES_DETAILED_FILE;
    fs.writeFileSync(outputFile, JSON.stringify(result, null, 2), 'utf-8');
    
    if (isComplete) {
        console.log(`💾 ✅ Salvamento final: ${detailedBundles.length} bundles (${memory.heapUsed}MB)`);
    } else {
        console.log(`💾 🔄 Salvamento parcial: ${detailedBundles.length} bundles (${memory.heapUsed}MB)`);
    }
    return result;
};

/**
 * [REFATORADO] Busca detalhes de um LOTE de apps com retentativas.
 * @param {number[]} appidBatch - Um array de IDs de aplicativos.
 * @param {number} retryCount - Contador de tentativas.
 * @returns {Promise<{genres: string[], categories: string[]}|null>}
 */
const fetchAppDetailsBatchWithRetry = async (appidBatch, retryCount = 0) => {
    if (appidBatch.length === 0) return { genres: [], categories: [] };

    const appidsString = appidBatch.join(',');
    const url = `https://store.steampowered.com/api/appdetails?appids=${appidsString}&cc=BR&l=brazilian`;

    try {
        const response = await axios.get(url, {
            timeout: STEAM_API_CONFIG.REQUEST_TIMEOUT,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json'
            }
        });
        
        const data = response.data;
        if (!data) return null;

        const results = { genres: new Set(), categories: new Set() };
        
        appidBatch.forEach(appid => {
            if (data[appid] && data[appid].success) {
                const appData = data[appid].data;
                if (appData.genres) appData.genres.forEach(g => results.genres.add(g.description));
                if (appData.categories) appData.categories.forEach(c => results.categories.add(c.description));
            }
        });

        return {
            genres: Array.from(results.genres),
            categories: Array.from(results.categories)
        };

    } catch (error) {
        if (error.response?.status === 403) {
            console.log(`🚨 BLOQUEIO DETECTADO em App Details! IP foi bloqueado`);
            throw new Error('IP_BLOCKED_BY_STEAM');
        }
        if (retryCount < STEAM_API_CONFIG.MAX_RETRIES) {
            await delay(1500 * (retryCount + 1));
            return await fetchAppDetailsBatchWithRetry(appidBatch, retryCount + 1);
        }
        return null;
    }
};

/**
 * [REFATORADO] Busca detalhes para todos os apps de um bundle, usando a função de lote.
 * @param {number[]} appids - Um array de IDs de aplicativos da Steam.
 * @returns {Promise<{genres: string[], categories: string[]}>}
 */
const getDetailsForApps = async (appids) => {
    const allGenres = new Set();
    const allCategories = new Set();

    if (appids.length > STEAM_API_CONFIG.SKIP_DETAILS_THRESHOLD) {
        console.log(`   ⏭️  Pulando detalhes - bundle com ${appids.length} apps (limite: ${STEAM_API_CONFIG.SKIP_DETAILS_THRESHOLD})`);
        return { genres: [], categories: [] };
    }

    const limitedAppids = appids.slice(0, STEAM_API_CONFIG.MAX_APPS_PER_BUNDLE);
    if (appids.length > STEAM_API_CONFIG.MAX_APPS_PER_BUNDLE) {
        console.log(`⚠️  Bundle com ${appids.length} apps, processando apenas os primeiros ${STEAM_API_CONFIG.MAX_APPS_PER_BUNDLE}`);
    }

    console.log(`   📋 Buscando detalhes para ${limitedAppids.length} apps em lotes...`);
    let successfulApps = 0;

    const BATCH_SIZE = STEAM_API_CONFIG.APP_DETAILS_BATCH_SIZE;
    for (let i = 0; i < limitedAppids.length; i += BATCH_SIZE) {
        const batch = limitedAppids.slice(i, i + BATCH_SIZE);
        const details = await fetchAppDetailsBatchWithRetry(batch);

        if (details) {
            successfulApps += batch.length;
            details.genres.forEach(genre => allGenres.add(genre));
            details.categories.forEach(category => allCategories.add(category));
        }

        if (i + BATCH_SIZE < limitedAppids.length) {
            await delay(STEAM_API_CONFIG.DELAY_BETWEEN_APP_BATCHES);
        }
    }

    if (successfulApps > 0) {
        console.log(`   ✅ Detalhes de ~${successfulApps}/${limitedAppids.length} apps processados`);
    }

    return {
        genres: Array.from(allGenres),
        categories: Array.from(allCategories)
    };
};


const fetchBundleDetails = async (bundleId, language = 'brazilian') => {
    const url = `https://store.steampowered.com/actions/ajaxresolvebundles?bundleids=${bundleId}&cc=BR&l=${language}`;
    for (let attempt = 1; attempt <= STEAM_API_CONFIG.MAX_RETRIES; attempt++) {
        try {
            const response = await axios.get(url, { /* ...mesmos headers e timeout... */ });

            if (response.status !== 200) throw new Error(`HTTP ${response.status} para bundle ${bundleId}`);
            if (!response.data || !Array.isArray(response.data) || !response.data[0]) {
                console.log(`   ⚠️  Bundle ${bundleId} não encontrada (removida?)`);
                return null;
            }
            const bundleData = response.data[0];
            if (!bundleData.bundleid || !bundleData.name) {
                console.log(`   ❌ Bundle ${bundleId} com dados inválidos`);
                return null;
            }
            
            console.log(`   🔍 ${bundleData.name} (${bundleData.appids?.length || 0} apps)`);
            const appDetails = await getDetailsForApps(bundleData.appids || []);

            return {
                bundleid: bundleData.bundleid,
                name: bundleData.name,
                header_image: bundleData.header_image_url,
                capsule_image: bundleData.main_capsule,
                final_price: bundleData.final_price,
                initial_price: bundleData.initial_price,
                formatted_orig_price: bundleData.formatted_orig_price,
                formatted_final_price: bundleData.formatted_final_price,
                discount_percent: bundleData.discount_percent,
                genres: appDetails.genres,
                categories: appDetails.categories,
                total_apps: bundleData.appids?.length || 0,
                appids: bundleData.appids,
                packageids: bundleData.packageids,
                available_windows: bundleData.available_windows,
                available_mac: bundleData.available_mac,
                available_linux: bundleData.available_linux,
                coming_soon: bundleData.coming_soon,
                library_asset: bundleData.library_asset,
                processed_at: new Date().toISOString(),
                api_version: '2.0'
            };
        } catch (error) {
            if (error.response?.status === 403) {
                console.log(`🚨 BLOQUEIO DETECTADO! IP foi bloqueado pela Steam/Akamai`);
                throw new Error('IP_BLOCKED_BY_STEAM');
            }
            if (attempt === STEAM_API_CONFIG.MAX_RETRIES) {
                console.log(`   💀 Erro final bundle ${bundleId}: ${error.message}`);
                return null;
            }
            await delay(2000 * attempt);
        }
    }
    return null;
};

const processBundleBatch = async (bundleBatch, language, batchIndex, totalBatches) => {
    console.log(`🚀 Lote ${batchIndex + 1}/${totalBatches}: Processando ${bundleBatch.length} bundles...`);
    const batchPromises = bundleBatch.map(bundle => {
        const bundleIdMatch = bundle.Link.match(/\/bundle\/(\d+)/);
        if (!bundleIdMatch) return Promise.resolve(null);
        const bundleId = bundleIdMatch[1];
        return fetchBundleDetails(bundleId, language).then(details => {
            if (details) details.link = bundle.Link;
            return details;
        }).catch(err => {
            console.error(`❌ Erro crítico no bundle ${bundle.Link}:`, err.message);
            if (err.message === 'IP_BLOCKED_BY_STEAM') throw err; // Propaga o erro de bloqueio
            return null;
        });
    });
    
    const results = await Promise.allSettled(batchPromises);
    const successfulBundles = results
        .filter(result => result.status === 'fulfilled' && result.value)
        .map(result => result.value);
    
    console.log(`✅ Lote ${batchIndex + 1}: ${successfulBundles.length}/${bundleBatch.length} bundles processados com sucesso`);
    return successfulBundles;
};

const updateBundlesWithDetails = async (language = 'brazilian', limitForTesting = null) => {
    console.log('🚀 VERSÃO OTIMIZADA - Iniciando atualização...');
    if (limitForTesting) console.log(`🧪 MODO TESTE: Processando apenas ${limitForTesting} bundles`);
    
    const startTime = Date.now();
    
    try {
        if (!fs.existsSync(BUNDLES_FILE)) {
            console.error('Arquivo bundles.json não encontrado.');
            return;
        }
        const bundlesJson = JSON.parse(fs.readFileSync(BUNDLES_FILE, 'utf-8'));
        
        const bundlesToProcess = limitForTesting ? bundlesJson.bundles.slice(0, limitForTesting) : bundlesJson.bundles;
        
        console.log(`📊 Total de bundles para processar: ${bundlesToProcess.length}`);
        
        let detailedBundles = [];
        let batchesProcessed = 0;
        
        const batchSize = STEAM_API_CONFIG.PARALLEL_BUNDLES;
        const totalBatches = Math.ceil(bundlesToProcess.length / batchSize);
        
        for (let i = 0; i < bundlesToProcess.length; i += batchSize) {
            const batch = bundlesToProcess.slice(i, i + batchSize);
            const batchIndex = Math.floor(i / batchSize);
            
            const batchStartTime = Date.now();
            const batchResults = await processBundleBatch(batch, language, batchIndex, totalBatches);
            const batchEndTime = Date.now();
            
            detailedBundles.push(...batchResults);
            batchesProcessed++;
            
            const elapsed = (batchEndTime - startTime) / 1000;
            const batchTime = (batchEndTime - batchStartTime) / 1000;
            const remaining = totalBatches - batchIndex - 1;
            const estimatedTimeLeft = remaining * batchTime;
            
            console.log(`📈 Progresso: ${detailedBundles.length}/${bundlesToProcess.length} | Tempo: ${elapsed.toFixed(1)}s | ETA: ${estimatedTimeLeft.toFixed(1)}s`);

            const memory = getMemoryUsage();
            const shouldSaveByInterval = batchesProcessed % SAVE_INTERVAL_BATCHES === 0;
            const shouldSaveByMemory = memory.heapUsed > MAX_MEMORY_USAGE_MB;
            
            if (shouldSaveByInterval || shouldSaveByMemory) {
                if (shouldSaveByMemory) console.log(`🚨 Memória alta (${memory.heapUsed}MB) - forçando salvamento`);
                
                const uniqueDetailedBundles = Array.from(new Map(detailedBundles.map(bundle => [bundle.bundleid, bundle])).values());
                saveDetailedBundlesData(uniqueDetailedBundles, bundlesToProcess, false, limitForTesting, startTime);
                
                if (global.gc) {
                    global.gc();
                    const memoryAfterGC = getMemoryUsage();
                    console.log(`🧹 GC executado: ${memory.heapUsed}MB → ${memoryAfterGC.heapUsed}MB`);
                }
            }

            if (batchesProcessed % MEMORY_CHECK_INTERVAL_BATCHES === 0) {
                console.log(`📊 Memória: ${memory.heapUsed}MB | Detalhadas: ${detailedBundles.length} | Lotes: ${batchesProcessed}/${totalBatches}`);
            }

            if (i + batchSize < bundlesToProcess.length) {
                await delay(STEAM_API_CONFIG.DELAY_BETWEEN_REQUESTS);
            }
        }

        console.log(`🎉 Processamento concluído em ${(Date.now() - startTime) / 1000}s`);
        
        console.log('🔍 Removendo duplicatas das bundles detalhadas...');
        const uniqueDetailedBundles = Array.from(new Map(detailedBundles.map(bundle => [bundle.bundleid, bundle])).values());
        console.log(`📊 Bundles detalhadas: ${detailedBundles.length} processadas → ${uniqueDetailedBundles.length} únicas`);

        const result = saveDetailedBundlesData(uniqueDetailedBundles, bundlesToProcess, true, limitForTesting, startTime);
        
        if (!limitForTesting) {
            console.log('🔍 Verificação final de duplicatas...');
            const deduplication = removeDuplicatesFromDetailedBundles();
            if (deduplication.removed > 0) {
                result.totalBundles = deduplication.total;
                result.duplicatesRemoved = deduplication.removed;
                fs.writeFileSync(BUNDLES_DETAILED_FILE, JSON.stringify(result, null, 2), 'utf-8');
                console.log(`🧹 ${deduplication.removed} duplicatas adicionais removidas pelo middleware`);
            } else {
                console.log(`✅ Nenhuma duplicata adicional encontrada.`);
            }
        }
        
        return { success: true, ...result };
    } catch (error) {
        console.error('❌ Erro geral em updateBundlesWithDetails:', error);
        return { success: false, error: error.message };
    }
};

module.exports = { updateBundlesWithDetails };