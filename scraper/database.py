from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base, relationship
from sqlalchemy import (
    Column, String, Float, Integer, JSON, DateTime, 
    Boolean, ForeignKey, Text, Index
)
import datetime
from typing import Optional, List, Dict, Any
import os

Base = declarative_base()


class BundleModel(Base):
    """Modelo principal de Bundle com histórico de preços"""
    __tablename__ = 'bundles'
    
    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    url = Column(String)
    image_url = Column(String)  # Header image do bundle
    
    # Preços atuais
    final_price = Column(Float)
    original_price = Column(Float)
    discount = Column(Integer, default=0)
    currency = Column(String, default='BRL')
    
    # Metadados
    games_count = Column(Integer, default=0)
    is_valid = Column(Boolean, default=True)
    is_nsfw = Column(Boolean, default=False)  # Conteúdo +18/adulto
    needs_browser_scraping = Column(Boolean, default=False)  # Para preços dinâmicos
    
    # Timestamps
    first_seen = Column(DateTime, default=datetime.datetime.utcnow)
    last_updated = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
    
    # JSON fields
    games = Column(JSON)  # Lista de jogos incluídos
    price_history = Column(JSON, default=list)  # Histórico completo de preços
    
    # Índices para queries rápidas
    __table_args__ = (
        Index('idx_discount', 'discount'),
        Index('idx_currency', 'currency'),
        Index('idx_last_updated', 'last_updated'),
    )
    
    def add_price_snapshot(self, final: float, original: Optional[float], discount: int):
        """Adiciona snapshot de preço ao histórico"""
        if self.price_history is None:
            self.price_history = []
        
        snapshot = {
            'date': datetime.datetime.utcnow().isoformat(),
            'final': final,
            'original': original,
            'discount': discount,
            'currency': self.currency
        }
        
        # Adiciona ao histórico
        history = self.price_history if isinstance(self.price_history, list) else []
        history.append(snapshot)
        self.price_history = history
    
    def get_real_discount(self) -> Dict[str, Any]:
        """
        Calcula se o desconto é real ou "metade do dobro"
        Compara preço atual com histórico
        """
        if not self.price_history or len(self.price_history) < 2:
            return {'is_real': True, 'reason': 'Sem histórico suficiente'}
        
        history = self.price_history if isinstance(self.price_history, list) else []
        
        # Pega preços dos últimos 30 dias (sem promoção)
        thirty_days_ago = datetime.datetime.utcnow() - datetime.timedelta(days=30)
        regular_prices = []
        
        for entry in history:
            entry_date = datetime.datetime.fromisoformat(entry['date'])
            if entry_date >= thirty_days_ago and entry.get('discount', 0) == 0:
                if entry.get('final'):
                    regular_prices.append(entry['final'])
        
        if not regular_prices:
            return {'is_real': True, 'reason': 'Sem preços regulares no histórico'}
        
        # Preço regular médio
        avg_regular_price = sum(regular_prices) / len(regular_prices)
        
        # Compara com preço original atual
        if self.original_price:
            # Se o "original" é muito maior que a média histórica, é suspeito
            if self.original_price > avg_regular_price * 1.5:
                return {
                    'is_real': False,
                    'reason': 'Preço original inflado',
                    'avg_regular': avg_regular_price,
                    'claimed_original': self.original_price,
                    'inflation_percent': round(((self.original_price / avg_regular_price) - 1) * 100, 1)
                }
        
        return {
            'is_real': True,
            'reason': 'Preço condizente com histórico',
            'avg_regular': avg_regular_price
        }


class GameModel(Base):
    """Modelo de jogo individual (para análise futura)"""
    __tablename__ = 'games'
    
    app_id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    url = Column(String)
    
    first_seen = Column(DateTime, default=datetime.datetime.utcnow)
    last_updated = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
    
    __table_args__ = (
        Index('idx_game_name', 'name'),
    )


class BundleAnalyticsModel(Base):
    """Modelo de métricas/analytics para bundles"""
    __tablename__ = 'bundle_analytics'
    
    bundle_id = Column(String, ForeignKey('bundles.id'), primary_key=True)
    view_count = Column(Integer, default=0)
    last_viewed_at = Column(DateTime)
    
    # Métricas agregadas
    total_clicks = Column(Integer, default=0)  # Cliques no link da Steam
    first_tracked_at = Column(DateTime, default=datetime.datetime.utcnow)
    
    __table_args__ = (
        Index('idx_view_count', 'view_count'),
        Index('idx_last_viewed', 'last_viewed_at'),
    )


