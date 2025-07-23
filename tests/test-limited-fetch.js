// test-limited-fetch.js - Teste limitado de fetch para validação
require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const { storageSyncManager } = require('./services/storageSync');

async function testLimitedFetch() {
    console.log('🧪 Testando fetch limitado (3 páginas) + sincronização...\n');
    
    try {
        console.log('🔧 Validando configuração do storage...');
        storageSyncManager.validateConfig();
        
        const connectivity = await storageSyncManager.testConnection();
        if (!connectivity.success) {
            throw new Error(`Falha na conectividade: ${connectivity.error}`);
        }
        console.log('✅ Storage OK\n');
        
        console.log('🔍 Coletando bundles de 3 páginas...');
        let bundles = [];
        
        for (let page = 1; page <= 3; page++) {
            console.log(`📄 Processando página ${page}...`);
            
            const url = `https://store.steampowered.com/search/?term=bundle&ignore_preferences=1&hidef2p=1&ndl=1&page=${page}`;
            const { data } = await axios.get(url, {
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
            
            const $ = cheerio.load(data);
            const bundleElements = $('a[href*="/bundle/"]');
            
            bundleElements.each((_, el) => {
                const title = $(el).find('.title').text().trim();
                const link = $(el).attr('href');
                if (title && link.includes('/bundle/')) {
                    bundles.push({ Nome: title, Link: link });
                }
            });
            
            console.log(`   → ${bundleElements.length} bundles encontrados`);
            
            // Delay entre páginas
            if (page < 3) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        console.log(`\n📊 Total coletado: ${bundles.length} bundles`);
        
        // Remover duplicatas
        const uniqueBundles = Array.from(new Map(bundles.map(bundle => [bundle.Link, bundle])).values());
        console.log(`🧹 Após deduplicação: ${uniqueBundles.length} bundles únicos`);
        
        // Sincronizar com storage
        console.log('\n🔄 Sincronizando com storage backend...');
        await storageSyncManager.syncBasicBundles(uniqueBundles);
        console.log('✅ Sincronização concluída!');
        
        console.log('\n🎉 Teste limitado bem-sucedido!');
        console.log(`📈 ${uniqueBundles.length} bundles foram salvos na primeira tabela do storage`);
        
    } catch (error) {
        console.error('\n❌ Erro durante o teste:');
        console.error(`🔍 Mensagem: ${error.message}`);
        console.error(`📋 Stack: ${error.stack}`);
        process.exit(1);
    }
}

// Executar teste
testLimitedFetch();
