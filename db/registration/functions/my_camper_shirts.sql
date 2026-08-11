-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.my_camper_shirts()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_object_agg(name, ts), '{}'::jsonb) from (
    select c.name, max(c.profile->>'tshirt') ts
    from campers c
    where c.family_id = my_family_id() and c.profile->>'tshirt' is not null
    group by c.name
  ) t;
$function$