class ScrapingLogModel(Base):
    """Log de execuções do scraper"""
    __tablename__ = 'scraping_logs'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    started_at = Column(DateTime, default=datetime.datetime.utcnow)
    finished_at = Column(DateTime)
    
    bundles_found = Column(Integer, default=0)
    bundles_scraped = Column(Integer, default=0)
    bundles_failed = Column(Integer, default=0)
    
    success = Column(Boolean, default=False)
    error_message = Column(Text)
    
    # Estatísticas
    stats = Column(JSON)


class Database:
    """Gerenciador de conexões com banco de dados"""
    
    def __init__(self, database_url: Optional[str] = None):
        """
        Inicializa conexão com banco
        
        Args:
            database_url: URL de conexão. Se None, usa variável de ambiente ou SQLite
        """
        if database_url is None:
            # Prioridade: ENV > PostgreSQL local > SQLite
            database_url = os.getenv('DATABASE_URL')
            
            if not database_url:
                # Para desenvolvimento/testes: SQLite
                database_url = "sqlite+aiosqlite:///./steam_bundles.db"
                # Para produção no Orange Pi: PostgreSQL
                # database_url = "postgresql+asyncpg://steam:password@localhost/steam_bundles"
        
        self.database_url = database_url
        self.engine = create_async_engine(
            database_url,
            echo=False,  # True para debug SQL
            pool_pre_ping=True,  # Verifica conexão antes de usar
            pool_size=5,
            max_overflow=10
        )
        
        self.async_session = async_sessionmaker(
            self.engine,
            class_=AsyncSession,
            expire_on_commit=False
        )
    
    async def init_db(self):
        """Cria todas as tabelas"""
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    
    async def drop_all(self):
        """Remove todas as tabelas (cuidado!)"""
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
    
    async def get_session(self) -> AsyncSession:
        """Retorna uma nova sessão"""
        return self.async_session()
    
    async def close(self):
        """Fecha conexões"""
        await self.engine.dispose()
    
    async def save_bundle(self, bundle_data: Dict[str, Any]) -> BundleModel:
        """
        Salva ou atualiza bundle no banco
        
        Args:
            bundle_data: Dicionário com dados do bundle
            
        Returns:
            Modelo do bundle salvo
        """
        async with self.async_session() as session:
            async with session.begin():
                # Busca bundle existente
                bundle = await session.get(BundleModel, bundle_data['id'])
                
                if bundle is None:
                    # Novo bundle
                    bundle = BundleModel(
                        id=bundle_data['id'],
                        name=bundle_data.get('name'),
                        url=bundle_data.get('url'),
                        image_url=bundle_data.get('images', {}).get('header') if isinstance(bundle_data.get('images'), dict) else None,
                        games=bundle_data.get('games', []),
                        games_count=len(bundle_data.get('games', [])),
                        is_valid=bundle_data.get('is_valid', True),
                        is_nsfw=bundle_data.get('is_nsfw', False),  # Conteúdo +18
                        needs_browser_scraping=bundle_data.get('needs_browser_scraping', False)
                    )
                else:
                    # Atualiza dados
                    bundle.name = bundle_data.get('name', bundle.name)
                    bundle.url = bundle_data.get('url', bundle.url)
                    
                    # Atualiza image_url se disponível
                    if isinstance(bundle_data.get('images'), dict):
                        image_url = bundle_data['images'].get('header')
                        if image_url:
                            bundle.image_url = image_url
                    
                    bundle.games = bundle_data.get('games', bundle.games)
                    bundle.games_count = len(bundle_data.get('games', []))
                    bundle.is_valid = bundle_data.get('is_valid', bundle.is_valid)
                    bundle.is_nsfw = bundle_data.get('is_nsfw', bundle.is_nsfw)  # Atualiza NSFW
                    bundle.needs_browser_scraping = bundle_data.get('needs_browser_scraping', False)
                
                # Atualiza preços e adiciona ao histórico
                price_data = bundle_data.get('price', {})
                if isinstance(price_data, dict):
                    final = price_data.get('final')
                    original = price_data.get('original')
                    discount = price_data.get('discount', 0)  # Discount está dentro de price!
                    currency = price_data.get('currency', 'BRL')
                    
                    # Só adiciona ao histórico se preço mudou
                    if final is not None and (bundle.final_price != final or bundle.discount != discount):
                        bundle.add_price_snapshot(final, original, discount)
                    
                    bundle.final_price = final
                    bundle.original_price = original
                    bundle.discount = discount
                    bundle.currency = currency
                
                bundle.last_updated = datetime.datetime.utcnow()
                
                session.add(bundle)
            
            # Refresh fora do transaction context
            await session.refresh(bundle)
            
            return bundle
    
    async def get_bundles_needing_browser(self) -> List[BundleModel]:
        """Retorna bundles que precisam de scraping com browser"""
        async with self.async_session() as session:
            from sqlalchemy import select
            
            result = await session.execute(
                select(BundleModel).where(
                    BundleModel.needs_browser_scraping == True
                )
            )
            return result.scalars().all()
    
    async def get_bundle_by_id(self, bundle_id: str) -> Optional[BundleModel]:
        """Busca bundle por ID"""
        async with self.async_session() as session:
            return await session.get(BundleModel, bundle_id)
    
    async def get_top_discounts(self, limit: int = 10, currency: str = 'BRL') -> List[BundleModel]:
        """Retorna bundles com maiores descontos"""
        async with self.async_session() as session:
            from sqlalchemy import select
            
            result = await session.execute(
                select(BundleModel)
                .where(BundleModel.currency == currency)
                .where(BundleModel.is_valid == True)
                .where(BundleModel.discount > 0)
                .order_by(BundleModel.discount.desc())
                .limit(limit)
            )
            return result.scalars().all()
    
    async def increment_bundle_view(self, bundle_id: str) -> BundleAnalyticsModel:
        """Incrementa contador de visualizações de um bundle"""
        async with self.async_session() as session:
            async with session.begin():
                # Busca ou cria analytics
                analytics = await session.get(BundleAnalyticsModel, bundle_id)
                
                if analytics is None:
                    analytics = BundleAnalyticsModel(
                        bundle_id=bundle_id,
                        view_count=1,
                        last_viewed_at=datetime.datetime.utcnow()
                    )
                else:
                    analytics.view_count += 1
                    analytics.last_viewed_at = datetime.datetime.utcnow()
                
                session.add(analytics)
            
            await session.refresh(analytics)
            return analytics
    
    async def increment_bundle_click(self, bundle_id: str) -> BundleAnalyticsModel:
        """Incrementa contador de cliques em um bundle"""
        async with self.async_session() as session:
            async with session.begin():
                analytics = await session.get(BundleAnalyticsModel, bundle_id)
                
                if analytics is None:
                    analytics = BundleAnalyticsModel(
                        bundle_id=bundle_id,
                        total_clicks=1
                    )
                else:
                    analytics.total_clicks += 1
                
                session.add(analytics)
            
            await session.refresh(analytics)
            return analytics
    
    async def get_top_viewed_bundles(self, limit: int = 10) -> List[tuple]:
        """Retorna bundles mais visualizados com seus dados"""
        async with self.async_session() as session:
            from sqlalchemy import select
            
            result = await session.execute(
                select(BundleModel, BundleAnalyticsModel)
                .join(BundleAnalyticsModel, BundleModel.id == BundleAnalyticsModel.bundle_id)
                .where(BundleModel.is_valid == True)
                .order_by(BundleAnalyticsModel.view_count.desc())
                .limit(limit)
            )
            return result.all()
    
    async def get_best_deals(self, limit: int = 10, min_discount: int = 50) -> List[BundleModel]:
        """Retorna melhores ofertas (alto desconto + bom preço)"""
        async with self.async_session() as session:
            from sqlalchemy import select
            
            result = await session.execute(
                select(BundleModel)
                .where(BundleModel.is_valid == True)
                .where(BundleModel.discount >= min_discount)
                .where(BundleModel.final_price > 0)
                .order_by(
                    (BundleModel.discount * BundleModel.games_count).desc()  # Score: desconto * qtd jogos
                )
                .limit(limit)
            )
            return result.scalars().all()


# Instância global (opcional)
db: Optional[Database] = None


def get_db() -> Database:
    """Retorna instância do banco (singleton)"""
    global db
    if db is None:
        db = Database()
    return db
