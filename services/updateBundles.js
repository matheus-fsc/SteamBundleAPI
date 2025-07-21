const axios = require('axios');
const fs = require('fs');
const moment = require('moment-timezone');
const { removeDuplicatesFromDetailedBundles } = require('../middleware/dataValidation');

const BUNDLES_FILE = 'bundles.json';
const BUNDLES_DETAILED_FILE = './bundleDetailed.json';
const TIMEZONE = 'America/Sao_Paulo';

// Configurações otimizadas para a API da Steam
const STEAM_API_CONFIG = {
    // Delay entre requisições (ms) - Reduzido para acelerar
    DELAY_BETWEEN_REQUESTS: parseInt(process.env.STEAM_API_DELAY) || 300,
    // Delay entre chamadas de app details (ms) - mais agressivo para app details
    DELAY_BETWEEN_APP_REQUESTS: parseInt(process.env.STEAM_APP_DELAY) || 50,
    // Quantidade máxima de apps por bundle para buscar detalhes (evita bundles gigantes)
    MAX_APPS_PER_BUNDLE: parseInt(process.env.MAX_APPS_PER_BUNDLE) || 30,
    // Timeout para requisições
    REQUEST_TIMEOUT: parseInt(process.env.REQUEST_TIMEOUT) || 8000,
    // Número de tentativas em caso de erro
    MAX_RETRIES: parseInt(process.env.MAX_RETRIES) || 2,
    // Processamento paralelo de bundles
    PARALLEL_BUNDLES: parseInt(process.env.PARALLEL_BUNDLES) || 10,
    // Tamanho do lote para app details
    APP_BATCH_SIZE: parseInt(process.env.APP_BATCH_SIZE) || 8,
    // Skip detalhes para bundles com muitos apps (acelera muito)
    SKIP_DETAILS_THRESHOLD: parseInt(process.env.SKIP_DETAILS_THRESHOLD) || 100
};

console.log('🔧 Configurações da API Steam:', STEAM_API_CONFIG);

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * VERSÃO ULTRA OTIMIZADA da função para buscar detalhes.
 * Skip automático para bundles muito grandes + processamento paralelo melhorado.
 * @param {number[]} appids - Um array de IDs de aplicativos da Steam.
 * @returns {Promise<{genres: string[], categories: string[]}>} - Um objeto contendo listas de gêneros e categorias únicos.
 */
const getDetailsForApps = async (appids) => {
    const allGenres = new Set();
    const allCategories = new Set();
    
    // Skip detalhes para bundles gigantes (economia massiva de tempo)
    if (appids.length > STEAM_API_CONFIG.SKIP_DETAILS_THRESHOLD) {
        console.log(`   ⏭️  Pulando detalhes - bundle com ${appids.length} apps (limite: ${STEAM_API_CONFIG.SKIP_DETAILS_THRESHOLD})`);
        return { genres: [], categories: [] };
    }
    
    // Limita a quantidade de apps para evitar bundles gigantes que demoram muito
    const limitedAppids = appids.slice(0, STEAM_API_CONFIG.MAX_APPS_PER_BUNDLE);
    
    if (appids.length > STEAM_API_CONFIG.MAX_APPS_PER_BUNDLE) {
        console.log(`⚠️  Bundle tem ${appids.length} apps, processando apenas os primeiros ${STEAM_API_CONFIG.MAX_APPS_PER_BUNDLE}`);
    }

    console.log(`   📋 Buscando detalhes para ${limitedAppids.length} apps...`);
    let processedApps = 0;
    let successfulApps = 0;

    // Processamento em lotes maiores para acelerar
    const BATCH_SIZE = STEAM_API_CONFIG.APP_BATCH_SIZE;
    for (let i = 0; i < limitedAppids.length; i += BATCH_SIZE) {
        const batch = limitedAppids.slice(i, i + BATCH_SIZE);
        
        // Processa o lote em paralelo
        const batchPromises = batch.map(async (appid) => {
            return await fetchAppDetailsWithRetry(appid);
        });
        
        const batchResults = await Promise.allSettled(batchPromises);
        
        // Processa os resultados do lote
        batchResults.forEach((result, index) => {
            processedApps++;
            if (result.status === 'fulfilled' && result.value) {
                const { genres, categories } = result.value;
                successfulApps++;
                
                genres.forEach(genre => allGenres.add(genre));
                categories.forEach(category => allCategories.add(category));
            }
        });
        
        // Log de progresso reduzido
        if (limitedAppids.length > 30 && i % 24 === 0) {
            console.log(`   ⏳ Apps: ${processedApps}/${limitedAppids.length}`);
        }
        
        // Delay menor entre lotes
        if (i + BATCH_SIZE < limitedAppids.length) {
            await delay(STEAM_API_CONFIG.DELAY_BETWEEN_APP_REQUESTS);
        }
    }

    if (successfulApps > 0) {
        console.log(`   ✅ ${successfulApps}/${limitedAppids.length} apps processados`);
    }

    return {
        genres: Array.from(allGenres),
        categories: Array.from(allCategories)
    };
};

