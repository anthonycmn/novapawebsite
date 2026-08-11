-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.admin_orders()
 RETURNS TABLE(id uuid, created_at timestamp with time zone, email text, parent_name text, plan text, amount_today_cents integer, total_cents integer, status text, sawyer_entered boolean, items text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_admin() then return; end if;
  return query select o.id, o.created_at, o.email, o.parent_name, o.plan, o.amount_today_cents, o.total_cents, o.status, o.sawyer_entered,
    (select string_agg(i.camper_name || ' \u00b7 ' || coalesce((select a.name from activities a where a.id = i.activity_id), initcap(coalesce(i.show,'')) || ' ' || coalesce(i.band,'')), ' | ')
     from order_items i where i.order_id = o.id)
  from orders o order by o.created_at desc limit 200;
end; $function$

