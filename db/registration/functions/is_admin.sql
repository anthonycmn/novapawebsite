-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres
--
-- HARDENED 2026-08-27, same day as the my_family_id() privacy incident. That
-- bug was an anonymous caller's blank email matching a blank column. This
-- function had the same shape: a single stray empty-string row in
-- admin_emails would have made every anonymous visitor an admin. An empty
-- JWT email is now false before any row is consulted.

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select nullif(lower(coalesce(auth.jwt()->>'email','')), '') is not null
     and exists(
       select 1 from admin_emails
        where email = nullif(lower(coalesce(auth.jwt()->>'email','')), '')
     );
$function$
