-- ═══════════════════════════════════════════════════════════════════════
--  NOVAPA — RUN THIS ONE FILE
-- ═══════════════════════════════════════════════════════════════════════
--
--  Everything outstanding, in the right order, in one paste.
--
--  HOW
--    1. Open  https://supabase.com/dashboard/project/tlkuqwsqicxcjdmumkje/sql/new
--    2. Paste this whole file.
--    3. Press Run (or Cmd-Enter).
--    4. Read the last result table. Every row should say OK.
--
--  It is safe to re-run. Every statement is idempotent: existing rows are
--  updated in place, existing tables are left alone. Running it twice does
--  nothing the first run did not already do.
--
--  WHAT IT DOES
--    A. Dear Evan Hansen staff dashboard — check-offs, sourcing and cost,
--       roster, attendance, rehearsal notes, report log.
--       Until this runs, every phone keeps its own copy and nothing is
--       shared. This is the one that matters for Monday.
--    B. Day camps priced at $79.
--    C. The 24 college-audition coaching services, so /register can sell them.
--
--  ONE THING TO CHECK BEFORE YOU RUN
--    Section B rewrites the price of every one-day camp. The SELECT directly
--    above it lists exactly which rows will change. If anything in that list
--    is not a one-day camp, stop and tell me before running section B.
-- ═══════════════════════════════════════════════════════════════════════




-- ────────────────────────────────────────────────────────────────────
--  A.  Dear Evan Hansen staff dashboard
-- ────────────────────────────────────────────────────────────────────

-- Shared check-offs AND sourcing/cost tracking for the Dear Evan Hansen
-- staff dashboard (/deh/).
--
-- WHAT THIS DOES
--   Without it the dashboard still works, but each phone keeps its own list.
--   With it, Ryanna ticking a costume block is visible to Colton and Tony.
--
-- HOW TO RUN
--   Paste into the Supabase SQL editor on the Registration project and Run.
--   Safe to re-run.
--
-- WHO CAN WRITE
--   Anyone who reaches the page can read and write these rows. That is the
--   deliberate trade: the staff have no logins for this and the page is only
--   findable if you were given the URL and the company word. The worst case is
--   a wrong tick on a rehearsal checklist, and every row records who did it and
--   when, so a wrong one is easy to spot and undo. Do not add anything to this
--   table that you would not put on a callboard.

create table if not exists deh_progress (
  block_id   text primary key,          -- YYYYMMDD|time|track, from deh/data.js
  done       boolean not null default false,
  done_by    text,
  done_at    timestamptz,
  updated_at timestamptz not null default now()
);
alter table deh_progress enable row level security;

create or replace function public.deh_progress_list()
returns setof deh_progress
language sql stable security definer set search_path = public as $fn$
  select * from deh_progress where done;
$fn$;

create or replace function public.deh_progress_set(p_block_id text, p_done boolean, p_by text)
returns void
language sql volatile security definer set search_path = public as $fn$
  insert into deh_progress (block_id, done, done_by, done_at, updated_at)
  values (p_block_id, p_done, nullif(trim(p_by), ''), case when p_done then now() end, now())
  on conflict (block_id) do update set
    done       = excluded.done,
    done_by    = excluded.done_by,
    done_at    = excluded.done_at,
    updated_at = now();
$fn$;

grant execute on function public.deh_progress_list() to anon, authenticated;
grant execute on function public.deh_progress_set(text, boolean, text) to anon, authenticated;

-- ── Sourcing and cost, per breakdown item ────────────────────────────────
-- One row per set piece, prop, and costume in deh/scenes.js. `item_id` is the
-- id in that file — do not renumber those ids or this table detaches from what
-- it describes.
create table if not exists deh_items (
  item_id     text primary key,
  status      text not null default 'todo',   -- todo | sourced | ordered | arrived | done
  vendor      text,                           -- Amazon, in stock, build in shop, Marketplace...
  link        text,                           -- the primary link; == links[1]
  links       text[] not null default '{}',   -- a costume look is often three shops
  sent_at     timestamptz,                    -- emailed to Todd; frozen once set
  sent_by     text,
  price_cents int  not null default 0,        -- UNIT price; multiply by qty for the line
  qty         int  not null default 1,
  updated_by  text,
  updated_at  timestamptz not null default now()
);
alter table deh_items enable row level security;

