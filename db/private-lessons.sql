-- Private lessons: recurring weekly slots for one-on-one coaching.
--
-- WHAT THIS DOES
--   Adds the one thing the registration system does not have yet — a schedule.
--   Today a family buys a 10-pack and then arranges times by email. This lets
--   them claim a specific weekly slot (say Wednesdays 5:30 with CJ) and keeps
--   it for every week of the run they bought.
--
--   The unit being sold is not a date, it is a recurring weekly time. That is
--   what stops a parent picking twelve unrelated slots out of a calendar.
--
-- HOW TO RUN
--   Paste into the Supabase SQL editor on the Registration project and hit Run,
--   the same way as db/coaching-activities.sql. Safe to re-run.
--
-- HOW IT FITS WHAT ALREADY EXISTS
--   * Checkout is unchanged: acquire_hold_v3 → /api/reg-pay → Stripe →
--     reg-webhook, exactly like every other coaching purchase. This file adds
--     no payment code and no second Stripe integration.
--   * The associate coaches' packs are the activity rows that already exist
--     (970402 / 970403 / 970404 at $350 / $660 / $1,050). A slot booking rides
--     along with one of them rather than duplicating them.
--   * New rows: the semester (970601–970604) and the premium-rate packs
--     (970701–970703).
--
-- TWO RATES
--   Colton, Ryyana and Katie teach at the published $120 a lesson, so their
--   prices are exactly what coaching.html already advertises and there is
--   nothing new to publish for them. Tony Cimino-Johnson carries a 15% premium
--   at $138. Because coaching is flat priced a price is a row, so the premium
--   rate needs its own products: two semester rows and three packs.
--
-- PRICING NOTE
--   The semester runs Sep 14 2026 – Jan 14 2027 at 15% off, and that
--   discounted figure is simply the activity's price. Nothing computes a
--   discount at checkout, so the rule in reg-config.mjs that coaching is flat
--   priced with no sibling, tier, bundle, combo or insurance math stays
--   exactly as it is. The 15% is a property of the product, not an exception
--   to the pricing engine.
--
--   Two lengths per rate because the term does not divide evenly. Skipping
--   Thanksgiving (Nov 22–29) and Winter Break (Dec 20 – Jan 3), a Monday
--   through Thursday slot gets 15 lessons and a Friday or Saturday slot gets
--   14, because Jan 14 falls on a Thursday.
--
--   Totals are rounded to whole dollars so every price in the catalog stays a
--   round number — $138 × 14 less 15% is $1,642.20, sold as $1,642.
--
--   The semester is sold whole, only before lessons begin. A family joining in
--   November buys a 6- or 10-pack on the same weekly slot instead — that keeps
--   every coaching price flat and avoids a prorated variant the pricing engine
--   has no way to express.
--
-- LOCKING
--   `unique (slot_id, lesson_date)` is the entire mechanism. Claiming a run
--   inserts every one of its dates in a single statement, so Postgres either
--   takes all of them or none. Two families checking out the same Wednesday at
--   the same instant cannot both win — there is no read-then-write window to
--   race through.

-- ── Who teaches ─────────────────────────────────────────────────────────────
create table if not exists lesson_teachers (
  id           bigserial primary key,
  slug         text        not null unique,
  name         text        not null,
  title        text,
  bio          text,
  specialties  text[]      not null default '{}',
  -- Per-session rate. Matches the published single-session price (activity
  -- 970401, $120) unless a particular coach is priced differently.
  rate_cents   integer     not null default 12000,
  modes        text[]      not null default '{studio,virtual}',
  photo_url    text,
  sort_order   integer     not null default 0,
  active       boolean     not null default true,
  created_at   timestamptz not null default now()
);

-- ── The weekly times each coach offers ──────────────────────────────────────
create table if not exists lesson_slots (
  id          bigserial primary key,
  teacher_id  bigint      not null references lesson_teachers(id) on delete cascade,
  weekday     smallint    not null check (weekday between 0 and 6),  -- 0 = Sunday
  start_time  time        not null,
  active      boolean     not null default true,
  created_at  timestamptz not null default now(),
  unique (teacher_id, weekday, start_time)
);

