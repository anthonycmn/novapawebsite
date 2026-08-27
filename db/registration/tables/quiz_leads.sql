-- Quiz funnel (novapa.org/quiz), Aug 2026.
-- One row per completed quiz lead (contact gate or the funnel-1 silent
-- submit). Written only by the reg-quiz Netlify function with the service
-- key; RLS stays closed.
create table if not exists public.quiz_leads (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  parent_name  text not null,
  email        text not null,
  child_name   text,
  age_band     text,     -- q1 answer: 5-8 / 9-12 / 13-17
  answers      jsonb,    -- { q1..q5 } raw option values
  persona      text,     -- result persona name shown to the parent
  source       text,     -- 'quiz-funnel'; 'local test' for test rows
  utm          jsonb
);
create index if not exists quiz_leads_email_idx on public.quiz_leads (lower(email));
alter table public.quiz_leads enable row level security;
