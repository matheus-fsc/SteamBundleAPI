-- Schema SQL para criar tabela no Supabase
-- Execute isso no SQL Editor do Supabase

-- Tabela principal de bundles
CREATE TABLE IF NOT EXISTS bundles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT,
    
    -- Preços
    final_price NUMERIC,
    original_price NUMERIC,
    discount INTEGER DEFAULT 0,
    currency TEXT DEFAULT 'BRL',
    
    -- Jogos
    games JSONB,
    games_count INTEGER DEFAULT 0,
    
    -- Validação
    is_valid BOOLEAN DEFAULT true,
    is_discount_real BOOLEAN DEFAULT true,
    discount_analysis TEXT,
    
    -- Histórico (simplificado - últimos 30 dias)
    price_history JSONB DEFAULT '[]'::jsonb,
    
    -- Timestamps
    first_seen TIMESTAMP WITH TIME ZONE,
    last_updated TIMESTAMP WITH TIME ZONE,
    synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Índices para performance
    CONSTRAINT bundles_discount_check CHECK (discount >= 0 AND discount <= 100)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_bundles_discount ON bundles(discount DESC);
CREATE INDEX IF NOT EXISTS idx_bundles_currency ON bundles(currency);
CREATE INDEX IF NOT EXISTS idx_bundles_last_updated ON bundles(last_updated DESC);
CREATE INDEX IF NOT EXISTS idx_bundles_valid ON bundles(is_valid) WHERE is_valid = true;
CREATE INDEX IF NOT EXISTS idx_bundles_real_discount ON bundles(is_discount_real) WHERE is_discount_real = true;

-- View para top deals (facilitam queries)
CREATE OR REPLACE VIEW top_deals AS
SELECT 
    id,
    name,
    url,
    final_price,
    original_price,
    discount,
    currency,
    games_count,
    is_discount_real,
    last_updated
FROM bundles
WHERE 
    is_valid = true 
    AND discount > 0
    AND last_updated > NOW() - INTERVAL '7 days'
ORDER BY 
    CASE WHEN is_discount_real THEN discount ELSE discount * 0.5 END DESC
LIMIT 100;

-- View para bundles recentes
CREATE OR REPLACE VIEW recent_bundles AS
SELECT 
    id,
    name,
    url,
    final_price,
    original_price,
    discount,
    currency,
    games_count,
    last_updated
FROM bundles
WHERE 
    is_valid = true
    AND last_updated > NOW() - INTERVAL '24 hours'
ORDER BY last_updated DESC;

-- Políticas RLS (Row Level Security) - opcional mas recomendado
ALTER TABLE bundles ENABLE ROW LEVEL SECURITY;

-- Permite leitura pública (anônimo)
CREATE POLICY "Allow public read access" ON bundles
    FOR SELECT
    USING (true);

-- Apenas service role pode inserir/atualizar (seu scraper)
CREATE POLICY "Allow service role full access" ON bundles
    FOR ALL
    USING (auth.role() = 'service_role');

-- Comentários para documentação
COMMENT ON TABLE bundles IS 'Steam bundles com histórico de preços';
COMMENT ON COLUMN bundles.is_discount_real IS 'Indica se o desconto é real ou "metade do dobro"';
COMMENT ON COLUMN bundles.price_history IS 'Histórico simplificado dos últimos 30 dias';
COMMENT ON COLUMN bundles.synced_at IS 'Última vez que foi sincronizado do scraper local';
