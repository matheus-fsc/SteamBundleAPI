# SteamBundleAPI

Uma API segura e robusta para buscar e gerenciar bundles da Steam Store.

## ⚡ OTIMIZAÇÕES DE PERFORMANCE E MEMÓRIA

### Processamento Otimizado para Render Free
A versão atual inclui otimizações específicas para **Render Free (500MB RAM)** que garantem estabilidade e performance:

- **🧠 Gerenciamento de Memória**: Monitoramento ativo com salvamento quando atinge 300-350MB
- **� Salvamento Inteligente**: Redução de 95% nas operações de disco (salva a cada 20-50 lotes ao invés de constantemente)
- **🚨 Detecção de Bloqueio**: Para automaticamente se detectar bloqueio IP da Steam (Status 403)
- **🗂️ Sistema de Backup**: Rotação automática de arquivos com recuperação em caso de erro
- **🧹 Deduplicação Automática**: Remove duplicatas antes de salvar, evitando dados corrompidos
- **📊 Monitoramento em Tempo Real**: Logs de memória, progresso e ETA

### Scripts de Performance

```bash
# Teste as otimizações primeiro (pequeno lote)
curl "https://sua-api.render.com/api/test-update?limit=10&api_key=SUA_KEY"

# Verificar configurações e status
curl "https://sua-api.render.com/api/steam-stats"
```

### Configurações de Velocidade (Otimizadas para Render Free)

Copie estas configurações para as variáveis de ambiente no Render:

```bash
# RENDER FREE - CONFIGURAÇÃO RECOMENDADA (Máxima Estabilidade)
NODE_ENV=production
TIMEZONE=America/Sao_Paulo

# Fetch Bundles (coleta da lista básica)
FETCH_BUNDLES_CONCURRENT=1      # 1 requisição por vez (seguro)
FETCH_BUNDLES_DELAY=3000        # 3 segundos entre lotes
FETCH_BUNDLES_TIMEOUT=15000     # 15s timeout

# Update Bundles (detalhes das bundles)
STEAM_API_DELAY=2000            # 2 segundos entre bundles
STEAM_APP_DELAY=500             # 500ms entre apps
MAX_APPS_PER_BUNDLE=20          # Máximo 20 apps por bundle
REQUEST_TIMEOUT=15000           # 15s timeout
MAX_RETRIES=3                   # 3 tentativas por erro
PARALLEL_BUNDLES=2              # 2 bundles paralelas
APP_BATCH_SIZE=3                # 3 apps por lote
SKIP_DETAILS_THRESHOLD=50       # Pula bundles com +50 apps

# DESENVOLVIMENTO LOCAL - MAIS RÁPIDO (se tiver boa conexão)
PARALLEL_BUNDLES=5
STEAM_API_DELAY=1000
SKIP_DETAILS_THRESHOLD=80

# CONSERVADOR EXTREMO - SE HOUVER BLOQUEIOS
PARALLEL_BUNDLES=1
STEAM_API_DELAY=5000
FETCH_BUNDLES_DELAY=5000
```

### 📊 Performance Esperada no Render Free

- **🔍 Coleta de bundles básicas:** ~2-3 horas (4840 bundles)
- **🔧 Atualização de detalhes:** ~8-12 horas (processamento completo)
- **🧠 Uso de memória:** 250-350MB (bem dentro do limite de 500MB)
- **💾 Operações de disco:** 10-15 salvamentos (vs 2000+ anteriormente)
- **🚫 Rate limiting:** Muito improvável com essas configurações
- **📈 Taxa de sucesso:** 95%+ bundles processadas com sucesso

## 🚀 Deploy no Render

### 1. **Configuração do repositório:**
   - Certifique-se de que o repositório está no GitHub
   - Faça commit de todas as alterações

### 2. **Configuração no Render:**
   - Conecte seu repositório GitHub
   - **Escolha:** Web Service
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   
### 3. **Variáveis de Ambiente (OBRIGATÓRIAS):**
   Configure estas variáveis exatamente como mostrado:

