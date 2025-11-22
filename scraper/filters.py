from typing import List, Dict, Set, Optional, Callable


class BundleFilter:
    def __init__(self):
        self.seen_ids: Set[str] = set()
    
    def filter_duplicates(self, bundles: List[Dict]) -> List[Dict]:
        """
        Remove bundles duplicados baseado no ID
        
        Args:
            bundles: Lista de bundles
            
        Returns:
            Lista sem duplicatas
        """
        unique_bundles = []
        
        for bundle in bundles:
            bundle_id = bundle.get('id')
            if bundle_id and bundle_id not in self.seen_ids:
                self.seen_ids.add(bundle_id)
                unique_bundles.append(bundle)
        
        return unique_bundles
    
    def filter_valid(self, bundles: List[Dict]) -> List[Dict]:
        """
        Filtra apenas bundles válidos (com dados completos)
        
        Args:
            bundles: Lista de bundles
            
        Returns:
            Lista apenas com bundles válidos
        """
        return [
            bundle for bundle in bundles
            if self._is_valid_bundle(bundle)
        ]
    
    def _is_valid_bundle(self, bundle: Dict) -> bool:
        """
        Valida se bundle tem dados mínimos necessários
        
        Args:
            bundle: Dados do bundle
            
        Returns:
            True se válido
        """
        required_fields = ['id', 'name', 'price']
        
        for field in required_fields:
            if not bundle.get(field):
                return False
        
        # Não rejeitar bundles sem jogos - podem ser DLC bundles válidos
        # games = bundle.get('games', [])
        # if not games or len(games) == 0:
        #     return False
        
        price_data = bundle.get('price')
        if isinstance(price_data, dict):
            if price_data.get('final') is None:
                return False
        
        return True
    
    def filter_by_discount(
        self, 
        bundles: List[Dict], 
        min_discount: int = 0,
        max_discount: int = 100
    ) -> List[Dict]:
        """
        Filtra bundles por faixa de desconto
        
        Args:
            bundles: Lista de bundles
            min_discount: Desconto mínimo (%)
            max_discount: Desconto máximo (%)
            
        Returns:
            Bundles na faixa de desconto especificada
        """
        return [
            bundle for bundle in bundles
            if min_discount <= bundle.get('discount', 0) <= max_discount
        ]
    
    def filter_by_price_range(
        self,
        bundles: List[Dict],
        min_price: Optional[float] = None,
        max_price: Optional[float] = None
    ) -> List[Dict]:
        """
        Filtra bundles por faixa de preço
        
        Args:
            bundles: Lista de bundles
            min_price: Preço mínimo
            max_price: Preço máximo
            
        Returns:
            Bundles na faixa de preço
        """
        filtered = []
        
        for bundle in bundles:
            price_data = bundle.get('price')
            if not isinstance(price_data, dict):
                continue
            
            final_price = price_data.get('final')
            if final_price is None:
                continue
            
            # Aplica filtros
            if min_price is not None and final_price < min_price:
                continue
            if max_price is not None and final_price > max_price:
                continue
            
            filtered.append(bundle)
        
        return filtered
    
    def filter_by_game_count(
        self,
        bundles: List[Dict],
        min_games: Optional[int] = None,
        max_games: Optional[int] = None
    ) -> List[Dict]:
        """
        Filtra bundles por quantidade de jogos
        
        Args:
            bundles: Lista de bundles
            min_games: Quantidade mínima de jogos
            max_games: Quantidade máxima de jogos
            
        Returns:
            Bundles com quantidade de jogos no intervalo
        """
        filtered = []
        
        for bundle in bundles:
            games = bundle.get('games', [])
            game_count = len(games)
            
            if min_games is not None and game_count < min_games:
                continue
            if max_games is not None and game_count > max_games:
                continue
            
            filtered.append(bundle)
        
        return filtered
    
    def filter_by_currency(
        self,
        bundles: List[Dict],
        currency: str
    ) -> List[Dict]:
        """
        Filtra bundles por moeda
        
        Args:
            bundles: Lista de bundles
            currency: Código da moeda (BRL, USD, EUR, etc)
            
        Returns:
            Bundles na moeda especificada
        """
        return [
            bundle for bundle in bundles
            if isinstance(bundle.get('price'), dict)
            and bundle['price'].get('currency') == currency
        ]
    
    def filter_custom(
        self,
        bundles: List[Dict],
        predicate: Callable[[Dict], bool]
    ) -> List[Dict]:
        """
        Filtra bundles usando função customizada
        
        Args:
            bundles: Lista de bundles
            predicate: Função que recebe bundle e retorna bool
            
        Returns:
            Bundles que passaram no predicado
        """
        return [bundle for bundle in bundles if predicate(bundle)]
    
    def sort_by_discount(
        self,
        bundles: List[Dict],
        descending: bool = True
    ) -> List[Dict]:
        """
        Ordena bundles por desconto
        
        Args:
            bundles: Lista de bundles
            descending: Se True, maior desconto primeiro
            
        Returns:
            Lista ordenada
        """
        return sorted(
            bundles,
            key=lambda b: b.get('discount', 0),
            reverse=descending
        )
    
    def sort_by_price(
        self,
        bundles: List[Dict],
        descending: bool = False
    ) -> List[Dict]:
        """
        Ordena bundles por preço
        
        Args:
            bundles: Lista de bundles
            descending: Se True, maior preço primeiro
            
        Returns:
            Lista ordenada
        """
        def get_price(bundle):
            price_data = bundle.get('price')
            if isinstance(price_data, dict):
                return price_data.get('final', 0) or 0
            return 0
        
        return sorted(bundles, key=get_price, reverse=descending)
    
    def get_statistics(self, bundles: List[Dict]) -> Dict:
        """
        Calcula estatísticas sobre os bundles
        
        Args:
            bundles: Lista de bundles
            
        Returns:
            Dicionário com estatísticas
        """
        if not bundles:
            return {
                'total': 0,
                'with_discount': 0,
                'average_discount': 0,
                'average_price': 0,
                'average_games': 0
            }
        
        total = len(bundles)
        with_discount = sum(1 for b in bundles if b.get('discount', 0) > 0)
        
        discounts = [b.get('discount', 0) for b in bundles]
        avg_discount = sum(discounts) / total if total > 0 else 0
        
        prices = []
        for b in bundles:
            price_data = b.get('price')
            if isinstance(price_data, dict) and price_data.get('final'):
                prices.append(price_data['final'])
        avg_price = sum(prices) / len(prices) if prices else 0
        
        game_counts = [len(b.get('games', [])) for b in bundles]
        avg_games = sum(game_counts) / total if total > 0 else 0
        
        return {
            'total': total,
            'with_discount': with_discount,
            'average_discount': round(avg_discount, 2),
            'average_price': round(avg_price, 2),
            'average_games': round(avg_games, 1),
            'currencies': self._count_currencies(bundles)
        }
    
    def _count_currencies(self, bundles: List[Dict]) -> Dict[str, int]:
        """Conta quantos bundles existem por moeda"""
        currency_count = {}
        
        for bundle in bundles:
            price_data = bundle.get('price')
            if isinstance(price_data, dict):
                currency = price_data.get('currency', 'UNKNOWN')
                currency_count[currency] = currency_count.get(currency, 0) + 1
        
        return currency_count
