/**
 * Script de teste para Sistema de Backup Blue-Green
 * Testa todas as funcionalidades do sistema de continuidade
 */

const BackupSystem = require('../services/BackupSystem');

async function testBackupSystem() {
    console.log('🧪 TESTE DO SISTEMA DE BACKUP BLUE-GREEN');
    console.log('='.repeat(60));

    const backupSystem = new BackupSystem();

    try {
        // 1. Criar sistema de backup
        console.log('\n📋 ETAPA 1: Criando sistema de backup...');
        const createResult = await backupSystem.createBackupTables();
        
        if (createResult.success) {
            console.log('✅ Sistema de backup criado com sucesso');
            console.log(`   Tabelas: ${createResult.data?.tables_created?.join(', ') || 'N/A'}`);
        } else {
            console.log(`❌ Erro ao criar sistema: ${createResult.error}`);
            return;
        }

        // Aguardar um pouco
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 2. Verificar status inicial
        console.log('\n📊 ETAPA 2: Verificando status inicial...');
        const initialStatus = await backupSystem.getSystemStatus();
        
        if (initialStatus) {
            console.log('✅ Status obtido com sucesso:');
            console.log(`   Tabela ativa: ${initialStatus.system_status?.active_table}`);
            console.log(`   Status de atualização: ${initialStatus.system_status?.update_status}`);
            console.log(`   Total de registros: ${initialStatus.system_status?.total_records}`);
        }

        // 3. Fazer backup inicial
        console.log('\n💾 ETAPA 3: Fazendo backup inicial...');
        const backupResult = await backupSystem.performBackup();
        
        if (backupResult.success) {
            console.log('✅ Backup realizado com sucesso');
            console.log(`   Registros copiados: ${backupResult.records}`);
        } else {
            console.log(`❌ Erro no backup: ${backupResult.error}`);
        }

        // 4. Simular início de atualização
        console.log('\n🔄 ETAPA 4: Simulando início de atualização...');
        const startUpdateResult = await backupSystem.startUpdate();
        
        if (startUpdateResult.success) {
            console.log('✅ Atualização iniciada com sucesso');
            console.log(`   Sistema usando tabela: ${startUpdateResult.active_table}`);
        } else {
            console.log(`❌ Erro ao iniciar atualização: ${startUpdateResult.error}`);
        }

        // 5. Verificar status durante atualização
        console.log('\n🔍 ETAPA 5: Verificando status durante atualização...');
        const updateStatus = await backupSystem.getSystemStatus();
        
        if (updateStatus) {
            console.log('📊 Status durante atualização:');
            console.log(`   Tabela ativa: ${updateStatus.system_status?.active_table}`);
            console.log(`   Status: ${updateStatus.system_status?.update_status}`);
        }

        // 6. Simular fim de atualização
        console.log('\n✅ ETAPA 6: Finalizando atualização...');
        const finishResult = await backupSystem.finishUpdate();
        
        if (finishResult.success) {
            console.log('✅ Atualização finalizada com sucesso');
            console.log(`   Sistema voltou para tabela: ${finishResult.active_table}`);
        } else {
            console.log(`❌ Erro ao finalizar atualização: ${finishResult.error}`);
        }

        // 7. Status final
        console.log('\n📋 ETAPA 7: Status final do sistema...');
        const finalStatus = await backupSystem.getSystemStatus();
        
        if (finalStatus) {
            console.log('✅ Status final:');
            console.log(`   Tabela ativa: ${finalStatus.system_status?.active_table}`);
            console.log(`   Status: ${finalStatus.system_status?.update_status}`);
            console.log(`   Último backup: ${finalStatus.system_status?.last_backup_at}`);
            console.log(`   Última atualização: ${finalStatus.system_status?.last_update_at}`);
        }

        console.log('\n✅ TESTE DO SISTEMA DE BACKUP CONCLUÍDO COM SUCESSO! 🎉');

    } catch (error) {
        console.error('\n❌ ERRO NO TESTE:', error.message);
        
        // Tentar restauração de emergência em caso de erro
        console.log('\n🚨 Tentando restauração de emergência...');
        
        try {
            const emergencyResult = await backupSystem.emergencyRestore();
            
            if (emergencyResult.success) {
                console.log('✅ Restauração de emergência bem-sucedida');
                console.log(`   Registros restaurados: ${emergencyResult.records}`);
            } else {
                console.log('❌ FALHA na restauração de emergência');
            }
        } catch (emergencyError) {
            console.error('❌ ERRO CRÍTICO na restauração:', emergencyError.message);
        }
    }
}

// Função para testar apenas a criação do sistema
async function testCreateBackupSystem() {
    console.log('🔧 Teste rápido: Criação do sistema de backup');
    
    const backupSystem = new BackupSystem();
    const result = await backupSystem.createBackupTables();
    
    if (result.success) {
        console.log('✅ Sistema criado:', result.data);
    } else {
        console.log('❌ Erro:', result.error);
    }
}

// Executar teste
if (require.main === module) {
    const testType = process.argv[2] || 'full';
    
    if (testType === 'create') {
        testCreateBackupSystem().catch(console.error);
    } else {
        testBackupSystem().catch(console.error);
    }
}

module.exports = { testBackupSystem, testCreateBackupSystem };
