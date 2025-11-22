"""
Sync via Supabase REST API (mais confiável que PostgreSQL direto)
Usa HTTPS que sempre funciona, mesmo sem IPv6
"""
import asyncio
import os
import sys
from typing import List, Dict
from pathlib import Path

# Add path
sys.path.insert(0, str(Path(__file__).parent.parent))

from scraper.logger import Logger
from scraper.database import Database
import aiohttp
import json


async def sync_to_supabase_rest():
    """Sincroniza bundles usando Supabase REST API"""
    logger = Logger('supabase_sync_rest')
    
    # Configuração
    supabase_url = os.getenv('SUPABASE_URL')
    service_key = os.getenv('SUPABASE_SERVICE_KEY')
    
    if not supabase_url or not service_key:
        logger.error("❌ SUPABASE_URL ou SUPABASE_SERVICE_KEY não configuradas!")
        return 1
    
    logger.info("🔄 Iniciando sync via REST API")
    logger.info(f"Supabase: {supabase_url}")
    
    # Conecta ao banco local
    db = Database()
    await db.init_db()
    
    try:
        # Busca todos os bundles do banco local
        async with db.async_session() as session:
            from sqlalchemy import select
            from scraper.database import BundleModel
            
            result = await session.execute(select(BundleModel))
            bundles = result.scalars().all()
            
            logger.info(f"📦 Encontrados {len(bundles)} bundles para sync")
            
            if len(bundles) == 0:
                logger.warning("⚠️  Nenhum bundle para sincronizar")
                return 0
            
            # Prepara dados para upsert
            batch_size = 500
            total_synced = 0
            total_failed = 0
            
            # Headers para autenticação
            headers = {
                'apikey': service_key,
                'Authorization': f'Bearer {service_key}',
                'Content-Type': 'application/json',
                'Prefer': 'resolution=merge-duplicates'
            }
            
            # URL da REST API
            rest_url = f"{supabase_url}/rest/v1/bundles"
            
            async with aiohttp.ClientSession() as http_session:
                for i in range(0, len(bundles), batch_size):
                    batch = bundles[i:i + batch_size]
                    batch_num = (i // batch_size) + 1
                    
                    logger.info(f"📦 Sincronizando batch {batch_num} ({len(batch)} bundles)...")
                    
                    # Converte para dict
                    bundle_dicts = []
                    for bundle in batch:
                        bundle_dict = {
                            'id': bundle.id,
                            'name': bundle.name,
                            'final_price': bundle.final_price,
                            'original_price': bundle.original_price,
                            'currency': bundle.currency,
                            'discount': bundle.discount,
                            'games': bundle.games,
                            'games_count': bundle.games_count,
                            'url': bundle.url,
                            'image_url': bundle.image_url,
                            'last_updated': bundle.last_updated.isoformat() if bundle.last_updated else None
                        }
                        bundle_dicts.append(bundle_dict)
                    
                    # Retry logic
                    for attempt in range(3):
                        try:
                            async with http_session.post(
                                rest_url,
                                headers=headers,
                                json=bundle_dicts,
                                timeout=aiohttp.ClientTimeout(total=60)
                            ) as response:
                                if response.status in (200, 201):
                                    total_synced += len(batch)
                                    logger.success(f"✅ Batch {batch_num} sincronizado ({len(batch)} bundles)")
                                    break
                                else:
                                    error_text = await response.text()
                                    logger.warning(f"⚠️  Tentativa {attempt + 1}/3: HTTP {response.status} - {error_text[:200]}")
                                    
                                    if attempt < 2:
                                        await asyncio.sleep(5 * (attempt + 1))
                                    else:
                                        logger.error(f"❌ Batch {batch_num} falhou após 3 tentativas")
                                        total_failed += len(batch)
                        
                        except Exception as e:
                            logger.warning(f"⚠️  Tentativa {attempt + 1}/3 falhou: {e}")
                            
                            if attempt < 2:
                                await asyncio.sleep(5 * (attempt + 1))
                            else:
                                logger.error(f"❌ Batch {batch_num} falhou: {e}")
                                total_failed += len(batch)
                    
                    # Progress
                    progress = (total_synced / len(bundles)) * 100
                    logger.info(f"📊 Progresso: {total_synced}/{len(bundles)} ({progress:.1f}%)")
            
            logger.success(f"✅ Sync completo!")
            logger.info(f"📊 Total sincronizado: {total_synced}")
            
            if total_failed > 0:
                logger.warning(f"⚠️  Total com falha: {total_failed}")
                return 1
            
            return 0
    
    except Exception as e:
        logger.error(f"❌ Erro durante sync: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return 1
    
    finally:
        await db.close()


if __name__ == '__main__':
    exit_code = asyncio.run(sync_to_supabase_rest())
    sys.exit(exit_code)
