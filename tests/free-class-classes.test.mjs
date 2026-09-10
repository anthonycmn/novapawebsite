// The free-class catalogue, and the listing each trial is a visit to.
//
// Why this file exists: free class bookings used to store a hardcoded
// activity_id of 0, so a trial belonged to no class. Nothing could count it,
// and the register page, the staff portal and the teacher's roster each had a
// different idea of who would be in the room. reg-freeclass now writes
// CLASSES[key].activityId instead.
//
// That map is maintained by hand and the catalogue it mirrors changes every
// season, so the expected table below is pinned verbatim. If you are here
// because this test failed, that is the test working: do not edit EXPECTED to
// match the code. Re-verify the id against the live catalogue first —
//
//   npm run check:live        # asks the database whether each id still sells
//
// matching on day of week, start time and age range, and only then update both
// sides together.
import { CLASSES } from "../netlify/functions/reg-freeclass.mjs";

let fails = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

// Verified against the activities table on 10 Sep 2026, matching each entry on
// class_times[0].title_text (day), its primary_text (start time) and age_range.
// All thirteen are the `bookable` FULL YEAR listings. The seven FULL YEAR
// listings that are not bookable — ballet at three levels, hip-hop at two,
// K-Pop, and the Wednesday Triple Threat — are absent on purpose: they are not
// offered as trials, and leaving them out is what keeps the funnel honest.
const EXPECTED = {
  "acting-5-8":      1960867,   // Mon  6:00 PM   5-8
  "triple-threat":   1960898,   // Mon  7:00 PM  13-17
  "mt-5-8":          1960924,   // Tue  5:00 PM   5-8
  "mt-dance-13-17":  1960925,   // Tue  7:00 PM  13-17
  "mt-acting-13-17": 1960927,   // Tue  8:00 PM  13-17
  "hs-mt":           1962566,   // Wed  1:00 PM   9-13
  "hs-theatre":      1962567,   // Wed  2:00 PM   9-13
  "acting-9-12":     1960936,   // Wed  5:15 PM   9-12
  "mt-dance-9-12":   1960939,   // Wed  6:15 PM   9-12
  "mt-acting-9-12":  1960945,   // Wed  7:15 PM   9-12
  "improv-9-12":     1960959,   // Thu  6:30 PM   9-12
  "improv-13-17":    1960961,   // Thu  7:30 PM  13-17
  "acting-mt-sat":   1962562,   // Sat 12:00 PM   9-12
};

// ── The catalogue is the catalogue ─────────────────────────────────────────
eq("the same classes are offered, no more and no fewer",
  Object.keys(CLASSES).sort(), Object.keys(EXPECTED).sort());

// ── Every class resolves to its listing ────────────────────────────────────
for (const [key, id] of Object.entries(EXPECTED)) {
  eq(`${key} is a visit to listing ${id}`, CLASSES[key]?.activityId, id);
}

// ── The bug that started this cannot come back ─────────────────────────────
// A missing id reads as undefined and a typo'd one as a string, and both would
// sail past a truthiness check, so test the type rather than the value.
const bad = Object.entries(CLASSES)
  .filter(([, c]) => !Number.isInteger(c.activityId) || c.activityId <= 0)
  .map(([k]) => k);
eq("no class books a trial against a missing or zero listing", bad, []);

// Two keys pointing at one listing would double-count that room's free seats.
const ids = Object.values(CLASSES).map((c) => c.activityId);
eq("no two classes share a listing", ids.length, new Set(ids).size);

// ── The rest of each entry, which the booking validator relies on ──────────
// reg-freeclass rejects a date whose weekday is not cls.day and an age outside
// cls.ages, so a malformed entry here silently refuses every booking for that
// class rather than failing visibly.
for (const [key, c] of Object.entries(CLASSES)) {
  const okShape =
    typeof c.name === "string" && c.name.length > 0 &&
    Array.isArray(c.ages) && c.ages.length === 2 &&
    Number.isInteger(c.ages[0]) && Number.isInteger(c.ages[1]) && c.ages[0] <= c.ages[1] &&
    Number.isInteger(c.day) && c.day >= 0 && c.day <= 6 &&
    /^\d{1,2}:\d{2} (AM|PM)$/.test(c.time);
  eq(`${key} has a usable name, age range, weekday and time`, okShape, true);
}

// ── The five bookings taken before this change can still be backfilled ─────
// db/free-class-activity-link.sql backfills them by cast_key. If a key is ever
// renamed, that migration silently matches nothing, so keep these pinned until
// it has run everywhere.
for (const key of ["improv-9-12", "mt-5-8", "triple-threat"]) {
  eq(`${key} still exists, so the backfill can find its bookings`, key in CLASSES, true);
}

console.log(fails ? `\n${fails} FAILING` : "\nAll green.");
process.exit(fails ? 1 : 0);
