-- Shared check-offs for the Dear Evan Hansen staff dashboard (/deh/).
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

-- What the staff have checked off so far.
select block_id, done_by, done_at from deh_progress where done order by block_id;
