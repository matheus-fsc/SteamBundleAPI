# 🎮 Steam Bundle API V6.2

> **Sistema inteligente de coleta e análise de bundles da Steam com otimização específica para Render Free**

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.21+-blue.svg)](https://expressjs.com/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Render](https://img.shields.io/badge/Deploy-Render%20Free-purple.svg)](https://render.com/)

## 🚀 **Características Principais**

### ⚡ **Sistema Adaptativo Inteligente**
- **Circuit Breaker Triplo**: Proteção contra falhas em cascata
- **Performance Adaptativa**: Otimização automática baseada em resultados
- **Auto-Resume**: Continuação automática após interrupções
- **NSFW Detection**: Categorização automática de conteúdo adulto
- **Retry Queue**: Sistema inteligente de reprocessamento

### 🛡️ **Proteção Anti-Bloqueio**
- **Rate Limiting Inteligente**: Delays adaptativos (500-8000ms)
- **Paralelismo Controlado**: 1-6 requisições simultâneas (otimizado para 0.1 core)
- **Circuit Breakers**: 3 camadas de proteção contra sobrecarga
- **Age Verification**: Bypass automático de verificação de idade
- **User-Agent Rotation**: Headers humanizados para evitar detecção

### 💾 **Otimizado para Render Free**
- **Baixo Consumo**: 200-300MB RAM (limite 500MB)
- **CPU Eficiente**: Configurações específicas para 0.1 core
- **Log Rotation**: Prevenção de crescimento infinito de logs
- **I/O Otimizado**: Salvamento em lotes para economizar recursos
- **Memory Management**: Verificação automática de uso de memória

## 📊 **Performance Esperada**

### 🎯 **Render Free (0.1 core + 500MB RAM)**
- **🔍 Coleta de bundles básicas**: ~5-10 minutos (4900+ bundles)
- **🔧 Atualização completa**: ~40-80 horas (com sistema conservador)
- **🧪 Teste pequeno (100 bundles)**: ~10-15 minutos
- **🧠 Uso de memória**: 200-350MB (bem dentro do limite)
- **💾 Auto-resume**: Continua automaticamente se reiniciar
- **🛡️ Proteção contra bloqueio**: 3 níveis de circuit breaker
- **📈 Taxa de sucesso**: 90-95% dos bundles processados
- **🔄 Recovery automático**: Retry inteligente para falhas elegíveis

### ⚙️ **Configurações Adaptativas**
```javascript
// Sistema V6.2 - Render Free Optimized
Delays: 500ms - 8000ms (adaptativo)
Paralelismo: 1-4 simultâneas (conservador)
Circuit Breakers: 3 camadas de proteção
Memory Checks: A cada 5 lotes
Save Interval: A cada 25 lotes (economiza I/O)
```

## 🗂️ **Estrutura do Projeto**

```
SteamBundleAPI/
├── 📁 services/
│   ├── updateBundles.js      # 🧠 Core do sistema adaptativo
│   ├── fetchBundles.js       # 🔍 Coleta básica de bundles
│   ├── keepAlive.js          # 💓 Manutenção de conexão
│   └── updateController.js   # 🎮 Controlador principal
├── 📁 middleware/
│   ├── auth.js              # 🔐 Sistema de autenticação
│   ├── security.js          # 🛡️ Proteções de segurança
│   ├── monitoring.js        # 📊 Monitoramento de performance
│   ├── updateControl.js     # ⏸️ Controle de atualizações
│   └── dataValidation.js    # ✅ Validação de dados
├── 📁 postman_routes/       # 📮 Coleções Postman organizadas
├── server.js                # 🚀 Servidor Express principal
├── routes.js                # 🛤️ Definição de rotas da API
└── 📊 Arquivos de dados
    ├── bundles.json         # 📋 Lista básica de bundles
    ├── bundleDetailed.json  # 📖 Detalhes completos dos bundles
    ├── updateState.json     # 💾 Estado de processamento
    └── logs/                # 📝 Logs do sistema
```

## 🚀 **Instalação e Configuração**

### 1. **Clone o Repositório**
```bash
git clone https://github.com/matheus-fsc/SteamBundleAPI.git
cd SteamBundleAPI
```

### 2. **Instale as Dependências**
```bash
npm install
```

### 3. **Configure as Variáveis de Ambiente**
```bash
cp .env.example .env
```

Edite o arquivo `.env`:
```env
# Configurações da API Steam
STEAM_API_DELAY=500
REQUEST_TIMEOUT=20000
MAX_RETRIES=3

# Configurações do Servidor
PORT=3000
NODE_ENV=production

# Configurações de Segurança
API_SECRET=seu_secret_aqui
ALLOWED_ORIGINS=https://seu-dominio.com

# Configurações Render Free (Opcional)
RENDER_FREE_MODE=true
MAX_MEMORY_MB=400
SAVE_INTERVAL_BATCHES=25
```

### 4. **Inicie o Servidor**
```bash
npm start
```

## 📖 **Uso da API**

### 🔍 **Endpoints Principais**

#### **GET** `/api/bundles` - Lista de Bundles
```bash
curl "https://sua-api.render.com/api/bundles?limit=50&offset=0"
```

#### **GET** `/api/bundles/detailed` - Bundles Detalhados
```bash
curl "https://sua-api.render.com/api/bundles/detailed?genre=Action"
```

#### **POST** `/api/update/start` - Iniciar Atualização
```bash
curl -X POST "https://sua-api.render.com/api/update/start" \
  -H "Authorization: Bearer seu_token" \
  -H "Content-Type: application/json" \
  -d '{"language": "brazilian", "testLimit": 100}'
```

#### **GET** `/api/update/status` - Status da Atualização
```bash
curl "https://sua-api.render.com/api/update/status"
```

#### **POST** `/api/update/pause` - Pausar Atualização
```bash
curl -X POST "https://sua-api.render.com/api/update/pause" \
  -H "Authorization: Bearer seu_token"
```

### 🔧 **Parâmetros de Consulta**

| Parâmetro | Tipo | Descrição | Exemplo |
|-----------|------|-----------|---------|
| `limit` | number | Limite de resultados (1-500) | `?limit=100` |
| `offset` | number | Offset para paginação | `?offset=50` |
| `genre` | string | Filtrar por gênero | `?genre=Action` |
| `developer` | string | Filtrar por desenvolvedor | `?developer=Valve` |
| `priceRange` | string | Faixa de preço | `?priceRange=0-50` |
| `language` | string | Idioma dos dados | `?language=english` |

## 🛠️ **Sistema de Monitoramento**

### 📊 **Logs Disponíveis**
- `services/scraping_debug.log` - Log detalhado de scraping
- `services/adaptive_performance.log` - Performance do sistema adaptativo
- `services/failed_bundles_queue.json` - Queue de bundles com falha

### 🔍 **Monitoramento em Tempo Real**
```bash
# Acompanhar status da atualização
curl "https://sua-api.render.com/api/update/status" | jq

# Verificar performance adaptativa
curl "https://sua-api.render.com/api/monitor/performance" | jq

# Estatísticas do sistema
curl "https://sua-api.render.com/api/monitor/stats" | jq
```

## ⚡ **Otimizações para Render Free**

### 🎯 **Configurações Recomendadas**
```javascript
// Render Free (0.1 core + 500MB RAM)
STEAM_API_DELAY=500
PARALLEL_BUNDLES=3
MAX_MEMORY_USAGE_MB=400
SAVE_INTERVAL_BATCHES=25
MEMORY_CHECK_INTERVAL_BATCHES=5
```

### 📈 **Estratégias de Performance**
1. **Paralelismo Controlado**: Máximo 4 requisições simultâneas
2. **Delays Adaptativos**: 500-8000ms baseado na performance
3. **Memory Management**: Verificação a cada 5 lotes
4. **I/O Otimizado**: Salvamento menos frequente
5. **Log Rotation**: Prevenção de crescimento infinito

### 🔄 **Auto-Resume Inteligente**
- Salva estado a cada 25 bundles processados
- Detecta interrupções automáticamente
- Continua do ponto exato onde parou
- Mantém queue de falhas entre sessões
- Recovery automático de configurações

## 🛡️ **Sistema de Proteção**

### 🚨 **Circuit Breakers**
1. **Traditional Circuit Breaker**: 5 falhas consecutivas → pausa 30s
2. **Adaptive Circuit Breaker**: 20% queda de performance → reconfiguração
3. **MAX_RETRIES Circuit Breaker**: 3+ MAX_RETRIES → pausa emergencial

### 🔄 **Retry System**
- **Tipos Elegíveis**: MAX_RETRIES_REACHED, TIMEOUT_ERROR, NETWORK_ERROR
- **Configuração**: 2 tentativas máximas, delays de 3s
- **Processamento**: Sequencial e conservador
- **Persistência**: Queue salva automaticamente

### � **NSFW Detection**
- **Detecção Automática**: Via redirecionamento para login
- **Categorização**: "NSFW/Adult Content" automaticamente
- **Logs**: Registro detalhado para auditoria
- **Bypass**: Não requer intervenção manual

## 📚 **Exemplos de Uso**

### 🧪 **Teste Rápido (100 bundles)**
```bash
curl -X POST "https://sua-api.render.com/api/update/start" \
  -H "Authorization: Bearer seu_token" \
  -H "Content-Type: application/json" \
  -d '{"testLimit": 100, "language": "brazilian"}'
```

### 🔄 **Atualização Completa com Resume**
```bash
# Iniciar atualização completa
curl -X POST "https://sua-api.render.com/api/update/start" \
  -H "Authorization: Bearer seu_token"

# Verificar progresso
curl "https://sua-api.render.com/api/update/status"

# Se interrompido, resume automaticamente no próximo start
```

### 📊 **Consulta com Filtros**
```bash
# Bundles de ação com preço específico
curl "https://sua-api.render.com/api/bundles/detailed?genre=Action&priceRange=10-30&limit=20"

# Bundles por desenvolvedor
curl "https://sua-api.render.com/api/bundles/detailed?developer=Valve&offset=0&limit=50"
```

## 🔧 **Troubleshooting**

### ❌ **Problemas Comuns**

#### **Alta Taxa de Falhas**
```bash
# Verificar configuração adaptativa
curl "https://sua-api.render.com/api/monitor/adaptive-config"

# Forçar configuração conservadora
curl -X POST "https://sua-api.render.com/api/update/force-conservative"
```

#### **Memória Insuficiente**
```bash
# Verificar uso atual
curl "https://sua-api.render.com/api/monitor/memory"

# Ajustar configurações
# Reduzir PARALLEL_BUNDLES e aumentar SAVE_INTERVAL_BATCHES
```

#### **Performance Baixa**
```bash
# Analisar logs adaptativos
tail -f services/adaptive_performance.log

# Verificar circuit breakers ativos
curl "https://sua-api.render.com/api/monitor/circuit-breakers"
```

### 🔍 **Logs Importantes**
```bash
# Performance adaptativa
tail -f services/adaptive_performance.log

# Detalhes de scraping
tail -f services/scraping_debug.log

# Queue de falhas
cat services/failed_bundles_queue.json | jq
```

## 🤝 **Contribuição**

### 📝 **Como Contribuir**
1. Fork o projeto
2. Crie uma branch para sua feature (`git checkout -b feature/nova-feature`)
3. Commit suas mudanças (`git commit -am 'Adiciona nova feature'`)
4. Push para a branch (`git push origin feature/nova-feature`)
5. Abra um Pull Request

### 🐛 **Reportar Bugs**
- Use as [Issues do GitHub](https://github.com/matheus-fsc/SteamBundleAPI/issues)
- Inclua logs relevantes
- Descreva o comportamento esperado vs atual
- Forneça informações do ambiente (Render Free, local, etc.)

## 📜 **Licença**

Este projeto está licenciado sob a MIT License - veja o arquivo [LICENSE](LICENSE) para detalhes.

## � **Agradecimentos**

- **Steam**: Pela API pública de bundles
- **Render**: Pela plataforma de deploy gratuita
- **Comunidade Node.js**: Pelas bibliotecas utilizadas
- **Contributors**: Todos que ajudaram a melhorar o projeto

---

## 📞 **Suporte**

- **GitHub Issues**: [Reportar problemas](https://github.com/matheus-fsc/SteamBundleAPI/issues)
- **Documentação**: Este README + comentários no código
- **Logs**: Sistema de logging detalhado para debugging

**Desenvolvido com ❤️ para a comunidade Steam**