# Authority Engine — what is waiting, and how to ship it

Updated by the daily run. Last updated: **Saturday 26 September 2026**.

**Backlog: 5. The guard has tripped.** ROUTINE.md stops the engine drafting new
topics at 5, so no topic was written today and none will be tomorrow until some
of this clears. Writing is not the bottleneck; publishing is.

---

## The one with a clock on it

**Topic 14 — The BFA musical theatre audition timeline.** Prescreen deadlines
run November 1 to December 15, so the audience is searching for this now.
Published in December it is dead until next August. Nothing else in the queue
is time-sensitive. If you only do one thing, do this one.

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

### 11. Winter and spring break theatre camps [local] — `drafted` 22 Sep
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

## Standing items, oldest first

1. **Search Console indexation check** — owed for six runs. Needs your login;
   the engine cannot do it. The reason it matters: an exact-match search for
   "is my child too shy for drama class" returns **GitHub PR #124** as the top
   result while the live article does not appear at all. The public repo is
   outranking novapa.org for novapa.org's own article title.
2. **`topic-10-ship` not on origin** — see topic 10 above.
3. **DC Unifieds date mismatch** — the admin page says Oct 15-18, the public
   dcunifieds.com listing reads Oct 15-17 plus a virtual weekend Oct 24-25.
   Possibly both correct (a load-out day is not an audition day), but families
   are reading one of them. The event is three weeks out.
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
