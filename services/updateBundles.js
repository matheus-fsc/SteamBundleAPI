const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const fsSync = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const moment = require('moment-timezone');
const { removeDuplicatesFromDetailedBundles } = require('../middleware/dataValidation');
const { keepAlive } = require('./keepAlive');

// --- CONSTANTES ---
const BUNDLES_FILE = 'bundles.json';
const BUNDLES_DETAILED_FILE = './bundleDetailed.json';
const UPDATE_STATE_FILE = './updateState.json';
const TIMEZONE = 'America/Sao_Paulo';
const LOG_FILE = path.join(__dirname, 'scraping_debug.log');

const STEAM_API_CONFIG = {
    DELAY_BETWEEN_REQUESTS: parseInt(process.env.STEAM_API_DELAY) || 1500,
    REQUEST_TIMEOUT: parseInt(process.env.REQUEST_TIMEOUT) || 20000,
    MAX_RETRIES: parseInt(process.env.MAX_RETRIES) || 3,
    PARALLEL_BUNDLES: 3, // Mantém o paralelismo baixo para segurança
    STEAM_APP_DELAY: 300 // Delay entre chamadas da API de apps
};

const SAVE_INTERVAL_BATCHES = 15;
const MEMORY_CHECK_INTERVAL_BATCHES = 3;
const MAX_MEMORY_USAGE_MB = 300;
const CONSECUTIVE_FAILURE_THRESHOLD = 5; // Aumentado para 5
const CIRCUIT_BREAKER_DELAY = 45000; // Aumentado para 45s

console.log('🔧 Configurações da API Steam (OTIMIZADA):', STEAM_API_CONFIG);
console.log(`💾 Modo Render Free: Salvamento a cada ${SAVE_INTERVAL_BATCHES} lotes`);

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Função para limpar/resetar o log (Render Free - evita crescimento infinito)
const resetLog = async () => {
    try {
        if (fsSync.existsSync(LOG_FILE)) {
            await fsPromises.unlink(LOG_FILE);
            console.log('🗑️ Log anterior removido para economizar espaço (Render Free)');
        }
    } catch (error) {
        console.warn('⚠️ Erro ao limpar log anterior:', error.message);
    }
};

// Função auxiliar para o logger
const appendToLog = async (message) => {
    const timestamp = new Date().toISOString();
    try {
        await fsPromises.appendFile(LOG_FILE, `[${timestamp}] ${message}\n`);
    } catch (error) {
        console.error('Falha ao escrever no ficheiro de log:', error);
    }
};

/**
 * [NOVO - FALLBACK] Busca detalhes via API de apps quando o scraping falha.
 * @param {number[]} appIds - Array de IDs de aplicativos do bundle.
 * @returns {Promise<object>} - Objeto com gêneros, categorias, etc., agregados.
 */
const getDetailsFromApps = async (appIds) => {
    if (!appIds || appIds.length === 0) {
        return { genres: [], categories: [], developers: [] };
    }

    const allGenres = new Set();
    const allCategories = new Set();
    const allDevelopers = new Set();
    
    // Limita e processa em lotes menores para evitar erro 400
    const appIdsToProcess = appIds.slice(0, 20); // Reduzido de 30 para 20
    const batchSize = 5; // Processa 5 apps por vez

    try {
        for (let i = 0; i < appIdsToProcess.length; i += batchSize) {
            const batch = appIdsToProcess.slice(i, i + batchSize);
            
            // Tenta requisição individual se o lote falhar
            for (const appId of batch) {
                try {
                    // Sem parâmetros cc e l para evitar erro 400
                    const url = `https://store.steampowered.com/api/appdetails?appids=${appId}`;
                    const response = await axios.get(url, { 
                        timeout: 10000,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        }
                    });
                    
                    const appData = response.data;
                    const details = appData[appId];
                    
                    if (details && details.success && details.data) {
                        details.data.genres?.forEach(g => allGenres.add(g.description));
                        details.data.categories?.forEach(c => allCategories.add(c.description));
                        details.data.developers?.forEach(d => allDevelopers.add(d));
                    }
                    
                    await delay(500); // Aumento do delay para evitar rate limiting
                    
                } catch (singleError) {
                    // Log apenas se não for erro conhecido
                    if (!singleError.response || singleError.response.status !== 400) {
                        await appendToLog(`FALLBACK INFO: App ${appId} falhou (${singleError.response?.status || 'timeout'}), continuando...`);
                    }
                }
            }
            
            // Pausa entre lotes
            await delay(1000);
        }

    } catch (error) {
        await appendToLog(`ERRO DE FALLBACK: Falha geral ao buscar appdetails. Erro: ${error.message}`);
    }

    return {
        genres: Array.from(allGenres),
        categories: Array.from(allCategories),
        developers: Array.from(allDevelopers)
    };
};

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

