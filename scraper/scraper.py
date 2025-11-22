"""
Scraper de Bundles da Steam usando API oficial
Versão 2.0 - Apenas API, sem parsing de HTML
"""
import asyncio
import aiohttp
import json
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
        self.blocked_until = 0  # Timestamp para controle de bloqueio
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Fecha sessão HTTP ao sair do context manager"""
        if self.session:
            await self.session.close()
    
    async def scrape_bundle_list(self) -> List[str]:
        """
        Retorna lista de IDs de bundles conhecidos do JSON
        
        Returns:
            Lista de IDs de bundles
        """
        self.logger.start_operation("Carregando lista de bundles")
        
        # Carrega lista de IDs do JSON
        import json
        from pathlib import Path
        
        json_file = Path("data/known_bundles.json")
        
        try:
            if json_file.exists():
                with open(json_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    bundle_ids = [str(id) for id in data.get('bundle_ids', [])]
                    self.logger.success(f"Carregados {len(bundle_ids)} bundle IDs do JSON")
                    self.logger.info(f"Última atualização: {data.get('last_updated', 'desconhecido')}")
            else:
                # Fallback: tenta importar do Python
                try:
                    from .known_bundles import ALL_BUNDLE_IDS
                    bundle_ids = [str(id) for id in ALL_BUNDLE_IDS]
                    self.logger.warning(f"JSON não encontrado, usando known_bundles.py ({len(bundle_ids)} IDs)")
                except ImportError:
                    self.logger.warning("Nenhuma fonte de IDs encontrada, usando lista padrão")
                    bundle_ids = ["232", "5699", "6684", "14343", "19975", "20187", "21200", "21661", "25657", "28631"]
                    self.logger.info(f"Usando {len(bundle_ids)} IDs padrão")
        except Exception as e:
            self.logger.error(f"Erro ao carregar IDs: {e}")
            bundle_ids = []
        
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
        # Verifica se estamos bloqueados
        import time
        if hasattr(self, 'blocked_until') and time.time() < self.blocked_until:
            remaining = int(self.blocked_until - time.time())
            self.logger.warning(f"⏳ Aguardando fim do bloqueio ({remaining}s restantes)")
            await asyncio.sleep(min(5, remaining))
            return None
        
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
                    # Verifica bloqueio da Steam
                    if response.status == 429:  # Too Many Requests
                        retry_after = int(response.headers.get('Retry-After', 60))
                        self.logger.error(f"🚫 BLOQUEADO pela Steam! Aguardando {retry_after}s...")
                        self.blocked_until = time.time() + retry_after
                        await asyncio.sleep(retry_after)
                        return None
                    
                    elif response.status == 403:  # Forbidden
                        self.logger.error(f"🚫 ACESSO NEGADO pela Steam! Aguardando 120s...")
                        self.blocked_until = time.time() + 120
                        await asyncio.sleep(120)
                        return None
                    
                    elif response.status == 200:
                        data = await response.json()
                        
                        # Nova estrutura da API v1
                        response_data = data.get('response', {})
                        store_items = response_data.get('store_items', [])
                        
                        if not store_items or len(store_items) == 0:
                            self.logger.warning(f"Bundle {bundle_id}: API retornou vazio")
                            return None
                        
                        bundle_data = store_items[0]
                        
                        # Verifica se bundle tem nome (válido)
                        if not bundle_data.get('name'):
                            return None
                        
                        # Extrai dados de preço do best_purchase_option
                        purchase_option = bundle_data.get('best_purchase_option', {})
                        final_price_cents = int(purchase_option.get('final_price_in_cents', 0))
                        original_price_cents = int(purchase_option.get('price_before_bundle_discount', final_price_cents))
                        
                        # 🔥 FILTRO: Rejeita bundles sem preço (fantasmas)
                        if final_price_cents == 0 and original_price_cents == 0:
                            self.logger.warning(f"Bundle {bundle_id}: SEM PREÇO (fantasma) - ignorado")
                            return None
                        
                        # Calcula desconto percentual
                        if original_price_cents > 0:
                            discount_pct = round(((original_price_cents - final_price_cents) / original_price_cents) * 100)
                        else:
                            discount_pct = 0
                        
                        # Converte para formato do scraper
                        result = {
                            'id': str(bundle_data.get('id')),
                            'name': bundle_data.get('name'),
                            'url': f"https://store.steampowered.com/{bundle_data.get('store_url_path', f'bundle/{bundle_id}/')}",
                            'price': {
                                'final': final_price_cents / 100,  # Centavos → Reais
                                'original': original_price_cents / 100,
                                'discount': discount_pct,
                                'formatted_final': purchase_option.get('formatted_final_price', ''),
                                'formatted_original': purchase_option.get('formatted_price_before_bundle_discount', ''),
                                'currency': 'BRL'
                            },
                            'images': {
                                'header': bundle_data.get('assets', {}).get('header', ''),
                                'capsule': bundle_data.get('assets', {}).get('main_capsule', ''),
                                'library': bundle_data.get('assets', {}).get('library_capsule', '')
                            },
                            'platforms': {
                                'windows': bundle_data.get('platforms', {}).get('windows', False),
                                'mac': bundle_data.get('platforms', {}).get('mac', False),
                                'linux': bundle_data.get('platforms', {}).get('linux', False)
                            },
                            'vr': {
                                'supported': bundle_data.get('vr_support', {}).get('vrhmd', False),
                                'only': bundle_data.get('vr_support', {}).get('vrhmd_only', False)
                            },
                            'app_ids': [item['id'] for item in bundle_data.get('included_items', []) if item.get('item_type') == 0],  # 0 = app
                            'package_ids': [item['id'] for item in bundle_data.get('included_items', []) if item.get('item_type') == 1],  # 1 = package
                            'coming_soon': not bundle_data.get('visible', True),
                            'games': [],
                            'needs_browser_scraping': False  # API retorna tudo
                        }
                        
                        # Preenche lista de jogos
                        if result['app_ids']:
                            result['games'] = [{'app_id': app_id} for app_id in result['app_ids']]
                        
                        self.logger.success(f"Bundle {bundle_id} extraído via API: {result['name']} (desconto: {discount_pct}%)")
                        return result
                    
                    else:
                        self.logger.warning(f"Bundle {bundle_id}: Status {response.status}")
                        return None
                        
        except Exception as e:
            self.logger.error(f"Erro ao processar bundle {bundle_id}: {e}")
            return None
    
    async def scrape_bundles_batch(self, bundle_ids: List[str]) -> List[Dict]:
        """
        Busca múltiplos bundles em um único request (API v1 aceita batch)
        
        Args:
            bundle_ids: Lista de IDs (até 100)
            
        Returns:
            Lista de bundles válidos
        """
        if not bundle_ids:
            return []
        
        # API v1 usa formato JSON com lista de IDs
        ids_list = [{"bundleid": int(bid)} for bid in bundle_ids[:100]]
        context = {"language": "brazilian", "country_code": "BR"}
        input_json = json.dumps({"ids": ids_list, "context": context})
        
        params = {
            'key': self.config.API_KEY,
            'input_json': input_json
        }
        
        try:
            async with self._semaphore:
                async with self.session.get(self.config.BUNDLE_API_URL, params=params) as response:
                    # Verifica bloqueio da Steam
                    if response.status == 429:  # Too Many Requests
                        import time
                        retry_after = int(response.headers.get('Retry-After', 60))
                        self.logger.error(f"🚫 BLOQUEADO pela Steam (batch)! Aguardando {retry_after}s...")
                        self.blocked_until = time.time() + retry_after
                        await asyncio.sleep(retry_after)
                        return []
                    
                    elif response.status == 403:  # Forbidden
                        import time
                        self.logger.error(f"🚫 ACESSO NEGADO pela Steam (batch)! Aguardando 120s...")
                        self.blocked_until = time.time() + 120
                        await asyncio.sleep(120)
                        return []
                    
                    elif response.status == 200:
                        data = await response.json()
                        
                        response_data = data.get('response', {})
                        store_items = response_data.get('store_items', [])
                        
                        bundles = []
                        for bundle_data in store_items:
                            if not bundle_data.get('name'):
                                continue
                            
                            bundle_id = bundle_data.get('id')
                            
                            # Extrai dados de preço
                            purchase_option = bundle_data.get('best_purchase_option', {})
                            final_price_cents = int(purchase_option.get('final_price_in_cents', 0))
                            original_price_cents = int(purchase_option.get('price_before_bundle_discount', final_price_cents))
                            
                            # 🔥 FILTRO: Rejeita bundles sem preço (fantasmas)
                            if final_price_cents == 0 and original_price_cents == 0:
                                continue
                            
                            # Calcula desconto
                            if original_price_cents > 0:
                                discount_pct = round(((original_price_cents - final_price_cents) / original_price_cents) * 100)
                            else:
                                discount_pct = 0
                            
                            result = {
                                'id': str(bundle_id),
                                'name': bundle_data.get('name'),
                                'url': f"https://store.steampowered.com/{bundle_data.get('store_url_path', f'bundle/{bundle_id}/')}",
                                'price': {
                                    'final': final_price_cents / 100,
                                    'original': original_price_cents / 100,
                                    'discount': discount_pct,
                                    'formatted_final': purchase_option.get('formatted_final_price', ''),
                                    'formatted_original': purchase_option.get('formatted_price_before_bundle_discount', ''),
                                    'currency': 'BRL'
                                },
                                'images': {
                                    'header': bundle_data.get('assets', {}).get('header', ''),
                                    'capsule': bundle_data.get('assets', {}).get('main_capsule', ''),
                                    'library': bundle_data.get('assets', {}).get('library_capsule', '')
                                },
                                'platforms': {
                                    'windows': bundle_data.get('platforms', {}).get('windows', False),
                                    'mac': bundle_data.get('platforms', {}).get('mac', False),
                                    'linux': bundle_data.get('platforms', {}).get('linux', False)
                                },
                                'vr': {
                                    'supported': bundle_data.get('vr_support', {}).get('vrhmd', False),
                                    'only': bundle_data.get('vr_support', {}).get('vrhmd_only', False)
                                },
                                'app_ids': [item['id'] for item in bundle_data.get('included_items', []) if item.get('item_type') == 0],
                                'package_ids': [item['id'] for item in bundle_data.get('included_items', []) if item.get('item_type') == 1],
                                'coming_soon': not bundle_data.get('visible', True),
                                'games': [{'app_id': item['id']} for item in bundle_data.get('included_items', []) if item.get('item_type') == 0],
                                'needs_browser_scraping': False
                            }
                            
                            bundles.append(result)
                        
                        return bundles
                    else:
                        self.logger.warning(f"API retornou status {response.status}")
                        return []
        except Exception as e:
            self.logger.error(f"Erro ao buscar batch: {e}")
            import traceback
            self.logger.error(traceback.format_exc())
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
