// How many trial seats are open on a date: the six-per-date cap and the
// room's real capacity, reconciled as the smaller of the two.
//
// Why this file exists: until Phase 2 the free-class function counted only its
// own six-per-date cap and never looked at the room. A class could be full for
// the season and still offer six free visits to it. CJ's rule (10 Sep 2026): a
// trial may not take a seat in a full class. These tests pin the arithmetic
// that enforces it, including the two non-numeric inputs whose meaning is
// easy to get backwards.
import { trialSeatsLeft } from "../netlify/functions/reg-freeclass.mjs";

let fails = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

// ── CJ's rule: a full class offers no trial ────────────────────────────────
eq("full class, nobody booked yet: no seat",          trialSeatsLeft(0, 0), 0);
eq("full class, one trial already on it: still none", trialSeatsLeft(1, 0), 0);
eq("oversold class (booked offline past capacity): none, not negative", trialSeatsLeft(0, -2), 0);

// ── The two limits, and which one wins ─────────────────────────────────────
eq("big room, nobody booked: the cap wins, 6",     trialSeatsLeft(0, 20), 6);
eq("big room, five booked: the cap wins, 1",       trialSeatsLeft(5, 20), 1);
eq("big room, six booked: the cap is reached, 0",  trialSeatsLeft(6, 20), 0);
eq("three paid seats open: the room wins, 3",      trialSeatsLeft(0, 3), 3);
eq("three open, two trials booked: room wins, 1",  trialSeatsLeft(2, 3), 1);
eq("one seat open, none booked: a trial may take it", trialSeatsLeft(0, 1), 1);
eq("one seat open, one trial on it: gone",         trialSeatsLeft(1, 1), 0);

// ── The non-numeric inputs, whose meanings differ ──────────────────────────
// null: the listing has no capacity set, so only the cap limits trials.
eq("no capacity set, nobody booked: the cap alone, 6", trialSeatsLeft(0, null), 6);
eq("no capacity set, two booked: 4",                   trialSeatsLeft(2, null), 4);
// undefined: catalog_list did not return the listing at all (retired, or
// hidden and not requested), or it is not bookable. Nothing to visit.
eq("listing not for sale: nothing to visit",           trialSeatsLeft(0, undefined), 0);
eq("listing not for sale, even with room implied: 0",  trialSeatsLeft(0), 0);

// ── The cap is a parameter, so an ops change to it is one number ───────────
eq("a cap of 4 with a big room: 4",         trialSeatsLeft(0, 20, 4), 4);
eq("a cap of 4 with three open seats: 3",   trialSeatsLeft(0, 3, 4), 3);

console.log(fails ? `\n${fails} FAILING` : "\nAll green.");
process.exit(fails ? 1 : 0);
