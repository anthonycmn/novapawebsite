-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.check_coupon(p_code text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select (select jsonb_build_object(
            'code', code,
            'pct', case when balance_cents is null then pct else null end,
            'amount_cents', coalesce(balance_cents, amount_cents),
            'is_credit', balance_cents is not null)
          from coupons
          where lower(code) = lower(btrim(p_code)) and active
            and (expires_at is null or expires_at > now())
            and (max_uses is null or uses < max_uses)
            and (balance_cents is null or balance_cents > 0)
          limit 1);
$function$