-- Existing installs: add the column and seed it from the single link already
-- stored, so nothing sourced before this change loses its source. This has to
-- run BEFORE deh_item_set is (re)created — a `language sql` body is parsed at
-- creation time, so a function naming a column that does not exist yet fails
-- to create at all.
alter table deh_items add column if not exists links text[] not null default '{}';
update deh_items set links = array[link]
  where link is not null and link <> '' and cardinality(links) = 0;
alter table deh_items add column if not exists sent_at timestamptz;
alter table deh_items add column if not exists sent_by text;

create or replace function public.deh_items_list()
returns setof deh_items
language sql stable security definer set search_path = public as $fn$
  select * from deh_items;
$fn$;

-- Re-running this after the single-link version has to remove that signature
-- first: `create or replace` with different arguments makes an overload, and
-- two candidates would make the PostgREST call ambiguous.
drop function if exists public.deh_item_set(text, text, text, text, int, int, text);
drop function if exists public.deh_item_set(text, text, text, text, text[], int, int, text);

create or replace function public.deh_item_set(
  p_item_id text, p_status text, p_vendor text, p_link text, p_links text[],
  p_price_cents int, p_qty int, p_sent_at timestamptz, p_sent_by text, p_by text)
returns void
language sql volatile security definer set search_path = public as $fn$
  insert into deh_items (item_id, status, vendor, link, links, price_cents, qty, sent_at, sent_by, updated_by, updated_at)
  values (p_item_id,
          coalesce(nullif(trim(p_status), ''), 'todo'),
          nullif(trim(p_vendor), ''),
          nullif(trim(p_link), ''),
          coalesce(p_links, '{}'),
          greatest(coalesce(p_price_cents, 0), 0),
          greatest(coalesce(p_qty, 1), 1),
          p_sent_at, nullif(trim(p_sent_by), ''),
          nullif(trim(p_by), ''), now())
  on conflict (item_id) do update set
    status      = excluded.status,
    vendor      = excluded.vendor,
    link        = excluded.link,
    links       = excluded.links,
    price_cents = excluded.price_cents,
    qty         = excluded.qty,
    sent_at     = excluded.sent_at,
    sent_by     = excluded.sent_by,
    updated_by  = excluded.updated_by,
    updated_at  = now();
$fn$;

grant execute on function public.deh_items_list() to anon, authenticated;
grant execute on function public.deh_item_set(text, text, text, text, text[], int, int, timestamptz, text, text) to anon, authenticated;

