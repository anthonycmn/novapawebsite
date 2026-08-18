-- Special deal terms move onto the coupons row (Aug 18 2026).
--
-- Percent-off-list, plan-fee waivers and stretched schedules used to live in
-- SPECIAL_PLANS, a hardcoded map in reg-config.mjs — every Todd/CJ-approved
-- family deal meant a code edit and a deploy (SOK20, ANSELL0, SMITH20 in
-- three weeks). With the terms on the row, honoring a deal is one INSERT,
-- and the admin dashboard can grow a form for it.
--
-- reg-pay reads these with the SERVICE role, never through check_coupon —
-- check_coupon is anon-callable and email_lock must not leak to browsers.
-- The SPECIAL_PLANS map still wins when both exist (legacy codes stay
-- exactly as shipped).
alter table public.coupons
  add column if not exists email_lock     text[],   -- family addresses allowed to use the code; null = unlocked
  add column if not exists pct_off_list   integer,  -- flat % off LIST price, replacing tier/bundle/sibling math
  add column if not exists waive_plan_fee boolean,  -- no 5% payment plan fee
  add column if not exists plan_months    integer;  -- stretched schedule: exactly N monthly firsts

alter table public.coupons
  add constraint coupons_pct_off_list_range
    check (pct_off_list is null or (pct_off_list > 0 and pct_off_list <= 100)),
  add constraint coupons_plan_months_range
    check (plan_months is null or (plan_months > 0 and plan_months <= 24));
