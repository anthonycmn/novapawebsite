-- Convert a trial into an enrolment, and burn a free visit that was not used.
--
-- Phase 4 of the trial-seats work, and the part that earns its keep: until
-- this, nothing recorded whether a free first class ever turned into a paying
-- family, so the one number that says whether the free class is worth
-- running could not be produced.
--
-- Two rules from CJ, 10 Sep 2026:
--
--   "A Trial should not be allowed to take the seat of a full class"
--       -> Phase 2, already live.
--   "a no show burns the free visit"
--       -> here. A child whose free visit was booked and not used does not
--          get another one. Nor does a child who used it: the offer is a
--          first class free, singular.
--
-- Three pieces:
--
--   1. The lifecycle. status gains no_show and converted, beside booked,
--      attended and cancelled. converted carries the order that did it and
--      when. NEVER deleted: the conversion record is the only place a
--      trial-to-enrolment rate can ever come from.
--
--   2. convert_free_class_trials(order). Called by the payment webhook after
--      confirm_order, inside its own try/catch like every other post-confirm
--      effect, so nothing here can fail a checkout. Matches a family's booked
--      or attended trial to the listing they just paid for, by email and the
--      child's first name, and marks it converted. Idempotent: a converted row
--      is never matched again, so Stripe's redeliveries are no-ops.
--
--   3. portal_mark_visit(booking, status). What the teacher taps on the
--      register: attended, no_show, or back to booked (a tap on the mark a
--      visitor already has clears it, the way the enrolled register works).
--      Gated like the roster: chiefs, admins, directors, and the teacher
--      assigned to that class. Records who marked it and when.
--
-- Run order: any time after Phase 1. The webhook and the portal both degrade
-- to the old behaviour if a function is missing (a logged error, nothing
-- more), so this can go first or second.
-- Idempotent: safe to run twice.

begin;

-- ---------------------------------------------------------------------------
-- 1. The lifecycle
-- ---------------------------------------------------------------------------
alter table public.free_class_bookings
  add column if not exists converted_order_id uuid references public.orders (id),
  add column if not exists converted_at       timestamptz,
  add column if not exists attended_at        timestamptz,
  add column if not exists attended_by        text;

comment on column public.free_class_bookings.converted_order_id is
  'The paid order that turned this visit into an enrolment. Set by convert_free_class_trials from the payment webhook. Never cleared: this row is the trial-to-enrolment record.';
comment on column public.free_class_bookings.attended_by is
  'Who marked the visit attended or no_show, from the staff portal register. Free text (the staff member''s name), because the portal''s staff table lives in another schema and a mark taken in September has to still read next spring.';

alter table public.free_class_bookings
  drop constraint if exists free_class_bookings_status_check;
alter table public.free_class_bookings
  add constraint free_class_bookings_status_check
  check (status in ('booked', 'attended', 'no_show', 'converted', 'cancelled'));

-- The webhook and the free-class function both ask "has this child used a
-- free visit" by email and first name.
create index if not exists free_class_bookings_child_idx
  on public.free_class_bookings (lower(email), lower(child_name));

-- ---------------------------------------------------------------------------
-- 2. A paid order converts the matching trial
-- ---------------------------------------------------------------------------
create or replace function public.convert_free_class_trials(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text;
  v_n     integer := 0;
begin
  select lower(email) into v_email from public.orders where id = p_order_id;
  if v_email is null then
    return 0;
  end if;

  -- One pass, name-matched: the order's camper is "Grace Kontitsis"; the
  -- booking's child is "Grace". Same email, same listing, same first name.
  -- booked OR attended, because a family that pays the same night, before
  -- the teacher marks the register, is still a conversion.
  with matched as (
    select distinct on (b.id) b.id
    from   public.free_class_bookings b
    join   public.order_items oi
      on   oi.order_id = p_order_id
     and   oi.activity_id = b.activity_id
     and   lower(split_part(btrim(oi.camper_name), ' ', 1)) = lower(split_part(btrim(b.child_name), ' ', 1))
    where  lower(b.email) = v_email
    and    b.status in ('booked', 'attended')
    and    b.converted_order_id is null
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
  'Marks a family''s booked or attended free-class trial converted when they pay for that listing. Called by the payment webhook after confirm_order, failure-isolated. Idempotent. Returns how many bookings it converted.';

-- The webhook calls this with the service role. Nothing else should.
revoke execute on function public.convert_free_class_trials(uuid) from public, anon, authenticated;
grant  execute on function public.convert_free_class_trials(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. The teacher marks the visit
-- ---------------------------------------------------------------------------
-- Lives in public because it writes public.free_class_bookings, which the
-- portal cannot touch directly (RLS, no policies, on purpose). The gate is
-- the roster's: staff_portal.can_see_all_rosters(), or the caller teaches
-- the class the booking's listing is bridged to.
create or replace function public.portal_mark_visit(p_booking_id bigint, p_status text)
returns void
language plpgsql
security definer
set search_path to 'public', 'staff_portal'
as $$
declare
  v_class   uuid;
  v_current text;
  v_who     text;
begin
  if p_status not in ('attended', 'no_show', 'booked') then
    raise exception 'A visit is marked attended, no_show, or cleared back to booked' using errcode = '23514';
  end if;

  select b.status, l.class_id
    into v_current, v_class
    from public.free_class_bookings b
    left join staff_portal.reg_class_listing l on l.activity_id = b.activity_id
   where b.id = p_booking_id;

  if v_current is null then
    raise exception 'No such visit' using errcode = 'P0002';
  end if;
  if not (staff_portal.can_see_all_rosters()
          or (v_class is not null and staff_portal.teaches_class(v_class))) then
    raise exception 'Only the class''s teacher or a director can mark a visit' using errcode = '42501';
  end if;
  -- A converted visit is a customer now; its record is closed.
  if v_current = 'converted' then
    raise exception 'This family has enrolled. The visit is already recorded as converted.' using errcode = '23514';
  end if;

  select s.full_name into v_who
    from staff_portal.staff s
   where s.id = staff_portal.my_staff_id();

  update public.free_class_bookings
     set status      = p_status,
         attended_at = case when p_status = 'booked' then null else now() end,
         attended_by = case when p_status = 'booked' then null else coalesce(v_who, 'staff') end
   where id = p_booking_id;
end;
$$;

comment on function public.portal_mark_visit(bigint, text) is
  'The staff portal register''s mark for a free-class visitor: attended, no_show, or back to booked. Gated like the roster. Records who and when.';

revoke execute on function public.portal_mark_visit(bigint, text) from public, anon;
grant  execute on function public.portal_mark_visit(bigint, text) to authenticated, service_role;

commit;
