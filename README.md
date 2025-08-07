# 🎮 Steam Bundle API

> **Sistema de coleta de bundles da Steam com suporte a logs persistentes e Blue-Green deployment**

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.21+-blue.svg)](https://expressjs.com/)
[![Render](https://img.shields.io/badge/Deploy-Render%20Free-purple.svg)](https://render.com/)

## 🚀 **Principais Funcionalidades**

- **🔍 Coleta Automatizada**: Scraping de bundles da Steam com preços em BRL
- **📊 Storage API**: Dados armazenados via PostgreSQL na Vercel
- **🔄 Blue-Green Deployment**: Sistema de backup para atualizações sem downtime
- **📝 Logs Persistentes**: Sistema de logging na database (substitui console.log)
- **⏰ Agendamento Inteligente**: Execução semanal (domingos às 3h)
- **🛡️ Keep-Alive System**: Mantém servidor ativo durante operações longas

## **Arquitetura do Sistema**

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Steam Bundle API (Render)                   │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌────────────────┐  ┌─────────────────────┐   │
│  │  Fetch Bundles  │  │  Update Details │  │  Persistent Logger  │   │
│  │  (Basic Info)   │  │  (Steam Pages)  │  │  (Database Logs)    │   │
│  └─────────────────┘  └────────────────┘  └─────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   Storage API (PostgreSQL - Vercel)                │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────────┐  ┌─────────────────────────┐   │
│  │   bundles   │  │  bundles_backup │  │    process_logs         │   │
│  │   (active)  │  │  (blue-green)   │  │    (persistent logs)    │   │
│  └─────────────┘  └─────────────────┘  └─────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## ⚙️ **Configuração Rápida**

### 1. **Variáveis de Ambiente (.env)**
```bash
# === STORAGE API (OBRIGATÓRIO) ===
STORAGE_API_URL=https://bundleset-api-storage.vercel.app
STORAGE_API_KEY=sua_api_key_aqui

# === RENDER DEPLOYMENT ===
NODE_ENV=production
PORT=3000
RENDER_EXTERNAL_URL=https://steambundleapi.onrender.com

# === STEAM API (Configuração Conservadora) ===
STEAM_API_DELAY=2000
FETCH_BUNDLES_CONCURRENT=2
BUNDLE_DETAILS_DELAY=3000

# === LOGS PERSISTENTES ===
PERSISTENT_LOGGING=true
LOG_BUFFER_SIZE=10

# === AGENDAMENTO ===
UPDATE_SCHEDULE_MODE=WEEKLY
CRON_EXPRESSION=0 3 * * 0

# === KEEP-ALIVE ===
KEEP_ALIVE_ENABLED=true
KEEP_ALIVE_INTERVAL=480000
```

### 2. **Instalação**
```bash
npm install
npm start
```

## 📖 **Endpoints Principais**

### 🔍 **Consulta de Dados**
```bash
# Buscar bundles (proxy para Storage API)
GET /api/bundles-detailed?limit=50&genre=Action

# Estatísticas
GET /api/steam-stats

# Status do sistema
GET /health
```

### 🔧 **Administração (Protegido)**
```bash
# Forçar atualização completa
GET /api/force-update
Headers: x-api-key: sua_api_key

# Atualização apenas de detalhes
GET /api/update-details
Headers: x-api-key: sua_api_key

# Teste com limite
GET /api/test-update?limit=100
Headers: x-api-key: sua_api_key

# Emergência: iniciar detalhamento
GET /api/emergency-detailed
Headers: x-api-key: sua_api_key
```

### **Logs Persistentes**
```bash
# Visualizar logs via Storage API
GET https://bundleset-api-storage.vercel.app/api/admin?operation=process-logs&process_name=SteamBundleAPI
Headers: x-api-key: storage_api_key
```

## 🔄 **Sistema Blue-Green Deployment**

O sistema utiliza três tabelas para atualizações sem downtime:

- **`bundles`**: Tabela principal (produção)
- **`bundles_backup`**: Backup da versão anterior
- **`bundles_active`**: Sistema de controle de qual versão usar

### Fluxo de Atualização:
1. **Backup**: Copia `bundles` → `bundles_backup`
2. **Update**: Sistema usa `bundles_backup` durante atualização
3. **Switch**: Após sucesso, volta para `bundles`
4. **Rollback**: Em caso de falha, restaura do backup

## 📝 **Sistema de Logs Persistentes**

### Por que foi implementado:
- **Render Free**: Console logs limitados (5min retenção)
- **Monitoramento**: Histórico completo de operações
- **Debug**: Logs estruturados com dados JSON

### Como funciona:
- Logs são enviados para `process_logs` na Storage API
- Buffer inteligente (10 logs por lote)
- Fallback para console em desenvolvimento
- Cleanup automático de logs antigos

## **Agendamento e Performance**

### Configuração Atual:
- **Frequência**: Semanal (domingos às 3h)
- **Fase 1**: Coleta básica (~10-20 min, ~10.000 bundles)
- **Fase 2**: Detalhamento (~40-80 horas, dados completos)

### Otimizações para Render Free:
- **CPU**: 0.1 core - delays de 2000ms entre requisições
- **RAM**: 500MB limite - apenas 2 requests concorrentes
- **Keep-Alive**: Sistema para evitar sleep durante operações longas

## **Principais Comandos**

### Desenvolvimento:
```bash
npm start              # Iniciar servidor
npm run test          # Testes básicos
node test-storage.js  # Testar conexão Storage API
```

### Monitoramento:
```bash
# Verificar logs persistentes
curl "https://bundleset-api-storage.vercel.app/api/admin?operation=process-logs&key=API_KEY"

# Status do sistema Blue-Green
curl "https://bundleset-api-storage.vercel.app/api/admin?operation=system-status&key=API_KEY"

# Análise de bundles processados
curl "https://bundleset-api-storage.vercel.app/api/admin?operation=processed-ids&key=API_KEY"
```

## � **Troubleshooting**

### Problemas Comuns:

1. **Keep-alive 503 errors**: Endpoints `/health` e `/api/health` configurados
2. **Steam API 502**: Delays conservadores (2000ms) implementados
3. **Bundles duplicados**: Sistema de filtro anti-duplicação ativo
4. **Logs não aparecem**: Verificar `PERSISTENT_LOGGING=true`
5. **Update não inicia automaticamente**: Usar `/api/emergency-detailed`

### Debug:
```bash
# Verificar configuração atual
curl "https://steambundleapi.onrender.com/health"

# Status da Storage API
curl "https://bundleset-api-storage.vercel.app/api/health"

# Logs do processo atual
curl "https://bundleset-api-storage.vercel.app/api/admin?operation=process-logs&key=API_KEY&limit=20"
```

## **Estrutura de Dados**
```

### Bundle Detalhado:
```json
{
  "bundle_id": "12345",
  "item_id": "67890",
  "item_name": "Game Name",
  "item_price": 19.99,
  "item_category": "Action",
  "item_developer": "Developer Name",
  "item_tags": ["Action", "Multiplayer"],
  "processed_at": "2025-08-07T12:00:00.000Z"
}
```

---

## **Stack Tecnológica**

- **Backend**: Node.js + Express
- **Database**: PostgreSQL (Vercel)
- **Deploy**: Render (Free Tier)
- **Monitoring**: Logs persistentes na database
- **Scheduling**: node-cron (weekly)

##  **Suporte**

- **Issues**: [GitHub Issues](https://github.com/matheus-fsc/SteamBundleAPI/issues)
- **Logs**: Sistema de logging persistente na Storage API
- **Monitoramento**: Endpoints de health e status
