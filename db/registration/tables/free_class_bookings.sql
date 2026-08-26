-- Free class funnel (novapa.org/free-class), Aug 2026.
-- One row per booked free rehearsal visit. Written only by the
-- reg-freeclass Netlify function with the service key; RLS stays closed.
create table if not exists public.free_class_bookings (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  parent_name  text not null,
  email        text not null,
  phone        text,
  child_name   text not null,
  child_age    int  not null,
  cast_key     text not null check (cast_key in ('kids','jr','teens')),
  activity_id  bigint not null,
  class_date   date not null,
  status       text not null default 'booked' check (status in ('booked','cancelled','attended')),
  utm          jsonb,
  notes        text
);
create index if not exists free_class_bookings_date_idx on public.free_class_bookings (class_date, cast_key) where status = 'booked';
create index if not exists free_class_bookings_email_idx on public.free_class_bookings (lower(email));
alter table public.free_class_bookings enable row level security;
