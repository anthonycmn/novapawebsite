-- Mail health tables, Sep 24 2026. For CJ to run once in the Supabase SQL
-- editor (project tlkuqwsqicxcjdmumkje). Creates three empty tables; expected
-- row count 0 in each. Safe to run before or after the code deploys: until the
-- tables exist every writer logs "not written" and carries on.
--
-- Why: Resend refused every mail.novapa.org send for 33 hours (Sep 23-24,
-- "domain is not verified") and nothing noticed. reg-webhook caught both
-- failed sends, logged them to a function log nobody reads, and returned 200.
-- All three tables are written only by Netlify functions with the service
-- key; RLS stays closed and there are no policies.

-- One row per failed send that a caller survived (reg-webhook's office alert
-- and family confirmation). order_id is text, not a foreign key: a failure
-- log must never fail on a constraint.
create table if not exists public.mail_failures (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  fn              text not null,          -- 'reg-webhook'
  kind            text not null,          -- 'admin_notify' | 'family_confirmation'
  order_id        text,
  payment_intent  text,
  error           text not null           -- e.g. 'resend 403: {...not verified...}'
);
create index if not exists mail_failures_created_idx on public.mail_failures (created_at desc);
alter table public.mail_failures enable row level security;

-- Last-seen stamp per scheduled function (reg-heartbeat.mjs), one row per
-- function, upserted on every run.
create table if not exists public.function_heartbeats (
  fn        text primary key,
  last_run  timestamptz not null,
  last_ok   timestamptz,                  -- only moves on a good run
  status    text not null,                -- 'ok' | 'error'
  detail    text
);
alter table public.function_heartbeats enable row level security;

-- Hourly mail snapshot (reg-mail-telemetry.mjs), append only.
create table if not exists public.mail_telemetry (
  id           bigint generated always as identity primary key,
  captured_at  timestamptz not null default now(),
  source       text not null,             -- 'resend-domains'
  ok           boolean not null,
  data         jsonb not null default '{}'::jsonb
);
create index if not exists mail_telemetry_source_idx on public.mail_telemetry (source, captured_at desc);
alter table public.mail_telemetry enable row level security;