-- ── Company roster ───────────────────────────────────────────────────────
-- Who can be marked present. Editable in the dashboard because the cast list
-- did not exist when this was built — add names as they are cast.
create table if not exists deh_roster (
  person_id  text primary key,          -- slug, stable once created
  name       text not null,
  role       text,                      -- 'Evan', 'Ensemble', 'Costumes'...
  kind       text not null default 'cast',   -- cast | crew | staff
  sort       int  not null default 100,
  active     boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table deh_roster enable row level security;

create or replace function public.deh_roster_list()
returns setof deh_roster
language sql stable security definer set search_path = public as $fn$
  select * from deh_roster where active order by kind, sort, name;
$fn$;

create or replace function public.deh_roster_set(
  p_person_id text, p_name text, p_role text, p_kind text, p_sort int, p_active boolean)
returns void
language sql volatile security definer set search_path = public as $fn$
  insert into deh_roster (person_id, name, role, kind, sort, active, updated_at)
  values (p_person_id, trim(p_name), nullif(trim(p_role), ''),
          coalesce(nullif(trim(p_kind), ''), 'cast'), coalesce(p_sort, 100),
          coalesce(p_active, true), now())
  on conflict (person_id) do update set
    name = excluded.name, role = excluded.role, kind = excluded.kind,
    sort = excluded.sort, active = excluded.active, updated_at = now();
$fn$;

grant execute on function public.deh_roster_list() to anon, authenticated;
grant execute on function public.deh_roster_set(text, text, text, text, int, boolean) to anon, authenticated;

-- ── Attendance ───────────────────────────────────────────────────────────
-- One row per person per rehearsal day. Absent rows are the ones that matter;
-- "present" is stored too so a blank day is distinguishable from a day nobody
-- took attendance on.
create table if not exists deh_attendance (
  day        date not null,
  person_id  text not null,
  status     text not null default 'present',   -- present | late | absent | excused
  note       text,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (day, person_id)
);
alter table deh_attendance enable row level security;

create or replace function public.deh_attendance_list(p_day date)
returns setof deh_attendance
language sql stable security definer set search_path = public as $fn$
  select * from deh_attendance where day = p_day;
$fn$;

create or replace function public.deh_attendance_set(
  p_day date, p_person_id text, p_status text, p_note text, p_by text)
returns void
language sql volatile security definer set search_path = public as $fn$
  insert into deh_attendance (day, person_id, status, note, updated_by, updated_at)
  values (p_day, p_person_id, coalesce(nullif(trim(p_status), ''), 'present'),
          nullif(trim(p_note), ''), nullif(trim(p_by), ''), now())
  on conflict (day, person_id) do update set
    status = excluded.status, note = excluded.note,
    updated_by = excluded.updated_by, updated_at = now();
$fn$;

grant execute on function public.deh_attendance_list(date) to anon, authenticated;
grant execute on function public.deh_attendance_set(date, text, text, text, text) to anon, authenticated;

-- ── Rehearsal notes ──────────────────────────────────────────────────────
-- Free text, filed against a day and a department, the way a stage manager
-- files notes to each design head.
create table if not exists deh_notes (
  note_id    text primary key,           -- client-generated, day|dept|counter
  day        date not null,
  dept       text not null default 'general',
  -- general|stage|music|scenic|lighting|sound|projection|sfx|props|costume|
  -- hair|wigs|safety. 'tech' and the combined 'costume / H&M' predate the
  -- split into separate design departments and are still read back.
  body       text not null,
  author     text,
  created_at timestamptz not null default now()
);
alter table deh_notes enable row level security;
create index if not exists deh_notes_day_idx on deh_notes (day);

create or replace function public.deh_notes_list(p_day date)
returns setof deh_notes
language sql stable security definer set search_path = public as $fn$
  select * from deh_notes where day = p_day order by created_at;
$fn$;

create or replace function public.deh_note_add(
  p_note_id text, p_day date, p_dept text, p_body text, p_author text)
returns void
language sql volatile security definer set search_path = public as $fn$
  insert into deh_notes (note_id, day, dept, body, author)
  values (p_note_id, p_day, coalesce(nullif(trim(p_dept), ''), 'general'),
          trim(p_body), nullif(trim(p_author), ''))
  on conflict (note_id) do update set
    dept = excluded.dept, body = excluded.body, author = excluded.author;
$fn$;

create or replace function public.deh_note_delete(p_note_id text)
returns void
language sql volatile security definer set search_path = public as $fn$
  delete from deh_notes where note_id = p_note_id;
$fn$;

grant execute on function public.deh_notes_list(date) to anon, authenticated;
grant execute on function public.deh_note_add(text, date, text, text, text) to anon, authenticated;
grant execute on function public.deh_note_delete(text) to anon, authenticated;

-- ── Report log ───────────────────────────────────────────────────────────
-- So the dashboard can say "already sent at 4:12pm by Danielle" instead of
-- letting four people each send CJ the same recap.
create table if not exists deh_reports (
  day      date primary key,
  sent_at  timestamptz not null default now(),
  sent_by  text,
  sent_to  text,
  summary  jsonb
);
alter table deh_reports enable row level security;

create or replace function public.deh_reports_list()
returns setof deh_reports
language sql stable security definer set search_path = public as $fn$
  select * from deh_reports order by day;
$fn$;

create or replace function public.deh_report_log(
  p_day date, p_by text, p_to text, p_summary jsonb)
returns void
language sql volatile security definer set search_path = public as $fn$
  insert into deh_reports (day, sent_at, sent_by, sent_to, summary)
  values (p_day, now(), nullif(trim(p_by), ''), p_to, p_summary)
  on conflict (day) do update set
    sent_at = now(), sent_by = excluded.sent_by,
    sent_to = excluded.sent_to, summary = excluded.summary;
$fn$;

grant execute on function public.deh_reports_list() to anon, authenticated;
grant execute on function public.deh_report_log(date, text, text, jsonb) to anon, authenticated;

-- ── Seed the roster with the creative team ───────────────────────────────
-- Cast names get added in the dashboard as they are cast. Roles come from
-- deh/scenes.js so attendance lines up with the scene breakdown.
insert into deh_roster (person_id, name, role, kind, sort) values
  ('staff-danielle', 'Danielle Sirinsky',  'Director / Choreographer', 'staff', 1),
  ('staff-shelby',   'Shelby Milgram',     'Vocal Director',           'staff', 2),
  ('staff-ryyana',   'Ryyana Cunningham',  'Assistant Director',       'staff', 3),
  ('staff-colton',   'Colton Sorensen',    'Technical Director',       'staff', 4),
  ('staff-tony',     'Tony Cimino-Johnson','Intimacy / Study track',   'staff', 5)
on conflict (person_id) do nothing;




-- ────────────────────────────────────────────────────────────────────
--  B.  Day camps at $79
-- ────────────────────────────────────────────────────────────────────

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



-- ────────────────────────────────────────────────────────────────────
--  C.  College audition coaching services
-- ────────────────────────────────────────────────────────────────────

-- College audition coaching, moved off the Regpack embed and into our own
-- registration system (Jul 31 2026).
--
-- WHAT THIS DOES
--   Creates one `activities` row per coaching service so /register/ can sell
--   them the same way it sells classes, camps, and shows. Ids are fixed in the
--   9701xx-9705xx block and are referenced by:
--     register/coaching.js            (what the Coaching page displays)
--     netlify/functions/reg-config.mjs (COACHING_ID_MIN/MAX pricing rules)
--     coaching.html                   (per-service "Register Now" links)
--
-- HOW TO RUN
--   Paste this file into the Supabase SQL editor on the Registration project
--   and hit Run. It is safe to re-run: existing rows are updated in place, so
--   a price change here is a price change on the site.
--
-- BEFORE YOU RUN
--   Column names below match what the site reads back through catalog_list
--   (id, name, category, price_cents, schedule_name, age_range, description,
--   bookable, bb_gated, capacity). If the table has picked up a NOT NULL
--   column since this was written, add it to the insert list rather than
--   dropping rows.
--
-- CAPACITY
--   Left null on purpose so a hold never fails on a missing inventory row.
--   Press Submit Weekend (970102) is genuinely capped at 12 seats; set that
--   cap here once its inventory row exists, or watch it in the dashboard.
--
-- PRICING NOTE
--   Coaching is flat priced. No sibling, tier, bundle, or combo discount, no
--   tuition insurance, pay in full at checkout. reg-config.mjs enforces all of
--   that server-side, so nothing here needs a discount flag.

insert into activities
  (id, name, category, price_cents, schedule_name, age_range, description, bookable, bb_gated, capacity)
values
  (970101, 'Full Audition Package Support', 'coaching', 325000, 'Approx. 30 hours of support across the season', null, 'Everything a college audition season needs, from the first school list to the last submitted application. Includes six private coaching sessions, three filmed and edited pre-screen videos, dance pre-screen coaching, essay and artistic statement work, a finished resume, and a full mock audition. This is the most complete package we offer.', true, false, null),
  (970102, 'Press Submit Weekend', 'coaching', 195000, 'Final weekend of August · Leesburg, VA · 12 students', null, 'Three days that take a student from nothing submitted to one application fully in. We film pre-screens for every school on the list, shoot professional headshots, coach essays and artistic statements, finish the resume and audition book, and run a parent workshop. Seats are capped at twelve and registration closes when it fills.', true, false, null),
  (970208, 'Consultation Session', 'coaching', 9000, '1 hour · in person or on Google Meet', null, 'A full hour to map out where a student stands and what the season should look like. Useful when fifteen minutes is not going to cover it. The free 15-minute consult is always available first if you would rather start there.', true, false, null),
  (970201, 'Tailored College Spreadsheet + GetAcceptd Support', 'coaching', 52500, '5–7 hours · highest return of any single service', null, 'A college list built around one student, not pulled off a generic ranking. Every school comes with its deadlines, prescreen requirements, and acceptance rates in one tracker you actually use. Includes GetAcceptd setup and support through the submission window.', true, false, null),
  (970202, 'Audition Room Readiness', 'coaching', 39000, 'Full mock audition experience', null, 'A real mock audition in front of a panel, run the way the schools run it. Slate, material, Q&A, and interview, then detailed written feedback the student can work from. The point is that audition day is not the first time it happens.', true, false, null),
  (970203, 'Essay & Artistic Statement Support', 'coaching', 52500, 'Approx. 4 hours · up to 3 essays · 2 rounds of edits', null, 'Help getting the Common App essay, school-specific prompts, and the artistic statement to sound like the student and not like a template. Up to three essays with two full rounds of edits on each.', true, false, null),
  (970204, 'Audition Book Creation + Audition Package', 'coaching', 32500, 'Approx. 3–4 hours', null, 'A school-ready audition binder built and organized so nothing goes missing on the day. Repertoire sheets, labeled cuts, and tabbed sections for each school on the list.', true, false, null),
  (970205, 'Industry Standard Resume Support & Creation', 'coaching', 19500, 'Approx. 2 hours · one full revision included', null, 'A performing arts resume in the format college panels expect, built from what the student has actually done. One full revision round is included so it stays current through the season.', true, false, null),
  (970206, 'Parent Support Session', 'coaching', 9000, '30 minutes, for the parent', null, 'A session for the parent, not the student. We walk the timeline, what the next few months actually look like, and how to help without taking over. Families often book this again in the spring when decisions land.', true, false, null),
  (970207, 'Single Session Support', 'coaching', 12000, 'per session · in person or on Google Meet', null, 'One session on whatever is in front of the student right now. Material, a deadline, a school-specific requirement, or a nerve that needs settling. No package required.', true, false, null),
  (970301, 'Pre-Screen Video', 'coaching', 21900, '1 video + 1 coaching session', null, 'One pre-screen package: a coaching session on the material, then a professionally filmed and edited take. Delivered labeled and ready to upload to the schools that want it.', true, false, null),
  (970302, 'Pre-Screen Videos (2)', 'coaching', 42500, '2 videos + coaching support', null, 'Two complete pre-screen packages with coaching, filming, and editing included. Most schools ask for a song and a monologue, which is what this covers.', true, false, null),
  (970303, 'Pre-Screen Videos (3)', 'coaching', 60000, '3 videos + coaching support', null, 'Three complete pre-screen packages with coaching, filming, and editing included. This is the usual answer for a musical theatre list: two contrasting songs and a monologue.', true, false, null),
  (970304, 'Pre-Screen Videos (4)', 'coaching', 79000, '4 videos + coaching support', null, 'Four complete pre-screen packages with coaching, filming, and editing included. Built for wide lists where schools ask for different material from each other.', true, false, null),
  (970305, 'Dance Pre-Screen Video', 'coaching', 40000, 'Custom choreography + 2 hours of support + filming', null, 'Custom choreography set on the student, two hours of coaching to get it in the body, then a professionally filmed and edited take. Labeled for whichever schools require a dance call on video.', true, false, null),
  (970401, '1 Acting Coaching Session', 'coaching', 12000, '50 minutes', null, 'One private fifty minute session on a monologue or a song. We work technique and specificity, then how it reads in an audition room.', true, false, null),
  (970402, '3-Pack Acting Coaching Sessions', 'coaching', 35000, '3 × 50 minutes · about $117 each', null, 'Three private sessions at a slightly better rate than booking them one at a time. Sessions can be combined back to back when a deadline is close.', true, false, null),
  (970403, '6-Pack Acting Coaching Sessions', 'coaching', 66000, '6 × 50 minutes · $110 each', null, 'Six private sessions, enough to carry a student through a full audition cycle. Best per session rate short of the ten pack.', true, false, null),
  (970404, '10-Pack Acting Coaching Sessions', 'coaching', 105000, '10 × 50 minutes · $105 each', null, 'Ten private sessions and the lowest per session rate we offer. Room to build several pieces across styles, then revisit and sharpen them before audition day.', true, false, null),
  (970501, 'Logo Design', 'coaching', 35000, 'Includes intake and design delivery', null, 'A custom logo built from an intake session about the artist and the work. Delivered as packaged files ready for a website, a headshot back, or a program.', true, false, null),
  (970502, 'Business Card Design + Logo Design', 'coaching', 52500, 'Logo + business card + branding packet', null, 'A custom logo and a matching business card, delivered as one branding packet. What you hand across the table at a conference or a callback.', true, false, null),
  (970503, 'Brand Evaluation + Social Media Support', 'coaching', 52500, 'Approx. 4 hours · 15 post templates included', null, 'A full audit of how an artist currently reads online, refreshed bio copy, and a content strategy that fits the actual career. Fifteen ready to use post templates come with it.', true, false, null),
  (970504, 'Portfolio Website + Custom Domain', 'coaching', 129700, 'Up to 3 pages · custom domain · full handoff', null, 'A portfolio site with bio, gallery, resume, reel, and contact, on a custom domain. Up to three pages, handed off in full so the artist can manage it after launch.', true, false, null),
  (970505, 'Full Brand Package', 'coaching', 199700, 'Website + logo + business card + social media', null, 'Everything on this list in one build: portfolio website, logo, business card, and social media strategy with templates. One visual identity that holds together across every platform.', true, false, null)
on conflict (id) do update set
  name          = excluded.name,
  category      = excluded.category,
  price_cents   = excluded.price_cents,
  schedule_name = excluded.schedule_name,
  age_range     = excluded.age_range,
  description   = excluded.description,
  bookable      = excluded.bookable,
  bb_gated      = excluded.bb_gated,
  capacity      = excluded.capacity;

-- Sanity check: 24 rows, every one bookable and priced.
select id, name, price_cents, schedule_name
from activities
where category = 'coaching'
order by id;



-- ────────────────────────────────────────────────────────────────────────
--  VERIFICATION — read this table. Every row should say OK.
-- ────────────────────────────────────────────────────────────────────────
select 'DEH check-offs'      as thing,
       case when to_regclass('public.deh_progress')   is null then 'MISSING' else 'OK' end as status,
       coalesce((select count(*)::text from deh_progress), '0') || ' rows' as detail
union all
select 'DEH sourcing + cost',
       case when to_regclass('public.deh_items')      is null then 'MISSING' else 'OK' end,
       coalesce((select count(*)::text from deh_items), '0') || ' rows'
union all
select 'DEH roster',
       case when to_regclass('public.deh_roster')     is null then 'MISSING' else 'OK' end,
       coalesce((select count(*)::text from deh_roster where active), '0') || ' people'
union all
select 'DEH attendance',
       case when to_regclass('public.deh_attendance') is null then 'MISSING' else 'OK' end,
       coalesce((select count(*)::text from deh_attendance), '0') || ' rows'
union all
select 'DEH rehearsal notes',
       case when to_regclass('public.deh_notes')      is null then 'MISSING' else 'OK' end,
       coalesce((select count(*)::text from deh_notes), '0') || ' notes'
union all
select 'DEH report log',
       case when to_regclass('public.deh_reports')    is null then 'MISSING' else 'OK' end,
       coalesce((select count(*)::text from deh_reports), '0') || ' sent'
union all
select 'Day camps at $79',
       case when (select count(*) from activities
                  where category = 'camp' and price_cents <= 20000
                    and price_cents <> 7900) > 0 then 'CHECK' else 'OK' end,
       (select count(*)::text from activities
        where category = 'camp' and price_cents <= 20000) || ' day camps'
union all
select 'Coaching services',
       case when (select count(*) from activities where category = 'coaching') < 24
            then 'CHECK' else 'OK' end,
       (select count(*)::text from activities where category = 'coaching') || ' of 24 loaded'
union all
select 'Dashboard functions',
       case when (select count(*) from pg_proc
                  where proname in ('deh_progress_list','deh_items_list','deh_roster_list',
                                    'deh_attendance_list','deh_notes_list','deh_reports_list')) = 6
            then 'OK' else 'MISSING' end,
       (select count(*)::text from pg_proc
        where proname in ('deh_progress_list','deh_items_list','deh_roster_list',
                          'deh_attendance_list','deh_notes_list','deh_reports_list')) || ' of 6'
order by 1;
