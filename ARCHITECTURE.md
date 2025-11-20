# Steam Bundle Scraper - Arquitetura Completa

## Visão Geral

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ARQUITETURA HÍBRIDA                          │
└─────────────────────────────────────────────────────────────────────┘

    ┌──────────────┐
    │   Steam      │ (Origem dos dados)
    │   Store      │
    └──────┬───────┘
           │
           │ Scraping
           ↓
    ┌──────────────────────────────────┐
    │      ORANGE PI (Fábrica)         │
    │  ┌────────────────────────────┐  │
    │  │  Docker Compose            │  │
    │  │  ┌──────────┐ ┌──────────┐ │  │
    │  │  │ Postgres │ │  Scraper │ │  │
    │  │  │  Local   │ │   Cron   │ │  │
    │  │  └──────────┘ └──────────┘ │  │
    │  └────────────────────────────┘  │
    │                                   │
    │  - Scraping completo              │
    │  - Histórico de preços            │
    │  - Detecção de promoções falsas   │
    │  - Proteção do SD Card            │
    └──────────────┬───────────────────┘
                   │
                   │ Sync (Upsert)
                   ↓
    ┌──────────────────────────────────┐
    │      SUPABASE (Vitrine)          │
    │  ┌────────────────────────────┐  │
    │  │  PostgreSQL Cloud          │  │
    │  │  + REST API                │  │
    │  │  + Real-time Subscriptions │  │
    │  └────────────────────────────┘  │
    │                                   │
    │  - Apenas bundles válidos         │
    │  - Últimos 30 dias de histórico   │
    │  - API pública                    │
    └──────────────┬───────────────────┘
                   │
                   │ Consumo (REST API)
                   ↓
    ┌──────────────────────────────────┐
    │     FRONTEND (Consumidor)        │
    │  ┌────────────────────────────┐  │
    │  │  Next.js / React / Mobile  │  │
    │  │  + Supabase Client         │  │
    │  └────────────────────────────┘  │
    │                                   │
    │  - Listagem de deals              │
    │  - Filtros e busca                │
    │  - Alertas de preço               │
    └──────────────────────────────────┘
```

## Fluxo de Dados

### Fase 1: Scraping Rápido (aiohttp)
```
Steam → aiohttp → HTML Parser → 90% dos bundles extraídos
                                        ↓
                                  Detecta preços dinâmicos
                                        ↓
                                  Marca para Fase 2
```

### Fase 2: Scraping Pesado (Playwright)
```
Bundles problemáticos → Playwright → JavaScript executado → Preços dinâmicos
                                                                    ↓
                                                        100% dos bundles prontos
```

### Fase 3: Persistência Local
```
Bundles → Validação → PostgreSQL Local (Orange Pi)
                              ↓
                        Histórico completo
                        Análise de promoções falsas
                        Metadados completos
```

### Fase 4: Sincronização Cloud
```
PostgreSQL Local → Filtro (válidos + 24h) → Supabase Cloud
                                                   ↓
                                        API REST disponível
                                        Dados otimizados
```

## Modelo de Dados

### Local (Orange Pi - Completo)
```sql
bundles (
    id, name, url,
    final_price, original_price, discount, currency,
    games (JSON completo),
    price_history (JSON completo, sem limite),
    needs_browser_scraping,
    first_seen, last_updated
)
```

### Cloud (Supabase - Otimizado)
```sql
bundles (
    id, name, url,
    final_price, original_price, discount, currency,
    games (JSON simplificado),
    price_history (últimos 30 dias),
    is_discount_real, discount_analysis,
    synced_at
)
```

## Componentes

### Orange Pi (Auto-hospedado)
- **PostgreSQL**: Banco completo com histórico infinito
- **Scraper**: Python async (aiohttp + Playwright)
- **Cron**: Execuções periódicas (2x/dia)
- **Sync**: Envia dados filtrados para cloud

**Vantagens:**
- Controle total dos dados
- Histórico completo ilimitado
- Sem custos de cloud compute
- Privacidade dos dados brutos

**Desafios:**
- Requer manutenção física
- Depende de internet doméstica
- Proteção do SD Card necessária

### Supabase (Cloud)
- **PostgreSQL**: Banco otimizado (vitrine)
- **REST API**: Auto-gerada pelo Supabase
- **Real-time**: Subscriptions para updates
- **Auth**: Sistema de autenticação integrado

**Vantagens:**
- API pronta para consumo
- CDN global
- Backup automático
- Real-time subscriptions

**Limitações:**
- Plano free: 500MB storage
- Mantém apenas dados essenciais

## Proteção do SD Card

### Problema
Orange Pi roda de cartão SD. Escrita constante = morte prematura.

### Solução
```yaml
# docker-compose.yml
services:
  scraper:
    tmpfs:
      - /app/logs:size=50M  # Logs em RAM
    environment:
      DISABLE_FILE_LOGS: "true"  # Apenas stdout
