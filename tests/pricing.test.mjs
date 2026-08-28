import { TERM, isClosed, closureFor, planDates, priceFor, prettyDate, prettyTime, dayName, weeklyDates, toDate, slotKey, earliestBookableDate, allPlans, getTeacher, CHECKOUT_MINUTES, HOLD_MINUTES } from "../netlify/lib/lessons-config.mjs";

let fails = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

// ── The semester: Sep 14 – Jan 14, 15% off, holidays observed ──────────────
const before = new Date("2026-08-08T12:00:00Z"); // today, term hasn't started
const wedDates = planDates(TERM.id, 3, before);
eq("term: 15 Wednesdays", wedDates.length, 15);
eq("term: first Wed",  wedDates[0], "2026-09-16");
eq("term: last Wed",   wedDates[14], "2027-01-13");

const p = priceFor({ rate: 120, sessions: 15, discountPct: TERM.discountPct });
eq("term: gross $1800",   p.grossCents, 180000);
eq("term: discount $270", p.discountCents, 27000);
eq("term: total $1530",   p.totalCents, 153000);
eq("term: $102/session",  p.perSessionCents, 10200);
eq("term: beats the 10-pack per lesson",
  p.perSessionCents < priceFor({ rate:120, sessions:10, price:1050 }).perSessionCents, true);

// ── Holidays are stepped over, not counted ──────────────────────────────────
eq("closed: Thanksgiving Wed", isClosed("2026-11-25"), true);
eq("closed: Winter Break Wed", isClosed("2026-12-23"), true);
eq("closed: Winter Break NYE week", isClosed("2026-12-30"), true);
eq("open: the Wed between the breaks", isClosed("2026-12-16"), false);
eq("open: first Wed back in January", isClosed("2027-01-06"), false);
eq("closure is named", closureFor("2026-11-25").name, "Thanksgiving Break");

eq("term skips Thanksgiving", wedDates.includes("2026-11-25"), false);
eq("term skips both Winter Break Weds",
  wedDates.filter((d) => d === "2026-12-23" || d === "2026-12-30").length, 0);
eq("term runs Nov 18 straight to Dec 2",
  wedDates.slice(wedDates.indexOf("2026-11-18"), wedDates.indexOf("2026-11-18") + 2),
  ["2026-11-18", "2026-12-02"]);
eq("term resumes Jan 6 after Winter Break",
  wedDates.slice(wedDates.indexOf("2026-12-16"), wedDates.indexOf("2026-12-16") + 2),
  ["2026-12-16", "2027-01-06"]);

// Fri/Sat land one week short because Jan 14 is a Thursday.
eq("Thursday term: 15 sessions", planDates(TERM.id, 4, before).length, 15);
eq("Friday term: 14 sessions",   planDates(TERM.id, 5, before).length, 14);
eq("Saturday term: 14 sessions", planDates(TERM.id, 6, before).length, 14);
eq("short weekdays still $102/lesson",
  priceFor({ rate:120, sessions:14, discountPct:TERM.discountPct }).perSessionCents, 10200);
eq("short weekdays total $1428",
  priceFor({ rate:120, sessions:14, discountPct:TERM.discountPct }).totalCents, 142800);

// A pack keeps its promised session count no matter how many breaks it crosses.
const packOverBreaks = planDates("pack-10", 3, new Date("2026-11-01T12:00:00Z"));
eq("10-pack across both breaks still gives 10", packOverBreaks.length, 10);
eq("  none of them fall in a closure", packOverBreaks.some(isClosed), false);
eq("  so it finishes later", packOverBreaks[9], "2027-01-27");

// ── Packs ───────────────────────────────────────────────────────────────────
eq("10-pack: 10 dates", planDates("pack-10", 3, before).length, 10);
eq("3-pack: 3 dates",   planDates("pack-3", 3, before).length, 3);
eq("10-pack: $1050",    priceFor({ rate:120, sessions:10, price:1050 }).totalCents, 105000);
eq("10-pack: $105 each",priceFor({ rate:120, sessions:10, price:1050 }).perSessionCents, 10500);
eq("6-pack: $660",      priceFor({ rate:120, sessions:6, price:660 }).totalCents, 66000);
eq("3-pack: $350",      priceFor({ rate:120, sessions:3, price:350 }).totalCents, 35000);
eq("3-pack: ~$116.67 ea",priceFor({ rate:120, sessions:3, price:350 }).perSessionCents, 11667);

