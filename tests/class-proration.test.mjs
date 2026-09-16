// Mid-month proration (CJ, Sep 16 2026): "if they sign up for a Wednesday
// class and there are two Wednesdays left and there were four Wednesdays in
// that month, take 90, divide it by four, and then charge them for those two
// classes." The monthly subscription still pulls the full amount on the 1st.
import {
  classWeekday, etToday, classSessionsInMonth, classCoveredMonth, prorateCents, breakOn,
  classBillingWindow, classMonthlyCents, CLASS_BILL_ANCHOR_UTC,
} from "../netlify/functions/reg-config.mjs";

let fails = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};
// 11:00 in Virginia on a given day — unambiguous in both UTC offsets
const at = (iso) => new Date(iso + "T15:00:00Z");
const utc1st = (y, m) => Math.floor(Date.UTC(y, m, 1, 4, 0, 0) / 1000);

// The real Wednesday Acting class (1960936): Sep 16 2026 – Jun 9 2027.
const wedActing = { id: 1960936, category: "class", starts_on: "2026-09-16", ends_on: "2027-06-09",
  class_times: [{ title_text: "Wed", primary_text: ["5:15pm - 6:05pm EDT"], secondary_text: "Sep 16, 2026 - Jun 9, 2027" }] };
// The real Tuesday adult class (1962568): Oct 6 – Dec 15 2026.
const tueAdult = { id: 1962568, category: "class", starts_on: "2026-10-06", ends_on: "2026-12-15",
  class_times: [{ title_text: "Tue", primary_text: ["7:30pm - 8:20pm EDT"] }] };

// ── which day a class meets ────────────────────────────────────────────────
eq("weekday from Sawyer class_times", classWeekday(wedActing), 3);
eq("weekday from the portal's meets_days (1 = Mon)", classWeekday({ meets_days: [1] }), 1);
eq("meets_days 7 is Sunday", classWeekday({ meets_days: [7] }), 0);
eq("meets_days wins over class_times", classWeekday({ meets_days: [6], class_times: [{ title_text: "Mon" }] }), 6);
eq("full day names parse too", classWeekday({ class_times: [{ title_text: "Thursday" }] }), 4);
eq("falls back to the weekday of starts_on", classWeekday({ starts_on: "2026-09-19" }), 6);
eq("no schedule at all: unknown", classWeekday({ name: "Mystery" }), null);

// ── today, in Virginia ─────────────────────────────────────────────────────
eq("11pm on the 21st in Virginia is still the 21st", etToday(new Date("2026-10-22T03:00:00Z")), "2026-10-21");
eq("midnight UTC on the 22nd is 8pm on the 21st", etToday(new Date("2026-10-22T00:30:00Z")), "2026-10-21");

// ── CJ's example: four Wednesdays, two left ────────────────────────────────
// October 2026 has Wednesdays on the 7th, 14th, 21st, 28th.
let s = classSessionsInMonth(wedActing, 2026, 9, "2026-10-21");
eq("October: 4 Wednesdays, 2 left from the 21st", [s.day, s.total, s.left], ["Wednesday", 4, 2]);
eq("$90 × 2 ÷ 4 = $45", prorateCents(9000, s), 4500);
eq("the day of the class still counts", classSessionsInMonth(wedActing, 2026, 9, "2026-10-28").left, 1);
eq("the day after the last one counts nothing", classSessionsInMonth(wedActing, 2026, 9, "2026-10-29").left, 0);

// ── five Wednesdays ────────────────────────────────────────────────────────
// December 2026: 2, 9, 16, 23, 30.
s = classSessionsInMonth(wedActing, 2026, 11, "2026-12-10");
eq("December: 5 Wednesdays, 3 left from the 10th", [s.total, s.left], [5, 3]);
eq("$90 × 3 ÷ 5 = $54", prorateCents(9000, s), 5400);
eq("$150-bundle share of $75 prorates to $45", prorateCents(7500, s), 4500);
eq("a $60 second class prorates from $60", prorateCents(6000, s), 3600);
eq("rounds to the cent: $30 × 1 ÷ 3", prorateCents(3000, { day: "Wednesday", total: 3, left: 1 }), 1000);

// ── opening month: the class only holds what it holds ──────────────────────
// September 2026 Wednesdays are 2, 9, 16, 23, 30 — but the class starts on
// the 16th, so it HOLDS three sessions. Opening night is a full month.
s = classSessionsInMonth(wedActing, 2026, 8, "2026-09-16");
eq("September: 3 sessions held, 3 left on opening night", [s.total, s.left], [3, 3]);
eq("opening night pays the full month", prorateCents(9000, s), 9000);
eq("Sep 24: 1 of 3 = $30", prorateCents(9000, classSessionsInMonth(wedActing, 2026, 8, "2026-09-24")), 3000);

