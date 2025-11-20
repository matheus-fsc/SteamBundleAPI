"""
Script principal COMPLETO com banco de dados e estratégia híbrida
Otimizado para Orange Pi com Docker
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
from .browser_scraper import BrowserScraper
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
    
    bundles_with_browser_needed = []
    
    try:
        # === FASE 1: Scraping rápido com aiohttp ===
        logger.info("📡 FASE 1: Scraping com aiohttp (rápido)")
        
        async with BundleScraper() as scraper:
            bundles = await scraper.scrape_all_bundles()
            
            scraping_log.bundles_found = len(bundles)
            
            logger.info(f"Total de bundles extraídos: {len(bundles)}")
            
            # Aplica filtros
            filter_service = BundleFilter()
            
            logger.info("Aplicando filtros...")
            bundles = filter_service.filter_valid(bundles)
            logger.info(f"Após validação: {len(bundles)} bundles")
            
            bundles = filter_service.filter_duplicates(bundles)
            logger.info(f"Após remover duplicatas: {len(bundles)} bundles")
            
            # Salva no banco e identifica bundles que precisam de browser
            logger.info("💾 Salvando bundles no banco de dados...")
            
            saved_count = 0
            for bundle_data in bundles:
                try:
                    bundle_model = await db.save_bundle(bundle_data)
                    saved_count += 1
                    
                    # Coleta bundles que precisam de retry com browser
                    if bundle_data.get('needs_browser_scraping', False):
                        bundles_with_browser_needed.append(bundle_data['id'])
                        logger.info(
                            f"⚠️  Bundle {bundle_data['id']} marcado para retry com browser "
                            f"(preço dinâmico detectado)"
                        )
                
                except Exception as e:
                    logger.error(f"Erro ao salvar bundle {bundle_data.get('id')}: {e}")
                    scraping_log.bundles_failed += 1
            
            scraping_log.bundles_scraped = saved_count
            logger.success(f"Salvos {saved_count} bundles no banco")
            
            # Estatísticas
            stats = filter_service.get_statistics(bundles)
            logger.info(f"📊 Estatísticas: {json.dumps(stats, indent=2)}")
            scraping_log.stats = stats
        
        # === FASE 2: Retry com browser para bundles problemáticos ===
        if bundles_with_browser_needed:
            logger.info(
                f"\n🌐 FASE 2: Retry com browser para {len(bundles_with_browser_needed)} bundles"
            )
            logger.info("⚡ Isso é mais lento mas necessário para preços dinâmicos")
            
            try:
                async with BrowserScraper() as browser_scraper:
                    browser_bundles = await browser_scraper.scrape_multiple_bundles(
                        bundles_with_browser_needed
                    )
                    
                    # Salva bundles extraídos com browser
                    logger.info(f"💾 Salvando {len(browser_bundles)} bundles do browser...")
                    
                    for bundle_data in browser_bundles:
                        try:
                            await db.save_bundle(bundle_data)
                            scraping_log.bundles_scraped += 1
                        except Exception as e:
                            logger.error(f"Erro ao salvar bundle (browser): {e}")
                    
                    logger.success(
                        f"Browser scraping concluído: {len(browser_bundles)} bundles extraídos"
                    )
            
            except Exception as e:
                logger.error(f"Erro durante browser scraping: {e}")
                logger.warning("Continuando sem os bundles com preços dinâmicos")
        
        else:
            logger.info("✓ Nenhum bundle precisa de retry com browser")
        
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
