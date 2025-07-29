const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');

/**
 * Serviço de Scraping de Bundles Steam
 * Responsável por extrair dados de bundles da Steam Store
 */

// --- CONFIGURAÇÕES DE SCRAPING ---
const STEAM_API_CONFIG = {
    DELAY_BETWEEN_REQUESTS: parseInt(process.env.STEAM_API_DELAY) || 500,
    REQUEST_TIMEOUT: parseInt(process.env.REQUEST_TIMEOUT) || 20000,
    MAX_RETRIES: parseInt(process.env.MAX_RETRIES) || 3,
    PARALLEL_BUNDLES: 3, // REDUZIDO: Render Free tem apenas 0.1 core
    STEAM_APP_DELAY: 300 // Delay entre chamadas da API de apps
};

class BundleScrapingService {
    constructor() {
        this.LOG_FILE = path.join(__dirname, '../logs/scraping_debug.log');
        this._ensureLogDirectory();
        
        console.log('🔧 Serviço de Scraping inicializado:');
        console.log('   ⏱️  Configurações da API Steam:', STEAM_API_CONFIG);
    }

    async _ensureLogDirectory() {
        try {
            const logDir = path.dirname(this.LOG_FILE);
            await fs.mkdir(logDir, { recursive: true });
        } catch (error) {
            console.warn('⚠️ Erro ao criar diretório de logs:', error.message);
        }
    }

    // Função auxiliar para delays
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Logger para debugging
    async appendToLog(message) {
        const timestamp = new Date().toISOString();
        try {
            await fs.appendFile(this.LOG_FILE, `[${timestamp}] ${message}\n`);
        } catch (error) {
            console.error('Falha ao escrever no ficheiro de log:', error);
        }
    }

