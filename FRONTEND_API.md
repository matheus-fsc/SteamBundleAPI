# API Frontend - Consumindo Dados do Supabase

## Visão Geral

O sistema sincroniza automaticamente os bundles para o Supabase a cada 6 horas. O frontend pode consumir esses dados via API REST ou SDK do Supabase.

## Configuração do Frontend

### 1. Variáveis de Ambiente

```env
NEXT_PUBLIC_SUPABASE_URL=https://hjespkvqdpalpsbcdzgq.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sua_anon_key_publica_aqui
```

### 2. Instalação

```bash
npm install @supabase/supabase-js
# ou
yarn add @supabase/supabase-js
```

### 3. Client Setup

```typescript
// lib/supabase.ts
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Tipos TypeScript
export interface Bundle {
  id: string
  name: string
  url: string
  image_url: string | null
  final_price: number
  original_price: number
  discount: number
  currency: string
  games: any[]
  games_count: number
  is_valid: boolean
  is_nsfw: boolean  // 🔞 NOVO: Conteúdo +18/adulto
  is_discount_real: boolean
  discount_analysis: string
  price_history: PriceHistory[]
  first_seen: string
  last_updated: string
  synced_at: string
}

export interface BundleAnalytics {
  bundle_id: string
  view_count: number
  total_clicks: number
  last_viewed_at: string
  first_tracked_at: string
}

export interface PriceHistory {
  date: string
  final: number
  original: number
  discount: number
  currency: string
}
```

## Queries Prontas

### 1. Top Deals (Página Inicial)

```typescript
// app/api/deals/route.ts
import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data, error } = await supabase
    .from('bundles')
    .select('*')
    .eq('is_valid', true)
    .eq('is_nsfw', false)  // 🔞 Filtrar conteúdo adulto
    .gt('discount', 30)
    .order('discount', { ascending: false })
    .limit(50)
  
  if (error) return Response.json({ error }, { status: 500 })
  return Response.json({ deals: data })
}
```

### 2. Bundles Mais Visualizados (Trending)

```typescript
// app/api/trending/route.ts
export async function GET() {
  // Query com JOIN entre bundles e analytics
  const { data, error } = await supabase
    .from('bundle_analytics')
    .select(`
      *,
      bundles (
        id, name, url, image_url, final_price, 
        original_price, discount, currency, games_count, is_nsfw
      )
    `)
    .order('view_count', { ascending: false })
    .limit(20)
  
  if (error) return Response.json({ error }, { status: 500 })
  return Response.json({ trending: data })
}
```

### 3. Melhores Ofertas (Alto desconto + muitos jogos)

```typescript
// app/api/best-deals/route.ts
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const minDiscount = parseInt(searchParams.get('min_discount') || '50')
  const includeNSFW = searchParams.get('include_nsfw') === 'true'
  
  let query = supabase
    .from('bundles')
    .select('*')
    .eq('is_valid', true)
    .gte('discount', minDiscount)
    .gt('games_count', 2)  // Pelo menos 3 jogos
  
  if (!includeNSFW) {
    query = query.eq('is_nsfw', false)
  }
  
  const { data, error } = await query
    .order('discount', { ascending: false })
    .order('games_count', { ascending: false })
    .limit(30)
  
  if (error) return Response.json({ error }, { status: 500 })
  return Response.json({ deals: data })
}
```

### 4. Busca por Nome

```typescript
// components/BundleSearch.tsx
const searchBundles = async (query: string) => {
  const { data } = await supabase
    .from('bundles')
    .select('*')
    .ilike('name', `%${query}%`)
    .eq('is_valid', true)
    .limit(10)
  
  return data
}
```

### 4. Bundle por ID

```typescript
// app/bundle/[id]/page.tsx
const getBundle = async (id: string) => {
  const { data } = await supabase
    .from('bundles')
    .select('*')
    .eq('id', id)
    .single()
  
  return data
}
```

### 5. Filtros Avançados

```typescript
// Por preço
const { data } = await supabase
  .from('bundles')
  .select('*')
  .eq('is_valid', true)
  .lte('final_price', 50.00)  // Até R$50
  .gte('discount', 40)         // Pelo menos 40% off
  .order('discount', { ascending: false })

// Por moeda
const { data } = await supabase
  .from('bundles')
  .select('*')
  .eq('currency', 'BRL')
  .eq('is_valid', true)

// Por quantidade de jogos
const { data } = await supabase
  .from('bundles')
  .select('*')
  .gte('games_count', 5)  // Pelo menos 5 jogos
  .order('games_count', { ascending: false })
```

### 6. Estatísticas

