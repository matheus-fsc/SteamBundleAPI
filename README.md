# SteamBundleAPI

Uma API segura e robusta para buscar e gerenciar bundles da Steam Store.

## 🚀 Deploy no Render

1. **Configuração do repositório:**
   - Certifique-se de que o repositório está no GitHub
   - Faça commit de todas as alterações

2. **Configuração no Render:**
   - Conecte seu repositório GitHub
   - Configure as seguintes variáveis de ambiente:
     - `NODE_ENV`: `production`
     - `TIMEZONE`: `America/Sao_Paulo`
     - `PORT`: `3000` (ou deixe o Render definir automaticamente)
     - `API_KEY`: [Gere uma chave segura usando: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`]

3. **Deploy:**
   - O Render detectará automaticamente o comando `start` no `package.json`
   - Após o deploy, a API estará disponível no domínio fornecido pelo Render

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
- `GET /api/bundles` - Lista todas as bundles (básico)
- `GET /api/bundles-detailed` - Lista bundles com detalhes (paginado)
- `GET /api/bundles-detailed-all` - Todas as bundles detalhadas

### Administrativos (Requer API Key)
- `GET /api/force-update` - Força atualização completa
- `GET /api/update-details` - Atualiza apenas os detalhes
- `GET /api/test-update?limit=50` - 🧪 **NOVO:** Atualiza apenas X bundles para teste (max: 200)

### Monitoramento
- `GET /api/steam-stats` - 📊 **NOVO:** Estatísticas da API Steam e configurações

### Parâmetros de Query
- `page`: Número da página (padrão: 1)
- `limit`: Itens por página (padrão: 10, máximo: 100)

## 🛡️ Funcionalidades de Segurança

- **Helmet.js**: Headers de segurança HTTP
- **Rate Limiting**: Proteção contra spam/ataques
- **Input Validation**: Validação de parâmetros de entrada
- **Error Handling**: Tratamento seguro de erros
- **Logging**: Log detalhado de requisições
- **Compression**: Compressão gzip para melhor performance
- **CORS**: Política de origem configurável

## 📊 Monitoramento

### Health Check
Acesse `/health` para verificar:
- Status do servidor
- Uso de memória e CPU
- Existência de arquivos essenciais
- Tempo de funcionamento

### Logs
- Todas as requisições são logadas com timestamp, IP e duração
- Endpoints administrativos têm logs especiais
- Erros são logados com stack trace (apenas em desenvolvimento)

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

## ⚡ Otimizações da API Steam

### Configurações Avançadas
Para acelerar o processamento, configure estas variáveis de ambiente:

```bash
# Delay entre bundles (ms) - quanto menor, mais rápido, mas mais risco de rate limit
STEAM_API_DELAY=1500          # Padrão: 1500ms (seguro)

# Delay entre apps (ms) - para buscar detalhes dos jogos
STEAM_APP_DELAY=100           # Padrão: 100ms

# Máximo de apps por bundle - evita bundles gigantes que demoram muito
MAX_APPS_PER_BUNDLE=50        # Padrão: 50 apps

# Timeout das requisições
REQUEST_TIMEOUT=10000         # Padrão: 10s

# Tentativas em caso de erro
MAX_RETRIES=3                 # Padrão: 3 tentativas
```

### 🧪 Modo Teste
Para testar sem processar todas as 9000+ bundles:

```bash
# Testa com apenas 50 bundles
GET /api/test-update?limit=50

# Testa com 100 bundles
GET /api/test-update?limit=100
```

### � Performance Esperada
- **Modo desenvolvimento:** ~40-60 bundles/minuto
- **Modo produção:** ~25-35 bundles/minuto (mais seguro)
- **Teste (50 bundles):** ~2-3 minutos
- **Processamento completo:** ~4-6 horas

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

## 🚨 Importante para Produção

1. **Sempre defina uma API_KEY forte** para proteger endpoints administrativos
2. **Configure CORS** adequadamente para seus domínios
3. **Monitore logs** regularmente para detectar atividades suspeitas
4. **Use HTTPS** em produção (Render fornece automaticamente)
5. **Mantenha dependências atualizadas** para patches de segurança