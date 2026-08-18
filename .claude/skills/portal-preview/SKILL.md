---
name: portal-preview
description: Preview any family's My NOVAPA dashboard exactly as they see it, using their private portal token. Use whenever Jason wants to see what a specific family sees ("what does her portal show", "preview their dashboard", "why does their account look wrong"), when debugging a support email about the portal, and BEFORE claiming in any customer reply what a family's account page does or does not display.
---

# Portal preview: see exactly what a family sees

Every `families` row has a `portal_token` (uuid). The URL
`https://novapa.org/register/account.html?t=<token>` renders that family's
full My NOVAPA — registrations, tickets, credits, payments — with no sign-in.
It is the same link their confirmation emails carry.

## Fetch the view as data (verification — preferred first step)

```bash
TOKEN=$(cat ~/.config/novapa/supabase_token); PT=$(curl -s -X POST "https://api.supabase.com/v1/projects/tlkuqwsqicxcjdmumkje/database/query" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"query":"select portal_token from families where email = '\''<EMAIL>'\''"}' | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['portal_token'])"); curl -s -X POST "https://novapa.org/api/reg-account" -H "Content-Type: application/json" -d "{\"portal_token\":\"$PT\"}" | python3 -m json.tool
```

The JSON is the portal's entire payload: `campers` (with items), `payments`
(upcoming + history from live Stripe), `credits`, `tickets`, `rewards`.
Answer "what does their portal show" from this, not from guessing.

## Open it visually (for Jason, or for screenshots)

Print the URL and open it in a browser:

```bash
TOKEN=$(cat ~/.config/novapa/supabase_token); echo "https://novapa.org/register/account.html?t=$(curl -s -X POST "https://api.supabase.com/v1/projects/tlkuqwsqicxcjdmumkje/database/query" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"query":"select portal_token from families where email = '\''<EMAIL>'\''"}' | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['portal_token'])")"
```

Portal-token views hide the Sign out button and never touch the family's
session — read-only in effect (the only write a signed-in portal can do,
referral redemption, still works from a token link, so don't click REDEEM
on someone's rewards).

## Rules

- **The token IS the family's private key to their data.** Never email it,
  paste it into any external tool, or include it in a customer-facing reply
  other than to its own family. Internal chat with Jason is fine.
- **Rotating a token** (if one leaks): `update families set portal_token =
  gen_random_uuid() where email = '...'` — their old email links die; the
  next confirmation email carries the new one.
- The payments section renders only when the email has real Stripe data
  (charges or active subscriptions). An empty section is hidden by design,
  not broken — `jason@novapa.org` shows none for exactly this reason.
- Pre-switch Regpack payments never appear (different processor). Families
  asking about them get Todd's migration summary, not the portal.