// ── the class's last month stops at ends_on ────────────────────────────────
// December 2026 Tuesdays: 1, 8, 15, 22, 29 — the adult class ends the 15th.
s = classSessionsInMonth(tueAdult, 2026, 11, "2026-12-10");
eq("adult class in December: 3 held, 1 left from the 10th", [s.total, s.left], [3, 1]);
eq("$90 × 1 ÷ 3 = $30", prorateCents(9000, s), 3000);

// ── an unknown schedule is never prorated ──────────────────────────────────
s = classSessionsInMonth({ name: "Mystery" }, 2026, 9, "2026-10-21");
eq("no weekday: no sessions counted", [s.day, s.total, s.left], [null, 0, 0]);
eq("no weekday: the full month", prorateCents(9000, s), 9000);

// ── the month the checkout covers ──────────────────────────────────────────
let c = classCoveredMonth([wedActing], at("2026-10-21"));
eq("mid-October signup covers October from the 21st", [c.y, c.m, c.from], [2026, 9, "2026-10-21"]);
c = classCoveredMonth([wedActing], at("2026-09-01"));
eq("signing up before the class starts covers its first month from its first day", [c.y, c.m, c.from], [2026, 8, "2026-09-16"]);
c = classCoveredMonth([tueAdult], at("2026-09-20"));
eq("the October adult class bought in September covers October", [c.y, c.m, c.from], [2026, 9, "2026-10-06"]);
// Thursday Oct 29: the month's Wednesdays are done. Nobody pays $0 for
// October and then a full November on the 1st — November is the month.
c = classCoveredMonth([wedActing], at("2026-10-29"));
eq("nothing left this month: the next month is covered instead", [c.y, c.m, c.from], [2026, 10, "2026-11-01"]);
eq("…and it is a full month: 4 of November's 4 Wednesdays", prorateCents(9000, classSessionsInMonth(wedActing, c.y, c.m, c.from)), 9000);
// Thursday Improv (1960959) still meets on the 29th, so a Wed + Thu cart
// stays in October: the Thursday line is 1 of 5, the Wednesday line $0.
const thuImprov = { id: 1960959, category: "class", starts_on: "2026-09-17", ends_on: "2027-06-10", class_times: [{ title_text: "Thu" }] };
c = classCoveredMonth([wedActing, thuImprov], at("2026-10-29"));
eq("a cart with any session left stays in the month", [c.y, c.m], [2026, 9]);
eq("…the line with nothing left is $0 today, the other prorates", [wedActing, thuImprov].map((a) => prorateCents(7500, classSessionsInMonth(a, c.y, c.m, c.from))), [0, 1500]);
c = classCoveredMonth([{ name: "Mystery" }], at("2026-10-29"));
eq("an unknown schedule never rolls forward", [c.y, c.m], [2026, 9]);
c = classCoveredMonth([tueAdult], at("2026-12-20"));
eq("a class that is over does not roll past its end", [c.y, c.m], [2026, 11]);

// ── holiday breaks are not held, so they are on neither side ───────────────
// season_breaks() as of Sep 16 2026 (staff_portal.season_events, kind break)
const BREAKS = [
  { title: "Thanksgiving Break", starts_on: "2026-11-22", ends_on: "2026-11-28" },
  { title: "Winter Break", starts_on: "2026-12-20", ends_on: "2027-01-03" },
  { title: "Spring Break", starts_on: "2027-03-22", ends_on: "2027-03-26" },
];
eq("Nov 25 is Thanksgiving", (breakOn("2026-11-25", BREAKS) || {}).title, "Thanksgiving Break");
eq("Nov 18 is a class day", breakOn("2026-11-18", BREAKS), null);
// November 2026 Wednesdays: 4, 11, 18, 25 — the 25th is off.
s = classSessionsInMonth(wedActing, 2026, 10, "2026-11-17", BREAKS);
eq("November holds 3 Wednesdays, not 4, and names the break", [s.total, s.left, s.off], [3, 1, ["Thanksgiving Break"]]);
eq("Nov 17 signup: 1 of 3 = $30 (would have been 2 of 4 = $45)", [prorateCents(9000, s), prorateCents(9000, classSessionsInMonth(wedActing, 2026, 10, "2026-11-17"))], [3000, 4500]);
// December 2026 Wednesdays: 2, 9, 16, 23, 30 — the 23rd and 30th are off.
s = classSessionsInMonth(wedActing, 2026, 11, "2026-12-10", BREAKS);
eq("December holds 3 Wednesdays; from the 10th, 1 is left", [s.total, s.left], [3, 1]);
eq("Dec 10 signup: 1 of 3 = $30", prorateCents(9000, s), 3000);
eq("a full month with no break on that weekday is untouched", classSessionsInMonth(wedActing, 2027, 0, "2027-01-01", BREAKS).total, 4);
// Thu Dec 17: the only Wednesdays left in December are both Winter Break,
// so January is the covered month and the first pull is Feb 1.
c = classCoveredMonth([wedActing], at("2026-12-17"), BREAKS);
eq("nothing but break weeks left: the next month is covered", [c.y, c.m, c.from], [2027, 0, "2027-01-01"]);
eq("…January is a full month", prorateCents(9000, classSessionsInMonth(wedActing, c.y, c.m, c.from, BREAKS)), 9000);
eq("…and the first pull is Feb 1", classBillingWindow([wedActing], at("2026-12-17"), BREAKS).nextBillUTC, utc1st(2027, 1));
eq("without breaks the same day would have stayed in December", classCoveredMonth([wedActing], at("2026-12-17")).m, 11);

