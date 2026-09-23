// Past day camps come off sale: what reg-daycamp-close may touch, and when.
//
// Why this file exists: three camps that ran Mon Sep 21 2026 were still for
// sale on Wednesday because nothing switched them off. The job that does it
// now writes to the live catalogue every hour, so these pin its reach: day
// camps only, only ones still on sale, only once the studio's day has ended,
// and never outside production.
import { pastDayCampFilter, CLOSED_BY } from "../netlify/functions/reg-daycamp-close.mjs";
import handler, { config } from "../netlify/functions/reg-daycamp-close.mjs";
import { etToday } from "../netlify/functions/reg-config.mjs";

let fails = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};
const has = (label, got, needle) => eq(label, String(got).includes(needle), true);

// ── What it may touch ──────────────────────────────────────────────────────
const f = pastDayCampFilter("2026-09-22");
has("day camps only, never a class or a show", f, "offering_kind=eq.day_camp");
has("only listings that are live", f, "active=is.true");
has("only ones still on sale, so a closed camp is never rewritten", f, "bookable=is.true");
has("strictly before today: a camp stays buyable on its own day", f, "starts_on=lt.2026-09-22");
let threw = false;
try { pastDayCampFilter(""); } catch { threw = true; }
eq("an empty date is refused, never an unbounded filter", threw, true);

// ── The studio's day, not UTC's ────────────────────────────────────────────
// 11:30 PM Eastern on Mon Sep 21 is 03:30 UTC on the 22nd.
eq("late Monday night in Virginia is still Monday", etToday(new Date("2026-09-22T03:30:00Z")), "2026-09-21");
eq("so the Sep 21 camps are not yet past", pastDayCampFilter(etToday(new Date("2026-09-22T03:30:00Z"))).includes("lt.2026-09-21"), true);
eq("just after midnight Eastern it is Tuesday", etToday(new Date("2026-09-22T04:05:00Z")), "2026-09-22");
eq("and in winter (EST) too", etToday(new Date("2026-12-15T04:30:00Z")), "2026-12-14");

// ── It runs hourly, so a missed run costs an hour, not a week ──────────────
eq("scheduled every hour", config.schedule, "5 * * * *");

// ── The write itself ───────────────────────────────────────────────────────
const realFetch = globalThis.fetch;
const env = { ...process.env };
let calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  return new Response(JSON.stringify([
    { id: 1962598, name: "Heroes & Villains", starts_on: "2026-09-21" },
  ]), { status: 200 });
};

process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
process.env.CONTEXT = "deploy-preview";
let res = await handler();
eq("a Deploy Preview never writes to the live catalogue", calls.length, 0);
has("and says why", await res.text(), "non-production");

process.env.CONTEXT = "production";
res = await handler();
eq("production makes exactly one call", calls.length, 1);
eq("it is a PATCH", calls[0].init.method, "PATCH");
has("against activities, with the day camp filter", calls[0].url, "/rest/v1/activities?offering_kind=eq.day_camp&active=is.true&bookable=is.true&starts_on=lt.");
const body = JSON.parse(calls[0].init.body);
eq("it only switches bookable off", body.bookable, false);
eq("and signs the change, so activities_audit names this job", body.updated_by, CLOSED_BY);
eq("it touches no seat counter", ["sold", "booked_offline", "capacity", "active"].some((k) => k in body), false);
has("and reports what it closed", await res.text(), "closed 1: 1962598 Heroes & Villains (2026-09-21)");

calls = [];
globalThis.fetch = async () => new Response("[]", { status: 200 });
res = await handler();
has("nothing past on sale: a quiet ok", await res.text(), "ok: no past day camps on sale");

globalThis.fetch = async () => new Response("permission denied", { status: 401 });
res = await handler();
eq("a failed write is a 500, so it shows in the function log", res.status, 500);

globalThis.fetch = realFetch;
process.env = env;

if (fails) {
  console.error(`\n${fails} failing`);
  process.exit(1);
}
console.log("\nall day camp close checks pass");
