// The card on file for a free class (CJ, Sep 24 2026): free cancellation
// until 24 hours before, a $30 fee two hours after a no-show, and a
// one-click enroll button in CJ's note for a family that saved a card.
//
// These pin the rules a family is told at booking, because a fee charged a
// minute early or a button that charges the wrong card is money taken from
// a family on a promise we did not keep.
import {
  classStartsAt, cancelDeadline, canCancelFree, NO_SHOW_FEE_CENTS, CANCEL_NOTICE_HOURS,
} from "../netlify/functions/reg-freeclass.mjs";
import { feeDueAt, GRACE_MINUTES } from "../netlify/functions/reg-freeclass-noshow.mjs";
import {
  groupVisits, enrollUrl, feePending, composeNote, composeMissedNote, renderNote, ENROLL,
} from "../netlify/functions/reg-freeclass-followup.mjs";

let fails = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};
const has = (label, got, needle) => eq(label, typeof got === "string" && got.includes(needle), true);
const lacks = (label, got, needle) => eq(label, typeof got === "string" && got.includes(needle), false);

// ── The terms ───────────────────────────────────────────────────────────────
eq("the fee is $30", NO_SHOW_FEE_CENTS, 3000);
eq("free cancellation closes 24 hours ahead", CANCEL_NOTICE_HOURS, 24);

// ── When a class starts, and when free cancellation closes ─────────────────
// Monday 28 Sep 2026, 6:00 PM EDT is 22:00 UTC.
eq("a class start is its Eastern wall clock (EDT)",
  classStartsAt("2026-09-28", "6:00 PM").toISOString(), "2026-09-28T22:00:00.000Z");
eq("and in winter (EST)",
  classStartsAt("2026-12-07", "6:00 PM").toISOString(), "2026-12-07T23:00:00.000Z");
eq("the deadline is 24 hours before the start",
  cancelDeadline("2026-09-28", "6:00 PM").toISOString(), "2026-09-27T22:00:00.000Z");
eq("a minute before the deadline cancels free",
  canCancelFree("2026-09-28", "6:00 PM", new Date("2026-09-27T21:59:00Z")), true);
eq("the deadline minute itself still cancels free",
  canCancelFree("2026-09-28", "6:00 PM", new Date("2026-09-27T22:00:00Z")), true);
eq("a minute after, the seat stands",
  canCancelFree("2026-09-28", "6:00 PM", new Date("2026-09-27T22:01:00Z")), false);
// The Sunday clocks go back (1 Nov 2026): a Monday 2 Nov class at 6 PM EST
// is 23:00 UTC, so the deadline is 23:00 UTC on the 1st.
eq("the deadline follows the clock change",
  cancelDeadline("2026-11-02", "6:00 PM").toISOString(), "2026-11-01T23:00:00.000Z");

// ── When the fee is charged ─────────────────────────────────────────────────
eq("two hours of grace for the teacher to correct a mark", GRACE_MINUTES, 120);
eq("the fee is due two hours after the listing's end time",
  feeDueAt({ class_date: "2026-09-28", cast_key: "acting-5-8" }, "6:00pm - 7:00pm EDT").toISOString(),
  "2026-09-29T01:00:00.000Z");
eq("no readable hours: catalogue start + an hour + the grace",
  feeDueAt({ class_date: "2026-09-28", cast_key: "acting-5-8" }, null).toISOString(),
  "2026-09-29T01:00:00.000Z");

// ── The one-click button ────────────────────────────────────────────────────
const listings = { 1960867: { name: "Acting", age_range: "5 – 8 yrs", hours: "6:00pm - 7:00pm EDT" },
                   1960898: { name: "Triple Threat", age_range: "13 – 17 yrs", hours: "7:00pm - 8:00pm EDT" } };
