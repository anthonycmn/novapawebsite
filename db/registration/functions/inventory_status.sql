-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.inventory_status()
 RETURNS TABLE(show text, band text, cap integer, remaining integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select i.show, i.band, i.cap,
         greatest(0, i.cap - i.booked - held_count(i.show, i.band)) as remaining
  from inventory i;
$function$

