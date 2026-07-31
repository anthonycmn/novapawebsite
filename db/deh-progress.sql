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
  link        text,
  price_cents int  not null default 0,        -- UNIT price; multiply by qty for the line
  qty         int  not null default 1,
  updated_by  text,
  updated_at  timestamptz not null default now()
);
alter table deh_items enable row level security;

create or replace function public.deh_items_list()
returns setof deh_items
language sql stable security definer set search_path = public as $fn$
  select * from deh_items;
$fn$;

create or replace function public.deh_item_set(
  p_item_id text, p_status text, p_vendor text, p_link text,
  p_price_cents int, p_qty int, p_by text)
returns void
language sql volatile security definer set search_path = public as $fn$
  insert into deh_items (item_id, status, vendor, link, price_cents, qty, updated_by, updated_at)
  values (p_item_id,
          coalesce(nullif(trim(p_status), ''), 'todo'),
          nullif(trim(p_vendor), ''),
          nullif(trim(p_link), ''),
          greatest(coalesce(p_price_cents, 0), 0),
          greatest(coalesce(p_qty, 1), 1),
          nullif(trim(p_by), ''), now())
  on conflict (item_id) do update set
    status      = excluded.status,
    vendor      = excluded.vendor,
    link        = excluded.link,
    price_cents = excluded.price_cents,
    qty         = excluded.qty,
    updated_by  = excluded.updated_by,
    updated_at  = now();
$fn$;

grant execute on function public.deh_items_list() to anon, authenticated;
grant execute on function public.deh_item_set(text, text, text, text, int, int, text) to anon, authenticated;

-- What the staff have checked off so far.
select block_id, done_by, done_at from deh_progress where done order by block_id;

-- Where the money is going.
select item_id, status, vendor, price_cents, qty, (price_cents * qty) as line_cents, updated_by
from deh_items order by item_id;
