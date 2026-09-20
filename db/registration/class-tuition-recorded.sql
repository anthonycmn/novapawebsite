-- Class tuition is recorded, not just deposit installments (Sep 18 2026).
--
-- NOT YET APPLIED. CJ runs this. Until he does, reg-webhook's invoice.paid
-- branch still works, it just logs class invoices as declined instead of
-- recording them, exactly as it does today.
--
-- Why. record_installment_paid was written for deposit plans and refuses
-- anything else:
--
--     if not exists (select 1 from orders where id = p_order_id
--                    and plan = 'deposit') then return false;
--
-- That was right for what it was built for and wrong as the only record of
-- money. Nothing else reads a class membership invoice: until Sep 18 the
-- webhook ignored invoice.paid entirely, and reg-balance-audit queried
-- plan=eq.deposit. Checked against Stripe on Sep 20 2026: every checkout
-- class subscription (18 orders, $1,690.00 a month) is in a trial that ends
-- Oct 1 2026, its only invoice so far the $0 trial one, so nothing has been
-- collected and nothing is missing yet. Without this function the Oct 1
-- pull would have been the first tuition ever collected and the first to go
-- unrecorded.
--
-- What changes. A class invoice now gets its row in order_installments, so
-- the money is countable. It does NOT move orders.installments_paid_cents,
-- because that column means "how much of this order's balance is paid off"
-- and monthly tuition is not paying down a balance. Adding to it would
-- corrupt every balance reader:
--
--   db/registration/portal_audit.sql line 44   the family's portal balance
--   netlify/functions/reg-balance-audit.mjs:110  the daily Stripe check
--
-- A class order has total_cents = the checkout charge, so tuition added
-- there would read as an overpayment and the portal would show a credit
-- the family does not have.
--
-- Old callers keep working: the signature is unchanged, deposit behaviour is
-- unchanged, and the return value still means "a new row was written".
--
-- Expected effect: 0 rows changed on apply (this replaces a function). The
-- first class invoice after it lands writes 1 row to public.order_installments
-- and leaves public.orders untouched.

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
  v_plan text;
  v_inserted boolean;
begin
  select plan into v_plan from orders where id = p_order_id;
  -- Not one of ours, or an order type that has no recurring money at all.
  if v_plan is null or v_plan not in ('deposit', 'subscription') then
    return false;
  end if;

  insert into order_installments (stripe_invoice, order_id, amount_cents, paid_at, stripe_schedule)
  values (p_invoice, p_order_id, p_amount_cents, coalesce(p_paid_at, now()), p_schedule)
  on conflict (stripe_invoice) do nothing;
  get diagnostics v_inserted = row_count;

  -- Only a deposit plan is paying a balance down. A class membership's
  -- monthly tuition is revenue against no balance, so the row is the whole
  -- record and the order's counter must not move.
  if v_inserted and v_plan = 'deposit' then
    update orders
       set installments_paid_cents = installments_paid_cents + p_amount_cents
     where id = p_order_id;
  end if;

  return v_inserted;
end;
$function$;

revoke all on function public.record_installment_paid(uuid, text, integer, timestamptz, text) from public, anon, authenticated;
grant execute on function public.record_installment_paid(uuid, text, integer, timestamptz, text) to service_role;
