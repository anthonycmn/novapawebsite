-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.marketing_save_step(p_id integer, p_delay integer, p_subject text, p_body text, p_enabled boolean)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update email_sequences set delay_minutes = p_delay, subject = p_subject, body = p_body, enabled = p_enabled
  where id = p_id and is_admin();
$function$