const fetchBundleDetails = async (bundleId, language = 'brazilian') => {
    const bundleApiUrl = `https://store.steampowered.com/actions/ajaxresolvebundles?bundleids=${bundleId}&cc=BR&l=${language}`;
    const bundlePageUrl = `https://store.steampowered.com/bundle/${bundleId}/`;

    const browserHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
    };

    for (let attempt = 1; attempt <= STEAM_API_CONFIG.MAX_RETRIES; attempt++) {
        try {
            const apiResponse = await axios.get(bundleApiUrl, { headers: browserHeaders });
            if (!apiResponse.data || !apiResponse.data[0]) {
                return { success: false, reason: 'API_NO_DATA' };
            }
            const bundleData = apiResponse.data[0];

            // Atraso mais longo e mais aleatório para parecer mais humano
            await delay(2500 + Math.random() * 3000); // Espera entre 2.5 e 5.5 segundos

            const pageResponse = await axios.get(bundlePageUrl, { headers: browserHeaders, timeout: STEAM_API_CONFIG.REQUEST_TIMEOUT });
            const $ = cheerio.load(pageResponse.data);

            // Validação de página: Verifica se a página recebida é a correta
            const pageTitle = $('title').text();
            if (!pageTitle.includes(bundleData.name.substring(0, 10))) {
                await appendToLog(`AVISO DE VALIDAÇÃO: Título da página inválido para o Bundle ID ${bundleId} (Link: ${bundlePageUrl}). Provavelmente é uma página de erro/captcha.`);
                return { success: false, reason: 'INVALID_PAGE' };
            }

            const pageDetails = {};

            // --- LÓGICA DE EXTRAÇÃO PRECISA ---
            const findValuesForLabel = (label) => {
                const values = new Set();
                const labelElement = $(`.details_block b:contains("${label}")`);

                if (labelElement.length > 0) {
                    // Tenta encontrar um <span> adjacente primeiro (caso comum)
                    const span = labelElement.next('span');
                    if (span.length > 0) {
                        span.find('a').each((i, el) => values.add($(el).text().trim()));
                        return Array.from(values);
                    }

                    // Se não houver <span>, procura por links <a> soltos até o próximo <br>
                    let currentNode = labelElement[0].nextSibling;
                    while (currentNode && currentNode.tagName !== 'br') {
                        if (currentNode.type === 'tag' && currentNode.tagName === 'a') {
                            values.add($(currentNode).text().trim());
                        }
                        currentNode = currentNode.nextSibling;
                    }
                }
                return Array.from(values);
            };

            pageDetails.gênero = findValuesForLabel('Gênero:');
            pageDetails.desenvolvedor = findValuesForLabel('Desenvolvedor:');
            pageDetails.distribuidora = findValuesForLabel('Distribuidora:');
            pageDetails.série = findValuesForLabel('Série:');

            // Lógica para idiomas e descritores (mantida)
            const languagesText = $('.language_list').text();
            if (languagesText) {
                const cleanText = languagesText.replace(/Idiomas:/i, '').split('Os idiomas listados')[0];
                pageDetails.idiomas = cleanText.split(',').map(lang => lang.trim()).filter(Boolean);
            }
            const descriptors = $('.game_rating_area .descriptorText').html();
            if (descriptors) {
                pageDetails.descritores_de_conteúdo = descriptors.split('<br>').map(d => d.trim()).filter(Boolean);
            }

            // --- LÓGICA DE FALLBACK ---
            if (pageDetails.gênero.length === 0 && bundleData.appids && bundleData.appids.length > 0) {
                console.log(`⚠️  Scraping falhou para ${bundleData.name}. Ativando fallback via API de Apps...`);
                await appendToLog(`INFO: Ativando fallback para o Bundle ID ${bundleId} (Link: ${bundlePageUrl}).`);
                
                const detailsFromApps = await getDetailsFromApps(bundleData.appids);
                
                pageDetails.gênero = detailsFromApps.genres;
                pageDetails.categoria = detailsFromApps.categories;
                // Se o scraping não pegou desenvolvedor, usa o da API
                if (!pageDetails.desenvolvedor || pageDetails.desenvolvedor.length === 0) {
                    pageDetails.desenvolvedor = detailsFromApps.developers;
                }
            }

            const extractionSuccess = pageDetails.gênero && pageDetails.gênero.length > 0;
            if (!extractionSuccess) {
                 await appendToLog(`AVISO FINAL: Extração falhou para o Bundle ID ${bundleId} (Link: ${bundlePageUrl}), mesmo após o fallback.`);
                 console.log(`❌ [ID: ${bundleData.bundleid}] Falha na extração de ${bundleData.name}`);
            } else {
                console.log(`✅ [ID: ${bundleData.bundleid}] ${bundleData.name} (Gêneros: ${pageDetails.gênero.length}, Devs: ${pageDetails.desenvolvedor?.length || 0})`);
            }
            
            return {
                success: true,
                data: { 
                    ...bundleData, 
                    page_details: pageDetails, 
                    processed_at: new Date().toISOString(), 
                    api_version: '5.5-simplified' 
                },
                extractionFailed: !extractionSuccess
            };

        } catch (error) {
            const statusCode = error.response?.status;
            
            // --- DETECÇÃO DE PÁGINAS NÃO ENCONTRADAS ---
            if (statusCode === 404 || statusCode === 410) {
                await appendToLog(`INFO: Bundle ID ${bundleId} - Página não encontrada (${statusCode}). Bundle possivelmente removido ou indisponível na região.`);
                console.log(`⚠️  [ID: ${bundleId}] Página não encontrada (${statusCode})`);
                return { success: false, reason: 'PAGE_NOT_FOUND' };
            }
            
            await appendToLog(`ERRO: Tentativa ${attempt} para o Bundle ID ${bundleId} (Link: ${bundlePageUrl}). Status: ${statusCode || 'desconhecido'}. Erro: ${error.message}`);
            
            if (attempt === STEAM_API_CONFIG.MAX_RETRIES) {
                console.log(`❌ [ID: ${bundleId}] Máximo de tentativas atingido`);
                return { success: false, reason: 'MAX_RETRIES_REACHED' };
            }
            await delay(5000 * attempt); // Aumenta a espera entre retentativas se houver erro
        }
    }
    return { success: false, reason: 'UNKNOWN_FAILURE' };
};

