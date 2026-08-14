-- Internal ticketing: the BookTix replacement.
--
-- Why these are separate tables rather than rows in `activities`: a ticket is
-- per-seat inventory (432 distinct sellable things per performance), while an
-- activity is per-headcount (capacity minus sold). Forcing seats through the
-- camp tables would have meant special-casing every counter we just spent a
-- day making truthful. Tickets get their own small, boring schema, and the
-- only shared machinery is Stripe and the webhook.
--
-- Seat map cloned from BookTix (novapa.booktix.com, DEH event, Aug 14 2026),
-- extracted from their seat-map DOM, not eyeballed: 18 rows (A-U skipping
-- I, L, O), 24 seats per row, odd numbers House Left, even House Right,
-- 12 a side, seat 1/2 nearest the center aisle. 432 seats total.

create table if not exists tix_shows (
  id          bigserial primary key,
  slug        text unique not null,           -- 'sweeney-todd'
  title       text not null,
  subtitle    text,
  description text,
  poster_url  text,
  content_warning text,
  policy      text,                           -- shown at checkout, cloned from BookTix
  venue_name  text not null default 'Loudoun Auditorium, Northern Virginia Conference Center',
  venue_notes text,
  run_time    text,
  on_sale     boolean not null default false, -- master switch; page 404s when false
  created_at  timestamptz not null default now()
);

create table if not exists tix_performances (
  id          bigserial primary key,
  show_id     bigint not null references tix_shows(id),
  starts_at   timestamptz not null,
  label       text,                           -- 'Halloween matinee' etc, optional
  status      text not null default 'onsale'  -- onsale | paused | soldout | done
);

-- The physical house. One row per seat, shared by every show in this venue.
create table if not exists tix_seats (
  id       bigserial primary key,
  venue    text not null default 'loudoun',
  section  text not null,                     -- 'HL' | 'HR'
  row_label text not null,
  seat_no  int  not null,
  tier     text not null,                     -- Purple | Green | Blue | Yellow
  unique (venue, section, row_label, seat_no)
);

-- Per-show pricing so a future show can reprice tiers without touching seats.
create table if not exists tix_tiers (
  id          bigserial primary key,
  show_id     bigint not null references tix_shows(id),
  name        text not null,                  -- matches tix_seats.tier
  color       text not null,                  -- hex for the map UI
  price_cents int  not null,
  fee_cents   int  not null default 0,        -- our per-ticket fee; 0 until Jason decides
  unique (show_id, name)
);

-- Short-lived seat holds while a buyer is in checkout. Mirrors the camp holds
-- pattern: acquire atomically, expire quietly, confirm on webhook.
create table if not exists tix_holds (
  id         uuid primary key default gen_random_uuid(),
  performance_id bigint not null references tix_performances(id),
  seat_ids   bigint[] not null,
  email      text not null,
  expires_at timestamptz not null,
  status     text not null default 'active'   -- active | confirmed | released
);

create table if not exists tix_orders (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  buyer_name  text,
  performance_id bigint not null references tix_performances(id),
  total_cents int not null,
  stripe_payment_intent text unique,
  code        text not null,                  -- short human code for the box office
  status      text not null default 'paid',
  created_at  timestamptz not null default now()
);

-- One row per seat sold. The UNIQUE(performance_id, seat_id) constraint is the
-- actual oversell guard: two webhooks racing on the same seat cannot both win.
create table if not exists tix_tickets (
  id          bigserial primary key,
  order_id    uuid not null references tix_orders(id),
  performance_id bigint not null references tix_performances(id),
  seat_id     bigint not null references tix_seats(id),
  price_cents int not null,
  unique (performance_id, seat_id)
);

create index if not exists tix_tickets_perf on tix_tickets(performance_id);
create index if not exists tix_holds_perf on tix_holds(performance_id) where status = 'active';

-- RLS: everything through SECURITY DEFINER RPCs and the service role, same
-- posture as the registration tables.
alter table tix_shows enable row level security;
alter table tix_performances enable row level security;
alter table tix_seats enable row level security;
alter table tix_tiers enable row level security;
alter table tix_holds enable row level security;
alter table tix_orders enable row level security;
alter table tix_tickets enable row level security;

-- ---------------------------------------------------------------------------
-- Seed: the Loudoun house (idempotent).
insert into tix_seats (venue, section, row_label, seat_no, tier)
select 'loudoun', s.section, r.row_label, s.seat_no,
  case
    when r.row_label in ('A','B','C','D') then 'Purple'
    when r.row_label in ('E','F','G','H','J') then 'Green'
    when r.row_label in ('K','M','N','P','Q') then 'Blue'
    else 'Yellow'                              -- R, S, T, U
  end
from (values ('A'),('B'),('C'),('D'),('E'),('F'),('G'),('H'),('J'),
             ('K'),('M'),('N'),('P'),('Q'),('R'),('S'),('T'),('U')) r(row_label)
cross join lateral (
  select 'HL' as section, n as seat_no from generate_series(1, 23, 2) n
  union all
  select 'HR', n from generate_series(2, 24, 2) n
) s
on conflict (venue, section, row_label, seat_no) do nothing;

-- Seed: Sweeney Todd + 7 performances + tier pricing (idempotent).
insert into tix_shows (slug, title, subtitle, description, content_warning, policy, venue_notes, run_time, on_sale)
values (
  'sweeney-todd',
  'Sweeney Todd: School Edition',
  'A NoVAPA Teen Conservatory Production',
  'Stephen Sondheim''s thrilling masterpiece comes to the Loudoun Auditorium — seven performances across two weekends, including a Halloween matinee.',
  'CONTENT ADVISORY: Sweeney Todd features stage violence, blood effects, and mature themes. School Edition. Recommended for ages 13 and up.',
  'All ticket purchases are non-refundable and non-transferable. Once a ticket has been purchased, it cannot be refunded, exchanged, or transferred to another individual or event for any reason. Please ensure that all purchase details are correct before completing your transaction. By completing your purchase, you acknowledge and agree to this policy.',
  'ALL PERFORMANCES ARE IN THE LOUDOUN AUDITORIUM. The auditorium is located between the ballroom and the hotel lobby. Once inside the building you will see signs directing you to the auditorium. Please park in the parking garage.',
  '2h 45m',
  false                                        -- OFF until Jason flips it
)
on conflict (slug) do nothing;

insert into tix_performances (show_id, starts_at, label)
select s.id, p.t::timestamptz, p.lbl
from tix_shows s,
 (values ('2026-10-23 19:00-04', null),
         ('2026-10-24 14:00-04', null),
         ('2026-10-24 19:00-04', null),
         ('2026-10-25 14:00-04', null),
         ('2026-10-30 19:00-04', null),
         ('2026-10-31 14:00-04', 'Halloween matinee'),
         ('2026-11-01 14:00-05', 'Closing')) p(t, lbl)
where s.slug = 'sweeney-todd'
  and not exists (select 1 from tix_performances x
                  where x.show_id = s.id and x.starts_at = p.t::timestamptz);

insert into tix_tiers (show_id, name, color, price_cents, fee_cents)
select s.id, t.name, t.color, t.cents, 0
from tix_shows s,
 (values ('Purple', '#9333ea', 3000),
         ('Green',  '#86ca2e', 2500),
         ('Blue',   '#21a6e6', 2300),
         ('Yellow', '#fbbf24', 2000)) t(name, color, cents)
where s.slug = 'sweeney-todd'
on conflict (show_id, name) do nothing;
