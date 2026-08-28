// ─────────────────────────────────────────────────────────────────────────────
//  NOVAPA PRIVATE LESSONS — THE ONLY FILE YOU NEED TO EDIT
// ─────────────────────────────────────────────────────────────────────────────
//  Everything the booking page shows — teachers, their open weekly times,
//  rates, the semester dates, and the discounts — comes from this file.
//  Edit it, publish, done. No database, no admin login, no vendor.
//
//  QUICK EDITS
//    • Add a teacher ........ copy a block in TEACHERS, give it a new `id`
//    • Open a new time ...... add { day, time } to that teacher's `slots`
//    • Close a time ......... delete it (already-sold bookings are unaffected)
//    • Change the semester .. edit TERM below
//    • Change discounts ..... edit `discountPct` on TERM / PACKS
//
//  day: 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat     time: 24-hour "HH:MM"
// ─────────────────────────────────────────────────────────────────────────────

export const TIMEZONE = "America/New_York";
export const SESSION_MINUTES = 50;

// How far ahead a lesson must be to still be bookable. Mirrors the 48-hour
// cancellation policy on the coaching page — nobody can grab a slot that
// starts tomorrow.
export const BOOKING_LEAD_DAYS = 2;

// How long a slot is held while the family is on the Stripe payment page.
// If they abandon checkout, the hold evaporates and the slot reopens.
// Kept in lockstep with the Stripe Checkout Session expiry, whose floor is
// 30 minutes — a shorter hold would reopen a slot someone could still pay for.
export const HOLD_MINUTES = 30;

// ── THE SEMESTER ────────────────────────────────────────────────────────────
// Buying the term reserves the same weekday + time every week from start to
// end. The term sells whole and only before lessons begin: once it is under
// way quote() refuses it with `term_started` and the packs take over. A
// prorated term would need per-order pricing that the flat-price rule in
// reg-config.mjs has no way to express.
export const TERM = {
  id: "fall-2026",
  name: "Fall 2026 Semester",
  startDate: "2026-09-14", // first week of lessons
  endDate: "2027-01-14",   // last week of lessons
  discountPct: 15,
  blurb: "Your time, locked in every week, all semester.",
};

// ── WHEN THE STUDIO IS DARK ─────────────────────────────────────────────────
// Lessons never land inside these ranges — a weekly run simply skips the break
// and picks up the following week. Dates are inclusive on both ends and come
// from the season calendar (see calendar.html).
//
// Note: calendar.html marks Thanksgiving as Nov 22–28 while the classes page
// says Nov 22–29. The wider range is used here on purpose — skipping a day
// that turns out to be open costs one lesson, but booking a lesson on a day
// the studio is shut costs a phone call and a refund.
export const CLOSURES = [
  { name: "Thanksgiving Break", from: "2026-11-22", to: "2026-11-29" },
  { name: "Winter Break", from: "2026-12-20", to: "2027-01-03" },
  { name: "Spring Break", from: "2027-03-22", to: "2027-03-26" },
];

// ── THE TWO RATES ───────────────────────────────────────────────────────────
// BASE_RATE is the published single-session price (activity 970401) and the
// number every pack below is quoted against. The associate coaches teach at
// exactly this rate, so their packs are the prices already advertised on
// coaching.html — nothing new to publish and nothing that can drift.
export const BASE_RATE = 120;

// The lead coach carries a 15% premium. Change this one multiplier and every
// pack and semester price for that coach moves with it.
export const LEAD_RATE = Math.round(BASE_RATE * 1.15); // $138

// ── SESSION PACKS ───────────────────────────────────────────────────────────
// Same weekday + time, N weeks in a row, starting the next available week.
//
// `price` is the exact published total, taken from the live catalog
// (register/coaching.js ids 970402/970403/970404 and db/coaching-activities.sql).
// Quoting the real number rather than a percentage means these can never drift
// from what the coaching page and the registration system already charge.
export const PACKS = [
  {
    id: "pack-10",
    name: "10-Session Pack",
    sessions: 10,
    price: 1050,            // $105 each — activity 970404
    blurb: "Ten weeks in a row — our lowest per-lesson rate.",
  },
  {
    id: "pack-6",
    name: "6-Session Pack",
    sessions: 6,
    price: 660,             // $110 each — activity 970403
    blurb: "Six weeks — enough to carry a full audition cycle.",
  },
  {
    id: "pack-3",
    name: "3-Session Pack",
    sessions: 3,
    price: 350,             // about $117 each — activity 970402
    blurb: "Three weeks — a short, focused block.",
  },
];

