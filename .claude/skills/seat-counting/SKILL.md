---
name: seat-counting
description: How NOVAPA counts registrations, seats and "spots left" across web orders, Sawyer and Regpack. Use this BEFORE quoting availability in an email or campaign, changing activities.booked_offline or capacity, "fixing" a dashboard count that looks wrong, investigating why a donut headline disagrees with the roster underneath it, or deduping products that share a name. Also read it before writing any scarcity claim ("only N spots left") — one wrong number here went to 554 families.
---

# How NOVAPA counts seats

Read this before you conclude a number is wrong. On Aug 14 2026 a session spent
hours chasing four different "bugs" in these counts. Three of the four were the
investigator misreading the model, and acting on any of them would have made
real data worse. The model is unusual but it is coherent.

## The formula, and it is the only one

```
taken  = activities.sold + activities.booked_offline
open   = capacity - taken - held_count_activity(id)
```

Every consumer uses exactly this: `catalog_list` (public storefront),
`acquire_hold_v2` (the seat guard that permits or refuses a booking),
`admin_overview_groups` (Overview donuts), `admin_inventory` + `countOf`
(Inventory tab), `reg-admin-ops`, and the Products cards.

**Never add `legacy_enrollments` on top.** `booked_offline` already IS the
Sawyer + Regpack count, frozen at the cutover (`LAUNCH-CHECKLIST.md`). Adding
both double counts every legacy registration. That bug shipped Aug 12, made
Frozen JR read 7 seats left against a true 20, and that number went out to 554
families as "down to its last 7 spots".

**Never use `activities.open_spots`.** It is Sawyer's own field, imported and
never maintained. It reads 663 for a 50 seat show and is identical (680) across
six unrelated classes. Nothing reads it today. Keep it that way.

## Why the drill-in roster shows fewer people than the headline

This is the single most confusing thing here, and it is **expected behaviour,
not a bug**. Todd has reported it; so will anyone else who looks.

`legacy_enrollments` holds **one row per Sawyer ORDER**, not per enrollment:
727 rows, 727 distinct `order_ref`, matching the 727 orders Sawyer's own portal
reports. But a single order can contain several campers in several programs —
36 rows name 2+ programs, with `camper_name` holding a list
(`"Skylar Black, Veronica N…"`).

A row carries one `activity_id`, so it can only ever be attributed to one
program. The other enrollments in that order are invisible to any roster join.

**Consequence:** on a product with legacy registrations, the headline
(`sold + booked_offline`, counted per enrollment) is correct, and the drill-in
list is structurally short. A gap of 1-4 people on classes and teen
conservatory is normal. Do not "fix" the counters to match the roster — that
puts seats back on sale that real families hold.

526 of 816 legacy rows have no `activity_id` at all, mostly completed 2026
summer programs and non-products (`Tuscarora High School - NYC Trip`). None of
them match a product by name; `activity_text` is free-form Sawyer prose. Jason's
call (Aug 14 2026): **do not backfill.** They are accurate records of what
happened and fuzzy-matching them would invent wrong rosters.

## Products that share a name are NOT duplicates

Eleven name groups have several active rows. Every one is a real separate
offering, differing by age band, day, or both:

- `Spring Break Musical Theatre Camp` x10 = 5 days x 2 age bands
- `Musical Theatre Acting` x2 = ages 13-17 Tue 8:00pm, ages 9-12 Wed 7:15pm
- `Broadway Bound | Trolls Jr.` x2 = the 9-12 cast (cap 60), the 5-9 cast (cap 35)

**Never merge them.** It would collapse real casts and scramble who is
registered for what. Customers cannot "book the same class twice" — those are
different bands and times, and listing them separately is correct. The only
genuine problem is that they share a display name, which is a labelling fix.

Related: `booked_offline` was applied per product NAME, not per Sawyer listing,
so all copies within a name share one value (`count(distinct booked_offline) = 1`
for all eleven groups). That is why a copy with no registrations can still carry
a count. It is not evidence of missing people.

## Where the data actually comes from

Three sources, and only three:

| Source | Lands in | Notes |
|---|---|---|
| Web portal | `orders` + `order_items`, `activities.sold` | `sold` matches paid order_items on every product — verified Aug 14 2026 |
| HiSawyer | `legacy_enrollments` (one row per ORDER) | 727 orders. Mostly SUMMER 2026 and older |
| Regpack | `regpack_enrollments` (aggregate counts) + 86 rows in `legacy_enrollments` | where the FALL shows actually came from |

**The fall shows were sold through Regpack, not Sawyer.** The Sawyer export
contains only 3 Frozen Kids, 2 Frozen Teens, 2 Sweeney and 1 Hadestown order in
total; everything else matching "frozen" is a different product (Combo Class
Frozen & Heathers, "A Day at the Theatre - A Frozen Adventure"). Do not conclude
Sawyer data is missing because a fall show has few Sawyer rows — it never had
many.

`regpack_enrollments` holds **aggregate counts per program** (`cnt`), not people:
Frozen Jr 19, Sweeney 21, Hadestown 21. `booked_offline` is deliberately LOWER
than these because it counts Sawyer plus the **cleaned, actually-paid** Regpack
list, which Jason and Todd worked through. A gap between `regpack_enrollments.cnt`
and `booked_offline` is that cleanup, not an error.

## Cancellations only exist in the Sawyer export

Nothing in our database records that a Sawyer order was cancelled. The Orders
Report export (Financials > Orders > Download Reports > Orders Report, emailed
as a link that expires in 3 hours) has a `Canceled` column: 10 of 727 orders are
cancelled. Lindsay Rockwood's Frozen JR order is one, which is why a $0 "Ryley
Rockwood / Broadway Bound | Frozen, Jr" row exists and must NOT be treated as a
registrant. Pull that export before trusting any row with $0 paid.

The export is order-level, not line-item: `Student Name` and `Activities` are
comma-joined. Of 717 live orders, 690 are unambiguous (one student, or one
program) and 27 have several of both, where you cannot tell which kid is in
which program without opening the order.

Regpack families being migrated still count as registered until told otherwise.
Their custom Stripe payment links are paid **outside** our checkout, so paying
creates no order row and cannot double count. Verified Aug 14 2026: zero campers
counted twice for the same program, zero Regpack rows with a paid web order.

`acquire_hold_v3`'s duplicate guard only checks `order_items`, so it would not
stop a legacy family rebooking a seat they already hold. Jason's call: not worth
guarding, fix by hand if it happens.

## Verifying against the source

Sawyer's provider portal (`/portal/account/orders`) shows a Gross Volume and
**Total Orders** figure. That total is the check on whether the import is
complete — it read 727 against our 727 on Aug 14 2026. Read-only; see the
`sawyer-regpack-reads` skill first, because clicks on billing platforms are
writes. The public widget API is useless now: the listings were flipped private
at cutover, so `/nova-performing-arts/schedules` renders empty.

## Before you quote a number to a customer

Availability that goes in an email or campaign comes from
`capacity - sold - booked_offline - held`, the same figure the seat guard uses,
because that is the only number that can be *acted on* — it is what physically
permits or refuses a booking. Do not read it off a donut, and do not compute it
ad hoc with `capacity - sold`, which ignores every Sawyer and Regpack family.
