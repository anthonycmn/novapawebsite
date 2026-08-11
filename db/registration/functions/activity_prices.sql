-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.activity_prices(p_ids bigint[])
 RETURNS TABLE(id bigint, price_cents integer, category text, bb_gated boolean, name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select id, price_cents, category, bb_gated, name from activities where id = any(p_ids);
$function$

