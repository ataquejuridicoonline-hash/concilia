-- Migração aditiva para o Concilia (compatível com a versão anterior).
-- Não elimina tabelas, linhas ou colunas existentes.
BEGIN;

CREATE TABLE IF NOT EXISTS public.shopee_connections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 shop_id bigint NOT NULL UNIQUE,
 access_token_cipher text NOT NULL,
 refresh_token_cipher text NOT NULL,
 expires_at timestamptz NOT NULL,
 connected_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.shopee_auth_states (
 state_hash text PRIMARY KEY,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.shopee_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 shop_id bigint NOT NULL REFERENCES public.shopee_connections(shop_id),
 order_sn text NOT NULL,
 order_status text,
 create_time timestamptz,
 update_time timestamptz,
 buyer_total numeric(16,2),
 escrow_amount numeric(16,2),
 escrow_after_adjustment numeric(16,2),
 financial_status text NOT NULL DEFAULT 'nao_consultado',
 detail jsonb,
 last_checked_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (shop_id, order_sn)
);

-- Compatibilidade com as tabelas pré-existentes do projeto.
ALTER TABLE public.shopee_orders
 ADD COLUMN IF NOT EXISTS create_time timestamptz,
 ADD COLUMN IF NOT EXISTS update_time timestamptz,
 ADD COLUMN IF NOT EXISTS buyer_total numeric(16,2),
 ADD COLUMN IF NOT EXISTS escrow_amount numeric(16,2),
 ADD COLUMN IF NOT EXISTS escrow_after_adjustment numeric(16,2),
 ADD COLUMN IF NOT EXISTS financial_status text NOT NULL DEFAULT 'nao_consultado',
 ADD COLUMN IF NOT EXISTS detail jsonb;

-- Usa índice único para upsert por loja e número de pedido.
-- Em tabelas antigas, garante a unicidade composta exigida pelo código.
CREATE UNIQUE INDEX IF NOT EXISTS shopee_orders_shop_order_sync_uidx
 ON public.shopee_orders (shop_id, order_sn);

CREATE INDEX IF NOT EXISTS idx_shopee_orders_date
 ON public.shopee_orders (shop_id, create_time DESC);

ALTER TABLE public.shopee_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopee_auth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopee_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shopee_connections, public.shopee_auth_states, public.shopee_orders FROM anon, authenticated;
NOTIFY pgrst, 'reload schema';

COMMIT;
