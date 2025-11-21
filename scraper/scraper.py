"""
Scraper de Bundles da Steam usando API oficial
Versão 2.0 - Apenas API, sem parsing de HTML
"""
import asyncio
import aiohttp
from typing import List, Dict, Optional
from .config import ScrapingConfig
from .logger import Logger


class BundleScraper:
    """
    Scraper principal para bundles da Steam usando API oficial
    
    API: /actions/ajaxresolvebundles
    Aceita múltiplos IDs separados por vírgula
    """
    
    def __init__(self, config: Optional[ScrapingConfig] = None):
        self.config = config or ScrapingConfig()
        self.logger = Logger()
        self.session: Optional[aiohttp.ClientSession] = None
        self._semaphore: Optional[asyncio.Semaphore] = None
    
    async def __aenter__(self):
        """Context manager para gerenciar sessão HTTP"""
        self.session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=self.config.TIMEOUT),
            headers=self.config.HEADERS
        )
        self._semaphore = asyncio.Semaphore(self.config.MAX_CONCURRENT_REQUESTS)
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Fecha sessão HTTP ao sair do context manager"""
        if self.session:
            await self.session.close()
    
    async def scrape_bundle_list(self) -> List[str]:
        """
        Retorna lista de IDs de bundles conhecidos
        
        Returns:
            Lista de IDs de bundles
        """
        self.logger.start_operation("Carregando lista de bundles")
        
        # Carrega lista de IDs conhecidos
        try:
            from .known_bundles import ALL_BUNDLE_IDS
            bundle_ids = [str(id) for id in ALL_BUNDLE_IDS]
            self.logger.success(f"Carregados {len(bundle_ids)} bundle IDs")
        except ImportError:
            self.logger.warning("known_bundles.py não encontrado, usando lista padrão")
            # Fallback para lista básica
            bundle_ids = ["232", "5699", "6684", "14343", "19975", "20187", "21200", "21661", "25657", "28631"]
            self.logger.info(f"Usando {len(bundle_ids)} IDs padrão")
        
        self.logger.end_operation("Carregando lista de bundles")
        return bundle_ids
    
    async def scrape_bundle_details(self, bundle_id: str) -> Optional[Dict]:
        """
        Busca detalhes de um bundle usando a API oficial da Steam
        
        Args:
            bundle_id: ID do bundle na Steam
            
        Returns:
            Dicionário com dados estruturados do bundle ou None se falhar
        """
        # Usa API oficial da Steam
        params = {
            'bundleids': str(bundle_id),
            'cc': self.config.COUNTRY_CODE,
            'l': self.config.LANGUAGE
        }
        
        self.logger.info(f"Buscando bundle {bundle_id} via API...")
        
        try:
            async with self._semaphore:
                async with self.session.get(self.config.BUNDLE_API_URL, params=params) as response:
                    if response.status == 200:
                        data = await response.json()
                        
                        if not data or len(data) == 0:
                            self.logger.warning(f"Bundle {bundle_id}: API retornou vazio")
                            return None
                        
                        bundle_data = data[0]
                        
                        # Verifica se bundle tem nome (válido)
                        if not bundle_data.get('name'):
                            return None
                        
                        # Converte para formato do scraper
                        result = {
                            'id': str(bundle_data.get('bundleid')),
                            'name': bundle_data.get('name'),
                            'url': self.config.BUNDLE_URL_TEMPLATE.format(bundle_id=bundle_id),
                            'price': {
                                'final': bundle_data.get('final_price', 0) / 100,  # Centavos → Reais
                                'original': bundle_data.get('initial_price', 0) / 100,
                                'discount': bundle_data.get('discount_percent', 0),
                                'formatted_final': bundle_data.get('formatted_final_price'),
                                'formatted_original': bundle_data.get('formatted_orig_price'),
                                'currency': 'BRL'
                            },
                            'images': {
                                'header': bundle_data.get('header_image_url'),
                                'capsule': bundle_data.get('main_capsule'),
                                'library': bundle_data.get('library_asset')
                            },
                            'platforms': {
                                'windows': bundle_data.get('available_windows', False),
                                'mac': bundle_data.get('available_mac', False),
                                'linux': bundle_data.get('available_linux', False)
                            },
                            'vr': {
                                'supported': bundle_data.get('support_vrhmd', False),
                                'only': bundle_data.get('support_vrhmd_only', False)
                            },
                            'app_ids': bundle_data.get('appids', []),
                            'package_ids': bundle_data.get('packageids', []),
                            'coming_soon': bundle_data.get('coming_soon', False),
                            'games': [],
                            'needs_browser_scraping': False  # API retorna tudo
                        }
                        
                        # Preenche lista de jogos
                        if result['app_ids']:
                            result['games'] = [{'app_id': app_id} for app_id in result['app_ids']]
                        
                        self.logger.success(f"Bundle {bundle_id} extraído via API: {result['name']}")
                        return result
                    
                    else:
                        self.logger.warning(f"Bundle {bundle_id}: Status {response.status}")
                        return None
                        
        except Exception as e:
            self.logger.error(f"Erro ao processar bundle {bundle_id}: {e}")
            return None
    
    async def scrape_bundles_batch(self, bundle_ids: List[str]) -> List[Dict]:
        """
        Busca múltiplos bundles em um único request (API aceita batch)
        
        Args:
            bundle_ids: Lista de IDs (até 100)
            
        Returns:
            Lista de bundles válidos
        """
        if not bundle_ids:
            return []
        
        # API aceita até 100 IDs
        ids_str = ','.join(str(id) for id in bundle_ids[:100])
        
        params = {
            'bundleids': ids_str,
            'cc': self.config.COUNTRY_CODE,
            'l': self.config.LANGUAGE
        }
        
        try:
            async with self._semaphore:
                async with self.session.get(self.config.BUNDLE_API_URL, params=params) as response:
                    if response.status == 200:
                        data = await response.json()
                        
                        bundles = []
                        for bundle_data in data:
                            if not bundle_data.get('name'):
                                continue
                            
                            bundle_id = bundle_data.get('bundleid')
                            
                            result = {
                                'id': str(bundle_id),
                                'name': bundle_data.get('name'),
                                'url': self.config.BUNDLE_URL_TEMPLATE.format(bundle_id=bundle_id),
                                'price': {
                                    'final': bundle_data.get('final_price', 0) / 100,
                                    'original': bundle_data.get('initial_price', 0) / 100,
                                    'discount': bundle_data.get('discount_percent', 0),
                                    'formatted_final': bundle_data.get('formatted_final_price'),
                                    'formatted_original': bundle_data.get('formatted_orig_price'),
                                    'currency': 'BRL'
                                },
                                'images': {
                                    'header': bundle_data.get('header_image_url'),
                                    'capsule': bundle_data.get('main_capsule'),
                                    'library': bundle_data.get('library_asset')
                                },
                                'platforms': {
                                    'windows': bundle_data.get('available_windows', False),
                                    'mac': bundle_data.get('available_mac', False),
                                    'linux': bundle_data.get('available_linux', False)
                                },
                                'vr': {
                                    'supported': bundle_data.get('support_vrhmd', False),
                                    'only': bundle_data.get('support_vrhmd_only', False)
                                },
                                'app_ids': bundle_data.get('appids', []),
                                'package_ids': bundle_data.get('packageids', []),
                                'coming_soon': bundle_data.get('coming_soon', False),
                                'games': [{'app_id': app_id} for app_id in bundle_data.get('appids', [])],
                                'needs_browser_scraping': False
                            }
                            
                            bundles.append(result)
                        
                        return bundles
        except Exception as e:
            self.logger.error(f"Erro ao buscar batch: {e}")
            return []
    
    async def scrape_all_bundles(self, bundle_ids: Optional[List[str]] = None) -> List[Dict]:
        """
        Orquestra todo o processo de scraping usando batch requests
        
        Args:
            bundle_ids: Lista opcional de IDs específicos. Se None, busca todos.
            
        Returns:
            Lista de bundles com dados completos
        """
        self.logger.start_operation("Scraping completo de bundles")
        
        # Se não passou IDs específicos, busca lista completa
        if bundle_ids is None:
            bundle_ids = await self.scrape_bundle_list()
        
        if not bundle_ids:
            self.logger.error("Nenhum bundle encontrado para processar")
            return []
        
        self.logger.info(f"Processando {len(bundle_ids)} bundles...")
        
        # Processa bundles em batches (API aceita até 100 IDs por request)
        bundles = []
        batch_size = 100
        
        for i in range(0, len(bundle_ids), batch_size):
            batch = bundle_ids[i:i + batch_size]
            self.logger.info(f"Processando batch {i//batch_size + 1} ({len(batch)} bundles)...")
            
            batch_bundles = await self.scrape_bundles_batch(batch)
            bundles.extend(batch_bundles)
            
            self.logger.info(f"Batch concluído: {len(batch_bundles)}/{len(batch)} bundles válidos")
            
            # Pequena pausa entre batches
            if i + batch_size < len(bundle_ids):
                await asyncio.sleep(self.config.REQUEST_DELAY)
        
        self.logger.success(f"Scraped {len(bundles)}/{len(bundle_ids)} bundles com sucesso")
        self.logger.end_operation("Scraping completo de bundles")
        
        return bundles
    
    async def scrape_single_bundle(self, bundle_id: str) -> Optional[Dict]:
        """
        Scrape um único bundle (útil para testes)
        
        Args:
            bundle_id: ID do bundle
            
        Returns:
            Dados do bundle ou None
        """
        return await self.scrape_bundle_details(bundle_id)
