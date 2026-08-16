-- اختياري عند الانتقال من JSON إلى Supabase/Postgres.
create table if not exists public.orders (
  id text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'new',
  sku text not null,
  name text not null,
  phone text not null,
  city text not null,
  district text not null,
  address text not null,
  quantity integer not null default 1,
  total numeric(10,2) not null,
  currency text not null default 'SAR',
  payment text not null default 'COD',
  source text,
  medium text,
  campaign text,
  content text,
  term text,
  landing_page text,
  customer_note text,
  admin_note text,
  confirmed_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz
);
create index if not exists orders_phone_idx on public.orders(phone);
create index if not exists orders_status_idx on public.orders(status);
create index if not exists orders_created_idx on public.orders(created_at desc);
