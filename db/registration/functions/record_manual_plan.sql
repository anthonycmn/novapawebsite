-- record_manual_plan: give a hand-built Stripe plan a row in public.orders.
--
-- Why this exists (Sep 21, 2026). CJ builds payment plans by hand in the
-- Stripe dashboard for families the checkout cannot price: a multi-show
-- season, a sibling discount, a plan renegotiated mid-year. Those plans
-- collect real money and appear in no table this company owns. The Johansen
-- season is the worked example: $1,181.50 for Frozen and The Little Mermaid
-- at 15 percent off, $375.00 already paid, six pulls of $125.00 from
-- sub_1UGevUGWP2ZbtaszV8Bd4eAI. Two things break as a result:
--
--   1. The receivable understates by $806.50, because "outstanding" is
--      computed from public.orders and there is no row.
--   2. The NOVA PA Parent Portal cannot show her the payment countdown she
--      was promised in writing, because the portal reads the orders table.
--
-- Why confirm_order could not be reused. confirm_order takes p_hold_id and
-- works outward from a seat hold: it reads holds.items, flips the hold to
-- confirmed, and decrements inventory and activities.sold per item. A
-- hand-built plan has no hold, and its seat was arranged by hand and is
-- already counted, so running that path would double count the seat and
-- oversell the show against itself.
--
-- What this function deliberately does NOT do:
--
--   * It never touches inventory, activities.sold, holds, or seat_offers.
--     The seat is already booked by whatever arrangement created the plan.
--     HOUSE-RULES: spots left is capacity minus sold minus booked_offline
--     minus holds, and a phantom decrement here is invisible and permanent.
--   * It never moves money. It records a plan that already exists in Stripe.
--   * It never writes family_hub. The 15-minute sync owns that side and will
--     pick the order up the same way it picks up a checkout order.
--
-- plan must be 'deposit' or 'subscription', and the difference matters more
-- than it looks. record_installment_paid only pays a balance down when the
-- plan is 'deposit'; for 'subscription' it records the invoice as revenue
-- against no balance. A hand-built season that a family is paying off is
-- 'deposit'. A hand-built monthly class membership is 'subscription'.
-- Choosing wrong means the portal countdown never moves.
--
-- Idempotency rides on orders.stripe_payment_intent, which is UNIQUE. There
-- is no payment intent for a hand-built plan, so the row carries the synthetic
-- key 'manual_' || p_stripe_subscription. That matches the conventions already
-- in the table: comped orders use 'free_' and saved-card class orders use the
-- setup intent 'seti_'. Calling this twice for the same subscription returns
-- the same order id and changes nothing.
--
-- IMPORTANT, and it is half the job. This function is not enough on its own.
-- reg-webhook.mjs resolves an invoice to an order through
-- orderIdForInvoice(), which reads sub.metadata.order_id (then the schedule's
-- metadata), NOT orders.stripe_schedule. So after calling this, write the
-- returned uuid onto the Stripe subscription as metadata.order_id, or every
-- future pull on that plan still records nowhere. See MANUAL-PLANS.md.

CREATE OR REPLACE FUNCTION public.record_manual_plan(
  p_email                text,
  p_parent_name          text,
  p_plan                 text,
  p_amount_today_cents   integer,
  p_total_cents          integer,
  p_installment_cents    integer,
  p_stripe_customer      text,
  p_stripe_subscription  text,
  p_items                jsonb
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order_id uuid;
  v_key      text;
  it         jsonb;
begin
  if p_plan not in ('deposit', 'subscription') then
    raise exception 'record_manual_plan: plan must be deposit or subscription, got %', p_plan;
  end if;
  if p_stripe_subscription is null or p_stripe_subscription = '' then
    raise exception 'record_manual_plan: p_stripe_subscription is required, it is the idempotency key';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'record_manual_plan: p_items must be a non-empty json array';
  end if;

  v_key := 'manual_' || p_stripe_subscription;

  -- Already recorded: hand back the same row rather than minting a second
  -- order number for one family.
  select id into v_order_id from orders where stripe_payment_intent = v_key;
  if v_order_id is not null then
    return v_order_id;
  end if;

  insert into orders (email, parent_name, hold_id, plan,
                      amount_today_cents, total_cents, installment_cents,
                      stripe_payment_intent, stripe_customer, stripe_schedule)
  values (lower(p_email), p_parent_name, null, p_plan,
          p_amount_today_cents, p_total_cents, p_installment_cents,
          v_key, p_stripe_customer, p_stripe_subscription)
  returning id into v_order_id;

  -- Line items only. No inventory, no activities.sold, no holds: see header.
  for it in select * from jsonb_array_elements(p_items) loop
    insert into order_items (order_id, show, band, camper_name, unit_price_cents, activity_id)
    values (v_order_id,
            it->>'show',
            it->>'band',
            coalesce(it->>'camper', 'TBD'),
            coalesce((it->>'unit_price_cents')::int, 0),
            (it->>'activity_id')::bigint);
  end loop;

  return v_order_id;
end;
$function$;

-- Same ACL shape as confirm_order: the service role calls it, nobody else.
REVOKE ALL ON FUNCTION public.record_manual_plan(text, text, text, integer, integer, integer, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_manual_plan(text, text, text, integer, integer, integer, text, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.record_manual_plan(text, text, text, integer, integer, integer, text, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_manual_plan(text, text, text, integer, integer, integer, text, text, jsonb) TO service_role;
