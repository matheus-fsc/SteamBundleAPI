const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const moment = require('moment-timezone');
const { updateBundlesWithDetails } = require('./updateBundles');
const { removeDuplicatesFromBasicBundles } = require('../middleware/dataValidation');

const BUNDLES_FILE = 'bundles.json';
const LAST_CHECK_FILE = 'last_check.json';
const TIMEZONE = 'America/Sao_Paulo'; // Horário de Brasília
const MAX_CONCURRENT_REQUESTS = 5; // Número máximo de requisições simultâneas

let totalBundlesCount = 0;  // Variável global para armazenar a quantidade de bundles

const fetchAndSaveBundles = async () => {
    try {
        console.log('Iniciando busca por bundles');
        let bundles = [];
        let page = 1;
        let hasMorePages = true;
        let previousPageData = null;

        const fetchPage = async (page) => {
            const url = `https://store.steampowered.com/search/?term=bundle&ignore_preferences=1&hidef2p=1&ndl=1&page=${page}`;

            const { data } = await axios.get(url);

            if (previousPageData && previousPageData === data) {
                return null;
            }

            const $ = cheerio.load(data);
            const bundleElements = $('a[href*="/bundle/"]');
            
            // Log apenas se não encontrar elementos (indica fim das páginas)
            if (bundleElements.length === 0) {
                console.log(`📄 Página ${page}: Não há mais bundles - fim da busca`);
                return null;
            } else {
                // Log de progresso a cada 10 páginas
                if (page % 10 === 0) {
                    console.log(`📄 Processando página ${page} (${bundleElements.length} bundles encontradas)`);
                }
                
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

            const pageResults = await Promise.all(pagePromises);
            for (const result of pageResults) {
                if (result) {
                    bundles.push(...result);
                } else {
                    hasMorePages = false;
                }
            }

            // Log de progresso geral a cada 50 páginas ou quando encontrar muitos bundles
            if (page % 50 === 0 || bundles.length % 1000 === 0) {
                console.log(`📊 Progresso: ${bundles.length} bundles encontradas (página ~${page})`);
            }

            // Salva o arquivo a cada 100 bundles para não perder progresso
            if (bundles.length % 100 === 0) {
                const result = {
                    totalBundles: bundles.length,
                    bundles: bundles
                };
                fs.writeFileSync(BUNDLES_FILE, JSON.stringify(result, null, 2), 'utf-8');
            }

            // Atualiza os dados da página anterior
            previousPageData = pageResults[pageResults.length - 1];
        }

        console.log(`✅ Busca concluída: ${bundles.length} bundles encontradas`);

        // Salva o resultado final
        const result = {
            totalBundles: bundles.length,
            bundles: bundles
        };
        fs.writeFileSync(BUNDLES_FILE, JSON.stringify(result, null, 2), 'utf-8');
        console.log(`💾 Arquivo bundles.json salvo com ${bundles.length} bundles`);

        // 🧹 Remove duplicatas após a coleta
        console.log('🔍 Verificando duplicatas nas bundles básicas...');
        const deduplication = removeDuplicatesFromBasicBundles();
        if (deduplication.removed > 0) {
            totalBundlesCount = deduplication.total;
            console.log(`🧹 ${deduplication.removed} duplicatas removidas. Total final: ${totalBundlesCount}`);
        } else {
            totalBundlesCount = bundles.length;
        }

        // Save the last check time
        const lastCheck = { lastCheck: moment().tz(TIMEZONE).format() };
        fs.writeFileSync(LAST_CHECK_FILE, JSON.stringify(lastCheck, null, 2), 'utf-8');

        console.log(`🎯 Total de bundles catalogadas: ${totalBundlesCount}`);

        // Atualiza os detalhes das bundles
        console.log('🔄 Iniciando atualização de detalhes das bundles...');
        await updateBundlesWithDetails();
        console.log('✅ Detalhes das bundles atualizados com sucesso.');
    } catch (error) {
        if (error.response) {
            console.error('❌ Erro na resposta da solicitação:', error.response.status, error.response.statusText);
        } else if (error.request) {
            console.error('❌ Nenhuma resposta recebida:', error.request);
        } else {
            console.error('❌ Erro ao configurar a solicitação:', error.message);
        }
    }
};

module.exports = { fetchAndSaveBundles, totalBundlesCount };