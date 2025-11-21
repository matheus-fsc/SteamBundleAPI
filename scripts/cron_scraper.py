#!/usr/bin/env python3
"""
Script wrapper para execução do cron
Verifica se é primeira execução e executa discovery automaticamente
"""
import asyncio
import os
import sys
import subprocess
from pathlib import Path
import fcntl
import time

# Adiciona path do projeto
sys.path.insert(0, '/app')

from scraper.database import Database
from scraper.logger import Logger
from sqlalchemy import select, func

# Flag para indicar que primeira execução já foi feita
FIRST_RUN_FLAG = Path('/app/data/.first_run_completed')
LOCK_FILE = Path('/app/data/.cron_lock')


async def check_and_run():
    """Verifica estado do banco e executa rotina apropriada"""
    logger = Logger('cron_wrapper')
    
    # Tenta adquirir lock para evitar execuções concorrentes
    lock_fd = None
    try:
        lock_fd = open(LOCK_FILE, 'w')
        fcntl.flock(lock_fd.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except IOError:
        # Já existe outra instância rodando
        logger.info("⏭️  Outra instância já está rodando, pulando...")
        return 0
    
    try:
        logger.info("🤖 Iniciando rotina automática do cron")
        
        # Verifica se banco está vazio
        logger.info(f"🔗 DATABASE_URL: {os.getenv('DATABASE_URL', 'NOT SET')}")
        db = Database()
        logger.info("🔧 Inicializando banco de dados...")
        await db.init_db()
        logger.success("✅ Banco de dados inicializado!")
        
        from scraper.database import BundleModel
        async with db.async_session() as session:
            result = await session.execute(select(func.count(BundleModel.id)))
            total_bundles = result.scalar()
        
        is_first_run = (total_bundles == 0)
        
        if is_first_run:
            logger.info("🎯 PRIMEIRA EXECUÇÃO DETECTADA!")
            logger.info("📋 Executando discovery completo...")
            
            # Executa discovery E AGUARDA terminar
            discovery_result = subprocess.run(
                [sys.executable, '/app/scripts/discover_with_diff.py'],
                capture_output=True,
                text=True,
                timeout=1800  # 30 minutos de timeout
            )
            
            if discovery_result.returncode != 0:
                logger.error(f"❌ Erro no discovery: {discovery_result.stderr}")
                return 1
            
            logger.success("✅ Discovery completo!")
            
            # Marca que primeira execução foi concluída
            FIRST_RUN_FLAG.touch()
            logger.info("✅ Flag de primeira execução criada")
        else:
            logger.info(f"ℹ️  Banco já possui {total_bundles} bundles")
        
        # Agora executa o scraping normal
        logger.info("🚀 Iniciando scraping completo...")
        
        scraping_result = subprocess.run(
            [sys.executable, '-m', 'scraper.main_with_db'],
            cwd='/app',
            capture_output=False  # Output vai direto para stdout (logs do docker)
        )
        
        if scraping_result.returncode != 0:
            logger.error("❌ Erro no scraping")
            return 1
        
        logger.success("✅ Rotina completa!")
        
        await db.close()
        return 0
        
    except Exception as e:
        import traceback
        logger.error(f"❌ Erro fatal: {e}")
        logger.error(f"Traceback completo:\n{traceback.format_exc()}")
        return 1
    finally:
        # Libera o lock
        if lock_fd:
            fcntl.flock(lock_fd.fileno(), fcntl.LOCK_UN)
            lock_fd.close()
            try:
                LOCK_FILE.unlink()
            except:
                pass


if __name__ == '__main__':
    exit_code = asyncio.run(check_and_run())
    sys.exit(exit_code)
