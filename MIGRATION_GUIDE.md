# 🔄 Guia de Deploy - Migração v1 → v2

## 📋 Checklist de Deploy

### Pré-Deploy

- [ ] Backup da versão antiga (se houver dados importantes)
- [ ] Revisar mudanças: `git status`
- [ ] Testar localmente: `python test_scraper.py`
- [ ] Configurar `.env` com senhas seguras
- [ ] Validar Docker instalado

### Deploy

```bash
# 1. Fazer backup da versão antiga (opcional)
git checkout -b old-version-backup
git push origin old-version-backup

# 2. Voltar para main
git checkout main

# 3. Adicionar novos arquivos
git add .

# 4. Commitar mudanças
git commit -m "♻️ Refatoração completa: Node.js → Python v2.0

- Migração de Node.js para Python com SQLAlchemy
- Implementação de scraping híbrido (aiohttp + Playwright)
- Sistema de histórico de preços completo
- Detecção automática de promoções falsas
- Deploy otimizado para Docker + Orange Pi
- Sincronização com Supabase (vitrine pública)
- Cron robusto sem memory leaks
- Proteção de SD Card (logs em RAM)

BREAKING CHANGE: API Node.js descontinuada
Veja OLD_VERSION_DEPRECATED.md para detalhes da migração"

# 5. Push para GitHub
git push origin main

# 6. Criar tag da nova versão
git tag -a v2.0.0 -m "v2.0.0 - Refatoração Python completa"
git push origin v2.0.0

# 7. (Opcional) Criar release no GitHub
# Vá para: https://github.com/matheus-fsc/SteamBundleAPI/releases/new
```

### Pós-Deploy

- [ ] Atualizar README no GitHub
- [ ] Atualizar descrição do repositório
- [ ] Criar release notes
- [ ] Testar clone fresco: `git clone ...`
- [ ] Deploy no Orange Pi
- [ ] Configurar Supabase (se usar)

## 🎯 Comandos Detalhados

### 1. Revisar Mudanças

```bash
# Ver o que foi deletado (versão antiga)
git status | grep deleted

# Ver o que foi adicionado (versão nova)
git status | grep "Untracked"

# Ver mudanças em arquivos modificados
git diff README.md
git diff .env.example
```

### 2. Stage dos Arquivos

```bash
# Adicionar arquivos novos
git add scraper/
git add scripts/
git add docker-compose.yml
git add Dockerfile
git add ARCHITECTURE.md
git add DEPLOY.md
git add README.md
git add .gitignore
git add .env.example
git add TEST_RESULTS.md
git add OLD_VERSION_DEPRECATED.md

# Remover arquivos antigos (já deletados)
git add -u

# Verificar o que vai ser commitado
git status
```

### 3. Commit com Mensagem Descritiva

```bash
git commit -m "♻️ Refatoração completa: Node.js → Python v2.0

## 🎯 Mudanças Principais

### Arquitetura
- Migração completa de Node.js para Python 3.13
- Scraping híbrido: aiohttp (rápido) + Playwright (JS dinâmico)
- PostgreSQL com histórico completo de preços
- SQLAlchemy Async para ORM

### Features
- ✨ Detecção automática de promoções falsas ('metade do dobro')
- ✨ Histórico infinito de preços para análise
- ✨ Sincronização com Supabase (vitrine pública)
- ✨ Cron robusto no Docker (evita memory leaks)
- ✨ Proteção de SD Card (logs em RAM via tmpfs)

### Deploy
- 🐳 Docker Compose completo (Postgres + Scraper)
- 🍊 Otimizado para Orange Pi
- ☁️  Integração Supabase opcional
- ⏰ Cron configurável (2x/dia padrão)

### Documentação
- 📚 ARCHITECTURE.md - Diagrama completo do sistema
- 📚 DEPLOY.md - Guia de deploy detalhado
- 📚 README.md - Quick start e visão geral
- 📚 scraper/README.md - Documentação do módulo

### Testes
- ✅ Scraping de bundle individual
- ✅ Banco de dados SQLAlchemy
- ✅ Histórico de preços
- ✅ Detecção de fraudes

## 🚨 Breaking Changes

A API Node.js anterior foi completamente descontinuada.

- ❌ Removido: Express API
- ❌ Removido: Sistema de rotas Node.js
- ❌ Removido: Storage em JSON
- ✅ Novo: Scraper Python modular
- ✅ Novo: PostgreSQL para histórico
- ✅ Novo: API REST via Supabase (opcional)

## 📖 Migração

Para usuários da versão antiga, consulte: OLD_VERSION_DEPRECATED.md

## 🔗 Links

- Deploy Guide: DEPLOY.md
- Architecture: ARCHITECTURE.md
- Tests: TEST_RESULTS.md

---

**Stack:** Python 3.13, SQLAlchemy, aiohttp, Playwright, Docker, PostgreSQL, Supabase
**Status:** ✅ Pronto para produção"
```

### 4. Push e Release

```bash
# Push do commit
git push origin main

# Criar tag
git tag -a v2.0.0 -m "v2.0.0 - Refatoração Python

Migração completa de Node.js para Python com:
- Scraping híbrido otimizado
- Banco de dados com histórico
- Detecção de promoções falsas
- Deploy Docker + Orange Pi
- Sincronização Supabase

BREAKING CHANGE: API Node.js descontinuada"

git push origin v2.0.0

# Listar tags
git tag -l
```

