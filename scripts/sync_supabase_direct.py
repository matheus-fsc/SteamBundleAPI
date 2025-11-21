#!/usr/bin/env python3
"""
Sincronização DIRETA PostgreSQL → Supabase
Usa conexão PostgreSQL nativa (mais confiável que SDK)
"""
import asyncio
import os
import json
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
        
        # Envia para Supabase com BULK UPSERT (muito mais rápido!)
        synced = 0
        errors = 0
        batch_size = 500  # Insere 500 bundles por vez
        
        for i in range(0, len(bundles), batch_size):
            batch = bundles[i:i + batch_size]
            batch_num = i // batch_size + 1
            
            logger.info(f"📦 Sincronizando batch {batch_num} ({len(batch)} bundles)...")
            
            async with SupabaseSession() as supabase_session:
                try:
                    # Prepara todos os valores do batch
                    values_list = []
                    for bundle in batch:
                        discount_analysis = bundle.get_real_discount()
                        values_list.append({
                            'id': bundle.id,
                            'name': bundle.name,
                            'url': bundle.url,
                            'image_url': bundle.image_url,
                            'final_price': bundle.final_price,
                            'original_price': bundle.original_price,
                            'discount': bundle.discount,
                            'currency': bundle.currency,
                            'games': json.dumps(bundle.games) if bundle.games else '[]',
                            'games_count': bundle.games_count,
                            'is_valid': bundle.is_valid,
                            'is_discount_real': discount_analysis.get('is_real', True),
                            'discount_analysis': discount_analysis.get('reason', ''),
                            'price_history': json.dumps(bundle.price_history[:30] if bundle.price_history else []),
                            'first_seen': bundle.first_seen,
                            'last_updated': bundle.last_updated,
                            'synced_at': datetime.utcnow()
                        })
                    
                    # Cria placeholders para bulk insert
                    placeholders = []
                    for idx in range(len(values_list)):
                        base = idx * 17  # 17 campos por bundle
                        placeholders.append(f"(${base+1}, ${base+2}, ${base+3}, ${base+4}, ${base+5}, ${base+6}, ${base+7}, ${base+8}, ${base+9}, ${base+10}, ${base+11}, ${base+12}, ${base+13}, ${base+14}, ${base+15}, ${base+16}, ${base+17})")
                    
                    # SQL BULK UPSERT
                    bulk_upsert_sql = f"""
                        INSERT INTO bundles (
                            id, name, url, image_url,
                            final_price, original_price, discount, currency,
                            games, games_count,
                            is_valid, is_discount_real, discount_analysis,
                            price_history, first_seen, last_updated, synced_at
                        ) VALUES {', '.join(placeholders)}
                        ON CONFLICT (id) DO UPDATE SET
                            name = EXCLUDED.name,
                            url = EXCLUDED.url,
                            image_url = EXCLUDED.image_url,
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
                    """
                    
                    # Flatten values para executar
                    flat_values = []
                    for bundle_values in values_list:
                        flat_values.extend([
                            bundle_values['id'], bundle_values['name'], bundle_values['url'], 
                            bundle_values['image_url'], bundle_values['final_price'], 
                            bundle_values['original_price'], bundle_values['discount'], 
                            bundle_values['currency'], bundle_values['games'], 
                            bundle_values['games_count'], bundle_values['is_valid'], 
                            bundle_values['is_discount_real'], bundle_values['discount_analysis'],
                            bundle_values['price_history'], bundle_values['first_seen'],
                            bundle_values['last_updated'], bundle_values['synced_at']
                        ])
                    
                    await supabase_session.execute(text(bulk_upsert_sql), flat_values)
                    await supabase_session.commit()
                    
                    synced += len(batch)
                    logger.success(f"✅ Batch {batch_num}: {len(batch)} bundles sincronizados (Total: {synced}/{len(bundles)})")
                    
                except Exception as e:
                    logger.error(f"❌ Erro no batch {batch_num}: {e}")
                    errors += len(batch)
                    continue
        
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
