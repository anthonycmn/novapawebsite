# NOVAPA website — working rules

## Netlify deploy budget (read this before any git command)

This repo auto-deploys to Netlify. Every push to `main` costs 15 credits,
flat, no matter how small the change or how fast the build. Pushes to any
other branch, and Deploy Previews on pull requests, cost 0 credits.

The billing unit is the push, not the commit. Ten commits pushed together
are one deploy. Ten commits pushed one at a time are ten deploys.

1. Never `git push` immediately after `git commit`. Commit as often as you
   want. Push once, at the end of the task, when the work is verified.
2. Default to a branch. Start work with `git checkout -b <short-task-name>`.
   Push that branch freely. Open a PR and use the free Deploy Preview URL.
3. Land it with one squash merge when the preview looks right. That is the
   one deploy the task is allowed to cost.
4. Push straight to `main` only for a live-site emergency, meaning a bug
   families or customers are hitting right now.
5. Use `[skip ci]` for commits that touch only markdown, comments, or notes.
   When pushing a batch it must be in the last commit's message.
6. Do not push as a way of testing. Verify locally or on the Deploy Preview.
   Never push again just to confirm the last push worked.
7. Before pushing to `main`, state in one line what is being deployed and
   confirm it is a deliberate release, not a checkpoint.

### Why this exists

Between Aug 8 and Aug 28 2026 we ran 708 production deploys across the
repos. At 15 credits each that is 10,620 credits — 93% of everything we
consumed. Bandwidth, compute, web requests and AI together were 753. The
Pro plan includes 5,000 credits a month, so auto-recharge kept buying
another 1,500 for $10, five times, on pace for about $80 a month on top of
the $33 plan. Upgrading the plan does not fix it; at ~1,100 deploys a
month any tier is exhausted.

The 15 credits is flat and does not scale with build time. Builds here run
22–40 seconds, so a one-word copy change costs exactly what a ten-minute
build would.

This is a workflow cost, not a platform one, and moving to another host
would not fix it. Aug 27 alone was 45 production deploys on this site from
a single Claude session that committed and pushed after every change —
the exact habit these rules exist to stop. Meanwhile the same window had
186 branch deploys and 22 previews, all free.

### What counts as an emergency

"Families or customers are hitting it right now" — a broken checkout, a
registration path that 500s, a live funnel with ad spend pointed at it.
Not "I want to check whether that worked." Verify on the preview instead.

## Deploys are gated by preflight

`netlify.toml` runs `npm run check` as the build command, and a non-zero
exit means the new version never goes live. It exists because on Aug 13
2026 an undeclared identifier shipped and silently killed every fall-show
registration for four hours while 554 campaign emails pointed families at
that page — the page returned 200 the whole time. Do not weaken or skip
that gate to get a deploy out faster.

`npm run check:live` runs the same checks against production. Network-level
failures there ("fetch failed", "operation was aborted") are usually the
monitor's own connection, not the site — confirm with a direct request
before treating one as an outage.
