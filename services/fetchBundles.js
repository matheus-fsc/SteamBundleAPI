const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const fsSync = require('fs');
const moment = require('moment-timezone');
const { updateBundlesWithDetails } = require('./updateBundles');
const { removeDuplicatesFromBasicBundles } = require('../middleware/dataValidation');
const { keepAlive } = require('./keepAlive');
const { storageSyncManager } = require('./storageSync');

const LAST_CHECK_FILE = 'last_check.json';
const TIMEZONE = 'America/Sao_Paulo';

const MAX_CONCURRENT_REQUESTS = parseInt(process.env.FETCH_BUNDLES_CONCURRENT) || 5;
const DELAY_BETWEEN_BATCHES = parseInt(process.env.FETCH_BUNDLES_DELAY) || 200;
const REQUEST_TIMEOUT = parseInt(process.env.FETCH_BUNDLES_TIMEOUT) || 15000;

const MEMORY_CHECK_INTERVAL = 20;
const MAX_MEMORY_USAGE_MB = 300;

console.log(`🔧 Fetch Bundles - ${MAX_CONCURRENT_REQUESTS} concurrent, ${DELAY_BETWEEN_BATCHES}ms delay`);
console.log(`� Modo Storage API: Dados enviados diretamente para storage backend`);

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

// Função removida - dados são agora sincronizados diretamente com a API de storage
// após a coleta completa, eliminando a necessidade de persistência local

const fetchAndSaveBundles = async () => {
    let keepAliveStarted = false;
    
    try {
        console.log('🚀 Iniciando busca por bundles');
        
        console.log('💓 Iniciando keep-alive durante fetch de bundles...');
        keepAlive.start();
        keepAliveStarted = true;
        
        let bundles = [];
        let page = 1;
        let hasMorePages = true;
        let previousPageData = null;
        let pagesProcessed = 0;

        const fetchPage = async (page) => {
            const url = `https://store.steampowered.com/search/?term=bundle&ignore_preferences=1&hidef2p=1&ndl=1&page=${page}`;
            const { data } = await axios.get(url, {
                timeout: REQUEST_TIMEOUT,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });

            if (previousPageData && previousPageData === data) {
                return null;
            }

            const $ = cheerio.load(data);
            const bundleElements = $('a[href*="/bundle/"]');
            console.log(`📄 Página ${page}: ${bundleElements.length} bundles encontradas`);

            if (bundleElements.length === 0) {
                return null;
            } else {
                const bundlePromises = bundleElements.map(async (_, el) => {
                    const title = $(el).find('.title').text().trim();
                    const link = $(el).attr('href');
                    if (title && link.includes('/bundle/')) {
                        return { Nome: title, Link: link };
                    }
                }).get();

                const bundleResults = await Promise.all(bundlePromises);
                return bundleResults.filter(bundle => bundle);
            }
        };

        while (hasMorePages) {
            const pagePromises = [];
            for (let i = 0; i < MAX_CONCURRENT_REQUESTS && hasMorePages; i++) {
                pagePromises.push(fetchPage(page));
                page++;
            }

            const settledResults = await Promise.allSettled(pagePromises);

            for (const result of settledResults) {
                if (result.status === 'fulfilled') {
                    if (result.value) {
                        bundles.push(...result.value);
                    } else {
                        hasMorePages = false;
                    }
                } else {
                    console.error(`❌ Falha ao buscar uma página: ${result.reason.message}`);
                    hasMorePages = false;
                    break; 
                }
            }
            
            pagesProcessed += MAX_CONCURRENT_REQUESTS;

            const memory = getMemoryUsage();
            
            if (pagesProcessed % MEMORY_CHECK_INTERVAL === 0) {
                console.log(`� Memória: ${memory.heapUsed}MB | Bundles: ${bundles.length} | Páginas: ${pagesProcessed}`);
                
                // Limpeza de memória quando necessário
                if (memory.heapUsed > MAX_MEMORY_USAGE_MB && global.gc) {
                    global.gc();
                    const memoryAfterGC = getMemoryUsage();
                    console.log(`🧹 GC executado: ${memory.heapUsed}MB → ${memoryAfterGC.heapUsed}MB`);
                }
            }

            if (hasMorePages) {
                console.log(`⏳ Aguardando ${DELAY_BETWEEN_BATCHES}ms antes do próximo lote...`);
                await delay(DELAY_BETWEEN_BATCHES);
            }

            previousPageData = settledResults[settledResults.length - 1]?.value;
        }

        console.log('🔍 Removendo duplicatas das bundles coletadas...');
        const uniqueBundles = Array.from(new Map(bundles.map(bundle => [bundle.Link, bundle])).values());
        console.log(`📊 Bundles: ${bundles.length} coletadas → ${uniqueBundles.length} únicas`);
        
        console.log('🔍 Verificação final de duplicatas...');
        const deduplication = removeDuplicatesFromBasicBundles();
        if (deduplication.removed > 0) {
            totalBundlesCount = deduplication.total;
            console.log(`🧹 ${deduplication.removed} duplicatas adicionais removidas pelo middleware. Total final: ${totalBundlesCount}`);
        } else {
            totalBundlesCount = uniqueBundles.length;
            console.log(`✅ Nenhuma duplicata adicional encontrada. Total final: ${totalBundlesCount}`);
        }

        const lastCheck = { lastCheck: moment().tz(TIMEZONE).format() };
        await fs.writeFile(LAST_CHECK_FILE, JSON.stringify(lastCheck, null, 2), 'utf-8');

        console.log(`✅ Total de bundles catalogadas: ${totalBundlesCount}`);

        // === SINCRONIZAÇÃO COM STORAGE BACKEND ===
        try {
            console.log('🔄 Iniciando sincronização com storage backend...');
            
            // Valida configuração
            storageSyncManager.validateConfig();
            
            // Testa conectividade
            const connectivity = await storageSyncManager.testConnection();
            if (!connectivity.success) {
                console.warn('⚠️ Problema de conectividade com storage, abortando sincronização');
                throw new Error(`Conectividade falhada: ${connectivity.error}`);
            }
            
            // Sincroniza bundles básicos
            await storageSyncManager.syncBasicBundles(uniqueBundles);
            console.log('✅ Bundles básicos sincronizados com storage backend');
            
        } catch (syncError) {
            console.error('❌ Erro na sincronização com storage:', syncError.message);
            throw syncError; // Re-lança o erro para interromper o processo
        }

        console.log('🔄 Iniciando atualização de detalhes...');
        await updateBundlesWithDetails();
        console.log('✅ Detalhes das bundles atualizados.');
        
        if (keepAliveStarted) {
            console.log('💓 Parando keep-alive - fetch concluído com sucesso');
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

module.exports = { fetchAndSaveBundles, totalBundlesCount };