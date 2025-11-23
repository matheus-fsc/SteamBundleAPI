#!/bin/bash
# Script de Reinstalação Limpa do Projeto no Orange Pi
# Remove tudo exceto .env e reconfigura do zero

set -e

echo "🧹 REINSTALAÇÃO LIMPA - Steam Bundle API"
echo "========================================"
echo ""
echo "⚠️  Este script irá:"
echo "  - Parar e remover todos os containers"
echo "  - Remover imagens Docker antigas"
echo "  - Fazer backup do .env"
echo "  - Remover pasta do projeto"
echo "  - Clonar projeto do GitHub"
echo "  - Restaurar .env"
echo "  - Recriar containers"
echo ""
read -p "Continuar? (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
    echo "Cancelado."
    exit 0
fi

REPO_PATH="/root/SteamBundleAPI"
BACKUP_PATH="/tmp/steambundle_backup"
GITHUB_REPO="https://github.com/matheus-fsc/SteamBundleAPI.git"

# 1. Backup do .env
echo ""
echo "📦 1/8 Fazendo backup do .env..."
mkdir -p "$BACKUP_PATH"
if [ -f "$REPO_PATH/.env" ]; then
    cp "$REPO_PATH/.env" "$BACKUP_PATH/.env"
    echo "✅ Backup do .env salvo em $BACKUP_PATH/.env"
else
    echo "⚠️  Nenhum .env encontrado"
fi

# 2. Parar containers
echo ""
echo "🛑 2/8 Parando containers..."
cd "$REPO_PATH" 2>/dev/null || true
docker compose down || true
echo "✅ Containers parados"

# 3. Remover containers antigos
echo ""
echo "🗑️  3/8 Removendo containers antigos..."
docker ps -a | grep -E 'steam_scraper|steam_db' | awk '{print $1}' | xargs -r docker rm -f || true
echo "✅ Containers removidos"

# 4. Remover imagens antigas
echo ""
echo "🗑️  4/8 Removendo imagens antigas..."
docker images | grep -E 'steambundleapi|steam' | awk '{print $3}' | xargs -r docker rmi -f || true
echo "✅ Imagens removidas"

# 5. Limpar build cache
echo ""
echo "🧹 5/8 Limpando build cache..."
docker builder prune -af
echo "✅ Build cache limpo"

# 6. Remover pasta do projeto
echo ""
echo "🗑️  6/8 Removendo pasta do projeto..."
rm -rf "$REPO_PATH"
echo "✅ Pasta removida"

# 7. Clonar repositório
echo ""
echo "📥 7/8 Clonando repositório do GitHub..."
git clone "$GITHUB_REPO" "$REPO_PATH"
cd "$REPO_PATH"
echo "✅ Repositório clonado"

# 8. Restaurar .env
echo ""
echo "📦 8/8 Restaurando .env..."
if [ -f "$BACKUP_PATH/.env" ]; then
    cp "$BACKUP_PATH/.env" "$REPO_PATH/.env"
    echo "✅ .env restaurado"
else
    echo "⚠️  Nenhum .env para restaurar"
    echo "❌ ATENÇÃO: Você precisa criar um .env antes de continuar!"
    exit 1
fi

# 9. Subir containers
echo ""
echo "🚀 Subindo containers..."
docker compose up -d --build

# 10. Aguardar containers ficarem saudáveis
echo ""
echo "⏳ Aguardando containers iniciarem..."
sleep 10

# 11. Verificar status
echo ""
echo "📊 Status dos containers:"
docker compose ps

echo ""
echo "✅ REINSTALAÇÃO CONCLUÍDA!"
echo ""
echo "📋 Próximos passos:"
echo "  1. Verifique os logs: docker logs -f steam_scraper"
echo "  2. Aguarde o cron executar OU force: docker exec steam_scraper python -m scraper.main_with_db"
echo "  3. Verifique Supabase após scraping completar"
echo ""
echo "🔗 Comandos úteis:"
echo "  docker compose ps                     # Ver status"
echo "  docker logs -f steam_scraper          # Ver logs em tempo real"
echo "  docker exec steam_scraper python -m scraper.main_with_db  # Forçar scraping"
echo "  docker exec steam_scraper python -m scraper.sync_supabase # Forçar sync"
echo ""
