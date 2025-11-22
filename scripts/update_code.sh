#!/bin/bash
# Script para atualizar código no Orange Pi SEM rebuild
# Uso: ./scripts/update_code.sh

set -e

echo "🔄 Atualizando código no Orange Pi..."

# 1. Pull do código mais recente
echo "📥 Fazendo git pull..."
git pull

# 2. Apenas reinicia o container (código é montado via volume)
echo "🔄 Reiniciando container scraper..."
docker compose restart scraper

# 3. Verifica status
echo "✅ Verificando status..."
docker compose ps

echo ""
echo "✅ Atualização concluída!"
echo "💡 O código foi atualizado SEM rebuild (via volume mount)"
echo ""
echo "Para ver logs: docker logs -f steam_scraper"
