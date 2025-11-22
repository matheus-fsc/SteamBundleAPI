"""
Sincronização com Supabase
Envia dados refinados do PostgreSQL local para a nuvem (vitrine pública)
"""
import asyncio
import os
from typing import List, Dict, Optional
from datetime import datetime, timedelta
from supabase import create_client, Client
from sqlalchemy import select
from .database import Database, BundleModel
from .logger import Logger


class SupabaseSync:
    """
    Sincroniza bundles do banco local para Supabase
    Apenas bundles válidos e atualizados recentemente
    """
    
    def __init__(
        self,
        supabase_url: Optional[str] = None,
        supabase_key: Optional[str] = None,
        local_db: Optional[Database] = None
    ):
        """
        Inicializa sincronizador
        
        Args:
            supabase_url: URL do projeto Supabase
            supabase_key: Service key do Supabase
            local_db: Instância do banco local
        """
        self.logger = Logger('supabase_sync')
        
        # Configurações do Supabase
        self.supabase_url = supabase_url or os.getenv('SUPABASE_URL')
        self.supabase_key = supabase_key or os.getenv('SUPABASE_SERVICE_KEY')
        
        if not self.supabase_url or not self.supabase_key:
            raise ValueError(
                "SUPABASE_URL e SUPABASE_SERVICE_KEY devem estar configurados"
            )
        
        # Cliente Supabase
        self.supabase: Client = create_client(self.supabase_url, self.supabase_key)
        
        # Banco local
        self.db = local_db or Database()
    
    async def get_bundles_to_sync(
        self,
        hours_ago: int = 24,
        only_valid: bool = True,
        only_with_discount: bool = False
    ) -> List[BundleModel]:
        """
        Busca bundles para sincronizar
        
        Args:
            hours_ago: Apenas bundles atualizados nas últimas X horas
            only_valid: Apenas bundles válidos
            only_with_discount: Apenas bundles com desconto
            
        Returns:
            Lista de bundles para sincronizar
        """
        async with self.db.async_session() as session:
            query = select(BundleModel)
            
            # Filtros
            cutoff_time = datetime.utcnow() - timedelta(hours=hours_ago)
            query = query.where(BundleModel.last_updated >= cutoff_time)
            
            if only_valid:
                query = query.where(BundleModel.is_valid == True)
            
            if only_with_discount:
                query = query.where(BundleModel.discount > 0)
            
            # Ordena por desconto (maiores primeiro)
            query = query.order_by(BundleModel.discount.desc())
            
            result = await session.execute(query)
            bundles = result.scalars().all()
            
            self.logger.info(f"Encontrados {len(bundles)} bundles para sincronizar")
            return bundles
    
    def bundle_to_dict(self, bundle: BundleModel) -> Dict:
        """
        Converte modelo do banco local para formato Supabase
        
        Args:
            bundle: Modelo do bundle
            
        Returns:
            Dicionário pronto para upsert
        """
        # Análise de desconto real
        discount_analysis = bundle.get_real_discount()
        
        return {
            'id': bundle.id,
            'name': bundle.name,
            'url': bundle.url,
            
            # Preços
            'final_price': bundle.final_price,
            'original_price': bundle.original_price,
            'discount': bundle.discount,
            'currency': bundle.currency,
            
            # Jogos
            'games': bundle.games,
            'games_count': bundle.games_count,
            
            # Metadados
            'is_valid': bundle.is_valid,
            'is_discount_real': discount_analysis.get('is_real', True),
            'discount_analysis': discount_analysis.get('reason', ''),
            'image_url': bundle.image_url or '',  # URL da imagem header
            'is_nsfw': bundle.is_nsfw or False,  # Conteúdo +18/adulto
            
            # Histórico simplificado (últimos 30 dias)
            'price_history': self._get_recent_history(bundle.price_history),
            
            # Timestamps
            'first_seen': bundle.first_seen.isoformat() if bundle.first_seen else None,
            'last_updated': bundle.last_updated.isoformat() if bundle.last_updated else None,
            'synced_at': datetime.utcnow().isoformat()
        }
    
    def _get_recent_history(self, full_history: Optional[List[Dict]], days: int = 30) -> List[Dict]:
        """Retorna apenas histórico recente (para não sobrecarregar Supabase)"""
        if not full_history or not isinstance(full_history, list):
            return []
        
        cutoff = datetime.utcnow() - timedelta(days=days)
        
        recent = []
        for entry in full_history:
            try:
                entry_date = datetime.fromisoformat(entry['date'])
                if entry_date >= cutoff:
                    recent.append(entry)
            except (KeyError, ValueError):
                continue
        
        return recent
    
    def sync_bundles(self, bundles: List[BundleModel], batch_size: int = 100) -> Dict:
        """
        Sincroniza bundles para Supabase em lotes
        
        Args:
            bundles: Lista de bundles para sincronizar
            batch_size: Tamanho do lote para upsert
            
        Returns:
            Estatísticas da sincronização
        """
        self.logger.start_operation(f"Sincronização de {len(bundles)} bundles")
        
        stats = {
            'total': len(bundles),
            'success': 0,
            'failed': 0,
            'errors': []
        }
        
        # Processa em lotes
        for i in range(0, len(bundles), batch_size):
            batch = bundles[i:i + batch_size]
            batch_data = [self.bundle_to_dict(b) for b in batch]
            
            try:
                # Upsert no Supabase (insere ou atualiza se já existe)
                # O método upsert do Supabase automaticamente detecta conflitos na PRIMARY KEY
                response = self.supabase.table('bundles').upsert(
                    batch_data,
                    returning='minimal'  # Não retorna dados, melhora performance
                ).execute()
                
                stats['success'] += len(batch)
                self.logger.info(
                    f"Lote {i//batch_size + 1}: {len(batch)} bundles sincronizados"
                )
                
            except Exception as e:
                stats['failed'] += len(batch)
                error_msg = f"Erro no lote {i//batch_size + 1}: {str(e)}"
                stats['errors'].append(error_msg)
                self.logger.error(error_msg)
        
        self.logger.success(
            f"Sincronização concluída: {stats['success']} sucesso, {stats['failed']} falhas"
        )
        self.logger.end_operation("Sincronização Supabase")
        
        return stats
    
    async def full_sync(
        self,
        hours_ago: int = 24,
        only_with_discount: bool = False
    ) -> Dict:
        """
        Sincronização completa: busca + upload
        
        Args:
            hours_ago: Apenas bundles das últimas X horas
            only_with_discount: Apenas bundles com desconto
            
        Returns:
            Estatísticas da sincronização
        """
        # Busca bundles
        bundles = await self.get_bundles_to_sync(
            hours_ago=hours_ago,
            only_with_discount=only_with_discount
        )
        
        if not bundles:
            self.logger.info("Nenhum bundle para sincronizar")
            return {'total': 0, 'success': 0, 'failed': 0}
        
        # Sincroniza
        return self.sync_bundles(bundles)
    
    def cleanup_old_bundles(self, days_old: int = 90):
        """
        Remove bundles muito antigos do Supabase
        Mantém banco leve e focado em promoções atuais
        
        Args:
            days_old: Remove bundles não atualizados há X dias
        """
        cutoff = datetime.utcnow() - timedelta(days=days_old)
        cutoff_str = cutoff.isoformat()
        
        try:
            response = self.supabase.table('bundles').delete().lt(
                'last_updated',
                cutoff_str
            ).execute()
            
            self.logger.info(f"Bundles antigos removidos do Supabase")
            
        except Exception as e:
            self.logger.error(f"Erro ao limpar bundles antigos: {e}")
    
    async def sync_top_deals(self, limit: int = 50) -> Dict:
        """
        Sincroniza apenas os melhores deals (para página inicial)
        
        Args:
            limit: Quantidade de deals para sincronizar
            
        Returns:
            Estatísticas da sincronização
        """
        self.logger.info(f"Sincronizando top {limit} deals...")
        
        # Busca top bundles
        top_bundles = await self.db.get_top_discounts(limit=limit)
        
        if not top_bundles:
            return {'total': 0, 'success': 0, 'failed': 0}
        
        return self.sync_bundles(top_bundles)
    
    def test_connection(self) -> bool:
        """
        Testa conexão com Supabase
        
        Returns:
            True se conectou com sucesso
        """
        try:
            # Tenta fazer uma query simples
            response = self.supabase.table('bundles').select('id').limit(1).execute()
            self.logger.success("Conexão com Supabase OK")
            return True
        except Exception as e:
            self.logger.error(f"Erro ao conectar no Supabase: {e}")
            return False


