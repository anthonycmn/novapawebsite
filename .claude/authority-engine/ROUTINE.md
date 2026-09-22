# Authority Engine — daily cloud routine procedure

The cloud routine's prompt is one line: read this file and follow it. Edit this
file to change how the engine behaves; the routine itself never needs touching.

## Hard rules

1. **YOU NEVER PUBLISH ANYTHING, ANYWHERE. Tony publishes.** Do not post to
   Substack, LinkedIn, Facebook, Instagram, or Reddit. Do not push to `main`.
   Do not open a PR. Your job ends at a reviewable draft on a branch.
2. You are in the cloud: no access to Tony's computer, Chrome, Desktop, or
   Zapier. If a step needs any of those, write down what he must do instead.
3. Never reference or allude to the Rock Ridge dispute or any litigation.
4. Never invent a price, a statistic, a student name, or a credential. Real
   figures only, taken from the site or the calendar.
5. Only push to the `authority-engine` branch. Branch pushes cost 0 deploy
   credits; a push to `main` costs 15 and is Tony's call, never yours.

## 0. Read the thread first — Tony can talk to you here

This routine runs as one continuous session, so Tony can reply to you between
runs. **Before you do anything else, read back through the conversation for
anything he has said since your last run.** What he says in the thread outranks
this file for that day. Answer him directly in your report — it is a
conversation, not a log.

Handle it in this order:

- **He gave feedback on a draft** (tone, angle, a headline he dislikes, a fact
  to fix) — revise that draft first and push the fix. Do not move on to a new
  topic in the same run. Getting the last piece right beats starting the next.
- **He asked a question** — answer it plainly in your report. If answering it is
  the whole job that day, that is a fine day's work; say so and draft nothing.
- **He redirected you** ("skip that one", "do X next", "stop doing Y") — follow
  it, and if it is a lasting change rather than a one-off, edit this file so it
  sticks, and tell him you did.
- **He said to publish something** — you still cannot publish, and that has not
  changed. Confirm what is ready, tell him it is waiting on him, and be specific
  about where (branch, file paths, which channels are drafted).
- **He sent or described a photo** — you cannot receive image files usefully in
  the cloud. Note what he intends, and leave the placeholder for him to fill in
  locally when he publishes.
- **He said nothing since the last run** — carry on with the normal cycle below.

## Setup

    TZ=America/New_York date
    git fetch origin
    git checkout -B authority-engine origin/authority-engine
    git merge --no-edit origin/main

If the merge conflicts: `git merge --abort`, carry on, and say so in the report.

If `.claude/authority-engine/content-calendar.md` is missing, **STOP**. Draft
nothing. Report that the state is gone. Guessing the calendar would risk
redrafting published work and creating a rival source of truth. (This exact
failure silently blocked the engine Sept 18-22, 2026.)

## 1. Pick the topic

From `content-calendar.md`, take the **first topic whose status is `todo`**.
Statuses run `todo` then `drafted` then `awaiting-approval` then `published`.

- If no `todo` topics remain: draft nothing, report that the season is complete
  with a short scoreboard summary, and ask whether he wants a new set. **Do not
  disable or delete yourself.**
- **Backlog guard:** count topics sitting at `drafted` or `awaiting-approval`.
  If there are 5 or more, draft nothing today. Report the backlog and what each
  one is waiting on. Publishing is Tony's bottleneck, not writing.

## 2. Re-check the field

WebSearch the topic's primary keyword and 2-3 secondaries. Note what ranks now,
then write something materially better and more genuinely useful.

**Geography:** write for the whole East Coast. Answer the national question
first and completely; Northern Virginia / Leesburg / Loudoun / Fairfax appear as
Tony's proof and as real data points, never as the frame. Local modifiers belong
in secondary keywords and examples, not the headline - unless the calendar marks
the topic `[local]`.

## 3. Register: authority, not marketing

Tony's explicit standing direction. The piece must answer the searcher's
question better than anything ranking, using the words searchers actually type
(primary and secondary keywords worked naturally into h2s and body). NOVAPA,
DC Unifieds and ImpACT appear only as the author's credentials and as honest
benchmarks (e.g. real published prices as market data). No "register now", no
urgency, no CTA buttons - close with related-reading links. He is the expert the
searcher found, not the vendor who found the searcher.

Credentials that are true and usable: Tony Awards / Carnegie Mellon Excellence
in Theatre Education Honorable Mention (2024); author of *The Theatre Leader's
Playbook* (Routledge); founder and CEO of NOVAPA; 20+ years, 100+ productions;
MFA Theatre Education, MA Drama Therapy (NYU); founded Virginia's first Dual
Enrollment Theatre Program (Rock Ridge with Richard Bland College).

