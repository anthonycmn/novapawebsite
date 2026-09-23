# url_tags for the four untagged NOVAPA and Frozen ads

Written 21 Sep 2026 from `.claude/skills/novapa-ads/SKILL.md` (ad inventory
verified against the Marketing API on 28 Aug 2026). No Meta API call was made
for this; if an ad_id below no longer exists in Ads Manager, the inventory has
moved and this table needs a rebuild, not a guess.

## Why

Every other ad in account `act_2053835318858929` carries a `utm_content`, so
PostHog and `public.orders.utm` can name the creative that produced a view, a
lead or a sale. These four never did. Any registration they drove lands as
`(none)` in the creative breakdown, which is why NOVAPA creative attribution
has been guesswork since launch. Until `orders.utm` has a real ad in it, the
`reg-webhook` write path has never run in production either (0 of 242 orders
carry an ad parameter as of 21 Sep 2026), so the first tagged checkout is also
the first live test of that code.

## The strings

Paste the whole string, exactly as written, into **URL parameters** on the
ad (Ads Manager, ad level, Edit, scroll to Tracking, the field under the
website URL). Do not change the ad's destination link; URL parameters are
appended to whatever link the ad already has. Meta treats this as a tracking
edit: it does not duplicate the ad or create a new one.

| ad_id | Ad name | Adset | Campaign | url_tags to paste |
|---|---|---|---|---|
| `120249565986060479` | Frozen JR - Canva graphic v1 | Lookalike + Local - Frozen JR | Frozen JR Fall 2026 - Sales | `utm_source=meta&utm_medium=paid&utm_campaign=frozen-fall-2026&utm_content=frozen-canva-v1` |
| `120249659582000479` | Frozen JR - video v1 | Lookalike + Local - Frozen JR | Frozen JR Fall 2026 - Sales | `utm_source=meta&utm_medium=paid&utm_campaign=frozen-fall-2026&utm_content=frozen-video-v1` |
| `120249662804750479` | Video | NOVAPA Free class | NOVAPA Main Funnel | `utm_source=meta&utm_medium=paid&utm_campaign=novapa-classes-2026&utm_content=freeclass-video` |
| `120249662991470479` | Video | NOVAPA Quiz | NOVAPA Main Funnel | `utm_source=meta&utm_medium=paid&utm_campaign=novapa-classes-2026&utm_content=novapa-quiz-video` |

### How each utm_content was chosen

- `frozen-canva-v1`, `frozen-video-v1`: the Frozen adset's nine Banjo statics
  use `ad{1,2,3}-{age}`; these two are named for the creative the way the ad
  itself is, and collide with nothing.
- `freeclass-video`: already the taxonomy's name for the free-class video
  (SKILL.md, UTM table) and the five statics beside it are
  `freeclass-static-<slug>`, so this completes that family. No ad carries it
  today.
- `novapa-quiz-video`: **not** `quiz-video`. `quiz-video` is already on DCU ad
  `120249662513130479`, which lands on portal.dcunifieds.com/findyour5, and
  the two were sharing one label across two brands. A distinct value is the
  point of this exercise.

## Before pasting: the state these ads are in

All three campaigns have been PAUSED since 13 Sep 2026 (Todd or CJ, in Ads
Manager; confirmed 16 Sep). Tagging a paused ad is safe and costs nothing; it
means the tag is in place if the ad is ever relit. Two of the four must stay
down regardless:

| ad_id | Status | Rule |
|---|---|---|
| `120249565986060479` | PAUSED 10 Sep | CJ dislikes his photo in it. Do not re-enable without a new image. Tag it anyway so a replacement image on the same ad is attributable. |
| `120249659582000479` | PAUSED 10 Sep | Copyright problem in the video. **Never re-enable this creative.** Tag it so the label is reserved and the history reads cleanly; the tag is not permission to run it. |
| `120249662804750479` | PAUSED 1 Sep | $66 per lead; the statics beside it kept running. Relighting is a budget call, not a measurement one. |
| `120249662991470479` | Campaign paused 1 Sep | NOVAPA Main Funnel was inert (0 registrations from `novapa-classes-2026` traffic on 28 Aug). |

## After pasting: how to see it worked

In PostHog (project 516047), a pageview from the tagged ad shows up under the
new `utm_content` within minutes of a click:

```
select coalesce(nullif(properties.utm_content,''),'(none)') as content,
       countIf(event='$pageview') as views,
       countIf(event='reg_completed') as registrations
from events
where timestamp > now() - interval 7 day
  and properties.utm_source='meta'
group by content order by views desc
```

In the registration database, the first paid checkout from a tagged ad is the
first row here:

```sql
select order_no, created_at, utm ->> 'utm_campaign' as campaign, utm ->> 'utm_content' as creative
from public.orders where utm is not null order by created_at desc;
```

If a tagged click converts and that query stays empty, read the Netlify
function log for `reg-webhook`: as of this change a failed utm write logs
`order utm write failed` with the order id and the response body.

## Not in this table on purpose

`{{ad.id}}` and the other dynamic parameters would make this table
unnecessary going forward, but every existing ad uses the static four-key
form above and PostHog's queries group on it. Changing the shape is a
separate decision; this table matches what is already live.
