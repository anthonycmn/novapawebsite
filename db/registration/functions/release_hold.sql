-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: =X/postgres | postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.release_hold(p_hold_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_email text := lower(coalesce(auth.jwt()->>'email',''));
begin
  update holds set status = 'released'
  where id = p_hold_id and email = v_email and status = 'active';
end;
$function$

