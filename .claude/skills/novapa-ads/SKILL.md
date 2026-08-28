---
name: novapa-ads
description: How NOVAPA and DC Unifieds paid advertising is actually wired — the Meta ad account, campaigns, pixels, UTM taxonomy, and which funnel each ad points at. Use this skill whenever the user mentions ads, Meta, Facebook, Instagram, ad spend, campaigns, creatives, cost per lead, attribution, funnel performance, or asks why one funnel is outperforming another. Read this BEFORE opening Ads Manager or querying PostHog — it will save an hour of rediscovery.
---

# NOVAPA / DC Unifieds paid advertising

Everything here was verified against the live account on 28 Aug 2026. When
something contradicts this file, the live system wins — then fix this file.

## The account

| | |
|---|---|
| Ad account | **Broadway Bound** — `act=2053835318858929` |
| Business ID | `1750191982259607` |
| PostHog project | `516047` (key `phc_pKwTDgnhHKjG34dvXmjtw2NJzCsGkK3L6MfMp9TUvYkw`) |

One ad account carries **both brands**. Campaign name is what separates them,
not the account.

## Campaigns (as of 28 Aug 2026)

| Campaign | Daily budget | Brand |
|---|---|---|
| DC Unifieds 2026 — Back to School Sale | $100 | DCU |
| NOVAPA Main Funnel | $50 | NOVAPA |
| Frozen JR Fall 2026 — Sales | $50 | NOVAPA |

## Pixels — and the attribution trap

Three pixels are live, and one of them is on everything:

| Pixel | Where |
|---|---|
| `902777265812159` | **EVERY property** — dcunifieds.com, portal.dcunifieds.com, novapa.org |
| `976085925124979` | DC Unifieds only (dcunifieds.com + portal) |
| `2191001311729801` | NOVAPA only (free-class, quiz, register) |

The brand pixels are cleanly separated. **`902777265812159` is the bleed
source** — it fires on both brands, so Meta can attribute a NOVAPA conversion
to a DCU campaign and vice versa. Never trust a cross-brand number without
checking the brand pixel or PostHog.

## UTM taxonomy — this is how you tell funnels apart

