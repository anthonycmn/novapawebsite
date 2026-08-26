-- Widen the Frozen Broadway Bound Teen cast to ages 12–17 (CJ, Aug 26 2026).
--
-- WHAT THIS DOES
--   Rewrites activities.age_range on the Frozen teen cast only, so the
--   registration portal offers and labels the band the same way the website
--   now does.
--
-- WHY IT MATTERS MORE THAN A LABEL
--   register/index.html reads this column and nothing else for the fall
--   shows — there is no hardcoded age anywhere in the portal for Frozen:
--     castRange(a)  parses "12-17" out of a.age_range
--     castLabel(a)  prints  "Teens (12–17)" from that
--     defaultCastFor(showKey, age)  picks the cast whose range contains the
--       child's age, and the pill row offers any cast within one year of its
--       floor (the deliberate grace band)
--   So this one UPDATE changes what a parent is shown AND who is allowed to
--   register. Until it is run, the site advertises 12–17 and the portal will
--   still turn away a 16- or 17-year-old.
--
-- HOW TO RUN
--   Paste into the Supabase SQL editor on the Registration project and Run.
--   Idempotent, and step 1 shows exactly which rows change before any write.
--
-- READ THIS BEFORE YOU RUN
--   Run step 1 alone first. Exactly ONE row should come back, and it must be
--   the Frozen teen cast. If more than one appears, or a Little Mermaid row
--   appears, stop — Little Mermaid's teen band is deliberately still 12–15
--   and must not be swept up with this.
--
--   Step 3 is a separate question for Jason, not part of this change. Do not
--   run it blind.

-- ── 1. What is about to change ───────────────────────────────────────────
select id, name, schedule_name, category, bookable,
       age_range as age_range_now,
       '12-17'   as age_range_after
from activities
where name ~* 'frozen'
  and name !~* 'tech'
  and (name ~* 'teen' or schedule_name ~* 'teen')
order by id;

-- ── 2. Make the change ───────────────────────────────────────────────────
update activities
   set age_range = '12-17'
 where name ~* 'frozen'
   and name !~* 'tech'
   and (name ~* 'teen' or schedule_name ~* 'teen')
   and age_range is distinct from '12-17';

-- ── 3. For Jason, before or after: the hardcoded 18 ───────────────────────
--   register/index.html castTop() carries a one-off override:
--
--     function castTop(a){ return a.id === 1959805 ? 18 : castRange(a).max; }
--
--   It admits activity 1959805 through age 18 while still PRINTING the range
--   from age_range. If 1959805 is this Frozen teen cast, the override is now
--   redundant at best and a silent 18th-year admission at worst, and should
--   come out of the code. This tells you which activity it is:
select id, name, schedule_name, category, age_range, bookable
from activities
where id = 1959805;

-- ── 4. Confirm ───────────────────────────────────────────────────────────
select id, name, schedule_name, age_range
from activities
where name ~* 'frozen' or name ~* 'mermaid'
order by name, id;
--   Expected after step 2: every Frozen teen row reads 12-17, and every
--   Little Mermaid teen row still reads 12-15.
