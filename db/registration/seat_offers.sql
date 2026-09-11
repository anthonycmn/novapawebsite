-- Seat offers: a staff-issued pass that lets ONE family past a full cast
-- (Sep 11 2026, per CJ — "I want the ability to overfill a class if I need
-- to"). The alternative was raising capacity by one and hoping the family
-- paid before a stranger on the site took the seat; this keeps the public
-- count where it is and opens the door for the person the office chose.
--
-- How it travels: the staff portal mints a row (portal_offer_seat, migration
-- 0271 over there) and emails the family a link carrying the token —
--   /register/?activity=<id>&seat=<token>
-- The register page peeks at the token, unlocks that one activity, and puts
-- `seat_offer` on the hold item. acquire_hold_guest / acquire_hold_v2 count a
-- usable offer as a seat that does not need to exist; confirm_order stamps it
-- redeemed once the money lands. /api/frozen-pay does the same with its own
-- hold insert. An offer with no `seat_offer` on the item is just not there,
-- so every existing caller behaves exactly as before.
--
-- Bound to an email as well as an activity, so a forwarded link is a dead
-- link: the seat was offered to a family, not to whoever holds the URL. One
-- offer is one seat, and it is spent by the first order that carries it.
--
-- RLS on, no policies: anon reads only through seat_offer_peek, the checkout
-- functions and the portal RPCs are SECURITY DEFINER, and the service key
-- reaches it from the Netlify functions.

create table if not exists public.seat_offers (
  id            uuid primary key default gen_random_uuid(),
  activity_id   bigint not null references public.activities(id),
  email         text not null,
  camper_name   text,
  parent_name   text,
  -- the waitlist row this offer answers, when there is one
  waitlist_id   uuid references public.cast_waitlist(id) on delete set null,
  -- two v4 uuids with the dashes out: 64 hex chars, unguessable, no pgcrypto
  token         text not null unique
                default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  issued_by     text not null,
  issued_at     timestamptz not null default now(),
  expires_at    timestamptz not null,
  emailed_at    timestamptz,
  redeemed_at   timestamptz,
  order_id      uuid references public.orders(id),
  revoked_at    timestamptz
);
create index if not exists seat_offers_activity_idx on public.seat_offers (activity_id);
create index if not exists seat_offers_email_idx on public.seat_offers (lower(email));
alter table public.seat_offers enable row level security;

-- The one question the checkout asks: may THIS token seat THIS email in THIS
-- activity right now? Every condition in one place so the hold functions and
-- frozen-pay cannot drift apart on what "usable" means.
create or replace function public.seat_offer_usable(p_token text, p_activity_id bigint, p_email text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from seat_offers o
    where o.token = p_token
      and o.activity_id = p_activity_id
      and lower(o.email) = lower(trim(coalesce(p_email, '')))
      and o.redeemed_at is null
      and o.revoked_at is null
      and o.expires_at > now()
  );
$$;
revoke all on function public.seat_offer_usable(text, bigint, text) from public, anon, authenticated;
grant execute on function public.seat_offer_usable(text, bigint, text) to service_role;

-- What the register page asks when it lands with ?seat=. Enough to unlock
-- the right activity and prefill the address the offer is bound to; the
-- state tells the page which sentence to show when the link is no good.
create or replace function public.seat_offer_peek(p_token text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((
    select jsonb_build_object(
      'activity_id',   o.activity_id,
      'activity_name', a.name,
      'email',         o.email,
      'camper_name',   o.camper_name,
      'expires_at',    o.expires_at,
      'state', case
        when o.redeemed_at is not null then 'redeemed'
        when o.revoked_at  is not null then 'revoked'
        when o.expires_at <= now()     then 'expired'
        else 'open' end)
    from seat_offers o
    join activities a on a.id = o.activity_id
    where o.token = p_token
  ), jsonb_build_object('state', 'unknown'));
$$;
grant execute on function public.seat_offer_peek(text) to anon, authenticated, service_role;
