const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const moment = require('moment-timezone');
const { updateBundlesWithDetails } = require('./updateBundles');

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
            console.log('Buscando dados da URL:', url);

            const { data } = await axios.get(url);
            console.log('Dados recebidos da URL:', data.length);

            // Verifica se os dados da página atual são iguais aos da página anterior
            if (previousPageData && previousPageData === data) {
                console.log('Dados da página atual são iguais aos da página anterior. Interrompendo a busca.');
                return null;
            }

            const $ = cheerio.load(data);
            console.log('Dados carregados no cheerio');

            const bundleElements = $('a[href*="/bundle/"]');
            console.log(`Encontrados ${bundleElements.length} elementos de bundle na página ${page}`);

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

            const pageResults = await Promise.all(pagePromises);
            for (const result of pageResults) {
                if (result) {
                    bundles.push(...result);
                } else {
                    hasMorePages = false;
                }
            }

            // Adiciona o contador de bundles
            const result = {
                totalBundles: bundles.length,
                bundles: bundles
            };

            // Log the bundles before saving
            console.log('Tentando gravar o seguinte JSON com os links e nomes das bundles:', JSON.stringify(result, null, 2));

            // Save bundles to bundles.json
            fs.writeFileSync(BUNDLES_FILE, JSON.stringify(result, null, 2), 'utf-8');
            console.log(`JSON gravado em bundles.json após a página ${page - MAX_CONCURRENT_REQUESTS}`);

            // Atualiza os dados da página anterior
            previousPageData = pageResults[pageResults.length - 1];
        }

        console.log('Bundles extraídos:', JSON.stringify(bundles, null, 2));

        // Save the last check time
        const lastCheck = { lastCheck: moment().tz(TIMEZONE).format() };
        fs.writeFileSync(LAST_CHECK_FILE, JSON.stringify(lastCheck, null, 2), 'utf-8');
        console.log('Última verificação gravada em last_check.json');

        // Atualiza a variável global com a quantidade de bundles
        totalBundlesCount = bundles.length;
        console.log(`Total de bundles catalogadas: ${totalBundlesCount}`);

        // Atualiza os detalhes das bundles
        await updateBundlesWithDetails();
        console.log('Detalhes das bundles atualizados.');
    } catch (error) {
        if (error.response) {
            console.error('Erro na resposta da solicitação:', error.response.status, error.response.statusText);
        } else if (error.request) {
            console.error('Nenhuma resposta recebida:', error.request);
        } else {
            console.error('Erro ao configurar a solicitação:', error.message);
        }
    }
};

module.exports = { fetchAndSaveBundles, totalBundlesCount };