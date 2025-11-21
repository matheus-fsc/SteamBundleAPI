#!/usr/bin/env python3
"""
Sincronização DIRETA PostgreSQL → Supabase
Usa conexão PostgreSQL nativa (mais confiável que SDK)
"""
import asyncio
import os
from datetime import datetime, timedelta
from sqlalchemy import select, create_engine, text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
import sys

# Adiciona path do projeto
sys.path.insert(0, '/app')

from scraper.database import BundleModel
from scraper.logger import Logger


async def sync_to_supabase():
    """
    Sincroniza bundles do PostgreSQL local → Supabase PostgreSQL
    Usa INSERT ... ON CONFLICT UPDATE (upsert nativo)
    """
    logger = Logger('supabase_sync_direct')
    
    # Conexões
    local_db_url = os.getenv('DATABASE_URL', 'postgresql+asyncpg://steam:changeme@postgres/steam_bundles')
    supabase_db_url = os.getenv('SUPABASE_DB_URL')
    
    if not supabase_db_url:
        logger.error("❌ SUPABASE_DB_URL não configurada!")
        return
    
    logger.info(f"🔄 Iniciando sync PostgreSQL → Supabase")
    logger.info(f"Local: {local_db_url.split('@')[1] if '@' in local_db_url else 'local'}")
    logger.info(f"Supabase: {supabase_db_url.split('@')[1].split('/')[0] if '@' in supabase_db_url else 'supabase'}")
    
    try:
        # Engines
        local_engine = create_async_engine(local_db_url, echo=False)
        supabase_engine = create_async_engine(supabase_db_url, echo=False)
        
        # Sessions
        LocalSession = sessionmaker(local_engine, class_=AsyncSession, expire_on_commit=False)
        SupabaseSession = sessionmaker(supabase_engine, class_=AsyncSession, expire_on_commit=False)
        
        # Busca bundles do banco local (últimas 48h, apenas válidos)
        async with LocalSession() as local_session:
            cutoff = datetime.utcnow() - timedelta(hours=48)
            
            query = select(BundleModel).where(
                BundleModel.last_updated >= cutoff,
                BundleModel.is_valid == True
            ).order_by(BundleModel.discount.desc())
            
            result = await local_session.execute(query)
            bundles = result.scalars().all()
            
            logger.info(f"📦 Encontrados {len(bundles)} bundles para sync")
            
            if not bundles:
                logger.info("✅ Nenhum bundle novo para sincronizar")
                return
        
        # Envia para Supabase com UPSERT
        async with SupabaseSession() as supabase_session:
            synced = 0
            errors = 0
            
            for bundle in bundles:
                try:
                    # Prepara dados
                    discount_analysis = bundle.get_real_discount()
                    
                    # SQL UPSERT nativo (PostgreSQL)
                    upsert_sql = text("""
                        INSERT INTO steam_bundles (
                            id, name, url, 
                            final_price, original_price, discount, currency,
                            games, games_count,
                            is_valid, is_discount_real, discount_analysis,
                            price_history, first_seen, last_updated, synced_at
                        ) VALUES (
                            :id, :name, :url,
                            :final_price, :original_price, :discount, :currency,
                            :games, :games_count,
                            :is_valid, :is_discount_real, :discount_analysis,
                            :price_history, :first_seen, :last_updated, :synced_at
                        )
                        ON CONFLICT (id) DO UPDATE SET
                            name = EXCLUDED.name,
                            url = EXCLUDED.url,
                            final_price = EXCLUDED.final_price,
                            original_price = EXCLUDED.original_price,
                            discount = EXCLUDED.discount,
                            currency = EXCLUDED.currency,
                            games = EXCLUDED.games,
                            games_count = EXCLUDED.games_count,
                            is_valid = EXCLUDED.is_valid,
                            is_discount_real = EXCLUDED.is_discount_real,
                            discount_analysis = EXCLUDED.discount_analysis,
                            price_history = EXCLUDED.price_history,
                            last_updated = EXCLUDED.last_updated,
                            synced_at = EXCLUDED.synced_at
                    """)
                    
                    await supabase_session.execute(upsert_sql, {
                        'id': bundle.id,
                        'name': bundle.name,
                        'url': bundle.url,
                        'final_price': bundle.final_price,
                        'original_price': bundle.original_price,
                        'discount': bundle.discount,
                        'currency': bundle.currency,
                        'games': bundle.games,
                        'games_count': bundle.games_count,
                        'is_valid': bundle.is_valid,
                        'is_discount_real': discount_analysis.get('is_real', True),
                        'discount_analysis': discount_analysis.get('reason', ''),
                        'price_history': bundle.price_history[:30] if bundle.price_history else [],
                        'first_seen': bundle.first_seen,
                        'last_updated': bundle.last_updated,
                        'synced_at': datetime.utcnow()
                    })
                    
                    synced += 1
                    
                    if synced % 100 == 0:
                        logger.info(f"⏳ Sincronizados {synced}/{len(bundles)}...")
                    
                except Exception as e:
                    logger.error(f"❌ Erro ao sync bundle {bundle.id}: {e}")
                    errors += 1
                    continue
            
            # Commit final
            await supabase_session.commit()
            
            logger.info(f"✅ Sync completo!")
            logger.info(f"   → Sincronizados: {synced}")
            logger.info(f"   → Erros: {errors}")
            logger.info(f"   → Taxa de sucesso: {(synced/len(bundles)*100):.1f}%")
    
    except Exception as e:
        logger.error(f"❌ Erro fatal no sync: {e}")
        raise
    
    finally:
        await local_engine.dispose()
        await supabase_engine.dispose()


if __name__ == '__main__':
    asyncio.run(sync_to_supabase())