// ── the subscription: the 1st after the covered month, full price ──────────
let w = classBillingWindow([wedActing], at("2026-10-21"));
eq("October signup: next pull Nov 1", w.nextBillUTC, utc1st(2026, 10));
eq("…the covered month rides along", [w.covered.y, w.covered.m], [2026, 9]);
w = classBillingWindow([wedActing], at("2026-10-29"));
eq("late-October signup covers November, so the next pull is Dec 1", w.nextBillUTC, utc1st(2026, 11));
w = classBillingWindow([wedActing], at("2026-09-16"));
eq("September signup: next pull Oct 1 (the season anchor)", w.nextBillUTC, CLASS_BILL_ANCHOR_UTC);
w = classBillingWindow([tueAdult], at("2026-12-10"));
eq("adult class bought Dec 10: it ends before Jan 1", w.cancelAtUTC < w.nextBillUTC, true);
eq("the monthly amount itself never changes", classMonthlyCents(1), 9000);

// ── a two-class bundle prorates line by line ───────────────────────────────
// $150 for two classes = $75 + $75; on Wed Oct 21 the Wednesday line has 2 of
// 4 left ($37.50) and the Tuesday line has Oct 27 only, 1 of 4 ($18.75).
c = classCoveredMonth([wedActing, tueAdult], at("2026-10-21"));
const lines = [wedActing, tueAdult].map((a) => prorateCents(7500, classSessionsInMonth(a, c.y, c.m, c.from)));
eq("bundle lines prorate on their own weekdays", lines, [3750, 1875]);
eq("due today is the sum", lines.reduce((x, y) => x + y, 0), 5625);

// ── the checkout client carries the same math ──────────────────────────────
// register/index.html draws the number before reg-pay answers, from its own
// pro* functions. Lift that block out of the page and run it against the
// same fixtures — the two must agree to the cent.
import { readFileSync } from "node:fs";
const html = readFileSync(new URL("../register/index.html", import.meta.url), "utf8");
const start = html.indexOf("  var PRO_DOW = "), end = html.indexOf("  function classWhen(a){");
eq("the client's proration block is where the test expects it", start > 0 && end > start, true);
const client = new Function(html.slice(start, end) + "\n return { proWeekday, proSessions, proCents, proCovered, proToday };")();
eq("the client reads today in Virginia", html.includes("timeZone: 'America/New_York'"), true);
eq("client proToday is a date", /^\d{4}-\d{2}-\d{2}$/.test(client.proToday()), true);
const fixtures = [wedActing, tueAdult, thuImprov, { meets_days: [7] }, { starts_on: "2026-09-19" }, { name: "Mystery" }];
eq("client weekdays match the server", fixtures.map(client.proWeekday), fixtures.map(classWeekday));
const probes = [[2026, 9, "2026-10-21"], [2026, 11, "2026-12-10"], [2026, 8, "2026-09-24"], [2026, 9, "2026-10-29"], [2026, 10, "2026-11-17"], [2027, 5, "2027-06-01"]];
for (const a of [wedActing, tueAdult, thuImprov, { name: "Mystery" }]) {
  for (const [label, br] of [["no breaks", []], ["with breaks", BREAKS]]) {
    eq(`client sessions match the server for ${a.name || a.id} (${label})`,
      probes.map(([y, m, f]) => { const s = client.proSessions(a, y, m, f, br); return [s.day, s.total, s.left, s.off, client.proCents(9000, s)]; }),
      probes.map(([y, m, f]) => { const s = classSessionsInMonth(a, y, m, f, br); return [s.day, s.total, s.left, s.off, prorateCents(9000, s)]; }));
  }
}
// proCovered reads the real clock, so only its shape and the today-driven
// month can be checked here; the roll-forward line is pinned by text.
const cov = client.proCovered([wedActing], BREAKS);
eq("client covered month is today's month (or the class's first)", cov.from >= client.proToday() && cov.m >= 0 && cov.m <= 11, true);
eq("the client rolls an empty month forward like the server", html.includes("proSessions(a, y, m, from, breaks).left > 0") && html.includes("if (lastEnd && proIso(ny, nm, 1) > lastEnd) break;"), true);
eq("the client loads season_breaks with the catalog, on both doors", (html.match(/sb\.rpc\('season_breaks'\)/g) || []).length, 2);
eq("the client prices with the breaks it loaded", html.includes("proCovered(clsActs, state.breaks || [])"), true);

if (fails) { console.error(`\n${fails} failing`); process.exit(1); }
console.log("\nclass proration: all good");