    /**
     * Busca detalhes via API de apps quando o scraping falha (fallback)
     */
    async getDetailsFromApps(appIds) {
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
                        
                        await this.delay(500); // Aumento do delay para evitar rate limiting
                        
                    } catch (singleError) {
                        // Log apenas se não for erro conhecido
                        if (!singleError.response || singleError.response.status !== 400) {
                            await this.appendToLog(`FALLBACK INFO: App ${appId} falhou (${singleError.response?.status || 'timeout'}), continuando...`);
                        }
                    }
                }
                
                // Pausa entre lotes
                await this.delay(1000);
            }

        } catch (error) {
            await this.appendToLog(`ERRO DE FALLBACK: Falha geral ao buscar appdetails. Erro: ${error.message}`);
        }

        return {
            genres: Array.from(allGenres),
            categories: Array.from(allCategories),
            developers: Array.from(allDevelopers)
        };
    }

    /**
     * Lida com verificação de idade Steam
     */
    async handleAgeVerification(bundlePageUrl, headers) {
        try {
            console.log(`🔞 Detectada página de verificação de idade, enviando confirmação...`);
            
            // Dados para confirmar idade (18+)
            const ageVerificationData = {
                snr: '1_4_4__',
                sessionid: '', // Steam usa sessionid, mas pode funcionar vazio
                ageDay: '1',
                ageMonth: 'January',
                ageYear: '1990'
            };
            
            // Faz POST para confirmar idade
            const ageConfirmResponse = await axios.post(
                'https://store.steampowered.com/agecheckset/bundle/',
                new URLSearchParams(ageVerificationData),
                {
                    headers: {
                        ...headers,
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Referer': bundlePageUrl,
                        'Origin': 'https://store.steampowered.com'
                    },
                    timeout: 15000
                }
            );
            
            await this.delay(1000); // Pequeno delay após confirmação
            
            // Tenta acessar a página novamente
            const retryResponse = await axios.get(bundlePageUrl, { 
                headers, 
                timeout: 20000 
            });
            
            return retryResponse;
            
        } catch (error) {
            console.log(`❌ Erro ao lidar com verificação de idade: ${error.message}`);
            throw error;
        }
    }

    /**
     * Função principal para buscar detalhes de um bundle
     */
    async fetchBundleDetails(bundleId, language = 'brazilian') {
        const bundleApiUrl = `https://store.steampowered.com/actions/ajaxresolvebundles?bundleids=${bundleId}&cc=BR&l=${language}`;
        const bundlePageUrl = `https://store.steampowered.com/bundle/${bundleId}/`;

        const browserHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
        };

        for (let attempt = 1; attempt <= STEAM_API_CONFIG.MAX_RETRIES; attempt++) {
            try {
                // Primeiro, busca dados básicos via API
                const apiResponse = await axios.get(bundleApiUrl, { headers: browserHeaders });
                if (!apiResponse.data || !apiResponse.data[0]) {
                    return { success: false, reason: 'API_NO_DATA' };
                }
                const bundleData = apiResponse.data[0];

                // Atraso mais longo e mais aleatório para parecer mais humano
                await this.delay(2500 + Math.random() * 3000); // Espera entre 2.5 e 5.5 segundos

                // Busca página para scraping
                const pageResponse = await axios.get(bundlePageUrl, { 
                    headers: browserHeaders, 
                    timeout: STEAM_API_CONFIG.REQUEST_TIMEOUT 
                });
                
                // 🆕 DETECÇÃO DE NSFW - Verifica se foi redirecionado para login
                const finalUrl = pageResponse.request?.res?.responseUrl || pageResponse.config.url;
                const isNSFWRedirect = finalUrl.includes('store.steampowered.com/login') && 
                                     (finalUrl.includes('agecheck') || finalUrl.includes('redir=agecheck'));
                
                if (isNSFWRedirect) {
                    console.log(`🔞 NSFW DETECTADO: Bundle ${bundleId} - Redirecionado para login (conteúdo adulto)`);
                    await this.appendToLog(`NSFW DETECTED: Bundle ID ${bundleId} - Redirecionado para ${finalUrl}`);
                    
                    // Retorna bundle com categorização manual NSFW
                    return {
                        success: true,
                        data: { 
                            ...bundleData, 
                            page_details: {
                                gênero: ['NSFW', 'Adult Content'],
                                categoria: ['Adult Only'],
                                desenvolvedor: ['N/A - Adult Content'],
                                distribuidora: ['N/A - Adult Content'],
                                idiomas: ['N/A - Adult Content'],
                                descritores_de_conteúdo: ['Adult Content - Login Required'],
                                nsfw_detected: true,
                                redirect_url: finalUrl
                            }, 
                            processed_at: new Date().toISOString(), 
                            api_version: '6.0-conservative-nsfw-detection',
                            nsfw_auto_categorized: true
                        },
                        extractionFailed: false,
                        nsfwDetected: true
                    };
                }
                
                // Carrega HTML com Cheerio
                let $ = cheerio.load(pageResponse.data);

                // Verificação de página de confirmação de idade
                const pageTitle = $('title').text();
                const hasAgeCheck = pageTitle.includes('Age Check') || 
                                  $('form[action*="agecheckset"]').length > 0 ||
                                  $('input[name="ageDay"]').length > 0 ||
                                  $('.agegate').length > 0;

                if (hasAgeCheck) {
                    console.log(`🔞 Detectada verificação de idade para Bundle ${bundleId}, processando...`);
                    await this.appendToLog(`AGE VERIFICATION: Bundle ID ${bundleId} requer confirmação de idade`);
                    
                    try {
                        const retryResponse = await this.handleAgeVerification(bundlePageUrl, browserHeaders);
                        $ = cheerio.load(retryResponse.data);
                        console.log(`✅ Verificação de idade processada para Bundle ${bundleId}`);
                    } catch (ageError) {
                        console.log(`❌ Falha na verificação de idade para Bundle ${bundleId}: ${ageError.message}`);
                        await this.appendToLog(`AGE VERIFICATION FAILED: Bundle ID ${bundleId} - ${ageError.message}`);
                        return { success: false, reason: 'AGE_VERIFICATION_FAILED' };
                    }
                }

                // Validação de página: Verifica se a página recebida é a correta
                if (!pageTitle.includes(bundleData.name.substring(0, 10))) {
                    await this.appendToLog(`AVISO DE VALIDAÇÃO: Título da página inválido para o Bundle ID ${bundleId} (Link: ${bundlePageUrl}). Provavelmente é uma página de erro/captcha.`);
                    return { success: false, reason: 'INVALID_PAGE' };
                }

                // Extrai detalhes da página
                const pageDetails = await this._extractPageDetails($, bundleData);
                
                // --- LÓGICA DE FALLBACK ---
                if (pageDetails.gênero.length === 0 && bundleData.appids && bundleData.appids.length > 0) {
                    console.log(`⚠️  Scraping falhou para ${bundleData.name}. Ativando fallback via API de Apps...`);
                    await this.appendToLog(`INFO: Ativando fallback para o Bundle ID ${bundleId} (Link: ${bundlePageUrl}).`);
                    
                    const fallbackDetails = await this.getDetailsFromApps(bundleData.appids);
                    pageDetails.gênero = fallbackDetails.genres;
                    pageDetails.categoria = fallbackDetails.categories;
                    pageDetails.desenvolvedor = fallbackDetails.developers;
                }

                const extractionSuccess = pageDetails.gênero && pageDetails.gênero.length > 0;
                if (!extractionSuccess) {
                    await this.appendToLog(`EXTRACTION FAILED: Bundle ID ${bundleId} - Nenhum gênero encontrado mesmo com fallback`);
                } else {
                    await this.appendToLog(`SUCCESS: Bundle ID ${bundleId} processado com sucesso (${pageDetails.gênero.length} gêneros)`);
                }
                
                return {
                    success: true,
                    data: { 
                        ...bundleData, 
                        page_details: pageDetails, 
                        processed_at: new Date().toISOString(), 
                        api_version: '6.0-modular-scraping' 
                    },
                    extractionFailed: !extractionSuccess
                };

            } catch (error) {
                const statusCode = error.response?.status;
                
                // --- DETECÇÃO DE PÁGINAS NÃO ENCONTRADAS ---
                if (statusCode === 404 || statusCode === 410) {
                    await this.appendToLog(`NOT FOUND: Bundle ID ${bundleId} (Link: ${bundlePageUrl}). Status: ${statusCode}. Bundle não existe mais.`);
                    return { success: false, reason: 'BUNDLE_NOT_FOUND', statusCode };
                }
                
                await this.appendToLog(`ERRO: Tentativa ${attempt} para o Bundle ID ${bundleId} (Link: ${bundlePageUrl}). Status: ${statusCode || 'desconhecido'}. Erro: ${error.message}`);
                
                if (attempt === STEAM_API_CONFIG.MAX_RETRIES) {
                    return { success: false, reason: 'MAX_RETRIES_REACHED', error: error.message };
                }
                await this.delay(5000 * attempt); // Aumenta a espera entre retentativas se houver erro
            }
        }
        return { success: false, reason: 'UNKNOWN_FAILURE' };
    }

    /**
     * Extrai detalhes específicos da página HTML
     */
    async _extractPageDetails($, bundleData) {
        const pageDetails = {};

        // Função auxiliar para encontrar valores por label
        const findValuesForLabel = (label) => {
            const values = new Set();
            const labelElement = $(`.details_block b:contains("${label}")`);
            labelElement.next('span').find('a').each((_, el) => {
                const text = $(el).text().trim();
                if (text) values.add(text);
            });
            if (values.size === 0) {
                labelElement.next('a').each((_, el) => {
                    const text = $(el).text().trim();
                    if (text) values.add(text);
                });
            }
            return Array.from(values);
        };

        // Extrai gêneros normalmente
        pageDetails.gênero = findValuesForLabel('Gênero:');
        pageDetails.desenvolvedor = findValuesForLabel('Desenvolvedor:');
        pageDetails.distribuidora = findValuesForLabel('Distribuidora:');
        pageDetails.série = findValuesForLabel('Série:');

        // Lógica para idiomas
        const languagesText = $('.language_list').text();
        if (languagesText) {
            const cleanText = languagesText.replace(/Idiomas:/i, '').split('Os idiomas listados')[0];
            pageDetails.idiomas = cleanText.split(',').map(lang => lang.trim()).filter(Boolean);
        }

        // ===== NOVO: Extração detalhada de categorias (vetor) =====
        // Busca por blocos de categorias (exemplo: gêneros em <span> com vários <a>)
        const categorias = [];
        $('.details_block b:contains("Gênero:")').next('span').find('a').each((_, el) => {
            const cat = $(el).text().trim();
            if (cat) categorias.push(cat);
        });
        // Fallback: se não encontrar, tenta pegar <a> direto após o <b>
        if (categorias.length === 0) {
            $('.details_block b:contains("Gênero:")').next('a').each((_, el) => {
                const cat = $(el).text().trim();
                if (cat) categorias.push(cat);
            });
        }
        pageDetails.categorias = categorias;


        // ===== NOVO: Extração e formatação de preço BRL e preço formatado =====
        let preco = $('.discount_final_price').first().text().trim();
        if (!preco) {
            preco = $('.bundle_final_price').first().text().trim();
        }
        if (!preco) {
            preco = $('.game_purchase_price').first().text().trim();
        }
        // Normaliza para BRL (remove símbolos, converte vírgula para ponto, extrai número)
        let precoBRL = null;
        let precoFormatado = null;
        if (preco) {
            // Remove "R$", espaços, NBSP, etc.
            precoBRL = preco.replace(/[^\d,\.]/g, '').replace(',', '.');
            // Pega apenas o número (caso haja mais de um)
            const match = precoBRL.match(/\d+(\.\d{2})?/);
            precoBRL = match ? parseFloat(match[0]) : null;
            // Preço formatado para frontend (mantém R$ e formatação original)
            precoFormatado = preco;
        }
        pageDetails.preco = precoBRL;
        pageDetails.formatted_price = precoFormatado;

        // Para imagens (se vierem do bundleData ou do HTML, ou tenta extrair do HTML)
        let headerImage = bundleData.header_image_url || null;
        let capsuleImage = bundleData.main_capsule || null;
        // Tenta extrair do HTML se não vier do bundleData
        if (!headerImage) {
            const img = $(".bundle_header_image, .bundle_header img").first().attr("src");
            if (img) headerImage = img;
        }
        if (!capsuleImage) {
            const img = $(".bundle_capsule_image, .bundle_capsule img").first().attr("src");
            if (img) capsuleImage = img;
        }
        pageDetails.header_image = headerImage;
        pageDetails.capsule_image = capsuleImage;

        // Porcentagem de desconto
        let desconto = $('.discount_pct').first().text().trim();
        if (!desconto) {
            desconto = $('.bundle_base_discount').first().text().trim();
        }
        // Normaliza para número inteiro (ex: -80% => 80)
        let descontoNum = null;
        if (desconto) {
            const match = desconto.match(/-?(\d+)%?/);
            descontoNum = match ? parseInt(match[1]) : null;
        }
        pageDetails.desconto = descontoNum;

        return pageDetails;
    }

    /**
     * Função específica para retry com configurações conservadoras
     */
    async retryFailedBundle(bundleId, language = 'brazilian') {
        const bundleApiUrl = `https://store.steampowered.com/actions/ajaxresolvebundles?bundleids=${bundleId}&cc=BR&l=${language}`;
        const bundlePageUrl = `https://store.steampowered.com/bundle/${bundleId}/`;

        const conservativeHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        };

        for (let attempt = 1; attempt <= 2; attempt++) { // Máximo 2 tentativas para retry
            try {
                console.log(`🔄 RETRY [${attempt}/2] Bundle ${bundleId}...`);
                
                // Delay mais longo para retry
                if (attempt > 1) {
                    await this.delay(8000); // 8 segundos entre tentativas de retry
                }
                
                const apiResponse = await axios.get(bundleApiUrl, { 
                    headers: conservativeHeaders,
                    timeout: 30000 // 30s timeout para retry
                });
                
                if (!apiResponse.data || !apiResponse.data[0]) {
                    return { success: false, reason: 'RETRY_API_NO_DATA' };
                }
                
                const bundleData = apiResponse.data[0];

                // Delay muito conservador entre requisições
                await this.delay(3000 + Math.random() * 2000); 

                const pageResponse = await axios.get(bundlePageUrl, { 
                    headers: conservativeHeaders, 
                    timeout: 30000 
                });

                // Processa página similar ao método principal
                const $ = cheerio.load(pageResponse.data);
                const pageDetails = await this._extractPageDetails($, bundleData);

                // Fallback se necessário
                if (pageDetails.gênero.length === 0 && bundleData.appids && bundleData.appids.length > 0) {
                    const fallbackDetails = await this.getDetailsFromApps(bundleData.appids);
                    pageDetails.gênero = fallbackDetails.genres;
                    pageDetails.categoria = fallbackDetails.categories;
                    pageDetails.desenvolvedor = fallbackDetails.developers;
                }

                const extractionSuccess = pageDetails.gênero && pageDetails.gênero.length > 0;
                
                return {
                    success: extractionSuccess,
                    data: { 
                        ...bundleData, 
                        page_details: pageDetails, 
                        processed_at: new Date().toISOString(), 
                        api_version: '6.0-retry-conservative' 
                    },
                    extractionFailed: !extractionSuccess,
                    isRetry: true
                };

            } catch (error) {
                console.log(`❌ RETRY falhou [${attempt}/2]: ${error.message}`);
                if (attempt === 2) {
                    return { success: false, reason: 'RETRY_FAILED', error: error.message };
                }
            }
        }
        
        return { success: false, reason: 'RETRY_FAILED' };
    }
}

module.exports = {
    BundleScrapingService,
    STEAM_API_CONFIG
};
