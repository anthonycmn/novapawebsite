-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- Aug 12 2026: items changed from one aggregated string (which also had a
-- literal '·' — a JS escape pasted into SQL, visible to Todd) to a jsonb
-- array with item ids, so the Orders page can link campers to their profiles
-- and offer per-seat move/cancel right on the order row.
-- Sep 21 2026: value_cents added. A class order (plan 'subscription') bills by
-- the month, so total_cents is only the checkout charge and reads $0 when the
-- first month was free; value_cents is the sum of its order_items.unit_price_cents
-- instead, and simply total_cents for every other plan. total_cents itself is
-- left as-is because the balance readers depend on its meaning.
-- NOT YET APPLIED to the live DB: apply through the Supabase MCP on CJ's go,
-- then note the date here. The Orders tab falls back to total_cents until then.

DROP FUNCTION IF EXISTS public.admin_orders();
CREATE OR REPLACE FUNCTION public.admin_orders()
 RETURNS TABLE(id uuid, created_at timestamp with time zone, email text, parent_name text, plan text, amount_today_cents integer, total_cents integer, value_cents integer, status text, sawyer_entered boolean, items jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_admin() then return; end if;
  return query select o.id, o.created_at, o.email, o.parent_name, o.plan, o.amount_today_cents, o.total_cents,
    (case when o.plan = 'subscription'
          then (select coalesce(sum(i.unit_price_cents),0) from order_items i where i.order_id = o.id)
          else o.total_cents end)::integer,
    o.status, o.sawyer_entered,
    (select jsonb_agg(jsonb_build_object(
        'item_id', i.id,
        'camper', i.camper_name,
        'what', coalesce((select a.name from activities a where a.id = i.activity_id),
                         initcap(coalesce(i.show,'')) || ' ' || coalesce(i.band,''))))
     from order_items i where i.order_id = o.id)
  from orders o order by o.created_at desc limit 200;
end; $function$;
REVOKE EXECUTE ON FUNCTION public.admin_orders() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_orders() TO anon, authenticated, service_role;
