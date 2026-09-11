-- Count free class trials alongside enrolments.
--
-- Phase 2 of the trial-seats work. Phase 1 (db/free-class-activity-link.sql)
-- attached each trial to its listing; this is the first thing that reads it.
--
-- Two facts decide the shape of everything below:
--
--   1. A trial is a visit to ONE session, on one date. An enrolment is for the
--      whole term. They are not the same unit, so a trial must never be
--      subtracted from what a paying family can buy: six one-day visitors on
--      Sep 15 would otherwise block six season enrolments. catalog_list's
--      `remaining` is therefore unchanged. Paid always wins.
--
--   2. What a trial CAN do is fill the room on its own date. CJ's rule
--      (10 Sep 2026): a trial may not take a seat in a full class. So the
--      free-class function checks, for the date being booked,
--
--          seats = least(FREE_SEATS_PER_DATE - trials_that_date,
--                        room_left           - trials_that_date)
--
--      clamped at zero, where room_left is exactly the public page's figure.
--      A full class yields zero and the trial is refused. The six-per-date ops
--      cap and the room's real capacity reconcile as the smaller of the two.
--
-- Both systems read the same view, so they cannot disagree later.
--
-- Run order: after Phase 1, any time. Nothing here changes a table.
-- Idempotent: safe to run twice.

begin;

-- ---------------------------------------------------------------------------
-- 1. The one definition of "trials booked", per listing, per date
-- ---------------------------------------------------------------------------
-- security_invoker so the view carries free_class_bookings' RLS (closed, so
-- anon and authenticated read nothing through it). The two readers are the
-- service role, from reg-freeclass, and the SECURITY DEFINER function below.
create or replace view public.v_free_class_trials
with (security_invoker = true) as
select activity_id,
       class_date,
       count(*)::integer as trials
from   public.free_class_bookings
where  status = 'booked'
and    class_date >= current_date
group by activity_id, class_date;

comment on view public.v_free_class_trials is
  'Free class trials booked, per listing per date, upcoming only. '
  'status = booked; converted and no-show rows fall out on their own once Phase 4 sets them. '
  'The single source both the register and the staff portal count from.';

revoke all on public.v_free_class_trials from anon, authenticated;
grant select on public.v_free_class_trials to service_role;

-- ---------------------------------------------------------------------------
-- 2. What the staff portal reads
-- ---------------------------------------------------------------------------
-- A sibling to portal_list_activities rather than a change to it. That
-- function returns SETOF activities, which tracks the table's columns for
-- free; replacing it with an explicit TABLE(...) list would need DROP and
-- CREATE, drop its grants on the way, and leave a column list that silently
-- falls behind the next ALTER TABLE. The portal already merges a second
-- query by activity_id for enrolment counts (useOfferingEnrollment), so a
-- second query for trial counts is the shape it expects.
--
-- Gated the same way as portal_list_activities, since it sits beside it.
create or replace function public.portal_trial_counts()
returns table (
  activity_id      bigint,
  trials_upcoming  integer,   -- every booked trial from today forward
  next_date        date,      -- the soonest date with a trial booked
  next_date_trials integer    -- how many are coming that day
)
language sql
stable
security definer
set search_path to 'public', 'staff_portal'
as $$
  with per_listing as (
    select t.activity_id,
           sum(t.trials)::integer as trials_upcoming,
           min(t.class_date)      as next_date
    from   public.v_free_class_trials t
    group by t.activity_id
  )
  select p.activity_id,
         p.trials_upcoming,
         p.next_date,
         n.trials as next_date_trials
  from   per_listing p
  join   public.v_free_class_trials n
    on   n.activity_id = p.activity_id and n.class_date = p.next_date
  where  public.portal_may_write_catalogue()
  order by p.next_date, p.activity_id;
$$;

comment on function public.portal_trial_counts() is
  'Trial visitors per listing for the staff portal catalogue. Chief-only, like portal_list_activities. '
  'Merge onto portal_list_activities rows by activity_id.';

-- Same hardening as db/registration/functions/portal_grants.sql, one step
-- further: PUBLIC holds EXECUTE on a new function by default, so revoking from
-- anon alone leaves anon able to call it through PUBLIC. The internal gate
-- would return an empty set, but the door should refuse, as it does for
-- portal_list_activities (checked: anon gets 401 there).
revoke execute on function public.portal_trial_counts() from public, anon;
grant  execute on function public.portal_trial_counts() to authenticated, service_role;

commit;
