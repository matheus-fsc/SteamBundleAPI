const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');

/**
 * Serviço de Scraping de Bundles Steam
 * Responsável por extrair dados de bundles da Steam Store
 */

// --- CONFIGURAÇÕES DE SCRAPING MELHORADAS ---
const STEAM_API_CONFIG = {
    DELAY_BETWEEN_REQUESTS: parseInt(process.env.STEAM_API_DELAY) || (process.env.NODE_ENV === 'production' ? 1000 : 750), // 1s para Render
    REQUEST_TIMEOUT: parseInt(process.env.REQUEST_TIMEOUT) || (process.env.NODE_ENV === 'production' ? 30000 : 25000), // 30s para Render
    MAX_RETRIES: parseInt(process.env.MAX_RETRIES) || (process.env.NODE_ENV === 'production' ? 2 : 3), // Menos retries no Render
    PARALLEL_BUNDLES: 2, // Reduzido de 3 para 2 para maior estabilidade
    STEAM_APP_DELAY: process.env.NODE_ENV === 'production' ? 1000 : 800, // 1s para Render
    CONSERVATIVE_MODE: process.env.CONSERVATIVE_SCRAPING === 'true' || (process.env.NODE_ENV === 'production'), // Ativa no Render
    
    // Configurações específicas para diferentes cenários
    RETRY_DELAY_MULTIPLIER: 2, // Multiplica delay entre retries
    AGE_GATE_DELAY: 3000, // 3s após confirmar idade
    NSFW_DETECTION_TIMEOUT: process.env.NODE_ENV === 'production' ? 20000 : 15000, // 20s para Render
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
     * Busca detalhes via API de apps quando o scraping falha (fallback) - MELHORADO
     */
    async getDetailsFromApps(appIds) {
        console.log(`🔍 getDetailsFromApps iniciado com ${appIds.length} apps: ${appIds.join(', ')}`);
        
        if (!appIds || appIds.length === 0) {
            console.log(`❌ Nenhum appId fornecido`);
            return { genres: [], categories: [], developers: [], description: null };
        }

        const allGenres = new Set();
        const allCategories = new Set();
        const allDevelopers = new Set();
        let bestDescription = null;
        
        // Limita e processa em lotes menores para evitar erro 400
        const appIdsToProcess = appIds.slice(0, 15); // Reduzido ainda mais
        const batchSize = 3; // Processa apenas 3 apps por vez

        try {
            for (let i = 0; i < appIdsToProcess.length; i += batchSize) {
                const batch = appIdsToProcess.slice(i, i + batchSize);
                
                // Processa apps individuais para máxima robustez
                for (const appId of batch) {
                    try {
                        console.log(`🌐 Fazendo requisição para App ${appId}...`);
                        // Headers mais realistas
                        const response = await axios.get(
                            `https://store.steampowered.com/api/appdetails?appids=${appId}`,
                            { 
                                timeout: 12000,
                                headers: {
                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                                    'Accept': 'application/json,text/plain,*/*',
                                    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
                                }
                            }
                        );
                        
                        console.log(`📊 Resposta recebida para App ${appId}. Status: ${response.status}`);
                        const appData = response.data;
                        const details = appData[appId];
                        
                        if (details && details.success && details.data) {
                            const data = details.data;
                            console.log(`✅ App ${appId} encontrado: ${data.name}`);
                            console.log(`   Gêneros: ${data.genres?.length || 0}, Categorias: ${data.categories?.length || 0}, Devs: ${data.developers?.length || 0}`);
                            
                            // Extrai gêneros
                            data.genres?.forEach(g => {
                                if (g.description) allGenres.add(g.description);
                            });
                            
                            // Extrai categorias 
                            data.categories?.forEach(c => {
                                if (c.description) allCategories.add(c.description);
                            });
                            
                            // Extrai desenvolvedores
                            data.developers?.forEach(d => {
                                if (typeof d === 'string') allDevelopers.add(d);
                            });
                            
                            // Captura a melhor descrição disponível
                            if (!bestDescription && data.short_description && data.short_description.length > 20) {
                                bestDescription = data.short_description.substring(0, 300);
                            } else if (!bestDescription && data.detailed_description) {
                                // Remove HTML tags da descrição detalhada
                                const cleanDescription = data.detailed_description
                                    .replace(/<[^>]*>/g, '')
                                    .replace(/&[^;]+;/g, '')
                                    .trim();
                                if (cleanDescription.length > 20) {
                                    bestDescription = cleanDescription.substring(0, 300);
                                }
                            }
                            
                            await this.appendToLog(`FALLBACK SUCCESS: App ${appId} - ${data.name} (${allGenres.size} gêneros, ${allCategories.size} categorias)`);
                        }
                        
                        await this.delay(800); // Delay maior entre requisições individuais
                        
                    } catch (singleError) {
                        const status = singleError.response?.status;
                        console.log(`❌ App ${appId} falhou: ${singleError.message} (Status: ${status || 'N/A'})`);
                        // Log apenas erros não comuns
                        if (status !== 400 && status !== 404 && status !== 429) {
                            await this.appendToLog(`FALLBACK WARNING: App ${appId} falhou (${status || 'timeout'})`);
                        }
                    }
                }
                
                // Pausa maior entre lotes
                if (i + batchSize < appIdsToProcess.length) {
                    await this.delay(1200);
                }
            }

        } catch (error) {
            await this.appendToLog(`ERRO FALLBACK GERAL: ${error.message}`);
        }

        const result = {
            genres: Array.from(allGenres),
            categories: Array.from(allCategories),
            developers: Array.from(allDevelopers),
            description: bestDescription
        };

        // Log do resultado do fallback
        const totalItems = result.genres.length + result.categories.length + result.developers.length;
        if (totalItems > 0) {
            await this.appendToLog(`FALLBACK RESULT: ${result.genres.length} gêneros, ${result.categories.length} categorias, ${result.developers.length} devs, desc: ${bestDescription ? 'SIM' : 'NÃO'}`);
        }

        return result;
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
    async fetchBundleDetails(bundleId, language = 'portuguese') {
        console.log(`🔍 Iniciando fetchBundleDetails para Bundle ID: ${bundleId}, Language: ${language}`);
        const bundleApiUrl = `https://store.steampowered.com/actions/ajaxresolvebundles?bundleids=${bundleId}&cc=BR&l=${language}`;
        const bundlePageUrl = `https://store.steampowered.com/bundle/${bundleId}/`;

        const browserHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
        };

        for (let attempt = 1; attempt <= STEAM_API_CONFIG.MAX_RETRIES; attempt++) {
            try {
                console.log(`🌐 Fazendo requisição para API: ${bundleApiUrl}`);
                // Primeiro, busca dados básicos via API
                const apiResponse = await axios.get(bundleApiUrl, { 
                    headers: browserHeaders,
                    timeout: STEAM_API_CONFIG.REQUEST_TIMEOUT
                });
                
                console.log(`📊 Resposta da API recebida. Status: ${apiResponse.status}, Data type: ${typeof apiResponse.data}, Data: ${JSON.stringify(apiResponse.data).substring(0, 200)}...`);
                
                if (!apiResponse.data || !apiResponse.data[0]) {
                    console.log(`❌ API_NO_DATA: apiResponse.data = ${JSON.stringify(apiResponse.data)}`);
                    return { success: false, reason: 'API_NO_DATA' };
                }
                const bundleData = apiResponse.data[0];
                console.log(`✅ Bundle data obtido: ${bundleData.name || 'Sem nome'} (ID: ${bundleData.bundleid || bundleId})`);

                // Delay adaptativo baseado na tentativa e modo conservador
                const baseDelay = STEAM_API_CONFIG.CONSERVATIVE_MODE ? 4000 : 2500;
                const attemptMultiplier = attempt > 1 ? STEAM_API_CONFIG.RETRY_DELAY_MULTIPLIER : 1;
                const randomDelay = Math.random() * 2000; // 0-2s aleatório
                const totalDelay = (baseDelay + randomDelay) * attemptMultiplier;
                
                await this.delay(totalDelay);

                // Busca página para scraping
                const pageResponse = await axios.get(bundlePageUrl, { 
                    headers: browserHeaders, 
                    timeout: STEAM_API_CONFIG.REQUEST_TIMEOUT,
                    maxRedirects: 5 // Limita redirecionamentos
                });
                
                // 🆕 DETECÇÃO DE NSFW MELHORADA - Verifica múltiplos sinais
                const finalUrl = pageResponse.request?.res?.responseUrl || pageResponse.config.url;
                const responseText = pageResponse.data.toLowerCase();
                
                const isNSFWRedirect = finalUrl.includes('store.steampowered.com/login') && 
                                     (finalUrl.includes('agecheck') || finalUrl.includes('redir=agecheck'));
                
                const isNSFWContent = responseText.includes('mature content') || 
                                    responseText.includes('adult only') ||
                                    responseText.includes('this content is not available');
                
                if (isNSFWRedirect || isNSFWContent) {
                    console.log(`🔞 NSFW DETECTADO: Bundle ${bundleId} - ${isNSFWRedirect ? 'Redirecionado' : 'Conteúdo adulto detectado'}`);
                    await this.appendToLog(`NSFW DETECTED: Bundle ID ${bundleId} - ${finalUrl} | Content signals: ${isNSFWContent}`);
                    
                    // Retorna bundle com categorização NSFW melhorada
                    return {
                        success: true,
                        data: { 
                            ...bundleData, 
                            page_details: {
                                gênero: ['NSFW', 'Adult Content'],
                                categorias: ['Adult Only', 'Mature Content'],
                                categoria: ['Adult Only'],
                                desenvolvedor: ['N/A - Adult Content'],
                                distribuidora: ['N/A - Adult Content'],
                                idiomas: ['N/A - Adult Content'],
                                descritores_de_conteúdo: ['Adult Content - Access Restricted'],
                                nsfw_detected: true,
                                redirect_url: finalUrl,
                                description: 'This content is restricted to adult users only.',
                                formatted_price: bundleData.final_price ? `R$ ${(bundleData.final_price / 100).toFixed(2)}` : null,
                                preco: bundleData.final_price ? bundleData.final_price / 100 : null
                            }, 
                            processed_at: new Date().toISOString(), 
                            api_version: '6.1-enhanced-nsfw-detection',
                            nsfw_auto_categorized: true
                        },
                        extractionFailed: false,
                        nsfwDetected: true
                    };
                }
                
                // Carrega HTML com Cheerio
                let $ = cheerio.load(pageResponse.data);

                // Verificação de página de confirmação de idade MELHORADA
                const pageTitle = $('title').text().toLowerCase();
                const hasAgeCheck = pageTitle.includes('age check') || 
                                  pageTitle.includes('age verification') ||
                                  $('form[action*="agecheckset"]').length > 0 ||
                                  $('input[name="ageDay"]').length > 0 ||
                                  $('.agegate').length > 0 ||
                                  responseText.includes('please enter your birth date');

                if (hasAgeCheck) {
                    console.log(`🔞 Detectada verificação de idade para Bundle ${bundleId}, processando...`);
                    await this.appendToLog(`AGE VERIFICATION: Bundle ID ${bundleId} requer confirmação de idade`);
                    
                    try {
                        const retryResponse = await this.handleAgeVerification(bundlePageUrl, browserHeaders);
                        $ = cheerio.load(retryResponse.data);
                        console.log(`✅ Verificação de idade processada para Bundle ${bundleId}`);
                        
                        // Delay adicional após verificação de idade
                        await this.delay(STEAM_API_CONFIG.AGE_GATE_DELAY);
                    } catch (ageError) {
                        console.log(`❌ Falha na verificação de idade para Bundle ${bundleId}: ${ageError.message}`);
                        await this.appendToLog(`AGE VERIFICATION FAILED: Bundle ID ${bundleId} - ${ageError.message}`);
                        return { success: false, reason: 'AGE_VERIFICATION_FAILED' };
                    }
                }

                // Validação de página MELHORADA
                const titleValid = pageTitle.includes(bundleData.name.substring(0, Math.min(15, bundleData.name.length)).toLowerCase());
                const hasValidContent = $('.bundle_header').length > 0 || 
                                      $('.game_area_purchase').length > 0 ||
                                      $('.bundle_contents').length > 0;
                
                if (!titleValid && !hasValidContent) {
                    await this.appendToLog(`INVALID PAGE: Bundle ID ${bundleId} - Título: "${pageTitle}" | Valid content: ${hasValidContent}`);
                    if (attempt < STEAM_API_CONFIG.MAX_RETRIES) {
                        console.log(`⚠️  Página inválida detectada, tentando novamente em ${attempt * 2}s...`);
                        await this.delay(attempt * 2000);
                        continue;
                    }
                    return { success: false, reason: 'INVALID_PAGE_CONTENT' };
                }

                // Extrai detalhes da página
                console.log(`🔍 Extraindo detalhes da página para Bundle ${bundleData.name}...`);
                const pageDetails = await this._extractPageDetails($, bundleData);
                console.log(`📊 Page details extraídos: gêneros=${pageDetails.gênero?.length || 0}, descrição=${!!pageDetails.description}, preço=${!!pageDetails.formatted_price}`);
                
                // --- LÓGICA DE FALLBACK MELHORADA ---
                const needsFallback = (
                    (!pageDetails.gênero || pageDetails.gênero.length === 0) ||
                    (!pageDetails.description) ||
                    (!pageDetails.formatted_price && !pageDetails.preco)
                );
                
                if (needsFallback && bundleData.appids && bundleData.appids.length > 0) {
                    console.log(`⚠️  Bundle ${bundleData.name} precisa de fallback - ativando API de Apps...`);
                    console.log(`🔍 Apps para fallback: ${bundleData.appids.join(', ')}`);
                    await this.appendToLog(`FALLBACK TRIGGERED: Bundle ID ${bundleId} - Gêneros: ${pageDetails.gênero?.length || 0}, Desc: ${!!pageDetails.description}, Preço: ${!!pageDetails.formatted_price}`);
                    
                    const fallbackDetails = await this.getDetailsFromApps(bundleData.appids);
                    console.log(`📊 Fallback obtido: gêneros=${fallbackDetails.genres?.length || 0}, categorias=${fallbackDetails.categories?.length || 0}, devs=${fallbackDetails.developers?.length || 0}`);
                    
                    // Aplica dados do fallback apenas onde necessário
                    if (!pageDetails.gênero || pageDetails.gênero.length === 0) {
                        pageDetails.gênero = fallbackDetails.genres;
                        pageDetails.categorias = [...(pageDetails.categorias || []), ...fallbackDetails.categories];
                        console.log(`✅ Fallback aplicado: ${fallbackDetails.genres?.length || 0} gêneros, ${fallbackDetails.categories?.length || 0} categorias`);
                    }
                    
                    if (!pageDetails.desenvolvedor || pageDetails.desenvolvedor.length === 0) {
                        pageDetails.desenvolvedor = fallbackDetails.developers;
                    }
                    
                    if (!pageDetails.description && fallbackDetails.description) {
                        pageDetails.description = fallbackDetails.description;
                    }
                    
                    // Remove duplicatas das categorias
                    if (pageDetails.categorias) {
                        pageDetails.categorias = [...new Set(pageDetails.categorias)];
                    }
                }

                const extractionSuccess = pageDetails.gênero && pageDetails.gênero.length > 0;
                if (!extractionSuccess) {
                    await this.appendToLog(`EXTRACTION STILL FAILED: Bundle ID ${bundleId} - Nenhum gênero encontrado mesmo com fallback. Apps disponíveis: ${bundleData.appids?.length || 0}`);
                } else {
                    await this.appendToLog(`EXTRACTION SUCCESS: Bundle ID ${bundleId} - ${pageDetails.gênero.length} gêneros, desc: ${!!pageDetails.description}, preço: ${!!pageDetails.formatted_price}`);
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
                const errorMessage = error.message || 'Unknown error';
                
                // --- DETECÇÃO MELHORADA DE TIPOS DE ERRO ---
                if (statusCode === 404 || statusCode === 410) {
                    await this.appendToLog(`NOT FOUND: Bundle ID ${bundleId} - Status ${statusCode} - Bundle não existe mais`);
                    return { success: false, reason: 'BUNDLE_NOT_FOUND', statusCode };
                }
                
                if (statusCode === 429) {
                    await this.appendToLog(`RATE LIMITED: Bundle ID ${bundleId} - Aguardando mais tempo antes da próxima tentativa`);
                    const rateLimitDelay = attempt * 10000; // 10s, 20s, 30s
                    await this.delay(rateLimitDelay);
                    continue;
                }
                
                if (statusCode === 503 || statusCode === 502) {
                    await this.appendToLog(`SERVER ERROR: Bundle ID ${bundleId} - Status ${statusCode} - Tentativa ${attempt}/${STEAM_API_CONFIG.MAX_RETRIES}`);
                    if (attempt < STEAM_API_CONFIG.MAX_RETRIES) {
                        await this.delay(attempt * 5000); // Delay progressivo para erros de servidor
                        continue;
                    }
                }
                
                if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
                    await this.appendToLog(`CONNECTION ERROR: Bundle ID ${bundleId} - ${error.code} - Tentativa ${attempt}/${STEAM_API_CONFIG.MAX_RETRIES}`);
                    if (attempt < STEAM_API_CONFIG.MAX_RETRIES) {
                        await this.delay(attempt * 3000); // Delay para problemas de conexão
                        continue;
                    }
                }
                
                await this.appendToLog(`GENERAL ERROR: Bundle ID ${bundleId} - Tentativa ${attempt}/${STEAM_API_CONFIG.MAX_RETRIES} - ${errorMessage} (Status: ${statusCode || 'N/A'})`);
                
                if (attempt === STEAM_API_CONFIG.MAX_RETRIES) {
                    return { 
                        success: false, 
                        reason: 'MAX_RETRIES_REACHED', 
                        error: errorMessage,
                        statusCode,
                        finalAttempt: true
                    };
                }
                
                // Delay progressivo entre retries
                const retryDelay = STEAM_API_CONFIG.DELAY_BETWEEN_REQUESTS * attempt * STEAM_API_CONFIG.RETRY_DELAY_MULTIPLIER;
                await this.delay(retryDelay);
            }
        }
        return { success: false, reason: 'UNKNOWN_FAILURE' };
    }

    /**
     * Extrai detalhes específicos da página HTML - VERSÃO MELHORADA
     */
    async _extractPageDetails($, bundleData) {
        const pageDetails = {};

        // === FUNÇÃO AUXILIAR MELHORADA PARA LABELS ===
        const findValuesForLabel = (label) => {
            const values = new Set();
            
            // Tenta múltiplos seletores para diferentes layouts da Steam
            const selectors = [
                `.details_block b:contains("${label}")`,
                `.game_details b:contains("${label}")`,
                `.block_content b:contains("${label}")`,
                `dt:contains("${label}")`
            ];
            
            for (const selector of selectors) {
                const labelElement = $(selector);
                if (labelElement.length > 0) {
                    // Busca em span seguinte
                    labelElement.next('span').find('a').each((_, el) => {
                        const text = $(el).text().trim();
                        if (text) values.add(text);
                    });
                    
                    // Busca em links diretos
                    labelElement.next('a').each((_, el) => {
                        const text = $(el).text().trim();
                        if (text) values.add(text);
                    });
                    
                    // Para dt/dd pares
                    if (selector.includes('dt')) {
                        labelElement.next('dd').find('a').each((_, el) => {
                            const text = $(el).text().trim();
                            if (text) values.add(text);
                        });
                    }
                    
                    if (values.size > 0) break; // Para no primeiro seletor que funcionar
                }
            }
            
            return Array.from(values);
        };

        // === EXTRAÇÃO BÁSICA DE METADADOS ===
        pageDetails.gênero = findValuesForLabel('Gênero:');
        pageDetails.desenvolvedor = findValuesForLabel('Desenvolvedor:');
        pageDetails.distribuidora = findValuesForLabel('Distribuidora:');
        pageDetails.série = findValuesForLabel('Série:');

        // === EXTRAÇÃO MELHORADA DE CATEGORIAS/TAGS ===
        const categorias = new Set();
        
        // Método 1: Via gêneros (padrão Steam)
        pageDetails.gênero.forEach(g => categorias.add(g));
        
        // Método 2: Tags populares da Steam (se existirem)
        $('.popular_tags a, .glance_tags a, .app_tag').each((_, el) => {
            const tag = $(el).text().trim();
            if (tag && tag.length > 1) categorias.add(tag);
        });
        
        // Método 3: Categorias em diferentes layouts
        $('.game_area_details_specs .game_area_details_specs_ctn a').each((_, el) => {
            const cat = $(el).text().trim();
            if (cat) categorias.add(cat);
        });
        
        pageDetails.categorias = Array.from(categorias);

        // === EXTRAÇÃO MELHORADA DE DESCRIÇÃO ===
        let descricao = null;
        
        // Tenta múltiplos seletores para descrição
        const descSelectors = [
            '.game_description_snippet',
            '.bundle_description',
            '.game_area_description',
            '.bundle_base_game_description',
            '.bundle_content_area .bundle_description',
            '.package_contents .tab_item_description'
        ];
        
        for (const selector of descSelectors) {
            const desc = $(selector).first().text().trim();
            if (desc && desc.length > 20) {
                descricao = desc.substring(0, 500); // Limita a 500 chars
                break;
            }
        }
        
        // Fallback: pega da API se não encontrou no HTML
        if (!descricao && bundleData.description) {
            descricao = bundleData.description;
        }
        
        pageDetails.description = descricao;

        // === EXTRAÇÃO MELHORADA DE IDIOMAS ===
        const idiomas = [];
        
        // Método 1: Lista de idiomas tradicional
        const languagesText = $('.language_list, .game_language_options').text();
        if (languagesText) {
            const cleanText = languagesText.replace(/Idiomas:/i, '').split('Os idiomas listados')[0];
            const langs = cleanText.split(',').map(lang => lang.trim()).filter(Boolean);
            idiomas.push(...langs);
        }
        
        // Método 2: Tabela de idiomas (layout mais novo)
        $('.game_language_options table tr').each((_, row) => {
            const lang = $(row).find('td:first-child').text().trim();
            if (lang && lang !== 'Idioma') {
                idiomas.push(lang);
            }
        });
        
        pageDetails.idiomas = [...new Set(idiomas)]; // Remove duplicatas

        // === EXTRAÇÃO MELHORADA DE PREÇOS COM DESCONTOS ===
        let preco = null;
        let precoOriginal = null;
        let precoFormatado = null;
        let precoOriginalFormatado = null;
        let percentualDesconto = 0;
        
        // Seletores melhorados para preços com desconto
        const priceSelectors = [
            '.discount_final_price',
            '.bundle_final_price', 
            '.game_purchase_price',
            '.discount_prices .discount_final_price',
            '.bundle_base_price .bundle_final_price',
            '.price_collection .price',
            '.game_area_purchase_game .game_purchase_price'
        ];

        // Seletores para preços originais (sem desconto)
        const originalPriceSelectors = [
            '.discount_original_price',
            '.bundle_original_price',
            '.discount_prices .discount_original_price',
            '.bundle_base_price .bundle_original_price'
        ];

        // Seletores para percentual de desconto
        const discountSelectors = [
            '.discount_percent',
            '.bundle_discount_percent',
            '.discount_pct'
        ];
        
        // Busca preço atual (com desconto se houver)
        for (const selector of priceSelectors) {
            const precoText = $(selector).first().text().trim();
            if (precoText && (precoText.includes('R$') || precoText.includes('$'))) {
                precoFormatado = precoText;
                
                // Extrai valor numérico
                const valorLimpo = precoText.replace(/[^\d,\.]/g, '').replace(',', '.');
                const match = valorLimpo.match(/\d+(\.\d{2})?/);
                if (match) {
                    preco = parseFloat(match[0]);
                }
                break;
            }
        }

        // Busca preço original (antes do desconto)
        for (const selector of originalPriceSelectors) {
            const precoOriginalText = $(selector).first().text().trim();
            if (precoOriginalText && (precoOriginalText.includes('R$') || precoOriginalText.includes('$'))) {
                precoOriginalFormatado = precoOriginalText;
                
                // Extrai valor numérico
                const valorLimpo = precoOriginalText.replace(/[^\d,\.]/g, '').replace(',', '.');
                const match = valorLimpo.match(/\d+(\.\d{2})?/);
                if (match) {
                    precoOriginal = parseFloat(match[0]);
                }
                break;
            }
        }

        // Busca percentual de desconto
        for (const selector of discountSelectors) {
            const descontoText = $(selector).first().text().trim();
            if (descontoText && descontoText.includes('%')) {
                const match = descontoText.match(/(\d+)%/);
                if (match) {
                    percentualDesconto = parseInt(match[1]);
                    break;
                }
            }
        }

        // Se não encontrou preço original mas tem desconto, calcula retroativamente
        if (!precoOriginal && preco && percentualDesconto > 0) {
            precoOriginal = preco / (1 - percentualDesconto / 100);
            precoOriginalFormatado = `R$ ${precoOriginal.toFixed(2)}`;
        }

        // Se encontrou preço original mas não o percentual, calcula
        if (precoOriginal && preco && percentualDesconto === 0) {
            percentualDesconto = Math.round(((precoOriginal - preco) / precoOriginal) * 100);
        }
        
        pageDetails.preco = preco;
        pageDetails.formatted_price = precoFormatado;
        pageDetails.preco_original = precoOriginal;
        pageDetails.formatted_original_price = precoOriginalFormatado;
        pageDetails.desconto = percentualDesconto;

        // === EXTRAÇÃO MELHORADA DE IMAGENS ===
        let headerImage = bundleData.header_image_url || null;
        let capsuleImage = bundleData.main_capsule || null;
        
        // Busca no HTML se não vier da API
        if (!headerImage) {
            const imgSelectors = [
                '.bundle_header_image img',
                '.bundle_header img',
                '.game_header_image_full img',
                '.bundle_page_image img',
                'img[src*="header"]',
                '.bundle_showcase img'
            ];
            
            for (const selector of imgSelectors) {
                const img = $(selector).first().attr('src');
                if (img && img.includes('steamstatic.com')) {
                    headerImage = img;
                    break;
                }
            }
        }
        
        if (!capsuleImage) {
            const imgSelectors = [
                '.bundle_capsule_image img',
                '.bundle_capsule img', 
                'img[src*="capsule"]',
                '.bundle_page_image img',
                '.game_header_image img'
            ];
            
            for (const selector of imgSelectors) {
                const img = $(selector).first().attr('src');
                if (img && img.includes('steamstatic.com')) {
                    capsuleImage = img;
                    break;
                }
            }
        }
        
        pageDetails.header_image = headerImage;
        pageDetails.capsule_image = capsuleImage;

        // === EXTRAÇÃO MELHORADA DE DESCONTO ===
        let descontoNum = null;
        
        const fallbackDiscountSelectors = [
            '.discount_pct',
            '.bundle_base_discount',
            '.discount_percent',
            '.game_purchase_discount_countdown .discount_pct'
        ];
        
        for (const selector of fallbackDiscountSelectors) {
            const desconto = $(selector).first().text().trim();
            if (desconto) {
                const match = desconto.match(/-?(\d+)%?/);
                if (match) {
                    descontoNum = parseInt(match[1]);
                    break;
                }
            }
        }
        
        pageDetails.desconto = descontoNum;

        // === LOG DE DEBUG PARA PROBLEMAS DE EXTRAÇÃO ===
        if (!pageDetails.gênero || pageDetails.gênero.length === 0) {
            await this.appendToLog(`DEBUG: Nenhum gênero encontrado. Título da página: ${$('title').text()}`);
        }
        
        if (!pageDetails.description) {
            await this.appendToLog(`DEBUG: Nenhuma descrição encontrada. Tentando seletores alternativos...`);
        }

        return pageDetails;
    }

    /**
     * Função específica para retry com configurações conservadoras
     */
    async retryFailedBundle(bundleId, language = 'portuguese') {
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