-- ── One row per individual lesson ───────────────────────────────────────────
-- hold_id / order_id are deliberately plain columns rather than foreign keys:
-- this file should run cleanly regardless of what the holds and orders tables
-- are called, and the lifecycle is driven by the functions below.
create table if not exists lesson_bookings (
  id           bigserial   primary key,
  slot_id      bigint      not null references lesson_slots(id) on delete restrict,
  lesson_date  date        not null,
  status       text        not null default 'held' check (status in ('held','booked')),
  hold_id      uuid,
  order_id     bigint,
  activity_id  bigint,
  camper_id    bigint,
  expires_at   timestamptz,
  created_at   timestamptz not null default now(),

  -- The lock. One coach, one time, one date, one family.
  unique (slot_id, lesson_date)
);

create index if not exists lesson_bookings_slot_idx    on lesson_bookings (slot_id, lesson_date);
create index if not exists lesson_bookings_hold_idx    on lesson_bookings (hold_id);
create index if not exists lesson_bookings_expiry_idx  on lesson_bookings (expires_at)
  where status = 'held';

alter table lesson_teachers  enable row level security;
alter table lesson_slots     enable row level security;
alter table lesson_bookings  enable row level security;

-- The catalog is public; bookings are reachable only through the functions
-- below, which run as definer.
drop policy if exists lesson_teachers_read on lesson_teachers;
create policy lesson_teachers_read on lesson_teachers for select using (active);

drop policy if exists lesson_slots_read on lesson_slots;
create policy lesson_slots_read on lesson_slots for select using (active);

-- ── Expiry sweep ────────────────────────────────────────────────────────────
-- An abandoned checkout must give its slot back. lesson_hold sweeps before it
-- writes, so a stale hold can never block a sale and no cron job is required.
-- lesson_availability deliberately does not sweep: it filters expired holds
-- out of what it reports instead, so a read never has to write.
create or replace function public.lesson_sweep_expired()
returns void language sql security definer set search_path = public as $$
  delete from lesson_bookings
   where status = 'held' and expires_at is not null and expires_at < now();
$$;

-- ── What a family can book ──────────────────────────────────────────────────
-- Returns every active slot with the dates already spoken for, so the page can
-- work out which runs still fit. One round trip for the whole page.
create or replace function public.lesson_availability(p_from date, p_to date)
returns table (
  teacher_slug text,
  teacher_name text,
  teacher_title text,
  bio          text,
  specialties  text[],
  rate_cents   integer,
  modes        text[],
  photo_url    text,
  slot_id      bigint,
  weekday      smallint,
  start_time   time,
  taken_dates  date[]
)
language sql security definer set search_path = public as $$
  select t.slug, t.name, t.title, t.bio, t.specialties, t.rate_cents, t.modes, t.photo_url,
         s.id, s.weekday, s.start_time,
         coalesce(
           array(
             select b.lesson_date
               from lesson_bookings b
              where b.slot_id = s.id
                and b.lesson_date between p_from and p_to
                and (b.status = 'booked'
                     or b.expires_at is null
                     or b.expires_at > now())
              order by b.lesson_date
           ),
           '{}'::date[]
         )
    from lesson_slots s
    join lesson_teachers t on t.id = s.teacher_id
   where s.active and t.active
   order by t.sort_order, t.name, s.weekday, s.start_time;
$$;

