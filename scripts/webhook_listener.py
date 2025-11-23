#!/usr/bin/env python3
"""
Webhook Listener para Auto-Deploy no Orange Pi
Escuta pushes do GitHub e atualiza código automaticamente

Uso:
    1. Configure secret no GitHub: Settings > Webhooks > Add webhook
    2. Payload URL: http://SEU_IP:9000/webhook
    3. Content type: application/json
    4. Secret: coloque o mesmo valor de WEBHOOK_SECRET abaixo
    5. Events: Just the push event
    
    No Orange Pi:
    python3 scripts/webhook_listener.py
"""

import os
import hmac
import hashlib
import subprocess
import json
from http.server import HTTPServer, BaseHTTPRequestHandler

# Configurações
PORT = 9000
WEBHOOK_SECRET = os.getenv('GITHUB_WEBHOOK_SECRET', 'seu_secret_aqui_mude_no_env')
REPO_PATH = '/root/SteamBundleAPI'
BRANCH = 'main'

class WebhookHandler(BaseHTTPRequestHandler):
    
    def log_message(self, format, *args):
        """Log customizado"""
        print(f"[WEBHOOK] {format % args}")
    
    def verify_signature(self, payload):
        """Verifica assinatura do GitHub para segurança"""
        signature = self.headers.get('X-Hub-Signature-256')
        if not signature:
            return False
        
        expected_signature = 'sha256=' + hmac.new(
            WEBHOOK_SECRET.encode(),
            payload,
            hashlib.sha256
        ).hexdigest()
        
        return hmac.compare_digest(signature, expected_signature)
    
    def do_POST(self):
        """Processa POST do webhook GitHub"""
        if self.path != '/webhook':
            self.send_response(404)
            self.end_headers()
            return
        
        # Lê payload
        content_length = int(self.headers.get('Content-Length', 0))
        payload = self.rfile.read(content_length)
        
        # Verifica assinatura (segurança)
        if not self.verify_signature(payload):
            print("❌ Assinatura inválida! Requisição rejeitada.")
            self.send_response(401)
            self.end_headers()
            self.wfile.write(b'Invalid signature')
            return
        
        # Parse JSON
        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            self.send_response(400)
            self.end_headers()
            return
        
        # Verifica se é push na branch correta
        ref = data.get('ref', '')
        if ref != f'refs/heads/{BRANCH}':
            print(f"ℹ️  Push em branch '{ref}' ignorado (esperado: refs/heads/{BRANCH})")
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'OK - wrong branch')
            return
        
        # Commit info
        commits = data.get('commits', [])
        if commits:
            last_commit = commits[-1]
            author = last_commit.get('author', {}).get('name', 'Unknown')
            message = last_commit.get('message', 'No message')
            print(f"\n🚀 Deploy iniciado!")
            print(f"   Autor: {author}")
            print(f"   Commit: {message}")
        
        # Executa deploy
        success = self.deploy()
        
        if success:
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'Deploy successful')
        else:
            self.send_response(500)
            self.end_headers()
            self.wfile.write(b'Deploy failed')
    
    def deploy(self):
        """Executa o deploy (git pull + restart container)"""
        try:
            os.chdir(REPO_PATH)
            
            # 1. Git pull
            print("📥 Fazendo git pull...")
            result = subprocess.run(
                ['git', 'pull', 'origin', BRANCH],
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if result.returncode != 0:
                print(f"❌ Git pull falhou: {result.stderr}")
                return False
            
            print(f"✅ Git pull: {result.stdout.strip()}")
            
            # 2. Restart container (SEM rebuild!)
            print("🔄 Reiniciando container scraper...")
            result = subprocess.run(
                ['docker', 'compose', 'restart', 'scraper'],
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if result.returncode != 0:
                print(f"❌ Restart falhou: {result.stderr}")
                return False
            
            print("✅ Container reiniciado com sucesso!")
            
            # 3. Verifica status
            result = subprocess.run(
                ['docker', 'compose', 'ps', 'scraper'],
                capture_output=True,
                text=True,
                timeout=10
            )
            print(f"📊 Status:\n{result.stdout}")
            
            print("✅ Deploy concluído com sucesso!\n")
            return True
            
        except subprocess.TimeoutExpired:
            print("❌ Timeout durante deploy")
            return False
        except Exception as e:
            print(f"❌ Erro durante deploy: {e}")
            return False
    
    def do_GET(self):
        """Health check"""
        if self.path == '/health':
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'OK')
        else:
            self.send_response(404)
            self.end_headers()

def main():
    print("=" * 60)
    print("🎣 GitHub Webhook Listener - Auto Deploy")
    print("=" * 60)
    print(f"📡 Escutando em: http://0.0.0.0:{PORT}/webhook")
    print(f"📂 Repositório: {REPO_PATH}")
    print(f"🌿 Branch: {BRANCH}")
    print(f"🔒 Secret: {'configurado' if WEBHOOK_SECRET != 'seu_secret_aqui_mude_no_env' else '⚠️  NÃO CONFIGURADO!'}")
    print("=" * 60)
    print("\n⏳ Aguardando webhooks do GitHub...\n")
    
    server = HTTPServer(('0.0.0.0', PORT), WebhookHandler)
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n\n👋 Webhook listener encerrado")
        server.shutdown()

if __name__ == '__main__':
    main()
