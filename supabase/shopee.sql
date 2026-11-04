-- Execute no projeto Supabase usado pela Vercel, no SQL Editor.
create table if not exists public.shopee_connections(
 shop_id bigint primary key,
 access_token_cipher text not null,
 refresh_token_cipher text not null,
 expires_at timestamptz not null,
 connected_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.shopee_auth_states(
 state_hash text primary key,
 expires_at timestamptz not null,
 created_at timestamptz not null default now()
);
create table if not exists public.shopee_orders(
 shop_id bigint not null references public.shopee_connections(shop_id),
 order_sn text not null,
 order_status text,
 create_time timestamptz,
 update_time timestamptz,
 buyer_total numeric(16,2),
 escrow_amount numeric(16,2),
 escrow_after_adjustment numeric(16,2),
 financial_status text not null default 'nao_consultado',
 detail jsonb,
 last_checked_at timestamptz default now(),
 primary key(shop_id,order_sn)
);
create index if not exists idx_shopee_orders_date on public.shopee_orders(shop_id,create_time desc);
alter table public.shopee_connections enable row level security;
alter table public.shopee_auth_states enable row level security;
alter table public.shopee_orders enable row level security;
revoke all on public.shopee_connections,public.shopee_auth_states,public.shopee_orders from anon,authenticated;
notify pgrst,'reload schema';
