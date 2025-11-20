#!/bin/sh
# Entrypoint para container de cron
# Garante que timezone e ambiente estão corretos

set -e

# Define timezone (ajuste conforme necessário)
export TZ=${TZ:-America/Sao_Paulo}

# Log inicial
echo "====================================="
echo "Steam Scraper Cron Service"
echo "Timezone: $TZ"
echo "Hora atual: $(date)"
echo "====================================="

# Lista cron jobs configurados
echo "Cron jobs configurados:"
crontab -l

echo "====================================="
echo "Iniciando cron daemon..."
echo "====================================="

# Inicia cron em foreground
exec crond -f -l 2
