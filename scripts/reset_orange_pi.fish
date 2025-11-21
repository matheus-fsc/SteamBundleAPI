#!/usr/bin/env fish
# Reset completo do Orange Pi para teste do zero

echo "🔄 RESET COMPLETO DO ORANGE PI"
echo "================================"
echo ""

# Conecta no Orange Pi
ssh root@orangepi3b "
    echo '⏹️  Parando containers...'
    cd ~/SteamBundleAPI
    docker-compose down -v
    
    echo '🗑️  Removendo projeto antigo...'
    cd ~
    rm -rf SteamBundleAPI
    
    echo '📥 Clonando projeto atualizado...'
    git clone https://github.com/matheus-fsc/SteamBundleAPI.git
    cd SteamBundleAPI
    
    echo '⚙️  Criando .env...'
    cat > .env << 'ENVEOF'
# Database
DB_PASSWORD=changeme
DATABASE_URL=postgresql+asyncpg://steam:changeme@postgres/steam_bundles

# Supabase (substitua com suas credenciais reais)
ENABLE_SUPABASE_SYNC=true
SUPABASE_URL=https://hjespkvqdpalpsbcdzgq.supabase.co
SUPABASE_SERVICE_KEY=\$SUPABASE_SERVICE_KEY_AQUI
SUPABASE_DB_URL=postgresql+asyncpg://postgres:\$SENHA_AQUI@db.hjespkvqdpalpsbcdzgq.supabase.co:5432/postgres

# Docker
DOCKER_ENV=true
DISABLE_FILE_LOGS=true
PYTHONUNBUFFERED=1
TZ=America/Sao_Paulo
ENVEOF
    
    echo '📝 ATENÇÃO: Edite o arquivo .env com suas credenciais!'
    echo '   nano ~/SteamBundleAPI/.env'
    echo ''
    echo '✅ Reset completo! Próximos passos:'
    echo '   1. Edite .env com credenciais'
    echo '   2. docker-compose up -d --build'
    echo '   3. docker exec steam_scraper python3 scripts/discover_with_diff.py'
    echo '   4. docker exec steam_scraper python3 -m scraper.main_with_db'
"

echo ""
echo "✅ Comandos executados! Agora configure as credenciais."
