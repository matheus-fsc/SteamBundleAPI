# ⏰ Estratégia de Wake-Up para Steam Bundle API

## 🎯 **Objetivo**
Manter a API ativa durante períodos de atualização para evitar cold start do Render Free.

## 📅 **Cronograma de Atualizações**
```
Segunda-feira: 06:00 - 18:00 (12h ativas)
Terça-feira: 06:00 - 18:00 (12h ativas)  
Quarta-feira: 06:00 - 18:00 (12h ativas)
Quinta-feira: 06:00 - 16:00 (10h ativas)
Sexta-Domingo: Standby (inativo)
```

## 🔧 **Implementações**

### 1. **GitHub Actions Wake-Up (Recomendado)**

```yaml
# .github/workflows/wake-up.yml
name: Wake Up API
on:
  schedule:
    # Segunda a Quinta: A cada 10 minutos das 06:00 às 18:00 (UTC-3 = UTC+3)
    - cron: '*/10 9-21 * * 1-4'  # 06:00-18:00 BRT
    
jobs:
  wake-up:
    runs-on: ubuntu-latest
    steps:
      - name: Wake up API
        run: |
          curl -s "https://sua-api.render.com/api/health" || true
          echo "Wake-up ping sent"
```

### 2. **UptimeRobot Monitor**
```
URL: https://sua-api.render.com/api/health
Interval: 5 minutos
Schedule: Segunda-Quinta 06:00-18:00 BRT
```

### 3. **Cron Interno (Backup)**

```javascript
// services/wakePing.js
const cron = require('node-cron');
const axios = require('axios');

// Wake-up interno durante horários de atualização
// Segunda a Quinta: 06:00 às 18:00 BRT
cron.schedule('*/15 6-18 * * 1-4', async () => {
    try {
        const response = await axios.get('https://sua-api.render.com/api/health');
        console.log('🔔 Internal wake-up successful');
    } catch (error) {
        console.log('⚠️ Internal wake-up failed:', error.message);
    }
}, {
    scheduled: true,
    timezone: "America/Sao_Paulo"
});
```

## ⚡ **Configuração Otimizada**

### Wake-Up Schedule
```
🕕 06:00 BRT: GitHub Actions inicia pings
🕘 09:00 BRT: Primeira atualização manual
🕐 13:00 BRT: Verificação de progresso
🕔 17:00 BRT: Finalização/pausa
🕕 18:00 BRT: GitHub Actions para pings
```

### Endpoints para Wake-Up
```
GET /api/health          # Health check básico
GET /api/update/status   # Status da atualização
GET /api/bundles?limit=1 # Teste rápido da API
```

## 📊 **Economia de Horas**

### Sem Wake-Up
```
Cold start: ~30-60s por requisição
Downtime: ~14h entre atualizações
Perda de performance: Alto
```

### Com Wake-Up
```
Response time: <200ms constante
Uptime: 99% durante horário ativo
Cold starts: Eliminados
```

## 🎯 **Implementação Prática**

1. **Configurar GitHub Actions** (5 min)
2. **Adicionar endpoint /api/health** (já existe)
3. **Configurar UptimeRobot** como backup (10 min)
4. **Testar durante próxima atualização**

## 💡 **Benefícios**

✅ **Zero cold starts** durante atualizações
✅ **Response time constante** (~200ms)
✅ **Confiabilidade alta** (99% uptime)
✅ **Gratuito** (GitHub Actions + UptimeRobot free)
✅ **Automatizado** (sem intervenção manual)

## ⚠️ **Considerações**

- Wake-up apenas durante horários de trabalho
- Evita consumo desnecessário de horas Render
- Múltiplas camadas de redundância
- Monitoramento de saúde da API
