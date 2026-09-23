-- A trial converts on the listing, not only on the child's first name.
--
-- Katelyn Johansen attended Triple Threat (1960898) on Sep 14 2026, booking
-- 19. Her family bought that same class on Sep 20 (order c3fa0274) and the
-- Frozen plus Mermaid bundle on Sep 22, both as "Katy Johansen". The live
-- function matched email plus first name only, and "katelyn" is not "katy",
-- so booking 19 still read attended and the free class funnel undercounted
-- by one (registration audit, Sep 21 to Sep 23).
--
-- The rule now, for a family's open trial (booked or attended, not yet
-- converted, booked before the order was placed):
--
--   1. Same child first name, any listing. Unchanged. This is the Sep 18 2026
--      rule: families trial a class and then buy a show, so a listing match
--      alone credited 0 of 25 bookings in six weeks.
--   2. Same listing, whatever name the order uses, when that family has only
--      one child booked on that listing. A nickname cannot hide a trial that
--      only one child could have taken.
--   3. Same listing with more than one child of that family booked on it:
--      the first name is the tiebreaker, which is rule 1.
--
-- Known limit of rule 2, accepted: a family that trials one child and then
-- enrols only a sibling in that same class credits the trial. That is still
-- a trial that produced an enrolment in the class it sampled.
--
-- Carries the live guard that the Sep 11 export below it lacks: a trial
-- booked after the order cannot be what produced it.
--
-- Expected effect on apply: 0 rows changed (this replaces a function). To
-- credit booking 19, CJ then runs, once (expect 1):
--
--   select public.convert_free_class_trials(id)
--     from public.orders where id::text like 'c3fa0274%';
--
-- Tested against real Postgres by tests/free-class-conversion.test.mjs.
-- Idempotent: safe to run twice.

create or replace function public.convert_free_class_trials(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email      text;
  v_ordered_at timestamptz;
  v_n          integer := 0;
begin
  select lower(email), created_at
    into v_email, v_ordered_at
    from public.orders
   where id = p_order_id;

  if v_email is null then
    return 0;
  end if;

  with open_trials as (
    select b.id, b.activity_id,
           lower(split_part(btrim(b.child_name), ' ', 1)) as first_name
    from   public.free_class_bookings b
    where  lower(b.email) = v_email
    and    b.status in ('booked', 'attended')
    and    b.converted_order_id is null
    and    b.created_at <= v_ordered_at
  ),
  -- How many different children this family has booked on each listing,
  -- cancelled visits aside. One means the listing alone identifies the child.
  kids_on_listing as (
    select b.activity_id,
           count(distinct lower(split_part(btrim(b.child_name), ' ', 1))) as n
    from   public.free_class_bookings b
    where  lower(b.email) = v_email
    and    b.status <> 'cancelled'
    group  by b.activity_id
  ),
  lines as (
    select oi.activity_id,
           lower(split_part(btrim(oi.camper_name), ' ', 1)) as first_name
    from   public.order_items oi
    where  oi.order_id = p_order_id
  ),
  matched as (
    select distinct t.id
    from   open_trials t
    join   lines l
      on   l.first_name = t.first_name
       or  (l.activity_id = t.activity_id
            and (select k.n from kids_on_listing k where k.activity_id = t.activity_id) = 1)
  ),
  done as (
    update public.free_class_bookings b
    set    status = 'converted',
           converted_order_id = p_order_id,
           converted_at = now()
    from   matched m
    where  b.id = m.id
    returning b.id
  )
  select count(*) into v_n from done;

  return v_n;
end;
$$;

comment on function public.convert_free_class_trials(uuid) is
  'Marks a family''s booked or attended free-class trial converted when they pay: same child first name on any listing, or the same listing when only one child of that family is booked on it. Trials booked after the order are skipped. Called by the payment webhook after confirm_order, failure-isolated. Idempotent. Returns how many bookings it converted.';

revoke execute on function public.convert_free_class_trials(uuid) from public, anon, authenticated;
grant  execute on function public.convert_free_class_trials(uuid) to service_role;
