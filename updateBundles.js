const axios = require('axios');
const fs = require('fs');

const BUNDLES_FILE = 'bundles.json';
const BUNDLES_DETAILED_FILE = 'bundleDetailed.json';

const fetchBundleDetails = async (bundleId, language = 'english') => {
    const url = `https://store.steampowered.com/actions/ajaxresolvebundles?bundleids=${bundleId}&cc=NL&l=${language}&origin=https:%2F%2Fstore.steampowered.com`;
    console.log(`Buscando detalhes para o bundle ID: ${bundleId} no idioma: ${language}`);
    try {
        const response = await axios.get(url);
        console.log(`Resposta da API para o bundle ID ${bundleId}:`, response.data);

        if (response.status !== 200) {
            console.error(`Erro na resposta da API para o bundle ID: ${bundleId}, Status: ${response.status}`);
            return {};
        }

        const bundleData = response.data[0]; 

        if (!bundleData) {
            console.error(`Nenhum dado encontrado para o bundle ID: ${bundleId}`);
            return {};
        }

        return {
            header_image: bundleData.header_image_url,
            capsule_image: bundleData.main_capsule,
            price: bundleData.final_price,
            discount: bundleData.discount_percent,
            genres: bundleData.genres ? bundleData.genres.map(genre => genre.description) : [],
            description: bundleData.name,
            packageids: bundleData.packageids,
            appids: bundleData.appids,
            initial_price: bundleData.initial_price,
            formatted_orig_price: bundleData.formatted_orig_price,
            formatted_final_price: bundleData.formatted_final_price,
            bundle_base_discount: bundleData.bundle_base_discount,
            available_windows: bundleData.available_windows,
            available_mac: bundleData.available_mac,
            available_linux: bundleData.available_linux,
            support_vrhmd: bundleData.support_vrhmd,
            support_vrhmd_only: bundleData.support_vrhmd_only,
            creator_clan_ids: bundleData.creator_clan_ids,
            localized_langs: bundleData.localized_langs,
            coming_soon: bundleData.coming_soon,
            library_asset: bundleData.library_asset,
            no_main_cap: bundleData.no_main_cap
        };
    } catch (error) {
        if (error.response) {
            console.error(`Erro na resposta da API para o bundle ID: ${bundleId}, Status: ${error.response.status}, Data: ${error.response.data}`);
        } else if (error.request) {
            console.error(`Nenhuma resposta recebida para o bundle ID: ${bundleId}, Request: ${error.request}`);
        } else {
            console.error(`Erro ao configurar a solicitação para o bundle ID: ${bundleId}, Message: ${error.message}`);
        }
        return {};
    }
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const updateBundlesWithDetails = async (language = 'english') => {
    try {
        if (!fs.existsSync(BUNDLES_FILE)) {
            console.error('Arquivo bundles.json não encontrado.');
            return;
        }

        console.log('Lendo o arquivo bundles.json...');
        const bundlesData = fs.readFileSync(BUNDLES_FILE, 'utf-8');
        const bundlesJson = JSON.parse(bundlesData);

        console.log('Iniciando atualização dos detalhes das bundles...');
        const updatedBundles = [];
        for (const bundle of bundlesJson.bundles) {
            const bundleId = bundle.Link.split('/bundle/')[1].split('/')[0];
            const bundleDetails = await fetchBundleDetails(bundleId, language);
            updatedBundles.push({ ...bundle, ...bundleDetails });

            // Salva os detalhes atualizados das bundles em bundleDetailed.json
            const result = {
                totalBundles: updatedBundles.length,
                bundles: updatedBundles
            };
            fs.writeFileSync(BUNDLES_DETAILED_FILE, JSON.stringify(result, null, 2), 'utf-8');
            console.log(`Detalhes do bundle ID ${bundleId} atualizados e salvos em ${BUNDLES_DETAILED_FILE}`);

            await delay(200); // Delay pra evitar que a API da steam bloqueie as req
        }

        console.log('Detalhes das bundles atualizados e salvos em bundleDetailed.json');
    } catch (error) {
        console.error('Erro ao atualizar os detalhes das bundles:', error);
    }
};

module.exports = { updateBundlesWithDetails };
