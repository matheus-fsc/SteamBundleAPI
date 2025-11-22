import json
import os
from typing import Dict, Any
from pathlib import Path


class ScrapingConfig:
    # Steam Partner API Key
    API_KEY = os.getenv('STEAM_API_KEY', '516C1E2D6FA9FECFB0DE14393F3FDCF0')
    
    # URLs da Steam
    BUNDLE_URL_TEMPLATE = "https://store.steampowered.com/bundle/{bundle_id}/"
    
    # API Partner v1 (oficial)
    BUNDLE_API_URL = "https://api.steampowered.com/IStoreBrowseService/GetItems/v1/"
    
    # APIs públicas (deprecated)
    FEATURED_API_URL = "https://store.steampowered.com/api/featured"
    FEATURED_CATEGORIES_API_URL = "https://store.steampowered.com/api/featuredcategories"
    STORE_SEARCH_API_URL = "https://store.steampowered.com/api/storesearch"
    
    # Configurações
    REQUEST_DELAY = 2  
    TIMEOUT = 30
    MAX_RETRIES = 3
    COUNTRY_CODE = "BR"
    LANGUAGE = "portuguese"
    
    HEADERS = {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/html',
        'Accept-Language': 'en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
    }
    
    MAX_CONCURRENT_REQUESTS = 5
    BATCH_SIZE = 100  # API aceita até 100 IDs por request
