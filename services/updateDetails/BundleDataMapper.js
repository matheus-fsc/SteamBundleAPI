/**
 * Mapeador de dados do chunk_data para estrutura de bundles detalhados
 * Transforma os dados brutos do scraping para o formato do banco de dados
 */

class BundleDataMapper {
    constructor() {
        this.apiVersion = "6.0-modular-scraping";
    }

    /**
     * Mapeia um bundle do formato chunk_data para o formato completo do banco
     * @param {Object} chunkData - Dados brutos do scraping
     * @returns {Object} Bundle mapeado para o banco
     */
    mapChunkDataToBundle(chunkData) {
        if (!chunkData) return null;

        try {
            const mapped = {
                // Dados básicos obrigatórios
                id: chunkData.id,
                name: chunkData.name,
                link: chunkData.link,
                steam_id: String(chunkData.steam_id || chunkData.bundleid || ''),
                
                // IDs e referências
                bundleid: chunkData.bundleid || null,
                appids: this._ensureArray(chunkData.appids),
                packageids: this._ensureArray(chunkData.packageids),
                
                // Preços (usar dados brasileiros melhorados)
                price: chunkData.page_details?.preco || (chunkData.final_price / 100) || 0,
                final_price: chunkData.final_price || 0,
                initial_price: chunkData.initial_price || 0,
                original_price: chunkData.page_details?.preco_original || chunkData.initial_price || 0,
                
                // Descontos (usar dados extraídos do scraping brasileiro)
                discount_percent: chunkData.page_details?.desconto || chunkData.discount_percent || 0,
                bundle_base_discount: chunkData.bundle_base_discount || 0,
                
                // Preços formatados (em BRL)
                formatted_price: chunkData.page_details?.formatted_price || chunkData.formatted_final_price || '',
                formatted_orig_price: chunkData.page_details?.formatted_original_price || chunkData.formatted_orig_price || '',
                formatted_final_price: chunkData.formatted_final_price || '',
                currency: 'BRL', // Dados agora em BRL devido a cc=BR
                
                // Descrições
                description: chunkData.page_details?.description || '',
                short_description: this._extractShortDescription(chunkData.page_details?.description),
                
                // Imagens
                header_image: chunkData.page_details?.header_image || chunkData.header_image_url || '',
                capsule_image: chunkData.page_details?.capsule_image || chunkData.main_capsule || '',
                main_capsule: chunkData.main_capsule || '',
                library_asset: chunkData.library_asset || '',
                header_image_url: chunkData.header_image_url || '',
                
                // Arrays de metadados (normalizados)
                tags: this._normalizeArray(chunkData.page_details?.categorias) || [],
                genres: this._normalizeArray(chunkData.page_details?.gênero) || [],
                categories: this._normalizeArray(chunkData.page_details?.categorias) || [],
                developer: this._normalizeArray(chunkData.page_details?.desenvolvedor) || [],
                publisher: this._normalizeArray(chunkData.page_details?.distribuidora) || [],
                supported_languages: this._normalizeArray(chunkData.page_details?.idiomas) || [],
                
                // Compatibilidade e disponibilidade
                available_windows: chunkData.available_windows !== false, // Default true
                available_mac: chunkData.available_mac || false,
                available_linux: chunkData.available_linux || false,
                support_vrhmd: chunkData.support_vrhmd || false,
                support_vrhmd_only: chunkData.support_vrhmd_only || false,
                deck_compatibility_category: chunkData.deck_compatibility_category || 0,
                
                // Estados e flags
                coming_soon: chunkData.coming_soon || false,
                no_main_cap: chunkData.no_main_cap || false,
                is_nsfw: this._detectNSFW(chunkData),
                
                // Metadados técnicos
                api_version: chunkData.api_version || this.apiVersion,
                processed_at: chunkData.processed_at || new Date().toISOString(),
                creator_clan_ids: this._ensureArray(chunkData.creator_clan_ids),
                localized_langs: this._ensureArray(chunkData.localized_langs),
                
                // Dados completos para backup
                page_details: chunkData.page_details || {},
                chunk_data: chunkData,
                
                // Campos de controle
                status: 'active',
                updated_at: new Date().toISOString(),
                synced_at: new Date().toISOString()
            };

            return mapped;
        } catch (error) {
            console.error('❌ Erro ao mapear chunk_data:', error);
            console.error('Dados problemáticos:', JSON.stringify(chunkData, null, 2));
            return null;
        }
    }

