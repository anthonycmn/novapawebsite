# Private Lessons — recurring weekly slots

The one thing `/register` cannot do yet: give a family a specific weekly time
with a coach and hold it for the whole run they bought. Today they buy a
10-pack and then arrange times over email.

**The idea:** the unit sold is not a date, it is a *recurring weekly time*.
Claim Wednesdays 5:30 with a coach, buy the semester, and that slot is off the
calendar for everyone else until January. That is what stops a parent picking
fifteen unrelated slots out of a calendar.

Family journey: **coach → weekly time → plan → details → checkout.**

---

## Status

| Piece | State |
|---|---|
| Booking UI (`private-lessons.html`) | Built, demoable |
| Scheduling logic — dates, holidays, pricing | Built, 106 passing assertions |
| Slot locking | Built and tested standalone, then re-expressed as SQL |
| `db/private-lessons.sql` | Applies cleanly to stock Postgres, 53 assertions green; **never run against Supabase** |
| Wiring into `/register` checkout | **Not started** |
| Links from `coaching.html` / `pricing.html` | Deliberately absent until checkout works |

Nothing is committed or pushed.

---

## Pricing

Two rates. Colton, Ryyana and Katie teach at the published $120 a lesson, so
their packs are the activity rows that already exist and there is nothing new
to publish for them. Tony carries a 15% premium at $138 — and because coaching
is flat priced, a price is a row, so that rate needs its own products.

Base-rate packs quote the **published total** from the live catalog
(`register/coaching.js`, `db/coaching-activities.sql`) rather than a
percentage, so they cannot drift from what `/register` already charges.
Premium rows scale that published total by 138/120.

### Base rate — $120 a lesson

| Plan | Sessions | Total | Per lesson | Activity |
|---|---|---|---|---|
| 3-Session Pack | 3 | $350 | $116.67 | 970402 *(exists)* |
| 6-Session Pack | 6 | $660 | $110 | 970403 *(exists)* |
| 10-Session Pack | 10 | $1,050 | $105 | 970404 *(exists)* |
| **Fall Semester (Mon–Thu)** | 15 | **$1,530** | **$102** | 970601 *(new)* |
| **Fall Semester (Fri–Sat)** | 14 | **$1,428** | **$102** | 970602 *(new)* |

### Premium rate — $138 a lesson (lead coach)

| Plan | Sessions | Total | Per lesson | Activity |
|---|---|---|---|---|
| 3-Session Pack | 3 | $403 | $134.33 | 970701 *(new)* |
| 6-Session Pack | 6 | $759 | $126.50 | 970702 *(new)* |
| 10-Session Pack | 10 | $1,208 | $120.80 | 970703 *(new)* |
| **Fall Semester (Mon–Thu)** | 15 | **$1,760** | **$117.33** | 970603 *(new)* |
| **Fall Semester (Fri–Sat)** | 14 | **$1,642** | **$117.29** | 970604 *(new)* |

**Seven new activity rows in all.** Totals round to whole dollars so every
catalog price stays round — $138 × 14 less 15% is $1,642.20, sold as $1,642.

**The 15% discount needs no change to `reg-config.mjs`.** It is baked into the
activity's price, so the rule that coaching is flat priced — no sibling, tier,
bundle, combo or insurance math — stays exactly as written.

---

## The semester

Runs **September 14 2026 → January 14 2027**, observing the season calendar:

- **Thanksgiving Break** — Nov 22–29 *(calendar.html says 22–28, classes.html
  says 22–29; the wider range is used, because skipping an open day costs one
  lesson while booking on a closed day costs a refund and a phone call)*
- **Winter Break** — Dec 20 – Jan 3

Lessons step over a break and resume the following week. A Wednesday term runs
Sep 16 → Jan 13: fifteen lessons, with Nov 25, Dec 23 and Dec 30 skipped.

Two lengths per rate because the term does not divide evenly — Jan 14 is a
Thursday, so Mon–Thu slots get 15 lessons and Fri–Sat slots get 14. Length does
not change the per-lesson price: both are $102 at the base rate, and both are
about $117 at the premium rate. Four semester rows in all.

**Packs keep their promised count.** A 10-pack bought in November still
delivers ten lessons; it just finishes in late January instead of mid.

