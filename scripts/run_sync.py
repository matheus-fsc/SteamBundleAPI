"""
Script para executar apenas a sincronização Supabase
Útil para executar manualmente ou em cron separado
"""
import asyncio
import sys
from scraper.sync_supabase import sync_to_supabase
from scraper.logger import Logger


async def main():
    """Execução da sincronização"""
    logger = Logger('sync_script')
    
    logger.start_operation("Sincronização Supabase")
    
    try:
        await sync_to_supabase(
            hours_ago=24,           # Bundles das últimas 24h
            only_with_discount=True, # Apenas com desconto
            cleanup_old=False        # Não limpa (pode fazer manualmente)
        )
        
        logger.end_operation("Sincronização Supabase", success=True)
        return 0
    
    except Exception as e:
        logger.error(f"Erro durante sincronização: {e}")
        logger.end_operation("Sincronização Supabase", success=False)
        return 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
