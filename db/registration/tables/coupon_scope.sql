-- Special deal codes can be scoped to specific products (Aug 18 2026).
--
-- Todd's ask from the Meta strategy meeting: a code should be restrictable
-- to one show or product, not sitewide. Without this, a pct_off_list
-- special discounts EVERY non-day-camp item in the checkout — LINCOLN10
-- was believed to be "Frozen only" while actually being cart-wide.
--
-- scope_activity_ids: catalog items (fall show casts, classes, TC shows).
-- scope_shows: summer camp items, keyed by show slug (httyd/charlie/trolls).
-- NULL/empty = unscoped (the old behavior). Items outside the scope keep
-- their normal tier/bundle/sibling pricing.
alter table public.coupons
  add column if not exists scope_activity_ids bigint[],
  add column if not exists scope_shows        text[];

update public.coupons
set scope_activity_ids = '{1959789,1959787,1959805}',
    note = 'Kristen Lincoln family (Giuliana) - 10 percent off list price on the Frozen fall show only (any cast), one checkout. They missed the launch sale window and asked for the one show rate. Works for kristen.e.lincoln@gmail.com or dlincoln525@gmail.com only. Approved by Todd Aug 18 2026, Frozen only per the strategy meeting.'
where code = 'LINCOLN10' and uses = 0;
