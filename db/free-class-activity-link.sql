-- Attach every free class booking to the class it is a visit to.
--
-- free_class_bookings.activity_id was declared NOT NULL DEFAULT 0 and
-- reg-freeclass wrote the literal 0 on every booking, so a trial belonged to
-- no listing. Nothing downstream could count it: the register page showed
-- remaining places from paid enrolments alone, the staff portal agreed with
-- it, and the teacher's roster listed neither. Five children are booked into
-- Opening Week this way (Sep 14-17 2026) and no system knows they are coming.
--
-- reg-freeclass.mjs now writes CLASSES[key].activityId. This migration
-- backfills the rows taken before that and makes the old failure impossible:
--
--   1. backfill the existing bookings from their cast_key
--   2. drop the DEFAULT 0, so an insert that forgets the column fails
--   3. add the foreign key, so an id that is not a listing fails
--
-- Run it AFTER the reg-freeclass deploy. Run in the other order and any
-- booking taken in between is rejected by the new constraint, because the
-- deployed function is still sending 0.
--
-- Idempotent: safe to run twice.

begin;

-- 1. The bookings taken while activity_id was always 0 -----------------------
-- Matched on cast_key, the only link these rows have to a class. The keys and
-- ids are the same table as CLASSES in reg-freeclass.mjs, verified against the
-- catalogue on 10 Sep 2026 by day of week, start time and age range.
--
-- Scoped to activity_id = 0 so a re-run cannot touch a correctly attached row.
update free_class_bookings b
set    activity_id = m.activity_id
from  (values
         ('acting-5-8',      1960867::bigint),
         ('triple-threat',   1960898),
         ('mt-5-8',          1960924),
         ('mt-dance-13-17',  1960925),
         ('mt-acting-13-17', 1960927),
         ('hs-mt',           1962566),
         ('hs-theatre',      1962567),
         ('acting-9-12',     1960936),
         ('mt-dance-9-12',   1960939),
         ('mt-acting-9-12',  1960945),
         ('improv-9-12',     1960959),
         ('improv-13-17',    1960961),
         ('acting-mt-sat',   1962562)
       ) as m(cast_key, activity_id)
where  b.cast_key = m.cast_key
and    b.activity_id = 0;

-- A booking under a cast_key retired from the catalogue cannot be backfilled,
-- and the foreign key below would then refuse the whole migration with a
-- constraint error that names no row. Say which booking, instead.
do $$
declare stranded text;
begin
  select string_agg(format('#%s %s (%s, %s)', id, child_name, cast_key, class_date), '; ')
    into stranded
    from free_class_bookings
   where activity_id = 0;
  if stranded is not null then
    raise exception
      'Cannot attach these bookings to a class, their cast_key is not in the catalogue: %', stranded;
  end if;
end $$;

-- 2. No more silent zero -----------------------------------------------------
-- The default is what made the original bug invisible: an insert that never
-- mentioned activity_id still succeeded. Without it, that insert now fails on
-- NOT NULL, at the point of the mistake.
alter table free_class_bookings alter column activity_id drop default;

-- 3. An id that is not a listing is not an id --------------------------------
-- Same shape as cast_waitlist_activity_id_fkey: NO ACTION, so a listing with
-- trials booked against it cannot be deleted out from under them. The
-- catalogue import upserts rather than deletes, which is why that constraint
-- has held.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'free_class_bookings_activity_id_fkey'
  ) then
    alter table free_class_bookings
      add constraint free_class_bookings_activity_id_fkey
      foreign key (activity_id) references activities (id);
  end if;
end $$;

-- Phase 2 reads this table by listing and date on every catalogue render.
create index if not exists free_class_bookings_activity_date_idx
  on free_class_bookings (activity_id, class_date)
  where status = 'booked';

commit;
