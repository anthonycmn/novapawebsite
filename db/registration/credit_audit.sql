-- Day camp credit audit (Sep 21 2026).
--
-- Why this exists. A Day Camp Pack is $349 of credits bought for one named
-- child. The money is recorded in three different places and only one of them
-- is what a family can actually spend:
--
--   public.credit_events    the ledger, one row per payment intent, keyed by
--                           the payer's EMAIL and the camper's NAME
--   public.campers          the balance, day_camp_credits / snow_day_credits,
--                           keyed by camper id
--   the parent portal       reads the balance through
--                           family_hub.students.camper_id, and by nothing else
--
-- apply_credit_events() walks from the first to the second by resolving
-- lower(email) to ONE families row and then matching lower(name) inside it.
-- Every join in that path is soft. A household where two parents each checked
-- out under their own address is two families rows and two campers rows for
-- one child, so a grant can land on the half the portal does not read, and
-- nothing in the system says so. On Sep 10 2026 the Skelton family bought a
-- pack under one parent's address; the ledger names that household and the
-- balance sits in the other one. Nobody noticed for eleven days, because the
-- daily audit looked at enrollments and balances and never at credits.
--
-- reg-balance-audit.mjs calls this every morning. Three kinds, most severe
-- first:
--
--   credits_not_in_portal        a camper holds credits and no portal student
--                                carries that camper id. The family paid and
--                                cannot see or spend it. This is the one that
--                                costs a family money.
--   grant_landed_nowhere         the ledger granted a household credits, the
--                                name it used matches no camper there, and the
--                                household holds nothing. The grant evaporated.
--                                This is the shape of the Sep 13 2026 "i0"/"i1"
--                                cart-key bug, which is why the guard is the
--                                household holding nothing: a grant that was
--                                later repaired by a second, correctly named
--                                grant must not report forever.
--   grant_household_holds_none   the camper row exists in the household the
--                                ledger names, and no camper there holds any
--                                credit. The money went to a duplicate
--                                household for the same child. Clears when the
--                                duplicate campers are merged.
--
-- Matching by name here is reading the ledger on its own terms: credit_events
-- has no camper id to join on, which is the defect this audit exists to catch.
-- It is NOT the portal-to-register join, which is camper_id and stays that way.
--
-- Test families (public.families.is_test) are skipped, the same as
-- registration_portal_audit().
--
-- The durable fix is upstream and is not this function's job: give
-- credit_events a camper_id at grant time so apply_credit_events never has to
-- guess. See the proposal in the pull request that added this file.

create or replace function public.credit_audit()
returns table(kind text, email text, camper text, detail text)
language sql
security definer
set search_path to 'public', 'family_hub'
as $function$
with real_fam as (
  select f.id, lower(f.email) as email
  from public.families f
  where coalesce(f.is_test, false) = false
),
bal as (
  select c.id, c.family_id, c.name,
         coalesce(c.day_camp_credits, 0) as day,
         coalesce(c.snow_day_credits, 0) as snow
  from public.campers c
  join real_fam f on f.id = c.family_id
  where coalesce(c.day_camp_credits, 0) > 0
     or coalesce(c.snow_day_credits, 0) > 0
),
grants as (
  select lower(ce.email) as email,
         g->>'camper' as camper,
         sum(coalesce((g->>'day')::int, 0)) as day,
         sum(coalesce((g->>'snow')::int, 0)) as snow
  from public.credit_events ce,
       jsonb_array_elements(coalesce(ce.detail->'grants', '[]'::jsonb)) g
  where nullif(trim(g->>'camper'), '') is not null
  group by 1, 2
)
-- 1. credits a family owns and the parent portal cannot reach
select 'credits_not_in_portal', f.email, b.name,
       b.day::text || ' day, ' || b.snow::text || ' snow on camper ' || b.id::text ||
       ', no parent portal student carries that camper id'
from bal b
join real_fam f on f.id = b.family_id
where not exists (select 1 from family_hub.students s where s.camper_id = b.id)
union all
-- 2. a grant that matched no camper and was never repaired
select 'grant_landed_nowhere', g.email, g.camper,
       'ledger granted ' || g.day::text || ' day, ' || g.snow::text ||
       ' snow; no camper of that name in this household and the household holds no credit'
from grants g
join real_fam f on f.email = g.email
where (g.day > 0 or g.snow > 0)
  and not exists (
    select 1 from public.campers c
    where c.family_id = f.id and lower(c.name) = lower(g.camper))
  and not exists (select 1 from bal b where b.family_id = f.id)
union all
-- 3. the household that paid holds nothing, so a duplicate household has it
select 'grant_household_holds_none', g.email, g.camper,
       'ledger granted ' || g.day::text || ' day, ' || g.snow::text ||
       ' snow and this household holds none; look for a duplicate camper under the other parent''s address'
from grants g
join real_fam f on f.email = g.email
where (g.day > 0 or g.snow > 0)
  and exists (
    select 1 from public.campers c
    where c.family_id = f.id and lower(c.name) = lower(g.camper))
  and not exists (select 1 from bal b where b.family_id = f.id)
$function$;

revoke all on function public.credit_audit() from public, anon, authenticated;
grant execute on function public.credit_audit() to service_role;