```typescript
// Dashboard stats
const getStats = async () => {
  const { count: totalBundles } = await supabase
    .from('bundles')
    .select('*', { count: 'exact', head: true })
    .eq('is_valid', true)
  
  const { count: dealsCount } = await supabase
    .from('bundles')
    .select('*', { count: 'exact', head: true })
    .gt('discount', 50)
  
  return {
    total: totalBundles,
    deals: dealsCount
  }
}
```

## 📊 Analytics e Tracking

### Incrementar Visualizações

Chame esta função quando o usuário visualizar um bundle (página de detalhes):

```typescript
// app/bundle/[id]/page.tsx
'use client'

import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'

export default function BundlePage({ params }: { params: { id: string } }) {
  useEffect(() => {
    // Incrementa view count
    trackBundleView(params.id)
  }, [params.id])
  
  const trackBundleView = async (bundleId: string) => {
    // Busca analytics existente
    const { data: existing } = await supabase
      .from('bundle_analytics')
      .select('*')
      .eq('bundle_id', bundleId)
      .single()
    
    if (existing) {
      // Incrementa view_count
      await supabase
        .from('bundle_analytics')
        .update({
          view_count: existing.view_count + 1,
          last_viewed_at: new Date().toISOString()
        })
        .eq('bundle_id', bundleId)
    } else {
      // Cria novo registro
      await supabase
        .from('bundle_analytics')
        .insert({
          bundle_id: bundleId,
          view_count: 1,
          last_viewed_at: new Date().toISOString(),
          first_tracked_at: new Date().toISOString()
        })
    }
  }
  
  // ... resto do componente
}
```

### Incrementar Cliques (Link para Steam)

Chame quando usuário clicar no botão "Ver na Steam":

```typescript
// components/BundleCard.tsx
const handleSteamClick = async (bundleId: string, url: string) => {
  // Incrementa click count
  const { data: existing } = await supabase
    .from('bundle_analytics')
    .select('total_clicks')
    .eq('bundle_id', bundleId)
    .single()
  
  if (existing) {
    await supabase
      .from('bundle_analytics')
      .update({ total_clicks: existing.total_clicks + 1 })
      .eq('bundle_id', bundleId)
  } else {
    await supabase
      .from('bundle_analytics')
      .insert({
        bundle_id: bundleId,
        total_clicks: 1
      })
  }
  
  // Abre link
  window.open(url, '_blank')
}
```

### Query Bundles com Analytics

Buscar bundles incluindo métricas:

```typescript
// app/api/bundles-with-stats/route.ts
export async function GET() {
  const { data, error } = await supabase
    .from('bundles')
    .select(`
      *,
      bundle_analytics (
        view_count,
        total_clicks,
        last_viewed_at
      )
    `)
    .eq('is_valid', true)
    .order('last_updated', { ascending: false })
    .limit(50)
  
  if (error) return Response.json({ error }, { status: 500 })
  return Response.json({ bundles: data })
}
```

### Filtro de Conteúdo +18/NSFW

Adicione controle para exibir/ocultar conteúdo adulto:

```typescript
// components/SafeSearchToggle.tsx
'use client'

import { useState } from 'react'

export default function SafeSearchToggle() {
  const [showNSFW, setShowNSFW] = useState(false)
  
  const getBundles = async () => {
    let query = supabase
      .from('bundles')
      .select('*')
      .eq('is_valid', true)
    
    if (!showNSFW) {
      query = query.eq('is_nsfw', false)
    }
    
    const { data } = await query.limit(50)
    return data
  }
  
  return (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={showNSFW}
        onChange={(e) => setShowNSFW(e.target.checked)}
      />
      <span>Exibir conteúdo +18</span>
    </label>
  )
}
```

### 7. Real-time Updates (Opcional)

```typescript
// components/LiveDeals.tsx
useEffect(() => {
  const channel = supabase
    .channel('bundles-changes')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'bundles',
        filter: 'discount=gt.50'
      },
      (payload) => {
        console.log('Novo deal:', payload.new)
        // Atualizar UI
      }
    )
    .subscribe()
  
  return () => {
    supabase.removeChannel(channel)
  }
}, [])
```

## Componentes React Exemplo

### BundleCard

