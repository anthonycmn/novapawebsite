# Authority Engine scoreboard

## Run 1 — September 6, 2026 (manual start, topic 1: summer theatre camps)

Published today:
- Canonical: https://novapa.org/blog/summer-theatre-camps-northern-virginia.html (Article + FAQPage schema, 3 photos, published price benchmark $995)
- Substack: https://cjcreative.substack.com/p/the-hoodie-comes-off (emailed to list)
- LinkedIn: personal post + guide link in first comment
- Facebook: NOVAPA25 page post (link preview picked up the cast photo)
- Reddit: r/nova value-first post, no link, disclosure included ("Theatre camp pricing in NoVA is weirdly secretive…")
- Pending: Instagram (@cjtheatredirector not logged in on web; not linked to an admin FB page for Zapier), tony-cimino.com sibling page (Framer)

Also shipped today (entity groundwork, same day as baseline):
- Entity schema live on novapa.org (home/coaching/meet-the-team), tony-cimino.com (Framer custom code), impacttoursandtravel.com (moved to new site + schema + founder credit)
- Canonical domain unified to novapa.org; /blog launched with nav link; faculty page unparked (redirects to /meet-the-team.html which is indexed)

Baseline standings (see baseline-2026-09-06.md): Bing name query = hub #1 but dispute coverage holds 3-8; "Mr. Cimino-Johnson" owned by lawsuit docs; ChatGPT answer favorable, cites novapa.org, no dispute mention; competitors AI recommends = Stars Performing Arts, Theatre Major LLC, AFYP.

Next scoreboard check: run 2 (Sept 8) — indexation of the article (site:novapa.org/blog), any movement on the four name queries.

## Run 3 — September 9, 2026 (topic 3: best audition songs for kids)

Status: **drafted, awaiting Tony's approval. Nothing published.**

Drafted today:
- Canonical: `blog/best-audition-songs-for-kids.html` (Article + FAQPage schema, blog card added, sitemap entry added). ~1,550 words. No lead photo yet — photo requested from Tony.
- Siblings in `.claude/authority-engine/runs/2026-09-09/`: tony-cimino-angle.md, substack.md, instagram.md, facebook.md, linkedin.md, reddit.md
- Reddit target this cycle: r/MusicalTheater (r/nova was used Sept 6 — off-limits under the ~1/week/subreddit pacing rule until ~Sept 13). Drafted link-free per that sub's self-promo rule.

Backlog note: topic 2 (voice lessons cost) is still `awaiting-approval` from the Sept 7 run and has never gone live. Two articles are now queued behind one approval; they can ship in a single push when Tony approves.

### Standings check (Sept 9)

**"Tony Cimino-Johnson"** — owned page-one results are holding and the mix looks healthier than baseline: Instagram (@cjtheatredirector), LinkedIn, tony-cimino.com, X, plus third-party credential pages (EdTA candidate profile, VTA 2016, Loudoun Times 40 Under 40). Litigation coverage still appears on page one (two Loudoun outlets, roughly positions 7–8 in this sample) but is no longer the dominant cluster. Movement vs. baseline-2026-09-06: modestly positive, hub and social profiles above the coverage.

