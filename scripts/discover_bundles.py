#!/usr/bin/env python3
"""
Script para descobrir TODOS os bundles da Steam via força bruta

Uso:
  python scripts/discover_bundles.py
  
Executa força bruta completa (ID 1 a 35000)
Tempo estimado: 10-15 minutos
"""
import sys
import asyncio
from pathlib import Path

# Adiciona o diretório raiz ao path
sys.path.insert(0, str(Path(__file__).parent.parent))

from scraper.bundle_discovery import run_discovery

if __name__ == "__main__":
    print("=" * 70)
    print("DESCOBERTA DE BUNDLES DA STEAM")
    print("=" * 70)
    print("\n🔍 Estratégia: Força bruta completa (ID 1 a 35000)")
    print("\n⏱️  Tempo estimado: 10-15 minutos")
    print("📊 Resultado esperado: ~2500-3000 bundles")
    print("\n⚠️  ISTO VAI DEMORAR! Aguarde...")
    print("\n" + "-" * 70 + "\n")
    
    try:
        asyncio.run(run_discovery())
        
        print("\n" + "=" * 70)
        print("✅ CONCLUÍDO!")
        print("=" * 70)
        print("\nPróximos passos:")
        print("1. Execute: python -m scraper.main_with_db")
        print("2. Ou no Docker: docker compose restart scraper")
        print("\nO scraper agora usará a lista completa de bundles!")
        
    except KeyboardInterrupt:
        print("\n\n⚠️  Interrompido pelo usuário")
        print("Progresso parcial foi salvo em known_bundles.py")
    except Exception as e:
        print(f"\n\n❌ Erro: {e}")
        sys.exit(1)
