# Hand-built Stripe plans

CJ builds payment plans by hand in the Stripe dashboard for families the
checkout cannot price: a multi-show season, a sibling discount, a plan
renegotiated mid-year. Before Sep 21, 2026 those plans existed only in Stripe.
They collected real money, appeared in no table this company owns, and were
invisible to the receivable and to the NOVA PA Parent Portal.

`public.record_manual_plan` (db/registration/functions/record_manual_plan.sql)
gives one of those plans a real `orders` row so the rest of the system can see
it. This page is how to use it without breaking anything.

## The two halves

Recording a hand-built plan takes **two** steps, and the second one is the one
people forget.

1. **The order row.** Call `record_manual_plan`. It returns the new order's
   uuid.
2. **The Stripe metadata.** Write that uuid onto the Stripe subscription as
   `metadata.order_id`.

Step 2 is not optional. `reg-webhook.mjs` resolves an incoming `invoice.paid`
to an order through `orderIdForInvoice()`, which reads
`sub.metadata.order_id`, then the schedule's metadata, and gives up. It never
looks at `orders.stripe_schedule`. Skip step 2 and the row exists but every
future pull on that plan records nowhere, which is the exact bug the row was
created to fix.

## Picking the plan type

| The family is | Use | Because |
|---|---|---|
| Paying off a season or a package over time | `deposit` | `record_installment_paid` only reduces the outstanding balance when the plan is `deposit`. This is what makes the portal countdown move. |
| On an open-ended monthly membership | `subscription` | Monthly tuition is revenue against no balance, so the order's counter must not move. |

Choosing wrong is quiet. A season recorded as `subscription` shows the family a
countdown that never goes down.

## What it will not do

- It never touches `inventory`, `activities.sold`, `holds`, or `seat_offers`.
  The seat behind a hand-built plan was arranged by hand and is already
  counted; a second decrement here is invisible and permanent, and it makes a
  show look full when it is not.
- It never moves money. It records a plan Stripe already has.
- It never writes `family_hub`. The 15-minute sync owns that side and picks the
  order up the same way it picks up a checkout order. Never hand-edit
  `family_hub.enrollments`; the sync overwrites it.

## Idempotency

The row carries `stripe_payment_intent = 'manual_' || <subscription id>`, and
that column is UNIQUE. Calling the function twice for the same subscription
returns the same order id and changes nothing. That matches the conventions
already in the table: comped orders use `free_`, saved-card class orders use
the setup intent `seti_`.

## The first one: the Johansen season

Katy Johansen, Frozen and The Little Mermaid, 15 percent off.

| Line | Amount |
|---|---|
| Season total | $1,181.50 |
| Paid before the plan started | $375.00 |
| Six pulls of $125.00, Oct 17 through Mar 17 | $750.00 |
| Still owed after the last pull | $56.50 |

`sub_1UGevUGWP2ZbtaszV8Bd4eAI`, $125.00 on the 17th, ends Apr 17, 2027. Its
metadata is currently empty and it has no schedule, which is why nothing it
bills has ever recorded.

The line prices are derived, not apportioned by hand: both shows list at
$695.00 in `public.activities`, and $695.00 less 15 percent is $590.75, so
two lines of 59075 come to the 118150 CJ quoted the family.

**Before running this, CJ names the two activity ids.** Katy's age band picks
between three Frozen listings (1959789 Kids, 1959787 Junior, 1959805 Teens)
and three Little Mermaid listings (1959850 Kids, 1959854 Junior, 1959851
Teens). Guessing would route a student onto the wrong roster, so the two
nulls below are a blank to fill, not a default.

Step 1, the row:

```sql
select public.record_manual_plan(
  'ali.g.johansen@gmail.com',
  'Alison Johansen',
  'deposit',
  37500,
  118150,
  12500,
  'cus_VHDMOa1Ve5Xykq',
  'sub_1UGevUGWP2ZbtaszV8Bd4eAI',
  '[{"camper":"Katy Johansen","show":"Frozen","band":null,"unit_price_cents":59075,"activity_id":null},
    {"camper":"Katy Johansen","show":"The Little Mermaid","band":null,"unit_price_cents":59075,"activity_id":null}]'::jsonb
);
```

Expected: 1 row in `orders`, 2 in `order_items`, and one uuid returned.
Outstanding becomes `118150 - 37500 - 0 = 80650`, which is the $806.50 that is
missing from the receivable today, and the portal gets its countdown.

Read it back in the same sitting:

```sql
select order_no, email, plan, total_cents, amount_today_cents,
       installment_cents, installments_paid_cents, stripe_schedule,
       (total_cents - amount_today_cents - installments_paid_cents) as remaining_cents
from public.orders
where stripe_payment_intent = 'manual_sub_1UGevUGWP2ZbtaszV8Bd4eAI';
```

Step 2, the metadata, with the uuid step 1 returned:

Stripe dashboard: open the subscription, Edit metadata, add `order_id` =
the uuid. Or:

```
stripe subscriptions update sub_1UGevUGWP2ZbtaszV8Bd4eAI --metadata[order_id]=<uuid>
```

Check it worked: the next $125.00 pull on Oct 17 should appear in
`order_installments` within a minute of the invoice, and
`orders.installments_paid_cents` for that row should read 12500.

## What this does not settle

The $56.50 that the plan never collects, because Apr 17 is both the end date
and the billing date so Stripe cancels before that invoice exists. That is a
business decision open with Todd since Sep 20: a one-off $56.50 invoice dated
Apr 17 2027, folding it into the Mar 17 pull at $181.50, or writing it off. The
orders row does not create the money, it just stops the shortfall being
invisible.
