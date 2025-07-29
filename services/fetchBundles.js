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

const fetchAndSaveBundles = async (limitForTesting = null) => {
    let keepAliveStarted = false;
    try {
        console.log('🚀 Iniciando busca por bundles');
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

        const fetchPage = async (page) => {
            const url = `https://store.steampowered.com/search/?term=bundle&ignore_preferences=1&hidef2p=1&ndl=1&page=${page}`;
            const { data } = await axios.get(url, {
                timeout: REQUEST_TIMEOUT,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
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
            let currentChunk = [];
            const pagePromises = [];
            for (let i = 0; i < MAX_CONCURRENT_REQUESTS; i++) {
                pagePromises.push(fetchPage(page));
                page++;
            }
            const settledResults = await Promise.allSettled(pagePromises);
            for (const result of settledResults) {
                if (result.status === 'fulfilled' && result.value) {
                    currentChunk.push(...result.value);
                } else if (result.status === 'fulfilled' && !result.value) {
                    hasMorePages = false;
                } else if (result.status === 'rejected') {
                    console.error(`❌ Falha ao buscar uma página: ${result.reason.message}`);
                    hasMorePages = false;
                }
            }
            // MODO TESTE: Para quando atinge o limite
            if (limitForTesting && totalSent + currentChunk.length >= limitForTesting) {
                const remaining = limitForTesting - totalSent;
                currentChunk = currentChunk.slice(0, remaining);
                hasMorePages = false;
            }
            // Se o chunk tiver dados, remove duplicatas e envia
            if (currentChunk.length > 0) {
                const uniqueChunk = Array.from(new Map(currentChunk.map(b => [b.Link, b])).values());
                console.log(`📦 Enviando lote de ${uniqueChunk.length} bundles para a API...`);
                // PASSO 2: Enviar o lote
                await storageSyncManager.syncBasicBatch(uniqueChunk, sessionId);
                totalSent += uniqueChunk.length;
            }
            // Delay entre lotes
            if (hasMorePages) {
                console.log(`⏳ Aguardando ${DELAY_BETWEEN_BATCHES}ms antes do próximo lote...`);
                await delay(DELAY_BETWEEN_BATCHES);
            }
        }

        // PASSO 3: Finalizar a sessão
        console.log('🏁 Coleta de todas as páginas concluída. Finalizando a sessão na API...');
        await storageSyncManager.finishSyncSession(sessionId);
        totalBundlesCount = totalSent;
        const lastCheck = { lastCheck: moment().tz(TIMEZONE).format() };
        await fs.writeFile(LAST_CHECK_FILE, JSON.stringify(lastCheck, null, 2), 'utf-8');
        console.log(`✅ Sincronização de bundles básicos concluída com sucesso usando o novo fluxo! Total: ${totalBundlesCount}`);

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