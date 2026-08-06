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

-- What the staff have checked off so far.
select block_id, done_by, done_at from deh_progress where done order by block_id;

-- Where the money is going.
select item_id, status, vendor, price_cents, qty, (price_cents * qty) as line_cents, updated_by
from deh_items order by item_id;

-- Who is on the roster.
select person_id, name, role, kind from deh_roster where active order by kind, sort;