`utm_content` identifies the **ad creative**. The ad's *name* in Ads Manager
does NOT match it — ads are named after the creative ("Video", "DCU — find
top 5", "DCU — video v1") while the funnel destination lives in the ad's URL
parameters. **You cannot identify an ad's funnel from its name in the list.**

| utm_content | Lands on | Funnel |
|---|---|---|
| `find-top-5` | portal.dcunifieds.com/findyour5 | DCU quiz (lead gen) |
| `quiz-video` | portal.dcunifieds.com/findyour5 *and* novapa.org/quiz | quiz, video creative |
| `weekend`, `site-weekend` | dcunifieds.com/one-weekend | DCU direct sale |
| `video`, `site-video` | dcunifieds.com | DCU direct sale |
| `price`, `site-price` | dcunifieds.com | DCU direct sale |
| `freeclass-video` | novapa.org/free-class | NOVAPA free class |

Campaigns: `dcu-bts-2026`, `novapa-classes-2026`, `frozen-fall-2026`.

## Where the funnels live

- **DCU direct sale** — dcunifieds.com/one-weekend → `/register.html` →
  `/api/dcu-pay` → NOVAPA Supabase, activities `970601` (In Person $699),
  `970602` (Virtual Live $499), `970603` (Virtual $199).
- **DCU quiz** — portal.dcunifieds.com/findyour5 (rewrite of `/fit`, in the
  audition-atlas repo) → writes `funnel_leads` in the **separate** DCU Supabase
  project `ovsnhiklkylpcndkslin`. Read it from NOVAPA via the `leads_api`
  schema, never `public`.
- **NOVAPA free class** — novapa.org/free-class → `/api/reg-freeclass`.
- **NOVAPA quiz** — novapa.org/quiz → `/api/reg-quiz` → `quiz_leads`.

## The ad inventory — ad_id is the only safe handle

Verified from the Marketing API on 28 Aug 2026. **Three different ads are named
"DCU — video v1"**, in three different adsets, pointing at three different
funnels. This is the concrete form of the naming trap: pausing by name would
have hit the wrong ad twice out of three times.

| ad_id | Name | Adset | utm_content | Lifetime spend |
|---|---|---|---|---|
| `120249587398010479` | DCU — Audition in one weekend | DC Metro — College-bound families | `weekend` | $254.96 |
| `120249565986060479` | Frozen JR — Canva graphic v1 | Lookalike + Local — Frozen JR | *(none)* | $201.14 |
| `120249659582000479` | Frozen JR — video v1 | Lookalike + Local — Frozen JR | *(none)* | $78.54 |
| `120249662590280479` | DCU — find top 5 | DC Metro — Quiz funnel | `find-top-5` | $57.17 |
| `120249659225520479` | DCU — video v1 | DC Metro — College-bound families | `video` | $56.64 |
| `120249662527230479` | DCU — Audition in one weekend | DC Metro — Main website | `site-weekend` | $51.40 |
| `120249662804750479` | Video | NOVAPA Free class | *(none)* | $40.73 |
| `120249662991470479` | Video | NOVAPA Quiz | *(none)* | $28.81 |
| `120249662527240479` | DCU — video v1 | DC Metro — Main website | `site-video` | $22.95 |
| `120249587498000479` | DCU — $699 price | DC Metro — College-bound families | `price` | $22.53 — PAUSED |
| `120249662513130479` | DCU — video v1 | DC Metro — Quiz funnel | `quiz-video` | $19.15 — **PAUSED 28 Aug** |
| `120249662527220479` | DCU — $699 price | DC Metro — Main website | `site-price` | — PAUSED |

The four NOVAPA/Frozen ads carry **no `utm_content` at all**, which is why
NOVAPA-side creative attribution is guesswork. Adding url_tags to those is the
single highest-value fix to the measurement setup.

Rebuild this table rather than trusting it — one call:

```bash
curl -s -G "https://graph.facebook.com/v21.0/act_2053835318858929/ads" \
  -d "fields=id,name,effective_status,adset{name},creative{object_story_spec{link_data{link}}}" \
  -d "limit=100" -d "access_token=$(cat ~/.config/novapa/meta_token)"
```

## Getting performance data

**PostHog is the reliable source for funnel and creative performance.** Meta's
UI fights you; PostHog answers in one query. Working pattern:

```
select coalesce(nullif(properties.utm_content,''),'(none)') as content,
       countIf(event='$pageview') as views,
       countIf(event='quiz_completed') as completed,
       countIf(event='dcu_purchase') as purchases
from events
where timestamp > now() - interval 7 day
  and properties.utm_source='meta'
  and properties.utm_campaign='dcu-bts-2026'
group by content order by views desc
```

To find **which ad actually drove a purchase**, trace the buyer's session —
this is the only honest way to attribute, and it has already overturned a
conclusion once:

```
select distinct_id, groupUniqArray(properties.utm_content), groupUniqArray(properties.$pathname)
from events
where distinct_id in (
  select distinct_id from events where event='dcu_purchase' and timestamp > now() - interval 10 day)
group by distinct_id
```

Useful events: `quiz_started`, `quiz_completed`, `quiz_register_clicked`,
`dcu_register_cta_clicked`, `dcu_purchase`, `free_class_details_saved`.

## Acting on ads without the browser

The Meta Marketing API does everything Ads Manager does. Pausing an ad:

```bash
curl -X POST "https://graph.facebook.com/v21.0/<AD_ID>" \
  -d "status=PAUSED" -d "access_token=$(cat ~/.config/novapa/meta_token)"
```

Reading spend per ad:

```bash
curl -s -G "https://graph.facebook.com/v21.0/act_2053835318858929/insights" \
  -d "level=ad" -d "fields=ad_name,spend,impressions,actions,cost_per_action_type" \
  -d "date_preset=last_7d" -d "access_token=$(cat ~/.config/novapa/meta_token)"
```

**The token already exists.** A never-expiring `ads_management` System User
token is stored at `~/.config/novapa/meta_token` (chmod 600). Verify it before
assuming it is dead:

```bash
curl -s -G "https://graph.facebook.com/v21.0/me/permissions" \
  -d "access_token=$(cat ~/.config/novapa/meta_token)"
```

It belongs to system user `ads-automation` (`61593878583286`) under app
**NOVAPA Ads Automation** (`1607512147648435`), scoped to `ads_management` only
— deliberately not `business_management` or `pages_manage_ads`. The app has the
"Create & manage ads with Marketing API" use case; `ads_management` sits at
"Ready for testing" (standard access), which is sufficient for a system user
inside the same business.

If the token wizard ever says **"No permissions available — assign an app role
to the system user"** even though the app role IS assigned, it is stale wizard
state, not a config problem. Hard-reload the System Users page and re-run the
wizard; the step then renders a real permission picker.

## Ads Manager UI gotchas (why you should prefer the API)

- **Two Chrome profiles.** Jason's personal profile (`iamjasonstacks`, Stacks
  Industries portfolio) has NO access to this ad account. The NOVAPA profile
  does. If Ads Manager says "you don't have access to any ad accounts", you are
  in the wrong profile — do not conclude the account is missing.
- **The Amount spent / Impressions / Reach columns render blank** on the login
  used so far, even when scrolled into view. Results and cost-per-result do
  show. Treat spend as unavailable from the UI; use the API.
- The grid is virtualized and the header scrolls independently of the body.
  Setting `scrollLeft` on the scroll containers works better than mouse wheel,
  but the campaign view is far easier to read than the ad view.

## What the data said on 28 Aug 2026

Kept as a baseline, not as current truth.

- `find-top-5`: 39 views → 18 quiz starts → **11 completions (28%)** → 0
  purchases. Best lead generator by a wide margin.
- `weekend`: 628 views → 21 register clicks → and **session tracing confirmed
  it drove one of the two actual purchases**. The other buyer arrived untagged.
- `quiz-video`: 11 views, 2 starts, **0 completions** — and it also
  underperformed on the NOVAPA side. The one clear-cut kill.
- NOVAPA Main Funnel and Frozen JR: **0 purchases** on ~$100/day combined.
- DCU cost per purchase: **$201.52** (2 purchases in the window).

The lesson worth keeping: **the quiz generates leads, the weekend ad generates
sales.** They do different jobs and comparing them on one metric is a category
error. Leads convert by phone — Mel converted on a call, not a click.
