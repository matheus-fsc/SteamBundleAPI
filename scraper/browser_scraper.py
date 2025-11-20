"""
Browser Scraper usando Playwright para bundles com preços dinâmicos
Usado apenas quando aiohttp falha em extrair preços (bundles "Complete Your Collection")
"""
import asyncio
from typing import Optional, Dict, List
from playwright.async_api import async_playwright, Browser, Page, TimeoutError as PlaywrightTimeout
from .config import ScrapingConfig
from .mapper import BundleDataMapper
from .logger import Logger


class BrowserScraper:
    """
    Scraper "pesado" usando Playwright para casos especiais
    
    Usa casos:
    - Bundles com preços dinâmicos (calculados via JavaScript)
    - Bundles "Complete Your Collection"
    - Fallback quando aiohttp falha
    """
    
    def __init__(self, config: Optional[ScrapingConfig] = None):
        self.config = config or ScrapingConfig()
        self.mapper = BundleDataMapper()
        self.logger = Logger('browser_scraper')
        self.browser: Optional[Browser] = None
        self.playwright = None
    
    async def __aenter__(self):
        """Inicializa browser"""
        self.logger.info("🌐 Iniciando Playwright (modo headless)...")
        self.playwright = await async_playwright().start()
        
        # Usa Chromium (mais leve que Chrome completo)
        self.browser = await self.playwright.chromium.launch(
            headless=True,
            args=[
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage',  # Importante para Orange Pi (RAM limitada)
                '--no-sandbox',
            ]
        )
        
        self.logger.success("Browser iniciado")
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Fecha browser"""
        if self.browser:
            await self.browser.close()
        if self.playwright:
            await self.playwright.stop()
        self.logger.info("Browser fechado")
    
    async def scrape_bundle_with_browser(self, bundle_id: str) -> Optional[Dict]:
        """
        Scrape bundle usando browser real (executa JavaScript)
        
        Args:
            bundle_id: ID do bundle
            
        Returns:
            Dados do bundle ou None se falhar
        """
        if not self.browser:
            raise RuntimeError("Browser não inicializado. Use 'async with BrowserScraper()'")
        
        url = self.config.BUNDLE_URL_TEMPLATE.format(bundle_id=bundle_id)
        
        self.logger.info(f"🔍 Scraping bundle {bundle_id} com browser...")
        
        page = None
        try:
            # Cria nova página
            page = await self.browser.new_page()
            
            # Headers para parecer um usuário real
            await page.set_extra_http_headers(self.config.HEADERS)
            
            # Define viewport (tamanho da janela)
            await page.set_viewport_size({"width": 1920, "height": 1080})
            
            # Navega para a página
            await page.goto(url, wait_until='networkidle', timeout=30000)
            
            # Espera JavaScript carregar preços
            await asyncio.sleep(2)  # Dá tempo para JS executar
            
            # Tenta esperar por seletor de preço
            try:
                await page.wait_for_selector(
                    '.game_purchase_price, .discount_final_price',
                    timeout=5000
                )
            except PlaywrightTimeout:
                self.logger.warning(f"Timeout esperando preço do bundle {bundle_id}")
            
            # Extrai HTML completo (com JS executado)
            html = await page.content()
            
            # Usa o mapper normal
            bundle_data = self.mapper.parse_bundle_html(html, bundle_id)
            
            # Marca que não precisa mais de browser scraping
            bundle_data['needs_browser_scraping'] = False
            
            # Valida
            if self.mapper.validate_bundle(bundle_data):
                price = bundle_data.get('price', {})
                final_price = price.get('final') if isinstance(price, dict) else None
                
                self.logger.success(
                    f"Bundle {bundle_id} extraído com browser: "
                    f"{bundle_data.get('name')} - Preço: {final_price}"
                )
                return bundle_data
            else:
                self.logger.warning(f"Bundle {bundle_id} não passou na validação (browser)")
                return None
        
        except Exception as e:
            self.logger.error(f"Erro ao scrape bundle {bundle_id} com browser: {e}")
            return None
        
        finally:
            if page:
                await page.close()
    
    async def scrape_multiple_bundles(self, bundle_ids: List[str]) -> List[Dict]:
        """
        Scrape múltiplos bundles com browser
        Processa em batches pequenos para não sobrecarregar
        
        Args:
            bundle_ids: Lista de IDs de bundles
            
        Returns:
            Lista de bundles extraídos
        """
        self.logger.start_operation(f"Browser scraping de {len(bundle_ids)} bundles")
        
        bundles = []
        
        # Processa em batches bem pequenos (browser é pesado)
        batch_size = 3
        
        for i in range(0, len(bundle_ids), batch_size):
            batch = bundle_ids[i:i + batch_size]
            
            self.logger.info(f"Processando batch {i//batch_size + 1} ({len(batch)} bundles)...")
            
            # Processa sequencialmente (não em paralelo, para não sobrecarregar)
            for bundle_id in batch:
                bundle = await self.scrape_bundle_with_browser(bundle_id)
                if bundle:
                    bundles.append(bundle)
                
                # Delay entre bundles
                await asyncio.sleep(self.config.REQUEST_DELAY)
            
            # Pausa entre batches
            if i + batch_size < len(bundle_ids):
                self.logger.info("Pausa entre batches...")
                await asyncio.sleep(5)
        
        self.logger.success(f"Browser scraping concluído: {len(bundles)}/{len(bundle_ids)} bundles")
        self.logger.end_operation("Browser scraping")
        
        return bundles


async def retry_failed_bundles_with_browser(
    failed_bundle_ids: List[str],
    config: Optional[ScrapingConfig] = None
) -> List[Dict]:
    """
    Função helper para retry de bundles que falharam no scraper normal
    
    Args:
        failed_bundle_ids: IDs dos bundles que falharam
        config: Configurações (opcional)
        
    Returns:
        Lista de bundles extraídos com sucesso
    """
    if not failed_bundle_ids:
        return []
    
    async with BrowserScraper(config) as browser_scraper:
        return await browser_scraper.scrape_multiple_bundles(failed_bundle_ids)