/**
 * Busca detalhes de um app com retry automático e timeout reduzido
 */
const fetchAppDetailsWithRetry = async (appid, retryCount = 0) => {
    const url = `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=BR&l=brazilian`;
    
    try {
        const response = await axios.get(url, { 
            timeout: STEAM_API_CONFIG.REQUEST_TIMEOUT,
            headers: {
                'User-Agent': 'SteamBundleAPI/1.0'
            }
        });
        
        const data = response.data;

        if (data && data[appid] && data[appid].success) {
            const appData = data[appid].data;
            
            const genres = appData.genres ? appData.genres.map(g => g.description) : [];
            const categories = appData.categories ? appData.categories.map(c => c.description) : [];
            
            return { genres, categories };
        }
        
        return null;
        
    } catch (error) {
        if (retryCount < STEAM_API_CONFIG.MAX_RETRIES) {
            await delay(500 * (retryCount + 1)); // Delay menor e mais progressivo
            return await fetchAppDetailsWithRetry(appid, retryCount + 1);
        }
        
        return null;
    }
};


const fetchBundleDetails = async (bundleId, language = 'brazilian') => {
    const url = `https://store.steampowered.com/actions/ajaxresolvebundles?bundleids=${bundleId}&cc=BR&l=${language}`;
    
    for (let attempt = 1; attempt <= STEAM_API_CONFIG.MAX_RETRIES; attempt++) {
        try {
            const response = await axios.get(url, { 
                timeout: STEAM_API_CONFIG.REQUEST_TIMEOUT,
                headers: {
                    'User-Agent': 'SteamBundleAPI/1.0',
                    'Accept': 'application/json'
                }
            });

            if (response.status !== 200) {
                throw new Error(`HTTP ${response.status} para bundle ${bundleId}`);
            }
            
            if (!response.data || !Array.isArray(response.data) || !response.data[0]) {
                // Bundle não existe ou foi removida
                console.log(`   ⚠️  Bundle ${bundleId} não encontrada (removida?)`);
                return null;
            }

            const bundleData = response.data[0];
            
            // Verifica se a bundle tem dados válidos
            if (!bundleData.bundleid || !bundleData.name) {
                console.log(`   ❌ Bundle ${bundleId} com dados inválidos`);
                return null;
            }
            
            // Log para acompanhar progresso
            console.log(`   🔍 ${bundleData.name} (${bundleData.appids?.length || 0} apps)`);

            // *** NOVA LÓGICA OTIMIZADA ***
            // Busca os gêneros e categorias de todos os apps na bundle
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
                
                // *** DADOS ENRIQUECIDOS ***
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
                
                // Metadados úteis
                processed_at: new Date().toISOString(),
                api_version: '2.0'
            };
            
        } catch (error) {
            if (attempt === STEAM_API_CONFIG.MAX_RETRIES) {
                // Diferencia tipos de erro
                if (error.code === 'ECONNABORTED' || error.code === 'ENOTFOUND') {
                    console.log(`   🌐 Erro de conectividade bundle ${bundleId}`);
                } else if (error.response?.status === 429) {
                    console.log(`   ⏰ Rate limit bundle ${bundleId} - aguarde`);
                } else if (error.response?.status >= 400 && error.response?.status < 500) {
                    console.log(`   ❌ Bundle ${bundleId} não encontrada/inválida`);
                } else {
                    console.log(`   💀 Erro bundle ${bundleId}: ${error.message}`);
                }
                return null;
            }
            
            // Delay progressivo entre tentativas
            await delay(1000 * attempt);
        }
    }
    
    return null;
};

/**
 * Processa um lote de bundles em paralelo
 */
const processBundleBatch = async (bundleBatch, language, batchIndex, totalBatches) => {
    console.log(`🚀 Lote ${batchIndex + 1}/${totalBatches}: Processando ${bundleBatch.length} bundles em paralelo...`);
    
    const batchPromises = bundleBatch.map(async (bundle, index) => {
        try {
            const bundleIdMatch = bundle.Link.match(/\/bundle\/(\d+)/);
            if (!bundleIdMatch) return null;

            const bundleId = bundleIdMatch[1];
            const bundleDetails = await fetchBundleDetails(bundleId, language);
            
            if (bundleDetails) {
                bundleDetails.link = bundle.Link;
                return bundleDetails;
            }
            
            return null;
        } catch (error) {
            console.error(`❌ Erro no bundle ${bundle.Link}:`, error.message);
            return null;
        }
    });
    
    const results = await Promise.allSettled(batchPromises);
    const successfulBundles = results
        .filter(result => result.status === 'fulfilled' && result.value !== null)
        .map(result => result.value);
    
    console.log(`✅ Lote ${batchIndex + 1}: ${successfulBundles.length}/${bundleBatch.length} bundles processados`);
    return successfulBundles;
};

