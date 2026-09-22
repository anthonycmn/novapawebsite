-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- Aug 12 2026: families/campers counts exclude is_test families (Jason's
-- jason@novapa.org preview account must never move the real numbers).
-- Sep 21 2026: web_booked_value_cents counts a class order (plan
-- 'subscription') at its order_items.unit_price_cents, not orders.total_cents.
-- A class bills by the month, so total_cents is only the checkout charge and
-- is 0 when the first month was free; six such orders carried $0 against
-- $60-$90 a month of tuition (15260, 15253, 15203, 15200, 15192, 15173).
-- NOT YET APPLIED to the live DB: apply through the Supabase MCP on CJ's go,
-- then note the date here. Expected effect: replaces a function, 0 rows change.

CREATE OR REPLACE FUNCTION public.admin_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'web_orders', (select count(*) from orders),
    'web_collected_cents', (select coalesce(sum(amount_today_cents),0) from orders),
    'web_booked_value_cents', (select coalesce(sum(case when o.plan = 'subscription'
        then (select coalesce(sum(i.unit_price_cents),0) from order_items i where i.order_id = o.id)
        else o.total_cents end),0) from orders o),
    'web_orders_7d', (select count(*) from orders where created_at > now() - interval '7 days'),
    'regpack_collected_cents', (select coalesce(sum(final_amount_cents),0) from platform_payments where source='regpack' and status='approved'),
    'regpack_outstanding_cents', (select coalesce(sum(balance_cents),0) from platform_balances where source='regpack'),
    'regpack_outstanding_count', (select count(*) from platform_balances where source='regpack' and balance_cents > 0),
    'sawyer_collected_cents', (select coalesce(sum(amount_cents),0) from platform_payments where source='sawyer'),
    'sawyer_outstanding_cents', (select coalesce(sum(balance_cents),0) from platform_balances where source='sawyer'),
    'sawyer_outstanding_count', (select count(*) from platform_balances where source='sawyer' and balance_cents > 0),
    'sawyer_due_now_cents', (select coalesce(sum(due_now_cents),0) from platform_balances where source='sawyer'),
    'regpack_due_now_cents', (select coalesce(sum(due_now_cents),0) from platform_balances where source='regpack'),
    'families', (select count(*) from families where not is_test),
    'campers', (select count(*) from campers c join families f on f.id = c.family_id where not f.is_test),
    'waitlist', (select count(*) from waitlist),
    'summer_taken', (select coalesce(sum(booked),0) from inventory),
    'summer_cap', (select coalesce(sum(cap),0) from inventory),
    'active_holds', (select count(*) from holds where status='active' and expires_at > now())
  );
end;
$function$