const updateBundlesWithDetails = async (language = 'brazilian', limitForTesting = null) => {
    console.log('🚀 VERSÃO OTIMIZADA V5.5 SIMPLIFICADA - Iniciando atualização...');
    if (limitForTesting) console.log(`🧪 MODO TESTE: Processando apenas ${limitForTesting} bundles`);
    
    // --- LIMPEZA DO LOG (RENDER FREE) ---
    if (!limitForTesting) {
        await resetLog(); // Remove log anterior para economizar espaço
        await appendToLog(`=== NOVA ATUALIZAÇÃO INICIADA ===`);
        await appendToLog(`Versão: V5.5 simplificada`);
        await appendToLog(`Timestamp: ${new Date().toISOString()}`);
        await appendToLog(`Language: ${language}`);
        keepAlive.start('bundle-update');
    }
    
    // --- SISTEMA DE BACKUP PARA BUNDLEDETAILED.JSON ---
    const BUNDLES_DETAILED_OLD_FILE = './bundleDetailed-old.json';
    
    if (fsSync.existsSync(BUNDLES_DETAILED_FILE)) {
        try {
            console.log('📁 Arquivo bundleDetailed.json encontrado, criando backup...');
            
            // Remove backup antigo se existir
            if (fsSync.existsSync(BUNDLES_DETAILED_OLD_FILE)) {
                console.log('🗑️ Removendo backup antigo do bundleDetailed...');
                await fs.unlink(BUNDLES_DETAILED_OLD_FILE);
            }
            
            // Cria backup do arquivo atual
            await fs.rename(BUNDLES_DETAILED_FILE, BUNDLES_DETAILED_OLD_FILE);
            console.log(`✅ Backup criado: bundleDetailed.json → bundleDetailed-old.json`);
        } catch (backupError) {
            console.log(`⚠️ Erro ao criar backup do bundleDetailed.json: ${backupError.message}`);
            console.log('📄 Continuando sem backup (arquivo será sobrescrito)');
        }
    }
    
    try {
        // --- VERIFICAÇÃO INICIAL DE INTEGRIDADE ---
        if (fsSync.existsSync(BUNDLES_DETAILED_OLD_FILE)) {
            console.log('🔍 Verificando integridade do backup bundleDetailed-old.json...');
            try {
                const existingData = JSON.parse(fsSync.readFileSync(BUNDLES_DETAILED_OLD_FILE, 'utf-8'));
                
                // Verifica estrutura básica
                if (!existingData.bundles || !Array.isArray(existingData.bundles)) {
                    console.warn('⚠️ Backup bundleDetailed-old.json corrompido - removendo arquivo inválido...');
                    fsSync.unlinkSync(BUNDLES_DETAILED_OLD_FILE);
                } else if (existingData.isComplete) {
                    console.log('✅ Backup válido e completo encontrado');
                } else {
                    console.log(`📊 Backup parcial válido encontrado (${existingData.bundles.length} bundles processados)`);
                }
            } catch (parseError) {
                console.warn('⚠️ Erro ao ler backup bundleDetailed-old.json - removendo arquivo corrompido:', parseError.message);
                fsSync.unlinkSync(BUNDLES_DETAILED_OLD_FILE);
            }
        }
        
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
                // --- VERIFICAÇÃO DE INTEGRIDADE DO ARQUIVO ---
                if (fsSync.existsSync(BUNDLES_DETAILED_FILE)) {
                    console.log(`   🔍 Verificando integridade do arquivo bundleDetailed.json...`);
                    
                    const existingData = JSON.parse(fsSync.readFileSync(BUNDLES_DETAILED_FILE, 'utf-8'));
                    
                    // Verifica se o arquivo tem estrutura válida
                    if (!existingData.bundles || !Array.isArray(existingData.bundles)) {
                        console.warn('⚠️ Arquivo bundleDetailed.json corrompido - estrutura inválida. Reiniciando do início...');
                        updateState = null;
                        detailedBundles = [];
                        startIndex = 0;
                    } 
                    // Verifica se não está marcado como completo mas tem estrutura válida
                    else if (!existingData.isComplete) {
                        // Verifica se o número de bundles corresponde ao progresso esperado
                        const expectedBundles = Math.min(updateState.completed, bundlesToProcess.length);
                        const actualBundles = existingData.bundles.length;
                        
                        console.log(`   📊 Bundles esperados: ${expectedBundles}, Encontrados: ${actualBundles}`);
                        
                        // Se há uma discrepância significativa, reinicia
                        if (actualBundles < expectedBundles * 0.8) { // Permite 20% de margem para bundles que falharam
                            console.warn(`⚠️ Discrepância nos dados: esperado ~${expectedBundles}, encontrado ${actualBundles}. Reiniciando do início...`);
                            updateState = null;
                            detailedBundles = [];
                            startIndex = 0;
                        } else {
                            // Arquivo parece válido, pode continuar
                            detailedBundles = existingData.bundles;
                            startIndex = updateState.lastProcessedIndex + 1;
                            updateState.resumeCount++;
                            console.log(`   ✅ ${detailedBundles.length} bundles já processados carregados`);
                            console.log(`   🎯 Continuando do índice ${startIndex}`);
                        }
                    } else {
                        // Arquivo marcado como completo, não deveria estar em estado 'in_progress'
                        console.warn('⚠️ Estado inconsistente: arquivo completo mas updateState indica progresso. Limpando estado...');
                        updateState = null;
                        detailedBundles = [];
                        startIndex = 0;
                    }
                } else {
                    // Arquivo não existe, mas updateState indica progresso
                    console.warn('⚠️ Arquivo bundleDetailed.json não encontrado mas updateState indica progresso. Reiniciando do início...');
                    updateState = null;
                    detailedBundles = [];
                    startIndex = 0;
                }
            } catch (error) {
                console.warn('⚠️ Erro ao carregar progresso anterior (arquivo possivelmente corrompido), reiniciando:', error.message);
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
        
        let consecutiveFailures = 0; // Contador para o disjuntor
        let batchesProcessed = Math.floor(startIndex / 3); // Reduz paralelismo para 3
        const batchSize = 3; // Antes era STEAM_API_CONFIG.PARALLEL_BUNDLES (5), agora é 3
        const totalBatches = Math.ceil(bundlesToProcess.length / batchSize);
        
        console.log(`🚀 Processando de ${startIndex} até ${bundlesToProcess.length} (${totalBatches - batchesProcessed} lotes restantes)`);
        
        for (let i = startIndex; i < bundlesToProcess.length; i += batchSize) {
            const batch = bundlesToProcess.slice(i, i + batchSize);
            const batchIndex = Math.floor(i / batchSize);
            const batchId = `batch-${batchIndex + 1}`;

            // --- LÓGICA DO DISJUNTOR ---
            if (consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD) {
                console.log(`🚨 Múltiplas falhas (${consecutiveFailures}) detectadas. Pausando por ${CIRCUIT_BREAKER_DELAY / 1000} segundos para evitar bloqueio...`);
                await delay(CIRCUIT_BREAKER_DELAY);
                consecutiveFailures = 0; // Reseta o contador após a pausa
            }

            const batchStartTime = Date.now();
            console.log(`🚀 Lote ${batchIndex + 1}/${totalBatches}: Processando ${batch.length} bundles...`);
            
            const batchPromises = batch.map(bundle => {
                const bundleIdMatch = bundle.Link.match(/\/bundle\/(\d+)/);
                if (!bundleIdMatch) return Promise.resolve({ success: false, reason: 'INVALID_LINK' });
                return fetchBundleDetails(bundleIdMatch[1], language);
            });
            
            const results = await Promise.allSettled(batchPromises);
            const batchStartResults = detailedBundles.length;
            let ignoredNotFound = 0; // Contador para páginas não encontradas

            for (const result of results) {
                if (result.status === 'fulfilled') {
                    if (result.value.success) {
                        detailedBundles.push(result.value.data);
                        // Se a extração falhou (mesmo com a página válida), conta como falha para o disjuntor
                        if (result.value.extractionFailed) {
                            consecutiveFailures++;
                        } else {
                            consecutiveFailures = 0; // Reseta em caso de sucesso total
                        }
                    } else {
                        // --- NOVA LÓGICA: NÃO CONTA PÁGINAS INEXISTENTES COMO FALHA ---
                        if (result.value.reason === 'API_NO_DATA' || result.value.reason === 'PAGE_NOT_FOUND') {
                            // Bundle não existe ou página não encontrada - comportamento normal, não conta como falha
                            ignoredNotFound++;
                        } else {
                            // Outros tipos de falha (INVALID_PAGE, MAX_RETRIES_REACHED, etc.) contam como falha real
                            consecutiveFailures++;
                        }
                    }
                } else {
                    // Se a promessa foi rejeitada, também conta como falha
                    consecutiveFailures++;
                }
            }

            // Remove call to logManager.markBatchCompleted

            const batchEndTime = Date.now();
            const successfulInBatch = detailedBundles.length - batchStartResults;
            const logMessage = `✅ Lote ${batchIndex + 1}: ${successfulInBatch}/${batch.length} bundles processados com sucesso`;
            const failureInfo = ignoredNotFound > 0 ? ` | ${ignoredNotFound} não encontrados (ignorados)` : '';
            console.log(`${logMessage} | Falhas consecutivas: ${consecutiveFailures}${failureInfo}`);
            
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
            
            // Log de finalização
            await appendToLog(`=== ATUALIZAÇÃO CONCLUÍDA COM SUCESSO ===`);
            await appendToLog(`Total processado: ${result.totalBundles} bundles`);
            await appendToLog(`Resumos realizados: ${updateState.resumeCount}`);
            await appendToLog(`Tempo total: ${((Date.now() - actualStartTime) / 1000).toFixed(1)}s`);
            await appendToLog(`Finalizou em: ${new Date().toISOString()}`);
            
            keepAlive.stop('update-completed');
        }
        
        return { success: true, ...result, resumeCount: updateState.resumeCount };
    } catch (error) {
        console.error('❌ Erro geral em updateBundlesWithDetails:', error);
        
        // --- SISTEMA DE RESTAURAÇÃO DE BACKUP ---
        const BUNDLES_DETAILED_OLD_FILE = './bundleDetailed-old.json';
        
        if (fsSync.existsSync(BUNDLES_DETAILED_OLD_FILE)) {
            try {
                console.log('🔄 Erro durante atualização - tentando restaurar backup...');
                
                // Verifica se existe arquivo atual corrompido e remove
                if (fsSync.existsSync(BUNDLES_DETAILED_FILE)) {
                    console.log('🗑️ Removendo arquivo bundleDetailed.json corrompido...');
                    await fs.unlink(BUNDLES_DETAILED_FILE);
                }
                
                // Restaura o backup
                await fs.rename(BUNDLES_DETAILED_OLD_FILE, BUNDLES_DETAILED_FILE);
                console.log('✅ Backup restaurado com sucesso! Dados anteriores preservados.');
                
            } catch (restoreError) {
                console.error('❌ Erro ao restaurar backup do bundleDetailed.json:', restoreError.message);
                console.log('⚠️ Falha na restauração - dados podem estar indisponíveis temporariamente');
            }
        } else {
            console.log('⚠️ Nenhum backup disponível para restauração');
        }
        
        // Log de erro
        if (!limitForTesting) {
            await appendToLog(`=== ATUALIZAÇÃO FALHOU ===`);
            await appendToLog(`Erro: ${error.message}`);
            await appendToLog(`Timestamp: ${new Date().toISOString()}`);
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
