-- College audition coaching, moved off the Regpack embed and into our own
-- registration system (Jul 31 2026).
--
-- WHAT THIS DOES
--   Creates one `activities` row per coaching service so /register/ can sell
--   them the same way it sells classes, camps, and shows. Ids are fixed in the
--   9701xx-9705xx block and are referenced by:
--     register/coaching.js            (what the Coaching page displays)
--     netlify/functions/reg-config.mjs (COACHING_ID_MIN/MAX pricing rules)
--     coaching.html                   (per-service "Register Now" links)
--
-- HOW TO RUN
--   Paste this file into the Supabase SQL editor on the Registration project
--   and hit Run. It is safe to re-run: existing rows are updated in place, so
--   a price change here is a price change on the site.
--
-- BEFORE YOU RUN
--   Column names below match what the site reads back through catalog_list
--   (id, name, category, price_cents, schedule_name, age_range, description,
--   bookable, bb_gated, capacity). If the table has picked up a NOT NULL
--   column since this was written, add it to the insert list rather than
--   dropping rows.
--
-- CAPACITY
--   Left null on purpose so a hold never fails on a missing inventory row.
--   Press Submit Weekend (970102) is genuinely capped at 12 seats; set that
--   cap here once its inventory row exists, or watch it in the dashboard.
--
-- PRICING NOTE
--   Coaching is flat priced. No sibling, tier, bundle, or combo discount, no
--   tuition insurance, pay in full at checkout. reg-config.mjs enforces all of
--   that server-side, so nothing here needs a discount flag.

insert into activities
  (id, name, category, price_cents, schedule_name, age_range, description, bookable, bb_gated, capacity)
