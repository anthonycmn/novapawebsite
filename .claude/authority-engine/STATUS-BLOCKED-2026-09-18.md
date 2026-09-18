# Authority Engine: cycle blocked, 2026-09-18

The daily cloud routine ran on schedule and could not draft anything. No
topic was picked, no article was written, no scoreboard entry was appended.
This file explains exactly why and what unblocks it.

## What is wrong

`.claude/authority-engine/` has never existed in this repository. Not on
`main`, not on any of the 20 remote branches, and not in a single commit in
the entire history.

The cause is one line in `.gitignore`:

    .claude/*
    !.claude/skills/

`.claude/*` ignores everything inside `.claude`, and only `.claude/skills/`
was ever exempted. So `.claude/authority-engine/` is git-ignored, and always
has been. Verified on this run:

    $ git add .claude/authority-engine/probe.md
    The following paths are ignored by one of your .gitignore files:
    .claude/authority-engine

Nothing staged. Silently refused.

That has two consequences, and the second is the one that matters.

1. The routine cannot READ its state. The engine's files live only on the
   machine that created them, which is Tony's computer. The cloud routine
   has no access to that machine, so it starts every run with an empty
   `.claude/` containing nothing but `skills`.

2. The routine cannot WRITE its state either. The persistence step in the
   routine's own prompt says to commit everything under
   `.claude/authority-engine/` and push. Under the ignore rule that commit
   picks up none of those files. It is a silent no-op: the command succeeds,
   the push succeeds, and the engine's state is still not in the repo. Even
   a flawless cycle would have lost all of its bookkeeping when this
   container was reclaimed.

So this is not a one-day glitch. Every cloud run of this routine hits the
same wall, and it will keep hitting it until the state is committed.

## What is missing

Everything the routine reads before it can do anything:

| File | Used for |
| --- | --- |
| `content-calendar.md` | The 31 numbered topics and their statuses. Drives the retirement check, the topic pick, and the Reddit pacing rule. |
| `post-template.html` | The `{{TOKEN}}` skeleton every canonical article is built from. |
| `baseline-2026-09-06.md` | The starting standings the scoreboard measures movement against. |
| `scoreboard.md` | The dated ranking history the run appends to. |
| `runs/` | Prior run folders. |

The one engine asset that DOES survive is the voice skill,
`.claude/skills/tony-voice/SKILL.md`, because `!.claude/skills/` exempts it.
That is the proof of the fix: tracked things live, ignored things die with
the container.

## Why the routine stopped instead of improvising

The missing piece is `content-calendar.md`, which is Tony's own 31-topic
plan and its statuses. The routine could not responsibly invent it:

- Guessing the next topic risks redrafting one already published or drafted.
  The blog has 8 live posts, and the branch `topic-9-ship` carries a 9th,
  "is my child too shy for drama class", so the real calendar is at least
  nine deep.
- A fabricated calendar committed here would become a second, wrong source
  of truth competing with the real one on Tony's machine.
- The retirement check, the "at most one Reddit post per week per
  subreddit" pacing rule, and the scoreboard's movement-against-baseline
  all need the real prior state to mean anything.

Writing a guessed article was the easy option. It would have been the wrong
one, and it would have been thrown away anyway under point 2 above.

## What this run did change

Only `.gitignore`, on this branch. `.claude/authority-engine/` is now
exempted the same way `.claude/skills/` is, so the directory can be
committed from here on. This is the half of the problem that could be fixed
without Tony. Nothing was published anywhere, and nothing was pushed to
`main`.

## What Tony needs to do (about five minutes, on his computer)

From the local checkout that has the real engine files:

    git fetch origin
    git checkout authority-engine        # this branch, has the .gitignore fix
    git add .claude/authority-engine/    # now allowed
    git commit -m "Authority Engine: commit engine state so cloud runs can read it"
    git push origin authority-engine

Worth confirming before the commit that `git status` lists
`content-calendar.md`, `post-template.html`, `baseline-2026-09-06.md` and
`scoreboard.md`. If it lists nothing, the files are under a different path
than the routine expects and that path is what needs correcting.

The `.gitignore` fix on this branch also needs to reach `main` eventually,
or a future run branching from `main` goes back to ignoring the directory.
That is a metered production deploy, so it is Tony's call when to fold it
in, most sensibly riding along with the next real release rather than being
one of its own.

Once the state is on the branch, the next scheduled run picks up the first
`todo` topic and works normally. Until then, every run produces this file
and nothing else.