const TOK_A = "11111111-1111-4111-8111-111111111111";
const TOK_B = "22222222-2222-4222-8222-222222222222";
const visit = (o) => ({ id: 1, status: "attended", parent_name: "Sam Rivera", email: "sam@example.com",
  child_name: "Jordan", cast_key: "acting-5-8", activity_id: 1960867, class_date: "2026-09-28", ...o });

let [g] = groupVisits([visit({ link_token: TOK_A, stripe_payment_method_id: "pm_1" })], listings);
eq("a visit with a saved card gets the enroll page", enrollUrl(g), `${ENROLL}?t=${TOK_A}`);
let note = composeNote(g);
let { text, html } = renderNote(note);
has("the note offers one click", text, "Enrolling is one click");
has("and says the exact charge is shown first", text, "shows you the exact charge before anything is paid");
has("the button names the child and class", html, ">Enroll Jordan in Acting</a>");
has("the button goes to the enroll page", html, `href="${ENROLL}?t=${TOK_A}"`);
lacks("and not the register page", html, "novapa.org/register/?activity=");
has("the price is still stated", text, "$90 a month");

[g] = groupVisits([visit({ link_token: TOK_A })], listings);
eq("a visit booked before cards: no enroll page", enrollUrl(g), null);
({ text } = renderNote(composeNote(g)));
has("it keeps the register link", text, "https://novapa.org/register/?activity=1960867");
lacks("and does not promise one click", text, "one click");

[g] = groupVisits([
  visit({ id: 1, link_token: TOK_A, stripe_payment_method_id: "pm_1" }),
  visit({ id: 2, child_name: "Riley", link_token: TOK_B, stripe_payment_method_id: "pm_2" }),
], listings);
eq("two children on two different cards: no one-click (the button charges one card)", enrollUrl(g), null);

[g] = groupVisits([
  visit({ id: 1, link_token: TOK_A, stripe_payment_method_id: "pm_1" }),
  visit({ id: 2, child_name: "Riley", link_token: TOK_B, stripe_payment_method_id: "pm_1" }),
], listings);
eq("siblings on the same card share one enroll link", enrollUrl(g), `${ENROLL}?t=${TOK_A},${TOK_B}`);
({ html } = renderNote(composeNote(g)));
has("two children get a plain Enroll button", html, ">Enroll</a>");

// ── The missed-class note waits for the fee ─────────────────────────────────
const missed = (o) => visit({ status: "no_show", link_token: TOK_A, stripe_payment_method_id: "pm_1", ...o });
const late = new Date("2026-09-29T02:00:00Z");
[g] = groupVisits([missed({})], listings);
eq("a card no-show waits for the fee job", feePending(g, late), true);
eq("unless the fee job is switched off", feePending(g, late, true), false);
eq("and never waits past a week", feePending(g, new Date("2026-10-06T00:00:00Z")), false);
[g] = groupVisits([missed({ no_show_fee_state: "charging" })], listings);
eq("a fee mid-charge still waits", feePending(g, late), true);
[g] = groupVisits([missed({ no_show_fee_state: "charged" })], listings);
eq("a charged fee lets the note go", feePending(g, late), false);
({ text } = renderNote(composeMissedNote(g)));
has("and the note says the fee was charged", text, "the $30 no-show fee went on the card you saved");
has("and still offers a new date", text, "The free class is still yours");
[g] = groupVisits([missed({ no_show_fee_state: "failed" })], listings);
eq("a refused card lets the note go", feePending(g, late), false);
({ text } = renderNote(composeMissedNote(g)));
lacks("without claiming a charge", text, "no-show fee");
[g] = groupVisits([missed({ stripe_payment_method_id: null })], listings);
eq("a no-show booked before cards never waits", feePending(g, late), false);
[g] = groupVisits([visit({ link_token: TOK_A, stripe_payment_method_id: "pm_1" })], listings);
eq("an attended visit never waits for a fee", feePending(g, late), false);

if (fails) { console.log(`\n${fails} free-class card check(s) FAILED`); process.exit(1); }
console.log("\nall free-class card checks pass");
