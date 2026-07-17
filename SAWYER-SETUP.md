# Sawyer Setup for CJ — Fix the Sibling Discount + Summer 2027 Notes

*Prepared July 2026. Takes ~15 minutes in the Sawyer for Business dashboard.*

## The problem

Sawyer's built-in **Sibling Discount** only applies when siblings register for the
**exact same scheduled activity** — same activity, same dates, same pricing type.
Since our camps are split into age groups (5–9, 9–12, 12–15, Tech 10–15), siblings
in *different age groups* get **no discount**, even though that's the typical family.
This is confirmed Sawyer behavior, not a config error:
https://help.hisawyer.com/en/articles/11105579-how-to-set-up-sibling-or-multi-class-discounts

## The fix: cart-level Auto Discount

Auto Discounts apply automatically at checkout across **all eligible items in the
cart** — different age groups, even different shows. Docs:
https://help.hisawyer.com/en/articles/11105840-auto-discounts

### Step 1 — Create the Auto Discount

1. Sawyer dashboard → **Discounts** (under Financials/Marketing) → **Auto Discounts** → create new.
2. Name: **Family & Multi-Camp Discount** (customers see this in the cart).
3. Type: **Percentage**.
4. Tiers (mirrors the current sibling structure):
   - **2 eligible items** in cart → **5%**
   - **3+ eligible items** in cart → **10%**
5. Eligibility: restrict to the **Camps** booking type / the 12 Summer 2027 activities
   (all three shows × 4 age groups). Restricting means fall classes etc. aren't
   accidentally discounted — widen later if you want it program-wide.
6. **Leave the "apply uniquely per registrant" toggle OFF.** This is the whole point:
   OFF = the discount counts items across the whole cart, so two kids in two different
   age groups qualify. ON would require each kid to individually buy 2+ camps.

### Step 2 — Remove the per-activity Sibling Discounts on the 12 summer camps

Sawyer stacks Sibling Discounts **on top of** Auto Discounts. If both stay on, two
siblings in the *same* age group would get ~10% while siblings in different age
groups get 5% — confusing and unfair. Edit each of the 12 Summer 2027 activities
(Step 3 of the activity editor) and remove the Sibling Discount there. The Auto
Discount replaces it uniformly.

### Step 3 — Sanity-test

Add two camps to a cart under a test account (two kids, different age groups) and
confirm the 5% appears in the cart automatically before payment.

Note: only ONE auto discount applies per order, and auto discounts apply at initial
checkout only (not to later payment-plan installments' recalculation — verify the
plan amounts look right in the test).

## Why we're NOT consolidating age groups into one listing

One combined "HTTYD Jr" activity would lose per-age-group capacity limits — you'd
have no way to cap 5–9 separately from 12–15. Keep the 4 activities per show.
The website now handles the presentation problem instead: novapa.org/summer-2027
shows one card per show with age-group buttons that deep-link straight into the
correct Sawyer activity, so parents never see the 12-item wall.

## Once the Auto Discount is live

Tell Jason — the website copy currently says "Sibling discounts available at
checkout" and will be updated to "Family discount applied automatically at
checkout: 5% off your 2nd camp, 10% off your 3rd" (stronger selling point).

## Optional / later

- **Widget tags per show** (`httyd`, `charlie`, `trolls` in each activity's Advanced
  Settings) would let us build per-show embedded widgets. Not needed right now —
  the site deep-links directly to each activity.
- The old site links to the big camps list have already been swapped to the cleaner
  `widget_tags=summer+camp` filtered view.
