const axios = require('axios');
const fs = require('fs');
const moment = require('moment-timezone');

const BUNDLES_FILE = 'bundles.json';
const BUNDLES_DETAILED_FILE = './bundleDetailed.json'; // Ajuste também para salvar no mesmo nível
const LAST_CHECK_FILE = 'last_check.json';
const TIMEZONE = 'America/Sao_Paulo';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const fetchBundleDetails = async (bundleId, language = 'english') => {
    const url = `https://store.steampowered.com/actions/ajaxresolvebundles?bundleids=${bundleId}&cc=NL&l=${language}&origin=https:%2F%2Fstore.steampowered.com`;
    try {
        const response = await axios.get(url);
        console.log(`Resposta da API para o bundle ID ${bundleId}:`, response.data);

        if (response.status !== 200 || !response.data[0]) {
            console.error(`Erro ao buscar detalhes para o bundle ID: ${bundleId}`);
            return {};
        }

        const bundleData = response.data[0];

        return {
            bundleid: bundleData.bundleid,
            name: bundleData.name,
            header_image: bundleData.header_image_url,
            capsule_image: bundleData.main_capsule,
            price: bundleData.final_price,
            discount: bundleData.discount_percent,
            genres: [], 
            description: bundleData.name,
            packageids: bundleData.packageids,
            appids: bundleData.appids,
            initial_price: bundleData.initial_price,
            formatted_orig_price: bundleData.formatted_orig_price,
            formatted_final_price: bundleData.formatted_final_price || formatPrice(bundleData.final_price),
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
        console.error(`Erro ao buscar detalhes para o bundle ID: ${bundleId}`, error);
        return {};
    }
};

const formatPrice = (priceInCents) => {
    return (priceInCents / 100).toFixed(2).replace('.', ',') + '€';
};

const updateBundlesWithDetails = async (language = 'english') => {
    console.log('updateBundlesWithDetails foi chamado com o idioma:', language);
    try {
        if (!fs.existsSync(BUNDLES_FILE)) {
            console.error('Arquivo bundles.json não encontrado no caminho:', BUNDLES_FILE);
            return;
        }
        const bundlesData = fs.readFileSync(BUNDLES_FILE, 'utf-8');
        console.log('Conteúdo de bundles.json:', bundlesData);

        const bundlesJson = JSON.parse(bundlesData);
        console.log('Iniciando atualização dos detalhes das bundles...');

        const bundlePromises = bundlesJson.bundles.map(async (bundle, index) => {
            try {
                const bundleId = bundle.Link.split('/bundle/')[1].split('/')[0];
                console.log(`Processando bundle ID: ${bundleId}`);
                await delay(index * 100); // 100ms entre as solicitações
                const bundleDetails = await fetchBundleDetails(bundleId, language);
                console.log(`Detalhes do bundle ${bundleId}:`, bundleDetails);
                return { ...bundle, ...bundleDetails };
            } catch (error) {
                console.error(`Erro ao processar o bundle ${bundle.Link}:`, error);
                return null;
            }
        });

        const updatedBundles = await Promise.all(bundlePromises);
        console.log('Bundles atualizados:', updatedBundles);

        const result = {
            totalBundles: updatedBundles.length,
            bundles: updatedBundles
        };

        fs.writeFileSync(BUNDLES_DETAILED_FILE, JSON.stringify(result, null, 2), 'utf-8');
        console.log('Detalhes das bundles atualizados e salvos em bundleDetailed.json');
    } catch (error) {
        console.error('Erro em updateBundlesWithDetails:', error);
    }
};

module.exports = { updateBundlesWithDetails };