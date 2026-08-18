---
name: custom-deal
description: "Set up a Todd/CJ-approved exception for one family: waive the 5% payment plan fee, stretch a schedule, mint a credit or discount code, or create a custom Stripe payment link/subscription. Use whenever Jason says a deal was approved for a specific customer."
---

## Pick the right mechanism

**1. Special deal code — one INSERT, no deploy (preferred since Aug 18 2026)**
The `coupons` row itself carries the terms. Insert with code (convention:
LASTNAME + digit) and any of:
- `email_lock` (text[] — every address the household might check out with;
  families often pay from one email and write from another)
- `pct_off_list` (flat % off list, REPLACES tier/bundle/sibling math)
- `waive_plan_fee` (boolean — no 5% plan fee)
- `plan_months` (stretched schedule: exactly N monthly firsts)
- `amount_cents`/`balance_cents` (a dollar credit that stacks WITH the terms
  above — on a special row the balance rides as the special's credit)
Set `max_uses: 1`, `active: true`, `pct` display-only (or NULL). The family
enters the code at the payment step. Server mapping: `specialFromCouponRow`
in reg-config.mjs; reg-pay reads the row with the service role. Precedent:
the schema file db/registration/tables/coupon_special_terms.sql.

`SPECIAL_PLANS` in reg-config.mjs is the LEGACY map (SOK20, ANSELL0,
SMITH20) — it still wins over the row when both exist. Don't add to it;
new deals go on the row.

**2. Dollar credit code**
Insert into `coupons` with `pct = NULL` (the CHECK requires pct > 0 when set),
`amount_cents`/`balance_cents` = the credit. Credits spend DOWN across orders.
Precedents: BURNS-CREDIT, SURLA-CREDIT, FEE25-* (the $25 retired-fee credits).

**3. Custom Stripe payment link (off-platform plans, migration-style)**
Restricted key at `~/.config/novapa/stripe_rk` (Products/Prices/Payment Links
write only — it cannot read payments or refund). One-off: create price +
payment link. Monthly: `recurring[interval]=month` +
`subscription_data[trial_period_days]=N` for a delayed first charge.
**Trials count from CLICK date, not send date** — compute days against "if she
sets it up this week" and say so in the email. Tag everything
`metadata[migration]` or a family metadata key for reconciliation. Record the
link in `migration_plans` (or its successor tracker) with terms spelled out.

## Rules that always apply

- Only build what Jason says Todd or CJ approved; name the approver and date in
  the code comment / coupon note.
- Coupon notes are READ BY STAFF in the admin Credits tab — write them in plain
  English (who, what the code does, whose email it's locked to, approver, date).
  No file names, constant names, or implementation asides ("SPECIAL_PLANS",
  "reg-config.mjs", "pct display-only") — put technical breadcrumbs in code
  comments next to the implementation instead. Jason flagged this Aug 12 2026.
- Never reprice an old registration at today's discounts unless the family asks.
- Platform is truth: never touch Sawyer or Regpack.
- A new recurring charge always needs the parent to click something — never
  reuse a saved card for a subscription they didn't authorize.
- Reply copy for Jason: simple, no dashes, subject like
  "[Action Required] ..." only when they must do something.
