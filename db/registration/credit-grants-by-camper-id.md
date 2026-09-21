# Proposal: key day camp credit grants by camper id

Written Sep 21 2026 alongside `credit_audit.sql`. Nothing here is applied.
It needs CJ's go, a migration, and a checkout change, in that order.

## The defect

`public.credit_events` records a grant as `{camper: "<name>", day, snow}` under
the payer's email. `apply_credit_events()` turns that into a balance with two
soft lookups:

```sql
select id into v_fam from families where lower(email) = lower(p_email) limit 1;
update campers set day_camp_credits = day_camp_credits + g.day
 where family_id = v_fam and lower(name) = lower(g.camper);
```

Both can miss, and neither says so:

- `limit 1` with no `order by` picks an arbitrary row when an address appears
  on more than one `families` record.
- A household where two parents each checked out under their own address is
  two `families` rows and two `campers` rows for one child. The grant lands on
  whichever half the payer's address resolves to. The parent portal reads the
  balance only through `family_hub.students.camper_id`, so if that is the other
  half, the family sees zero.
- The `update` matching no row is not an error. The grant is recorded in the
  ledger and no balance moves. That is the Sep 13 2026 `i0`/`i1` cart-key bug:
  money taken, nothing granted, found by hand a month later.

`credit_audit()` now catches all three after the fact. This proposal is how
they stop happening.

## Why the name is used at all

The camper row does not exist when the grant is written. `creditEventsFor()` in
`reg-config.mjs` builds the grants at checkout, from the cart, before payment;
they ride Stripe metadata (`credit_grants`) and are applied by the webhook after
`confirm_order`. At checkout time the only handle on the child is what the
parent typed.

So the fix is not "send the id instead of the name". It is "resolve the name to
an id once, at the moment the row exists, and store the id".

## The change

1. **Migration.** Add `camper_id uuid` to the grant and redemption objects, or,
   cleaner, add a `credit_event_lines` table keyed by `(payment_intent, camper_id)`
   so a grant that cannot be resolved is a constraint violation rather than an
   `update` that matches nothing. Keep `detail` as written for the record.

2. **`apply_credit_events()`.** Take an optional `p_camper_ids jsonb` mapping
   each grant's `camper` to a resolved id. When the id is present, update by id
   and ignore name and family entirely. When it is absent, fall back to today's
   behavior so nothing in flight breaks, and record the fallback so the audit
   can report it.

3. **The webhook** (`reg-webhook.mjs`, the `apply_credit_events` call). It
   already runs after `confirm_order`, so the camper rows exist by then. Resolve
   each grant's camper name against the campers of the family this order was
   written to, by way of the order's own `order_items`, and pass the ids. A name
   that resolves to zero or to more than one camper is not applied and is logged
   loudly: a grant that cannot be placed must never be silently recorded.

4. **`reg-pay.mjs`'s `$0` path** (`apply_credit_events` with `p_pi: "free_"...`)
   needs the same treatment; it is the second caller and it is how a fully
   credited day camp is booked.

## Do this one first, separately

`mark_registered()` mints and updates campers with

```sql
update campers set already_registered = ...
 where lower(btrim(name)) = lower(btrim(r.c));
```

with no `family_id` predicate, in both of its loops. It therefore writes to
every camper in the database with that name, in any family, and its
`if not found then insert` means a second household registering a child whose
name already exists anywhere gets no camper row of its own. Verified against
the live function on Sep 21 2026.

That is the same defect one layer down, it touches more rows than credits do,
and it should be fixed before anything above is built on top of it.