    /**
     * Mapeia um array de bundles em lote
     * @param {Array} bundlesChunkData - Array de dados brutos
     * @returns {Array} Array de bundles mapeados
     */
    mapBundlesBatch(bundlesChunkData) {
        if (!Array.isArray(bundlesChunkData)) {
            console.warn('❌ bundlesChunkData não é um array:', bundlesChunkData);
            return [];
        }

        const mapped = [];
        let errors = 0;

        for (const chunkData of bundlesChunkData) {
            const mappedBundle = this.mapChunkDataToBundle(chunkData);
            if (mappedBundle) {
                mapped.push(mappedBundle);
            } else {
                errors++;
            }
        }

        if (errors > 0) {
            console.warn(`⚠️ ${errors} bundles falharam no mapeamento de ${bundlesChunkData.length}`);
        }

        console.log(`✅ ${mapped.length} bundles mapeados com sucesso`);
        return mapped;
    }

    /**
     * Cria payload para API de sync com dados mapeados
     * @param {Array} bundles - Array de bundles mapeados
     * @param {Object} metadata - Metadados da sessão
     * @returns {Object} Payload para a API
     */
    createSyncPayload(bundles, metadata = {}) {
        return {
            bundles: bundles,
            metadata: {
                sessionId: metadata.sessionId,
                chunkNumber: metadata.chunkNumber || 1,
                isLastChunk: metadata.isLastChunk || false,
                timestamp: new Date().toISOString(),
                bundleCount: bundles.length
            }
        };
    }

    // === MÉTODOS AUXILIARES ===

    /**
     * Garante que um valor seja um array
     */
    _ensureArray(value) {
        if (Array.isArray(value)) return value;
        if (value === null || value === undefined) return [];
        return [value];
    }

    /**
     * Normaliza array removendo valores vazios e duplicatas
     */
    _normalizeArray(arr) {
        if (!Array.isArray(arr)) return [];
        return [...new Set(arr.filter(item => 
            item && typeof item === 'string' && item.trim().length > 0
        ))];
    }

    /**
     * Extrai descrição curta dos primeiros 200 caracteres
     */
    _extractShortDescription(description) {
        if (!description || typeof description !== 'string') return '';
        
        const clean = description.replace(/\s+/g, ' ').trim();
        if (clean.length <= 200) return clean;
        
        const truncated = clean.substring(0, 200);
        const lastSpace = truncated.lastIndexOf(' ');
        return lastSpace > 150 ? truncated.substring(0, lastSpace) + '...' : truncated + '...';
    }

    /**
     * Detecta conteúdo NSFW baseado em padrões conhecidos
     */
    _detectNSFW(chunkData) {
        const nsfwKeywords = [
            'adult', 'mature', 'hentai', 'nsfw', '18+', 'sexual', 'erotic',
            'porn', 'xxx', 'nude', 'naked', 'sex', 'cherry kiss'
        ];

        const textToCheck = [
            chunkData.name || '',
            chunkData.page_details?.description || '',
            ...(chunkData.page_details?.gênero || []),
            ...(chunkData.page_details?.categorias || [])
        ].join(' ').toLowerCase();

        return nsfwKeywords.some(keyword => textToCheck.includes(keyword));
    }

    /**
     * Validador de dados mapeados
     */
    validateMappedBundle(bundle) {
        const required = ['id', 'name', 'link', 'steam_id'];
        const missing = required.filter(field => !bundle[field]);
        
        if (missing.length > 0) {
            console.warn(`⚠️ Bundle ${bundle.id} tem campos obrigatórios faltando: ${missing.join(', ')}`);
            return false;
        }

        if (bundle.steam_id === '' || bundle.steam_id === 'undefined') {
            console.warn(`⚠️ Bundle ${bundle.id} tem steam_id inválido: '${bundle.steam_id}'`);
            return false;
        }

        return true;
    }

    /**
     * Estatísticas do mapeamento
     */
    getMapingStats(originalData, mappedData) {
        return {
            input_count: Array.isArray(originalData) ? originalData.length : 0,
            output_count: Array.isArray(mappedData) ? mappedData.length : 0,
            success_rate: Array.isArray(originalData) && originalData.length > 0 
                ? ((mappedData.length / originalData.length) * 100).toFixed(1) + '%'
                : '0%',
            with_images: mappedData.filter(b => b.header_image || b.capsule_image).length,
            with_descriptions: mappedData.filter(b => b.description && b.description.length > 0).length,
            with_prices: mappedData.filter(b => b.price > 0 || b.final_price > 0).length,
            on_sale: mappedData.filter(b => b.discount_percent > 0).length,
            nsfw_detected: mappedData.filter(b => b.is_nsfw).length
        };
    }
}

module.exports = BundleDataMapper;
