const axios = require('axios');
const fs = require('fs');

const BUNDLES_FILE = 'bundles.json';
const BUNDLES_DETAILED_FILE = 'bundleDetailed.json';

const fetchBundleDetails = async (bundleId) => {
    const url = `https://store.steampowered.com/actions/ajaxresolvebundles?bundleids=${bundleId}&cc=NL&l=english&origin=https:%2F%2Fstore.steampowered.com`;
    console.log(`Buscando detalhes para o bundle ID: ${bundleId}`);
    try {
        const response = await axios.get(url);
        console.log(`Resposta da API para o bundle ID ${bundleId}:`, response.data);

        if (response.status !== 200) {
            console.error(`Erro na resposta da API para o bundle ID: ${bundleId}, Status: ${response.status}`);
            return {};
        }

        const bundleData = response.data[0]; // Corrigido para acessar o primeiro elemento da resposta

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
            description: bundleData.name
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

const updateBundlesWithDetails = async () => {
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
            const bundleDetails = await fetchBundleDetails(bundleId);
            updatedBundles.push({ ...bundle, ...bundleDetails });

            // Salva os detalhes atualizados das bundles em bundleDetailed.json
            const result = {
                totalBundles: updatedBundles.length,
                bundles: updatedBundles
            };
            fs.writeFileSync(BUNDLES_DETAILED_FILE, JSON.stringify(result, null, 2), 'utf-8');
            console.log(`Detalhes do bundle ID ${bundleId} atualizados e salvos em ${BUNDLES_DETAILED_FILE}`);

            await delay(200); // Delay de 1 segundo entre cada consulta
        }

        console.log('Detalhes das bundles atualizados e salvos em bundleDetailed.json');
    } catch (error) {
        console.error('Erro ao atualizar os detalhes das bundles:', error);
    }
};

module.exports = { updateBundlesWithDetails };