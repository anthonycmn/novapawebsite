-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: postgres=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.redeem_coupon(p_code text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update coupons set uses = uses + 1
  where lower(code) = lower(btrim(p_code));
$function$

