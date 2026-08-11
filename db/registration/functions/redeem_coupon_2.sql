-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.redeem_coupon(p_code text, p_applied_cents integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update coupons
     set uses = uses + 1,
         balance_cents = case when balance_cents is null then null
                              else greatest(0, balance_cents - coalesce(p_applied_cents, balance_cents)) end
   where lower(code) = lower(btrim(p_code));
$function$

