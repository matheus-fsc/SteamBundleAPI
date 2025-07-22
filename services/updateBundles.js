const axios = require('axios');
const fs = require('fs').promises;
const fsSync = require('fs');
const moment = require('moment-timezone');
const { removeDuplicatesFromDetailedBundles } = require('../middleware/dataValidation');
const { keepAlive } = require('./keepAlive');

const BUNDLES_FILE = 'bundles.json';
const BUNDLES_DETAILED_FILE = './bundleDetailed.json';
const UPDATE_STATE_FILE = './updateState.json';
const TIMEZONE = 'America/Sao_Paulo';

const STEAM_API_CONFIG = {
    DELAY_BETWEEN_REQUESTS: parseInt(process.env.STEAM_API_DELAY) || 1000,
    DELAY_BETWEEN_APP_BATCHES: parseInt(process.env.STEAM_APP_DELAY) || 300,
    MAX_APPS_PER_BUNDLE: parseInt(process.env.MAX_APPS_PER_BUNDLE) || 30,
    REQUEST_TIMEOUT: parseInt(process.env.REQUEST_TIMEOUT) || 15000,
    MAX_RETRIES: parseInt(process.env.MAX_RETRIES) || 3,
    PARALLEL_BUNDLES: parseInt(process.env.PARALLEL_BUNDLES) || 4,
    APP_DETAILS_BATCH_SIZE: parseInt(process.env.APP_BATCH_SIZE) || 5,
    SKIP_DETAILS_THRESHOLD: parseInt(process.env.SKIP_DETAILS_THRESHOLD) || 60
};

const SAVE_INTERVAL_BATCHES = 15;
const MEMORY_CHECK_INTERVAL_BATCHES = 3;
const MAX_MEMORY_USAGE_MB = 300;

console.log('🔧 Configurações da API Steam:', STEAM_API_CONFIG);
console.log(`💾 Modo Render Free: Salvamento a cada ${SAVE_INTERVAL_BATCHES} lotes`);

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const loadUpdateState = () => {
    try {
        if (fsSync.existsSync(UPDATE_STATE_FILE)) {
            const state = JSON.parse(fsSync.readFileSync(UPDATE_STATE_FILE, 'utf-8'));
            console.log(`📋 Estado de atualização encontrado: ${state.status} (${state.completed}/${state.total})`);
            return state;
        }
    } catch (error) {
        console.warn('⚠️ Erro ao carregar estado de atualização:', error.message);
    }
    return null;
};

const saveUpdateState = async (state) => {
    try {
        const stateWithTimestamp = {
            ...state,
            lastSaved: new Date().toISOString(),
            lastActivity: new Date().toISOString()
        };
        await fs.writeFile(UPDATE_STATE_FILE, JSON.stringify(stateWithTimestamp, null, 2), 'utf-8');
    } catch (error) {
        console.error('❌ Erro ao salvar estado de atualização:', error.message);
    }
};

const clearUpdateState = async () => {
    try {
        await fs.unlink(UPDATE_STATE_FILE);
        console.log('🗑️ Estado de atualização limpo');
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.warn('⚠️ Erro ao limpar estado de atualização:', error.message);
        }
    }
};

const createInitialUpdateState = (bundlesToProcess, limitForTesting, language) => {
    return {
        status: 'in_progress',
        startTime: Date.now(),
        total: bundlesToProcess.length,
        completed: 0,
        lastProcessedIndex: -1,
        language: language,
        isTestMode: !!limitForTesting,
        processedBundles: [],
        errors: [],
        resumeCount: 0
    };
};

const getMemoryUsage = () => {
    const used = process.memoryUsage();
    return {
        rss: Math.round(used.rss / 1024 / 1024 * 100) / 100,
        heapUsed: Math.round(used.heapUsed / 1024 / 1024 * 100) / 100,
        heapTotal: Math.round(used.heapTotal / 1024 / 1024 * 100) / 100
    };
};

