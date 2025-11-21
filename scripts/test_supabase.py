#!/usr/bin/env python3
"""
Teste de conexão com Supabase
Verifica se as credenciais estão corretas
"""
import os
from supabase import create_client

# Pega do ambiente
SUPABASE_URL = os.getenv('SUPABASE_URL', 'https://hjespkvqdpalpsbcdzgq.supabase.co')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_KEY', '')

print(f"🔍 Testando conexão com Supabase")
print(f"URL: {SUPABASE_URL}")
print(f"Key (primeiros 50 chars): {SUPABASE_KEY[:50]}...")
print(f"Key (tamanho): {len(SUPABASE_KEY)} caracteres")
print()

if not SUPABASE_KEY:
    print("❌ SUPABASE_SERVICE_KEY não configurada!")
    exit(1)

try:
    # Tenta conectar
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    
    # Testa listagem da tabela
    print("✅ Cliente criado com sucesso!")
    print("🔍 Testando acesso à tabela 'steam_bundles'...")
    
    result = supabase.table('steam_bundles').select('id').limit(1).execute()
    
    print(f"✅ Conexão OK! Encontrados {len(result.data)} registros (teste)")
    print(f"📊 Estrutura da resposta: {type(result)}")
    
except Exception as e:
    print(f"❌ Erro: {e}")
    print(f"Tipo: {type(e)}")
    exit(1)

print("\n✅ Todas as verificações passaram!")
