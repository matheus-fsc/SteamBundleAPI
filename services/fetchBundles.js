const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const fsSync = require('fs');
const moment = require('moment-timezone');
const { keepAlive } = require('./keepAlive');
const { storageSyncManager } = require('./storageSync');

const LAST_CHECK_FILE = 'last_check.json';
const TIMEZONE = 'America/Sao_Paulo';

const MAX_CONCURRENT_REQUESTS = parseInt(process.env.FETCH_BUNDLES_CONCURRENT) || 5;
const DELAY_BETWEEN_BATCHES = parseInt(process.env.FETCH_BUNDLES_DELAY) || 500;
const REQUEST_TIMEOUT = parseInt(process.env.FETCH_BUNDLES_TIMEOUT) || 15000;

// === CONFIGURAÇÕES DE RETRY ROBUSTO ===
const RETRY_CONFIG = {
    MAX_RETRIES: parseInt(process.env.FETCH_RETRY_COUNT) || 3,
    RETRY_DELAY_BASE: parseInt(process.env.FETCH_RETRY_DELAY) || 2000, // 2s base
    RETRY_DELAY_MULTIPLIER: 2, // Aumenta progressivamente
    MAX_RETRY_DELAY: 30000, // Máximo 30s
    FAILURE_THRESHOLD: 5, // Máximo de falhas consecutivas antes de abortar
    BACKOFF_ON_ERROR: true, // Aumenta delay após erro
};

const MEMORY_CHECK_INTERVAL = 20;
const MAX_MEMORY_USAGE_MB = 300;

console.log(`🔧 Fetch Bundles - ${MAX_CONCURRENT_REQUESTS} concurrent, ${DELAY_BETWEEN_BATCHES}ms delay`);
console.log(`🔄 Sistema de Retry: ${RETRY_CONFIG.MAX_RETRIES} tentativas, delay base ${RETRY_CONFIG.RETRY_DELAY_BASE}ms`);
console.log(`💾 Modo Storage API: Dados enviados diretamente para storage backend`);

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const getMemoryUsage = () => {
    const used = process.memoryUsage();
    return {
        rss: Math.round(used.rss / 1024 / 1024 * 100) / 100,
        heapUsed: Math.round(used.heapUsed / 1024 / 1024 * 100) / 100,
        heapTotal: Math.round(used.heapTotal / 1024 / 1024 * 100) / 100
    };
};

let totalBundlesCount = 0;

// === SISTEMA DE RETRY ROBUSTO PARA FETCH DE PÁGINAS ===
const fetchPageWithRetry = async (page, attempt = 1) => {
    const url = `https://store.steampowered.com/search/?term=bundle&ignore_preferences=1&hidef2p=1&ndl=1&page=${page}`;
    
    try {
        console.log(`📄 Tentativa ${attempt}/${RETRY_CONFIG.MAX_RETRIES} - Página ${page}`);
        
        const { data } = await axios.get(url, {
            timeout: REQUEST_TIMEOUT,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            }
        });

        const $ = cheerio.load(data);
        const bundleElements = $('a[href*="/bundle/"]');
        console.log(`📄 Página ${page}: ${bundleElements.length} bundles encontradas`);

        if (bundleElements.length === 0) {
            return null; // Fim das páginas
        }

        const bundlePromises = bundleElements.map(async (_, el) => {
            const title = $(el).find('.title').text().trim();
            const link = $(el).attr('href');
            if (title && link && link.includes('/bundle/')) {
                // Extrair Bundle ID do link
                const bundleMatch = link.match(/\/bundle\/(\d+)\//);
                const bundleId = bundleMatch ? parseInt(bundleMatch[1]) : null;
                
                return { 
                    id: bundleId,
                    nome: title, 
                    Nome: title, 
                    Link: link,
                    bundle_id: bundleId,
                    bundle_name: title,
                    bundle_link: link
                };
            }
        }).get();

        const bundleResults = await Promise.all(bundlePromises);
        const validBundles = bundleResults.filter(bundle => bundle && bundle.id);
        
        console.log(`✅ Página ${page}: ${validBundles.length} bundles válidos extraídos`);
        return validBundles;

    } catch (error) {
        console.error(`❌ Erro na página ${page} (tentativa ${attempt}): ${error.message}`);

        if (attempt < RETRY_CONFIG.MAX_RETRIES) {
            const retryDelay = Math.min(
                RETRY_CONFIG.RETRY_DELAY_BASE * Math.pow(RETRY_CONFIG.RETRY_DELAY_MULTIPLIER, attempt - 1),
                RETRY_CONFIG.MAX_RETRY_DELAY
            );
            
            console.log(`⏳ Tentando novamente em ${retryDelay}ms...`);
            await delay(retryDelay);
            return fetchPageWithRetry(page, attempt + 1);
        }

        console.error(`❌ Falha definitiva na página ${page} após ${RETRY_CONFIG.MAX_RETRIES} tentativas`);
        return null;
    }
};