```tsx
// components/BundleCard.tsx
interface BundleCardProps {
  bundle: Bundle
}

export function BundleCard({ bundle }: BundleCardProps) {
  const savings = bundle.original_price - bundle.final_price
  
  return (
    <div className="border rounded-lg p-4 hover:shadow-lg transition">
      <h3 className="font-bold text-lg mb-2">{bundle.name}</h3>
      
      <div className="flex items-center gap-2 mb-2">
        <span className="text-2xl font-bold text-green-600">
          {bundle.currency} {bundle.final_price.toFixed(2)}
        </span>
        {bundle.discount > 0 && (
          <span className="bg-red-500 text-white px-2 py-1 rounded">
            -{bundle.discount}%
          </span>
        )}
      </div>
      
      {bundle.discount > 0 && (
        <div className="text-gray-500 line-through text-sm mb-2">
          {bundle.currency} {bundle.original_price.toFixed(2)}
        </div>
      )}
      
      {!bundle.is_discount_real && (
        <div className="bg-yellow-100 text-yellow-800 text-xs p-2 rounded mb-2">
          ⚠️ {bundle.discount_analysis}
        </div>
      )}
      
      <div className="text-sm text-gray-600 mb-3">
        {bundle.games_count} jogos inclusos
      </div>
      
      <a
        href={bundle.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block w-full bg-blue-600 text-white text-center py-2 rounded hover:bg-blue-700"
      >
        Ver na Steam
      </a>
    </div>
  )
}
```

### DealsPage

```tsx
// app/deals/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { BundleCard } from '@/components/BundleCard'
import type { Bundle } from '@/lib/supabase'

export default function DealsPage() {
  const [bundles, setBundles] = useState<Bundle[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  
  useEffect(() => {
    loadBundles()
  }, [filter])
  
  const loadBundles = async () => {
    setLoading(true)
    
    let query = supabase
      .from('bundles')
      .select('*')
      .eq('is_valid', true)
    
    if (filter === 'real-deals') {
      query = query.eq('is_discount_real', true)
    }
    
    if (filter === 'high-discount') {
      query = query.gt('discount', 70)
    }
    
    query = query.order('discount', { ascending: false }).limit(50)
    
    const { data } = await query
    setBundles(data || [])
    setLoading(false)
  }
  
  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-6">Melhores Deals</h1>
      
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setFilter('all')}
          className={filter === 'all' ? 'btn-active' : 'btn'}
        >
          Todos
        </button>
        <button
          onClick={() => setFilter('real-deals')}
          className={filter === 'real-deals' ? 'btn-active' : 'btn'}
        >
          Promoções Reais
        </button>
        <button
          onClick={() => setFilter('high-discount')}
          className={filter === 'high-discount' ? 'btn-active' : 'btn'}
        >
          +70% OFF
        </button>
      </div>
      
      {loading ? (
        <div>Carregando...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {bundles.map(bundle => (
            <BundleCard key={bundle.id} bundle={bundle} />
          ))}
        </div>
      )}
    </div>
  )
}
```

## API REST Endpoints (Sem SDK)

Se preferir usar fetch/axios direto:

```typescript
// Usando API REST do Supabase
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// GET - Listar bundles
const response = await fetch(
  `${SUPABASE_URL}/rest/v1/bundles?is_valid=eq.true&order=discount.desc&limit=50`,
  {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    }
  }
)
const bundles = await response.json()

// GET - Bundle específico
const response = await fetch(
  `${SUPABASE_URL}/rest/v1/bundles?id=eq.232`,
  {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    }
  }
)
```

## Sincronização Automática

O sistema sincroniza automaticamente:

- **A cada 6 horas**: Bundles atualizados nas últimas 24h
- **Apenas válidos**: `is_valid = true`
- **Com análise de desconto**: Campo `is_discount_real` indica se é promoção legítima
- **Histórico de preços**: Últimos 30 dias inclusos

## Row Level Security (RLS)

Configure no Supabase SQL Editor:

```sql
-- Permitir leitura pública
ALTER TABLE bundles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir leitura publica"
  ON bundles
  FOR SELECT
  USING (true);

-- Bloquear escrita (apenas via Service Key do scraper)
CREATE POLICY "Bloquear escrita publica"
  ON bundles
  FOR ALL
  USING (false);
```

## Performance

- Use `.limit()` sempre para evitar queries grandes
- Cache no frontend (React Query, SWR)
- Considere usar Edge Functions para queries complexas
- Index no Supabase: `discount DESC`, `is_valid`, `last_updated DESC`

## Monitoramento

```typescript
// Verificar última atualização
const { data } = await supabase
  .from('bundles')
  .select('synced_at')
  .order('synced_at', { ascending: false })
  .limit(1)

console.log('Última sincronização:', data[0].synced_at)
```

## Troubleshooting

### Nenhum dado aparece
1. Verifique se `ENABLE_SUPABASE_SYNC=true` no `.env` do Orange Pi
2. Confirme que o cron está rodando: `docker compose logs scraper | grep sync`
3. Execute manualmente: `docker compose exec scraper python -m scraper.sync_supabase`

### Dados desatualizados
- Sincronização roda a cada 6h
- Force: `docker compose exec scraper python scripts/run_sync.py`

### Erros de permissão
- Verifique RLS policies no Supabase
- Confirme que `SUPABASE_ANON_KEY` está correta
