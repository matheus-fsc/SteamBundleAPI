"""
Configurações de scraping - equivalente ao ScrapingConfigManager.js
"""
import json
from typing import Dict, Any
from pathlib import Path


class ScrapingConfig:
    """Configurações centralizadas para o scraper"""
    
    BASE_URL = "https://store.steampowered.com/bundles/"
    BUNDLE_URL_TEMPLATE = "https://store.steampowered.com/bundle/{bundle_id}/"
    
    # Delays e timeouts
    REQUEST_DELAY = 2  # segundos entre requests
    TIMEOUT = 30
    MAX_RETRIES = 3
    
    # Headers para evitar bloqueio
    HEADERS = {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
    }
    
    # Seletores CSS (ajustar conforme necessário)
    SELECTORS = {
        'bundle_links': '.search_result_row',
        'bundle_id': 'data-ds-bundleid',
        'bundle_name': '.pageheader',
        'bundle_price': '.discount_final_price',
        'bundle_original_price': '.discount_original_price',
        'bundle_discount': '.discount_pct',
        'games_list': '.bundle_item',
        'game_name': '.tab_item_name',
        'game_link': 'a[data-ds-appid]',
        'game_app_id': 'data-ds-appid',
    }
    
    # Configurações de concorrência
    MAX_CONCURRENT_REQUESTS = 5
    BATCH_SIZE = 10
    
    @classmethod
    def load_from_json(cls, filepath: str = None):
        """
        Carrega configurações de um arquivo JSON
        Compatível com scraping-config.json do projeto original
        """
        if filepath is None:
            # Tenta carregar do diretório padrão
            default_path = Path(__file__).parent.parent / 'services' / 'updateDetails' / 'scraping-config.json'
            if default_path.exists():
                filepath = str(default_path)
            else:
                return  # Usa configs padrão
        
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                config = json.load(f)
                
                # Atualiza atributos da classe com valores do JSON
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
