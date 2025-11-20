import asyncio
import json
from pathlib import Path
from scraper import BundleScraper
from filters import BundleFilter
from logger import Logger


async def main():
    """Exemplo de uso completo do scraper"""
    logger = Logger('main')
    
    logger.start_operation("Execução do scraper")
    
    try:
        # Inicializa scraper
        async with BundleScraper() as scraper:
            # Opção 1: Scrape todos os bundles
            bundles = await scraper.scrape_all_bundles()
            
            # Opção 2: Scrape bundles específicos
            # bundle_ids = ['1234', '5678', '9012']
            # bundles = await scraper.scrape_all_bundles(bundle_ids)
            
            # Opção 3: Scrape apenas um bundle (teste)
            # bundle = await scraper.scrape_single_bundle('1234')
            # bundles = [bundle] if bundle else []
            
            logger.info(f"Total de bundles extraídos: {len(bundles)}")
            
            # Aplica filtros
            filter_service = BundleFilter()
            
            logger.info("Aplicando filtros...")
            bundles = filter_service.filter_valid(bundles)
            logger.info(f"Após validação: {len(bundles)} bundles")
            
            bundles = filter_service.filter_duplicates(bundles)
            logger.info(f"Após remover duplicatas: {len(bundles)} bundles")
            
            # Filtros opcionais
            # bundles = filter_service.filter_by_discount(bundles, min_discount=50)
            # bundles = filter_service.filter_by_currency(bundles, 'BRL')
            # bundles = filter_service.filter_by_game_count(bundles, min_games=3)
            
            # Estatísticas
            stats = filter_service.get_statistics(bundles)
            logger.info(f"Estatísticas: {json.dumps(stats, indent=2)}")
            
            # Ordena por desconto
            bundles = filter_service.sort_by_discount(bundles)
            
            # Salva resultados
            output_dir = Path(__file__).parent.parent / 'data'
            output_dir.mkdir(exist_ok=True)
            
            output_file = output_dir / 'bundles.json'
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(bundles, f, indent=2, ensure_ascii=False)
            
            logger.success(f"Dados salvos em: {output_file}")
            
            # Mostra top 5 bundles com maior desconto
            logger.info("\n=== TOP 5 BUNDLES COM MAIOR DESCONTO ===")
            for i, bundle in enumerate(bundles[:5], 1):
                name = bundle.get('name', 'N/A')
                discount = bundle.get('discount', 0)
                price = bundle.get('price', {})
                final_price = price.get('formatted', 'N/A') if isinstance(price, dict) else 'N/A'
                games_count = len(bundle.get('games', []))
                
                logger.info(f"{i}. {name}")
                logger.info(f"   Desconto: {discount}% | Preço: {final_price} | Jogos: {games_count}")
                logger.info(f"   URL: {bundle.get('url', 'N/A')}\n")
            
            logger.end_operation("Execução do scraper", success=True)
            
            return bundles
            
    except Exception as e:
        logger.error(f"Erro durante execução: {e}")
        logger.end_operation("Execução do scraper", success=False)
        raise


async def test_single_bundle():
    """Testa scraping de um único bundle"""
    logger = Logger('test')
    
    # Substitua pelo ID de um bundle real
    bundle_id = '28631'  # Exemplo: Valve Complete Pack
    
    logger.info(f"Testando scraping do bundle {bundle_id}...")
    
    async with BundleScraper() as scraper:
        bundle = await scraper.scrape_single_bundle(bundle_id)
        
        if bundle:
            logger.success("Bundle extraído com sucesso!")
            print(json.dumps(bundle, indent=2, ensure_ascii=False))
        else:
            logger.error("Falha ao extrair bundle")


if __name__ == "__main__":
    # Execução principal
    asyncio.run(main())
    
    # Ou teste de um único bundle
    # asyncio.run(test_single_bundle())