// ── HOW A LESSON CAN HAPPEN ─────────────────────────────────────────────────
export const MODES = [
  { id: "studio", label: "In studio", detail: "National Conference Center, Leesburg" },
  { id: "virtual", label: "Virtual", detail: "Google Meet link sent on confirmation" },
];

// ── COACHES ─────────────────────────────────────────────────────────────────
//  Real roster. Two things here are still placeholders and need your input:
//
//   1. `bio` — these are written from the coach titles you gave and nothing
//      else. No credentials, years of experience, or school placements have
//      been invented. Replace each with the coach's own words before this page
//      goes public.
//   2. `slots` — the open weekly times below are a starting grid, not anyone's
//      real availability. Set each coach's actual hours.
//
//  `rate` is LEAD_RATE ($138) for the lead coach and BASE_RATE ($120) for
//  everyone else — packs and the semester scale from it automatically.
//  `initials` is the fallback avatar; add `photo: "somefile.jpg"` for an image.
export const TEACHERS = [
  {
    id: "tony-cimino-johnson",
    name: "Tony Cimino-Johnson",
    initials: "TC",
    title: "Acting, Musical Theatre & College Coach",
    specialties: ["Acting", "Musical Theatre", "College Auditions"],
    bio: "Private coaching in acting and musical theatre, and college audition preparation.",
    rate: LEAD_RATE,
    modes: ["studio", "virtual"],
    slots: [
      { day: 1, time: "16:00" },
      { day: 1, time: "17:00" },
      { day: 3, time: "16:30" },
      { day: 3, time: "17:30" },
      { day: 3, time: "18:30" },
      { day: 5, time: "15:30" },
    ],
  },
  {
    id: "colton-sorenson",
    name: "Colton Sorenson",
    initials: "CS",
    title: "Vocal & Musical Theatre Coach",
    specialties: ["Voice", "Musical Theatre", "Vocal Technique"],
    bio: "Private coaching in vocal technique and musical theatre performance.",
    rate: BASE_RATE,
    modes: ["studio", "virtual"],
    slots: [
      { day: 2, time: "16:00" },
      { day: 2, time: "17:00" },
      { day: 2, time: "18:00" },
      { day: 4, time: "17:00" },
      { day: 4, time: "18:00" },
      { day: 6, time: "10:00" },
      { day: 6, time: "11:00" },
    ],
  },
  {
    id: "ryyana-cunningham",
    name: "Ryyana Cunningham",
    initials: "RC",
    title: "Audition & Musical Theatre Coach",
    specialties: ["Audition Prep", "Musical Theatre", "Repertoire"],
    bio: "Private coaching in audition preparation and musical theatre performance.",
    rate: BASE_RATE,
    modes: ["studio", "virtual"],
    slots: [
      { day: 1, time: "18:00" },
      { day: 4, time: "16:00" },
      { day: 4, time: "19:00" },
      { day: 6, time: "12:00" },
      { day: 6, time: "13:00" },
    ],
  },
  {
    id: "katie-hamburger",
    name: "Katie Hamburger",
    initials: "KH",
    title: "Dance Coach",
    specialties: ["Dance", "Choreography", "Movement"],
    bio: "Private coaching in dance technique and choreography.",
    rate: BASE_RATE,
    modes: ["studio"],
    slots: [
      { day: 2, time: "15:30" },
      { day: 4, time: "15:30" },
      { day: 5, time: "16:30" },
      { day: 5, time: "17:30" },
      { day: 6, time: "09:00" },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
//  Below this line is machinery. You should not need to edit it.
// ─────────────────────────────────────────────────────────────────────────────

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Parse a "YYYY-MM-DD" as UTC noon, which keeps weekday math DST-proof. */
export function toDate(iso) {
  return new Date(`${iso}T12:00:00Z`);
}

export function isoOf(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(date, n) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + n);
  return next;
}

export function dayName(day) {
  return DAY_NAMES[day];
}

/** "17:30" → "5:30 PM" */
export function prettyTime(time) {
  const [h, m] = time.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** "2026-09-16" → "Sep 16" */
export function prettyDate(iso) {
  const d = toDate(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Stable key for one recurring weekly slot. */
export function slotKey(teacherId, day, time) {
  return `${teacherId}__${day}__${time.replace(":", "")}`;
}

/** Is the studio shut on this date? */
export function isClosed(iso) {
  return CLOSURES.some((c) => iso >= c.from && iso <= c.to);
}

/** The closure covering a date, for explaining a skipped week. */
export function closureFor(iso) {
  return CLOSURES.find((c) => iso >= c.from && iso <= c.to) || null;
}

// A weekly run can only skip so many weeks before something is wrong with the
// config; this stops a bad closure range spinning forever.
const MAX_WEEKS_SCANNED = 104;

/**
 * Every date on or after `from` that falls on `day`, up to `until` (inclusive)
 * and/or capped at `limit` occurrences.
 *
 * Closure weeks are stepped over rather than counted. A 10-pack that straddles
 * Thanksgiving still delivers ten lessons — it just finishes a week later.
 */
export function weeklyDates(day, from, { until = null, limit = null } = {}) {
  let cursor = new Date(from.getTime());
  const shift = (day - cursor.getUTCDay() + 7) % 7;
  cursor = addDays(cursor, shift);

  const out = [];
  const stop = until ? until.getTime() : Infinity;
  for (let week = 0; week < MAX_WEEKS_SCANNED; week += 1) {
    if (cursor.getTime() > stop) break;
    const iso = isoOf(cursor);
    if (!isClosed(iso)) {
      out.push(iso);
      if (limit && out.length >= limit) break;
    }
    cursor = addDays(cursor, 7);
  }
  return out;
}

/** The earliest date a newly-purchased lesson is allowed to land on. */
export function earliestBookableDate(now = new Date()) {
  return addDays(toDate(isoOf(now)), BOOKING_LEAD_DAYS);
}

/**
 * The concrete lesson dates a given plan would occupy on a given weekday,
 * skipping nothing — this is the *ideal* run, before checking what's taken.
 * Returns [] when the plan cannot run at all (e.g. the term is over).
 */
export function planDates(planId, day, now = new Date()) {
  const from = earliestBookableDate(now);

  if (planId === TERM.id) {
    const termEnd = toDate(TERM.endDate);
    if (from > termEnd) return [];
    const start = from > toDate(TERM.startDate) ? from : toDate(TERM.startDate);
    return weeklyDates(day, start, { until: termEnd });
  }

  const pack = PACKS.find((p) => p.id === planId);
  if (!pack) return [];
  return weeklyDates(day, from, { limit: pack.sessions });
}

/**
 * Authoritative price. `sessions` is the actual count being sold — a prorated
 * mid-semester term charges only for the weeks that remain.
 */
export function priceFor({ rate, sessions, discountPct = null, price = null }) {
  const rateCents = Math.round(rate * 100);
  const grossCents = rateCents * sessions;

  // A pack quotes its published total outright; the semester takes a
  // percentage off. Packs scale if a coach charges something other than the
  // base rate, so the published number is exact at $120 and still sensible
  // above it.
  // Rounded to whole dollars — every price in the coaching catalog is, and
  // 14 lessons at $108 less 15% would otherwise land on $1,285.20.
  // Multiply before dividing. `price * 100 * (rate / BASE_RATE)` evaluates
  // 1050 × 100 × (138/120) as 120749.999…, which rounds a whole dollar low.
  const raw =
    price != null
      ? (price * 100 * rate) / BASE_RATE
      : grossCents - (grossCents * discountPct) / 100;
  const totalCents = Math.round(raw / 100) * 100;

  const discountCents = grossCents - totalCents;
  return {
    sessions,
    rateCents,
    grossCents,
    discountCents,
    totalCents,
    // Derived so packs and the semester report savings the same way.
    discountPct: grossCents ? Math.round((discountCents / grossCents) * 1000) / 10 : 0,
    perSessionCents: sessions ? Math.round(totalCents / sessions) : 0,
  };
}

export function getTeacher(teacherId) {
  return TEACHERS.find((t) => t.id === teacherId) || null;
}

export function getPlan(planId) {
  if (planId === TERM.id) {
    return { id: TERM.id, name: TERM.name, kind: "term", discountPct: TERM.discountPct, blurb: TERM.blurb };
  }
  const pack = PACKS.find((p) => p.id === planId);
  if (!pack) return null;
  return { ...pack, kind: "pack" };
}

/** Plans in the order the page should present them — biggest commitment first. */
export function allPlans() {
  return [getPlan(TERM.id), ...PACKS.map((p) => getPlan(p.id))];
}
