# Authority Engine — what is waiting, and how to ship it

Updated by the daily run. Last updated: **Monday 5 October 2026**.

**Backlog: 5. The guard has tripped — day 10.** ROUTINE.md stops the engine drafting new
topics at 5, so no topic was written today and none will be tomorrow until some
of this clears. Writing is not the bottleneck; publishing is.

---

## The one with a clock on it

**Topic 14 — The BFA musical theatre audition timeline.** Prescreen deadlines
run November 1 to December 15. **As of today the nearest of those is 27 days
out and the furthest is 71.** The audience is mid-search right now; published
in December it is dead until next August. Nothing else in the queue has a
clock. If you only do one thing, do this one — and remember it has to ship
with or after topic 12, because it links to it.

**Also worth knowing: DC Unifieds is 10 days out** and its public site still
shows two different end dates, per the standing item below. That is not an
Authority Engine job, but it is the most time-critical thing this run can see.

---

## The queue

### 10. Theatre for kids with anxiety or ADHD — `drafted` 18 Sep
- **Where:** article HTML exists **only on your machine**, on an unpushed
  `topic-10-ship`. It is not in this repo and never has been.
- **Safe:** all five channel drafts are committed at
  `.claude/authority-engine/runs/2026-09-18-topic-10-anxiety-adhd/`. The
  Substack file mirrors the article, so the prose is recoverable even if the
  HTML is lost.
- **Needs from you:** `git push -u origin topic-10-ship`. One command. Until
  then this article is one disk failure from gone.
- Photo still needed.

### 11. Winter and spring break theatre camps [local] — `drafted` 22 Sep — **has a soft clock too, noticed 1 Oct**

The piece is about how to choose a camp for the days school is closed, and the
fall closure days on your own calendar are **Oct 12** (Indigenous Peoples' Day,
all three divisions out, 7 days away), **Oct 29 and 30** (Loudoun workday and
student holiday), then Nov 2, 3, 9 and 11. Parents shop for these two to three
weeks ahead, which means the demand for this article is live now and thins out
through November. It is not as sharp a deadline as topic 14's, but it is not
evergreen either, and I had been describing it as though it were.
- **Where:** `authority-engine`. Article, index panel, call-board row, sitemap
  entry all in.
- **Channels:** `runs/2026-09-22-topic-11-break-camps/` — substack, linkedin,
  facebook, instagram, reddit (r/nova).
- **Needs from you:** review and approval, then merge. Photo: index panel is
  borrowing the counselor-and-camper shot as a placeholder.

### 12. What are Unified auditions? — `awaiting-approval` 23 Sep — **APPROVED BY YOU**
- **Where:** `topic-12-ship`, branched off main, topic 12 only. Real lead photo
  and your headshot are in. Preflight green. Fast-forward verified clean.
- **Ship it:**
  ```
  git fetch origin && git checkout main && git pull
  git merge --ff-only origin/topic-12-ship && git push origin main
  ```
- **Then, in this order:** Facebook and Substack after the deploy finishes
  (both link the article and will 404 before it). Reddit any time — the
  r/MusicalTheatre draft has no link in it.
- **Channels:** `runs/2026-09-23-topic-12-unified-auditions/`.

### 13. High school theatre fundraising — `drafted` 24 Sep — tony-cimino.com lane
- **Where:** `runs/2026-09-24-topic-13-theatre-fundraising/`. No blog file by
  design; Framer publishes separately from this repo.
- **Blocked on:** the Framer page going up. The Substack mirror and the
  LinkedIn first comment both point at
  `https://tony-cimino.com/high-school-theatre-fundraising`, which does not
  exist yet. Posting either before the page is live points at a 404.
- **Open question for you:** a real Rock Ridge ticket price or camp revenue
  figure would strengthen two sections. Everything currently in it is either
  your published arc or sourced from elsewhere.

