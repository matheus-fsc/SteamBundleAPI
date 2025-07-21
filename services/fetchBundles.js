const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const moment = require('moment-timezone');
const { updateBundlesWithDetails } = require('./updateBundles');
const { removeDuplicatesFromBasicBundles } = require('../middleware/dataValidation');

const BUNDLES_FILE = 'bundles.json';
const LAST_CHECK_FILE = 'last_check.json';
const TIMEZONE = 'America/Sao_Paulo'; // Horário de Brasília

// Configurações baseadas na lógica original com melhorias conservadoras
const MAX_CONCURRENT_REQUESTS = parseInt(process.env.FETCH_BUNDLES_CONCURRENT) || 3;
const DELAY_BETWEEN_BATCHES = parseInt(process.env.FETCH_BUNDLES_DELAY) || 1500;
const REQUEST_TIMEOUT = parseInt(process.env.FETCH_BUNDLES_TIMEOUT) || 10000;

// CONFIGURAÇÕES PARA RENDER FREE (500MB RAM)
const SAVE_INTERVAL_PAGES = 50;
const MEMORY_CHECK_INTERVAL = 20;
const MAX_MEMORY_USAGE_MB = 300;

console.log(`🔧 Fetch Bundles - ${MAX_CONCURRENT_REQUESTS} concurrent, ${DELAY_BETWEEN_BATCHES}ms delay`);
console.log(`💾 Modo Render Free: Salvamento a cada ${SAVE_INTERVAL_PAGES} páginas`);

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const getMemoryUsage = () => {
    const used = process.memoryUsage();
    return {
        rss: Math.round(used.rss / 1024 / 1024 * 100) / 100, // MB
        heapUsed: Math.round(used.heapUsed / 1024 / 1024 * 100) / 100, // MB
        heapTotal: Math.round(used.heapTotal / 1024 / 1024 * 100) / 100 // MB
    };
};

let totalBundlesCount = 0;

const saveBundlesData = (bundles, isComplete = false) => {
    const memory = getMemoryUsage();
    const result = {
        totalBundles: bundles.length,
        bundles: bundles,
        isComplete: isComplete,
        lastSaved: new Date().toISOString(),
        memoryUsage: memory
    };
    
    fs.writeFileSync(BUNDLES_FILE, JSON.stringify(result, null, 2), 'utf-8');
    
    if (isComplete) {
        console.log(`💾 ✅ Salvamento final: ${bundles.length} bundles (${memory.heapUsed}MB)`);
    } else {
        console.log(`💾 🔄 Salvamento parcial: ${bundles.length} bundles (${memory.heapUsed}MB)`);
    }
};

const fetchAndSaveBundles = async () => {
    try {
        console.log('🚀 Iniciando busca por bundles');
        
        const BUNDLES_OLD_FILE = 'bundles-old.json';
        
        if (fs.existsSync(BUNDLES_FILE)) {
            console.log('📁 Arquivo bundles.json encontrado, criando backup...');
            if (fs.existsSync(BUNDLES_OLD_FILE)) {
                console.log('🗑️ Removendo backup antigo...');
                fs.unlinkSync(BUNDLES_OLD_FILE);
            }
            fs.renameSync(BUNDLES_FILE, BUNDLES_OLD_FILE);
            console.log(`✅ Backup criado: ${BUNDLES_FILE} → ${BUNDLES_OLD_FILE}`);
        } else {
            console.log('📝 Primeira execução - nenhum arquivo anterior encontrado');
        }
        
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

            // MODIFICAÇÃO: Usando Promise.allSettled para maior robustez
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
            const shouldSaveByInterval = pagesProcessed % SAVE_INTERVAL_PAGES === 0;
            const shouldSaveByMemory = memory.heapUsed > MAX_MEMORY_USAGE_MB;
            
            if (shouldSaveByInterval || shouldSaveByMemory) {
                if (shouldSaveByMemory) {
                    console.log(`🚨 Memória alta (${memory.heapUsed}MB) - forçando salvamento`);
                }
                
                const uniqueBundles = Array.from(new Map(bundles.map(bundle => [bundle.Link, bundle])).values());
                console.log(`🔄 Salvamento parcial: ${bundles.length} coletadas → ${uniqueBundles.length} únicas`);
                
                saveBundlesData(uniqueBundles, false);
                
                if (global.gc) {
                    global.gc();
                    const memoryAfterGC = getMemoryUsage();
                    console.log(`🧹 GC executado: ${memory.heapUsed}MB → ${memoryAfterGC.heapUsed}MB`);
                }
            }

            if (pagesProcessed % MEMORY_CHECK_INTERVAL === 0) {
                console.log(`📊 Memória: ${memory.heapUsed}MB | Bundles: ${bundles.length} | Páginas: ${pagesProcessed}`);
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
        
        saveBundlesData(uniqueBundles, true);

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
        fs.writeFileSync(LAST_CHECK_FILE, JSON.stringify(lastCheck, null, 2), 'utf-8');

        console.log(`✅ Total de bundles catalogadas: ${totalBundlesCount}`);

        console.log('🔄 Iniciando atualização de detalhes...');
        await updateBundlesWithDetails();
        console.log('✅ Detalhes das bundles atualizados.');
    } catch (error) {
        console.error('❌ ERRO durante a busca de bundles!');
        
        const BUNDLES_OLD_FILE = 'bundles-old.json';
        
        if (fs.existsSync(BUNDLES_OLD_FILE)) {
            console.log('🔄 Tentando restaurar backup anterior...');
            try {
                if (fs.existsSync(BUNDLES_FILE)) {
                    fs.unlinkSync(BUNDLES_FILE);
                }
                fs.renameSync(BUNDLES_OLD_FILE, BUNDLES_FILE);
                console.log('✅ Backup restaurado com sucesso!');
                console.log('💡 Os dados anteriores foram mantidos para evitar perda de informações.');
            } catch (restoreError) {
                console.error('❌ Erro ao restaurar backup:', restoreError.message);
            }
        }
        
        if (error.response) {
            console.error('Erro na resposta da solicitação:', error.response.status, error.response.statusText);
        } else if (error.request) {
            console.error('Nenhuma resposta recebida:', error.request);
        } else {
            console.error('Erro ao configurar a solicitação:', error.message);
        }
        
        throw error;
    }
};

module.exports = { fetchAndSaveBundles, totalBundlesCount };