**The semester sells whole, and only before lessons begin.** Once the term is
under way the card reads *"Semester is under way — choose a pack below"*. A
prorated semester would need per-order pricing that the flat-price rule has no
way to express, and the packs already cover mid-season joiners on the same
weekly slot.

---

## What still has to happen

### 1. Run the migration

`db/private-lessons.sql` — paste into the Supabase SQL editor on the
Registration project, same as `db/coaching-activities.sql`. Safe to re-run.
It adds three tables (`lesson_teachers`, `lesson_slots`, `lesson_bookings`),
six functions, and seven activity rows — four semester variants and three
premium-rate packs.

**It has never been run against Supabase.** `tests/migration.test.mjs` applies
it to a throwaway Postgres and checks the locking, the expiry sweep and the
grants — 53 assertions, all green — so the semantics are confirmed. What that
cannot confirm is the live `activities` schema: the test builds its own stub of
that table, so a column Supabase has picked up since this was written would
still surprise it. The products insert is wrapped for exactly that reason.

### 2. Replace the placeholder bios and availability

The seed carries the real roster — four coaches, 23 slots — but two fields on
it are scaffolding and must be replaced before this page is linked anywhere
public:

- **`bio`** — written from each coach's title and nothing else. No credentials,
  years of experience or school placements have been invented, but nor has
  anyone approved this wording.
- **`slots`** — a starting grid, not anyone's real availability. Set each
  coach's actual hours.

Removing a slot later does not affect lessons already sold: bookings reference
the slot row and it is delete-restricted.

### 3. Wire the page to `/register`

Checkout stays exactly as it is — `acquire_hold_v3` → `/api/reg-pay` → Stripe →
`reg-webhook`. One Stripe pipeline, no second integration. What's needed:

- the booking page calls `lesson_availability()` instead of
  `/api/lessons/catalog`
- on "book", it calls `lesson_hold(slot, dates, hold_id)` alongside the normal
  cart hold, using the same `hold_id` so both expire together
- `reg-webhook` calls `lesson_confirm(hold_id, order_id)` when the
  PaymentIntent succeeds, and flags anything that returns `hold_lost` rather
  than dropping a paid booking

### 4. Retire the standalone module

`netlify/lib/lessons-*.mjs` and `netlify/functions/lessons-*.mjs` were built
before we found `/register`. They duplicate infrastructure that already exists
and use a different datastore, so bookings made through them would never reach
the admin console. Keep `private-lessons.html`; delete the rest once step 3
lands.

---

## Locking

`unique (slot_id, lesson_date)` is the whole mechanism. Claiming a run inserts
every date in one statement, so Postgres takes all fifteen or none. Two
families checking out the same Wednesday at the same instant cannot both win —
there is no read-then-write window to race through.

Holds carry a 30-minute expiry matching the cart hold. `lesson_hold` sweeps
expired holds before it writes, so an abandoned checkout releases its slot with
no cron job; `lesson_availability` filters them out of what it reports rather
than sweeping, so a read never has to write. If a payment lands on a hold that
has gone missing, `lesson_confirm` returns `hold_lost` rather than silently
dropping it.

When a run is refused, `first_clash` names the date that actually blocks it.
The caller's own live hold is excluded: a retry's delete clears it, so it is
never the obstacle — but their own *paid* lessons are, because the delete
leaves those alone.

---

## Demo it

```bash
node tests/helpers/dev-server.mjs
```

Then `http://localhost:8888/private-lessons.html`. This runs the **old
standalone backend** with payment stubbed — a faithful preview of the
experience and the slot logic, not the shipping build. Restarting wipes the
data for a clean run-through.

Worth trying: buy Wednesday 5:30 for the semester, then reload and pick that
slot again. The semester and 10-pack are blocked with the date they're taken
from; the 3-pack still sells, because those weeks fall before the term starts
and genuinely are free.

```bash
npm test
```

106 assertions: pricing at both rates, holiday skipping, the two term lengths,
the 48-hour lead time, DST-proof weekly dates, the payment window against
Stripe's 30-minute floor, and slot locking under concurrent checkout.

`tests/migration.test.mjs` covers the SQL itself — the locking model, the
expiry sweep and the permission grants — against a real Postgres. It is **not**
part of `npm test` because it needs a throwaway cluster on port 55432; the
header of that file has the setup.
