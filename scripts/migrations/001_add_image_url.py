#!/usr/bin/env python3
"""
Migration 001: Adiciona coluna image_url
"""
import asyncio
import sys
sys.path.insert(0, '/app')

from sqlalchemy import text
from scraper.database import Database
from scraper.logger import Logger


async def apply_migration():
    logger = Logger('migration_001')
    db = Database()
    
    logger.info("🔄 Aplicando migration 001: image_url")
    
    async with db.async_session() as session:
        try:
            # Adiciona coluna no PostgreSQL local
            await session.execute(text(
                "ALTER TABLE bundles ADD COLUMN IF NOT EXISTS image_url TEXT"
            ))
            await session.commit()
            logger.info("✅ Coluna image_url criada no PostgreSQL local")
            
        except Exception as e:
            logger.error(f"❌ Erro na migration local: {e}")
            raise
    
    logger.info("✅ Migration 001 concluída com sucesso!")


if __name__ == '__main__':
    asyncio.run(apply_migration())
