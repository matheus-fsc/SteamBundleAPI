// check-backup-tables.js - Verificar se as tabelas de backup existem
require('dotenv').config();
const axios = require('axios');

async function checkBackupTables() {
    console.log('🔍 Verificando tabelas de backup...\n');
    
    try {
        // Consultar health para ver se as tabelas de backup existem
        const healthResponse = await axios.get('https://bundleset-api-storage.vercel.app/api/health');
        console.log('📊 Status das tabelas:', JSON.stringify(healthResponse.data.tables, null, 2));
        
        console.log('\n💡 IMPORTANTE:');
        console.log('   • As mudanças no sync.js precisam ser deployadas na Vercel');
        console.log('   • O sistema de backup está configurado no database');
        console.log('   • Após deploy, o backup será automático a cada atualização');
        
    } catch (error) {
        console.error('❌ Erro ao verificar:', error.message);
    }
}

checkBackupTables();