async def sync_to_supabase(
    hours_ago: int = 24,
    only_with_discount: bool = True,
    cleanup_old: bool = False
):
    """
    Função helper para sincronizar facilmente
    
    Args:
        hours_ago: Sincroniza bundles das últimas X horas
        only_with_discount: Apenas com desconto
        cleanup_old: Se deve limpar bundles antigos
    """
    logger = Logger('sync')
    
    try:
        # Inicializa banco local
        db = Database()
        await db.init_db()
        
        # Inicializa sincronizador
        sync = SupabaseSync(local_db=db)
        
        # Testa conexão
        if not sync.test_connection():
            logger.error("Falha ao conectar no Supabase")
            return
        
        # Sincronização completa
        stats = await sync.full_sync(
            hours_ago=hours_ago,
            only_with_discount=only_with_discount
        )
        
        logger.info(f"Estatísticas: {stats}")
        
        # Cleanup opcional
        if cleanup_old:
            logger.info("Limpando bundles antigos do Supabase...")
            sync.cleanup_old_bundles(days_old=90)
        
        await db.close()
        
    except Exception as e:
        logger.error(f"Erro durante sincronização: {e}")
        raise


if __name__ == "__main__":
    # Execução direta
    asyncio.run(sync_to_supabase(
        hours_ago=24,
        only_with_discount=True,
        cleanup_old=False
    ))
