-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- Aug 12 2026: p_undo added after an accidental mark-redeemed in the admin —
-- undo clears the side's timestamp so the tickets become available again.

CREATE OR REPLACE FUNCTION public.admin_referral_redeem(p_id uuid, p_side text, p_undo boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  if p_side = 'referrer' then
    update referral_rewards
      set referrer_redeemed_at = case when p_undo then null else coalesce(referrer_redeemed_at, now()) end
      where id = p_id;
  elsif p_side = 'referred' then
    update referral_rewards
      set referred_redeemed_at = case when p_undo then null else coalesce(referred_redeemed_at, now()) end
      where id = p_id;
  else
    raise exception 'bad side';
  end if;
end $function$;
REVOKE EXECUTE ON FUNCTION public.admin_referral_redeem(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_referral_redeem(uuid, text, boolean) TO anon, authenticated, service_role;
