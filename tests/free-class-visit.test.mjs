// One free visit per child, and what the family is told when it is used.
//
// Why this file exists: CJ, 10 Sep 2026, "a no show burns the free visit."
// The offer is a first class free, singular. Before this, a child could book
// a free visit, skip it, and book another the following week. These tests
// pin which prior states close the offer and which do not, and that the
// no-show message names the date, because "you had a visit and did not use
// it" lands differently from "you have had your class".
import { freeVisitUsed } from "../netlify/functions/reg-freeclass.mjs";

let fails = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};
const has = (label, got, needle) => eq(label, typeof got === "string" && got.includes(needle), true);

const on = (status, class_date = "2026-09-15") => ({ status, class_date });

// ── States that leave the offer open ───────────────────────────────────────
eq("a child with no history may book",                   freeVisitUsed([]), null);
eq("a visit still booked ahead does not close the offer", freeVisitUsed([on("booked", "2026-09-22")]), null);
eq("a cancelled visit does not close the offer",         freeVisitUsed([on("cancelled")]), null);
// CJ, 16 Sep 2026: one missed free class may be rescheduled once.
eq("a single no-show may reschedule once",               freeVisitUsed([on("no_show")]), null);

// ── States that close it ───────────────────────────────────────────────────
const twice = [on("no_show", "2026-09-15"), on("no_show", "2026-09-22")];
has("a second no-show closes it",         freeVisitUsed(twice), "not used");
has("the message names the latest date",  freeVisitUsed(twice), "September 22, 2026");
has("an attended visit closes it",   freeVisitUsed([on("attended")]),  "has had their free class");
has("a conversion closes it",        freeVisitUsed([on("converted")]), "enrolled already");

const cases = { no_show: twice, attended: [on("attended")], converted: [on("converted")] };
for (const [st, prior] of Object.entries(cases)) {
  has(`${st}: the refusal points at registration`, freeVisitUsed(prior), "novapa.org/register");
}

// ── Precedence, when a child has more than one prior ───────────────────────
has("attended is stated over a missed visit",
  freeVisitUsed([on("attended", "2026-09-08"), on("no_show", "2026-09-15")]), "has had their free class");
has("converted is stated over attended",
  freeVisitUsed([on("attended", "2026-09-08"), on("converted", "2026-09-15")]), "enrolled already");

// ── No sentence carries an em dash or shouts ────────────────────────────────
for (const [st, prior] of Object.entries(cases)) {
  const msg = freeVisitUsed(prior);
  eq(`${st}: no em dash`, /—/.test(msg), false);
  eq(`${st}: no exclamation mark`, /!/.test(msg), false);
}

console.log(fails ? `\n${fails} FAILING` : "\nAll green.");
process.exit(fails ? 1 : 0);
