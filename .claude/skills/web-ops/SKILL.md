---
name: web-ops
description: "Carry out operational work on external services for NoVAPA — Netlify, GitHub, Supabase, Google, Zapier and anything else behind a login. Use whenever a task needs something changed outside this repository: setting env vars, checking a deploy, provisioning a database, running SQL, editing DNS, changing a setting in a dashboard. Also use when the user says to 'use my browser', 'use the Chrome extension', or asks why something cannot be done directly."
---

## What this is for

Getting real work done on services that live behind a login, and doing it through
whatever route actually exists rather than the route that was asked for.

## The rule that matters most

**Never claim a capability without checking, and never refuse without checking.**

Sessions differ. MCP servers connect, disconnect, and reconnect mid-conversation.
A tool that was absent an hour ago may be present now. Before saying "I can't",
run `ToolSearch` against the service name and one or two verbs:

```
ToolSearch("netlify environment variable deploy")
ToolSearch("supabase create project database")
ToolSearch("browser chrome navigate click page")
```

If a browser-control tool exists in the session, use it — drive the task
directly. Everything below about handoffs only applies when it does not.

**But be precise about what a browser tool would buy you.** Two different things
get called "the browser", and conflating them wastes everyone's time:

- **The user's Chrome, with the user's logins.** This is what the Claude browser
  extension drives. It is a *separate Claude session*. It has the cookies. There
  is no channel from this session to it.
- **A browser running in this container.** A Playwright or Chrome-DevTools MCP
  server would give you this. It is a fresh profile with no cookies, so it lands
  on the login screen of every authenticated service and stops.

So a browser tool on this side does **not** solve "log into Supabase and click
things". Adding one is worth doing for public-web work — scraping, checking how a
deployed page renders, filling an unauthenticated form — and worth nothing for
work that depends on being signed in as the user. Say which of the two is needed
before anyone goes and installs something.

`WebFetch` exists in most sessions. It reads a public page and fails on anything
authenticated. Do not offer it as a substitute for dashboard access.

## Route the work to what can do it

Work down this list. Stop at the first route that can complete the task.

**1. A direct tool.** Check what is connected before anything else.

| Service | What exists today | Notes |
|---|---|---|
| **Netlify** | Full MCP: env vars, deploys, projects, forms, extensions | Can read *and write*. Use `manage-env-vars` to set secrets — the user never has to open the dashboard. |
| **GitHub** | Full MCP: PRs, merges, files, branches, Actions, issues | Merging is `merge_pull_request`, method `squash`. |
| **Gmail / Drive / Calendar** | Full MCP: search, read, create | Drive holds the audit spreadsheets; Calendar is the source of truth for who is where. |
| **Zapier** | 9,000+ apps via `discover_zapier_actions` | Check here before declaring an app unreachable. Enabling an action changes the user's config — say so. |
| **Supabase** | **No tool.** No API, no CLI, no network route. | The container's network policy answers 403 for REST, the dashboard, the management API and port 5432 alike. Verified. |

**2. The repository.** A surprising amount of "dashboard work" is really a file
change plus a deploy. Netlify env vars, redirects, headers, function config —
all reachable from here.

**3. Ask whether the step is needed at all.** Do this *before* handing work back.
The most useful thing this skill has ever done was notice that a task blocked on
"create a Supabase project and run SQL" did not need a database: Netlify Blobs is
part of the site, needs no account, key, schema or setup, and was the right size
for the data. A step you delete beats a step you delegate.

Ask: what does this data actually require? Durability? Sharing between a handful
of people? Then a built-in store may be enough. Transactions, relations, reporting
across thousands of rows? Then it is genuinely Postgres.

**4. Hand off to the browser.** Only when 1–3 cannot do it.

## Handing off to the Chrome extension

The Claude extension in the user's browser is a **separate session**. It has
browser tools; this session has the repository and a container. There is no
channel between them. The user is the only link, so the handoff has to be
something they can paste in one action.

Say the constraint once, in one sentence, and never repeat it in the same
conversation. Repeating it reads as stalling. Then produce the packet.

A good packet is specific enough that the other session does not have to think:

> On this Supabase dashboard, create a new project:
> - **Name:** `novapa-deh`
> - **Region:** East US (North Virginia)
> - **Plan:** Free
> - Generate a database password and show it to me once so I can save it
>
> Wait for provisioning, then go to **Project Settings → API** and read back
> the **Project URL** and the **anon / public** key.
> Do not show or copy the `service_role` key.

Rules for packets:

- Name the exact screen, button and field labels. "Settings → API" not "the settings".
- Say what to read back, and in what form.
- Say explicitly what **not** to touch, especially secrets.
- One task per packet. Chains fail silently in the middle.
- Always give the manual click-path too. The extension may not be installed, and
  a six-click path the user can follow in under a minute is not a failure.

## Secrets

- **Never ask for a secret to be pasted into chat** when a tool can set it
  directly. For Netlify, take the value only if the user volunteers it and set it
  with `manage-env-vars`, `envVarIsSecret: true`.
- **Anon / publishable keys** may be committed only when the schema makes them
  safe — RLS on with no policies, access exclusively through SECURITY DEFINER
  functions. State the reasoning where the key lives, so the next reader knows
  it was a decision and not an accident.
- **Service-role keys, database passwords, API secrets: never in the repository**,
  never echoed in a response, never in an error message. If one appears in chat,
  say plainly that it should be rotated.
- Before publishing anything that loads shared config, check what else that config
  carries. A rehearsal dashboard behind a shared word was loading the registration
  config, and with it a live Stripe key.

## Service notes worth keeping

**Netlify.** Site `northernvirginiaperformingarts`, id
`f709088b-fded-4e4f-9790-228d3cc46b55`. `SUPABASE_SERVICE_ROLE_KEY`,
`SMTP_USER`/`SMTP_PASS`, `STRIPE_SECRET_KEY`, `RESEND_API_KEY` are already set.
No build command; functions still get their npm dependencies installed. Check a
deploy landed with `get-deploy-for-site` and read `state`, the function list, and
`deploy_validations_report.secret_scan_result`.

**GitHub.** Squash-merge is the house style. Main moves under long sessions:
expect conflicts with your own earlier squashed PRs, and resolve by keeping the
newer intent. Force-push may be blocked — merging the stale remote tip back in
and pushing normally works.

**Supabase.** DDL needs the SQL editor, a management token, or the database
password. None of those are reachable from here. When SQL must be run, make it
one paste rather than several, make it idempotent, and end it with a verification
query that prints OK per item so the result is legible without reading SQL.

**Verifying SQL without the real database.** Postgres 16 and `psql` are installed
in the container. Spin up a throwaway cluster as the `postgres` user under
`/var/tmp`, create the `anon` and `authenticated` roles a Supabase project starts
with, run the file, run it a second time to prove idempotency, exercise every RPC
as `anon`, and confirm `anon` cannot reach the tables directly. Then discard the
cluster. This turns "here is some SQL, hope it works" into "this is tested".

## Before reporting back

State what was actually verified and what was not. "The deploy is ready and the
function is live; I have not made a request from a phone" is worth more than a
confident "it works". If the user can prove the last mile in twenty seconds, give
them the twenty-second test.
