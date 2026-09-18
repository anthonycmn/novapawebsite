-- Installment payments, written back to the order (Sep 11 2026).
--
-- A deposit-plan order records what was charged at checkout in
-- `amount_today_cents` and the rest is collected by a Stripe subscription
-- schedule that this database never heard from again. Every reader that
-- worked out "what does this family still owe" as total − amount_today was
-- therefore right on the day of purchase and wrong from the first installment
-- on. Found when Alida Perez (order 15214) paid her second $364.87 on Sep 4
-- and the parent portal went on showing it as due for a week.
--
-- `amount_today_cents` keeps its meaning — the checkout charge, the figure the
-- weekly report sums by order date — so the installments land in their own
-- column and their own table:
--
--   order_installments         one row per paid Stripe invoice, keyed by the
--                              invoice id so a redelivered webhook is a no-op
--   orders.installments_paid_cents
--                              running total, maintained by
--                              record_installment_paid and nothing else
--
-- Balance is now total − amount_today − installments_paid, everywhere.
-- /api/reg-webhook calls record_installment_paid on invoice.paid.

alter table public.orders
  add column if not exists installments_paid_cents integer not null default 0;

create table if not exists public.order_installments (
  stripe_invoice   text primary key,
  order_id         uuid not null references public.orders(id) on delete cascade,
  amount_cents     integer not null check (amount_cents >= 0),
  paid_at          timestamptz not null default now(),
  stripe_schedule  text,
  created_at       timestamptz not null default now()
);
create index if not exists order_installments_order_idx
  on public.order_installments (order_id);

alter table public.order_installments enable row level security;
-- Service role only. No policy = no anon/authenticated access; the parent
-- portal reads the order's running total, never this table.
revoke all on public.order_installments from anon, authenticated;

-- Records one paid invoice against an order. Returns true when the row was
-- new (and the order total moved), false when Stripe sent it again.
create or replace function public.record_installment_paid(
  p_order_id uuid,
  p_invoice text,
  p_amount_cents integer,
  p_paid_at timestamptz default now(),
  p_schedule text default null
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_inserted boolean;
begin
  -- Only orders sold as deposit-now, balance-later carry a balance to pay
  -- down. A class membership's monthly tuition is not an installment of
  -- anything, so it is not recorded here.
  if not exists (select 1 from orders where id = p_order_id and plan = 'deposit') then
    return false;
  end if;
  insert into order_installments (stripe_invoice, order_id, amount_cents, paid_at, stripe_schedule)
  values (p_invoice, p_order_id, p_amount_cents, coalesce(p_paid_at, now()), p_schedule)
  on conflict (stripe_invoice) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted then
    update orders
       set installments_paid_cents = installments_paid_cents + p_amount_cents
     where id = p_order_id;
  end if;
  return v_inserted;
end;
$function$;

revoke all on function public.record_installment_paid(uuid, text, integer, timestamptz, text) from public, anon, authenticated;
grant execute on function public.record_installment_paid(uuid, text, integer, timestamptz, text) to service_role;
