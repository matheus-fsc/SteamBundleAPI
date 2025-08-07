/**
 * Script de teste para verificar melhorias de preços e descontos em BRL
 * Testa um bundle específico para verificar a extração correta
 */

const { BundleScrapingService } = require('../services/updateDetails/BundleScrapingService');
const BundleDataMapper = require('../services/updateDetails/BundleDataMapper');

async function testBRLPricing() {
    console.log('🧪 TESTE DE PREÇOS EM BRL E DESCONTOS');
    console.log('='.repeat(50));

    const scrapingService = new BundleScrapingService();
    const dataMapper = new BundleDataMapper();

    // Testar alguns bundles que sabemos ter descontos
    const testBundles = [
        51139, // KARMA Bundle (15% desconto no arquivo)
        40412, // AMEDAMA Bundle (10% desconto)
        41755, // Retrowave Bundle (50% desconto)
        46811  // No Serious Bundle (21% desconto)
    ];

    for (const bundleId of testBundles) {
        console.log(`\n🔍 Testando Bundle ID: ${bundleId}`);
        console.log('-'.repeat(30));

        try {
            // Testar em português brasileiro
            const result = await scrapingService.fetchBundleDetails(bundleId, 'portuguese');
            
            if (result.success) {
                const chunkData = result.data;
                console.log('✅ Dados extraídos com sucesso!');
                
                // Verificar preços
                const pageDetails = chunkData.page_details || {};
                console.log(`💰 Preços encontrados:`);
                console.log(`   Preço atual: ${pageDetails.preco || 'N/A'} (${pageDetails.formatted_price || 'N/A'})`);
                console.log(`   Preço original: ${pageDetails.preco_original || 'N/A'} (${pageDetails.formatted_original_price || 'N/A'})`);
                console.log(`   Desconto: ${pageDetails.desconto || 0}%`);
                
                // Testar mapeamento
                const mappedData = dataMapper.mapChunkDataToBundle(chunkData);
                if (mappedData) {
                    console.log(`🗂️ Dados mapeados:`);
                    console.log(`   Currency: ${mappedData.currency}`);
                    console.log(`   Final Price: ${mappedData.price}`);
                    console.log(`   Original Price: ${mappedData.original_price}`);
                    console.log(`   Discount %: ${mappedData.discount_percent}%`);
                    console.log(`   Formatted Price: ${mappedData.formatted_price}`);
                    console.log(`   Formatted Original: ${mappedData.formatted_orig_price}`);
                }
                
                // Verificar outros campos importantes
                console.log(`📊 Outros dados:`);
                console.log(`   Gêneros: ${pageDetails.gênero?.length || 0}`);
                console.log(`   Categorias: ${pageDetails.categorias?.length || 0}`);
                console.log(`   Desenvolvedores: ${pageDetails.desenvolvedor?.length || 0}`);
                console.log(`   Idiomas: ${pageDetails.idiomas?.length || 0}`);
                
            } else {
                console.log(`❌ Erro: ${result.reason}`);
            }
            
        } catch (error) {
            console.error(`❌ Erro no teste: ${error.message}`);
        }
        
        // Pequena pausa entre testes
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    console.log('\n✅ Teste de preços BRL concluído!');
}

// Executar teste
if (require.main === module) {
    testBRLPricing().catch(console.error);
}

module.exports = { testBRLPricing };
