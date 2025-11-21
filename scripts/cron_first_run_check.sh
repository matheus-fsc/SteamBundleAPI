#!/bin/bash
# Script que só executa se a primeira execução ainda não foi concluída
# Usado no cron para evitar sobrecarga após setup inicial

FLAG_FILE="/app/data/.first_run_completed"

if [ -f "$FLAG_FILE" ]; then
    # Flag existe = primeira execução já foi feita
    exit 0
fi

# Flag não existe = ainda é primeira execução
cd /app && python3 scripts/cron_scraper.py
