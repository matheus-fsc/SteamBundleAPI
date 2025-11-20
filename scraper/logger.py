"""
Logger simples - equivalente ao PersistentLogger.js
OTIMIZADO PARA ORANGE PI: Logs vão para stdout para proteção do cartão SD
"""
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional
import os


class Logger:
    """
    Logger para o scraper com suporte a arquivo e console
    
    MODO DOCKER (padrão): Logs apenas para stdout, Docker gerencia
    MODO DESENVOLVIMENTO: Logs para arquivo e console
    """
    
    def __init__(self, name: str = 'steam_scraper', log_dir: Optional[str] = None):
        self.logger = logging.getLogger(name)
        self.logger.setLevel(logging.INFO)
        
        # Remove handlers existentes para evitar duplicação
        if self.logger.handlers:
            self.logger.handlers.clear()
        
        # Detecta ambiente
        is_docker = os.getenv('DOCKER_ENV', 'false').lower() == 'true'
        disable_file_logs = os.getenv('DISABLE_FILE_LOGS', str(is_docker)).lower() == 'true'
        
        # Handler para console (sempre ativo)
        ch = logging.StreamHandler()
        ch.setLevel(logging.INFO)
        
        # Formato
        formatter = logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
        ch.setFormatter(formatter)
        self.logger.addHandler(ch)
        
        # Handler para arquivo (APENAS em desenvolvimento)
        if not disable_file_logs:
            # Diretório de logs
            if log_dir is None:
                log_dir = Path(__file__).parent.parent / 'logs'
            else:
                log_dir = Path(log_dir)
            
            log_dir.mkdir(exist_ok=True)
            
            log_file = log_dir / f'scraper_{datetime.now().strftime("%Y%m%d")}.log'
            fh = logging.FileHandler(log_file, encoding='utf-8')
            fh.setLevel(logging.INFO)
            fh.setFormatter(formatter)
            
            self.logger.addHandler(fh)
            self.logger.info(f"📁 Logs também salvos em: {log_file}")
        else:
            self.logger.info("🐳 Modo Docker: Logs apenas para stdout (proteção do SD Card)")
    
    def info(self, message: str):
        """Log de informação"""
        self.logger.info(message)
    
    def warning(self, message: str):
        """Log de aviso"""
        self.logger.warning(message)
    
    def error(self, message: str):
        """Log de erro"""
        self.logger.error(message)
    
    def debug(self, message: str):
        """Log de debug"""
        self.logger.debug(message)
    
    def success(self, message: str):
        """Log de sucesso (como info mas mais destacado)"""
        self.logger.info(f"✓ {message}")
    
    def start_operation(self, operation: str):
        """Marca início de uma operação"""
        self.logger.info(f"{'='*60}")
        self.logger.info(f"Iniciando: {operation}")
        self.logger.info(f"{'='*60}")
    
    def end_operation(self, operation: str, success: bool = True):
        """Marca fim de uma operação"""
        status = "✓ Concluído" if success else "✗ Falhou"
        self.logger.info(f"{status}: {operation}")
        self.logger.info(f"{'='*60}\n")
