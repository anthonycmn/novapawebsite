// A family's My NOVAPA must never show them a staff note.
//
// legacy_enrollments.activity_text is a staff field, and reg-account printed it
// verbatim as the name of the class. By 15 Sep 2026 three families were being
// shown internal text on their own account page:
//
//   Bella Serafin   "Stagelighter | Frozen (jr) — tuition credit for cancelled
//                    2026 summer camp (Sawyer 5965504, $908.46), added by CJ"
//   Amara Perez     "Classes | Musical Theatre Acting (weekly) - CONFIRM Tue vs Thu"
//   Tallula Topham  "... REGPACK SUBSCRIPTION AUTO-ADDS MONTHLY — confirm it is
//                    cancelled before billing this family in the portal."
//
// The last one named the parent who was reading it. The rows were cleaned, but
// the rule is what stops it recurring: a linked row shows the activity's own
// name, and only an unlinked row falls back to the free text.

import { legacyTitle } from "../netlify/functions/reg-account.mjs";

const ACTS = {
  992001: "Film & Television",
  1959787: "Broadway Bound Junior | Frozen, Jr.",
  1960927: "Musical Theatre Acting",
};

let failed = 0;
const is = (label, got, want) => {
  if (got === want) { console.log("PASS " + label); return; }
  failed++;
  console.log(`FAIL ${label}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`);
};

console.log("\nWhat a family sees on their account page\n");

// the three real rows, with the staff text they used to carry
is("Tallula Topham's class, not the billing warning",
  legacyTitle({ activity_id: 992001, activity_text: "Film & TV Class | Mondays | Evening | Ages 11-17 (Studio B). Parent/payer Erin Topham. REGPACK SUBSCRIPTION AUTO-ADDS MONTHLY — confirm it is cancelled before billing this family." }, ACTS),
  "Film & Television");

is("Bella Serafin's class, not her credit amount",
  legacyTitle({ activity_id: 1959787, activity_text: "Stagelighter | Frozen (jr) — tuition credit for cancelled 2026 summer camp (Sawyer 5965504, $908.46), added by CJ 2026-09-14" }, ACTS),
  "Broadway Bound Junior | Frozen, Jr.");

is("Amara Perez's class, not a staff to-do",
  legacyTitle({ activity_id: 1960927, activity_text: "Classes | Musical Theatre Acting (weekly) - CONFIRM Tue vs Thu" }, ACTS),
  "Musical Theatre Acting");

console.log("\nand the rules behind it\n");

is("a linked row ignores activity_text entirely",
  legacyTitle({ activity_id: 992001, activity_text: "anything at all" }, ACTS),
  "Film & Television");

// The Rockwood cancellation has no activity_id and the staff portal routes it
// by this exact text, so it must keep falling through.
is("an unlinked row still falls back to its text",
  legacyTitle({ activity_id: null, activity_text: "CANCELLED IN SAWYER (order 7930828, $0 collected)" }, ACTS),
  "CANCELLED IN SAWYER (order 7930828, $0 collected)");

is("a linked row whose activity is missing falls back rather than showing nothing",
  legacyTitle({ activity_id: 123456, activity_text: "Some Old Camp" }, ACTS),
  "Some Old Camp");

is("a row with neither yields an empty string, not undefined",
  legacyTitle({ activity_id: null, activity_text: null }, ACTS), "");

is("a missing lookup table does not throw",
  legacyTitle({ activity_id: 992001, activity_text: "Fallback" }, undefined), "Fallback");

console.log(failed ? `\n${failed} failed.\n` : "\nAll green.\n");
process.exit(failed ? 1 : 0);
