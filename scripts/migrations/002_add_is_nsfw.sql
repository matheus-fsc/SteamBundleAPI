-- Migration 002: Adiciona campo is_nsfw e tabela de analytics
-- Data: 2025-11-22
-- Descrição: Adiciona detecção de conteúdo NSFW e sistema de métricas

-- Adiciona campo is_nsfw na tabela bundles
ALTER TABLE bundles ADD COLUMN IF NOT EXISTS is_nsfw BOOLEAN;
UPDATE bundles SET is_nsfw = false WHERE is_nsfw IS NULL;
ALTER TABLE bundles ALTER COLUMN is_nsfw SET DEFAULT false;
ALTER TABLE bundles ALTER COLUMN is_nsfw SET NOT NULL;

-- Cria tabela de analytics para tracking de views
CREATE TABLE IF NOT EXISTS bundle_analytics (
  bundle_id TEXT PRIMARY KEY REFERENCES bundles(id) ON DELETE CASCADE,
  view_count BIGINT NOT NULL DEFAULT 0,
  last_viewed_at TIMESTAMP WITH TIME ZONE
);

-- Índice para queries de top bundles por views
CREATE INDEX IF NOT EXISTS idx_bundle_analytics_views ON bundle_analytics(view_count DESC);

-- Comentários das colunas
COMMENT ON COLUMN bundles.is_nsfw IS 'Indica se o bundle contém conteúdo adulto (+18)';
COMMENT ON TABLE bundle_analytics IS 'Métricas de visualizações e cliques em bundles';
COMMENT ON COLUMN bundle_analytics.view_count IS 'Contador total de visualizações';
COMMENT ON COLUMN bundle_analytics.last_viewed_at IS 'Timestamp da última visualização';
