-- DC Unifieds 2026 (Oct 15-18) — sellable through our own checkout instead of
-- the dead Sawyer links on dcunifieds.com. Same entity, CJ Creative LLC.
--
-- Prices are the homepage numbers, which Jason chose as authoritative on
-- Aug 13 2026 after the site was found advertising two different sets (the
-- homepage said $695/$295, the other 14 pages said $629/$280).
--
-- Ids sit in the coaching range (970000-979999) deliberately: reg-config.mjs
-- routes that range through isCoachingId(), which keeps these OUT of the
-- camp/show tier discounts, the sibling 5%, tuition insurance and the day-camp
-- FSA flag. A family with two summer camps must not get 15% off a $995
-- unifieds seat.
--
-- Capacity 300 is the venue cap Jason confirmed; the goal is 100 attendees.
-- Venue address is 18665 (NOT the 18945 Plaza C used by NOVAPA programs) —
-- confirmed correct for this event.

INSERT INTO public.activities
  (id, name, category, price_cents, capacity, schedule_name, age_range,
   location, bookable, hidden, active, bb_gated, sold, raw)
VALUES
  (970601, 'DC Unifieds 2026 | In Person', 'coaching', 99500, 300,
   'Oct 15-18, 2026 | In person, National Conference Center', '13 – 18 yrs',
   'National Conference Center, 18665 Conference Center Drive, Leesburg, VA 20176',
   true, false, true, false, 0, '{"source":"dcunifieds.com","created_by":"novapa"}'::jsonb),
  (970602, 'DC Unifieds 2026 | Virtual Live', 'coaching', 69500, 300,
   'Live virtual callbacks Oct 24-25, 2026', '13 – 18 yrs',
   'Online', true, false, true, false, 0, '{"source":"dcunifieds.com","created_by":"novapa"}'::jsonb),
  (970603, 'DC Unifieds 2026 | Virtual', 'coaching', 29500, 300,
   'Asynchronous submission, reviewed by every attending college', '13 – 18 yrs',
   'Online', true, false, true, false, 0, '{"source":"dcunifieds.com","created_by":"novapa"}'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, price_cents = EXCLUDED.price_cents,
  capacity = EXCLUDED.capacity, schedule_name = EXCLUDED.schedule_name,
  location = EXCLUDED.location, bookable = EXCLUDED.bookable;