```

**Resultado:**
- Logs → stdout → Docker gerencia
- Banco → volume Docker (melhor I/O)
- Zero escrita no SD Card

## Schedule de Execuções

```
00:00 ─────────────────────────────────────> 24:00
  ↓         ↓           ↓           ↓
03:00    09:00       15:00       21:00
  │         │           │           │
  │      Sync        Scrape      Sync
  │     (6h)        Completo    (6h)
  │                   
Scrape
Completo
```

**Configurável via** `scripts/crontab`

## Detecção de Promoções Falsas

### Algoritmo
```python
1. Coleta histórico de preços (últimos 30 dias)
2. Calcula preço regular médio (sem desconto)
3. Compara "preço original" atual com média
4. Se original > média * 1.5 → FALSO
5. Marca bundle com warning
```

### Exemplo
```
Bundle: "Super Pack"
Preço Atual: R$ 50 (-75%)
Preço "Original": R$ 200

Histórico (30d):
  - R$ 80 (regular)
  - R$ 85 (regular)
  - R$ 80 (regular)

Média Regular: R$ 82

Análise:
  R$ 200 > R$ 82 * 1.5
  R$ 200 > R$ 123
  DESCONTO FALSO: Preço inflado 144%
```

## Integrações

### Consumir API Supabase

#### JavaScript/TypeScript
```typescript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Top deals
const { data: deals } = await supabase
  .from('top_deals')
  .select('*')
  .limit(20)

// Real-time updates
supabase
  .channel('bundles')
  .on('postgres_changes', 
    { event: 'INSERT', schema: 'public', table: 'bundles' },
    (payload) => console.log('Novo bundle:', payload)
  )
  .subscribe()
```

#### Python
```python
from supabase import create_client

supabase = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)

# Query
response = supabase.table('bundles')\
    .select('*')\
    .eq('currency', 'BRL')\
    .gt('discount', 50)\
    .execute()

bundles = response.data
```

#### REST API Direta
```bash
# GET top deals
curl "https://seu-projeto.supabase.co/rest/v1/top_deals" \
  -H "apikey: SUPABASE_ANON_KEY"

# GET com filtros
curl "https://seu-projeto.supabase.co/rest/v1/bundles?currency=eq.BRL&discount=gt.50&order=discount.desc" \
  -H "apikey: SUPABASE_ANON_KEY"
```

## Escalabilidade

### Atual (Single Orange Pi)
- ~1000 bundles/dia
- Histórico ilimitado
- Custo: ~R$ 5/mês (energia)

### Futuro (se necessário)
1. **Múltiplos scrapers**: Distribua carga
2. **Redis cache**: Entre Orange Pi e Supabase
3. **TimescaleDB**: Para históricos imensos
4. **Kubernetes**: Orquestração avançada

## Monitoramento

```bash
# Health check
docker compose ps

# Logs em tempo real
docker compose logs -f scraper-cron

# Estatísticas de scraping
docker compose exec postgres psql -U steam -d steam_bundles -c \
  "SELECT * FROM scraping_logs ORDER BY started_at DESC LIMIT 5;"

