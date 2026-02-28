-- Mokhtar Cell POS Pro (Supabase)

create extension if not exists pgcrypto;

-- SALES
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  category text not null,
  note text,
  amount numeric not null,
  pay_type text not null default 'cash', -- cash / debt / payout
  items jsonb not null default '[]'::jsonb,
  deleted_at timestamptz
);

-- Optional backwards-compat columns (old versions):
-- If you still have these columns, keep them nullable.
alter table public.sales
  add column if not exists item text;
alter table public.sales
  add column if not exists type text;

-- DEBTS
create table if not exists public.debts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  sale_id uuid references public.sales(id) on delete set null,
  customer_name text not null,
  customer_phone text,
  amount numeric not null,
  due_date date,
  status text not null default 'pending', -- pending / paid
  whatsapp_text text,
  paid_at timestamptz
);

-- DEVICE TOKENS (optional)
create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  token text not null,
  platform text,
  device_id text
);
