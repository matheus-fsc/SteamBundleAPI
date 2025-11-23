# 🚀 Guia de Auto-Deploy no Orange Pi

Este guia explica como configurar deploy automático quando você faz push no GitHub.

## 📋 Escolha uma Opção

### **Opção 1: GitHub Webhook (Recomendado)**
✅ Deploy instantâneo após push  
✅ Mais eficiente  
⚠️ Precisa expor porta 9000 na internet (ou usar cloudflare tunnel)

### **Opção 2: Polling (Mais Simples)**
✅ Não precisa expor porta  
✅ Mais simples de configurar  
⚠️ Delay de até 5 minutos

---

## 🎣 Opção 1: Webhook (Instantâneo)

### 1. No Orange Pi:

```bash
# 1. Configure o secret (MUDE ESTE VALOR!)
export GITHUB_WEBHOOK_SECRET="algum_segredo_aleatorio_forte"

# 2. Adicione ao .env do projeto
echo "GITHUB_WEBHOOK_SECRET=$GITHUB_WEBHOOK_SECRET" >> /root/SteamBundleAPI/.env

# 3. Instale o service
sudo cp /root/SteamBundleAPI/scripts/webhook-listener.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable webhook-listener
sudo systemctl start webhook-listener

# 4. Verifique status
sudo systemctl status webhook-listener
sudo journalctl -u webhook-listener -f
```

### 2. Configure Cloudflare Tunnel (para expor a porta):

```bash
# Se ainda não tem cloudflared configurado
docker run -d \
  --name cloudflared-webhook \
  --restart unless-stopped \
  cloudflare/cloudflared:latest \
  tunnel --no-autoupdate run \
  --url http://localhost:9000 \
  --token SEU_TOKEN_AQUI
```

Ou adicione ao seu tunnel existente:
```yaml
# config.yml do cloudflared
ingress:
  - hostname: webhook.seudominio.com
    service: http://localhost:9000
  # ... outras rotas
```

### 3. No GitHub:

1. Vá em: `https://github.com/matheus-fsc/SteamBundleAPI/settings/hooks`
2. Clique em **"Add webhook"**
3. Configure:
   - **Payload URL**: `https://webhook.seudominio.com/webhook`
   - **Content type**: `application/json`
   - **Secret**: Cole o mesmo valor de `GITHUB_WEBHOOK_SECRET`
   - **Which events**: `Just the push event`
   - **Active**: ✅ Marque
4. Clique em **"Add webhook"**

### 4. Teste:

```bash
# Faça um push no GitHub
git commit --allow-empty -m "test: webhook deploy"
git push

# No Orange Pi, veja os logs
sudo journalctl -u webhook-listener -f
```

---

## ⏰ Opção 2: Polling (Simples)

### 1. No Orange Pi:

```bash
# 1. Torne o script executável
chmod +x /root/SteamBundleAPI/scripts/auto_deploy_poll.sh

# 2. Teste manualmente
/root/SteamBundleAPI/scripts/auto_deploy_poll.sh

# 3. Instale no crontab (como root)
sudo crontab -e

# 4. Adicione esta linha:
*/5 * * * * /root/SteamBundleAPI/scripts/auto_deploy_poll.sh >> /var/log/auto-deploy.log 2>&1
```

### 2. Verifique logs:

```bash
# Ver log de auto-deploy
tail -f /var/log/auto-deploy.log

# Forçar execução manual
/root/SteamBundleAPI/scripts/auto_deploy_poll.sh
```

---

## 🧪 Testando o Auto-Deploy

### No seu PC:

```bash
# 1. Faça uma mudança qualquer
echo "# Test auto-deploy" >> README.md

# 2. Commit e push
git add .
git commit -m "test: auto-deploy"
git push origin main
```

### No Orange Pi:

```bash
# Webhook: Veja logs em tempo real
sudo journalctl -u webhook-listener -f

# Polling: Aguarde até 5 minutos ou force
/root/SteamBundleAPI/scripts/auto_deploy_poll.sh

# Verifique se atualizou
cd /root/SteamBundleAPI
git log -1
docker compose ps scraper
```

---

## 🔧 Troubleshooting

### Webhook não está funcionando:

```bash
# Verifique se o service está rodando
sudo systemctl status webhook-listener

# Veja logs de erro
sudo journalctl -u webhook-listener -n 50

# Teste manualmente
curl -X POST http://localhost:9000/health
# Deve retornar: OK

# Verifique se porta está aberta
sudo netstat -tlnp | grep 9000
```

### Polling não está atualizando:

```bash
# Verifique se cron está rodando
sudo systemctl status cron

# Veja crontab instalado
sudo crontab -l

# Teste manualmente
/root/SteamBundleAPI/scripts/auto_deploy_poll.sh

# Veja logs
tail -50 /var/log/auto-deploy.log
```

---

## 🎯 Fluxo Completo com Auto-Deploy

```
┌─────────────┐
│  Seu PC     │
│             │
│  1. Code    │
│  2. Commit  │
│  3. Push    │
└──────┬──────┘
       │
       v
┌─────────────┐
│  GitHub     │
│  (main)     │
└──────┬──────┘
       │
       │ (webhook ou polling detecta)
       │
       v
┌─────────────┐
│  Orange Pi  │
│             │
│  1. git pull│
│  2. restart │
│  3. running!│
└─────────────┘
```

## 💡 Dica: Proteção de Branch

Configure branch protection no GitHub:
1. Settings > Branches > Add rule
2. Branch name: `main`
3. ✅ Require pull request reviews before merging
4. ✅ Require status checks to pass

Assim você testa em outra branch e só faz merge quando estiver OK!

