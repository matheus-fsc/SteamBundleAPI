#!/bin/bash
# Script de deploy para Orange Pi com sistema autônomo

echo "=========================================="
echo "DEPLOY - SISTEMA AUTONOMO"
echo "=========================================="

# 1. Push para GitHub
echo ""
echo "1. Fazendo push para GitHub..."
git push origin main

if [ $? -ne 0 ]; then
    echo "ERRO: Falha no push para GitHub"
    exit 1
fi

echo ""
echo "2. Conectando ao Orange Pi..."
echo ""

# 2. SSH e atualizar Orange Pi
sshpass -p '2710' ssh -o StrictHostKeyChecking=no root@orangepi3b << 'ENDSSH'
echo "Conectado ao Orange Pi"
echo ""

cd ~/SteamBundleAPI || exit 1

echo "Atualizando código..."
git pull origin main

echo ""
echo "Parando containers..."
docker compose down

echo ""
echo "Copiando dados descobertos..."
# Criar diretório data se não existir
mkdir -p data

echo ""
echo "Reconstruindo imagem..."
docker compose build scraper

echo ""
echo "Iniciando containers..."
docker compose up -d

echo ""
echo "Aguardando containers iniciarem (10s)..."
sleep 10

echo ""
echo "=========================================="
echo "STATUS DOS CONTAINERS"
echo "=========================================="
docker compose ps

echo ""
echo "=========================================="
echo "ULTIMAS 30 LINHAS DO LOG"
echo "=========================================="
docker compose logs --tail=30 scraper

echo ""
echo "=========================================="
echo "VERIFICACAO DOS DADOS"
echo "=========================================="
if [ -f data/known_bundles.json ]; then
    BUNDLE_COUNT=$(grep -c '"' data/known_bundles.json | head -1)
    echo "Arquivo known_bundles.json encontrado"
    echo "Verificar total de bundles manualmente"
else
    echo "AVISO: known_bundles.json nao encontrado"
    echo "Execute: python scripts/discover_with_diff.py"
fi

echo ""
echo "=========================================="
echo "DEPLOY CONCLUIDO!"
echo "=========================================="
echo ""
echo "Comandos uteis:"
echo "  docker compose logs -f scraper    # Ver logs em tempo real"
echo "  docker compose exec scraper bash   # Acessar container"
echo "  docker compose ps                  # Status dos containers"
echo "  cd ~/SteamBundleAPI && git pull    # Atualizar codigo"
echo ""
echo "Sistema autonomo configurado:"
echo "  - Segunda 02:00: Descoberta completa"
echo "  - Segunda 03:00: Scraping incremental"
echo "  - Diario 06:00: Scraping completo"
echo "  - Diario 12:00: Segunda atualizacao"
echo ""
ENDSSH

echo ""
echo "=========================================="
echo "DEPLOY NO ORANGE PI FINALIZADO!"
echo "=========================================="
