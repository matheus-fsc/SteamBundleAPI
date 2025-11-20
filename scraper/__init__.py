"""
Steam Bundle Scraper
Scraper modular para extrair informações de bundles da Steam
Com suporte a banco de dados e estratégia híbrida de scraping
"""

from .scraper import BundleScraper
from .filters import BundleFilter
from .mapper import BundleDataMapper
from .config import ScrapingConfig
from .logger import Logger
from .database import Database, BundleModel, GameModel
from .browser_scraper import BrowserScraper

__version__ = "2.0.0"
__all__ = [
    'BundleScraper',
    'BundleFilter',
    'BundleDataMapper',
    'ScrapingConfig',
    'Logger',
    'Database',
    'BundleModel',
    'GameModel',
    'BrowserScraper'
]