```properties
NODE_ENV=production
TIMEZONE=America/Sao_Paulo
API_KEY=SUA_CHAVE_SECRETA_AQUI

FETCH_BUNDLES_CONCURRENT=1
FETCH_BUNDLES_DELAY=3000
FETCH_BUNDLES_TIMEOUT=15000

STEAM_API_DELAY=2000
STEAM_APP_DELAY=500
MAX_APPS_PER_BUNDLE=20
REQUEST_TIMEOUT=15000
MAX_RETRIES=3
PARALLEL_BUNDLES=2
APP_BATCH_SIZE=3
SKIP_DETAILS_THRESHOLD=50
```

⚠️ **IMPORTANTE:** 
- **NÃO** defina a variável `PORT` - o Render define automaticamente
- **GERE UMA API_KEY FORTE** para produção: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- **NUNCA compartilhe sua API_KEY** - ela protege seus endpoints administrativos

### 4. **Deploy:**
   - O Render detectará automaticamente o `package.json`
   - Primeira inicialização demora ~10-15 minutos
   - A API ficará disponível no domínio fornecido pelo Render

## 🔒 Segurança

### Autenticação
- Endpoints administrativos protegidos por API Key
- Rate limiting configurado (100 req/15min para endpoints públicos, 5 req/15min para admin)
- CORS configurado para produção

### Endpoints Protegidos
Para acessar endpoints administrativos, inclua sua API key:

**Header (recomendado):**
```
X-API-Key: sua_api_key_aqui
```

**Query parameter:**
```
GET /api/force-update?api_key=sua_api_key_aqui
```

## 📋 Endpoints Disponíveis

### Públicos
- `GET /` - Status da API
- `GET /health` - Health check detalhado
- `GET /api/bundles` - Lista todas as bundles (básico) com informações de upgrade
- `GET /api/bundles-detailed` - 🚀 **PRINCIPAL:** Endpoint inteligente com atualização automática em segundo plano
- `GET /api/bundles-detailed-all` - Todas as bundles detalhadas
- `GET /api/bundles-detailed-legacy` - Comportamento antigo sem inteligência (para debug)
- `GET /api/bundles-smart` - Alias para `/api/bundles-detailed` (compatibilidade)

### Administrativos (Requer API Key)
- `GET /api/force-update` - Força atualização completa (8-12 horas no Render)
- `GET /api/update-details` - Atualiza apenas os detalhes das bundles existentes
- `GET /api/test-update?limit=10` - 🧪 **RECOMENDADO:** Testa com apenas 10 bundles (1-2 min)
- `GET /api/clean-duplicates` - 🧹 Remove duplicatas manualmente

### 🔧 Monitoramento e Debug
- `GET /api/steam-stats` - 📊 **ÚTIL:** Estatísticas, configurações e status da memória
- `GET /health` - Health check detalhado com uso de RAM

### ⚠️ Importante para Render Free
- **Use `/api/test-update?limit=10`** antes de fazer update completo
- **Monitore memória** via `/api/steam-stats`
- **Evite múltiplas atualizações simultâneas** - pode causar timeout

### Parâmetros de Query
- `page`: Número da página (padrão: 1)
- `limit`: Itens por página (padrão: 10, máximo: 100)

## 🛡️ Funcionalidades de Segurança e Estabilidade

### 🔒 Segurança
- **Helmet.js**: Headers de segurança HTTP
- **Rate Limiting**: Proteção contra spam/ataques
- **Input Validation**: Validação de parâmetros de entrada
- **Error Handling**: Tratamento seguro de erros
- **Logging**: Log detalhado de requisições
- **Compression**: Compressão gzip para melhor performance
- **CORS**: Política de origem configurável

### 🛠️ Estabilidade (Render Free)
- **🧠 Monitoramento de Memória**: Para automaticamente se ultrapassar 350MB
- **💾 Backup Automático**: Sistema de rotação `bundles.json` → `bundles-old.json`
- **� Recuperação de Erro**: Restaura backup automaticamente em caso de falha
- **🚨 Detecção de Bloqueio IP**: Para processamento se Steam bloquear (Status 403)
- **�📊 Garbage Collection**: Limpeza automática de memória quando possível
- **⏱️ Timeouts Inteligentes**: 15s timeout para evitar travamentos

### 📊 Monitoramento Avançado

