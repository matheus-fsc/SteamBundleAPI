#!/usr/bin/env python3
"""
Testa se o schema do Supabase está correto (inclui image_url)
"""
import asyncio
import os
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

async def test_schema():
    supabase_db_url = os.getenv('SUPABASE_DB_URL')
    
    if not supabase_db_url:
        print("❌ SUPABASE_DB_URL não configurada!")
        return
    
    engine = create_async_engine(supabase_db_url, echo=False)
    
    try:
        async with engine.connect() as conn:
            # Verifica colunas da tabela bundles
            result = await conn.execute(text("""
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = 'bundles'
                ORDER BY ordinal_position;
            """))
            
            columns = result.fetchall()
            
            print("📋 Estrutura da tabela 'bundles' no Supabase:")
            print("-" * 60)
            for col in columns:
                print(f"  - {col[0]:20s} : {col[1]}")
            print("-" * 60)
            
            # Verifica se image_url existe
            has_image_url = any(col[0] == 'image_url' for col in columns)
            
            if has_image_url:
                print("✅ Coluna 'image_url' encontrada!")
                
                # Verifica quantidade de bundles
                count_result = await conn.execute(text("SELECT COUNT(*) FROM bundles;"))
                count = count_result.scalar()
                print(f"📊 Total de bundles no Supabase: {count}")
            else:
                print("❌ Coluna 'image_url' NÃO encontrada!")
                print("⚠️  Execute a migration: scripts/migrations/001_add_image_url.sql")
                
    except Exception as e:
        print(f"❌ Erro ao conectar no Supabase: {e}")
    finally:
        await engine.dispose()

if __name__ == '__main__':
    asyncio.run(test_schema())