// ── 48-hour lead time: booking Mon can't land on Tue ───────────────────────
const monday = new Date("2026-09-21T12:00:00Z");
eq("lead: earliest is +2d", earliestBookableDate(monday).toISOString().slice(0,10), "2026-09-23");
eq("lead: Tue slot skips to next week", planDates("pack-3", 2, monday)[0], "2026-09-29");
eq("lead: Wed slot is this week",       planDates("pack-3", 3, monday)[0], "2026-09-23");

// ── Once lessons start, the semester stops selling and packs take over ─────
const midTerm = new Date("2026-11-02T12:00:00Z");
const rest = planDates(TERM.id, 3, midTerm);  // dates still compute…
eq("mid-term: 8 Weds would remain", rest.length, 8);
eq("mid-term: they would start Nov 4", rest[0], "2026-11-04");
eq("mid-term: those dates skip the breaks", rest.some(isClosed), false);

// ── Term fully over ─────────────────────────────────────────────────────────
eq("term over → no dates", planDates(TERM.id, 3, new Date("2027-01-15T12:00:00Z")), []);
eq("pack still sells after term", planDates("pack-3", 3, new Date("2027-01-15T12:00:00Z")).length, 3);

// ── DST crossing (Nov 1 2026 US fallback) — weekly math must not drift ──────
const dst = weeklyDates(3, toDate("2026-10-21"), { limit: 4 });
eq("DST: no drift across fallback", dst, ["2026-10-21","2026-10-28","2026-11-04","2026-11-11"]);

// ── Formatting ──────────────────────────────────────────────────────────────
eq("time 17:30 → 5:30 PM", prettyTime("17:30"), "5:30 PM");
eq("time 09:00 → 9:00 AM", prettyTime("09:00"), "9:00 AM");
eq("time 12:00 → 12:00 PM", prettyTime("12:00"), "12:00 PM");
eq("date pretty", prettyDate("2026-09-16"), "Sep 16");
eq("day name", dayName(3), "Wednesday");
eq("slot key", slotKey("coach-1", 3, "17:30"), "coach-1__3__1730");

// ── Two rate tiers ──────────────────────────────────────────────────────────
// The associates sit on the published rate, so their packs must come out at
// exactly the prices coaching.html already advertises. The lead coach is 15%
// above, and every total stays a whole number of dollars.
eq("lead coach is $138", getTeacher("tony-cimino-johnson").rate, 138);
eq("associates are the published $120",
  ["colton-sorenson", "ryyana-cunningham", "katie-hamburger"].map((id) => getTeacher(id).rate),
  [120, 120, 120]);
eq("associate packs match the catalog exactly",
  [3, 6, 10].map((n) => priceFor({ rate: 120, sessions: n, price: { 3:350, 6:660, 10:1050 }[n] }).totalCents),
  [35000, 66000, 105000]);
eq("premium packs are 15% above",
  [3, 6, 10].map((n) => priceFor({ rate: 138, sessions: n, price: { 3:350, 6:660, 10:1050 }[n] }).totalCents),
  [40300, 75900, 120800]);
eq("premium 10-pack does not round a dollar low",
  priceFor({ rate: 138, sessions: 10, price: 1050 }).totalCents, 120800);
eq("premium semester 15 = $1,760",
  priceFor({ rate: 138, sessions: 15, discountPct: TERM.discountPct }).totalCents, 176000);
eq("premium semester 14 = $1,642 (from $1,642.20)",
  priceFor({ rate: 138, sessions: 14, discountPct: TERM.discountPct }).totalCents, 164200);
eq("every tier price is a whole dollar",
  [120, 138].flatMap((r) => [
    ...[3, 6, 10].map((n) => priceFor({ rate: r, sessions: n, price: { 3:350, 6:660, 10:1050 }[n] }).totalCents),
    ...[14, 15].map((n) => priceFor({ rate: r, sessions: n, discountPct: TERM.discountPct }).totalCents),
  ]).filter((c) => c % 100 !== 0), []);

// ── Config sanity ───────────────────────────────────────────────────────────
eq("4 plans offered (term + 3 packs)", allPlans().length, 4);
eq("teacher lookup", getTeacher("colton-sorenson").name, "Colton Sorenson");
eq("unknown teacher → null", getTeacher("nope"), null);

// ── The payment window and the hold ─────────────────────────────────────────
// Stripe rejects a Checkout Session expiring less than 30 minutes out, and the
// hold is placed before that session exists — so the hold has to outlast it.
// Both directions are silent failures in production, hence the guard here.
eq("payment window clears Stripe's 30-minute floor", CHECKOUT_MINUTES > 30, true);
eq("the hold outlives the payment window", HOLD_MINUTES > CHECKOUT_MINUTES, true);

console.log(fails ? `\n${fails} FAILING` : "\nAll green.");
process.exit(fails ? 1 : 0);