const updateBundlesWithDetails = async (language = 'brazilian', limitForTesting = null) => {
    console.log('🚀 VERSÃO ULTRA OTIMIZADA - Iniciando atualização com processamento paralelo...');
    if (limitForTesting) {
        console.log(`🧪 MODO TESTE: Processando apenas ${limitForTesting} bundles`);
    }
    
    const startTime = Date.now();
    
    try {
        if (!fs.existsSync(BUNDLES_FILE)) {
            console.error('Arquivo bundles.json não encontrado.');
            return;
        }
        const bundlesData = fs.readFileSync(BUNDLES_FILE, 'utf-8');
        const bundlesJson = JSON.parse(bundlesData);
        
        // Limita o número de bundles se for modo teste
        const bundlesToProcess = limitForTesting 
            ? bundlesJson.bundles.slice(0, limitForTesting)
            : bundlesJson.bundles;
        
        console.log(`📊 Total de bundles: ${bundlesToProcess.length}`);
        console.log(`⚙️  Processamento paralelo: ${STEAM_API_CONFIG.PARALLEL_BUNDLES} bundles simultâneas`);
        console.log(`⚙️  Delay entre requisições: ${STEAM_API_CONFIG.DELAY_BETWEEN_REQUESTS}ms`);
        
        const detailedBundles = [];
        
        // Divide em lotes para processamento paralelo
        const batchSize = STEAM_API_CONFIG.PARALLEL_BUNDLES;
        const totalBatches = Math.ceil(bundlesToProcess.length / batchSize);
        
        for (let i = 0; i < bundlesToProcess.length; i += batchSize) {
            const batch = bundlesToProcess.slice(i, i + batchSize);
            const batchIndex = Math.floor(i / batchSize);
            
            const batchStartTime = Date.now();
            const batchResults = await processBundleBatch(batch, language, batchIndex, totalBatches);
            const batchEndTime = Date.now();
            
            detailedBundles.push(...batchResults);
            
            // Log de progresso com estatísticas
            const elapsed = (batchEndTime - startTime) / 1000;
            const batchTime = (batchEndTime - batchStartTime) / 1000;
            const remaining = totalBatches - batchIndex - 1;
            const estimatedTimeLeft = remaining * batchTime;
            
            console.log(`📈 Progresso: ${detailedBundles.length}/${bundlesToProcess.length} | Tempo: ${elapsed.toFixed(1)}s | ETA: ${estimatedTimeLeft.toFixed(1)}s`);

            // Delay configurável entre lotes (não entre bundles individuais)
            if (i + batchSize < bundlesToProcess.length) {
                await delay(STEAM_API_CONFIG.DELAY_BETWEEN_REQUESTS);
            }
        }

        const totalTime = (Date.now() - startTime) / 1000;
        console.log(`🎉 Processamento concluído em ${totalTime.toFixed(2)}s (${(detailedBundles.length / totalTime).toFixed(2)} bundles/s)`);

        const result = {
            last_update: moment().tz(TIMEZONE).format(),
            totalBundles: detailedBundles.length,
            isTestMode: !!limitForTesting,
            processedCount: bundlesToProcess.length,
            processingTimeSeconds: totalTime,
            bundlesPerSecond: detailedBundles.length / totalTime,
            bundles: detailedBundles
        };

        // Se for modo teste, salva em arquivo diferente
        const outputFile = limitForTesting ? './bundleDetailed_test.json' : BUNDLES_DETAILED_FILE;
        fs.writeFileSync(outputFile, JSON.stringify(result, null, 2), 'utf-8');
        console.log(`💾 ${detailedBundles.length} bundles salvos em ${outputFile}`);
        
        // 🧹 Remove duplicatas após salvar (apenas para arquivo principal)
        if (!limitForTesting) {
            console.log('🔍 Verificando duplicatas...');
            const deduplication = removeDuplicatesFromDetailedBundles();
            if (deduplication.removed > 0) {
                result.totalBundles = deduplication.total;
                result.duplicatesRemoved = deduplication.removed;
            }
        }
        
        return {
            success: true,
            processedBundles: detailedBundles.length,
            totalRequested: bundlesToProcess.length,
            isTestMode: !!limitForTesting,
            outputFile: outputFile,
            duplicatesRemoved: result.duplicatesRemoved || 0,
            processingTimeSeconds: totalTime,
            bundlesPerSecond: detailedBundles.length / totalTime
        };
    } catch (error) {
        console.error('❌ Erro geral em updateBundlesWithDetails:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

module.exports = { updateBundlesWithDetails };