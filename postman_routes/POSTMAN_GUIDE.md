# 📮 Steam Bundle API - Postman Collection

Esta collection contém **todos os endpoints** da Steam Bundle API organizados por categoria.

## 🚀 Como Usar

### 1. **Importar a Collection**
```bash
# Importe estes arquivos no Postman:
- Steam_Bundle_API.postman_collection.json
- Steam_Bundle_API.postman_environment.json
```

### 2. **Configurar Environment**
```bash
# Configure as variáveis no environment:
base_url = https://steambundleapi.onrender.com  # Produção
api_key = sua-api-key-aqui                      # Para endpoints admin
```

### 3. **Testar Endpoints**
```bash
# Ordem recomendada para teste:
1. Health Check          # Verificar se API está online
2. API Status           # Ver status dos dados
3. Steam Stats          # Estatísticas detalhadas
4. Get Filter Options   # Ver filtros disponíveis
5. Get Detailed Bundles # Dados principais
```

---

## 📁 Estrutura da Collection

### 🔍 **Health & Status**
| Endpoint | Descrição | Auth |
|----------|-----------|------|
| `/health` | Health check básico | ❌ |
| `/` | Status da API e endpoints | ❌ |
| `/api/steam-stats` | Estatísticas e métricas | ❌ |

### 📦 **Bundles Data** 
| Endpoint | Descrição | Auth | Parâmetros |
|----------|-----------|------|------------|
| `/api/bundles` | Bundles básicos | ❌ | - |
| `/api/bundles-detailed` | Bundles com detalhes | ❌ | `page`, `limit` |
| `/api/bundles-detailed-all` | Todos os bundles | ❌ | - |
| `/api/filter-options` | Opções de filtro | ❌ | - |

### 🔧 **Admin Operations**
| Endpoint | Descrição | Auth | Duração |
|----------|-----------|------|---------|
| `/api/force-update` | Atualização completa | ✅ | 5-15 min |
| `/api/update-details` | Só detalhes | ✅ | 3-8 min |
| `/api/test-update` | Teste limitado | ✅ | 1-3 min |
| `/api/clean-duplicates` | Limpeza | ✅ | < 1 min |

---

## 🔐 Autenticação

### **Endpoints Públicos**
- Não precisam de autenticação
- Rate limit: 100 req/min por IP

### **Endpoints Admin** 
- Requerem header: `X-API-Key: sua-api-key`
- Rate limit: 10 req/min por API key

```javascript
// Header obrigatório para endpoints admin:
X-API-Key: sua-api-key-aqui
```

---

## 📊 Tests Automáticos

Cada request inclui tests automáticos que verificam:

### ✅ **Tests Básicos**
```javascript
// Todos os endpoints:
- Status code 200
- Response JSON válido
- Propriedades obrigatórias presentes
```

### 📈 **Tests Avançados**
```javascript
// Endpoints de dados:
- Estrutura de paginação
- Headers informativos
- Validação de tipos

// Endpoints admin:
- Tracking de duração
- Logs de progresso
- Verificação de resultados
```

---

## 🎯 Casos de Uso

### **🔍 Monitoramento**
```bash
1. Health Check     # Verificar se está online
2. Steam Stats      # Ver métricas de performance
3. API Status       # Checar idade dos dados
```

### **📱 Desenvolvimento Frontend**
```bash
1. Filter Options   # Carregar filtros
2. Bundles Detailed # Dados paginados
3. Steam Stats      # Informações de cache
```

### **⚙️ Manutenção Admin**
```bash
1. Steam Stats      # Avaliar necessidade de update
2. Test Update      # Testar com poucos bundles
3. Force Update     # Atualização completa
4. Clean Duplicates # Otimizar dados
```

---

## 🚨 Operações Importantes

### **Force Update** 
- ⏰ **Duração**: 5-15 minutos
- 🔄 **Processo**: Coleta completa + detalhes
- 💡 **Uso**: Quando dados estão muito antigos

### **Update Details**
- ⏰ **Duração**: 3-8 minutos  
- 🔄 **Processo**: Só atualiza preços/detalhes
- 💡 **Uso**: Dados básicos OK, só faltam detalhes

### **Test Update**
- ⏰ **Duração**: 1-3 minutos
- 🔄 **Processo**: Máximo 200 bundles
- 💡 **Uso**: Testar configurações

---

## 📝 Logs e Debugging

### **Console Logs**
```javascript
// Pre-request logs:
🚀 Executando: GET /api/bundles-detailed

// Response logs:
✅ Resposta: 200 em 150ms
📊 Tipo de dados: detailed
📋 Total de itens: 1250
💾 Cache: hit
```

### **Headers Informativos**
```bash
X-Data-Type: detailed          # Tipo de dados retornados
X-Total-Count: 1250           # Total de itens
X-Cache-Status: cached        # Status do cache
X-Data-Age-Hours: 12          # Idade dos dados em horas
X-Background-Update: triggered # Se update foi disparado
```

---

## 🔧 Troubleshooting

### **❌ 401 Unauthorized**
```bash
Problema: API key inválida ou ausente
Solução: Verificar header X-API-Key
```

### **❌ 429 Rate Limited**
```bash
Problema: Muitas requisições
Solução: Aguardar ou usar API key admin
```

### **❌ 500 Server Error**
```bash
Problema: Dados não encontrados ou corrompidos
Solução: Executar force-update
```

### **⏳ Timeout em Admin Operations**
```bash
Problema: Operação muito demorada
Solução: Aumentar timeout no Postman para 15 min
```

---

## 🎨 Customização

### **Ambientes Diferentes**
```javascript
// Produção:
base_url = "https://steambundleapi.onrender.com"

// Local:  
base_url = "http://localhost:3000"

// Staging:
base_url = "https://staging-steambundleapi.onrender.com"
```

### **Timeouts Personalizados**
```javascript
// Para operações admin longas:
pm.request.timeout = 900000; // 15 minutos
```

### **Headers Extras**
```javascript
// Para debugging:
X-Debug-Mode: true
X-Request-ID: unique-id-here
```

---

## 📚 Links Úteis

- **API Docs**: Ver código em `/routes.js`
- **Status Page**: `{{base_url}}/`
- **Health Check**: `{{base_url}}/health` 
- **Stats**: `{{base_url}}/api/steam-stats`

---

> 💡 **Dica**: Execute sempre "Steam Stats" primeiro para entender o estado atual dos dados antes de fazer operações admin.
