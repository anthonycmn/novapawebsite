---
name: parallel-build
description: "Build a multi-page site, funnel, or feature FAST by fanning work out to subagents instead of doing it serially. Use whenever Jason asks to build a landing page, funnel, or page set from a Figma design or reference — anything with 2+ pages or pages + backend — and whenever he says 'build this', 'make this real', or hands over a design link. Target: a 3-page funnel in about 5 minutes of wall-clock, not 20."
---

## Why this exists

The free-class funnel (Aug 26 2026) took ~20 minutes because one agent did
everything in sequence: read the design, query the DB, write the backend,
write three pages, crop assets, verify, deploy. Almost none of those steps
depended on each other. Jason's standing instruction: **parallelize builds
like this. Five minutes, not twenty.**

## The shape of the fan-out

The main session is the coordinator. It does ONLY: design intake, the
work-split, integration, deploy, and reporting. Everything else goes to
subagents launched IN THE SAME MESSAGE (they run concurrently — launching
them one at a time is the mistake this skill exists to prevent).

Typical split for a "design to live funnel" build:

1. **Asset agent** — extract photos/decorative elements from the design
   export into the target img/ directory (see Asset pipeline below), and
   report a manifest (filename, size, what it shows).
2. **Data agent** — pull every fact the pages will claim from the real
   systems: prices and capacity from `activities` (management API, token at
   `~/.config/novapa/supabase_token`), schedules from the existing site
   pages, phone/address from the footer conventions. Returns a fact sheet.
   Pages NEVER ship a number this agent didn't verify (seat-counting skill).
3. **Backend agent** — the Netlify function + any new table (git-tracked
   SQL in db/, applied via the management API, RLS closed). Test locally by
   importing the function with `SUPABASE_SERVICE_ROLE_KEY` from
   `~/.config/novapa/supabase_service_key`.
4. **One agent per page** — each writes one complete HTML file from the
   design map + the fact sheet + the design-token block (below). Pages are
   self-contained (single-file, inline CSS) so page agents never collide.
5. Coordinator: integrate, run one local render check, commit, push the
   staging branch, verify the branch deploy, hand Jason the link.

Give every agent the SAME short context block: design tokens (colors,
fonts, grid width), the copy rules (below), file paths, and exactly what to
return. Agents should return facts and file paths, not essays.

## Design intake (before fanning out)

- Figma: the user's "Novapa" Chrome profile must be signed in. Zoom via the
  zoom menu (top right), pan with the hand tool (h), read exact type via
  select tool + Properties panel. Export frames at 1x AND 2x.
- Downloads land in `~/Downloads`, which the shell CANNOT read (macOS TCC
  blocks it, even unsandboxed; Finder AppleScript is blocked too). Chrome's
  download history (`Profile 37/History` sqlite, `downloads` table) proves
  what landed. Ask Jason to drag the files into `~/novapa/figma-exports/`
  — batch every export first so he drags ONCE.
- Map the design from the 2x export: downscale with PIL, draw y-gridlines,
  read section boundaries. Detect photo rectangles automatically (numpy +
  scipy.ndimage.label against the flat background color) instead of
  eyeballing crop boxes.

## Asset pipeline

- Crop photos and doodles straight out of the 2x frame export — they carry
  the exact art direction. Save JPG q82-85 into the feature's img/ dir.
- Decorative brush strokes: crop WITH their flat background baked in and
  place them on the identical background color — no transparency work.
- The only asset that needs a per-node Figma export is one with text baked
  over it (hero backgrounds). Check whether the photo is already in
  register/img/ first — designers usually pulled from the site.
- Detection gotcha: headings near a crop region get flagged as content.
  Find the card/container rectangle first, then the photo inside it.

## House rules the agents must carry

- Copy: never "ages 5 to 17" — name the casts (5–9, 9–12, 12–17). No
  emojis. No fabricated scarcity; sold-out claims only per Jason. Only
  offers that already exist (day camps $79/day, all-5 pack $349 with free
  snow days; shows $695; conservatories $895). Rehearsals "week of
  September 15". Venue: 18945 Conference Center Drive, Plaza C, Leesburg VA
  20176. Phone: (571) 571-2120.
- Fonts: Protest Strike for headlines (weight 400, letter-spacing 0.01em),
  DM Sans body/buttons, unless Jason names another. Do not ship
  trial-licensed font files.
- Tracking: fbq init 2191001311729801 + 902777265812159, PageView +
  funnel-appropriate events; `/posthog.js`; forward utm_*/fbclid through
  every internal link.
- Deploy: novapawebsite is staging-first (`staging-summer-sprint` branch →
  branch deploy), prod (`main`) only on Jason's explicit go. dcunifieds and
  its portal auto-publish.

## What stays with the coordinator

Anything requiring Jason (Figma sign-in, file drags, native dialogs),
anything destructive, the final publish, and the report. Keep the report
short: link, what shipped, what diverged from the design and why, what
needs his decision.
