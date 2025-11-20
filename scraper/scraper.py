"""
Serviço principal de scraping - equivalente ao BundleScrapingService.js
"""
import asyncio
import aiohttp
from bs4 import BeautifulSoup
from typing import List, Dict, Optional
from .config import ScrapingConfig
from .mapper import BundleDataMapper
from .logger import Logger


class BundleScraper:
    """
    Scraper principal para bundles da Steam
    
    Processo:
    1. Varre a página principal de bundles
    2. Extrai IDs de todos os bundles
    3. Para cada bundle, acessa página individual
    4. Extrai e estrutura dados de cada bundle
    """
    
    def __init__(self, config: Optional[ScrapingConfig] = None):
        self.config = config or ScrapingConfig()
        self.mapper = BundleDataMapper()
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
    
    async def fetch_page(self, url: str, retries: int = 0) -> Optional[str]:
        """
        Faz request HTTP com retry automático
        
        Args:
            url: URL para fazer request
            retries: Contador de tentativas (interno)
            
        Returns:
            HTML da página ou None se falhar
        """
        if not self.session:
            raise RuntimeError("Scraper deve ser usado como context manager (async with)")
        
        try:
            async with self._semaphore:
                async with self.session.get(url) as response:
                    if response.status == 200:
                        return await response.text()
                    elif response.status == 429:
                        # Too Many Requests - espera mais tempo
                        self.logger.warning(f"Rate limit atingido, aguardando...")
                        await asyncio.sleep(self.config.REQUEST_DELAY * 3)
                        return await self.fetch_page(url, retries)
                    else:
                        self.logger.warning(f"Status {response.status} para {url}")
                        return None
                        
        except asyncio.TimeoutError:
            self.logger.error(f"Timeout ao buscar {url}")
            if retries < self.config.MAX_RETRIES:
                self.logger.info(f"Retry {retries + 1}/{self.config.MAX_RETRIES} para {url}")
                await asyncio.sleep(self.config.REQUEST_DELAY * (retries + 1))
                return await self.fetch_page(url, retries + 1)
            return None
            
        except Exception as e:
            if retries < self.config.MAX_RETRIES:
                self.logger.info(f"Retry {retries + 1}/{self.config.MAX_RETRIES} para {url}: {str(e)}")
                await asyncio.sleep(self.config.REQUEST_DELAY * (retries + 1))
                return await self.fetch_page(url, retries + 1)
            
            self.logger.error(f"Erro ao buscar {url}: {e}")
            return None
    
    async def scrape_bundle_list(self) -> List[str]:
        """
        Varre a página principal e extrai IDs/URLs de todos os bundles
        Equivalente à primeira parte do BundleScrapingService.js
        
        Returns:
            Lista de IDs de bundles encontrados
        """
        self.logger.start_operation("Scraping lista de bundles")
        
        html = await self.fetch_page(self.config.BASE_URL)
        if not html:
            self.logger.error("Falha ao buscar página principal de bundles")
            return []
        
        soup = BeautifulSoup(html, 'html.parser')
        
        # Extrai IDs dos bundles
        bundle_ids = []
        
        # Método 1: Procura por data-ds-bundleid
        bundle_elements = soup.select('[data-ds-bundleid]')
        for element in bundle_elements:
            bundle_id = element.get('data-ds-bundleid')
            if bundle_id and bundle_id not in bundle_ids:
                bundle_ids.append(bundle_id)
        
        # Método 2: Procura por links /bundle/
        if not bundle_ids:
            links = soup.select('a[href*="/bundle/"]')
            for link in links:
                href = link.get('href', '')
                # Extrai ID do URL: /bundle/12345/
                import re
                match = re.search(r'/bundle/(\d+)', href)
                if match:
                    bundle_id = match.group(1)
                    if bundle_id not in bundle_ids:
                        bundle_ids.append(bundle_id)
        
        self.logger.success(f"Encontrados {len(bundle_ids)} bundles")
        self.logger.end_operation("Scraping lista de bundles")
        
        return bundle_ids
    
    async def scrape_bundle_details(self, bundle_id: str) -> Optional[Dict]:
        """
        Entra em um bundle individual e extrai detalhes completos
        Equivalente à segunda parte do BundleScrapingService.js
        
        Args:
            bundle_id: ID do bundle na Steam
            
        Returns:
            Dicionário com dados estruturados do bundle ou None se falhar
        """
        url = self.config.BUNDLE_URL_TEMPLATE.format(bundle_id=bundle_id)
        
        self.logger.info(f"Scraping bundle {bundle_id}...")
        
        html = await self.fetch_page(url)
        if not html:
            self.logger.warning(f"Falha ao buscar bundle {bundle_id}")
            return None
        
        try:
            # Usa o mapper para transformar HTML em dados estruturados
            bundle_data = self.mapper.parse_bundle_html(html, bundle_id)
            
            # Valida dados extraídos
            if self.mapper.validate_bundle(bundle_data):
                self.logger.success(f"Bundle {bundle_id} extraído: {bundle_data.get('name')}")
                return bundle_data
            else:
                self.logger.warning(f"Bundle {bundle_id} não passou na validação")
                return None
                
        except Exception as e:
            self.logger.error(f"Erro ao processar bundle {bundle_id}: {e}")
            return None
        finally:
            # Delay entre requests para não sobrecarregar servidor
            await asyncio.sleep(self.config.REQUEST_DELAY)
    
    async def scrape_all_bundles(self, bundle_ids: Optional[List[str]] = None) -> List[Dict]:
        """
        Orquestra todo o processo de scraping
        
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
        
        # Processa bundles em batches para não sobrecarregar
        bundles = []
        batch_size = self.config.BATCH_SIZE
        
        for i in range(0, len(bundle_ids), batch_size):
            batch = bundle_ids[i:i + batch_size]
            self.logger.info(f"Processando batch {i//batch_size + 1} ({len(batch)} bundles)...")
            
            # Cria tasks para o batch
            tasks = [self.scrape_bundle_details(bundle_id) for bundle_id in batch]
            batch_results = await asyncio.gather(*tasks)
            
            # Filtra resultados válidos
            valid_bundles = [b for b in batch_results if b is not None]
            bundles.extend(valid_bundles)
            
            self.logger.info(f"Batch concluído: {len(valid_bundles)}/{len(batch)} bundles válidos")
            
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
