-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.admin_referrals()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', r.id, 'code', r.ref_code,
    'referrer_email', r.referrer_email,
    'referrer_name', (select parent_name from families f where lower(f.email) = lower(r.referrer_email) limit 1),
    'referred_email', r.referred_email,
    'referred_name', (select parent_name from families f where lower(f.email) = lower(r.referred_email) limit 1),
    'status', r.status,
    'referrer_redeemed_at', r.referrer_redeemed_at,
    'referred_redeemed_at', r.referred_redeemed_at,
    'created_at', r.created_at) order by r.created_at desc) from referral_rewards r), '[]'::jsonb);
end $function$