// === FUNÇÃO PRINCIPAL COM RETRY ROBUSTO ===
const fetchAndSaveBundles = async (limitForTesting = null) => {
    let keepAliveStarted = false;
    let consecutiveFailures = 0;
    
    try {
        console.log('🚀 Iniciando busca por bundles com sistema de retry robusto');
        if (limitForTesting) {
            console.log(`🧪 MODO TESTE: Limitado a ${limitForTesting} bundles`);
        }
        console.log('💓 Iniciando keep-alive durante fetch de bundles...');
        keepAlive.start();
        keepAliveStarted = true;

        // PASSO 1: Iniciar a sessão
        const sessionId = await storageSyncManager.startSyncSession();

        let page = 1;
        let hasMorePages = true;
        let totalSent = 0;

        while (hasMorePages && consecutiveFailures < RETRY_CONFIG.FAILURE_THRESHOLD) {
            let currentChunk = [];
            const pagePromises = [];

            // Buscar páginas em paralelo com retry
            for (let i = 0; i < MAX_CONCURRENT_REQUESTS; i++) {
                pagePromises.push(fetchPageWithRetry(page + i));
            }

            const settledResults = await Promise.allSettled(pagePromises);
            let successCount = 0;

            for (let i = 0; i < settledResults.length; i++) {
                const result = settledResults[i];
                const currentPage = page + i;

                if (result.status === 'fulfilled') {
                    if (result.value === null) {
                        // Fim das páginas
                        hasMorePages = false;
                        console.log(`🏁 Fim das páginas detectado na página ${currentPage}`);
                    } else if (result.value && result.value.length > 0) {
                        currentChunk.push(...result.value);
                        successCount++;
                        consecutiveFailures = 0; // Reset contador de falhas
                    }
                } else {
                    console.error(`❌ Falha definitiva na página ${currentPage}: ${result.reason}`);
                    consecutiveFailures++;
                }
            }

            page += MAX_CONCURRENT_REQUESTS;

            // Verificar se muitas falhas consecutivas
            if (consecutiveFailures >= RETRY_CONFIG.FAILURE_THRESHOLD) {
                console.error(`❌ Muitas falhas consecutivas (${consecutiveFailures}). Abortando coleta.`);
                hasMorePages = false;
            }

            // MODO TESTE: Para quando atinge o limite
            if (limitForTesting && totalSent + currentChunk.length >= limitForTesting) {
                const remaining = limitForTesting - totalSent;
                currentChunk = currentChunk.slice(0, remaining);
                hasMorePages = false;
                console.log(`🧪 Limite de teste atingido: ${limitForTesting} bundles`);
            }

            // Se o chunk tiver dados, remove duplicatas e envia
            if (currentChunk.length > 0) {
                const uniqueChunk = Array.from(new Map(currentChunk.map(b => [b.Link, b])).values());
                console.log(`📦 Enviando lote de ${uniqueChunk.length} bundles para a API...`);
                
                // Log dos primeiros IDs para debug
                const firstFewIds = uniqueChunk.slice(0, 5).map(b => b.id).join(', ');
                console.log(`🔍 Primeiros IDs do lote: ${firstFewIds}`);
                
                // PASSO 2: Enviar o lote com retry
                let syncAttempts = 0;
                const maxSyncAttempts = 3;
                
                while (syncAttempts < maxSyncAttempts) {
                    try {
                        await storageSyncManager.syncBasicBatch(uniqueChunk, sessionId);
                        totalSent += uniqueChunk.length;
                        console.log(`✅ Lote enviado com sucesso (${totalSent} total)`);
                        break;
                    } catch (syncError) {
                        syncAttempts++;
                        console.error(`❌ Erro ao enviar lote (tentativa ${syncAttempts}/${maxSyncAttempts}): ${syncError.message}`);
                        
                        if (syncAttempts < maxSyncAttempts) {
                            await delay(RETRY_CONFIG.RETRY_DELAY_BASE * syncAttempts);
                        } else {
                            throw syncError;
                        }
                    }
                }
            }

            // Delay entre lotes (aumenta após falhas)
            if (hasMorePages) {
                let currentDelay = DELAY_BETWEEN_BATCHES;
                if (RETRY_CONFIG.BACKOFF_ON_ERROR && consecutiveFailures > 0) {
                    currentDelay *= Math.pow(2, Math.min(consecutiveFailures, 3));
                }
                console.log(`⏳ Aguardando ${currentDelay}ms antes do próximo lote...`);
                await delay(currentDelay);
            }

            // Log de progresso a cada 10 lotes
            if (totalSent > 0 && totalSent % (MAX_CONCURRENT_REQUESTS * 10 * 25) === 0) {
                console.log(`📊 Progresso: ${totalSent} bundles coletados`);
                
                // Verificar memória
                const memory = getMemoryUsage();
                if (memory.heapUsed > MAX_MEMORY_USAGE_MB) {
                    console.warn(`⚠️ Uso de memória alto: ${memory.heapUsed}MB`);
                    if (global.gc) {
                        global.gc();
                        console.log('🧹 Garbage collection executado');
                    }
                }
            }
        }

        // PASSO 3: Finalizar a sessão
        console.log('🏁 Coleta de todas as páginas concluída. Finalizando a sessão na API...');
        await storageSyncManager.finishSyncSession(sessionId);
        totalBundlesCount = totalSent;
        
        const lastCheck = { lastCheck: moment().tz(TIMEZONE).format() };
        await fs.writeFile(LAST_CHECK_FILE, JSON.stringify(lastCheck, null, 2), 'utf-8');
        
        console.log(`✅ Sincronização de bundles básicos concluída com sucesso usando sistema robusto! Total: ${totalBundlesCount}`);

        // NOVO: Atualiza sync_status na API admin
        try {
            const adminUrl = process.env.STORAGE_API_URL ? `${process.env.STORAGE_API_URL}/api/admin?operation=sync-status-update` : 'https://bundleset-api-storage.vercel.app/api/admin?operation=sync-status-update';
            await axios.post(adminUrl, {
                data_type: 'bundles',
                is_complete: true,
                total_records: totalBundlesCount,
                last_session_id: sessionId
            }, {
                headers: {
                    'x-api-key': process.env.STORAGE_API_KEY || '',
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            });
            console.log('✅ sync_status atualizado na API admin (bundles)');
        } catch (err) {
            console.warn('⚠️ Falha ao atualizar sync_status na API admin:', err.message);
        }

        if (keepAliveStarted) {
            keepAlive.stop();
        }

    } catch (error) {
        console.error('❌ ERRO durante a busca de bundles!');
        if (error.response) {
            console.error('Erro na resposta da solicitação:', error.response.status, error.response.statusText);
        } else if (error.request) {
            console.error('Nenhuma resposta recebida:', error.request);
        } else {
            console.error('Erro ao configurar a solicitação:', error.message);
        }
        if (keepAliveStarted) {
            console.log('💓 Parando keep-alive devido a erro no fetch');
            keepAlive.stop();
        }
        throw error;
    }
};

module.exports = {
    fetchAndSaveBundles,
    totalBundlesCount,
    // Função de conveniência para testes
    fetchBundles: fetchAndSaveBundles
};