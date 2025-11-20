"""
Mapeia HTML para objetos estruturados - equivalente ao BundleDataMapper.js
"""
from bs4 import BeautifulSoup
from typing import Dict, List, Optional
from datetime import datetime
import re


class BundleDataMapper:
    """Transforma HTML da Steam em objetos estruturados"""
    
    def parse_bundle_html(self, html: str, bundle_id: str) -> Dict:
        """
        Transforma HTML de um bundle em objeto estruturado
        
        Args:
            html: HTML da página do bundle
            bundle_id: ID do bundle
            
        Returns:
            Dicionário com dados estruturados do bundle
        """
        soup = BeautifulSoup(html, 'html.parser')
        
        price_data = self._extract_price(soup)
        
        # Detecta se precisa de browser scraping
        needs_browser = False
        if price_data and price_data.get('needs_browser_scraping'):
            needs_browser = True
        
        return {
            'id': bundle_id,
            'name': self._extract_name(soup),
            'price': price_data,
            'discount': self._extract_discount(soup),
            'games': self._extract_games(soup),
            'url': f"https://store.steampowered.com/bundle/{bundle_id}/",
            'scraped_at': datetime.utcnow().isoformat(),
            'is_valid': True,
            'needs_browser_scraping': needs_browser
        }
    
    def _extract_name(self, soup: BeautifulSoup) -> Optional[str]:
        """Extrai nome do bundle"""
        # Tenta vários seletores possíveis
        selectors = ['.pageheader', 'h2.pageheader', '.bundle_title', 'h1']
        
        for selector in selectors:
            element = soup.select_one(selector)
            if element:
                name = element.text.strip()
                if name:
                    return name
        
        return None
    
    def _extract_price(self, soup: BeautifulSoup) -> Optional[Dict]:
        """
        Extrai informações de preço
        
        Returns:
            Dict com final, original, currency e flag needs_browser_scraping
        """
        price_element = soup.select_one('.discount_final_price, .game_purchase_price')
        original_element = soup.select_one('.discount_original_price')
        
        if not price_element:
            return None
        
        final_price_text = price_element.text.strip()
        final_price = self._parse_price(final_price_text)
        
        # DETECÇÃO DE PREÇO DINÂMICO
        # Se o preço é None ou 0 mas existem elementos de preço, 
        # provavelmente é um bundle "Complete Your Collection" que precisa de JS
        needs_browser = False
        
        if final_price is None or final_price == 0:
            # Verifica se há indicação de preço dinâmico
            dynamic_indicators = [
                soup.select_one('.game_area_purchase_game'),
                soup.select_one('.discount_block'),
                'Complete Your Collection' in soup.get_text(),
                'based on games you own' in soup.get_text().lower()
            ]
            
            if any(dynamic_indicators):
                needs_browser = True
        
        return {
            'final': final_price,
            'original': self._parse_price(original_element.text) if original_element else None,
            'currency': self._extract_currency(final_price_text),
            'formatted': final_price_text,
            'needs_browser_scraping': needs_browser
        }
    
    def _extract_discount(self, soup: BeautifulSoup) -> int:
        """Extrai porcentagem de desconto"""
        element = soup.select_one('.discount_pct')
        if not element:
            return 0
        
        text = element.text.strip().replace('-', '').replace('%', '').strip()
        try:
            return int(text)
        except ValueError:
            return 0
    
    def _extract_games(self, soup: BeautifulSoup) -> List[Dict]:
        """
        Extrai lista de jogos incluídos no bundle
        
        Returns:
            Lista de dicionários com informações dos jogos
        """
        games = []
        
        # Tenta diferentes estruturas que a Steam pode usar
        game_elements = soup.select('.tab_item, .bundle_item')
        
        for element in game_elements:
            game_data = self._parse_game_element(element)
            if game_data:
                games.append(game_data)
        
        return games
    
    def _parse_game_element(self, element) -> Optional[Dict]:
        """Extrai dados de um elemento de jogo"""
        # Nome do jogo
        name_element = element.select_one('.tab_item_name, .game_name, .title')
        if not name_element:
            return None
        
        name = name_element.text.strip()
        if not name:
            return None
        
        # App ID (se disponível)
        app_id = None
        link = element.select_one('a[data-ds-appid]')
        if link:
            app_id = link.get('data-ds-appid')
        
        # URL do jogo
        game_url = None
        if link:
            href = link.get('href')
            if href:
                game_url = href if href.startswith('http') else f"https://store.steampowered.com{href}"
        
        return {
            'name': name,
            'app_id': app_id,
            'url': game_url
        }
    
    def _parse_price(self, price_text: str) -> Optional[float]:
        """
        Converte texto de preço em float
        
        Examples:
            'R$ 49,99' -> 49.99
            '$19.99' -> 19.99
            '€15,50' -> 15.50
        """
        if not price_text or price_text.lower() == 'free':
            return 0.0
        
        # Remove símbolos de moeda e espaços
        cleaned = re.sub(r'[^\d,\.]', '', price_text)
        
        # Trata formato brasileiro (vírgula como decimal)
        if ',' in cleaned and '.' in cleaned:
            # Ex: 1.234,56
            cleaned = cleaned.replace('.', '').replace(',', '.')
        elif ',' in cleaned:
            # Ex: 49,99
            cleaned = cleaned.replace(',', '.')
        
        try:
            return float(cleaned)
        except ValueError:
            return None
    
    def _extract_currency(self, price_text: str) -> str:
        """
        Detecta moeda a partir do texto de preço
        
        Returns:
            Código ISO da moeda (BRL, USD, EUR, etc)
        """
        currency_map = {
            'R$': 'BRL',
            'R＄': 'BRL',  # Variação do símbolo
            '€': 'EUR',
            '£': 'GBP',
            '¥': 'JPY',
            '₩': 'KRW',
            'CDN$': 'CAD',
            'A$': 'AUD',
        }
        
        for symbol, code in currency_map.items():
            if symbol in price_text:
                return code
        
        # Default para USD se não encontrar símbolo específico
        return 'USD' if '$' in price_text else 'BRL'
    
    def validate_bundle(self, bundle_data: Dict) -> bool:
        """
        Valida se os dados extraídos do bundle estão completos
        
        Args:
            bundle_data: Dados do bundle extraídos
            
        Returns:
            True se o bundle é válido
        """
        required_fields = ['id', 'name', 'price']
        
        # Verifica campos obrigatórios
        for field in required_fields:
            if not bundle_data.get(field):
                return False
        
        # Verifica se tem pelo menos algum jogo
        games = bundle_data.get('games', [])
        if not games or len(games) == 0:
            return False
        
        return True
