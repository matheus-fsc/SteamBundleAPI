# Steam Bundle Scraper

Sistema completo de scraping de bundles da Steam com detecção de promoções falsas, histórico de preços e sincronização cloud.

## Características

- **Scraping Híbrido**: aiohttp (rápido) + Playwright (preços dinâmicos)
- **Banco de Dados**: PostgreSQL com histórico completo de preços
- **Detecção de Fraudes**: Identifica "metade do dobro" automaticamente
- **Proteção SD Card**: Otimizado para Orange Pi (logs em RAM)
- **Sync Cloud**: Sincronização automática com Supabase
- **Cron Robusto**: Execuções periódicas sem memory leaks

## Estrutura do Projeto

```
SteamBundleAPI/
├── scraper/                    # Módulo principal Python
│   ├── scraper.py             # Scraping com aiohttp
│   ├── browser_scraper.py     # Scraping com Playwright
│   ├── mapper.py              # HTML para objetos
│   ├── filters.py             # Validações e filtros
│   ├── database.py            # SQLAlchemy models
│   ├── sync_supabase.py       # Sincronização cloud
│   ├── config.py              # Configurações
│   ├── logger.py              # Logging otimizado
│   ├── main.py                # Script básico
│   └── main_with_db.py        # Script completo
├── scripts/
│   ├── crontab                # Schedule de execuções
│   ├── entrypoint-cron.sh     # Entrypoint Docker
│   ├── supabase_schema.sql    # Schema do Supabase
│   └── run_sync.py            # Helper de sincronização
├── docker-compose.yml          # Orquestração Docker
├── Dockerfile                  # Container da aplicação
└── docs/
    ├── ARCHITECTURE.md        # Arquitetura detalhada
    ├── DEPLOY.md             # Guia de deploy
    └── MIGRATION_GUIDE.md    # Guia de migração
```

## Quick Start

### Desenvolvimento Local

```bash
# Instalar dependências
cd scraper
pip install -r requirements.txt
playwright install chromium

# Executar scraper básico (SQLite)
python main_with_db.py
```

### Produção com Docker (Orange Pi)

```bash
# Setup inicial
git clone https://github.com/matheus-fsc/SteamBundleAPI.git
cd SteamBundleAPI
cp .env.example .env
nano .env  # Configure senhas

# Build e start
docker compose up -d

# Verificar
docker compose logs -f scraper-cron
```

## Arquitetura

```
Steam Store
    |
    | (Scraping)
    v
Orange Pi (Docker)
    |
    +-- PostgreSQL Local (histórico completo)
    |
    | (Sync periódico)
    v
Supabase Cloud (vitrine pública, API REST)
```

### Fluxo de Dados

1. **Fase 1**: Scraping rápido com aiohttp (90% dos bundles)
2. **Fase 2**: Scraping com Playwright para preços dinâmicos (10% restante)
3. **Persistência**: PostgreSQL local com histórico infinito
4. **Análise**: Detecção de promoções falsas via histórico
5. **Sync**: Envio de dados filtrados para Supabase

Ver [ARCHITECTURE.md](ARCHITECTURE.md) para detalhes completos.

## Configuração

### Variáveis de Ambiente (.env)

```bash
# Banco de dados local
DB_PASSWORD=senha_segura_aqui

# Scraper
REQUEST_DELAY=2
MAX_CONCURRENT_REQUESTS=5

# Supabase (opcional)
ENABLE_SUPABASE_SYNC=true
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_KEY=sua_key_aqui

# Timezone
TZ=America/Sao_Paulo
```

### Schedule de Execuções

Edite `scripts/crontab` para ajustar horários:

```cron
# Scraping completo: 3AM e 3PM
0 3 * * * cd /app && python -m scraper.main_with_db
0 15 * * * cd /app && python -m scraper.main_with_db

# Sync Supabase: a cada 6 horas
0 */6 * * * cd /app && python -m scraper.sync_supabase
```

## Detecção de Promoções Falsas

O sistema mantém histórico de preços e detecta automaticamente quando um desconto é falso:

### Como Funciona

1. Coleta histórico dos últimos 30 dias
2. Calcula preço regular médio (sem desconto)
3. Compara "preço original" atual com média histórica
4. Se > 150% da média, marca como falso

### Exemplo

```python
{
  "name": "Super Bundle",
  "discount": 75,
  "final_price": 50.0,
  "original_price": 200.0,  # Preço inflado
  "is_discount_real": false,
  "discount_analysis": "Preço original inflado 144%"
}
```

## Supabase (Vitrine Pública)

### Setup