### 5. Criar Release no GitHub

1. Vá para: `https://github.com/matheus-fsc/SteamBundleAPI/releases/new`

2. Preencha:
   - **Tag**: `v2.0.0`
   - **Title**: `v2.0.0 - Refatoração Python Completa 🎉`
   - **Description**:

```markdown
# 🎉 v2.0.0 - Refatoração Completa: Python Edition

## 🚀 Highlights

Esta versão representa uma **refatoração completa** do projeto, migrando de Node.js para Python com arquitetura moderna e otimizada.

### ✨ Novas Features

- **Scraping Híbrido**: aiohttp (rápido) + Playwright (preços dinâmicos)
- **Histórico Completo**: PostgreSQL com histórico infinito de preços
- **Detecção de Fraudes**: Algoritmo detecta promoções falsas automaticamente
- **Deploy Otimizado**: Docker + Orange Pi com proteção de SD Card
- **Cron Robusto**: Execuções periódicas sem memory leaks
- **Sincronização Cloud**: Integração opcional com Supabase

### 🏗️ Arquitetura

```
Steam → Orange Pi (scraping) → PostgreSQL (histórico) → Supabase (vitrine)
```

### 📦 Como Usar

```bash
git clone https://github.com/matheus-fsc/SteamBundleAPI.git
cd SteamBundleAPI
cp .env.example .env
docker compose up -d
```

### 📚 Documentação

- [README.md](../README.md) - Quick start
- [ARCHITECTURE.md](../ARCHITECTURE.md) - Arquitetura detalhada
- [DEPLOY.md](../DEPLOY.md) - Guia de deploy
- [TEST_RESULTS.md](../TEST_RESULTS.md) - Resultados dos testes

### 🚨 Breaking Changes

**A versão anterior (Node.js) foi completamente descontinuada.**

Se você usava a versão antiga, consulte [OLD_VERSION_DEPRECATED.md](../OLD_VERSION_DEPRECATED.md).

### 🎯 Stack

- Python 3.13
- SQLAlchemy (Async ORM)
- aiohttp + Playwright
- PostgreSQL
- Docker + Docker Compose
- Supabase (opcional)

### ✅ Testes

Todos os testes principais passaram:
- ✅ Scraping de bundles
- ✅ Banco de dados
- ✅ Histórico de preços
- ✅ Detecção de fraudes

---

**Full Changelog**: https://github.com/matheus-fsc/SteamBundleAPI/compare/v1.0.0...v2.0.0
```

3. Clique em **"Publish release"**

## 🍊 Deploy no Orange Pi

```bash
# No Orange Pi (via SSH)
ssh user@orange-pi-ip

# Parar versão antiga (se existir)
cd ~/SteamBundleAPI-old
docker compose down
cd ~

# Clone nova versão
git clone https://github.com/matheus-fsc/SteamBundleAPI.git
cd SteamBundleAPI

# Configure
cp .env.example .env
nano .env  # Edite senhas

# Inicie serviços
docker compose up -d

# Verifique logs
docker compose logs -f scraper-cron

# Status
docker compose ps
```

## ☁️ Configurar Supabase (Opcional)

```bash
# 1. Criar projeto em supabase.com
# 2. SQL Editor → Executar scripts/supabase_schema.sql
# 3. Copiar credenciais

# 4. Adicionar no .env
ENABLE_SUPABASE_SYNC=true
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_KEY=eyJhbG...sua_key_aqui

# 5. Reiniciar containers
docker compose restart
```

## 📊 Atualizar Descrição do Repositório

No GitHub, vá em **Settings** do repositório e atualize:

**Description:**
```
🎮 Steam Bundle Scraper com detecção de promoções falsas | Python + PostgreSQL + Docker | Orange Pi optimized
```

**Topics (tags):**
```
steam, scraper, python, docker, postgresql, supabase, 
orange-pi, web-scraping, playwright, sqlalchemy, 
price-tracker, bundle-deals
```

**Website:**
```
https://seu-projeto.supabase.co  (se usar Supabase)
```

## 🔄 Atualizar README Badge

Adicione badges no topo do README.md:

```markdown
![Python](https://img.shields.io/badge/python-3.13-blue)
![Docker](https://img.shields.io/badge/docker-compose-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Status](https://img.shields.io/badge/status-production-success)
```

## ✅ Checklist Final

- [ ] Commit e push realizados
- [ ] Tag v2.0.0 criada
- [ ] Release no GitHub publicado
- [ ] README atualizado
- [ ] Descrição do repo atualizada
- [ ] Deploy no Orange Pi funcionando
- [ ] Supabase configurado (opcional)
- [ ] Logs monitorados
- [ ] Testes passando
- [ ] Documentação completa

## 🎉 Pronto!

Sua nova versão está no ar! 🚀

Para ver o status:
```bash
docker compose ps
docker compose logs -f
```

---

**Qualquer dúvida, consulte**: [DEPLOY.md](../DEPLOY.md) ou [ARCHITECTURE.md](../ARCHITECTURE.md)
