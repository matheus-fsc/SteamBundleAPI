# Steam Bundle Scraper

Scraper modular em Python para extrair informações de bundles da Steam Store.

## Características

- **Scraping em duas fases**: 
  1. Varre página principal para listar todos os bundles
  2. Entra em cada bundle individualmente para extrair detalhes completos
  
- **Assíncrono**: Utiliza `asyncio` e `aiohttp` para scraping eficiente
- **Controle de rate-limit**: Delays configuráveis entre requests
- **Retry automático**: Tenta novamente em caso de falhas temporárias
- **Filtros avançados**: Por desconto, preço, moeda, quantidade de jogos
- **Logging completo**: Rastreamento de todo o processo
- **Validação de dados**: Garante qualidade dos dados extraídos

## Instalação

```bash
# Instalar dependências
pip install -r requirements.txt
```

## Uso Básico

### Scraping Completo

```python
import asyncio
from scraper import BundleScraper
from filters import BundleFilter

async def main():
    async with BundleScraper() as scraper:
        # Scrape todos os bundles
        bundles = await scraper.scrape_all_bundles()
        
        # Aplica filtros
        filter_service = BundleFilter()
        bundles = filter_service.filter_valid(bundles)
        bundles = filter_service.filter_duplicates(bundles)
        
        print(f"Total: {len(bundles)} bundles")
        return bundles

asyncio.run(main())
```

### Scraping de Bundles Específicos

```python
async with BundleScraper() as scraper:
    # IDs de bundles específicos
    bundle_ids = ['28631', '469', '232']
    bundles = await scraper.scrape_all_bundles(bundle_ids)
```

### Teste com Bundle Individual

```python
async with BundleScraper() as scraper:
    bundle = await scraper.scrape_single_bundle('28631')
    print(bundle)
```

## Configuração

Edite `config.py` para ajustar:

- **URLs e endpoints**
- **Delays entre requests** (importante para evitar bloqueio)
- **Timeouts e retries**
- **Seletores CSS** (caso a Steam mude a estrutura HTML)
- **Concorrência** (quantos requests simultâneos)

```python
from scraper import ScrapingConfig

# Ajustar configurações
ScrapingConfig.REQUEST_DELAY = 3  # 3 segundos entre requests
ScrapingConfig.MAX_CONCURRENT_REQUESTS = 3  # 3 requests simultâneos
ScrapingConfig.TIMEOUT = 60  # Timeout de 60 segundos
```

## Filtros Disponíveis

```python
from filters import BundleFilter

filter_service = BundleFilter()

# Filtros básicos
bundles = filter_service.filter_valid(bundles)
bundles = filter_service.filter_duplicates(bundles)

# Por desconto
bundles = filter_service.filter_by_discount(bundles, min_discount=50)

# Por preço
bundles = filter_service.filter_by_price_range(bundles, min_price=10, max_price=100)

# Por quantidade de jogos
bundles = filter_service.filter_by_game_count(bundles, min_games=3)

# Por moeda
bundles = filter_service.filter_by_currency(bundles, 'BRL')

# Ordenação
bundles = filter_service.sort_by_discount(bundles)
bundles = filter_service.sort_by_price(bundles)

# Estatísticas
stats = filter_service.get_statistics(bundles)
print(stats)
```

## Estrutura de Dados

Cada bundle extraído tem a seguinte estrutura:

```json
{
  "id": "28631",
  "name": "Valve Complete Pack",
  "price": {
    "final": 49.99,
    "original": 199.99,
    "currency": "BRL",
    "formatted": "R$ 49,99"
  },
  "discount": 75,
  "games": [
    {
      "name": "Counter-Strike: Global Offensive",
      "app_id": "730",
      "url": "https://store.steampowered.com/app/730/"
    }
  ],
  "url": "https://store.steampowered.com/bundle/28631/",
  "scraped_at": "2025-11-20T10:30:00.000Z",
  "is_valid": true
}
```

## Estrutura do Projeto

```
scraper/
├── __init__.py              # Exports principais
├── config.py                # Configurações (URLs, delays, seletores)
├── scraper.py              # Lógica principal de scraping
├── mapper.py               # Transforma HTML → objetos estruturados
├── filters.py              # Filtros e validações
├── logger.py               # Sistema de logging
├── main.py                 # Script de exemplo
├── requirements.txt        # Dependências
└── README.md              # Este arquivo
```

## Arquitetura

A arquitetura replica a lógica do scraper Node.js original:

### 1. **BundleScrapingService.js** → **scraper.py**
- Navegação pelas páginas
- Controle de requests
- Orquestração do scraping

### 2. **BundleDataMapper.js** → **mapper.py**
- Parsing de HTML
- Extração de dados estruturados
- Normalização de preços e moedas

### 3. **BundleFilterService.js** → **filters.py**
- Validação de dados
- Remoção de duplicatas
- Filtros por critérios diversos

### 4. **ScrapingConfigManager.js** → **config.py**
- URLs e endpoints
- Seletores CSS
- Timeouts e delays

### 5. **PersistentLogger.js** → **logger.py**
- Logging em arquivo e console
- Rastreamento de operações

## Performance

- **Assíncrono**: Processa múltiplos bundles simultaneamente
- **Batching**: Processa em lotes configuráveis
- **Controle de concorrência**: Semáforo para limitar requests simultâneos
- **Rate limiting**: Delays automáticos entre requests

## 🐳 Docker

Para rodar no Orange Pi:

```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY scraper/ ./scraper/

CMD ["python", "-m", "scraper.main"]
```

## Logs

Os logs são salvos em:
- `logs/scraper_YYYYMMDD.log` - Log do dia
- Console - Output em tempo real

## Considerações Importantes

1. **Rate Limiting**: A Steam pode bloquear IPs com muitos requests. Ajuste `REQUEST_DELAY`.
2. **User-Agent**: Headers estão configurados para parecer um browser real.
3. **Seletores CSS**: Podem mudar se a Steam atualizar o site. Monitore e ajuste em `config.py`.
4. **Região**: Preços e disponibilidade variam por região. Configure região no Steam.