### 14. The BFA audition timeline — `drafted` 25 Sep — **SEASONAL**
- **Where:** `authority-engine`. Article, index (12 posts), sitemap all in.
- **Channels:** `runs/2026-09-25-topic-14-bfa-timeline/` — substack, facebook
  (parent-facing and timely), linkedin, instagram. No Reddit, pacing.
- **Needs from you:** approval. If you want this one shippable on its own,
  without topic 11 riding along, say so and the next run will cut a
  `topic-14-ship` branch off main the same way topic 12 got one.
- Photo: index panel is borrowing the school-audition shot.

---

## Verified Monday 28 Sep — the waiting drafts have not gone stale

Three hold days with nothing to merge, so the run spent the time checking
whether the drafts still tell the truth. main has moved five times since topic
11 was written, and an article that quotes live prices can rot quietly.

- **Topic 11's figures all still hold** against `day-camps.html` as it stands
  today: $79 a day, $349 for the five-day pack, $395 list, $69.80 a day,
  8:30-4:15, the three age groups, spring break still Mar 22-26 2027, and still
  no camp on the calendar between Dec 20 and Jan 3, which is what the article
  says.
- **Every internal link in all three waiting posts resolves.** Twenty-seven
  links checked, zero dead.
- **Preflight passes** on the current merge of main.

### One thing this turned up: a shipping order dependency

**Topic 14 links to topic 12's article.** Topic 12 is not live. So if topic 14
ships first, that link 404s on a brand new post.

Order matters, and there are only two safe options:
- Ship **12 first, then 14**, or
- Ship them **together**, which `authority-engine` already does since both are
  on it.

What does not work is 14 alone. If you want the seasonal one out on its own,
say so and the next run cuts a `topic-14-ship` branch with the topic 12 link
swapped for something live.

## Standing items, oldest first

1. **Search Console indexation check** — owed for six runs. Needs your login;
   the engine cannot do it. The reason it matters: an exact-match search for
   "is my child too shy for drama class" returns **GitHub PR #124** as the top
   result while the live article does not appear at all. The public repo is
   outranking novapa.org for novapa.org's own article title.
2. **`topic-10-ship` not on origin** — see topic 10 above.
3. **DC Unifieds dates contradict each other ON THE PUBLIC SITE** — escalated
   27 Sep, and this is now the most urgent item on the list. The event is
   **18 days out** and families are booking hotels against these dates.

   What I originally flagged was an internal/external mismatch: the register
   admin page says Oct 15-18, the public site read Oct 15-17. On re-checking
   today, the public site surfaces **both**: "October 15-17, 2026 at the
   National Conference Center" in one place, and "in-person auditions Oct 15-18,
   2026 (with virtual livestream available)" in another, plus the second
   virtual weekend Oct 24-25.

   So this is not a stale internal note. Your own public-facing site is
   carrying two different end dates on different pages. A family reading the
   first books three nights; a family reading the second books four.

   I cannot verify further from here — the egress proxy blocks dcunifieds.com,
   so all of this is from search snippets rather than the live pages. Someone
   needs to open the site and reconcile it. Fifteen minutes, and it is the
   highest-value fifteen minutes on this page.
4. **40 Under 40** — the Loudoun Times piece on your Northern Virginia 40 Under
   40 selection is not on the approved credential list in ROUTINE.md, so it has
   not been used in any draft. Your call whether to add it.

## A decision worth making

Three runs in a row, a site-wide tag change landed on main while posts sat on
this branch, and the preflight gate blocked the deploy each time: the analytics
block on the 18th, GA4 on the 23rd, CookieYes on the 24th. The gate caught all
three, which is the system working. But it is structural, not bad luck — a
long-lived branch will always be missing the newest tag, and `topic-12-ship`
has now needed re-syncing twice purely because it sat.

Two ways out, and either is fine:
- **Cut a fresh per-topic branch at draft time** rather than stacking on
  `authority-engine`, so each post is independently shippable and short-lived.
- **Merge sooner**, so the window where drift can happen stays small.

Until one is chosen, expect the gate to keep firing and expect a line about it
in every report.
