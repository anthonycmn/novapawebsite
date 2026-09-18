-- Ad attribution: where a paying family actually came from.
--
--  HOW
--    1. Open  https://supabase.com/dashboard/project/tlkuqwsqicxcjdmumkje/sql/new
--    2. Paste this whole file.
--    3. Press Run.
--    4. Read the last result table. Every row should say OK.
--
--  Safe to re-run. Every statement is idempotent.
--
-- Why this exists, Sep 18 2026. Two Meta campaigns went live this morning,
-- daycamps-fall-2026 and classes-fall-2026, and the audit the day before found
-- that neither could be judged honestly:
--
--   1. public.orders had nowhere to record where a buyer came from. Across
--      public, staff_portal and family_hub the only two places a UTM or a
--      click id was stored anywhere in the database were
--      free_class_bookings.utm and quiz_leads.utm. A family who clicks an ad
--      and checks out, which is the normal path for a camp or a show, was
--      unattributable forever.
--
--   2. convert_free_class_trials has never converted a single booking. Not
--      because it is broken or unwired: the payment webhook has called it
--      after every confirm_order since it shipped. It has never MATCHED,
--      because it required the paid order to be for the same listing as the
--      trial. Real families do not behave that way. Allegra Lehr sampled a
--      Musical Theatre class (listing 1960924) on Sep 15 and her family paid
--      $729.75 for Frozen Kids (listing 1959789) the next day. That is the
--      clearest trial-to-enrolment there has been, it came from a Meta ad,
--      and the table recorded nothing, so the free class read 0 for 25.
--
-- Part 1 is the column the checkout now fills. Part 2 widens the match to
-- "the same child, at the same address, paid for something after the trial"
-- and backfills what the old rule missed.

begin;

-- ---------------------------------------------------------------------------
-- 1. Orders remember the ad that brought them
-- ---------------------------------------------------------------------------
-- Filled by reg-webhook.mjs after confirm_order, from the utm set the
-- checkout captured on arrival and carried through the Stripe intent
-- metadata. Nullable and never required: an organic checkout leaves it null,
-- and a failure to write it can never fail a payment.
alter table public.orders
  add column if not exists utm jsonb;

comment on column public.orders.utm is
  'The utm_* and fbclid params the checkout landed on, first touch, at most 8 keys. Written by reg-webhook after confirm_order. Null means the buyer arrived untagged, which is most of them. This is the only record of which ad produced a paid registration.';

-- Attribution questions are always "which campaign, over what window", so the
-- index is on the campaign key rather than the whole document.
create index if not exists orders_utm_campaign_idx
  on public.orders ((utm ->> 'utm_campaign'))
  where utm is not null;

-- ---------------------------------------------------------------------------
-- 2. A trial converts when the child enrolls in anything
-- ---------------------------------------------------------------------------
-- The only change from the Sep 10 version is the join: the order no longer
-- has to be for the listing the child trialled. Everything else is kept,
-- including the first-name match, the booked-or-attended rule, and the
-- idempotence that makes Stripe redeliveries no-ops.
--
-- The new guard is the order date. Without it a family with a child already
-- registered, who then books that child a free class, would have the trial
-- marked converted by an order that predates it. The trial has to come first
-- to have earned anything.
create or replace function public.convert_free_class_trials(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email     text;
  v_ordered_at timestamptz;
  v_n         integer := 0;
begin
  select lower(email), created_at
    into v_email, v_ordered_at
    from public.orders
   where id = p_order_id;

  if v_email is null then
    return 0;
  end if;

  -- Same address, same child's first name, and the trial happened first.
  -- The order's camper is "Allegra Lehr"; the booking's child is "Allegra".
  -- booked OR attended, because a family that pays the same night, before
  -- the teacher marks the register, is still a conversion.
  with matched as (
    select distinct on (b.id) b.id
    from   public.free_class_bookings b
    join   public.order_items oi
      on   oi.order_id = p_order_id
     and   lower(split_part(btrim(oi.camper_name), ' ', 1)) = lower(split_part(btrim(b.child_name), ' ', 1))
    where  lower(b.email) = v_email
    and    b.status in ('booked', 'attended')
    and    b.converted_order_id is null
    and    b.created_at <= v_ordered_at
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
  'Marks a family''s booked or attended free-class trial converted when that same child later pays for anything. Matched by email, the child''s first name, and the trial preceding the order. Called by the payment webhook after confirm_order, failure-isolated. Idempotent. Returns how many bookings it converted.';

revoke execute on function public.convert_free_class_trials(uuid) from public, anon, authenticated;
grant  execute on function public.convert_free_class_trials(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Backfill what the old rule missed
-- ---------------------------------------------------------------------------
-- Runs the corrected function over every paid order there has ever been, so
-- the backfill and the live behaviour can never disagree. Idempotent by the
-- function's own converted_order_id is null guard.
--
-- As of Sep 18 2026 this converts exactly one booking: Allegra Lehr's
-- Sep 15 trial against order 15254. If it reports more, read the list below
-- it before believing the number.
select coalesce(sum(public.convert_free_class_trials(o.id)), 0) as bookings_converted
from   public.orders o
where  o.status in ('paid', 'confirmed', 'complete', 'succeeded');

commit;

-- ---------------------------------------------------------------------------
-- Did it work
-- ---------------------------------------------------------------------------
select 'orders.utm column' as check,
       case when exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'orders' and column_name = 'utm'
       ) then 'OK' else 'MISSING' end as result
union all
select 'trials converted (was 0 of 25 before this ran)',
       'OK: ' || count(*) || ' of ' || (select count(*) from public.free_class_bookings)
from   public.free_class_bookings where converted_order_id is not null;

-- Every conversion on the books, so the number above has names behind it.
select b.id as booking, b.child_name, b.class_date, b.converted_at::date as converted,
       o.order_no, o.total_cents, b.utm ->> 'utm_content' as trial_came_from
from   public.free_class_bookings b
join   public.orders o on o.id = b.converted_order_id
order  by b.converted_at;
