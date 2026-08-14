#!/usr/bin/env node
// Weekly report generator — Schedule A section J of the IC Agreement.
//
//   node scripts/weekly-report.mjs                 this week (Mon..today)
//   node scripts/weekly-report.mjs --week 2026-08-10   a specific Monday
//   node scripts/weekly-report.mjs --out report.md
//
// Contract facts this encodes, so nobody has to re-read the agreement:
//   - Recipients: cj@novapa.org and todd@novapa.org (Sec 8.1)
//   - Period: Monday through Sunday (Sec 8.1)
//   - Due: FRIDAY. The signed contract says Monday 5pm ET, but Todd changed it
//     in writing on Aug 12 2026 ("You are now sending a weekly report on
//     Fridays."), which Sec 8.1 expressly permits by email.
//   - Sent whether or not a fee is claimed and whether or not a campaign ran.
//   - Must be backed by platform exports, not summary figures alone (Sec 8.1),
//     and metrics may not be fabricated or selectively reported (Sec 8.3).
//
// Sections below follow Schedule A(J) exactly and in order. Anything this
// script cannot source is printed as an explicit TODO rather than left out or
// guessed — an incomplete report is a contract problem, but an invented number
// is a worse one.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SB = "https://tlkuqwsqicxcjdmumkje.supabase.co";
const arg = (k) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : null; };

function token(name) {
  try { return readFileSync(join(process.env.HOME, ".config/novapa", name), "utf8").trim(); }
  catch { return null; }
}

