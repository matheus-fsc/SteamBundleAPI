import json
from typing import Dict, Any
from pathlib import Path


class ScrapingConfig:
    # URLs corretas da Steam (2024+)
    BASE_URL = "https://store.steampowered.com/search/?category1=996&page=1"  # categoria 996 = bundles
    BUNDLE_URL_TEMPLATE = "https://store.steampowered.com/bundle/{bundle_id}/"
    
    REQUEST_DELAY = 2  
    TIMEOUT = 30
    MAX_RETRIES = 3
    
    HEADERS = {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none'
    }
    
    SELECTORS = {
        # Página de busca/listagem (search/?category1=996)
        'search_result': 'a.search_result_row',  # Links dos resultados de busca
        'bundle_id_attr': 'data-ds-bundleid',     # Atributo com ID do bundle
        
        # Página individual do bundle
        'bundle_name': '.pageheader',
        'bundle_price': '.discount_final_price, .game_purchase_price',
        'bundle_original_price': '.discount_original_price',
        'bundle_discount': '.discount_pct',
        'games_list': '.tab_item',  # Atualizado: tabs dos jogos
        'game_name': '.tab_item_name',
        'game_link': 'a[data-ds-appid]',
        'game_app_id': 'data-ds-appid',
    }
    
    MAX_CONCURRENT_REQUESTS = 5
    BATCH_SIZE = 10
    
    @classmethod
    def load_from_json(cls, filepath: str = None):
        if filepath is None:
            default_path = Path(__file__).parent.parent / 'services' / 'updateDetails' / 'scraping-config.json'
            if default_path.exists():
                filepath = str(default_path)
            else:
                return  # Usa configs padrão
        
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                config = json.load(f)
                
                for key, value in config.items():
                    if hasattr(cls, key.upper()):
                        setattr(cls, key.upper(), value)
                    elif hasattr(cls, key):
                        setattr(cls, key, value)
        except Exception as e:
            print(f"Erro ao carregar config do arquivo: {e}")
    
    @classmethod
    def to_dict(cls) -> Dict[str, Any]:
        """Retorna configurações como dicionário"""
        return {
            'BASE_URL': cls.BASE_URL,
            'BUNDLE_URL_TEMPLATE': cls.BUNDLE_URL_TEMPLATE,
            'REQUEST_DELAY': cls.REQUEST_DELAY,
            'TIMEOUT': cls.TIMEOUT,
            'MAX_RETRIES': cls.MAX_RETRIES,
            'MAX_CONCURRENT_REQUESTS': cls.MAX_CONCURRENT_REQUESTS,
            'BATCH_SIZE': cls.BATCH_SIZE,
            'SELECTORS': cls.SELECTORS
        }