# Uso de recursos
docker stats

# Top bundles no banco local
docker compose exec postgres psql -U steam -d steam_bundles -c \
  "SELECT name, discount, final_price FROM bundles 
   WHERE discount > 50 ORDER BY discount DESC LIMIT 10;"
```

## Segurança

### Orange Pi
- Containers isolados
- Banco local não exposto
- Firewall restrito
- Service keys em .env

### Supabase
- Row Level Security (RLS)
- Leitura pública (anônima)
- Escrita apenas via service_role
- Rate limiting automático

## Boas Práticas

1. **Backup regular**: `pg_dump` do PostgreSQL local
2. **Monitorar logs**: Detectar bloqueios da Steam
3. **Ajustar delays**: Se Steam bloquear, aumente `REQUEST_DELAY`
4. **Manter Playwright atualizado**: Compatibilidade com sites
5. **Testar sync Supabase**: Antes de produção

## Próximos Passos

1. Frontend para visualizar deals
2. Sistema de alertas (email/push)
3. Comparação entre stores (Epic, GOG, etc)
4. Machine Learning para prever promoções
5. App mobile nativo

## Performance

### Métricas

| Operação | Tempo | Recursos |
|----------|-------|----------|
| Scrape 1 bundle | ~2s | Baixo |
| Scrape 100 bundles | ~5min | Médio |
| Save no banco | <0.1s | Mínimo |
| Análise de desconto | <0.01s | Mínimo |
| Sync Supabase (100) | ~10s | Baixo |

### Otimizações

- Scraping assíncrono (aiohttp)
- Connection pooling (SQLAlchemy)
- Batch upsert (Supabase)
- Semaphore para rate limiting
- Tmpfs para I/O rápido

## Stack Tecnológica

### Backend
- Python 3.13
- SQLAlchemy (Async ORM)
- aiohttp (HTTP async)
- Playwright (Browser automation)
- PostgreSQL 15

### Deploy
- Docker + Docker Compose
- Orange Pi (ARM64)
- Supabase (PaaS)
- Cron (Scheduling)

### Monitoramento
- Docker logs
- PostgreSQL queries
- Scraping logs
- System metrics

## Diagramas Adicionais

### Fluxo de Scraping Detalhado

```
Início
  ↓
Buscar lista de bundles (aiohttp)
  ↓
Para cada bundle:
  ↓
  Scrape com aiohttp
  ↓
  Preço obtido? ──Não──> Marcar para Playwright
  │                            ↓
  Sim                    Scrape com Playwright
  ↓                            ↓
  Validar dados ←──────────────┘
  ↓
  Salvar no PostgreSQL
  ↓
  Adicionar ao histórico
  ↓
  Analisar desconto real
  ↓
Fim do loop
  ↓
Sincronizar com Supabase (se habilitado)
  ↓
Fim
```

### Estrutura de Módulos

```
scraper/
├── __init__.py           # Exports
├── config.py            # Configurações centralizadas
├── logger.py            # Logging (stdout/file)
├── scraper.py           # Scraping principal (aiohttp)
│   └── BundleScraper
├── browser_scraper.py   # Scraping pesado (Playwright)
│   └── BrowserScraper
├── mapper.py            # HTML → Objetos
│   └── BundleDataMapper
├── filters.py           # Validações e filtros
│   └── BundleFilter
├── database.py          # ORM e modelos
│   ├── Database
│   ├── BundleModel
│   ├── GameModel
│   └── ScrapingLogModel
├── sync_supabase.py     # Sincronização cloud
│   └── SupabaseSync
├── main.py              # Script básico
└── main_with_db.py      # Script completo
```

## Referências

- [SQLAlchemy Async](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html)
- [Playwright Python](https://playwright.dev/python/)
- [Docker Best Practices](https://docs.docker.com/develop/dev-best-practices/)
- [Orange Pi Optimization](https://www.armbian.com/orange-pi-5/)
- [Supabase Documentation](https://supabase.com/docs)
- [aiohttp Documentation](https://docs.aiohttp.org/)