1. Crie projeto no [Supabase](https://supabase.com)
2. Execute `scripts/supabase_schema.sql` no SQL Editor
3. Configure credenciais no `.env`
4. Reinicie containers

### Consumir API

**JavaScript/TypeScript:**

```javascript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Top 10 deals
const { data } = await supabase
  .from('top_deals')
  .select('*')
  .limit(10)

// Filtrar por moeda
const { data } = await supabase
  .from('bundles')
  .select('*')
  .eq('currency', 'BRL')
  .gt('discount', 50)
  .order('discount', { ascending: false })
```

**Python:**

```python
from supabase import create_client

supabase = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)

response = supabase.table('bundles')\
    .select('*')\
    .eq('currency', 'BRL')\
    .gt('discount', 50)\
    .execute()
```

**REST API:**

```bash
curl "https://seu-projeto.supabase.co/rest/v1/top_deals" \
  -H "apikey: SUPABASE_ANON_KEY"
```

## Comandos Docker

```bash
# Iniciar todos os serviços
docker compose up -d

# Ver logs
docker compose logs -f scraper-cron

# Executar manualmente
docker compose exec scraper python -m scraper.main_with_db

# Sincronizar Supabase
docker compose exec scraper python -m scraper.sync_supabase

# Parar tudo
docker compose down

# Status dos serviços
docker compose ps

# Uso de recursos
docker stats
```

## Proteção do SD Card (Orange Pi)

O projeto está otimizado para evitar desgaste do cartão SD:

- Logs apenas para stdout (Docker gerencia)
- Banco em volume Docker (melhor I/O)
- Tmpfs para arquivos temporários
- Processo cron morre e renasce (evita memory leaks)

Ver [DEPLOY.md](DEPLOY.md) para detalhes.

## Monitoramento

```bash
# Health check
docker compose ps

# Logs em tempo real
docker compose logs -f scraper-cron

# Estatísticas do banco
docker compose exec postgres psql -U steam -d steam_bundles -c \
  "SELECT COUNT(*), AVG(discount), AVG(final_price) FROM bundles WHERE is_valid = true;"

# Top deals no banco local
docker compose exec postgres psql -U steam -d steam_bundles -c \
  "SELECT name, discount, final_price FROM bundles 
   WHERE discount > 50 ORDER BY discount DESC LIMIT 10;"
```

## Troubleshooting

### Playwright não funciona

```bash
docker compose exec scraper playwright install chromium
```

### Banco não conecta

```bash
# Verificar status
docker compose ps

# Ver logs
docker compose logs postgres

# Testar conexão
docker compose exec postgres psql -U steam -d steam_bundles
```

### Orange Pi lento

Reduza recursos no `.env`:

```bash
MAX_CONCURRENT_REQUESTS=2
REQUEST_DELAY=3
```

E no `docker-compose.yml`:

```yaml
deploy:
  resources:
    limits:
      cpus: '0.5'
      memory: 256M
```

### Supabase sync falha

```bash
# Testar conexão
docker compose exec scraper python -c "
from scraper.sync_supabase import SupabaseSync
sync = SupabaseSync()
print('OK' if sync.test_connection() else 'FALHOU')
"
```

## Testes

```bash
# Teste completo
python test_scraper.py

# Teste de scraping
python test_scraper.py single

# Teste de listagem
python test_scraper.py list

# Teste de banco de dados
python test_database.py
```

Ver [TEST_RESULTS.md](TEST_RESULTS.md) para resultados.

## Documentação

- [ARCHITECTURE.md](ARCHITECTURE.md) - Arquitetura detalhada do sistema
- [DEPLOY.md](DEPLOY.md) - Guia completo de deploy
- [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md) - Guia de migração da v1
- [OLD_VERSION_DEPRECATED.md](OLD_VERSION_DEPRECATED.md) - Versão antiga deprecada
- [scraper/README.md](scraper/README.md) - Documentação do módulo

## Stack Tecnológica

- **Python** 3.13
- **SQLAlchemy** - ORM assíncrono
- **aiohttp** - HTTP client assíncrono
- **Playwright** - Browser automation
- **PostgreSQL** - Banco de dados
- **Docker** - Containerização
- **Supabase** - Backend as a Service (opcional)

## Contribuindo

1. Fork o projeto
2. Crie uma branch (`git checkout -b feature/nova-feature`)
3. Commit suas mudanças (`git commit -am 'Adiciona nova feature'`)
4. Push para a branch (`git push origin feature/nova-feature`)
5. Abra um Pull Request

## Licença

MIT License - veja LICENSE para detalhes.

## Créditos

- Scraping: BeautifulSoup + Playwright
- Banco: SQLAlchemy + PostgreSQL
- Cloud: Supabase
- Deploy: Docker + Orange Pi

## Links Úteis

- [Steam Store Bundles](https://store.steampowered.com/bundles/)
- [Supabase Documentation](https://supabase.com/docs)
- [Playwright Python](https://playwright.dev/python/)
- [SQLAlchemy Async](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html)
- [Docker Compose](https://docs.docker.com/compose/)

## Status do Projeto

**Versão:** 2.0.0  
**Status:** Produção  
**Última atualização:** Novembro 2025

### Changelog

**v2.0.0** (Nov 2025)
- Refatoração completa de Node.js para Python
- Implementação de scraping híbrido
- Sistema de histórico de preços
- Detecção de promoções falsas
- Deploy otimizado para Orange Pi
- Sincronização com Supabase

**v1.x** (Deprecated)
- Versão Node.js descontinuada
- Ver [OLD_VERSION_DEPRECATED.md](OLD_VERSION_DEPRECATED.md)