-- ── Claim a run ─────────────────────────────────────────────────────────────
-- All or nothing. The insert either takes every date or raises on the unique
-- constraint, in which case nothing is written and the caller is told to pick
-- again. p_minutes matches the 30-minute cart hold the rest of checkout uses.
create or replace function public.lesson_hold(
  p_slot_id     bigint,
  p_dates       date[],
  p_hold_id     uuid,
  p_activity_id bigint  default null,
  p_camper_id   bigint  default null,
  p_minutes     integer default 30
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_expires timestamptz := now() + make_interval(mins => p_minutes);
  v_clash   date;
begin
  if p_dates is null or array_length(p_dates, 1) is null then
    return jsonb_build_object('ok', false, 'reason', 'no_dates');
  end if;

  perform lesson_sweep_expired();

  -- The delete sits inside the same protected block as the insert on purpose.
  -- A retry replaces its own rows rather than colliding with them, but if the
  -- new run then clashes with somebody else, both statements roll back
  -- together and the family keeps the hold it already had.
  begin
    delete from lesson_bookings
     where hold_id = p_hold_id and status = 'held';

    insert into lesson_bookings
      (slot_id, lesson_date, status, hold_id, activity_id, camper_id, expires_at)
    select p_slot_id, d, 'held', p_hold_id, p_activity_id, p_camper_id, v_expires
      from unnest(p_dates) as d;
  exception when unique_violation then
    -- Catching the exception has already rolled the block back, so the rows
    -- the delete removed are visible again. The caller's own live hold is
    -- therefore not an obstacle -- a retry clears it. Anything else is, and
    -- that includes their own paid lessons, which the delete leaves alone.
    select b.lesson_date into v_clash
      from lesson_bookings b
     where b.slot_id = p_slot_id
       and b.lesson_date = any(p_dates)
       and not (b.hold_id is not distinct from p_hold_id and b.status = 'held')
     order by b.lesson_date
     limit 1;
    return jsonb_build_object('ok', false, 'reason', 'slot_taken', 'first_clash', v_clash);
  end;

  return jsonb_build_object('ok', true, 'expires_at', v_expires, 'sessions', array_length(p_dates, 1));
end;
$$;

-- ── Payment landed ──────────────────────────────────────────────────────────
-- Called from reg-webhook once the PaymentIntent succeeds. Idempotent: a
-- replayed webhook finds the rows already booked and reports success.
create or replace function public.lesson_confirm(p_hold_id uuid, p_order_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rows integer;
begin
  update lesson_bookings
     set status = 'booked', order_id = p_order_id, expires_at = null
   where hold_id = p_hold_id;
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    -- The hold lapsed before the webhook arrived. Never silently drop a paid
    -- booking: say so, and let the caller flag it for a human.
    return jsonb_build_object('ok', false, 'reason', 'hold_lost');
  end if;

  return jsonb_build_object('ok', true, 'sessions', v_rows);
end;
$$;

-- ── Cart abandoned or emptied ───────────────────────────────────────────────
create or replace function public.lesson_release(p_hold_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rows integer;
begin
  delete from lesson_bookings where hold_id = p_hold_id and status = 'held';
  get diagnostics v_rows = row_count;
  return jsonb_build_object('ok', true, 'released', v_rows);
end;
$$;

-- ── What a coach's week looks like ──────────────────────────────────────────
-- For the admin console: every confirmed lesson, soonest first.
create or replace function public.lesson_roster(p_from date default current_date)
returns table (
  teacher_name text,
  weekday      smallint,
  start_time   time,
  lesson_date  date,
  order_id     bigint,
  camper_id    bigint,
  activity_id  bigint
)
language sql security definer set search_path = public as $$
  select t.name, s.weekday, s.start_time, b.lesson_date, b.order_id, b.camper_id, b.activity_id
    from lesson_bookings b
    join lesson_slots    s on s.id = b.slot_id
    join lesson_teachers t on t.id = s.teacher_id
   where b.status = 'booked' and b.lesson_date >= p_from
   order by b.lesson_date, s.start_time, t.name;
$$;

-- ── Who may call what ───────────────────────────────────────────────────────
-- Postgres grants EXECUTE on new functions to PUBLIC, and every role inherits
-- from PUBLIC — so revoking from `anon` alone changes nothing. Each function is
-- stripped from PUBLIC first and then granted back deliberately. These are all
-- SECURITY DEFINER, so getting this wrong would let an anonymous caller mark a
-- hold as paid.
revoke execute on function public.lesson_sweep_expired()                                from public;
revoke execute on function public.lesson_availability(date, date)                       from public;
revoke execute on function public.lesson_hold(bigint, date[], uuid, bigint, bigint, integer) from public;
revoke execute on function public.lesson_release(uuid)                                  from public;
revoke execute on function public.lesson_confirm(uuid, bigint)                          from public;
revoke execute on function public.lesson_roster(date)                                   from public;

-- Anyone may look at the schedule.
grant execute on function public.lesson_availability(date, date) to anon, authenticated;

-- Only a signed-in family may take or give back a slot.
grant execute on function public.lesson_hold(bigint, date[], uuid, bigint, bigint, integer) to authenticated;
grant execute on function public.lesson_release(uuid) to authenticated;

-- lesson_confirm and lesson_roster stay service-role only: confirming is what
-- turns a hold into a paid booking, and the roster is families' personal data.
-- The service role bypasses these grants, so reg-webhook still works.

-- ── Seed the roster ─────────────────────────────────────────────────────────
-- Coaches are real. Two fields are not, and should be replaced before this
-- page is linked from anywhere public:
--
--   bio    — written from the coach's title and nothing else. No credentials,
--            years of experience, or school placements have been invented.
--   slots  — a starting grid, not anyone's actual availability.
--
-- Re-running is safe. Removing a slot later does not touch lessons already
-- sold, because bookings reference the slot row and it is delete-restricted.
insert into lesson_teachers (slug, name, title, bio, specialties, rate_cents, modes, sort_order)
values
  ('tony-cimino-johnson', 'Tony Cimino-Johnson', 'Acting, Musical Theatre & College Coach',
   'Private coaching in acting and musical theatre, and college audition preparation.',
   '{Acting,"Musical Theatre","College Auditions"}', 13800, '{studio,virtual}', 1),
  ('colton-sorenson', 'Colton Sorenson', 'Vocal & Musical Theatre Coach',
   'Private coaching in vocal technique and musical theatre performance.',
   '{Voice,"Musical Theatre","Vocal Technique"}', 12000, '{studio,virtual}', 2),
  ('ryyana-cunningham', 'Ryyana Cunningham', 'Audition & Musical Theatre Coach',
   'Private coaching in audition preparation and musical theatre performance.',
   '{"Audition Prep","Musical Theatre",Repertoire}', 12000, '{studio,virtual}', 3),
  ('katie-hamburger', 'Katie Hamburger', 'Dance Coach',
   'Private coaching in dance technique and choreography.',
   '{Dance,Choreography,Movement}', 12000, '{studio}', 4)
on conflict (slug) do update set
  name = excluded.name, title = excluded.title, bio = excluded.bio,
  specialties = excluded.specialties, rate_cents = excluded.rate_cents,
  modes = excluded.modes, sort_order = excluded.sort_order;

insert into lesson_slots (teacher_id, weekday, start_time)
select t.id, v.weekday, v.start_time
  from (values
    ('tony-cimino-johnson', 1, time '16:00'),
    ('tony-cimino-johnson', 1, time '17:00'),
    ('tony-cimino-johnson', 3, time '16:30'),
    ('tony-cimino-johnson', 3, time '17:30'),
    ('tony-cimino-johnson', 3, time '18:30'),
    ('tony-cimino-johnson', 5, time '15:30'),
    ('colton-sorenson', 2, time '16:00'),
    ('colton-sorenson', 2, time '17:00'),
    ('colton-sorenson', 2, time '18:00'),
    ('colton-sorenson', 4, time '17:00'),
    ('colton-sorenson', 4, time '18:00'),
    ('colton-sorenson', 6, time '10:00'),
    ('colton-sorenson', 6, time '11:00'),
    ('ryyana-cunningham', 1, time '18:00'),
    ('ryyana-cunningham', 4, time '16:00'),
    ('ryyana-cunningham', 4, time '19:00'),
    ('ryyana-cunningham', 6, time '12:00'),
    ('ryyana-cunningham', 6, time '13:00'),
    ('katie-hamburger', 2, time '15:30'),
    ('katie-hamburger', 4, time '15:30'),
    ('katie-hamburger', 5, time '16:30'),
    ('katie-hamburger', 5, time '17:30'),
    ('katie-hamburger', 6, time '09:00')
  ) as v(slug, weekday, start_time)
  join lesson_teachers t on t.slug = v.slug
on conflict (teacher_id, weekday, start_time) do nothing;

-- ── The sellable products ─────────────────────────────────────────────────
-- Deliberately last. If the activities table has picked up a NOT NULL column
-- since this was written, only this insert fails — the schedule, its functions
-- and the coach roster are already committed above, and you fix one statement
-- rather than re-running everything.
-- Wrapped so a failure here cannot take the schedule down with it. The SQL
-- editor runs the whole file in one transaction, so without this an error on
-- the insert would roll back the tables and functions above too. A caught
-- exception only rolls back its own block.
do $prod$
begin
  insert into activities
    (id, name, category, price_cents, schedule_name, age_range, description, bookable, bb_gated, capacity)
  values
    -- Semester, lead-coach rate ($120 a lesson)
    (970601, 'Private Lessons — Fall Semester · 15 × $120', 'coaching', 153000,
     '15 × 50 minutes · same weekly time · $102 each', null,
     'One weekly time with the same coach from September 14 through January 14 — fifteen fifty minute private sessions, the same day and time every week. Lessons pause for Thanksgiving Break and Winter Break and pick up again after. Booked once and the slot is yours for the term; nobody else can take it. Fifteen sessions at the single rate would be $1,800, so the semester saves $270.',
     true, false, null),
    (970602, 'Private Lessons — Fall Semester · 14 × $120', 'coaching', 142800,
     '14 × 50 minutes · same weekly time · $102 each', null,
     'One weekly time with the same coach from September 14 through January 14 — fourteen fifty minute private sessions, the same day and time every week. Lessons pause for Thanksgiving Break and Winter Break and pick up again after. Friday and Saturday slots run one week shorter than the midweek term because the term ends on a Thursday. Fourteen sessions at the single rate would be $1,680, so the semester saves $252.',
     true, false, null),
  
    -- Semester, lead-coach premium rate ($138 a lesson)
    (970603, 'Private Lessons — Fall Semester · 15 × $138', 'coaching', 176000,
     '15 × 50 minutes · same weekly time · $117.33 each', null,
     'One weekly time with the lead coach from September 14 through January 14 — fifteen fifty minute private sessions, the same day and time every week. Lessons pause for Thanksgiving Break and Winter Break and pick up again after. Booked once and the slot is yours for the term; nobody else can take it. Fifteen sessions at the single rate would be $2,070, so the semester saves $310.',
     true, false, null),
    (970604, 'Private Lessons — Fall Semester · 14 × $138', 'coaching', 164200,
     '14 × 50 minutes · same weekly time · $117.29 each', null,
     'One weekly time with the lead coach from September 14 through January 14 — fourteen fifty minute private sessions, the same day and time every week. Lessons pause for Thanksgiving Break and Winter Break and pick up again after. Friday and Saturday slots run one week shorter than the midweek term because the term ends on a Thursday. Fourteen sessions at the single rate would be $1,932, so the semester saves $290.',
     true, false, null),
  
    -- Packs at the lead-coach premium rate. The associate coaches teach at the
    -- published $120, so their packs are the rows that already exist —
    -- 970402 / 970403 / 970404 at $350 / $660 / $1,050. Nothing to duplicate.
    (970701, 'Private Lessons — 3-Pack · 3 × $138', 'coaching', 40300,
     '3 × 50 minutes · same weekly time · $134.33 each', null,
     'Three private sessions with the lead coach on the same weekly time, three weeks running. The slot is held for all three. Breaks are stepped over, so a pack that crosses a holiday still delivers three lessons.',
     true, false, null),
    (970702, 'Private Lessons — 6-Pack · 6 × $138', 'coaching', 75900,
     '6 × 50 minutes · same weekly time · $126.50 each', null,
     'Six private sessions with the lead coach on the same weekly time, six weeks running. The slot is held for all six. Breaks are stepped over, so a pack that crosses a holiday still delivers six lessons.',
     true, false, null),
    (970703, 'Private Lessons — 10-Pack · 10 × $138', 'coaching', 120800,
     '10 × 50 minutes · same weekly time · $120.80 each', null,
     'Ten private sessions with the lead coach on the same weekly time, ten weeks running — the lowest per lesson rate short of the semester. The slot is held for all ten. Breaks are stepped over, so a pack that crosses a holiday still delivers ten lessons.',
     true, false, null)
  on conflict (id) do update set
    name          = excluded.name,
    category      = excluded.category,
    price_cents   = excluded.price_cents,
    schedule_name = excluded.schedule_name,
    description   = excluded.description,
    bookable      = excluded.bookable,
    bb_gated      = excluded.bb_gated,
    capacity      = excluded.capacity;
  raise notice 'private-lesson products: 7 rows OK';
exception when others then
  raise warning 'PRODUCTS NOT INSERTED: % — the schedule itself installed fine; fix this insert and re-run.', sqlerrm;
end
$prod$;

-- Sanity check: 4 coaches, 23 slots, 7 new private-lesson products.
select t.name, count(s.id) as slots
  from lesson_teachers t left join lesson_slots s on s.teacher_id = t.id
 group by t.name order by t.name;

select id, name, price_cents, schedule_name
  from activities where id between 970601 and 970703 order by id;
