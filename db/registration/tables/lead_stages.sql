-- Kanban stage for NOVAPA-side funnel leads, Aug 2026.
-- quiz_leads and free_class_bookings are append-only capture tables with no
-- stage column, and the leads board needs somewhere to remember a drag. Kept
-- as a side table keyed by (board, lead_id) so the capture tables stay
-- untouched and a second board can be added without another migration.
-- DCU leads are NOT stored here — that project owns its own stage column and
-- its coaches drag the same people on their own board.
-- Written only by the reg-leads Netlify function with the service key; RLS
-- stays closed.
create table if not exists public.lead_stages (
  board       text not null,          -- 'quiz' | 'free' (matches the reg-leads key prefix)
  lead_id     text not null,          -- text, not bigint: keeps room for non-numeric ids
  stage       text not null default 'new',
  updated_at  timestamptz not null default now(),
  updated_by  text,                   -- admin email that made the move
  primary key (board, lead_id)
);
alter table public.lead_stages enable row level security;
