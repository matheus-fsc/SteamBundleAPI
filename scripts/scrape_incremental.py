#!/usr/bin/env python3
"""
Script de scraping incremental - busca apenas bundles novos

Ideal para execução frequente (diária)
- Lê bundle_changes.json para identificar novos IDs
- Faz scraping apenas dos novos
- Atualiza banco de dados
"""
import sys
import asyncio
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from scraper.scraper import BundleScraper
from scraper.database import Database
from scraper.filters import BundleFilter
from scraper.logger import Logger


async def scrape_incremental():
    """Scraping apenas de bundles novos"""
    logger = Logger('incremental')
    
    changes_file = Path("data/bundle_changes.json")
    
    # Verifica se há mudanças
    if not changes_file.exists():
        logger.info("Nenhuma mudança detectada (bundle_changes.json não encontrado)")
        logger.info("Execute discover_with_diff.py primeiro ou use main_with_db.py para scraping completo")
        return
    
    # Carrega mudanças
    with open(changes_file, 'r') as f:
        changes = json.load(f)
    
    added = changes.get('added', [])
    removed = changes.get('removed', [])
    
    logger.info(f"Mudanças detectadas em: {changes.get('timestamp', 'desconhecido')}")
    logger.info(f"Novos bundles: {len(added)}")
    logger.info(f"Removidos: {len(removed)}")
    
    if not added and not removed:
        logger.info("Nenhuma mudança para processar")
        return
    
    # Inicializa banco
    db = Database()
    await db.init_db()
    
    try:
        # Processa removidos (marca como inativos)
        if removed:
            logger.info(f"\nMarcando {len(removed)} bundles como removidos...")
            for bundle_id in removed:
                try:
                    # Aqui você pode implementar lógica de soft delete
                    # Por enquanto apenas logamos
                    logger.info(f"Bundle {bundle_id} foi removido da Steam")
                except Exception as e:
                    logger.error(f"Erro ao processar remoção {bundle_id}: {e}")
        
        # Scraping dos novos
        if added:
            logger.info(f"\nBuscando dados de {len(added)} bundles novos...")
            
            async with BundleScraper() as scraper:
                # Busca em batch para eficiência
                bundles = await scraper.scrape_bundles_batch(added)
                
                logger.info(f"Extraídos {len(bundles)} bundles")
                
                # Aplica filtros
                filter_service = BundleFilter()
                bundles = filter_service.filter_valid(bundles)
                
                logger.info(f"Após validação: {len(bundles)} bundles")
                
                # Salva no banco
                saved_count = 0
                for bundle_data in bundles:
                    try:
                        await db.save_bundle(bundle_data)
                        saved_count += 1
                    except Exception as e:
                        logger.error(f"Erro ao salvar bundle {bundle_data.get('id')}: {e}")
                
                logger.success(f"Salvos {saved_count} novos bundles no banco")
        
        # Remove arquivo de mudanças após processar
        changes_file.unlink()
        logger.info("Arquivo de mudanças removido (já processado)")
        
    finally:
        await db.close()


if __name__ == "__main__":
    print("=" * 70)
    print("SCRAPING INCREMENTAL - APENAS NOVOS BUNDLES")
    print("=" * 70)
    
    try:
        asyncio.run(scrape_incremental())
        print("\nConcluído!")
    except KeyboardInterrupt:
        print("\n\nInterrompido")
    except Exception as e:
        print(f"\n\nErro: {e}")
        sys.exit(1)