## 4. Write

Every word goes through `.claude/skills/tony-voice/SKILL.md`. Read it and follow
it strictly.

**a. The canonical article**, 1,200-1,800 words, from
`.claude/authority-engine/post-template.html`. Fill every token, write real FAQ
content, include Article + FAQPage schema, and link to at least two program
pages.

- Slug rule (standing, Sept 16): **every blog URL ends in
  `-tony-cimino-johnson`**. Save as `blog/<slug>-tony-cimino-johnson.html`.
- Add it to `blog/index.html` between the POSTS:BEGIN / POSTS:END markers.
  The index uses the spotlight layout, so **each post needs two blocks with
  matching ids**: an `<article class="panel" id="panel-ID">` inside `.panels`
  (lead photo, tag, title, date, two-sentence excerpt, "Read the full guide"
  link) AND a `<button class="row" data-id="ID">` inside the `.board` call
  board (thumb, short title, tag + date). Newest first in both. Move the
  `on` / `aria-selected` state to the new post. Bump the "N posts" count in
  `.boardhead`. Add a `sitemap.xml` entry.
- If the canonical home is tony-cimino.com or impacttoursandtravel.com instead,
  save the draft under `.claude/authority-engine/runs/DATE-topic-N-slug/` -
  those sites are published separately.

**b. The photo.** You cannot receive one in the cloud. Leave the lead figure as
an HTML comment placeholder, never a fabricated image path, and in your report
tell Tony exactly what shot would fit. When he supplies it locally: optimise
with sharp (rotate, ~1600-2000px wide, jpeg q85, mozjpeg) into `img/blog/` with
an SEO-descriptive kebab-case filename, keyword-bearing alt text, a caption, add
it to the Article schema image array, and `height:auto` in the figure CSS.
**Child-names rule (standing, Sept 13):** before any student photo ships, every
legible child name must be blurred - lanyards, badges, name tags, cast lists,
jerseys, background badges. Faces stay, names go.

**c. Channel drafts**, all into `.claude/authority-engine/runs/DATE-topic-N-slug/`:

- `substack.md` - **mirrors the article** (standing, Sept 10): same headline,
  same body, same order. Not a digest or teaser. Adapt only what the format
  forces: plain prose, FAQ folded in or dropped, internal links as full
  `https://novapa.org/...` URLs. Open with "Originally published at CANONICAL
  URL" so the site keeps the SEO credit. Include title and subtitle.
- `linkedin.md` - 150-300 words, first person, leadership/craft register, link
  to go in the first comment rather than the post.
- `facebook.md` - warmer, parent-facing, 2-4 short paragraphs, link included.
- `instagram.md` - caption in his voice signed "Mr. CJ", a few local hashtags,
  link-in-bio pointer, plus slide-by-slide Canva carousel text (navy #08111F,
  gold #E8B84B, Playfair / DM Sans).
- `reddit.md` - **most days, skip this entirely.** At most ~1 post per week per
  subreddit; check `runs/` for the last Reddit draft before writing another.
  When it fits: one value-first draft for the single best subreddit, genuinely
  answering the question in the body, no marketing voice, no name-variant
  seeding. **Tone (standing, Sept 16): offer, do not instruct - the last one
  read aggressive and entitled.** Assume no demographic and no ability level;
  write so it is true for every family. Note the subreddit self-promotion rule.

Work the name variants (Tony Cimino-Johnson, Mr. Cimino-Johnson, Mr. CJ) in
naturally through bylines and anecdotes - never keyword-stuffed, and never on
Reddit.

## 5. Scoreboard

WebSearch current standings for "Tony Cimino-Johnson", "Mr. Cimino-Johnson",
"Mr. CJ" theatre Northern Virginia, and this topic's primary keyword. Run a
`site:novapa.org/blog` indexation check. Append a dated entry to
`.claude/authority-engine/scoreboard.md` noting movement against
`.claude/authority-engine/baseline-2026-09-06.md`.

## 6. Persist - this is the step that used to fail silently

Mark the topic `drafted` in `content-calendar.md`, then commit **everything**
under `.claude/authority-engine/`, `blog/`, `sitemap.xml` and `img/`, and push
to the `authority-engine` branch.

Then verify the push actually carried the files:

    git ls-tree -r origin/authority-engine --name-only -- .claude/authority-engine/ | wc -l

If that count did not grow, say so loudly in the report - it means the state is
being dropped again and the next run will start blind.

## 7. Report

Close with: the topic drafted, every file path Tony needs to review, **the photo
request**, anything skipped and why (Reddit pacing, merge conflict, backlog
guard), the scoreboard movement, and one plain line - nothing was published, and
publishing is his.
