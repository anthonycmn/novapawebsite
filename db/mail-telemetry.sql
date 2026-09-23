-- Mail telemetry and function heartbeats: what the cloud agents cannot see.
--
-- Why this exists. The NOVAPA agents run as Claude Code cloud routines since
-- 16 Sep 2026. They read Supabase fine. They cannot reach api.resend.com (the
-- session egress allowlist refuses it, and no agent holds a Resend key), and
-- they cannot read Netlify function logs. So four facts the email marketing
-- agent needs every morning have been reported as Data gaps every day since
-- the cloud move: bounce and complaint rate, sending domain status as Resend
-- itself reports it, whether the hourly watchdog actually fires, and whether
-- the parent portal's newsletter carries an unsubscribe link.
--
-- All four are visible from inside the website's Netlify runtime, which
-- already holds RESEND_API_KEY and already talks to Resend every day. So the
-- runtime writes them here on a schedule and the agent reads them with SQL.
-- No key ever leaves Netlify and no agent is handed one.
--
-- Written by reg-mail-telemetry.mjs (hourly) and reg-heartbeat.mjs.
-- Read-only for every agent.
--
-- Idempotent: safe to run twice.

-- ---------------------------------------------------------------------------
-- 1. Telemetry snapshots. One row per collector run, newest wins.
--
-- data is whatever the collector could read this run, including its own
-- failures: a key that 401s and an endpoint that 404s are both facts worth
-- keeping, because "we could not read it" beats a silently missing number.

create table if not exists public.mail_telemetry (
  id          bigint generated always as identity primary key,
  captured_at timestamptz not null default now(),
  source      text        not null,
  ok          boolean     not null default true,
  data        jsonb       not null default '{}'::jsonb
);

create index if not exists mail_telemetry_captured_idx
  on public.mail_telemetry (source, captured_at desc);

comment on table public.mail_telemetry is
  'Snapshots of what only the Netlify runtime can see: Resend domain status, recent-event tallies, and the portal newsletter unsubscribe-link check. Written hourly by netlify/functions/reg-mail-telemetry.mjs. Agents read it instead of the Resend dashboard.';
comment on column public.mail_telemetry.source is
  'Which collector wrote the row: resend-domains, resend-events, portal-unsub-check.';
comment on column public.mail_telemetry.ok is
  'False when the collector could not read its source. data.error then says why. A false row is a real answer, not a missing one.';

-- ---------------------------------------------------------------------------
-- 2. Function heartbeats. One row per scheduled run, so silence is legible.
--
-- A scheduled Netlify function that finds nothing to do returns 200 and says
-- nothing anywhere an agent can read. That is indistinguishable from a
-- function that stopped firing. reg-send-watch has been in exactly that state
-- all week: its counters were honestly zero, and no run could prove it ran.

-- No run counter on purpose. beat() upserts one row per function, so a
-- counter would need a read-modify-write that two overlapping runs could lose,
-- and a column that is always 0 reads like data when it is not. The stamp is
-- the signal: last_run against the function's own schedule.

create table if not exists public.function_heartbeats (
  fn        text        primary key,
  last_run  timestamptz not null default now(),
  last_ok   timestamptz,
  status    text,
  detail    text
);

comment on table public.function_heartbeats is
  'Last-seen stamp per scheduled Netlify function, written by reg-heartbeat.mjs at the end of each run. Lets an agent tell "nothing to do" apart from "no longer firing" without reading Netlify logs.';
comment on column public.function_heartbeats.status is
  'ok, or a short failure word. Never a stack trace and never a recipient address.';
comment on column public.function_heartbeats.detail is
  'One short line, the same text the function returns to Netlify, e.g. "drip 0/h 0/d, campaigns 0/h".';

-- ---------------------------------------------------------------------------
-- 3. Lock both tables down. Service role writes, nobody else reads.
--
-- Agents read through the MCP, which uses a privileged connection, so no
-- anon or authenticated policy is needed. Leaving RLS on with no policy is
-- the deny-by-default the website's own tables use.

alter table public.mail_telemetry     enable row level security;
alter table public.function_heartbeats enable row level security;

-- ---------------------------------------------------------------------------
-- 4. Confirm.

select 'mail_telemetry'      as table_name, count(*) as rows from public.mail_telemetry
union all
select 'function_heartbeats', count(*)                       from public.function_heartbeats;
