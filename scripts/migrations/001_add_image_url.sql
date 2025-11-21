-- Migration: Adiciona coluna image_url
-- Execute no SQL Editor do Supabase

ALTER TABLE bundles 
ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Cria índice para busca por imagem
CREATE INDEX IF NOT EXISTS idx_bundles_image ON bundles(image_url) 
WHERE image_url IS NOT NULL;

-- Verifica resultado
SELECT COUNT(*) as total_bundles, 
       COUNT(image_url) as with_image,
       COUNT(*) - COUNT(image_url) as without_image
FROM bundles;
