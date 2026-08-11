-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: postgres=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.set_order_schedule(p_order_id uuid, p_schedule text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update orders set stripe_schedule = p_schedule where id = p_order_id;
$function$

