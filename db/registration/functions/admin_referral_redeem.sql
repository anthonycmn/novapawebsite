-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.admin_referral_redeem(p_id uuid, p_side text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  if p_side = 'referrer' then
    update referral_rewards set referrer_redeemed_at = coalesce(referrer_redeemed_at, now()) where id = p_id;
  elsif p_side = 'referred' then
    update referral_rewards set referred_redeemed_at = coalesce(referred_redeemed_at, now()) where id = p_id;
  else
    raise exception 'bad side';
  end if;
end $function$

