"""
Script principal COMPLETO com banco de dados
Otimizado para Orange Pi com Docker - usa API oficial da Steam
"""
import asyncio
import json
import os
from pathlib import Path
from typing import List, Dict
from .scraper import BundleScraper
from .filters import BundleFilter
from .logger import Logger
from .database import Database, BundleModel, ScrapingLogModel
import datetime


async def main():
    """Execução completa com banco de dados e retry híbrido"""
    logger = Logger('main')
    
    logger.start_operation("Execução do scraper com banco de dados")
    
    # Inicializa banco de dados
    db = Database()
    await db.init_db()
    logger.success("Banco de dados inicializado")
    
    # Log de execução
    scraping_log = ScrapingLogModel(
        started_at=datetime.datetime.utcnow()
    )
    
    
    try:
        # === FASE 1: Scraping com API oficial ===
        logger.info("📡 Scraping via API oficial da Steam")
        
        async with BundleScraper() as scraper:
            # Busca lista de IDs
            bundle_ids = await scraper.scrape_bundle_list()
            scraping_log.bundles_found = len(bundle_ids)
            logger.info(f"Total de bundle IDs encontrados: {len(bundle_ids)}")
            
            # Processa e salva em batches (para não sobrecarregar memória)
            filter_service = BundleFilter()
            saved_count = 0
            all_bundles_for_stats = []
            batch_size = 100
            
            for i in range(0, len(bundle_ids), batch_size):
                batch_ids = bundle_ids[i:i + batch_size]
                batch_num = i//batch_size + 1
                
                logger.info(f"📦 Processando batch {batch_num} ({len(batch_ids)} bundles)...")
                
                # Scrape do batch
                batch_bundles = await scraper.scrape_bundles_batch(batch_ids)
                
                # Aplica filtros
                batch_bundles = filter_service.filter_valid(batch_bundles)
                
                # Salva no banco IMEDIATAMENTE
                logger.info(f"💾 Salvando batch {batch_num} no banco...")
                for bundle_data in batch_bundles:
                    try:
                        bundle_model = await db.save_bundle(bundle_data)
                        saved_count += 1
                        all_bundles_for_stats.append(bundle_data)
                    except Exception as e:
                        logger.error(f"Erro ao salvar bundle {bundle_data.get('id')}: {e}")
                        scraping_log.bundles_failed += 1
                
                logger.success(f"✅ Batch {batch_num}: {len(batch_bundles)} bundles salvos (Total: {saved_count})")
                
                # Pequena pausa entre batches
                if i + batch_size < len(bundle_ids):
                    await asyncio.sleep(2)
            
            scraping_log.bundles_scraped = saved_count
            logger.success(f"✅ TOTAL FINAL: {saved_count} bundles salvos no banco")
            
            # Remove duplicatas para estatísticas
            bundles = filter_service.filter_duplicates(all_bundles_for_stats)
            
            # Estatísticas
            stats = filter_service.get_statistics(bundles)
            logger.info(f"📊 Estatísticas: {json.dumps(stats, indent=2)}")
            scraping_log.stats = stats
        
        # === Análise de promoções reais ===
        logger.info("\n🔍 Analisando autenticidade dos descontos...")
        
        top_bundles = await db.get_top_discounts(limit=10)
        
        if top_bundles:
            logger.info("\n=== TOP 10 BUNDLES COM MAIOR DESCONTO ===")
            
            for i, bundle in enumerate(top_bundles, 1):
                discount_analysis = bundle.get_real_discount()
                
                emoji = "✅" if discount_analysis['is_real'] else "⚠️ "
                
                logger.info(f"\n{i}. {bundle.name}")
                logger.info(f"   Desconto: {bundle.discount}% | Preço: {bundle.currency} {bundle.final_price}")
                logger.info(f"   Jogos: {bundle.games_count} | URL: {bundle.url}")
                logger.info(f"   {emoji} {discount_analysis['reason']}")
                
                if not discount_analysis['is_real']:
                    logger.warning(
                        f"   Inflação de preço: {discount_analysis.get('inflation_percent', 0)}%"
                    )
        
        # === Export opcional para JSON (compatibilidade) ===
        logger.info("\n📤 Exportando para JSON (backup)...")
        
        output_dir = Path(__file__).parent.parent / 'data'
        output_dir.mkdir(exist_ok=True)
        
        # Converte bundles do banco para JSON
        all_bundles_data = []
        for bundle in top_bundles:
            all_bundles_data.append({
                'id': bundle.id,
                'name': bundle.name,
                'price': {
                    'final': bundle.final_price,
                    'original': bundle.original_price,
                    'currency': bundle.currency
                },
                'discount': bundle.discount,
                'games': bundle.games,
                'games_count': bundle.games_count,
                'url': bundle.url,
                'last_updated': bundle.last_updated.isoformat() if bundle.last_updated else None
            })
        
        output_file = output_dir / 'bundles.json'
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(all_bundles_data, f, indent=2, ensure_ascii=False)
        
        logger.success(f"Backup JSON salvo em: {output_file}")
        
        # Finaliza log de execução
        scraping_log.finished_at = datetime.datetime.utcnow()
        scraping_log.success = True
        
        logger.end_operation("Execução do scraper", success=True)
        
        return scraping_log
    
    except Exception as e:
        logger.error(f"Erro durante execução: {e}")
        
        scraping_log.finished_at = datetime.datetime.utcnow()
        scraping_log.success = False
        scraping_log.error_message = str(e)
        
        logger.end_operation("Execução do scraper", success=False)
        raise
    
    finally:
        # === FASE 3: Sincronização com Supabase (opcional) ===
        if os.getenv('ENABLE_SUPABASE_SYNC', 'false').lower() == 'true':
            logger.info("\n☁️  FASE 3: Sincronizando com Supabase...")
            
            try:
                from .sync_supabase import SupabaseSync
                
                sync = SupabaseSync(local_db=db)
                
                if sync.test_connection():
                    # Sincroniza bundles das últimas 24h com desconto
                    sync_stats = await sync.full_sync(
                        hours_ago=24,
                        only_with_discount=True
                    )
                    
                    logger.success(
                        f"Supabase sync: {sync_stats['success']} bundles enviados"
                    )
                else:
                    logger.warning("Supabase não disponível, pulando sincronização")
            
            except ImportError:
                logger.warning("Módulo supabase não instalado, pulando sincronização")
            except Exception as e:
                logger.error(f"Erro na sincronização Supabase: {e}")
                logger.info("Continuando mesmo sem sync...")
        
        await db.close()


