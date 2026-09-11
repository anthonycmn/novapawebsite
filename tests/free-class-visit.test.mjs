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

// ── States that close it ───────────────────────────────────────────────────
has("a no-show closes it",           freeVisitUsed([on("no_show")]),   "not used");
has("the no-show message names the date", freeVisitUsed([on("no_show")]), "September 15, 2026");
has("an attended visit closes it",   freeVisitUsed([on("attended")]),  "has had their free class");
has("a conversion closes it",        freeVisitUsed([on("converted")]), "enrolled already");

// Every refusal sends the family somewhere they can still act.
for (const st of ["no_show", "attended", "converted"]) {
  has(`${st}: the refusal points at registration`, freeVisitUsed([on(st)]), "novapa.org/register");
}

// ── Precedence, when a child has more than one prior ───────────────────────
// A no-show is the reason to state, since it is the one the family can fix
// by turning up; attended and converted are simply done.
has("no-show is stated over an earlier attended visit",
  freeVisitUsed([on("attended", "2026-09-08"), on("no_show", "2026-09-15")]), "not used");
has("converted is stated over attended",
  freeVisitUsed([on("attended", "2026-09-08"), on("converted", "2026-09-15")]), "enrolled already");

// ── No sentence carries an em dash or shouts ────────────────────────────────
for (const st of ["no_show", "attended", "converted"]) {
  const msg = freeVisitUsed([on(st)]);
  eq(`${st}: no em dash`, /—/.test(msg), false);
  eq(`${st}: no exclamation mark`, /!/.test(msg), false);
}

console.log(fails ? `\n${fails} FAILING` : "\nAll green.");
process.exit(fails ? 1 : 0);
