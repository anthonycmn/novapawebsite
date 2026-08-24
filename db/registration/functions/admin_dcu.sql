-- DC Unifieds registrations for the admin dashboard (Aug 24 2026).
-- CJ asked for DCU visibility inside the portal; these orders already live
-- in the shared orders/order_items tables (dcu-pay.mjs writes them with
-- activity ids 970601 In Person / 970602 Virtual Live / 970603 Virtual),
-- they just had no surfaced view. One jsonb result: per-track counts,
-- revenue totals, and the registration list, paid orders only.

DROP FUNCTION IF EXISTS public.admin_dcu();
CREATE OR REPLACE FUNCTION public.admin_dcu()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_admin() then return null; end if;
  return jsonb_build_object(
    'tracks', (
      select jsonb_agg(jsonb_build_object(
          'id', a.id, 'name', a.name, 'price_cents', a.price_cents,
          'seats', (select count(*) from order_items i
                    join orders o on o.id = i.order_id
                    where i.activity_id = a.id
                      and o.status in ('paid','confirmed','complete')))
        order by a.id)
      from activities a where a.id in (970601, 970602, 970603)),
    'revenue', (
      select jsonb_build_object(
          'orders', count(*),
          'committed_cents', coalesce(sum(o.total_cents), 0),
          'collected_today_cents', coalesce(sum(o.amount_today_cents), 0))
      from orders o
      where o.status in ('paid','confirmed','complete')
        and exists (select 1 from order_items i
                    where i.order_id = o.id
                      and i.activity_id in (970601, 970602, 970603))),
    'regs', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'created_at', o.created_at,
          'student', i.camper_name,
          'parent', o.parent_name,
          'email', o.email,
          'plan', o.plan,
          'status', o.status,
          'track', a.name,
          'paid_today_cents', o.amount_today_cents,
          'total_cents', o.total_cents)
        order by o.created_at desc), '[]'::jsonb)
      from order_items i
      join orders o on o.id = i.order_id
      join activities a on a.id = i.activity_id
      where i.activity_id in (970601, 970602, 970603)
        and o.status in ('paid','confirmed','complete'))
  );
end; $function$;
REVOKE EXECUTE ON FUNCTION public.admin_dcu() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_dcu() TO anon, authenticated, service_role;
