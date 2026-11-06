CREATE TABLE IF NOT EXISTS public.shopee_releases (shop_id bigint NOT NULL REFERENCES public.shopee_connections(shop_id), order_sn text NOT NULL, released_amount numeric(16,2) NOT NULL, released_at timestamptz NOT NULL, source text NOT NULL DEFAULT 'shopee_get_escrow_list', checked_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(shop_id,order_sn));
CREATE INDEX IF NOT EXISTS shopee_releases_date_idx ON public.shopee_releases(shop_id,released_at DESC);
ALTER TABLE public.shopee_releases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shopee_releases FROM anon,authenticated;
NOTIFY pgrst, 'reload schema';