# Sistema Autônomo de Descoberta e Scraping

## Visão Geral

O sistema agora é **100% autônomo** e funciona com descoberta inteligente + scraping incremental.

## Arquivos de Dados

### `data/known_bundles.json`
Lista completa de bundle IDs descobertos:
```json
{
  "last_updated": "2025-11-20T22:00:00Z",
  "total": 2547,
  "bundle_ids": [1, 2, 3, ...],
  "diff": {
    "added": [34567, 34568],
    "removed": [123],
    "added_count": 2,
    "removed_count": 1
  }
}
```

### `data/bundle_changes.json`
Mudanças detectadas (criado após descoberta, deletado após processamento):
```json
{
  "timestamp": "2025-11-20T22:00:00Z",
  "added": [34567, 34568],
  "removed": [123],
  "added_count": 2,
  "removed_count": 1
}
```

## Scripts

### 1. `scripts/discover_with_diff.py`
**Descoberta inteligente com diff**

- Executa força bruta completa (ID 1-35000)
- Compara com lista anterior
- Detecta novos e removidos
- Salva em JSON
- ~10-15 minutos de execução

```bash
python scripts/discover_with_diff.py
```

**Quando usar:**
- Semanalmente (automatizado via cron)
- Após mudanças grandes da Steam
- Primeira execução do sistema

### 2. `scripts/scrape_incremental.py`
**Scraping apenas de novos bundles**

- Lê `bundle_changes.json`
- Busca detalhes APENAS dos novos
- Atualiza banco de dados
- Marca removidos como inativos
- ~1-2 minutos se houver poucos novos

```bash
python scripts/scrape_incremental.py
```

**Quando usar:**
- Logo após descoberta (cron automático)
- Para processar novos bundles rapidamente

### 3. `scraper/main_with_db.py`
**Scraping completo de todos os bundles**

- Busca TODOS os bundles da lista
- Atualiza preços e descontos
- ~5-10 minutos para 2500 bundles

```bash
python -m scraper.main_with_db
```

**Quando usar:**
- Diariamente para atualizar preços
- Garantir que todos têm dados atualizados

## Fluxo Autônomo (Cron)

### Segunda-feira 02:00
```bash
python scripts/discover_with_diff.py
```
- Descobre TODOS os IDs
- Detecta novos e removidos
- Salva `known_bundles.json`
- Cria `bundle_changes.json`

### Segunda-feira 03:00
```bash
python scripts/scrape_incremental.py
```
- Lê `bundle_changes.json`
- Scraping APENAS dos novos
- Deleta `bundle_changes.json`

### Diariamente 06:00
```bash
python -m scraper.main_with_db
```
- Scraping completo
- Atualiza preços de TODOS

### Diariamente 12:00
```bash
python -m scraper.main_with_db
```
- Segunda atualização do dia
- Captura promoções que iniciaram

### A cada 6 horas
```bash
python -m scraper.sync_supabase
```
- Sincroniza com Supabase (opcional)

## Vantagens

1. **Eficiência**: Scraping incremental economiza 90% do tempo
2. **Autonomia**: Sistema detecta mudanças sozinho
3. **Resiliência**: Fallback para scraping completo se necessário
4. **Rastreabilidade**: Histórico de mudanças em JSON
5. **Performance**: Orange Pi processa apenas o necessário

## Primeira Execução

```bash
# 1. Descoberta inicial (obrigatória)
python scripts/discover_with_diff.py

# 2. Scraping completo inicial
python -m scraper.main_with_db

# 3. Deploy no Orange Pi
git add data/ scripts/
git commit -m "feat: sistema autônomo de descoberta"
git push origin main

# No Orange Pi
cd ~/SteamBundleAPI
git pull
docker compose restart scraper
```

## Monitoramento

```bash
# Ver logs do cron
docker compose logs -f scraper

# Verificar descobertas
cat data/known_bundles.json | jq '.total, .diff'

# Ver mudanças detectadas
cat data/bundle_changes.json

# Verificar última atualização
cat data/known_bundles.json | jq '.last_updated'
```

## Troubleshooting

### Descoberta encontrou 0 bundles
```bash
# Execute manualmente para ver erros
python scripts/discover_with_diff.py
```

### Scraping incremental não processa mudanças
```bash
# Verifique se bundle_changes.json existe
ls -la data/bundle_changes.json

# Se não existir, não há mudanças ou já foi processado
```

### Forçar scraping completo
```bash
# Ignora incremental, busca tudo
python -m scraper.main_with_db
```

## Estrutura de Dados

```
data/
├── known_bundles.json     # Lista completa (sempre presente)
├── bundle_changes.json    # Mudanças (criado/deletado automaticamente)
└── bundles.json          # Backup JSON dos dados completos
```

## Logs

```
logs/
└── scraper_YYYYMMDD.log  # Log do dia
```

Todos os logs também vão para stdout (Docker).