async function sql(query) {
  const tok = token("supabase_token");
  if (!tok) throw new Error("missing ~/.config/novapa/supabase_token");
  const r = await fetch("https://api.supabase.com/v1/projects/tlkuqwsqicxcjdmumkje/database/query", {
    method: "POST",
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error(`sql: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

async function hogql(query) {
  const key = token("posthog_key");
  if (!key) return null;
  try {
    const r = await fetch("https://us.posthog.com/api/projects/516047/query/", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
    });
    const j = await r.json();
    return j.results || null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Reporting week: Monday 00:00 ET through Sunday 23:59 ET.

function weekBounds(mondayISO) {
  let start;
  if (mondayISO) start = new Date(`${mondayISO}T00:00:00-04:00`);
  else {
    const now = new Date();
    const dow = (now.getUTCDay() + 6) % 7;           // 0 = Monday
    start = new Date(now); start.setUTCDate(now.getUTCDate() - dow);
    start = new Date(`${start.toISOString().slice(0, 10)}T00:00:00-04:00`);
  }
  const end = new Date(start); end.setUTCDate(start.getUTCDate() + 7);
  return { start, end };
}

const usd = (c) => "$" + ((c || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const d = (x) => x.toISOString().slice(0, 10);

// ---------------------------------------------------------------------------

const { start, end } = weekBounds(arg("--week"));
const S = start.toISOString(), E = end.toISOString();
const prevStart = new Date(start); prevStart.setUTCDate(start.getUTCDate() - 7);

const out = [];
const p = (...s) => out.push(...s);

p(`# NOVAPA Weekly Report`);
// Display the Sunday as a calendar date. `end` is the exclusive bound at
// midnight ET, so subtracting a millisecond lands in the next UTC day.
const sunday = new Date(start); sunday.setUTCDate(start.getUTCDate() + 6);
p(``, `**Week:** ${d(start)} (Mon) through ${d(sunday)} (Sun)`);
p(`**To:** cj@novapa.org, todd@novapa.org`);
p(`**Prepared by:** Jason Stacks LLC — Amended and Restated IC Agreement, Schedule A(J)`, ``);

// --- Revenue summary (contract requires by line, plus the fee claimed) ------
const rev = await sql(`
  select coalesce(a.category,'summer camp') line,
         count(*) n,
         sum(oi.unit_price_cents) gross
  from order_items oi
  join orders o on o.id = oi.order_id
  left join activities a on a.id = oi.activity_id
  where o.created_at >= '${S}' and o.created_at < '${E}'
    and o.status in ('paid','confirmed','complete','succeeded')
  group by 1 order by 3 desc nulls last`);
const collected = await sql(`
  select coalesce(sum(amount_today_cents),0) today, count(*) orders
  from orders where created_at >= '${S}' and created_at < '${E}'
    and status in ('paid','confirmed','complete','succeeded')`);
const prev = await sql(`
  select coalesce(sum(amount_today_cents),0) today, count(*) orders
  from orders where created_at >= '${prevStart.toISOString()}' and created_at < '${S}'
    and status in ('paid','confirmed','complete','succeeded')`);

const thisWeek = Number(collected[0]?.today || 0), lastWeek = Number(prev[0]?.today || 0);
p(`## Revenue summary`, ``);
p(`| Line | Registrations | Value |`, `|---|---:|---:|`);
for (const r of rev) p(`| ${r.line} | ${r.n} | ${usd(r.gross)} |`);
p(`| **Collected this week** | **${collected[0]?.orders || 0} orders** | **${usd(thisWeek)}** |`, ``);
p(`Prior week: ${usd(lastWeek)} across ${prev[0]?.orders || 0} orders.`);
p(`Fee claimed at 7.5% of Collected Revenue (Sec 5.1): **${usd(Math.round(thisWeek * 0.075))}**`);
p(``, `> Collected Revenue excludes refunds, taxes, third-party processing and`,
    `> ticketing fees, donations, credits and discounts, and sponsorships`,
    `> (Sec 5.2). Figures above are website + NOVAPA processor only. Verify`,
    `> against Stripe before invoicing.`, ``);

// --- Campaign activity + Email and CRM -------------------------------------
const camps = await sql(`
  select name, subject, status, coalesce(sent_count,0) sent,
         to_char(scheduled_at at time zone 'America/New_York','MM-DD HH24:MI') when_sent
  from campaigns
  where coalesce(scheduled_at, created_at) >= '${S}' and coalesce(scheduled_at, created_at) < '${E}'
  order by scheduled_at nulls last`);
p(`## Campaign activity`, ``);
if (!camps.length) p(`No campaigns scheduled or sent this week.`, ``);
else {
  p(`| Campaign | Subject | Sent | Status | When |`, `|---|---|---:|---|---|`);
  for (const c of camps) p(`| ${c.name} | ${String(c.subject).slice(0, 46)} | ${c.sent} | ${c.status} | ${c.when_sent || "—"} |`);
  p(``);
}
p(`## Email and CRM`, ``);
p(`Total sends this week: **${camps.reduce((a, c) => a + Number(c.sent || 0), 0)}**`);
p(``, `- [ ] TODO open rate, click rate, unsubscribes — open/click tracking is`,
    `  currently OFF in Resend, so these cannot be reported truthfully. Either`,
    `  enable tracking or state that they are unavailable.`, ``);

// --- Website / landing pages ----------------------------------------------
const ph = await hogql(`
  select count() events, count(distinct person_id) people,
         countIf(event='$pageview') pageviews
  from events where timestamp >= toDateTime('${S.slice(0, 19).replace("T", " ")}')
    and timestamp < toDateTime('${E.slice(0, 19).replace("T", " ")}')`);
p(`## Website and landing pages`, ``);
if (ph && ph[0]) p(`Pageviews **${ph[0][2]}**, distinct visitors **${ph[0][1]}**, total events ${ph[0][0]}.`, ``);
else p(`- [ ] TODO PostHog unavailable when this ran; attach the analytics export.`, ``);
p(`Conversion: ${collected[0]?.orders || 0} completed orders.`, ``);

// --- Paid media ------------------------------------------------------------
p(`## Paid media`, ``);
p(`- [ ] TODO spend, impressions, clicks, CPC, CPA, ROAS from the ad platform`,
    `  export. Google Ads "Campaign #1" was paused Aug 14 2026 ($50/day budget`,
    `  to $0). Meta is not yet running.`, ``);

// --- Organic social --------------------------------------------------------
p(`## Organic social`, ``);
p(`- [ ] TODO reach, impressions, engagement, follower change, top content.`,
    `  No system we operate touches the social accounts; paste the platform export.`, ``);

// --- Systems and technology (from the change log, i.e. git) ----------------
let commits = [];
try {
  commits = execFileSync("git", ["log", `--since=${d(start)}`, `--until=${d(end)}`,
    "--pretty=format:%h|%ad|%s", "--date=format:%m-%d"], { cwd: ROOT, encoding: "utf8" })
    .split("\n").filter(Boolean).map((l) => l.split("|"));
} catch {}
p(`## Systems and technology`, ``);
if (commits.length) {
  p(`${commits.length} changes shipped:`, ``);
  for (const [sha, date, subj] of commits.slice(0, 25)) p(`- \`${sha}\` ${date} — ${subj}`);
  p(``);
} else p(`No code changes recorded this week.`, ``);
p(`- [ ] Confirm backups verified this week (Schedule A(I)).`);
p(`- [ ] Note any access changes, outages, or open vendor decisions.`, ``);

// --- Risk and compliance ---------------------------------------------------
p(`## Risk and compliance`, ``);
p(`- [ ] Complaints, opt-outs, platform warnings, incidents, corrective action.`, ``);

// --- Objectives progress ---------------------------------------------------
p(`## Objectives progress (Schedule B)`, ``);
p(`| Milestone | Due | Status |`, `|---|---|---|`);
p(`| 30 days — stabilize, inventory, measure | Aug 15 2026 | |`);
p(`| 60 days — all revenue streams live (Sec 4.1) | Sep 14 2026 | |`);
p(`| 90 days — optimize and prove return | Oct 14 2026 | |`, ``);

// --- Analysis + next week --------------------------------------------------
p(`## Analysis`, ``);
p(`Revenue ${thisWeek >= lastWeek ? "up" : "down"} ${usd(Math.abs(thisWeek - lastWeek))} week over week.`);
p(`- [ ] Tests run, what worked, what did not, lessons, recommended actions.`, ``);
p(`## Next week`, ``);
p(`- [ ] Planned campaigns, deadlines, approvals and budget requested.`, ``);

const text = out.join("\n");
const dest = arg("--out");
if (dest) { (await import("node:fs")).writeFileSync(dest, text); console.error(`wrote ${dest}`); }
else console.log(text);
