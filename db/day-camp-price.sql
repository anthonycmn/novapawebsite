-- Set every day camp to $79 (CJ, Aug 2 2026).
--
-- WHAT THIS DOES
--   Rewrites price_cents to 7900 on every one-day camp in the catalog, so the
--   registration system charges what /day-camps advertises.
--
-- HOW TO RUN
--   Paste into the Supabase SQL editor on the Registration project and Run.
--   Safe to re-run — it is idempotent, and the SELECT at the top shows you
--   exactly which rows will change before anything is written.
--
-- WHAT COUNTS AS A DAY CAMP
--   category = 'camp' AND price_cents <= 20000. That is not a guess — it is
--   the same test the live code uses to decide day camp pricing rules:
--     netlify/functions/reg-config.mjs  isDayCampItem()  (pay in full, no
--       tier/bundle discount, no tuition insurance, sibling 5% applies now)
--     netlify/functions/reg-fsa-receipt.mjs              (FSA eligibility)
--     register/index.html               dayCampsList()   (the Day Camps tab)
--   Summer camps are the same category but sit at $995, well above the
--   ceiling, so they are untouched. Shows, classes, and coaching are other
--   categories entirely and are untouched.
--
-- READ THIS BEFORE YOU RUN
--   Run step 1 on its own first and look at the list. If a row appears that
--   is NOT a one-day camp, stop and tell me rather than running step 2 —
--   the price ceiling is a heuristic, and a cheap non-day-camp row under
--   $200 would get swept up with it.

-- ── 1. What is about to change ───────────────────────────────────────────
select id, name, schedule_name, price_cents,
       (price_cents / 100.0) as price_now,
       79.00 as price_after
from activities
where category = 'camp'
  and price_cents <= 20000
  and price_cents is distinct from 7900
order by schedule_name, id;

-- ── 2. Make the change ───────────────────────────────────────────────────
update activities
set price_cents = 7900
where category = 'camp'
  and price_cents <= 20000
  and price_cents is distinct from 7900;

-- ── 3. Confirm every day camp now reads $79 ──────────────────────────────
select count(*) as day_camps,
       min(price_cents) as min_cents,
       max(price_cents) as max_cents
from activities
where category = 'camp' and price_cents <= 20000;

-- Expect min_cents = max_cents = 7900. If they differ, step 2 missed a row
-- priced above the $200 ceiling — find it with:
--   select id, name, price_cents from activities
--   where category = 'camp' and price_cents between 20001 and 50000;
