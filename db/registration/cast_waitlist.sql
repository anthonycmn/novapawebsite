-- Per-cast waitlist for full activities (Aug 31 2026, per Jason — Frozen
-- bands capped at 40, Jr sitting at 2 remaining). NOT the same thing as
-- public.waitlist: that older table is the returning-families-gate email
-- capture ("we couldn't find that email", join_waitlist RPC) and keeps its
-- shape.
--
-- Written only by reg-waitlist.mjs with the service key; the unique
-- constraint is what makes joining idempotent, so the function can insert
-- with ignore-duplicates and only email on a genuinely new row. email is
-- stored lowercased and camper_name trimmed by the function.
create table if not exists public.cast_waitlist (
  id uuid primary key default gen_random_uuid(),
  activity_id bigint not null references public.activities(id),
  email text not null,
  parent_name text,
  camper_name text not null,
  created_at timestamptz not null default now(),
  -- stamped when staff offer the spot, so the same family is never offered twice
  notified_at timestamptz,
  unique (activity_id, email, camper_name)
);
alter table public.cast_waitlist enable row level security;
