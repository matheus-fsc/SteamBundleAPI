#!/bin/bash
# Script de monitoramento centralizado para debug

LOG_DIR="/logs"
mkdir -p "$LOG_DIR"

echo "🔍 Monitor de Logs Iniciado - $(date)"
echo "📁 Logs salvos em: $LOG_DIR"
echo "================================"

# Função para coletar status
collect_status() {
    local timestamp=$(date '+%Y-%m-%d_%H-%M-%S')
    local output="$LOG_DIR/status_${timestamp}.log"
    
    {
        echo "=== STATUS GERAL - $(date) ==="
        echo ""
        
        echo "=== CONTAINERS ==="
        docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || echo "Erro ao listar containers"
        echo ""
        
        echo "=== PROCESSOS NO SCRAPER ==="
        docker exec steam_scraper ps aux 2>/dev/null || echo "Container scraper não disponível"
        echo ""
        
        echo "=== BUNDLES DESCOBERTOS ==="
        docker exec steam_scraper python3 -c "
import json
try:
    with open('/app/data/known_bundles.json') as f:
        data = json.load(f)
        print(f'Total: {len(data.get(\"bundle_ids\", []))} bundles')
        print(f'Última atualização: {data.get(\"last_updated\", \"N/A\")}')
except:
    print('Arquivo ainda não existe')
" 2>/dev/null || echo "Erro ao verificar discovery"
        echo ""
        
        echo "=== BANCO DE DADOS ==="
        docker exec steam_db psql -U steam -d steam_bundles -c "SELECT COUNT(*) as total_bundles FROM bundles;" 2>/dev/null || echo "Erro ao consultar banco"
        echo ""
        
        echo "=== ARQUIVOS DE CONTROLE ==="
        docker exec steam_scraper ls -lh /app/data/ 2>/dev/null || echo "Erro ao listar dados"
        echo ""
        
        echo "=== USO DE RECURSOS ==="
        docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" 2>/dev/null || echo "Erro ao coletar stats"
        echo ""
        
    } > "$output"
    
    echo "✓ Status salvo: $output"
}

# Função para coletar logs completos
collect_logs() {
    local timestamp=$(date '+%Y-%m-%d_%H-%M-%S')
    
    echo "📋 Coletando logs completos..."
    
    # Logs do scraper
    docker logs --tail 1000 steam_scraper > "$LOG_DIR/scraper_${timestamp}.log" 2>&1 || echo "Erro ao coletar logs do scraper"
    
    # Logs do banco
    docker logs --tail 500 steam_db > "$LOG_DIR/db_${timestamp}.log" 2>&1 || echo "Erro ao coletar logs do db"
    
    # Logs do cloudflared
    docker logs --tail 500 cloudflared > "$LOG_DIR/cloudflared_${timestamp}.log" 2>&1 || echo "Erro ao coletar logs do cloudflared"
    
    echo "✓ Logs salvos em: $LOG_DIR/*_${timestamp}.log"
}

# Função para detectar erros
detect_errors() {
    local timestamp=$(date '+%Y-%m-%d_%H-%M-%S')
    local output="$LOG_DIR/errors_${timestamp}.log"
    
    {
        echo "=== ERROS DETECTADOS - $(date) ==="
        echo ""
        
        echo "=== ERROS NO SCRAPER ==="
        docker logs --tail 500 steam_scraper 2>&1 | grep -i "error\|exception\|traceback\|failed" | tail -50
        echo ""
        
        echo "=== ERROS NO BANCO ==="
        docker logs --tail 200 steam_db 2>&1 | grep -i "error\|fatal" | tail -20
        echo ""
        
    } > "$output"
    
    # Só mostrar se houver erros
    if [ -s "$output" ]; then
        echo "⚠️  ERROS DETECTADOS! Ver: $output"
        tail -20 "$output"
    else
        rm "$output"
    fi
}

# Loop principal
iteration=0
while true; do
    iteration=$((iteration + 1))
    echo ""
    echo "🔄 Iteração #$iteration - $(date)"
    
    # A cada 30 segundos: status resumido
    collect_status
    
    # A cada 5 minutos: logs completos
    if [ $((iteration % 10)) -eq 0 ]; then
        collect_logs
    fi
    
    # A cada minuto: detectar erros
    if [ $((iteration % 2)) -eq 0 ]; then
        detect_errors
    fi
    
    # Limpar logs antigos (manter últimas 24h)
    find "$LOG_DIR" -type f -mmin +1440 -delete 2>/dev/null
    
    # Aguardar 30 segundos
    sleep 30
done
