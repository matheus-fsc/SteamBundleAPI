const axios = require('axios');
const fs = require('fs');
const moment = require('moment-timezone');
const { removeDuplicatesFromDetailedBundles } = require('../middleware/dataValidation');

const BUNDLES_FILE = 'bundles.json';
const BUNDLES_DETAILED_FILE = './bundleDetailed.json';
const TIMEZONE = 'America/Sao_Paulo';

// Configurações otimizadas para a API da Steam
const STEAM_API_CONFIG = {
    // Delay entre requisições (ms) - Steam permite ~200 req/5min, então 1.5s é seguro
    DELAY_BETWEEN_REQUESTS: parseInt(process.env.STEAM_API_DELAY) || 1500,
    // Delay entre chamadas de app details (ms) - mais agressivo para app details
    DELAY_BETWEEN_APP_REQUESTS: parseInt(process.env.STEAM_APP_DELAY) || 100,
    // Quantidade máxima de apps por bundle para buscar detalhes (evita bundles gigantes)
    MAX_APPS_PER_BUNDLE: parseInt(process.env.MAX_APPS_PER_BUNDLE) || 50,
    // Timeout para requisições
    REQUEST_TIMEOUT: parseInt(process.env.REQUEST_TIMEOUT) || 10000,
    // Número de tentativas em caso de erro
    MAX_RETRIES: parseInt(process.env.MAX_RETRIES) || 3
};

console.log('🔧 Configurações da API Steam:', STEAM_API_CONFIG);

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * VERSÃO OTIMIZADA da função para buscar detalhes.
 * Processa em lotes e com configurações avançadas para melhor performance.
 * @param {number[]} appids - Um array de IDs de aplicativos da Steam.
 * @returns {Promise<{genres: string[], categories: string[]}>} - Um objeto contendo listas de gêneros e categorias únicos.
 */
const getDetailsForApps = async (appids) => {
    const allGenres = new Set();
    const allCategories = new Set();
    
    // Limita a quantidade de apps para evitar bundles gigantes que demoram muito
    const limitedAppids = appids.slice(0, STEAM_API_CONFIG.MAX_APPS_PER_BUNDLE);
    
    if (appids.length > STEAM_API_CONFIG.MAX_APPS_PER_BUNDLE) {
        console.log(`⚠️  Bundle tem ${appids.length} apps, processando apenas os primeiros ${STEAM_API_CONFIG.MAX_APPS_PER_BUNDLE}`);
    }

    console.log(`   📋 Buscando detalhes para ${limitedAppids.length} apps...`);
    let processedApps = 0;
    let successfulApps = 0;

    // Processamento em lotes de 5 apps simultâneos para acelerar
    const BATCH_SIZE = 5;
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
        
        // Log de progresso apenas para bundles com muitos apps
        if (limitedAppids.length > 20 && i % 15 === 0) {
            console.log(`   ⏳ Apps: ${processedApps}/${limitedAppids.length}`);
        }
        
        // Delay entre lotes
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
 * Busca detalhes de um app com retry automático
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
            await delay(1000 * (retryCount + 1)); // Delay progressivo
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

            if (response.status !== 200 || !response.data[0]) {
                throw new Error(`Resposta inválida da API Steam para bundle ${bundleId}`);
            }

            const bundleData = response.data[0];
            
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
                console.error(`💀 Falha definitiva para bundle ${bundleId}`);
                return null;
            }
            
            // Delay progressivo entre tentativas
            await delay(1000 * attempt);
        }
    }
    
    return null;
};

const updateBundlesWithDetails = async (language = 'brazilian', limitForTesting = null) => {
    console.log('Iniciando a atualização detalhada das bundles...');
    if (limitForTesting) {
        console.log(`🧪 MODO TESTE: Processando apenas ${limitForTesting} bundles`);
    }
    
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
        
        console.log(`Total de bundles a processar: ${bundlesToProcess.length}`);
        
        const detailedBundles = [];

        for (let i = 0; i < bundlesToProcess.length; i++) {
            const bundle = bundlesToProcess[i];
            try {
                const bundleIdMatch = bundle.Link.match(/\/bundle\/(\d+)/);
                if (!bundleIdMatch) continue;

                const bundleId = bundleIdMatch[1];
                console.log(`📦 (${i + 1}/${bundlesToProcess.length}) Processando bundle ID: ${bundleId}`);

                const startTime = Date.now();
                const bundleDetails = await fetchBundleDetails(bundleId, language);
                const endTime = Date.now();
                
                if (bundleDetails) {
                    bundleDetails.link = bundle.Link;
                    detailedBundles.push(bundleDetails);
                    console.log(`   ✅ Concluído em ${endTime - startTime}ms (${bundleDetails.genres.length} gêneros)`);
                } else {
                    console.log(`   ❌ Falha ao processar bundle ${bundleId}`);
                }

                // Delay configurável entre bundles
                if (i < bundlesToProcess.length - 1) {
                    await delay(STEAM_API_CONFIG.DELAY_BETWEEN_REQUESTS);
                }

                // Log de progresso a cada 50 bundles
                if ((i + 1) % 50 === 0) {
                    console.log(`📊 Progresso: ${i + 1}/${bundlesToProcess.length} bundles processadas (${detailedBundles.length} sucessos)`);
                } 

            } catch (error) {
                console.error(`Erro ao processar o bundle ${bundle.Link}:`, error);
            }
        }

        const result = {
            last_update: moment().tz(TIMEZONE).format(),
            totalBundles: detailedBundles.length,
            isTestMode: !!limitForTesting,
            processedCount: bundlesToProcess.length,
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
            duplicatesRemoved: result.duplicatesRemoved || 0
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