-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- Aug 12 2026: items changed from one aggregated string (which also had a
-- literal '·' — a JS escape pasted into SQL, visible to Todd) to a jsonb
-- array with item ids, so the Orders page can link campers to their profiles
-- and offer per-seat move/cancel right on the order row.

DROP FUNCTION IF EXISTS public.admin_orders();
CREATE OR REPLACE FUNCTION public.admin_orders()
 RETURNS TABLE(id uuid, created_at timestamp with time zone, email text, parent_name text, plan text, amount_today_cents integer, total_cents integer, status text, sawyer_entered boolean, items jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_admin() then return; end if;
  return query select o.id, o.created_at, o.email, o.parent_name, o.plan, o.amount_today_cents, o.total_cents, o.status, o.sawyer_entered,
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
