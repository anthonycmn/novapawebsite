-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: postgres=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.mark_fee_paid(p_email text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update families set fee_paid_at = now()
  where lower(email) = lower(p_email)
     or lower(coalesce(cc_email,'')) = lower(p_email);
$function$

