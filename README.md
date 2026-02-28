# Mokhtar POS Pro Blue

This is a small Next.js POS + Dashboard for Mokhtar Cell.

## 1) Install

```bash
npm install
npm run dev
```

Create `.env.local` from `.env.example`.

## 2) Supabase SQL (IMPORTANT)

If you got errors like:
- `Could not find the 'pay_type' column of 'sales'...`
- `null value in column "item" violates not-null constraint`
- `null value in column "type" violates not-null constraint`

Run this in **Supabase → SQL Editor**.

⚠️ Important: **Copy ONLY the SQL inside the code block** (do not copy the text above/below).

```sql
create extension if not exists pgcrypto;

-- SALES: make sure the new columns exist
alter table public.sales
  add column if not exists pay_type text;

alter table public.sales
  add column if not exists items jsonb not null default '[]'::jsonb;

alter table public.sales
  add column if not exists deleted_at timestamptz;

-- If you still have old columns, make them safe (nullable) so POS can work
alter table public.sales
  add column if not exists item text;

alter table public.sales
  add column if not exists type text;

-- Drop NOT NULL on old item/type if they exist
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='sales' and column_name='item'
  ) then
    begin
      execute 'alter table public.sales alter column item drop not null';
    exception when others then
      -- ignore
    end;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='sales' and column_name='type'
  ) then
    begin
      execute 'alter table public.sales alter column type drop not null';
    exception when others then
      -- ignore
    end;
  end if;
end $$;

-- Set pay_type default + NOT NULL
update public.sales
set pay_type = coalesce(pay_type, type, 'cash');

alter table public.sales
  alter column pay_type set default 'cash';

alter table public.sales
  alter column pay_type set not null;

-- Ensure sales table exists (only if you don't have it yet)
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  category text not null,
  note text,
  amount numeric not null,
  pay_type text not null default 'cash',
  items jsonb not null default '[]'::jsonb,
  deleted_at timestamptz
);

-- DEBTS: reminders + WhatsApp + paid status
alter table public.debts
  add column if not exists customer_name text;

alter table public.debts
  add column if not exists customer_phone text;

alter table public.debts
  add column if not exists due_date date;

alter table public.debts
  add column if not exists status text default 'pending';

alter table public.debts
  add column if not exists whatsapp_text text;

alter table public.debts
  add column if not exists paid_at timestamptz;

alter table public.debts
  add column if not exists paid_amount numeric not null default 0;

alter table public.debts
  add column if not exists sale_id uuid;

alter table public.debts
  add column if not exists note text;

-- Ensure debts table exists (only if you don't have it yet)
create table if not exists public.debts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  customer_name text not null,
  customer_phone text not null,
  amount numeric not null,
  paid_amount numeric not null default 0,
  paid_at timestamptz,
  status text not null default 'pending',
  sale_id uuid,
  note text,
  due_date date,
  whatsapp_text text
);

-- If customer_name is nullable in your old table, you can keep it,
-- but the app expects it for debts.
```

## 3) Features

- **Sales (POS)**: quick categories, quick items, custom item entry, cart, cash/debt/payout.
- **Debt**: customer name + phone + due date.
- **Reminders**: Pending/Paid lists, copy WhatsApp message, open WhatsApp, mark paid.
- **Delete after Pay**: a sale is soft-deleted (sets `deleted_at`) so it can still be included in reports later.

