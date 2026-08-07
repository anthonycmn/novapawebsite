---
name: billing-explain
description: "Explain a charge, fee, refund, or balance to a NOVAPA parent: 'what is this $X charge', 'why was I charged twice', 'am I paying more than quoted', 'where is my refund'. Use for any money-explanation email so the numbers are verified before Jason hits send."
---

## Verify before explaining — the data

- Regpack payment history: `~/Downloads/Payment_Report---08-05-2026--10-11AM.csv`
  (columns: name, id, date, amount, ..., status at idx 5; col 13 is the card-fee
  portion passed to the customer).
- Our side: `orders` / `order_items`, `migration_plans` (terms column carries
  each family's whole story), `coupons` for credits.
- Stripe payment details need Jason's dashboard; the restricted key can't read
  payments.

## The recurring explanations (all verified true)

- **"Extra $4.06 / odd cents on Regpack payments"**: Regpack passed its ~3.25%
  card processing fee to the customer ($125 became $129.06, $849 became
  $876.59, $25 became $25.81). Our system does NOT do this — flat prices,
  we absorb processing. Never introduce fee lines or surcharges.
- **"$25 annual registration fee"**: retired. Every family who paid one has a
  FEE25-LASTNAME credit code ($25, expires Jul 31 2027). Policy is QUIET — do
  not announce; mention only when a family asks (Perez and Smith-Parker are
  excluded, theirs was credited inside negotiated deals).
- **5% payment plan fee**: real and intentional (plans cost 5% more than paying
  in full). Todd can waive per-family via SPECIAL_PLANS (see custom-deal skill).
- **Class billing**: $90/month one class, $159/month two classes per kid, season
  Sep-Jun, billing anchored Oct 1. Returning show/camp families get first month
  free; new families pay the first month at signup.
- **Migration families**: their email quotes are the contract. The $25 fee
  credit is a code, NOT baked into their quoted plan numbers — totals in the
  sent emails are exact.
- **Old-deal vs today's pricing**: honor what they bought. Reprice to today's
  rules ONLY if they ask AND it favors them; several old deals (SB Bundle,
  Regpack 20% TC pair) beat today's tiers — check before promising savings.
  Today's tiers: shows/camps 10/15/20% for 1/2/3+ per kid (through Aug 15);
  Teen Conservatory is carved out (10% only when one performer does both).

## Refund states worth knowing

Regpack refunds take days to settle ("will settle soon" is the honest line).
Duplicate charges from the Aug 2026 class-checkout bug are refunded by
Todd/Jason in Stripe, keeping exactly one charge per intended enrollment —
check the payment's metadata hold_id against `holds` to tell duplicates from
two intentional purchases.

## Email style

Simple sentences, no dashes of any kind, lead with the direct answer, show the
math in one short line each, thank them for flagging. If we erred: own it once,
state the fix and the date it lands.
