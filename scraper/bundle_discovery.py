"""
Módulo para descobrir TODOS os Bundle IDs da Steam
Usa força bruta com batches para eficiência
"""
import asyncio
import aiohttp
from typing import Set, List
from .config import ScrapingConfig
from .logger import Logger


class BundleDiscovery:
    """Descobre todos os IDs de bundles da Steam via brute force otimizado"""
    
    def __init__(self):
        self.logger = Logger('bundle_discovery')
        self.config = ScrapingConfig()
        self.discovered_ids: Set[int] = set()
        self.session = None
    
    async def __aenter__(self):
        self.session = aiohttp.ClientSession(
            headers=self.config.HEADERS,
            timeout=aiohttp.ClientTimeout(total=self.config.TIMEOUT)
        )
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
    
    async def brute_force_scan(self, start: int = 1, end: int = 35000, batch_size: int = 100) -> List[int]:
        """
        Estratégia 3: Força bruta otimizada
        API: /actions/ajaxresolvebundles (aceita múltiplos IDs)
        
        A Steam tem ~2000-3000 bundles ativos.
        Varremos até 35000 para cobrir todos.
        """
        self.logger.info(f"Iniciando força bruta de ID {start} até {end}...")
        
        valid_ids = []
        total_batches = (end - start) // batch_size
        
        for batch_num, i in enumerate(range(start, end, batch_size), 1):
            batch_end = min(i + batch_size, end)
            batch_ids = list(range(i, batch_end))
            
            # Monta query com múltiplos IDs
            ids_str = ','.join(str(x) for x in batch_ids)
            
            params = {
                'bundleids': ids_str,
                'cc': self.config.COUNTRY_CODE,
                'l': self.config.LANGUAGE
            }
            
            try:
                async with self.session.get(self.config.BUNDLE_API_URL, params=params) as response:
                    if response.status == 200:
                        data = await response.json()
                        
                        # Extrai IDs válidos
                        for bundle in data:
                            bundle_id = bundle.get('bundleid')
                            if bundle_id and bundle.get('name'):  # Válido se tem nome
                                valid_ids.append(bundle_id)
                                self.discovered_ids.add(bundle_id)
                        
                        if batch_num % 10 == 0:  # Log a cada 10 batches
                            progress = (batch_num / total_batches) * 100
                            self.logger.info(
                                f"Progresso: {progress:.1f}% "
                                f"({batch_num}/{total_batches}) - "
                                f"Total: {len(self.discovered_ids)} bundles"
                            )
                
                # Delay para não sobrecarregar
                await asyncio.sleep(0.3)
                
            except Exception as e:
                self.logger.error(f"Erro no batch {i}-{batch_end}: {e}")
        
        self.logger.success(f"Força bruta: {len(valid_ids)} novos bundles")
        return valid_ids
    
    async def discover_all(self) -> List[int]:
        """
        Executa descoberta completa via força bruta
        Varre todos os IDs de 1 a 35000 para encontrar bundles válidos
        """
        self.logger.start_operation("Descoberta de bundles")
        
        # Força bruta completa
        self.logger.info("Executando força bruta completa (isso vai demorar ~10min)...")
        await self.brute_force_scan()
        
        all_ids = sorted(self.discovered_ids)
        
        self.logger.success(
            f"Descoberta completa! {len(all_ids)} bundles únicos encontrados"
        )
        
        return all_ids
    
    async def update_known_bundles_file(self):
        """Atualiza arquivo known_bundles.py com todos os IDs descobertos"""
        all_ids = await self.discover_all()
        
        content = '''"""
Lista completa de Bundle IDs da Steam
Gerado automaticamente via BundleDiscovery

Última atualização: {timestamp}
Total de bundles: {total}
"""

ALL_BUNDLE_IDS = [
{ids}
]
'''
        from datetime import datetime
        
        ids_formatted = ',\n'.join(f'    {id}' for id in all_ids)
        
        final_content = content.format(
            timestamp=datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC'),
            total=len(all_ids),
            ids=ids_formatted
        )
        
        output_file = "scraper/known_bundles.py"
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(final_content)
        
        self.logger.success(f"Arquivo atualizado: {output_file}")
        return all_ids


async def run_discovery():
    """Script principal de descoberta - força bruta completa"""
    async with BundleDiscovery() as discovery:
        await discovery.update_known_bundles_file()


if __name__ == "__main__":
    print("🔍 Descoberta de Bundles da Steam")
    print("Estratégia: Força bruta completa (1-35000)")
    print("Tempo estimado: 10-15 minutos")
    print("-" * 60)
    
    asyncio.run(run_discovery())