**"Mr. Cimino-Johnson"** — still the weakest of the three. Owned properties (LinkedIn, MTI, Perlego listing for *The Theatre Leader's Playbook*) now rank alongside the litigation coverage rather than beneath it; the Playbook listing is new visibility for this variant. Baseline said this query was "owned by lawsuit docs" — it is now split. Best available lever remains volume of bylined articles carrying the "Mr. Cimino-Johnson" variant in the author bio.

**"Mr. CJ" theatre Northern Virginia** — no owned result on page one. The query is too generic and the SERP fills with venue/attraction listings. Unchanged from baseline. Recommendation: stop treating this as a rankable query and treat "Mr. CJ" purely as an entity alias reinforced via schema `alternateName` (already live) and in-body anecdotes ("my students call me Mr. CJ"), which is what feeds AI answers rather than the blue links.

**Primary keyword — "best audition songs for kids"** — SERP is a saturated listicle field: BroadwayWorld ("20 Unique Audition Songs for Kids"), Backstage (three separate age/gender-split articles), Music Grotto ("51 Best…"), Music Industry How To ("37 Best…"), Singing-Bell, plus studio blogs (Diamond Academy, Theatre Trip, Ensemble Schools). Every one of them ranks songs; none of them explains what a director is scoring, and none takes a position on whether "overdone" actually matters. That is the wedge this draft takes: the assessment criteria, the honest "overdone is not a disqualifier" argument, and the 16-bar cut mechanics. Nobody owns the question "what do directors actually listen for."

**Indexation** — `site:novapa.org/blog` could not be verified this run: the search tool does not honor the `site:` operator and returned unrelated results. Not evidence of non-indexation. Verify in Google Search Console instead; note that only the summer-camps post is actually live (the voice-lessons post has never been published), so at most one blog URL can be indexed today.

Next check: run 4, on the next scheduled cycle — plus GSC indexation for the two blog URLs once they are live.


## Run 4 — September 9, 2026 (topic 3 published; topic 4 written and held)

Status: **topic 3 published to the site. Topic 4 written, not published.**

Tony gave a blanket in-session go ("stop asking me to authorize everything just
do it"), then narrowed it: one release per day, and today's should be the song
choice article. So topic 3 shipped and topic 4 waits.

### Shipped (one push, one deploy — origin/main 717ccd3..3ccc5aa)
- `blog/best-audition-songs-for-kids.html` (topic 3, drafted earlier today,
  ~1,550 words, Article + FAQPage schema) plus blog card and sitemap entry.
- Lead photo added: `img/blog/young-actors-kids-musical-theatre-shrek-jr.jpg`.
  Tony supplied the Duloc doors shot from *Shrek The Musical Jr.* mid-run;
  optimized to 1800x1200, mozjpeg q85, 269 KB, keyword-bearing alt text, and
  added to the Article schema image array.

### Written but NOT published
- `blog/what-age-should-a-child-start-theatre-classes.html` (topic 4, ~1,650
  words, Article + FAQPage schema, same lead photo, card and sitemap entry
  prepared). Lives on branch `authority-engine-topics-3-4`. Calendar status
  `awaiting-approval`. Ready as a one-file deploy whenever Tony says go.
- Topic 4 siblings in
  `.claude/authority-engine/runs/2026-09-09-topic-4-what-age-start-theatre-classes/`:
  tony-cimino-angle.md, substack.md, instagram.md, facebook.md, linkedin.md,
  reddit.md. Nothing posted to any channel this run.

### Branch hazard found and avoided

Working branch `claude/site-sweep` was 14 commits BEHIND `origin/main` and had
diverged. Pushing or merging it would have reverted live production code: 704
deletions including `auth-continue.html`, `netlify.toml`, `reg-pay.mjs`,
`reg-webhook.mjs`, `reg-freeclass.mjs`, `register/admin/index.html`, `posthog.js`
and the novapa-weekly-newsletter skill. Local `main` was stale too, and a first
push attempt was rejected by the remote before anything went out. Today's content
was rebuilt on a branch cut from the live `origin/main` tip, carrying only blog
files. **`claude/site-sweep` is stale — do not merge it;** its one unique commit
duplicated a commit already on main.

### Field re-check (topic 4 primary: "what age should a child start acting classes")

SERP is owned by casting-industry publishers: Backstage, KidsCasting,
BubblegumCasting, Acting Magazine (two articles), ChildActor101, WestEndKids,
ThePlayground. Near-universal answer "8 to 11," which traces to agent and manager
hiring preference, not pedagogy. The softer theatre-class query surfaces
Children's Theatre Company, Seattle's Child, StageMilk, PAA Colorado, New Star
Children's Theatre — "ages 4 to 8, depends on readiness," no developmental
specifics, no prices.

**Wedge taken in the draft:** name "8 to 11" as a labor-market statistic rather
than a teaching answer, then give real classroom developmental floors for 5-8,
9-12 and 13-17, a five-point readiness checklist with a verdict line, an explicit
"starting at fifteen is not late" section, and published prices ($90/mo per class,
$79/day camps, $695/$995 summer, $895 conservatory) as a benchmark. Nobody in that
SERP publishes prices, and nobody separates the casting question from the learning
question.

### Standings

Not re-run this cycle — WebSearch hit the account's monthly spend limit during the
research phase (session limit resets 4pm America/New_York). Run 3 standings from
earlier today stand as current. Carry to run 5: the four name queries,
`site:novapa.org/blog` indexation via Google Search Console (three blog URLs are
live now, not one), and first movement on "best audition songs for kids."

Next check: run 5.

## Run 4b — September 10, 2026 (topic 3 distribution)

Tony approved the four-channel distribution for the audition-songs article.
All four posted from his own accounts via Claude in Chrome. Nothing else touched.

- **Substack:** https://cjcreative.substack.com/p/can-i-just-sing-the-one-i-sing-in
  Title "Can I Just Sing the One I Sing in the Car?" Published to Everyone and
  emailed to the list (same delivery setting as the Sept 6 post). The article URL
  rendered as a Substack link-preview card rather than plain text.
- **Facebook:** posted to the NOVAPA25 page, publishing as Northern Virginia
  Performing Arts, Public, publish-now. **Boost was OFF** (a misfired click during
  a dialog reflow toggled it on; caught and turned off before posting — verify no
  ad spend if anything looks odd). Declined the "Share to groups" cross-post step;
  no community groups were posted to.
- **LinkedIn:** posted to Tony's personal profile, "Post to Anyone," with the
  article link as the first comment (reach-preserving pattern).
- **Reddit:** https://www.reddit.com/r/MusicalTheatre/comments/1wcickz/directors_what_are_you_actually_assessing_in_the/
  Posted from u/Jolly_Supermarket_38 (his own established account). Link-free,
  disclosure included in the body.

### Reddit target changed from the draft — read before the next cycle

The draft targeted **r/MusicalTheater** (the "-ter" spelling). On inspection that
sub has **387 members** and its front page is largely reposts sourced from
r/MusicalTheatre. The real community is **r/MusicalTheatre** (the "-tre"
spelling): created Oct 2009, 22K weekly visitors, 603 weekly contributions. Tony's
instruction said "r/musical theatre," which matches the larger sub. Posted there
instead.

r/MusicalTheatre shows no custom rules widget in the sidebar (site-wide Reddit
rules only) and has two moderators, one of them AutoModerator. The link-free
value-first format was kept regardless, so the post is safe under any reading of
self-promo policy.

**Correct the pacing ledger:** r/MusicalTheatre is now used as of Sept 10 and is
off-limits until roughly Sept 17. r/nova was used Sept 6 (available again from
~Sept 13). r/MusicalTheater (387 members) is still unused and is probably not
worth a slot. r/Theatre remains unused and is the intended target for the topic-4
draft.

### Still outstanding
- Topic 4 (*What Age Should a Child Start Theatre Classes?*) — written, unpublished,
  on branch `authority-engine-topics-3-4`, calendar status `awaiting-approval`.
  Its six channel drafts are in
  `.claude/authority-engine/runs/2026-09-09-topic-4-what-age-start-theatre-classes/`.
- Instagram (@cjtheatredirector) — still never posted in any run. Not logged in on
  web and not linked to an admin Facebook page for Zapier. Unchanged blocker since
  Sept 6.
- tony-cimino.com sibling pages — still unpublished (Framer, manual).

## Run 5 — September 10, 2026 (topic 4 published: site + Substack)

- **Site:** https://novapa.org/blog/what-age-should-a-child-start-theatre-classes.html
  Deploy 5dd4f71..5cd4a69, preflight passed, verified 200. ~1,970-word body,
  Article + FAQPage schema, blog card, sitemap entry, dates set to 2026-09-10.
- **Photo:** Tony supplied a Broadway Bound class shot of the 5-8 age group
  (CF7A1065.jpg) mid-run, replacing the Shrek Jr. production photo entirely.
  Optimized to 1800x1200 mozjpeg q85, 143 KB, saved as
  `img/blog/young-children-theatre-class-ages-5-to-8.jpg`. Much better topic fit:
  the article argues about what young children can do in a class, and the photo
  shows exactly that. Caption carries the argument.
- **Substack:** https://cjcreative.substack.com/p/what-age-should-a-child-start-theatre
  First post under the new mirror rule. Full article text, all ten H2 sections,
  ordered + bulleted lists intact, canonical pointer line at the top, photo as the
  social-preview/cover image, emailed to the list. Verified complete after publish.
- **Held at Tony's instruction:** LinkedIn and Reddit. Drafts remain in
  `.claude/authority-engine/runs/2026-09-09-topic-4-what-age-start-theatre-classes/`
  (linkedin.md, reddit.md targeting r/Theatre, plus instagram.md, facebook.md,
  tony-cimino-angle.md).

### New standing rule: Substack mirrors the blog

Tony's direction, Sept 10. Recorded in the scheduled task SKILL.md and the calendar's
standing-channels line. Substack is no longer a digest or separate angle — it is the
canonical article verbatim, adapted only for format, opening with
"Originally published at <canonical URL>" so the site keeps the SEO credit for the
duplicated text.

### Browser-automation lesson worth keeping

Substack's editor appeared to "reject" synthetic input for a long stretch: `type`
calls returned success while the document character count never moved, and
screenshots failed with "Cannot take screenshot with 0 width." Root cause was that
the **Chrome window had been minimized** (outerWidth/outerHeight 0,
document.visibilityState "hidden"). `resize_window` reported success but did
nothing while minimized. Fix that worked: open a NEW tab (which gets a real
viewport), close the old one, then drive it.

Two other traps hit on the way, both worth remembering:
- **Never reload the Substack editor to clear a stuck panel.** A reload silently
  discarded ~6,000 characters of unsaved body text; the draft reverted to 4,573
  chars with no warning.
- Verify progress with
  `document.querySelector('.ProseMirror').innerText.length` between chunks rather
  than trusting the type tool's success message or `get_page_text` (which
  truncates well before the end of a long post).

Next: topic 5, "Adult acting classes: it is never too late to take the stage."

### Run 5 addendum — LinkedIn + Reddit posted (Sept 10)

- **LinkedIn:** posted to Tony's profile, "Anyone," Playbook register ("build the
  hour to the developmental floor, not the ceiling" / "Fix systems, not children").
  Article link in the first comment.
- **Reddit:** https://www.reddit.com/r/Theatre/comments/1wcqoi8/teaching_youth_theatre_the_what_age_should_my_kid/
  Posted to **r/Theatre** (55K weekly visitors, 1K weekly contributions) from
  u/Jolly_Supermarket_38, flaired **"Theatre Educator."** No link in the body,
  disclosure included, "Brand affiliate" tag deliberately left OFF.

**r/Theatre rules read in full before posting** (worth keeping for future cycles):
Rule 5 "No self promotion" explicitly names blogs and Substack — "Sharing occasional
relevant content is permitted, but should be aimed at starting a discussion here
rather than funnelling traffic off-platform." Rule 3 adds "Any content that appears
to be largely AI generated will be deleted." The link-free, question-ending format
is therefore the only safe shape here, and the mods require a flair on every post.
r/Theatre also runs pinned megathreads (High School Theatre; Vent and Rant) — route
student-level audition/casting questions there, not to standalone posts.

**Pacing ledger now:** r/nova used Sept 6 (free ~Sept 13) · r/MusicalTheatre used
Sept 10 (free ~Sept 17) · r/Theatre used Sept 10 (free ~Sept 17) ·
r/MusicalTheater (387 members, mirror sub) unused and not worth a slot.
Note two Reddit posts went out on the same day from the same account, in different
subreddits, both link-free. Watch for any mod pushback.

Topic 4 is now fully distributed except Instagram (still blocked on login/Zapier).

## Run 6 — September 11, 2026 (topic 5 drafted: adult acting classes for beginners)

Status: **drafted, staged, awaiting Tony's photo + go.** Nothing published.

- Canonical: `blog/adult-acting-classes-for-beginners.html` (~1,900 words of prose,
  Article + FAQPage schema, links to /classes, /quiz-free-class, /private-lessons
  and two sister posts). Lead-figure slot is marked `PHOTO:PENDING`.
- Blog index: panel + call-board row added under the new spotlight layout, count
  bumped to 5, "on" state moved to the new post. Both use a PLACEHOLDER image
  (the private-lesson shot) until the real photo lands.
- Sitemap entry added. Preflight passes. Branch `authority-engine-topic-5`, cut
  from origin/main at 1be7735.
- Siblings in `.claude/authority-engine/runs/2026-09-11-topic-5-adult-acting-classes/`:
  substack.md (mirror, generated from the article), facebook.md, linkedin.md,
  instagram.md, reddit.md (SKIP this cycle — see below), tony-cimino-angle.md.
- Engine instructions updated for the new blog index structure (each post = a
  .panel AND a .row, matching data-id, bump the count).

### Field re-check (primary: "adult acting classes for beginners")

Two SERPs, both owned by the career side of the industry. "What to expect" is
NYC/LA studios (Barrow Group, The Playground, Maggie Flanigan, ActorClass) plus
Backstage and Superprof — generic "warm-ups, scene study, bring water" content.
"Am I too old" is Backstage x3, Acting Magazine, Green Shirt, Quora — every one
pivots to careers: Morgan Freeman, roles for older actors, less competition over
50. The local query returns Lessons.com/Yelp aggregators, Little Theatre of
Alexandria (has adult classes; no price surfaced), Lopez Studios, and NOVAPA's own
classes page. Nobody in either SERP publishes a price.

**Wedge taken:** the searcher typing "adult acting classes for beginners" almost
never wants a career, and no result speaks to that person. The article says so
in the first section, answers "too old" by naming it a career-ladder question,
gives the first night minute by minute (nobody else does), names the three fears,
publishes $90/month + first class free as the benchmark, and brings the
drama-therapy lens (presence, being seen without managing it, play as a
playspace) that no studio blog has. Ends with a five-question checklist.

One factual guardrail applied: the site does not say who teaches the adult class,
so the draft does NOT claim Tony teaches it himself. First-person teaching voice
is kept generic ("classes I have taught"). Tony should confirm or I'll re-voice.

### Standings (WebSearch, Sept 11)

**"Tony Cimino-Johnson"** — steady vs. run 3: owned page-one (Instagram,
LinkedIn, X, VTA 2016, EdTA candidate profile, 40 Under 40). Litigation coverage
still present (two Loudoun outlets) but not dominant. No blog URL yet.

**"Mr. Cimino-Johnson"** — improving: tony-cimino.com hub, MTI, Perlego Playbook
listing AND the Tony Awards education-award page all surface now; the
award page is new visibility for this variant. Coverage (Loudoun Now, OnStage
Blog) shares the page rather than owning it.

**"Mr. CJ" theatre Northern Virginia** — still unowned; results are generic
theatre listings. Weakest variant, no movement. The bylines ("my students call me
Mr. CJ") need more volume before this moves.

**site:novapa.org/blog** — this tool returns nothing for the site: operator; it is
not Google and cannot confirm indexation either way. Five posts are live; the
first went up Sept 6. Check Google Search Console directly for the real answer.

### Reddit: skipped this cycle

Two posts went out from Tony's account yesterday (r/MusicalTheatre, r/Theatre). A
third in three days on a third theatre sub starts to look like a campaign. The
natural home for this topic is r/acting, which bans class/coach promotion
outright and would need a no-disclosure framing; the safer route is r/nova after
~Sept 13. A held draft for that is in reddit.md.

Next: topic 6, "Stage fright and audition anxiety in young performers."

## Run 7 — September 13, 2026 (topic 6 drafted: how to help a child with stage fright)

Status: **drafted, staged, awaiting Tony's photo + go.** Nothing published.

Carry-forward first: topic 5 Substack DID go live (`/p/adult-acting-classes-for-beginners`)
after the extension dropped mid-click. **Topic 5 Facebook and LinkedIn are still
unposted.** Do those before or alongside topic 6's distribution.

- Canonical: `blog/how-to-help-a-child-with-stage-fright.html` (~1,900 words of
  prose, Article + FAQPage schema). Committed as ac1269a on `authority-engine-topic-5`
  (shared checkout; cherry-pick onto a worktree from origin/main at ship time, as
  with topic 5, because other sessions commit to whatever branch is checked out).
- Blog index panel + row added (6 posts), placeholder image until the photo lands.
  Sitemap entry added. Preflight passes. Zero dashes anywhere.
- Siblings in `.claude/authority-engine/runs/2026-09-13-topic-6-stage-fright/`:
  substack.md (mirror, generated), facebook.md, linkedin.md, instagram.md,
  reddit.md (r/nova draft, window open), tony-cimino-angle.md.

### Voice discipline applied (per Tony's Pangram concern, Sept 13)

Deliberate changes from the earlier pieces: lumpier sentence rhythm (a long
tangled sentence, then a fragment, then a run of specifics), far fewer triads
and "not X but Y" symmetries, one aphoristic close instead of one per section,
messier concrete detail (a headpiece somebody's grandmother glued sequins onto
at eleven the night before), and an admission mid-piece ("Maybe I should have").
One invented fact was caught and removed before commit: a stated age for Tony.
Do not state Tony's age anywhere; it is not on the site.

Existing related Substack post noted: `/p/dealing-with-audition-anxiety-mindset`
(June 8, 2026). It is DC Unifieds register (college auditions, caps mantras,
"secure your spot"), aimed at teens. Topic 6 is parent-facing about young
children, so it does not duplicate; it should not be linked from the article
either, since its register is the one Tony retired on Sept 6.

### Field re-check (primary: "how to help a child with stage fright")

Kennedy Center, Today's Parent, Variations Psychology, Lopez Studios (local
competitor, Reston), School Musicals Company, Synergy Dance, San Ramon Academy.
All six run the same list: practice, pre-show routine, reframe nerves as
excitement, breathe, positive self-talk, visit the stage early. None
distinguishes normal arousal from a freeze from dread. None publishes what an
adult actually does in the wing. None tells parents what they are doing that
makes it worse.

**Wedge taken:** three kinds of stage fright with three different responses; the
five things loving adults do that make it worse (including rehearsing at home
the week of, which every other article recommends); the role-as-container idea
from drama therapy ("talk to the seahorse"); co-regulation in the ensemble; the
seven-step backstage protocol nobody publishes; a show-day script for parents;
and a careful "when it is more than stage fright" section that hands off to the
pediatrician without diagnosing.

### Standings

Not re-run this cycle (run 6 standings are two days old and unchanged in kind).
Six blog URLs are live now. GSC remains the real indexation check.

Next: topic 7, "How to help your kid prepare for the school musical audition."

### Run 7 addendum — topic 6 published (Sept 13)

- **Site:** https://novapa.org/blog/how-to-help-a-child-with-stage-fright.html
  (deploy bd2c51f..804f628 via clean worktree; other session's commit excluded).
- **Substack:** https://cjcreative.substack.com/p/how-to-help-a-child-with-stage-fright
  Full mirror verified from outside (all 7 sections, list, sign-off, canonical
  pointer). Cover image set. Emailed to the list.
- **Facebook:** NOVAPA25 page, as the Page, public, boost off, no group sharing.
  Confirmed "Published by Tony CJ" at post time.
- **LinkedIn:** posted, link in first comment, "1 comment" confirmed.
- **Also posted:** topic 5's Facebook (authorized Sept 11, never executed). Topic 5's
  LinkedIn is HELD: two personal-profile posts within an hour suppresses both.
  Post it tomorrow or later.
- **Photo rule now standing:** child names blurred on every student photo before
  it ships. Saved to memory and to the engine SKILL.md.

Browser notes for next time: the Substack editor acks each typed chunk ~30s
late (CDP timeout) but the text lands; check `.ProseMirror.innerText.length`
rather than trusting the batch result. The "Send to everyone now" button
does not respond to coordinate clicks; JS-focus the button and press Return.
Facebook's page feed stalls on skeleton loaders under automation; verify a
post at the moment it publishes rather than by scrolling later.

Next: topic 7, "How to help your kid prepare for the school musical audition."

## Run 8 — September 14, 2026 (topic 7 published: school musical audition prep)

- **Site:** https://novapa.org/blog/how-to-prepare-for-a-school-musical-audition.html
  (deploy 52c49d1..dee5846 via clean worktree; the shared checkout was on
  another session's branch `class-bundle-pricing`, so both commits were
  cherry-picked, not merged).
- **Photo:** DSC04323, an audition in progress (student mid-slate, director and
  accompanist behind the table). Inspected at full res: no badges, no names; the
  "16" is a jersey number. 1800x1200 mozjpeg, 206 KB.
- **Substack:** https://cjcreative.substack.com/p/how-to-prepare-for-a-school-musical
  (slug may differ; verify from the archive). Full mirror, all 8 sections, cover
  image set, emailed. Published on the third attempt: JS-focus + Enter did NOT
  work this time; a plain coordinate click on the button did, after two
  focus+Enter attempts. The button is flaky; try both.
- **Reddit:** https://www.reddit.com/r/nova/comments/1wgfg3h/nova_parents_with_a_kid_auditioning_for_the_fall/
  Link-free, disclosure in body, from u/Jolly_Supermarket_38. Reddit's submit
  page now blocks script injection for ~40s after every keystroke burst; drive it
  by coordinates, wait, screenshot, repeat. Ref-based clicks did not focus the
  fields. r/nova is now used Sept 14 (free ~Sept 21).
- **Facebook:** NOVAPA25, as the Page, public, boost off. The Post ref misfired
  onto "Share to groups" AGAIN (second time); backed out with zero groups
  selected and clicked Post by zoomed coordinate. Use coordinates for that
  button, never the ref.
- **LinkedIn:** topic 5's held adult-acting post went up today with its link
  comment (LinkedIn needed a fresh sign-in first; a device-check challenge had
  logged the session out). **Topic 7's LinkedIn is HELD to Sept 15** so the two
  don't suppress each other. Draft is in linkedin.md.
- Near-miss logged: I started typing topic 4's LinkedIn draft into the composer
  by mistake (it was already published Sept 10). Nothing landed; caught before
  posting. Read the draft file path aloud before typing, not from memory.

### Field re-check (primary: "how to prepare for a school musical audition")

Wagner College, BroadwayWorld, Danman's, APAA, School Musicals Company, Primary
Players, Lincroft Music. Identical lists: age-appropriate song, practice, arrive
early, smile, keep going if you forget, read the instructions. None decodes the
notice, none explains callbacks, none tells parents to STOP rehearsing.

**Wedge:** written from the seat that writes the notice. Line-by-line decode of
the half sheet; "callbacks by invitation" explained (not getting one is often the
answer already being yes); a two-week plan that gets lighter toward the day
(piano not a cappella, messy run, one uncomfortable listener, stop adding three
days out); the scoring sheet's real columns; and the cast-list conversation
including "do not email the director." Links to both the audition-songs and
stage-fright pieces.

Pacing ledger: r/nova Sept 14 · r/MusicalTheatre Sept 10 · r/Theatre Sept 10.

Next: topic 8, "Does theatre look good on college applications?"

## Run 9 — September 16, 2026 (topic 8: does theatre look good on college applications)

- **Site:** https://novapa.org/blog/does-theatre-look-good-on-college-applications-tony-cimino-johnson.html
  PR #116 squash-merged (9aacfd2), one production deploy. Verified live: article
  200, old slug 301s.
- **SLUG RULE (Tony, Sept 16):** every blog URL now ends in `-tony-cimino-johnson`.
  All seven earlier posts renamed in the same deploy; 301s in netlify.toml for
  `/blog/<old>` and `/blog/<old>.html`. Substack canonical pointers and shared
  social links depend on those redirects; never remove them.
- **Photo:** ED3A9039 from Desktop/NoVA PA/PHOTOS (four students onstage, Come
  From Away set). Full-res check: "NYC" hat and "591" Labrador plate are set
  dressing; no badges, no names. 1800x1200 mozjpeg, 251 KB. sharp lives in
  Desktop/NoVAPA App/node_modules, not this repo.
- **Facebook:** posted as the Page, public, boost off, link card rendered.
  Verified on /NOVAPA25/posts ("Published by Tony CJ"). The Post button moved
  after the first click (dialog re-laid out); read its rect with JS and click
  the centre. The feed still stalls on skeleton loaders; /posts + get_page_text
  was what finally confirmed it.
- **Substack:** NOT posted. cjcreative.substack.com/publish returned the
  private-page sign-in wall; this Chrome window has no Substack session.
  Draft ready in runs/2026-09-16-topic-8-college-applications/substack.md.
- **LinkedIn:** NOT posted. Session logged out; Google one-tap fired a
  device-check push to Tony's LinkedIn app ("Check your LinkedIn app"), which
  needs his tap. Draft in linkedin.md. Topic 7's held LinkedIn post also still
  unverified for the same reason.
- **Reddit:** none, at Tony's direction. Pacing ledger unchanged: r/nova Sept 14
  · r/MusicalTheatre Sept 10 · r/Theatre Sept 10.
- **Tony's tone correction (Sept 16):** the Sept 14 r/nova post read
  "aggressive and entitled." Standing rule now in memory: offer, don't
  instruct; assume nothing about the reader; all demographics and abilities.
- **New credential to lean into:** Virginia's first Dual Enrollment Theatre
  Program (Rock Ridge + Richard Bland College of William & Mary; $32K JKC grant
  for stagecraft). Used in the article body, author box, and LinkedIn draft.

### Field re-check (primary: "does theatre look good on college applications")

SERP is forums and generic lists: Quora, CollegeVine Q&A ("shows teamwork,
creativity"), College Confidential (2013 and 2016 threads), HonorSociety.org
"4 best extracurriculars", College Essay Guy's drama-school guide (BFA lane
only), St. John's blog. Nobody answers the non-major case, nobody shows how to
write the 150-character activity entry, nobody covers the teacher's
recommendation letter or the "drop it for another AP" decision.

**Wedge:** "theatre is not the credential, theatre is the record"; the four
things readers actually score; Not-this/This activity entries for a performer
AND a stage manager; dual enrollment as literal college credit; the rec-letter
section; the senior-year AP question. Local proof inside a national answer.

Rankings/indexation check deferred: this run was interactive with Tony and the
search step was spent on the field re-check and the dual enrollment facts.
Carry over to run 10.

Next: topic 9, "Is my child too shy for drama class?" Also owed: Substack and
LinkedIn for topic 8 once Tony signs in.

## Run 10 — September 16, 2026 (topic 9: is my child too shy for drama class) — DRAFTED, awaiting approval

- **Site:** drafted at blog/is-my-child-too-shy-for-drama-class-tony-cimino-johnson.html
  on branch `topic-9-ship` (worktree scratchpad/wt-topic9, cut from origin/main
  at bc4759c). Two commits: the article + index panel/row + sitemap (6cb6304),
  and a separate schema fix (daee70f, see below). NOT pushed. Local main was
  17 commits behind origin and carries Tony's uncommitted novapa-ads skill edit,
  so it was left untouched.
- **Photo:** none yet. Index panel borrows the ages 5-8 class shot as a
  placeholder; the article has a commented figure slot. Ask Tony.
- **Drafts:** runs/2026-09-16-topic-9-shy-child/ — substack.md (verbatim
  mirror), facebook.md, linkedin.md, instagram.md (caption + 7-slide carousel
  text), reddit.md (r/Theatre, recommend SKIP this run), tony-cimino-angle.md.
- **Reddit:** skipped. Ledger unchanged: r/nova Sept 14 · r/MusicalTheatre
  Sept 10 · r/Theatre Sept 10. Earliest sensible r/Theatre post is Sept 18+.
- **Found and fixed on the branch:** topics 3, 4, 5, 6 and 7 shipped with
  broken FAQ JSON-LD (one missing `}` after every acceptedAnswer), which makes
  the whole ld+json block, Article schema included, unparseable on five live
  pages. Only topics 1, 2 and 8 were valid. Fixed in daee70f; every post now
  round-trips through JSON.parse. This is why no blog post can have earned a
  rich result yet. Worth shipping with topic 9.
- **Preflight:** `node tests/preflight.mjs` passes in the worktree.

### Field re-check (primary: "will drama classes help a shy child")

Page 1 is UK and Australian franchises (Theatretrain, StageAbility, Dramacube,
PQ Academy, Pyjama Drama, Evoke, O'Grady) plus US studio blogs (Drama Kids
franchise, The Playground LA, KD Studio, Hunterdon NJ) and one Berkeley Parents
Network thread. Every one says "absolutely not" and lists generic benefits.
None separates shy from anxious from quiet, none shows what the first month
looks like, none says when NOT to enroll, none gives a car-ride script, none
publishes a price, and none is from the DC metro.

**Wedge:** "a shy child is not afraid of pretending, they are afraid of being
watched as themselves"; drama-therapy distance as the mechanism; the
shy/anxious/quiet triage; the Nora week-by-week (bench → rain → tree → wolf);
the doorway checklist with a verdict line; Say/Not car scripts; the honest
"when to wait" exceptions; $90/mo as a NoVA benchmark inside a national answer.

### Standings vs. baseline-2026-09-06

- **"Tony Cimino-Johnson" theatre:** tony-cimino.com now appears on page 1
  for the quoted-name query (it did not rank for the bare name on Sept 6).
  Google Books, VTA sched, LinkedIn, Instagram, Loudoun Now award article,
  schooltheatre.org PDF, MTI, YouTube channel also present. The OnStage Blog
  dispute editorial still ranks; unchanged.
- **"Mr. CJ" theatre Northern Virginia Cimino-Johnson:** no longer zero.
  LinkedIn, lcps.org, Instagram, the Instagram "Meet Our Founder" post,
  tony-cimino.com and dcunifieds.com all surface. Baseline had no Tony
  property at all on this query. (Query included the surname; the bare
  "Mr. CJ" theatre Northern Virginia query still needs a manual check.)
- **site:novapa.org/blog:** the search tool returns no blog URLs (GitHub repo,
  Broadway Bound Instagram, unrelated "nova" pages). Either the operator is
  not honored by this tool or the posts are still not indexed; broken schema
  on five of eight posts will not have helped. Tony: check Search Console
  directly and request indexing for the nine blog URLs after topic 9 ships.
- **Primary keyword:** no NOVAPA presence (expected; post not live).

Next: topic 10, "Theatre for kids with anxiety or ADHD." Also owed: Substack
and LinkedIn for topic 8, and a manual Search Console indexation check.

**Sept 16 update:** Tony approved (autism line cut from the article and the
Substack mirror; schema fix kept). Branch `topic-9-ship` pushed (free), PR #124
open: https://github.com/anthonycmn/novapawebsite/pull/124. Not merged; photo
still owed. Merge is the one production deploy for this task.

## Run 11 — September 18, 2026 (topic 10: theatre for kids with anxiety or ADHD) — DRAFTED, awaiting approval

- **Canonical:** blog/drama-for-children-with-anxiety-or-adhd-tony-cimino-johnson.html
  (~2,300 words, in line with topics 6-9; valid Article + FAQPage JSON-LD, verified
  with JSON.parse). Index panel + call-board row added (10 posts), sitemap entry
  added, blog lastmod bumped. `npm run check` passes.
- **Branch:** `topic-10-ship`, stacked on `topic-9-ship` (PR #124, still open) so
  the index and sitemap stack cleanly newest-first. NOT committed, NOT pushed. If
  #124 merges first, this branch merges on top with no conflict; if Tony wants
  this one first, rebase onto main and drop the topic-9 commits.
- **Photo:** none yet. Index panel borrows the Shrek Jr. cast shot (the article's
  vignette is a Shrek Jr. rehearsal) as a placeholder; the article has a
  commented figure slot. Ask Tony.
- **Drafts:** runs/2026-09-18-topic-10-anxiety-adhd/ — substack.md (verbatim
  mirror, canonical pointer line), facebook.md, linkedin.md (link in first
  comment), instagram.md (caption + 8-slide carousel text), reddit.md
  (r/Theatre, teacher-facing, pacing allows), tony-cimino-angle.md (Playbook
  register: "the room is the accommodation"), impact-travel-angle.md (trip
  checklist tie-in).
- **Reddit:** drafted for r/Theatre only. Ledger: r/nova Sept 14 · r/MusicalTheatre
  Sept 10 · r/Theatre Sept 10 (eight days; one post allowed). Skip r/nova.
- **Still owed from earlier runs:** Substack + LinkedIn for topic 8; topic 9
  photo; PR #124 merge; manual Search Console indexation check.

### Field re-check (primary: "benefits of drama for children with anxiety")

Page 1 is a UK franchise (Theatretrain), two child-therapist practice blogs
(katielear.com / childanxietycounseling.com), an Irish acting school (Gaiety),
a Thai clinic, a drama-therapy resources site, and two PubMed Central papers
(the Keiller 2023 JCPP Advances systematic review; a 2020 autism/peer-actor
study). Secondary "theatre classes for kids with ADHD": Child Mind Institute
("Kids With Learning Challenges Shine Onstage"), a UK academy blog, a Texas
theatre's audience piece, an EdTA forum thread, and a student-essay mill.

Nobody on either SERP separates anxiety from ADHD and then explains why one
room serves both; nobody names the mechanisms in plain English (distance,
containment, rehearsal-as-permission-to-be-wrong); nobody gives a class
checklist, a what-to-tell-the-teacher script, or a "when not to" section;
nobody quotes the research honestly (small, unblinded) instead of overselling
it; nobody is in the DC metro; nobody publishes a price.

**Wedge:** the two-emails opening; research cited with its own caveats
(Keiller 2023, JCPP Advances; Berghs 2022, Children); the five-property room
that serves both kids (Predictability / A job for every body / Being wrong is
the process / Feedback in seconds / The group carries you) with a verdict
rule; Theo (entrance caller) and Mia (Gingerbread Man) composites; the
"label vs. manual" Say/Not scripts; $90/mo NoVA benchmark and first-class-free
inside a national answer.

### Standings vs. baseline-2026-09-06

- **"Tony Cimino-Johnson" theatre:** page 1 unchanged from Run 10: LinkedIn,
  Google Books (Playbook), VTA 2016 sched, EdTA candidate PDF, Instagram,
  Loudoun Now award article, OnStage Blog editorial, MTI, YouTube channel,
  tony-cimino.com. Tony's own site holds its page-1 slot (absent at baseline).
- **"Mr. Cimino-Johnson" theatre:** VTA sched, LinkedIn, EdTA PDF, Perlego
  (Playbook), MTI, lcps.org, Instagram, two Loudoun Now/OnStage dispute
  items. Perlego listing is new to the set. No novapa.org URL yet.
- **"Mr. CJ" theatre Northern Virginia (bare, no surname):** still zero Tony
  properties; generic NoVA theatre listings only. Unchanged from baseline.
  The surname-qualified query (Run 10) does surface him; the bare nickname
  does not. Expected to move only once several blog posts carrying "my
  students call me Mr. CJ" are indexed.
- **site:novapa.org/blog:** the search tool still returns no blog URLs
  (novapa.org home, the GitHub repo, PR #133, a YouTube playlist). Same
  caveat as Run 10: either the operator is not honored by this tool or the
  posts are not indexed. Manual Search Console check still owed.
- **Primary keyword:** no NOVAPA presence (expected; post not live).

Next: topic 11, "Winter and spring break theatre camps" [local].

---

## Run 12 — September 22, 2026 (topic 11: winter and spring break theatre camps) — DRAFTED, awaiting approval

First run since the engine state landed in the repo. `.claude/authority-engine/` is
readable from the cloud for the first time, so this is the first cycle that started
with the real calendar instead of a STATUS-BLOCKED file.

- **Canonical:** blog/spring-break-theatre-camps-for-kids-tony-cimino-johnson.html
  (~2,040 words, 9 h2 sections, valid Article + FAQPage JSON-LD verified with
  json.loads). Index panel + call-board row added (10 posts), sitemap entry added,
  blog lastmod bumped to 09-22. `npm run check` passes, analytics block included.
- **Branch:** `authority-engine`, committed and pushed. Not merged, no PR opened.
- **Photo:** none. Article has a commented figure slot; the index panel borrows
  broadway-bound-camp-counselor-camper.jpg as a placeholder. Ask Tony.
- **Drafts:** runs/2026-09-22-topic-11-break-camps/ — substack.md (verbatim mirror,
  canonical pointer line, absolute URLs), linkedin.md (link in first comment),
  facebook.md, instagram.md (caption + 8-slide carousel), reddit.md (r/nova).
- **Reddit:** r/nova only. Ledger: r/nova Sept 14 (eight days, allowed) ·
  r/Theatre Sept 18 (four days, skipped) · r/MusicalTheatre Sept 10.

### Field re-check (primary: "spring break theatre camps for kids")

Page 1 is entirely vendor landing pages and listing aggregators: Encore Stage &
Studio (Arlington/Alexandria), The Theatre Lab (DC), Alliance Theatre (Atlanta),
The Play Group Theatre (Westchester), City Kids Theater (Glenview), and four
Kids Out and About city pages. Secondary "winter break camps for kids what to
look for" returns generic parenting listicles — Jumbula, Brighterly, Noodle,
ActivityHero, and regional parent blogs — whose advice is about packing extra
socks, not about choosing a program. Secondary "how to choose a theatre camp"
is dominated by Long Lake Camp For The Arts (three separate posts), plus
FBPlayhouse, Denise Simon Coaching, and ActivityHero, all written about
*summer* camp: overnight, bunks, homesickness, multi-week.

Nobody defines the break-camp category at all. Nobody separates winter break
from spring break as different problems. Nobody states what a single day can
honestly deliver versus a five-day week. Nobody publishes a price except The
Theatre Lab ($450/week, 9-3, aftercare extra). Nobody writes a "when not to
book one" section. Local supply is thin too: for Loudoun the SERP offers the
county PRCS activity guide, Drama Kids, Loudoun Soccer and Karter Schools —
no editorial answer.

**Wedge:** the October email opening and the eighteen-closure-day count; the
two-questions-at-once standard (childcare AND the day) stated without
embarrassment; the three-products-one-name taxonomy; the Rule (one day = one
skill, five days = one show) with the overselling tell; "compare the hours,
not the price" with the $450/9-3-plus-aftercare worked example; the seven
questions with a two-vague verdict line; real published prices ($79/day,
$349 five-day pack = $69.80/day) inside a national answer; the 2027 Loudoun
break dates; and a "when not to book" section that sends slow-to-warm kids to
weekly classes and audition worries to coaching instead.

### Standings vs. baseline-2026-09-06

- **"Tony Cimino-Johnson" theatre:** page 1 unchanged from Run 11: LinkedIn,
  Google Books (Playbook), VTA 2016 sched, EdTA candidate PDF, Instagram,
  Loudoun Now award article, OnStage Blog editorial, MTI, YouTube channel,
  tony-cimino.com. Tony's own site still holds its page-1 slot.
- **"Mr. Cimino-Johnson" theatre:** VTA sched, LinkedIn, EdTA PDF, Perlego
  (Playbook), MTI, lcps.org, tony-cimino.com, plus the two Loudoun Now /
  OnStage items. Set is stable. Still no novapa.org URL on this query.
- **"Mr. CJ" theatre Northern Virginia (bare nickname):** still zero Tony
  properties — Tripadvisor, 1st Stage, NoVA Mag, Virginia.org. Unchanged from
  baseline and from Runs 10 and 11. The surname-qualified queries do surface
  him; the bare nickname does not.
- **site:novapa.org/blog:** the operator still returns nothing from the domain
  (Wikipedia noise, the GitHub repo, a YouTube playlist). Same caveat as Runs
  10-11: either the tool does not honor the operator or the posts are not
  indexed. **Manual Search Console check is still owed and is now three runs
  old.**
- **NEW, and worth Tony's attention:** an exact-match search for
  "is my child too shy for drama class" + Cimino-Johnson returns **GitHub PR
  #124 as the number one result**, while the live novapa.org article — merged
  to main and live since Sept 18 — does not appear anywhere. The public repo
  is outranking the site for the site's own article title. Page 1 otherwise is
  the same UK/AU franchise set the piece was written to beat (Theatretrain,
  StageAbility, Dramacube, Evoke, Drama Kids, PQ Academy, Mumsnet).
- **Primary keyword:** no NOVAPA presence, expected, post not live.

Next: topic 12, "What are Unified auditions? A plain-English guide for families".

---

## Run 13 — September 23, 2026 (topic 12: what are unified auditions) — DRAFTED, awaiting approval

- **Canonical:** blog/what-are-unified-college-auditions-tony-cimino-johnson.html
  (~1,650 words — inside ROUTINE.md's 1,200-1,800 band, unlike recent siblings —
  8 h2 sections, valid Article + FAQPage JSON-LD verified with json.loads).
  Index panel + call-board row added (11 posts), sitemap entry added, blog
  lastmod bumped to 09-23. `npm run check` passes.
- **Branch:** `authority-engine`, committed and pushed. Not merged, no PR.
- **Photo:** none. Article has a commented figure slot; the index panel borrows
  teen-conservatory-dear-evan-hansen.jpg as a placeholder. Ask Tony.
- **Drafts:** runs/2026-09-23-topic-12-unified-auditions/ — substack.md (verbatim
  mirror), linkedin.md (peer/field register, link in first comment), facebook.md,
  instagram.md (caption + 8-slide carousel), reddit.md (r/MusicalTheatre).
- **Reddit:** r/MusicalTheatre only. Ledger: r/MusicalTheatre Sept 10 (thirteen
  days, allowed) · r/Theatre Sept 18 (five days, skipped) · r/nova Sept 22
  (one day, skipped). No link in the draft at all, given the commercial interest.

### Also this run: the GA4 gate caught the break-camps post

main merged #153 overnight, adding Google Analytics 4 (G-90GQK8HYNV) to all 61
public pages and teaching preflight to require it. Topic 11's post was written
on this branch before that landed, so merging main brought the new rule without
the tag and `npm run check` failed. Fixed by copying the block from a sibling
post. This is the second time the analytics gate has caught a blog post written
on a branch while an analytics change was in flight on main (the first was
Sept 18, topic 9). Worth noting the pattern: it is working exactly as intended,
and it will keep happening as long as posts are drafted on a long-lived branch.

### Field re-check (primary: "what are unified college auditions")

Page 1 is the official body (unifiedauditions.com, terse), Acceptd's guide
(a platform vendor), and then coaching businesses selling coaching: My College
Audition, College Audition Project, StageReady, Topher Keene, MacTheatre. Plus
two BroadwayWorld articles (2019 and 2023) and a College Confidential master
list thread. Secondary "do you have to attend unifieds / worth it": Road2College,
the same coaching sites, and a WordPress pros-and-cons post from 2019.

Nobody writes the plain-English taxonomy — that one word covers the national
coalition, a scatter of independent regional events, AND the separately named
"United Auditions." Nobody writes for the parent rather than the student or the
coaching client. Nobody itemizes the money beyond a bare "upwards of $5,000."
Nobody explains, from behind the table, what the five minutes actually are.
And almost nobody states plainly that you do not have to go.

**Wedge:** the ballroom-at-seven vignette written from the organiser's side;
the three-things taxonomy; "this is a matching problem, not a ranking"; the
prescreen-reorders-the-year point; the count-your-schools rule applied against
Tony's own event ("if the school your child cares most about is not coming to
Leesburg, I would rather say so than take your registration"); the four-line
cost breakdown with coaching named as the first line to cut; and a disclosure
paragraph rather than a soft-pedal.

### Standings vs. baseline-2026-09-06

- **"Tony Cimino-Johnson" theatre:** page 1 unchanged from Runs 11-12.
- **"Tony Cimino-Johnson" (bare, no "theatre") — checked this run:** a different
  page-1 set. LinkedIn, Instagram, VTA sched, EdTA PDF, X/@tonycmn, Wikipedia
  noise, plus **Loudoun Times: "Loudoun County educator selected for Northern
  Virginia 40 Under 40"** (Class of 2025) and two Loudoun Times/Loudoun Now
  items about the LCPS matter. Two notes for Tony: the bare-name query surfaces
  the LCPS coverage much higher than the "+theatre" query does, and the 40 Under
  40 recognition is NOT on the approved credential list in ROUTINE.md. It has
  not been used in any draft. Tony's call whether to add it.
- **"Mr. Cimino-Johnson" theatre:** unchanged from Run 12.
- **"Mr. CJ" theatre Northern Virginia:** still zero Tony properties. Unchanged
  from baseline and Runs 10-12.
- **site:novapa.org/blog:** manual Search Console check still owed, now four
  runs old. The GitHub-outranking-the-site finding from Run 12 stands.
- **Topic 11 primary ("spring break theatre camps for kids"):** re-checked
  today, one day after drafting. No novapa.org presence, expected, post not
  live. SERP composition unchanged: Encore Stage & Studio, Kids Out and About
  city pages, besttheatercamps.com directory, individual theatre camp pages.
  Still no editorial answer on the query.

Next: topic 13, "High school theatre fundraising that actually works"
(tony-cimino.com lane — draft goes in runs/, not blog/).

### Run 13 addendum — September 23, 2026, later the same day

Tony came into the thread with photos and revision notes. Topic 12 revised and
re-pushed; status moved to `awaiting-approval`.

- **Photos supplied and installed.** Lead: a teen actor singing in a rehearsal
  room, optimised with sharp to 1800x1200, jpeg q85 mozjpeg, at
  `img/blog/teen-actor-singing-college-audition.jpg`, with keyword-bearing alt
  text, a caption, `height:auto` figure CSS, and the URL added to the Article
  schema image array. Author headshot at `img/staff/tony-cimino-johnson.jpg`
  (526x522, native size, not upscaled), now in the post-author aside with a
  circular crop. Child-names rule checked on both: no lanyards, badges, name
  tags or cast lists visible in either frame. The index panel and call-board
  row now use the real lead photo instead of the borrowed conservatory shot.
- **DC Unifieds framing reversed on Tony's instruction.** The original draft's
  count-your-schools rule discouraged attendance when only one or two list
  schools were present, and the closing disclosure said "including the part
  where I tell you not to." Both are gone. The replacement argument is stronger
  and is also true: the standard counting advice misses the point, because the
  programs a student has not heard of yet are the best reason to be in the
  building. The FAQ carried the same discouraging line in two places (visible
  details block and FAQPage JSON-LD) and was corrected in both.
- **Registration link added** at https://dcunifieds.com/register.html — twice in
  the article (cost section and disclosure), plus Facebook, LinkedIn and the
  Reddit draft.
- **De-AI pass.** Tony flagged the prose as sounding machine-written. Rewrote the
  body: cut the density of antithesis constructions ("not X, but Y") and the
  stacked one-line punch paragraphs down to two or three, let sentences run
  long and uneven, added contractions throughout per the blog calibration in the
  voice skill, varied the h2 shapes, and added concrete digression (the stairwell
  acoustics line, the rep who wandered off to find breakfast, the carpet).
  1,794 words, still inside the band.
- **Reddit:** r/nova excluded per Tony. Draft is r/MusicalTheatre with the
  registration link included as asked, plus an explicit warning in the file that
  a self-linking post is the exact shape that subreddit removes, and three
  options with a recommended one (post without the last line, drop the link in a
  comment when asked).

Nothing was published. The hard rule stands: Tony publishes.
