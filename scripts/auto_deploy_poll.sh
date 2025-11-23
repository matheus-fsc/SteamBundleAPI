#!/bin/bash
# Auto-deploy via polling (verifica git a cada 5 minutos)
# Mais simples que webhook, não precisa expor porta

set -e

REPO_PATH="/root/SteamBundleAPI"
BRANCH="main"
LOG_FILE="/var/log/auto-deploy.log"

# Função de log
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

cd "$REPO_PATH"

# Fetch para ver se há atualizações
git fetch origin "$BRANCH" > /dev/null 2>&1

# Compara local com remote
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/$BRANCH)

if [ "$LOCAL" != "$REMOTE" ]; then
    log "🚀 Nova atualização detectada!"
    log "   Local:  $LOCAL"
    log "   Remote: $REMOTE"
    
    # Git pull
    log "📥 Fazendo git pull..."
    if git pull origin "$BRANCH"; then
        log "✅ Git pull concluído"
        
        # Restart container (SEM rebuild)
        log "🔄 Reiniciando container scraper..."
        if docker compose restart scraper; then
            log "✅ Container reiniciado com sucesso!"
            log "📊 Status do container:"
            docker compose ps scraper | tee -a "$LOG_FILE"
        else
            log "❌ Erro ao reiniciar container!"
            exit 1
        fi
    else
        log "❌ Erro no git pull!"
        exit 1
    fi
else
    log "✓ Nenhuma atualização disponível"
fi
