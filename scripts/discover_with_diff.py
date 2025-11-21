#!/usr/bin/env python3
"""
Script inteligente de descoberta de bundles com sistema de diff

Funcionalidades:
- Descobre TODOS os bundle IDs da Steam (força bruta 1-35000)
- Compara com lista anterior (detecta novos e removidos)
- Salva em JSON para consumo do scraper
- Otimizado para execução autônoma (cron)
"""
import sys
import asyncio
import json
from pathlib import Path
from datetime import datetime

# Adiciona o diretório raiz ao path
sys.path.insert(0, str(Path(__file__).parent.parent))

from scraper.bundle_discovery import BundleDiscovery
from scraper.logger import Logger


async def discover_with_diff():
    """Executa descoberta e compara com lista anterior"""
    logger = Logger('discovery_diff')
    
    json_file = Path("data/known_bundles.json")
    
    # Carrega lista anterior (se existir)
    old_ids = set()
    if json_file.exists():
        try:
            with open(json_file, 'r') as f:
                data = json.load(f)
                old_ids = set(data.get('bundle_ids', []))
                logger.info(f"Lista anterior: {len(old_ids)} bundles")
                logger.info(f"Última atualização: {data.get('last_updated', 'desconhecido')}")
        except Exception as e:
            logger.warning(f"Erro ao carregar lista anterior: {e}")
    
    # Executa descoberta completa
    logger.info("Iniciando descoberta completa...")
    
    async with BundleDiscovery() as discovery:
        new_ids_list = await discovery.discover_all()
        new_ids = set(new_ids_list)
    
    # Calcula diferenças
    added = new_ids - old_ids
    removed = old_ids - new_ids
    unchanged = old_ids & new_ids
    
    logger.info("\n" + "=" * 60)
    logger.info("RESULTADO DA DESCOBERTA")
    logger.info("=" * 60)
    logger.info(f"Total de bundles encontrados: {len(new_ids)}")
    logger.info(f"Bundles sem mudança: {len(unchanged)}")
    
    if added:
        logger.success(f"NOVOS bundles: {len(added)}")
        if len(added) <= 20:
            logger.info(f"IDs novos: {sorted(added)}")
        else:
            logger.info(f"Primeiros 20: {sorted(list(added))[:20]}")
    
    if removed:
        logger.warning(f"Bundles REMOVIDOS: {len(removed)}")
        if len(removed) <= 20:
            logger.info(f"IDs removidos: {sorted(removed)}")
        else:
            logger.info(f"Primeiros 20: {sorted(list(removed))[:20]}")
    
    # Salva resultado em JSON
    output_data = {
        'last_updated': datetime.utcnow().isoformat() + 'Z',
        'total': len(new_ids),
        'bundle_ids': sorted(new_ids_list),
        'diff': {
            'added': sorted(list(added)),
            'removed': sorted(list(removed)),
            'added_count': len(added),
            'removed_count': len(removed)
        }
    }
    
    json_file.parent.mkdir(exist_ok=True)
    with open(json_file, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, indent=2)
    
    logger.success(f"Arquivo atualizado: {json_file}")
    
    # Salva lista de mudanças separada (útil para scripts)
    if added or removed:
        diff_file = Path("data/bundle_changes.json")
        diff_data = {
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'added': sorted(list(added)),
            'removed': sorted(list(removed)),
            'added_count': len(added),
            'removed_count': len(removed)
        }
        
        with open(diff_file, 'w', encoding='utf-8') as f:
            json.dump(diff_data, f, indent=2)
        
        logger.info(f"Mudanças salvas em: {diff_file}")
    
    logger.info("=" * 60)
    
    return {
        'total': len(new_ids),
        'added': len(added),
        'removed': len(removed)
    }


if __name__ == "__main__":
    print("=" * 70)
    print("DESCOBERTA INTELIGENTE DE BUNDLES DA STEAM")
    print("=" * 70)
    print("\nEstrategia: Forca bruta completa (ID 1 a 35000)")
    print("Tempo estimado: 10-15 minutos")
    print("Sistema de diff: Detecta novos e removidos automaticamente")
    print("\n" + "-" * 70 + "\n")
    
    try:
        result = asyncio.run(discover_with_diff())
        
        print("\n" + "=" * 70)
        print("CONCLUIDO!")
        print("=" * 70)
        print(f"\nTotal de bundles: {result['total']}")
        print(f"Novos: {result['added']}")
        print(f"Removidos: {result['removed']}")
        
        if result['added'] > 0 or result['removed'] > 0:
            print("\nATENCAO: Detectadas mudancas!")
            print("O scraper usara automaticamente a lista atualizada")
        
    except KeyboardInterrupt:
        print("\n\nInterrompido pelo usuario")
        sys.exit(1)
    except Exception as e:
        print(f"\n\nErro: {e}")
        sys.exit(1)