#### Health Check Detalhado (`/health`)
Verifica automaticamente:
- Status do servidor e uptime
- **Uso de memória RAM** (crítico no Render Free)
- Existência de arquivos essenciais (`bundles.json`, `bundleDetailed.json`)
- Timestamp da última atualização

#### Steam Stats (`/api/steam-stats`)
Mostra em tempo real:
- **Configurações atuais** (delays, paralelismo, etc.)
- **Status da memória** (RSS, Heap Used, Heap Total)
- **Métricas dos dados** (quantas bundles, última atualização)
- **Indicadores de saúde** (arquivos existem, idade dos dados)

## 🔧 Desenvolvimento Local

1. **Instalar dependências:**
   ```bash
   npm install
   ```

2. **Configurar ambiente:**
   ```bash
   cp .env.example .env
   # Edite o arquivo .env com suas configurações
   ```

3. **Executar:**
   ```bash
   npm start
   ```

## 🎯 Endpoint Principal: `/api/bundles-detailed`

**Agora é inteligente!** Seu frontend não precisa de mudanças, mas ganha todos os benefícios:

### ✨ Funcionalidades Inteligentes (Transparentes)
- **Resposta imediata:** Sempre retorna dados atuais sem delay
- **Atualização automática:** Se dados > 8h, atualiza em segundo plano
- **Compatibilidade total:** Mesma estrutura JSON do endpoint antigo
- **Indicador de atualização:** Campo `updateTriggered` informa se update foi iniciado
- **Fallback inteligente:** Se não tem dados detalhados, retorna básicos

### 📋 Estrutura de Resposta (Compatível)
```json
{
  "totalBundles": 4903,
  "bundles": [...],
  "page": 1,
  "totalPages": 491,
  "hasNext": true,
  "hasPrev": false,
  "lastUpdate": "2025-07-21T11:23:57-03:00",
  "updateTriggered": false  // ← NOVO: indica se update foi iniciado
}
```

### 🔧 Uso no Frontend (Sem Mudanças!)
```javascript
// Seu código atual continua funcionando exatamente igual
const response = await fetch('/api/bundles-detailed?page=1&limit=20');
const data = await response.json();

// Novo: opcionalmente você pode mostrar status de atualização
if (data.updateTriggered) {
  console.log('Dados sendo atualizados em segundo plano...');
}
```

### 🧹 Sistema de Limpeza Automática

- **Detecção de duplicatas:** Verifica automaticamente após cada atualização
- **Limpeza automática:** Remove duplicatas nas bundles básicas e detalhadas
- **Endpoint manual:** `/api/clean-duplicates` para limpeza forçada
- **Logs detalhados:** Mostra quantas duplicatas foram removidas

### 📊 Monitoramento Avançado

- **Status dos dados:** Idade, quantidade, necessidade de atualização
- **Detecção de descompasso:** Verifica diferenças entre dados básicos e detalhados
- **Métricas de duplicatas:** Quantas duplicatas foram detectadas/removidas

### Configurações Avançadas (Opcional)

Para ajustar performance vs segurança, modifique estas variáveis:

```bash
# MAIS RÁPIDO (risco moderado de bloqueio)
STEAM_API_DELAY=1000          # 1s entre bundles
PARALLEL_BUNDLES=3            # 3 bundles paralelas
SKIP_DETAILS_THRESHOLD=30     # Pula bundles com +30 apps

# MAIS CONSERVADOR (máxima segurança)
STEAM_API_DELAY=5000          # 5s entre bundles  
PARALLEL_BUNDLES=1            # 1 bundle por vez
SKIP_DETAILS_THRESHOLD=20     # Pula bundles com +20 apps
FETCH_BUNDLES_DELAY=5000      # 5s entre lotes de fetch

# DESENVOLVIMENTO LOCAL (conexão boa)
STEAM_API_DELAY=300           # 300ms entre bundles
PARALLEL_BUNDLES=10           # 10 bundles paralelas
SKIP_DETAILS_THRESHOLD=100    # Processa bundles maiores
```

### 📊 Métricas e Logs

