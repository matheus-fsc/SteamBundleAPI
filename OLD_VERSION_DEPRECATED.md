# ⚠️ DEPRECATED - Versão Node.js

**Esta versão do projeto está descontinuada.**

## 🔄 Migração para Python

Este projeto foi completamente refatorado e migrado de **Node.js para Python**.

### 🆕 Nova Versão (v2.0)

A nova versão oferece:

- ✅ **Melhor Performance**: Scraping híbrido (aiohttp + Playwright)
- ✅ **Banco de Dados Robusto**: PostgreSQL com histórico completo
- ✅ **Detecção de Fraudes**: Identifica promoções falsas automaticamente
- ✅ **Deploy Otimizado**: Docker + Orange Pi com proteção de SD Card
- ✅ **Sincronização Cloud**: Integração com Supabase
- ✅ **Cron Robusto**: Sem memory leaks

### 📦 Localização da Nova Versão

Toda a nova implementação está na branch `main`:

```
SteamBundleAPI/
├── scraper/              # Módulo Python (nova implementação)
├── scripts/              # Scripts auxiliares
├── docker-compose.yml    # Orquestração
├── Dockerfile           # Container da aplicação
├── ARCHITECTURE.md      # Arquitetura completa
├── DEPLOY.md           # Guia de deploy
└── README.md           # Documentação principal
```

### 🚀 Como Usar a Nova Versão

```bash
# Clone o repositório
git clone https://github.com/matheus-fsc/SteamBundleAPI.git
cd SteamBundleAPI

# Configure ambiente
cp .env.example .env
nano .env  # Adicione suas configurações

# Inicie com Docker
docker compose up -d

# Veja logs
docker compose logs -f scraper-cron
```

### 📖 Documentação

- [README.md](../README.md) - Visão geral e quick start
- [ARCHITECTURE.md](../ARCHITECTURE.md) - Arquitetura detalhada
- [DEPLOY.md](../DEPLOY.md) - Guia completo de deploy
- [scraper/README.md](../scraper/README.md) - Documentação do módulo

### 🔗 Links Úteis

- **Repositório**: https://github.com/matheus-fsc/SteamBundleAPI
- **Issues**: https://github.com/matheus-fsc/SteamBundleAPI/issues
- **Documentação Completa**: Veja os arquivos `.md` no repositório

### ❓ Por que a Mudança?

1. **Hospedagem própria**: A nova versão roda em Orange Pi (sem custo de hosting)
2. **Histórico completo**: PostgreSQL mantém histórico infinito de preços
3. **Detecção de fraudes**: Algoritmo detecta "metade do dobro" automaticamente
4. **Performance**: Scraping assíncrono mais eficiente
5. **Custo zero**: Apenas energia do Orange Pi (~R$ 5/mês)

### 🗓️ Timeline

- **Até Nov 2025**: Versão Node.js (deprecated)
- **Nov 2025**: Migração para Python v2.0
- **Futuro**: Melhorias contínuas na v2.0

---

**Nota**: Esta documentação refere-se à versão antiga. Para a documentação atual, consulte o [README.md](../README.md) principal.
