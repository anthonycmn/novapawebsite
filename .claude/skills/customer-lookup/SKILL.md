---
name: customer-lookup
description: "Answer any 'is X registered', 'what is my kid signed up for', 'did my payment go through', or 'I never got a confirmation' question about a NOVAPA family. Use for EVERY customer-facing claim about someone's registration or payment state — always check all systems before answering, never answer from one table."
---

## The one rule that prevents disasters

A family's truth is spread across FOUR places. Answering from just one caused the
Christine Craig incident (told a fully-registered Sawyer family to "finish
registering") and missed Lisa Simeon's camp + classes. Check all four every time:

1. **Web orders** — `orders` (status in paid/confirmed/complete/succeeded) joined
   to `order_items` (show/band or activity_id per camper)
2. **Imported enrollments** — `legacy_enrollments` (Sawyer + Regpack history),
   matched by email OR camper name (portal-sweep rows often have empty email)
3. **Holds** — `holds` for attempts that never became orders (a parent who "saw
   congratulations" may live only here; see the Anne Champlin bug)
4. **Migration plans** — `migration_plans` by family_label for Regpack transfer
   families (terms, links, what they still owe)

Payments: the Regpack payment CSV is at
`~/Downloads/Payment_Report---08-05-2026--10-11AM.csv`. Stripe reads mostly need
Jason's dashboard — the restricted key at `~/.config/novapa/stripe_rk` cannot
read payments.

## How to query

Supabase management API (full SQL, service-level):

```bash
python3 -c "
import json, subprocess, pathlib
token = pathlib.Path.home().joinpath('.config/novapa/supabase_token').read_text().strip()
out = subprocess.run(['curl','-s','https://api.supabase.com/v1/projects/tlkuqwsqicxcjdmumkje/database/query',
  '-H', f'Authorization: Bearer {token}', '-H','Content-Type: application/json',
  '-d', json.dumps({'query': \"SELECT ...\"})], capture_output=True, text=True).stdout
print(out)"
```

## Name gotchas (these bite every time)

- **The fee payer is the parent, program payments are under the kid** — "Jacquelyn
  Biehl" paid the $25 fee, "Madelyn Biehl" paid tuition. Group by family, not name.
- **Known aliases**: Lori M = Musson, Lessley = Templeton, Brandt = Hatch,
  Colbert = McCready, Theresa Smith = Smith-Parker, Craig = Sawyer family.
- Gmail dots don't matter: haemylee@ = haemy.lee@.
- Regpack sweep data is INCOMPLETE — Lisa Simeon's cart had 5 items, the sweep
  captured 2. If money doesn't add up to the roster, suspect missing items and
  ask for the family's Regpack Cart/Journey screenshot.

## Answer style

Lead with the direct answer ("Yes, she's fully registered" / "No, he's not").
List registrations per kid with dates. If our system caused the confusion, say
so plainly and apologize once. Copy-paste replies for Jason: simple sentences,
no dashes, no em dashes, warm but brief.