**Logs importantes a observar:**
- `💾 🔄 Salvamento parcial: X bundles (Y MB)` - Salvamento por memória
- `🚨 Memória alta (X MB) - forçando salvamento` - Proteção de memória ativada
- `🚨 BLOQUEIO DETECTADO! IP foi bloqueado` - Steam bloqueou, aguarde 1h
- `📊 Memória: X MB | Detalhadas: Y | Lotes: Z` - Status normal

**Indicadores de saúde:**
- Memória < 350MB = ✅ OK
- Memória > 400MB = ⚠️ Atenção  
- Memória > 450MB = 🚨 Crítico (vai salvar e limpar)

## 🧪 Modo Teste (Recomendado)

### Para Render Free - SEMPRE teste primeiro!

```bash
# Teste pequeno (1-2 minutos)
GET /api/test-update?limit=5&api_key=SUA_KEY

# Teste médio (5-10 minutos)  
GET /api/test-update?limit=20&api_key=SUA_KEY

# Só faça update completo após testar!
GET /api/force-update?api_key=SUA_KEY
```

### 🔍 Verificação de Status

```bash
# Verificar configurações e memória
GET /api/steam-stats

# Verificar saúde geral
GET /health

# Ver dados atuais
GET /api/bundles-detailed?limit=5
```

## 📈 Performance e Limitações

### 🎯 Performance Esperada (Render Free)
- **Teste (10 bundles):** 1-2 minutos
- **Teste médio (50 bundles):** 5-10 minutos  
- **Update completo (4840 bundles):** 8-12 horas
- **Taxa de sucesso:** 90-95% (algumas bundles são removidas pela Steam)
- **Uso de memória:** 250-350MB pico (limite: 500MB)

### ⚠️ Limitações do Render Free
- **Timeout:** 15 minutos por requisição web (por isso update roda em background)
- **Sleep:** Serviço dorme após 15min sem uso (normal)
- **Cold start:** Primeira requisição após sleep demora ~30s
- **Memória:** 500MB máximo (nossa configuração usa 350MB máximo)

### 🚨 Troubleshooting

**Se der erro 403 (IP bloqueado):**
```bash
# Aguarde 30-60 minutos e teste novamente
# Ou use configurações ainda mais conservadoras:
STEAM_API_DELAY=5000
PARALLEL_BUNDLES=1
```

**Se der timeout no Render:**
```bash
# Use sempre teste primeiro para verificar se está funcionando
GET /api/test-update?limit=5&api_key=SUA_KEY
```

**Se consumir muita memória:**
```bash
# Monitore via steam-stats
GET /api/steam-stats

# Reduza o paralelismo se necessário
PARALLEL_BUNDLES=1
```

```
├── middleware/
│   ├── auth.js          # Autenticação e rate limiting
│   ├── security.js      # Middlewares de segurança
│   └── monitoring.js    # Health check e monitoramento
├── services/
│   ├── fetchBundles.js  # Busca de bundles
│   └── updateBundles.js # Atualização de detalhes
├── routes.js            # Definição de rotas
├── server.js            # Servidor principal
└── package.json         # Dependências e scripts
```

## 🚨 Importante para Produção (Render)

1. **🔑 SEMPRE defina uma API_KEY forte** para proteger endpoints administrativos
2. **🧪 TESTE PRIMEIRO** com `/api/test-update?limit=5` antes de fazer update completo
3. **📊 MONITORE MEMÓRIA** via `/api/steam-stats` regularmente
4. **⏱️ SEJA PACIENTE** - update completo demora 8-12h no Render Free (é normal!)
5. **🚫 EVITE UPDATES MÚLTIPLOS** - um por vez para não estourar memória
6. **🔧 CONFIGURE CORS** adequadamente para seus domínios
7. **📈 USE HTTPS** em produção (Render fornece automaticamente)
8. **🔄 MANTENHA DEPENDÊNCIAS ATUALIZADAS** para patches de segurança

### 🎯 Fluxo Recomendado para Render Free

1. **Deploy inicial** com todas as variáveis de ambiente
2. **Teste conectividade:** `GET /health`
3. **Teste pequeno:** `GET /api/test-update?limit=5&api_key=SUA_KEY`
4. **Monitore:** `GET /api/steam-stats`
5. **Se tudo OK, execute completo:** `GET /api/force-update?api_key=SUA_KEY`
6. **Configure agendamento** para atualizar a cada 24-48h