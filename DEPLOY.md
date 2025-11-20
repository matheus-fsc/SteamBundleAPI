# Steam Bundle Scraper - Setup e Deploy no Orange Pi

## 🚀 Quick Start (Desenvolvimento Local)

```bash
# 1. Instalar dependências
cd scraper
pip install -r requirements.txt

# 2. Instalar browsers do Playwright
playwright install chromium

# 3. Executar scraper
python main_with_db.py
```

## 🐳 Deploy no Orange Pi com Docker

### Pré-requisitos

```bash
# Instalar Docker e Docker Compose no Orange Pi
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Instalar Docker Compose
sudo apt-get install docker-compose-plugin
```

### Setup

```bash
# 1. Clone o repositório no Orange Pi
git clone https://github.com/matheus-fsc/SteamBundleAPI.git
cd SteamBundleAPI

# 2. Configure variáveis de ambiente
cp .env.example .env
nano .env  # Edite e adicione senha segura

# 3. Build e inicie containers
docker compose up -d

# 4. Verifique logs
docker compose logs -f scraper

# 5. Verifique banco de dados
docker compose exec postgres psql -U steam -d steam_bundles
```

### Comandos Úteis

```bash
# Ver logs
docker compose logs -f scraper

# Parar serviços
docker compose down

# Reiniciar scraper
docker compose restart scraper

# Executar scraper manualmente
docker compose exec scraper python -m scraper.main_with_db

# Backup do banco
docker compose exec postgres pg_dump -U steam steam_bundles > backup.sql

# Restore do banco
docker compose exec -T postgres psql -U steam steam_bundles < backup.sql

# Ver uso de recursos
docker stats

# Limpar dados antigos (cuidado!)
docker compose down -v  # Remove volumes também
```

## 📊 Estrutura de Banco de Dados

### Tabelas

- **bundles**: Bundles com histórico de preços
- **games**: Jogos individuais
- **scraping_logs**: Logs de execuções

### Queries Úteis

```sql
-- Top bundles por desconto
SELECT name, discount, final_price, currency 
FROM bundles 
WHERE discount > 50 
ORDER BY discount DESC 
LIMIT 10;

-- Bundles que precisam de browser scraping
SELECT id, name, needs_browser_scraping 
FROM bundles 
WHERE needs_browser_scraping = true;

-- Histórico de preços de um bundle
SELECT name, price_history 
FROM bundles 
WHERE id = '28631';

-- Estatísticas gerais
SELECT 
    COUNT(*) as total,
    AVG(discount) as avg_discount,
    AVG(final_price) as avg_price
FROM bundles 
WHERE is_valid = true;
```

## ⚙️ Configurações

### Proteção do Cartão SD

O projeto está configurado para proteger o cartão SD do Orange Pi:

1. **Logs em tmpfs**: Logs vão para RAM, não para disco
2. **Volumes Docker**: Dados do PostgreSQL em volume gerenciado
3. **Read-only volumes**: Código montado como read-only

### Ajuste de Performance

Para o Orange Pi, ajuste no `docker-compose.yml`:

```yaml
deploy:
  resources:
    limits:
      cpus: '1.0'      # Reduza se estiver lento
      memory: 512M     # Ajuste conforme RAM disponível
```

### Frequência de Scraping

#### Opção 1: Cron no Docker (RECOMENDADO) ✅

O projeto já vem com serviço `scraper-cron` configurado:

```bash
# Inicie o serviço de cron
docker compose up -d scraper-cron

# Verifique logs
docker compose logs -f scraper-cron

# Schedule padrão (scripts/crontab):
# - 3:00 AM: Scraping completo
# - 3:00 PM: Scraping rápido
# - A cada 6h: Sync Supabase
```

**Vantagens do Cron no Docker:**
- ✅ Processo morre e renasce limpo (evita memory leaks)
- ✅ Isolado do sistema host
- ✅ Logs integrados com Docker
- ✅ Fácil de ajustar horários

**Customizar horários:**

Edite `scripts/crontab` e reinicie:

```bash
# Editar
nano scripts/crontab

# Reiniciar
docker compose restart scraper-cron
```

#### Opção 2: Execução Manual

```bash
# Scraping completo
docker compose exec scraper python -m scraper.main_with_db

# Apenas sincronização
docker compose exec scraper python -m scraper.sync_supabase
```

## 🔍 Estratégia Híbrida de Scraping

O scraper usa duas fases:

### Fase 1: aiohttp (Rápido)
- Scraping básico de todos os bundles
- Detecta bundles com preços dinâmicos
- ~90% dos bundles funcionam aqui

### Fase 2: Playwright (Pesado)
- Apenas para bundles que falharam na Fase 1
- Executa JavaScript para preços dinâmicos
- Bundles "Complete Your Collection"

### Detecção Automática

