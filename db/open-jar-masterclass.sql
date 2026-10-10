-- Open Jar Institute masterclass with Brian Martin (Oct 15 2026).
-- Originally listed with James Gray; the teacher changed to Brian Martin on
-- Oct 9 2026 and the live row was renamed then. This file matches the live row.
--
-- Requested by Jennifer Travis on Oct 3 2026; price and time confirmed by CJ
-- on Oct 5: $10, Thursday October 15, 6:00 to 7:30 PM.
--
-- Registration link: https://novapa.org/register/?activity=970701
--
-- offering_kind 'coaching' on purpose: that is the flat-price path in
-- reg-config.mjs. Pay in full, no sibling/tier/bundle discount, no insurance.
-- Left null, a $10 item would be inferred a "day camp" (price <= $200) and a
-- family holding day-camp pack credits would get it for $0.
--
-- registration_closes_at is start time, so it stops selling once it begins.
-- Safe to re-run.

insert into activities
  (id, name, category, offering_kind, price_cents, schedule_name, age_range,
   description, location, bookable, bb_gated, capacity, starts_on, ends_on,
   meets_start, meets_end, registration_closes_at, raw)
values
  (970701, 'Open Jar Masterclass with Brian Martin', 'coaching', 'coaching', 1000,
   'Thursday, October 15, 2026 · 6:00 to 7:30 PM', null,
   'A masterclass with Brian Martin of New York''s Open Jar Institute, the Broadway training program that puts students in the room with working professionals.',
   'NoVAPA at the National Conference Center, South Building, Plaza C, 18945 Conference Center Drive, Leesburg, VA 20176',
   true, false, null, '2026-10-15', '2026-10-15',
   '18:00', '19:30', '2026-10-15 18:00:00-04', '{"source":"novapa","created_by":"novapa","requested_by":"Jennifer Travis"}'::jsonb)
on conflict (id) do update set
  name = excluded.name, category = excluded.category, offering_kind = excluded.offering_kind,
  price_cents = excluded.price_cents, schedule_name = excluded.schedule_name,
  age_range = excluded.age_range, description = excluded.description,
  location = excluded.location, bookable = excluded.bookable, bb_gated = excluded.bb_gated,
  capacity = excluded.capacity, starts_on = excluded.starts_on, ends_on = excluded.ends_on,
  meets_start = excluded.meets_start, meets_end = excluded.meets_end,
  registration_closes_at = excluded.registration_closes_at;

do $chk$
begin
  if not exists (select 1 from activities where id = 970701 and price_cents = 1000
                 and offering_kind = 'coaching' and bookable and not hidden) then
    raise exception 'Open Jar masterclass row is not live at $10';
  end if;
end $chk$;
