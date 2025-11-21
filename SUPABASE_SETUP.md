# 🔑 Como Obter a Service Key do Supabase

## Passo a Passo

1. **Acesse seu projeto Supabase:**
   - Vá para: https://hjespkvqdpalpsbcdzgq.supabase.co
   - Ou dashboard: https://supabase.com/dashboard/project/hjespkvqdpalpsbcdzgq

2. **Navegue até Settings:**
   - Clique no ícone de engrenagem (⚙️) no menu lateral
   - Selecione **"API"**

3. **Copie a Service Role Key:**
   - Procure por **"Project API keys"**
   - Encontre a chave **"service_role"** (NÃO é a "anon")
   - Clique em "Reveal" e copie toda a chave JWT

4. **Configure no Orange Pi:**

```bash
# Conectar via SSH
ssh root@orangepi3b

# Editar .env
nano ~/SteamBundleAPI/.env

# Adicionar/editar estas linhas:
ENABLE_SUPABASE_SYNC=true
SUPABASE_URL=https://hjespkvqdpalpsbcdzgq.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3M...COLE_SUA_CHAVE_AQUI

# Salvar (Ctrl+O, Enter, Ctrl+X)
```

5. **Reiniciar container:**

```bash
cd ~/SteamBundleAPI
docker compose down
docker compose up -d

# Verificar logs
docker logs steam_scraper -f
```

6. **Executar sync manual (teste):**

```bash
docker exec steam_scraper python -m scraper.sync_supabase
```

## ⚠️ Segurança

- **NUNCA** commite a service_role key no Git
- Ela tem **acesso total** ao banco Supabase
- Use apenas em ambiente seguro (servidor)
- O arquivo `.env` já está no `.gitignore`

## 🔄 Sync Automático

Após configurar, o sync acontece:
- **A cada 6 horas** (via cron)
- Envia bundles atualizados do PostgreSQL local → Supabase
- Frontend consome direto do Supabase (read-only)

## 📊 Verificar no Supabase

Após o primeiro sync:
1. Vá em **Table Editor**
2. Selecione tabela **`steam_bundles`**
3. Você verá os bundles populados
