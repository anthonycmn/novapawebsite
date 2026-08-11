-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.my_camper_birthdates()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_object_agg(name, bd), '{}'::jsonb) from (
    select c.name, max(c.birthdate) bd
    from campers c
    where c.family_id = my_family_id() and c.birthdate is not null
    group by c.name
  ) t;
$function$

