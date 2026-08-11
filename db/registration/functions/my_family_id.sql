-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.my_family_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select id from (
    select id, 1 as pri from families
     where lower(email) = lower(coalesce(auth.jwt()->>'email',''))
    union all
    select id, 2 from families
     where lower(coalesce(cc_email,'')) = lower(coalesce(auth.jwt()->>'email',''))
  ) t order by pri limit 1;
$function$

