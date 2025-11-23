#!/usr/bin/env python3
"""
Script para LIMPAR TABELA bundles no Supabase
Use com cuidado - apaga TODOS os registros!

Uso:
    python3 scripts/clean_supabase_table.py
"""

import os
import sys
from pathlib import Path

# Adiciona o diretório raiz ao path
sys.path.insert(0, str(Path(__file__).parent.parent))

try:
    from supabase import create_client, Client
except ImportError:
    print("❌ Erro: supabase não instalado")
    print("   Instale: pip install supabase")
    sys.exit(1)


def clean_bundles_table():
    """Limpa todos os registros da tabela bundles"""
    
    # Carrega configurações do .env
    from dotenv import load_dotenv
    env_path = Path(__file__).parent.parent / '.env'
    load_dotenv(env_path)
    
    supabase_url = os.getenv('SUPABASE_URL')
    supabase_key = os.getenv('SUPABASE_KEY')
    
    if not supabase_url or not supabase_key:
        print("❌ Erro: SUPABASE_URL ou SUPABASE_KEY não encontrados no .env")
        sys.exit(1)
    
    print("🔗 Conectando ao Supabase...")
    supabase: Client = create_client(supabase_url, supabase_key)
    
    # Conta registros atuais
    try:
        result = supabase.table('bundles').select('id', count='exact').execute()
        total = result.count if hasattr(result, 'count') else len(result.data)
        
        print(f"📊 Registros atuais na tabela: {total}")
        
        if total == 0:
            print("✅ Tabela já está vazia!")
            return
        
        print("")
        print("⚠️  ATENÇÃO: Você está prestes a DELETAR todos os {total} registros!")
        confirm = input("Digite 'DELETE' (em maiúsculas) para confirmar: ")
        
        if confirm != "DELETE":
            print("❌ Cancelado pelo usuário")
            return
        
        print("")
        print("🗑️  Deletando todos os registros...")
        
        # Delete usando range query (deleta tudo)
        # Supabase não tem "delete all", então usamos um filtro que pega tudo
        result = supabase.table('bundles').delete().neq('id', '').execute()
        
        print("✅ Tabela 'bundles' limpa com sucesso!")
        
        # Verifica se realmente limpou
        result = supabase.table('bundles').select('id', count='exact').execute()
        remaining = result.count if hasattr(result, 'count') else len(result.data)
        
        if remaining == 0:
            print(f"✅ Verificação: 0 registros restantes")
        else:
            print(f"⚠️  Ainda existem {remaining} registros. Tente novamente.")
        
    except Exception as e:
        print(f"❌ Erro ao limpar tabela: {e}")
        sys.exit(1)


def main():
    print("=" * 60)
    print("🧹 LIMPEZA DA TABELA SUPABASE - bundles")
    print("=" * 60)
    print("")
    
    clean_bundles_table()
    
    print("")
    print("📋 Próximos passos:")
    print("  1. Execute o scraping: docker exec steam_scraper python -m scraper.main_with_db")
    print("  2. Aguarde ~15-20 min para completar")
    print("  3. Verifique dados no Supabase")
    print("")


if __name__ == '__main__':
    main()
