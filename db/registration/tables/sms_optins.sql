-- SMS opt-ins (novapa.org/sms), Sep 2026 — Telnyx 10DLC compliance.
-- One row per opt-in event from the public /sms form (and a mirror of
-- checkout opt-ins where useful). consent_text stores the EXACT language
-- the person agreed to — carrier audits and TCPA disputes are settled by
-- that column, so never write a row without it. Written only by the
-- reg-sms-optin Netlify function with the service key; RLS stays closed.
create table if not exists public.sms_optins (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  phone         text not null,          -- as typed; digits-only in phone_e164
  phone_digits  text not null,          -- normalized digits, US 10 or 11
  email         text,
  name          text,
  consent       boolean not null default true,
  consent_text  text not null,          -- exact opt-in language shown
  source        text not null,          -- 'sms-page' | 'register-checkout'
  ip            text,
  user_agent    text
);
create index if not exists sms_optins_phone_idx on public.sms_optins (phone_digits);
create index if not exists sms_optins_email_idx on public.sms_optins (lower(email));
alter table public.sms_optins enable row level security;