values
  (970101, 'Full Audition Package Support', 'coaching', 325000, 'Approx. 30 hours of support across the season', null, 'Everything a college audition season needs, from the first school list to the last submitted application. Includes six private coaching sessions, three filmed and edited pre-screen videos, dance pre-screen coaching, essay and artistic statement work, a finished resume, and a full mock audition. This is the most complete package we offer.', true, false, null),
  (970102, 'Press Submit Weekend', 'coaching', 195000, 'Final weekend of August · Leesburg, VA · 12 students', null, 'Three days that take a student from nothing submitted to one application fully in. We film pre-screens for every school on the list, shoot professional headshots, coach essays and artistic statements, finish the resume and audition book, and run a parent workshop. Seats are capped at twelve and registration closes when it fills.', true, false, null),
  (970208, 'Consultation Session', 'coaching', 9000, '1 hour · in person or on Google Meet', null, 'A full hour to map out where a student stands and what the season should look like. Useful when fifteen minutes is not going to cover it. The free 15-minute consult is always available first if you would rather start there.', true, false, null),
  (970201, 'Tailored College Spreadsheet + GetAcceptd Support', 'coaching', 52500, '5–7 hours · highest return of any single service', null, 'A college list built around one student, not pulled off a generic ranking. Every school comes with its deadlines, prescreen requirements, and acceptance rates in one tracker you actually use. Includes GetAcceptd setup and support through the submission window.', true, false, null),
  (970202, 'Audition Room Readiness', 'coaching', 39000, 'Full mock audition experience', null, 'A real mock audition in front of a panel, run the way the schools run it. Slate, material, Q&A, and interview, then detailed written feedback the student can work from. The point is that audition day is not the first time it happens.', true, false, null),
  (970203, 'Essay & Artistic Statement Support', 'coaching', 52500, 'Approx. 4 hours · up to 3 essays · 2 rounds of edits', null, 'Help getting the Common App essay, school-specific prompts, and the artistic statement to sound like the student and not like a template. Up to three essays with two full rounds of edits on each.', true, false, null),
  (970204, 'Audition Book Creation + Audition Package', 'coaching', 32500, 'Approx. 3–4 hours', null, 'A school-ready audition binder built and organized so nothing goes missing on the day. Repertoire sheets, labeled cuts, and tabbed sections for each school on the list.', true, false, null),
  (970205, 'Industry Standard Resume Support & Creation', 'coaching', 19500, 'Approx. 2 hours · one full revision included', null, 'A performing arts resume in the format college panels expect, built from what the student has actually done. One full revision round is included so it stays current through the season.', true, false, null),
  (970206, 'Parent Support Session', 'coaching', 9000, '30 minutes, for the parent', null, 'A session for the parent, not the student. We walk the timeline, what the next few months actually look like, and how to help without taking over. Families often book this again in the spring when decisions land.', true, false, null),
  (970207, 'Single Session Support', 'coaching', 12000, 'per session · in person or on Google Meet', null, 'One session on whatever is in front of the student right now. Material, a deadline, a school-specific requirement, or a nerve that needs settling. No package required.', true, false, null),
  (970301, 'Pre-Screen Video', 'coaching', 21900, '1 video + 1 coaching session', null, 'One pre-screen package: a coaching session on the material, then a professionally filmed and edited take. Delivered labeled and ready to upload to the schools that want it.', true, false, null),
  (970302, 'Pre-Screen Videos (2)', 'coaching', 42500, '2 videos + coaching support', null, 'Two complete pre-screen packages with coaching, filming, and editing included. Most schools ask for a song and a monologue, which is what this covers.', true, false, null),
  (970303, 'Pre-Screen Videos (3)', 'coaching', 60000, '3 videos + coaching support', null, 'Three complete pre-screen packages with coaching, filming, and editing included. This is the usual answer for a musical theatre list: two contrasting songs and a monologue.', true, false, null),
  (970304, 'Pre-Screen Videos (4)', 'coaching', 79000, '4 videos + coaching support', null, 'Four complete pre-screen packages with coaching, filming, and editing included. Built for wide lists where schools ask for different material from each other.', true, false, null),
  (970305, 'Dance Pre-Screen Video', 'coaching', 40000, 'Custom choreography + 2 hours of support + filming', null, 'Custom choreography set on the student, two hours of coaching to get it in the body, then a professionally filmed and edited take. Labeled for whichever schools require a dance call on video.', true, false, null),
  (970401, '1 Acting Coaching Session', 'coaching', 12000, '50 minutes', null, 'One private fifty minute session on a monologue or a song. We work technique and specificity, then how it reads in an audition room.', true, false, null),
  (970402, '3-Pack Acting Coaching Sessions', 'coaching', 35000, '3 × 50 minutes · about $117 each', null, 'Three private sessions at a slightly better rate than booking them one at a time. Sessions can be combined back to back when a deadline is close.', true, false, null),
  (970403, '6-Pack Acting Coaching Sessions', 'coaching', 66000, '6 × 50 minutes · $110 each', null, 'Six private sessions, enough to carry a student through a full audition cycle. Best per session rate short of the ten pack.', true, false, null),
  (970404, '10-Pack Acting Coaching Sessions', 'coaching', 105000, '10 × 50 minutes · $105 each', null, 'Ten private sessions and the lowest per session rate we offer. Room to build several pieces across styles, then revisit and sharpen them before audition day.', true, false, null),
  (970501, 'Logo Design', 'coaching', 35000, 'Includes intake and design delivery', null, 'A custom logo built from an intake session about the artist and the work. Delivered as packaged files ready for a website, a headshot back, or a program.', true, false, null),
  (970502, 'Business Card Design + Logo Design', 'coaching', 52500, 'Logo + business card + branding packet', null, 'A custom logo and a matching business card, delivered as one branding packet. What you hand across the table at a conference or a callback.', true, false, null),
  (970503, 'Brand Evaluation + Social Media Support', 'coaching', 52500, 'Approx. 4 hours · 15 post templates included', null, 'A full audit of how an artist currently reads online, refreshed bio copy, and a content strategy that fits the actual career. Fifteen ready to use post templates come with it.', true, false, null),
  (970504, 'Portfolio Website + Custom Domain', 'coaching', 129700, 'Up to 3 pages · custom domain · full handoff', null, 'A portfolio site with bio, gallery, resume, reel, and contact, on a custom domain. Up to three pages, handed off in full so the artist can manage it after launch.', true, false, null),
  (970505, 'Full Brand Package', 'coaching', 199700, 'Website + logo + business card + social media', null, 'Everything on this list in one build: portfolio website, logo, business card, and social media strategy with templates. One visual identity that holds together across every platform.', true, false, null)
on conflict (id) do update set
  name          = excluded.name,
  category      = excluded.category,
  price_cents   = excluded.price_cents,
  schedule_name = excluded.schedule_name,
  age_range     = excluded.age_range,
  description   = excluded.description,
  bookable      = excluded.bookable,
  bb_gated      = excluded.bb_gated,
  capacity      = excluded.capacity;

-- Sanity check: 24 rows, every one bookable and priced.
select id, name, price_cents, schedule_name
from activities
where category = 'coaching'
order by id;
