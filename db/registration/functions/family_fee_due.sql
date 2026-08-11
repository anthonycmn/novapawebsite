-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.family_fee_due(p_email text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select fee_paid_at is null or fee_paid_at < now() - interval '1 year'
                   from families
                   where lower(email) = lower(p_email)
                      or lower(coalesce(cc_email,'')) = lower(p_email)
                   order by (lower(email) = lower(p_email)) desc
                   limit 1), true);
$function$