async def analyze_bundle_history(bundle_id: str):
    """Analisa histórico de um bundle específico"""
    logger = Logger('analyzer')
    
    db = Database()
    await db.init_db()
    
    try:
        bundle = await db.get_bundle_by_id(bundle_id)
        
        if not bundle:
            logger.error(f"Bundle {bundle_id} não encontrado no banco")
            return
        
        logger.info(f"\n=== ANÁLISE DO BUNDLE: {bundle.name} ===")
        logger.info(f"ID: {bundle.id}")
        logger.info(f"URL: {bundle.url}")
        logger.info(f"Preço atual: {bundle.currency} {bundle.final_price}")
        logger.info(f"Desconto: {bundle.discount}%")
        logger.info(f"Jogos: {bundle.games_count}")
        
        # Análise de desconto
        discount_analysis = bundle.get_real_discount()
        logger.info(f"\n📊 Análise de desconto:")
        logger.info(f"   Real? {discount_analysis['is_real']}")
        logger.info(f"   Razão: {discount_analysis['reason']}")
        
        if 'avg_regular' in discount_analysis:
            logger.info(f"   Preço regular médio: {bundle.currency} {discount_analysis['avg_regular']}")
        
        # Histórico de preços
        if bundle.price_history:
            logger.info(f"\n📈 Histórico de preços ({len(bundle.price_history)} registros):")
            
            for entry in bundle.price_history[-5:]:  # Últimos 5
                logger.info(
                    f"   {entry['date']}: {entry['currency']} {entry['final']} "
                    f"(desconto: {entry['discount']}%)"
                )
    
    finally:
        await db.close()


if __name__ == "__main__":
    # Execução principal
    asyncio.run(main())
    
    # Ou analisar bundle específico
    # asyncio.run(analyze_bundle_history('28631'))
