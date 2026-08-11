-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.ensure_my_family()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_email text;
begin
  v_email := lower(coalesce(auth.jwt()->>'email',''));
  if v_email = '' then return; end if;
  -- an alias (cc_email) sign-in must NOT create a second, empty family
  insert into families (email, source)
    select v_email, 'web'
    where not exists (select 1 from families
                      where lower(email) = v_email
                         or lower(coalesce(cc_email,'')) = v_email);
end $function$

