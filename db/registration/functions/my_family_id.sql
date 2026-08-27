-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres
--
-- FIXED 2026-08-27 (privacy incident). The previous version compared
--   lower(coalesce(cc_email,'')) = lower(coalesce(auth.jwt()->>'email',''))
-- so an ANONYMOUS caller (no email claim) reduced both sides to '' and matched
-- every family whose cc_email is null (744 of them). Postgres returned an
-- arbitrary one, always the same row in practice, and guest checkouts wrote
-- campers into that stranger's family. Now an empty JWT email resolves to NULL.

CREATE OR REPLACE FUNCTION public.my_family_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with me as (
    select nullif(lower(coalesce(auth.jwt()->>'email','')), '') as e
  )
  select t.id from (
    select f.id, 1 as pri
      from families f, me
     where me.e is not null and lower(f.email) = me.e
    union all
    select f.id, 2
      from families f, me
     where me.e is not null and lower(coalesce(f.cc_email,'')) = me.e
  ) t order by t.pri limit 1;
$function$
