# Steam Bundle Scraper

Sistema de scraping de bundles da Steam usando API oficial.

## Características

- **API Oficial**: Usa `/actions/ajaxresolvebundles` da Steam (sem HTML parsing)
- **Descoberta Automática**: Brute force otimizado com batches de 100 IDs
- **Banco de Dados**: SQLite/PostgreSQL com histórico de preços
- **Detecção de Fraudes**: Identifica promoções falsas via análise de histórico
- **Docker Ready**: Otimizado para Orange Pi
- **Sincronização Cloud**: Integração opcional com Supabase

## Estrutura do Projeto

```
SteamBundleAPI/
├── scraper/
│   ├── scraper.py             # Scraping via API oficial
│   ├── bundle_discovery.py    # Descoberta de bundle IDs (brute force)
│   ├── known_bundles.py       # Lista de IDs descobertos
│   ├── filters.py             # Validações e filtros
│   ├── database.py            # SQLAlchemy models
│   ├── sync_supabase.py       # Sincronização cloud
│   ├── config.py              # Configurações
│   ├── logger.py              # Logging
│   ├── main.py                # Script simples
│   └── main_with_db.py        # Script completo com DB
├── scripts/
│   ├── discover_bundles.py    # CLI para descoberta
│   ├── crontab                # Schedule
│   └── supabase_schema.sql    # Schema Supabase
├── docker-compose.yml
├── Dockerfile
└── README.md
```

## Quick Start

### Desenvolvimento Local

```bash
# 1. Instalar dependências
cd scraper
pip install -r requirements.txt

# 2. Descobrir bundles (primeira execução - 10-15 min)
python scripts/discover_bundles.py

# 3. Executar scraper
python -m scraper.main_with_db
```

### Produção com Docker (Orange Pi)

```bash
# Setup inicial
git clone https://github.com/matheus-fsc/SteamBundleAPI.git
cd SteamBundleAPI
cp .env.example .env
nano .env  # Configure as variáveis

# Build e start
docker compose up -d

# Verificar logs
docker compose logs -f scraper
```

## Como Funciona

### 1. Descoberta de Bundles

A Steam não fornece API para listar bundles, então usamos brute force otimizado:

```bash
python scripts/discover_bundles.py
```

- Varre IDs de 1 a 35000
- Faz requisições em batch (100 IDs por vez)
- Tempo: 10-15 minutos
- Resultado: ~2500-3000 bundle IDs válidos
- Salva em `scraper/known_bundles.py`

**Frequência recomendada**: Semanal (novos bundles são raros)

### 2. Scraping de Dados

```bash
python -m scraper.main_with_db
```

- Lê lista de `known_bundles.py`
- Busca dados via API `/actions/ajaxresolvebundles`
- Processa em batches de 100 para eficiência
- Salva no banco com histórico de preços

**Frequência recomendada**: Diária (via cron)

### 3. API da Steam

Endpoint usado: `https://store.steampowered.com/actions/ajaxresolvebundles`

Parâmetros:
- `bundleids`: Lista de IDs separados por vírgula (max 100)
- `cc`: Código do país (ex: BR)
- `l`: Idioma (ex: portuguese)

Resposta JSON com:
- Nome do bundle
- Preços (original e final, em centavos)
- Desconto
- Lista de apps/jogos inclusos
- Imagens
- Suporte de plataforma (Windows/Mac/Linux)

## Arquitetura

```
Steam API (/actions/ajaxresolvebundles)
    |
    | (Batch requests)
    v
Scraper (aiohttp async)
    |
    v
PostgreSQL/SQLite
    |
    | (Sync opcional)
    v
Supabase Cloud
```

### Fluxo Completo

1. **Descoberta** (semanal): Identifica todos os bundle IDs existentes
2. **Scraping** (diário): Busca dados atualizados de cada bundle
3. **Análise**: Detecta promoções falsas via histórico
4. **Sincronização**: Envia dados para Supabase (opcional)

## Configuração

### Variáveis de Ambiente (.env)

```bash
# Banco de dados local
DB_PASSWORD=senha_segura_aqui

# Scraper
REQUEST_DELAY=1
BATCH_SIZE=100
MAX_CONCURRENT_REQUESTS=5
COUNTRY_CODE=BR
LANGUAGE=portuguese

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
# Descoberta de bundles: Segunda-feira 2AM (semanal)
0 2 * * 1 cd /app && python scripts/discover_bundles.py

# Scraping completo: 3AM e 3PM (diário)
0 3 * * * cd /app && python -m scraper.main_with_db
0 15 * * * cd /app && python -m scraper.main_with_db

# Sync Supabase: a cada 6 horas (opcional)
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
docker compose logs -f scraper

# Executar descoberta manualmente
docker compose exec scraper python scripts/discover_bundles.py

# Executar scraping manualmente
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
- Sem arquivos temporários em disco
- Processo cron morre e renasce (evita memory leaks)

Ver [DEPLOY.md](DEPLOY.md) para detalhes.

## Monitoramento

```bash
# Health check
docker compose ps

# Logs em tempo real
docker compose logs -f scraper

# Estatísticas do banco
docker compose exec postgres psql -U steam -d steam_bundles -c \
  "SELECT COUNT(*), AVG(discount), AVG(final_price) FROM bundles WHERE is_valid = true;"

# Top deals no banco local
docker compose exec postgres psql -U steam -d steam_bundles -c \
  "SELECT name, discount, final_price FROM bundles 
   WHERE discount > 50 ORDER BY discount DESC LIMIT 10;"
```

## Troubleshooting

### Descoberta retorna poucos bundles

A descoberta completa deve encontrar ~2500-3000 bundles. Se encontrou menos:

```bash
# Execute novamente
python scripts/discover_bundles.py
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
REQUEST_DELAY=2
BATCH_SIZE=50
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


Ver [DEPLOY.md](DEPLOY.md) para detalhes.

## Documentação

- [ARCHITECTURE.md](ARCHITECTURE.md) - Arquitetura detalhada do sistema
- [DEPLOY.md](DEPLOY.md) - Guia completo de deploy
- [scraper/README.md](scraper/README.md) - Documentação do módulo

## Stack Tecnológica

- **Python** 3.13
- **SQLAlchemy** - ORM assíncrono
- **aiohttp** - HTTP client assíncrono
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

## Links Úteis

- [Steam API Documentation](https://steamapi.xpaw.me/)
- [Supabase Documentation](https://supabase.com/docs)
- [SQLAlchemy Async](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html)
- [Docker Compose](https://docs.docker.com/compose/)

## Status do Projeto

**Versão:** 3.0.0  
**Status:** Produção  
**Última atualização:** Novembro 2025

### Changelog

**v3.0.0** (Nov 2025)
- Migração completa para API oficial da Steam
- Remoção de HTML parsing e Playwright
- Sistema de descoberta via brute force otimizado
- Batch requests (100 IDs por requisição)
- Performance 10x melhor
- Código simplificado e mais confiável

**v2.0.0** (Nov 2025)
- Refatoração completa de Node.js para Python
- Implementação de scraping híbrido
- Sistema de histórico de preços
- Detecção de promoções falsas
- Deploy otimizado para Orange Pi

**v1.x** (Deprecated)
- Versão Node.js descontinuada