const saveDetailedBundlesData = async (detailedBundles, bundlesToProcess, isComplete = false, isTestMode = false, startTime, updateState = null) => {
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
        memoryUsage: memory,
        updateStatus: updateState ? {
            status: updateState.status,
            completed: updateState.completed,
            total: updateState.total,
            lastProcessedIndex: updateState.lastProcessedIndex,
            resumeCount: updateState.resumeCount,
            canResume: !isComplete
        } : null
    };
    
    const outputFile = isTestMode ? './bundleDetailed_test.json' : BUNDLES_DETAILED_FILE;
    
    try {
        await fs.writeFile(outputFile, JSON.stringify(result, null, 2), 'utf-8');
        
        if (isComplete) {
            console.log(`💾 ✅ Salvamento final: ${detailedBundles.length} bundles (${memory.heapUsed}MB)`);
        } else {
            console.log(`💾 🔄 Salvamento parcial: ${detailedBundles.length} bundles (${memory.heapUsed}MB) - Checkpoint: ${updateState?.completed}/${updateState?.total}`);
        }
    } catch (error) {
        console.error('❌ Erro ao salvar dados detalhados:', error.message);
        throw error;
    }
    
    return result;
};

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
            const response = await axios.get(url, {
                timeout: STEAM_API_CONFIG.REQUEST_TIMEOUT,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'application/json'
                }
            });

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
            if (err.message === 'IP_BLOCKED_BY_STEAM') throw err;
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
    console.log('🚀 VERSÃO OTIMIZADA COM RESUMO - Iniciando atualização...');
    if (limitForTesting) console.log(`🧪 MODO TESTE: Processando apenas ${limitForTesting} bundles`);
    
    if (!limitForTesting) {
        keepAlive.start('bundle-update');
    }
    
    try {
        if (!fsSync.existsSync(BUNDLES_FILE)) {
            console.error('Arquivo bundles.json não encontrado.');
            return { success: false, error: 'Arquivo bundles.json não encontrado' };
        }
        
        const bundlesJson = JSON.parse(fsSync.readFileSync(BUNDLES_FILE, 'utf-8'));
        const bundlesToProcess = limitForTesting ? bundlesJson.bundles.slice(0, limitForTesting) : bundlesJson.bundles;
        
        let updateState = loadUpdateState();
        let detailedBundles = [];
        let startIndex = 0;
        let actualStartTime = Date.now();
        
        if (updateState && updateState.status === 'in_progress' && !limitForTesting) {
            console.log(`🔄 RESUMINDO atualização anterior:`);
            console.log(`   📊 Progresso anterior: ${updateState.completed}/${updateState.total}`);
            console.log(`   📅 Iniciado em: ${new Date(updateState.startTime).toLocaleString()}`);
            
            try {
                if (fsSync.existsSync(BUNDLES_DETAILED_FILE)) {
                    const existingData = JSON.parse(fsSync.readFileSync(BUNDLES_DETAILED_FILE, 'utf-8'));
                    if (existingData.bundles && !existingData.isComplete) {
                        detailedBundles = existingData.bundles;
                        startIndex = updateState.lastProcessedIndex + 1;
                        updateState.resumeCount++;
                        console.log(`   ✅ ${detailedBundles.length} bundles já processados carregados`);
                        console.log(`   🎯 Continuando do índice ${startIndex}`);
                    }
                }
            } catch (error) {
                console.warn('⚠️ Erro ao carregar progresso anterior, reiniciando:', error.message);
                updateState = null;
                detailedBundles = [];
                startIndex = 0;
            }
        }
        
        if (!updateState) {
            updateState = createInitialUpdateState(bundlesToProcess, limitForTesting, language);
            actualStartTime = updateState.startTime;
            console.log(`📊 Nova atualização iniciada: ${bundlesToProcess.length} bundles`);
        }
        
        saveUpdateState(updateState);
        
        let batchesProcessed = Math.floor(startIndex / STEAM_API_CONFIG.PARALLEL_BUNDLES);
        const batchSize = STEAM_API_CONFIG.PARALLEL_BUNDLES;
        const totalBatches = Math.ceil(bundlesToProcess.length / batchSize);
        
        console.log(`🚀 Processando de ${startIndex} até ${bundlesToProcess.length} (${totalBatches - batchesProcessed} lotes restantes)`);
        
        for (let i = startIndex; i < bundlesToProcess.length; i += batchSize) {
            const batch = bundlesToProcess.slice(i, i + batchSize);
            const batchIndex = Math.floor(i / batchSize);
            
            const batchStartTime = Date.now();
            const batchResults = await processBundleBatch(batch, language, batchIndex, totalBatches);
            const batchEndTime = Date.now();
            
            detailedBundles.push(...batchResults);
            batchesProcessed++;
            
            updateState.completed = i + batch.length;
            updateState.lastProcessedIndex = Math.min(i + batch.length - 1, bundlesToProcess.length - 1);
            updateState.lastActivity = new Date().toISOString();
            
            const elapsed = (batchEndTime - actualStartTime) / 1000;
            const batchTime = (batchEndTime - batchStartTime) / 1000;
            const remaining = totalBatches - batchIndex - 1;
            const estimatedTimeLeft = remaining * batchTime;
            
            console.log(`📈 Progresso: ${updateState.completed}/${bundlesToProcess.length} | Tempo: ${elapsed.toFixed(1)}s | ETA: ${estimatedTimeLeft.toFixed(1)}s | Resumos: ${updateState.resumeCount}`);

            const memory = getMemoryUsage();
            const shouldSaveByInterval = batchesProcessed % SAVE_INTERVAL_BATCHES === 0;
            const shouldSaveByMemory = memory.heapUsed > MAX_MEMORY_USAGE_MB;
            
            if (shouldSaveByInterval || shouldSaveByMemory) {
                if (shouldSaveByMemory) console.log(`🚨 Memória alta (${memory.heapUsed}MB) - forçando salvamento`);
                
                const uniqueDetailedBundles = Array.from(new Map(detailedBundles.map(bundle => [bundle.bundleid, bundle])).values());
                await saveDetailedBundlesData(uniqueDetailedBundles, bundlesToProcess, false, limitForTesting, actualStartTime, updateState);
                await saveUpdateState(updateState);
                
                if (global.gc) {
                    global.gc();
                    const memoryAfterGC = getMemoryUsage();
                    console.log(`🧹 GC executado: ${memory.heapUsed}MB → ${memoryAfterGC.heapUsed}MB`);
                }
            }

            if (batchesProcessed % MEMORY_CHECK_INTERVAL_BATCHES === 0) {
                console.log(`📊 Memória: ${memory.heapUsed}MB | Detalhadas: ${detailedBundles.length} | Lotes: ${batchIndex + 1}/${totalBatches} | Checkpoint: ${updateState.completed}/${updateState.total}`);
            }

            if (i + batchSize < bundlesToProcess.length) {
                await delay(STEAM_API_CONFIG.DELAY_BETWEEN_REQUESTS);
            }
        }

        console.log(`🎉 Processamento concluído em ${(Date.now() - actualStartTime) / 1000}s`);
        
        console.log('🔍 Removendo duplicatas das bundles detalhadas...');
        const uniqueDetailedBundles = Array.from(new Map(detailedBundles.map(bundle => [bundle.bundleid, bundle])).values());
        console.log(`📊 Bundles detalhadas: ${detailedBundles.length} processadas → ${uniqueDetailedBundles.length} únicas`);

        updateState.status = 'completed';
        updateState.completed = bundlesToProcess.length;
        updateState.endTime = Date.now();
        
        const result = await saveDetailedBundlesData(uniqueDetailedBundles, bundlesToProcess, true, limitForTesting, actualStartTime, updateState);
        
        if (!limitForTesting) {
            console.log('🔍 Verificação final de duplicatas...');
            const deduplication = removeDuplicatesFromDetailedBundles();
            if (deduplication.removed > 0) {
                result.totalBundles = deduplication.total;
                result.duplicatesRemoved = deduplication.removed;
                await fs.writeFile(BUNDLES_DETAILED_FILE, JSON.stringify(result, null, 2), 'utf-8');
                console.log(`🧹 ${deduplication.removed} duplicatas adicionais removidas pelo middleware`);
            } else {
                console.log(`✅ Nenhuma duplicata adicional encontrada.`);
            }
            
            await clearUpdateState();
            console.log(`🏁 Atualização COMPLETA com ${updateState.resumeCount} resumos`);
            
            keepAlive.stop('update-completed');
        }
        
        return { success: true, ...result, resumeCount: updateState.resumeCount };
    } catch (error) {
        console.error('❌ Erro geral em updateBundlesWithDetails:', error);
        
        if (!limitForTesting) {
            keepAlive.stop('update-error');
        }
        
        try {
            const errorState = loadUpdateState();
            if (errorState) {
                errorState.status = 'error';
                errorState.lastError = error.message;
                errorState.errorTime = new Date().toISOString();
                saveUpdateState(errorState);
            }
        } catch (stateError) {
            console.error('❌ Erro ao salvar estado de erro:', stateError.message);
        }
        
        return { success: false, error: error.message };
    }
};

module.exports = { 
    updateBundlesWithDetails,
    loadUpdateState,
    saveUpdateState,
    clearUpdateState,
    checkAndResumeUpdate: async () => {
        const state = loadUpdateState();
        if (state && state.status === 'in_progress') {
            console.log('🔄 Atualização incompleta detectada na inicialização!');
            console.log(`   📊 Progresso: ${state.completed}/${state.total}`);
            console.log(`   📅 Iniciado: ${new Date(state.startTime).toLocaleString()}`);
            console.log(`   🔄 Resumos anteriores: ${state.resumeCount}`);
            
            const timeSinceStart = (Date.now() - state.startTime) / (1000 * 60);
            if (timeSinceStart > 60) {
                console.log('⏰ Atualização muito antiga, limpando estado...');
                await clearUpdateState();
                return false;
            }
            
            console.log('✅ Estado válido encontrado - a próxima atualização continuará automaticamente');
            return true;
        }
        return false;
    }
};
