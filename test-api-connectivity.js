const axios = require('axios');
async function testSteamAPIConnectivity() {
    console.log('🔍 Testando conectividade com a API Steam...\n');
    
    const testBundleId = '28188'; // Uma das que apareceu no log como não encontrada
    const testBundleId2 = '5183'; // Bundle mais antiga que deveria existir
    
    const url1 = `https://store.steampowered.com/actions/ajaxresolvebundles?bundleids=${testBundleId}&cc=BR&l=brazilian`;
    const url2 = `https://store.steampowered.com/actions/ajaxresolvebundles?bundleids=${testBundleId2}&cc=BR&l=brazilian`;
    
    console.log('🧪 Teste 1: Bundle que falhou recentemente');
    console.log(`URL: ${url1}`);
    
    try {
        const response1 = await axios.get(url1, {
            timeout: 10000,
            headers: {
                'User-Agent': 'SteamBundleAPI/1.0',
                'Accept': 'application/json'
            }
        });
        
        console.log(`✅ Status: ${response1.status}`);
        console.log(`📦 Dados recebidos: ${JSON.stringify(response1.data).length} caracteres`);
        console.log(`📋 Conteúdo: ${JSON.stringify(response1.data, null, 2)}`);
        
    } catch (error) {
        console.log(`❌ ERRO:`);
        console.log(`   - Status: ${error.response?.status || 'N/A'}`);
        console.log(`   - Mensagem: ${error.message}`);
        console.log(`   - Headers: ${JSON.stringify(error.response?.headers || {}, null, 2)}`);
        
        if (error.response?.status === 429) {
            console.log('🚨 CONFIRMADO: Rate limiting detectado!');
        } else if (error.response?.status === 403) {
            console.log('🚨 BLOQUEIO: IP ou User-Agent bloqueado!');
        }
    }
    
    console.log('\n' + '='.repeat(60) + '\n');
    
    console.log('🧪 Teste 2: Bundle mais antiga (deveria existir)');
    console.log(`URL: ${url2}`);
    
    try {
        const response2 = await axios.get(url2, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json'
            }
        });
        
        console.log(`✅ Status: ${response2.status}`);
        console.log(`📦 Dados recebidos: ${JSON.stringify(response2.data).length} caracteres`);
        console.log(`📋 Conteúdo: ${JSON.stringify(response2.data, null, 2)}`);
        
    } catch (error) {
        console.log(`❌ ERRO:`);
        console.log(`   - Status: ${error.response?.status || 'N/A'}`);
        console.log(`   - Mensagem: ${error.message}`);
        console.log(`   - Headers: ${JSON.stringify(error.response?.headers || {}, null, 2)}`);
    }
    
    console.log('\n' + '='.repeat(60) + '\n');
    
    // Teste de conectividade geral com a Steam Store
    console.log('🧪 Teste 3: Conectividade geral Steam Store');
    const storeUrl = 'https://store.steampowered.com/';
    
    try {
        const response3 = await axios.get(storeUrl, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        console.log(`✅ Steam Store acessível - Status: ${response3.status}`);
        console.log(`📦 Tamanho da página: ${response3.data.length} caracteres`);
        
    } catch (error) {
        console.log(`❌ Steam Store inacessível:`);
        console.log(`   - Status: ${error.response?.status || 'N/A'}`);
        console.log(`   - Mensagem: ${error.message}`);
    }
    
    console.log('\n' + '='.repeat(60) + '\n');
    
    // Teste com app details para comparação
    console.log('🧪 Teste 4: API de App Details (para comparação)');
    const appUrl = 'https://store.steampowered.com/api/appdetails?appids=730&cc=BR&l=brazilian'; // CS2
    
    try {
        const response4 = await axios.get(appUrl, {
            timeout: 10000,
            headers: {
                'User-Agent': 'SteamBundleAPI/1.0'
            }
        });
        
        console.log(`✅ App Details API - Status: ${response4.status}`);
        console.log(`📦 Dados: ${JSON.stringify(response4.data).length} caracteres`);
        
        if (response4.data['730']?.success) {
            console.log(`🎮 App encontrado: ${response4.data['730'].data?.name || 'N/A'}`);
        }
        
    } catch (error) {
        console.log(`❌ App Details API falhou:`);
        console.log(`   - Status: ${error.response?.status || 'N/A'}`);
        console.log(`   - Mensagem: ${error.message}`);
    }
    
    console.log('\n' + '='.repeat(60) + '\n');
    console.log('📊 RESUMO DO DIAGNÓSTICO:');
    console.log('1. Se Bundle API falha mas Store/App API funciona = Rate limiting específico');
    console.log('2. Se todos falham = Problema de conectividade/bloqueio geral');
    console.log('3. Se Status 429/403 = Bloqueio confirmado');
    console.log('4. Se Status 200 mas dados vazios = API está funcionando, bundles realmente não existem');
}

// Executa o teste
testSteamAPIConnectivity().catch(console.error);