O scraper detecta automaticamente quando precisa de browser:
- Preço None ou 0
- Texto "Complete Your Collection"
- Elementos de preço dinâmico

## 📈 Análise de Promoções Reais

O sistema mantém histórico de preços para detectar "metade do dobro":

```python
# Analisar bundle específico
from scraper.database import Database

async def analyze():
    db = Database()
    await db.init_db()
    
    bundle = await db.get_bundle_by_id('28631')
    analysis = bundle.get_real_discount()
    
    print(analysis)
    # {'is_real': False, 'reason': 'Preço original inflado', ...}

asyncio.run(analyze())
```

## 🛡️ Segurança

- Containers rodam como usuário não-root
- Banco de dados com senha forte (configure em `.env`)
- Read-only volumes quando possível
- Network isolada no Docker

## 📝 Monitoramento

```bash
# Ver uso de recursos
docker stats

# Ver logs em tempo real
docker compose logs -f

# Ver últimas execuções
docker compose exec postgres psql -U steam -d steam_bundles -c "SELECT * FROM scraping_logs ORDER BY started_at DESC LIMIT 5;"
```

## 🐛 Troubleshooting

### Playwright não funciona

```bash
# Reinstalar browsers
docker compose exec scraper playwright install chromium
```

### Banco de dados não conecta

```bash
# Verificar se PostgreSQL está rodando
docker compose ps

# Ver logs do banco
docker compose logs postgres

# Testar conexão
docker compose exec postgres psql -U steam -d steam_bundles
```

### Orange Pi fica lento

```bash
# Reduza concorrência no .env
MAX_CONCURRENT_REQUESTS=2
REQUEST_DELAY=3

# Reduza recursos no docker-compose.yml
cpus: '0.5'
memory: 256M
```

### Cartão SD corrompendo

- Verifique se tmpfs está configurado para logs
- Use volume Docker para PostgreSQL (não bind mount)
- Considere usar USB/SSD externo para dados

## ☁️ Sincronização com Supabase (Vitrine Pública)

O Orange Pi é a "fábrica" (scraping + banco local). O Supabase é a "vitrine" (API pública).

### Setup do Supabase

1. **Crie projeto no Supabase** (gratuito): https://supabase.com

2. **Execute o schema SQL**:
   - Vá em SQL Editor no Supabase
   - Cole o conteúdo de `scripts/supabase_schema.sql`
   - Execute

3. **Configure credenciais**:

```bash
# Edite .env
nano .env

# Adicione:
ENABLE_SUPABASE_SYNC=true
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_KEY=sua_service_key_aqui
```

4. **Reinicie containers**:

```bash
docker compose down
docker compose up -d
```

### Como Funciona

```
┌─────────────┐    Scraping     ┌──────────────┐    Sync      ┌──────────────┐
│  Steam      │ ───────────────> │  Orange Pi   │ ──────────> │   Supabase   │
│  (origem)   │    (aiohttp)     │  (Postgres)  │  (upsert)   │   (vitrine)  │
└─────────────┘                  └──────────────┘              └──────────────┘
                                       ↓                               ↓
                                  Histórico                     API Pública
                                  Completo                      (últimos 30d)
```

### Sincronização Automática

O cron já executa sync a cada 6 horas. Para ajustar:

```bash
# Edite scripts/crontab
# Altere linha:
0 */6 * * * cd /app && python -m scraper.sync_supabase
```

### Sincronização Manual

```bash
# Sync completo
docker compose exec scraper python -m scraper.sync_supabase

# Ou use o script helper
docker compose exec scraper python scripts/run_sync.py
```

### Limpeza de Dados Antigos

```python
# No script sync_supabase.py, chame:
await sync_to_supabase(cleanup_old=True)

# Remove bundles não atualizados há 90+ dias
```

### Consultar API Supabase

```javascript
// No frontend (Next.js, React, etc)
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://seu-projeto.supabase.co',
  'sua_anon_key'  // Chave pública, não a service_key!
)

// Top 10 deals
const { data } = await supabase
  .from('top_deals')
  .select('*')
  .limit(10)

// Bundles recentes
const { data } = await supabase
  .from('recent_bundles')
  .select('*')

// Filtrar por moeda
const { data } = await supabase
  .from('bundles')
  .select('*')
  .eq('currency', 'BRL')
  .eq('is_valid', true)
  .gt('discount', 50)
  .order('discount', { ascending: false })
```

## 📚 Referências

- [SQLAlchemy Async](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html)
- [Playwright Python](https://playwright.dev/python/)
- [Docker Best Practices](https://docs.docker.com/develop/dev-best-practices/)
- [Orange Pi Optimization](https://www.armbian.com/orange-pi-5/)
- [Supabase Documentation](https://supabase.com/docs)
- [Supabase Python Client](https://supabase.com/docs/reference/python/introduction)
