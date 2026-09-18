// Shared pricing + window config for the NOVAPA registration flow.
// Single source of truth for money math — the client only displays numbers,
// reg-pay.mjs recomputes everything server-side.
//
// Pricing rules (CJ, Jul 20 2026):
//  - No family fee.
//  - Unified show tiers (CJ, Jul 31 — supersedes the camp-only tiers, the
//    10% two-show bundle, and the Jul 30 show+camp combo): every Broadway
//    Bound show counts the same, summer camp or school-year show, Mean Girls
//    included. PER REGISTRANT, through the launch sale (EARLYBIRD_END):
//    1 show 10% / 2 shows 15% / 3+ shows 20%, off all of that kid's shows.
//    Prior registrations qualify a kid; only cart items are priced.
//  - Sibling 5%: non-BB items (classes) immediately; BB camps/shows only
//    after the launch sale ends. Never stacks with tier/bundle discounts.
//  - Payment plans cost 5% more than paying in full (PLAN_FEE_PCT): the fee
//    is added to the financed balance and spread across the installments —
//    today's deposit is unchanged. Pay-in-full carts never pay it.
//  - Deposit plans: $180/item today, monthly installments on the 1st,
//    last installment no later than 14 days before the item's start date
//    AND no later than May 1, 2027 (CJ: collect summer money earlier).
//    Within 14 days of start: pay-in-full only.
//  - Classes (CJ, Sep 14 2026 — supersedes the Jul 31 $90/$159/$199 ladder):
//    PER REGISTRANT 1 class $90/mo, 2 classes $150/mo, 3 classes $180/mo
//    (each past three +$30, the 3rd-class step). No sibling stacking on
//    classes — the bundle IS the discount. First month at checkout, next
//    pull Oct 1, monthly through Jun 1 2027 (auto-cancels Jul 1 2027).
//    Cancellation: 30 days notice (policy-enforced, not code).
//  - Class + show cross-sell (CJ, Sep 18 2026, correcting Jul 31): a family
//    with ANY 2026-27 show or camp registration (web order or Sawyer import)
//    gets its FIRST CLASS free, not its first month — one session comes off
//    today's prorated charge on each class line. Between Jul 31 and Sep 18
//    the whole first month was waived ($0 today, card saved via SetupIntent);
//    that path survives only for the edge where the free session is the last
//    one the month holds, so there is genuinely nothing to charge today.
//  - Tuition insurance (opt-in, camps & shows only — NOT classes): +10% of
//    the discounted subtotal, collected at checkout. Coverage per
//    /policies#tuition-insurance: refund 100% at 90-76 days before start,
//    75% at 75-51d, 50% at 50-31d, 0% within 30d; premium non-refundable.
//  - All sales final — no refunds (insurance is the exception path).
//  - Day camps ($79 one-day events, price <= DAY_CAMP_MAX_CENTS): pay-in-full
//    only (charged fully today even inside a deposit-plan cart), no bundle or
//    tier discounts, no insurance; sibling 5% applies immediately (non-BB).
//  - Coupon codes (coupons table): percent off the discounted subtotal —
//    stacks on top of tier/bundle/sibling like Sawyer coupons did. Insurance
//    is computed on the post-coupon amount. For classes the coupon reduces
//    today's first-month charge only; the recurring monthly price is unchanged.

export const SUPABASE_URL = "https://tlkuqwsqicxcjdmumkje.supabase.co";
export const SUPABASE_ANON_KEY =
  "sb_publishable_8ar97CkK-C0YlWuOGtI_tA_mwTDVE6H";

export const PRICE_CENTS = 99500;            // $995 per summer camp
export const DEPOSIT_PER_ITEM_CENTS = 18000; // $180 reserve per camp/show (CJ sign-off)
export const EARLYBIRD_END = "2026-08-15T23:59:59-04:00"; // launch sale end
export const PUBLIC_OPEN_AT = "2026-08-01T10:00:00-04:00";
export const MAX_INSTALLMENTS = 8;
export const PAY_FULL_CUTOFF_DAYS = 14;      // all payments >= 2 weeks before start
// Hard ceiling on the final installment date — May 1 2027 (summer money lands early).
export const LAST_INSTALLMENT_UTC = Date.UTC(2027, 4, 1, 4, 0, 0);

// Fixed installment calendars for shows that rehearse for months (CJ, Sep 13
// 2026). The standard rule stops payments 14 days before the FIRST REHEARSAL,
// which by opening week turned Frozen into "pay $695 today" and nothing else:
// the pay-in-installments tile was on screen and refused every tap. These two
// shows finance through the run instead — today's share at checkout, then the
// 1st of the month through December 1. Dates already past are dropped, so a
// late registrant gets fewer, larger payments rather than no plan. Frozen Jr.
// keeps the standard rule until CJ says otherwise.
const utc4 = (iso) => { const [y, m, d] = iso.split("-").map(Number); return Math.floor(Date.UTC(y, m - 1, d, 4, 0, 0) / 1000); };
const FROZEN_FALL_DATES = ["2026-10-01", "2026-11-01", "2026-12-01"].map(utc4);
export const FIXED_PLAN_DATES_UTC = {
  1959789: FROZEN_FALL_DATES, // Broadway Bound | Frozen, Kids
  1959805: FROZEN_FALL_DATES, // Broadway Bound Teens | Frozen, Jr
};
// The fixed calendar for a cart, or null when no item carries one. A cart that
// mixes a fixed-plan show with anything else follows the fixed calendar for the
// whole balance: the other item is paid off sooner than it had to be, never
// later, and the family is never refused a plan they were promised.
export function fixedPlanDates(activityIds, now = new Date()) {
  const nowSec = Math.floor(now.getTime() / 1000);
  for (const id of activityIds || []) {
    const dates = FIXED_PLAN_DATES_UTC[Number(id)];
    if (dates) return dates.filter((t) => t > nowSec);
  }
  return null;
}

// One-time account adjustments approved by Todd/CJ. The code is entered like a
// coupon but locked to one family's email; any combination of: pctOffList
// (replaces every program discount with a flat pct off LIST price),
// waivePlanFee (kills the 5%), months (stretches the schedule to a fixed
// count, past the May-1 / pre-start limits — that's the point of the
// concession). A matching coupons row must exist and stay active (max_uses
// caps redemption); its pct is display-only.
export const SPECIAL_PLANS = {
  "SOK20": {
    email: "isabel.castillejo13@gmail.com",
    waivePlanFee: true, months: 10,
    // Mrs. Sok, approved Jul 30 2026. Her 20% comes from the global
    // show+camp combo now — this code only waives the plan fee and
    // stretches her schedule to 10 months.
  },
  "SMITH20": {
    // Jamie + Christie Smith — Grace. Todd approved 20% off (Aug 5 2026) for
    // Grace doing four productions across summer, fall and spring; the launch
    // ladder lapsed Aug 15 before they registered Frozen + Mermaid, and CJ
    // extended the discount (Aug 17, "Voice Classes" thread). Both household
    // emails are unlocked: the paid summer order lives under Christie's
    // address, the email thread under Jamie's.
    email: ["christieamstadt@gmail.com", "jcs@smith82.com"],
    pctOffList: 20,
    // Plus the retro true-up Todd approved Aug 10: their summer camps were
    // paid at the 15% two-show rate, and with four productions the whole set
    // is 20% — $49.75 x 2 = $99.50 back, delivered as a credit on this
    // checkout (the coupons row has carried the amount since Aug 10).
    creditCents: 9950,
    // months: 5 spreads the Frozen+Mermaid cart Sep-Jan instead of the
    // 1-payment collapse the Sep-15 Frozen start forces — same concession
    // as ANSELL0. Jamie asked Aug 24; Jason approved same day.
    months: 5,
  },
  "ANSELL0": {
    email: "ajansell@gmail.com",
    waivePlanFee: true, months: 5,
    // Andrea Ansell, approved by Todd Aug 7 2026: no 5% plan fee. months: 5
    // spreads her Frozen+Mermaid cart Sep-Jan instead of the 1-payment
    // collapse the Sep-15 Frozen start forces (Jason, Aug 7).
  },
  "ANSELLO": {
    email: "ajansell@gmail.com",
    waivePlanFee: true, months: 5,
    // Same waiver, letter-O spelling — ANSELL0 ends in a zero that reads as
    // the letter O in most fonts, and Andrea typed the O. Both work.
  },
};

export const CLASS_PRICE_CENTS = 9000;
export const CLASS_BILL_ANCHOR_UTC = Date.UTC(2026, 9, 1, 4, 0, 0) / 1000;  // Oct 1 2026
// Jun 30, NOT Jul 1: monthly pulls fire at 04:00 UTC on the 1st, and a
// cancel_at of exactly Jul 1 04:00 ties with a would-be July pull — if the
// invoice wins the race, a family pays for a month after the season ended.
// Jun 30 keeps the last pull at Jun 1 with a full day of margin (Jason,
// Aug 17: "all class subscriptions should end on June 30th").
export const CLASS_SEASON_END_UTC = Date.UTC(2027, 5, 30, 4, 0, 0) / 1000;

// ── Mid-month proration (CJ, Sep 16 2026) ─────────────────────────────────
// "If they sign up for a Wednesday class and there are two Wednesdays left
// and there were four Wednesdays in that month, take 90, divide it by four,
// and then charge them for those two classes." The checkout charge is the
// month's tuition × (sessions left ÷ sessions held that month); the monthly
// subscription still pulls the full amount on the 1st.
//
// "Sessions held that month" are the dates of the class's weekday inside
// [starts_on, ends_on] — so September, where the season opens on the 14th,
// has three Wednesdays for a Wednesday class, and a family joining on opening
// night pays the full month (3 of 3), not 3 of 5. A class whose weekday is
// unknown is never prorated: the full month, exactly as before.
const DOW_INDEX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
export const DOW_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// The class's weekday (JS 0 = Sunday … 6 = Saturday). The portal writes
// meets_days as 1 = Mon … 7 = Sun (portal_dow_name); every Sawyer-era row
// only says it in class_times[0].title_text ("Wed"); last resort is the
// weekday of starts_on, which is the first session by construction.
export function classWeekday(act) {
  if (!act) return null;
  const md = Array.isArray(act.meets_days) && act.meets_days.length ? Number(act.meets_days[0]) : NaN;
  if (md >= 1 && md <= 7) return md % 7;
  const ct = Array.isArray(act.class_times) ? act.class_times[0] : null;
  const key = String((ct && ct.title_text) || "").trim().slice(0, 3).toLowerCase();
  if (key in DOW_INDEX) return DOW_INDEX[key];
  if (act.starts_on) return new Date(act.starts_on + "T12:00:00Z").getUTCDay();
  return null;
}
// "Today" is the studio's day, not the server's: a parent paying at 11pm on
// the 21st in Virginia is still on the 21st (America/New_York), whatever
// UTC says. Returns "YYYY-MM-DD".
export function etToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
const isoDate = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
// The break a date falls in, or null. `breaks` is season_breaks(): rows of
// { title, starts_on, ends_on } from staff_portal.season_events — the same
// rows the portal's class_calendar() skips (CJ, Sep 16 2026: "honor the
// holiday breaks too").
export function breakOn(iso, breaks) {
  for (const b of breaks || []) {
    if (b && b.starts_on && b.ends_on && iso >= b.starts_on && iso <= b.ends_on) return b;
  }
  return null;
}
// The class's sessions in one calendar month (m is 0-based), and how many of
// them are on or after fromISO. A session inside a break is not held and
// counts on neither side; its break title lands in `off`. { day, total,
// left, dates, off } — day is null and total 0 when the weekday is unknown.
export function classSessionsInMonth(act, y, m, fromISO, breaks = []) {
  const wd = classWeekday(act);
  if (wd == null) return { day: null, total: 0, left: 0, dates: [], off: [] };
  const dates = [], off = [];
  for (let d = 1; d <= daysInMonth(y, m); d++) {
    const s = isoDate(y, m, d);
    if (new Date(s + "T12:00:00Z").getUTCDay() !== wd) continue;
    if (act.starts_on && s < act.starts_on) continue;
    if (act.ends_on && s > act.ends_on) continue;
    const b = breakOn(s, breaks);
    if (b) { if (!off.includes(b.title)) off.push(b.title); continue; }
    dates.push(s);
  }
  return { day: DOW_NAMES[wd], total: dates.length, left: dates.filter((s) => s >= fromISO).length, dates, off };
}
// The month the checkout charge covers: the month of today or of the earliest
// class start, whichever is later — and if NO class in the cart has a session
// left in it (a Wednesday class bought on the month's last Thursday), the next
// month instead, so nobody pays $0 for a month they never attend and then a
// full month on the 1st for the one they join. { y, m, from, today } where
// `from` is the first day the family can attend.
export function classCoveredMonth(acts, now = new Date(), breaks = []) {
  const list = (acts || []).filter(Boolean);
  const today = etToday(now);
  const starts = list.map((a) => a.starts_on).filter(Boolean).sort();
  const ends = list.map((a) => a.ends_on).filter(Boolean).sort();
  const lastEnd = ends.length ? ends[ends.length - 1] : null;
  let from = starts[0] && starts[0] > today ? starts[0] : today;
  let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7)) - 1;
  for (let i = 0; i < 12; i++) {
    const attends = list.some((a) => classWeekday(a) == null || classSessionsInMonth(a, y, m, from, breaks).left > 0);
    if (attends || !list.length) break;
    const ny = m === 11 ? y + 1 : y, nm = (m + 1) % 12;
    if (lastEnd && isoDate(ny, nm, 1) > lastEnd) break; // the class is over; stay in its last month
    y = ny; m = nm; from = isoDate(y, m, 1);
  }
  return { y, m, from, today };
}
// A month's tuition, charged only for the sessions left: $90 × 2 ÷ 4 = $45.
// pr.free (0 or 1) is the show-family perk — the first class free — and
// comes off the sessions charged, never below zero: 2 left, 1 free, $22.50.
// Rounded to the cent; an unknown schedule is the full month.
export function prorateCents(monthlyCents, pr) {
  if (!pr || pr.day == null || !pr.total) return monthlyCents;
  return Math.round(monthlyCents * Math.max(0, pr.left - (pr.free || 0)) / pr.total);
}
export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// When a class subscription pulls next, and when it stops (CJ, Sep 13 2026).
// The month covered at checkout is the class's first month — or the current
// month for a mid-season signup, prorated to the sessions left in it (see
// classCoveredMonth) — so the first recurring invoice lands on the 1st of
// the FOLLOWING month, never before the Oct 1 season anchor. The
// subscription cancels the day after the class's last session (the last pull
// is the 1st of that final month), capped at the season end. A class with no
// dates on file falls back to the old behaviour on both ends.
export function classBillingWindow(acts, now = new Date(), breaks = []) {
  const covered = classCoveredMonth(acts, now, breaks);
  const firstOfMonthAfter = Math.floor(Date.UTC(covered.y, covered.m + 1, 1, 4, 0, 0) / 1000);
  const ends = (acts || []).map((a) => a && a.ends_on).filter(Boolean).sort();
  const nextBillUTC = Math.max(CLASS_BILL_ANCHOR_UTC, firstOfMonthAfter);
  const lastEnd = ends.length ? ends[ends.length - 1] : null;
  const cancelAtUTC = lastEnd
    ? Math.min(CLASS_SEASON_END_UTC, Math.floor(new Date(lastEnd + "T04:00:00Z").getTime() / 1000) + 86400)
    : CLASS_SEASON_END_UTC;
  return { nextBillUTC, cancelAtUTC, covered };
}
export const SIBLING_PCT = 5;
export const INSURANCE_PCT = 10;
export const PLAN_FEE_PCT = 5;   // surcharge for choosing a payment plan
// Items at or under this price are "day camps" ($79 one-day events):
// pay-in-full only, no bundle/tier discounts, no insurance, sibling 5% now.
export const DAY_CAMP_MAX_CENTS = 20000;
// Day Camp Credit Pack (the product /day-camps has advertised; CJ priced it
// Aug 2 2026): $349 buys ONE CAMPER 5 day-camp credits, good through Jun 30
// 2027, credits never shared between siblings. Bought by Sep 21 2026 (extended from Labor Day by CJ on Sep 9), the pack
// adds 2 free Snow Day credits for that camper. Credits auto-redeem at
// checkout: a day camp for a camper with a day credit prices at $0 (snow-day
// events consume snow credits instead). The webhook grants/deducts via
// apply_credit_events, keyed by payment intent so retries are no-ops.
export const DAY_CAMP_PACK_ID = 990010;
export const DAY_CAMP_PACK_SIZE = 5;
export const DAY_CAMP_PACK_CENTS = 34900;
export const DAY_CAMP_PACK_CREDITS = 5;
export const DAY_CAMP_PACK_SNOW_BONUS = 2;
export const DAY_CAMP_PACK_SNOW_END = new Date("2026-09-22T03:59:59Z"); // end of Mon Sep 21 2026 ET (extended from Labor Day by CJ on Sep 9 2026)
export const isSnowDayName = (name) => /snow day/i.test(name || "");

// Every purchasable day-camp credit pack, keyed by activity id. The 5-pack is
// the original product; the 10-pack was added Sep 9 2026 at CJ's direction
// ($675, $67.50 a day, one tier below the 5-pack's $69.80). Credits, price and
// the snow bonus are all read from here, so adding another pack never means
// editing the grant logic again -- that hard-coding is exactly how a pack could
// have taken money and granted nothing.
export const DAY_CAMP_PACKS = {
  [DAY_CAMP_PACK_ID]: { credits: DAY_CAMP_PACK_CREDITS, cents: DAY_CAMP_PACK_CENTS, size: DAY_CAMP_PACK_SIZE },
  990011: { credits: 10, cents: 67500, size: 10 },
};
// Returns null for anything that is not a pack, so callers use it as a predicate.
export const dayCampPack = (id) => DAY_CAMP_PACKS[id] || null;

// The credit movements an order causes, in the shape apply_credit_events reads:
// { grants: [{camper, day, snow}], redemptions: [{camper, day, snow}] }.
//
// ONE PLACE, AND NAMED BY THE CAMPER. Until 13 Sep 2026 reg-pay built these
// arrays twice (Stripe metadata and the $0 path) and keyed the cart-form pack
// bonus and every redemption by kidKey -- "i0", the camper's position in the
// cart -- while apply_credit_events matches campers by NAME within the family.
// Nothing matched, so nothing moved: Eva Pruitt redeemed two days and kept all
// five credits; the Bays bought two 5-day packs before the snow deadline and
// got no snow days. Pack-product grants were fine only because they read
// it.camper directly. So the key is translated back to the name here, once,
// and a line with no name is dropped rather than sent -- a nameless event
// cannot land on the wrong child, but it must never be silently "applied".
export function creditEventsFor(items, pricing, now = new Date()) {
  const nameByKey = {};
  for (const it of items || []) {
    const name = String((it && it.camper) || "").trim();
    if (name && !nameByKey[kidKey(it)]) nameByKey[kidKey(it)] = name;
  }
  const snowOn = now <= DAY_CAMP_PACK_SNOW_END;
  const grants = [];
  for (const it of items || []) {
    const pack = dayCampPack(it && it.activity_id);
    if (!pack) continue;
    const name = String(it.camper || "").trim();
    if (!name) { console.error("credit grant with no camper name dropped:", JSON.stringify(it)); continue; }
    grants.push({ camper: name, day: pack.credits, snow: snowOn ? DAY_CAMP_PACK_SNOW_BONUS : 0 });
  }
  // cart-form packs: the camper books all 5 days now, so no day credits --
  // just the snow-day bonus (packs bought by DAY_CAMP_PACK_SNOW_END)
  if (snowOn) {
    for (const [k, n] of Object.entries((pricing && pricing.dayPacksByKid) || {})) {
      const name = nameByKey[k];
      if (!name) { console.error("cart-pack snow grant with no camper name dropped:", k); continue; }
      grants.push({ camper: name, day: 0, snow: DAY_CAMP_PACK_SNOW_BONUS * n });
    }
  }
  const redemptions = [];
  for (const [k, u] of Object.entries((pricing && pricing.creditsUsed) || {})) {
    const name = nameByKey[k];
    if (!name) { console.error("credit redemption with no camper name dropped:", k); continue; }
    redemptions.push({ camper: name, day: (u && u.day) || 0, snow: (u && u.snow) || 0 });
  }
  return { grants, redemptions };
}

export const SHOWS = {
  httyd: "How to Train Your Dragon JR.",
  charlie: "Charlie and the Chocolate Factory JR.",
  trolls: "Trolls The Musical JR.",
};
export const BANDS = ["5-9", "9-12", "12-15", "tech"];

// Program start dates anchor the 2-weeks-before payment rule.
export const CAMP_START = {
  httyd: "2027-07-05", charlie: "2027-07-19", trolls: "2027-08-02",
};
// Year-round BB shows (earliest session of each group — conservative).
// This date is the installment anchor only: a plan has to finish before the
// program it pays for. For the Teen Conservatory shows that anchor is opening
// night, not the first rehearsal — both casts are already set and rehearsing,
// so the thing we are collecting against is the run, not the start date.
// A FALLBACK since Aug 17 2026, not the answer. A listing now carries its own
// starts_on and reg-pay passes it as `start`, which priceCart prefers. This
// list only still exists for the shows that predate that column.
//
// It mattered more than it looks. A show whose name matched nothing here
// returned null, installmentDates returned no dates, and the family was
// silently refused a payment plan and charged in full — a $995 surprise caused
// by a regex not recognising a title nobody had added to this file.
export function showStartFor(name) {
  if (/frozen/i.test(name)) return "2026-09-15";
  if (/mermaid/i.test(name)) return "2027-02-03";
  if (/mean girls/i.test(name)) return "2027-06-14";
  if (/sweeney/i.test(name)) return "2026-10-23";
  if (/hadestown/i.test(name)) return "2027-03-05";
  return null;
}

// Teen Conservatory summer intensive (Mean Girls). Its discount is its own
// rule: flat 10% through Aug 1 (the private-registration window — everyone in
// the gate is a returning family), full price once registration opens to the
// public. It never joins the camp tier or the fall-show bundle.
// 990001 = performers, 990002 = tech crew — same program, same rule.
export const MEANGIRLS_IDS = [990001, 990002];
export const MEANGIRLS_ID = 990001;
const isMeanGirls = (it) => MEANGIRLS_IDS.includes(it.activity_id);

// Teen Conservatory (Sweeney Todd, Hadestown). Unlisted — reachable only by a
// direct ?activity= link sent to families who are already cast. Their discount
// is the one the Teen Conservatory page advertises and nothing else: 10% when
// one performer does both shows. They deliberately do NOT touch the summer
// funnel — a prior summer camp must not quietly knock $89.50 off a seat these
// families were already invoiced $895 for, and doing one of them must not
// confer the fall-show bundle on Frozen or Mermaid.
export const TEEN_CONSERVATORY_IDS = [1960809, 1960811];
// eslint-disable-next-line no-unused-vars -- kept for the id list's documentation value
const isTeenCon = (it) => TEEN_CONSERVATORY_IDS.includes(it.activity_id);

// Dear Evan Hansen teen intensive (Aug 2026): flat list price, sold by direct
// link days before it starts. It never bundles with anything and never feeds
// the fall-show bundle or the trio.
export const TEEN_INTENSIVE_IDS = [1805731];
// eslint-disable-next-line no-unused-vars -- kept for the id list's documentation value
const isTeenIntensive = (it) => TEEN_INTENSIVE_IDS.includes(it.activity_id);

// College audition coaching (Jul 31 2026). Sold through our own registration
// system now that the Regpack embed is gone. Ids live in a reserved block so
// the rule is a range check rather than a list that has to be kept in step
// with db/coaching-activities.sql every time CJ adds a service.
//
// Coaching is flat priced and deliberately joins none of the program math: no
// sibling, tier, bundle, or combo discount, no tuition insurance, and it is
// charged in full at checkout even when it rides along in a cart that has a
// camp on a payment plan. It is a service bought by a family, not a seat in a
// program, so there is nothing for those rules to be fair about.
export const COACHING_ID_MIN = 970000;
export const COACHING_ID_MAX = 979999;
export const isCoachingId = (id) =>
  Number.isFinite(id) && id >= COACHING_ID_MIN && id <= COACHING_ID_MAX;

// ---------------------------------------------------------------------------
// What KIND of thing an item is (Aug 17 2026 — portal authoring)
// ---------------------------------------------------------------------------
// The two rules below used to infer the kind from something that is merely
// true rather than something that is a rule: coaching from an id range, a day
// camp from costing less than $200. Both hold for every listing that exists
// today. Neither survives contact with a $250 day camp — which the staff
// portal can now create — and getting it wrong finances a one-day event over
// eight months and drops it off a family's Dependent Care FSA statement.
//
// So the LISTING answers first, and the old inference is the fallback.
// activities.offering_kind is null on all 141 rows that predate the portal, so
// those take the fallback and behave exactly as they always have.
const kindOf = (it) => it.offering_kind || null;
const isCoaching = (it) =>
  kindOf(it) ? kindOf(it) === "coaching" : isCoachingId(it.activity_id);

// A coupons row can carry a whole special deal (email_lock, pct_off_list,
// waive_plan_fee, plan_months) — one INSERT instead of a SPECIAL_PLANS edit
// and a deploy. The map above still wins when both exist. An amount on a
// special row rides as the special's credit; a plain coupon's amount is
// zeroed once a special exists, so without this the credit would vanish.
export function specialFromCouponRow(row) {
  if (!row) return null;
  const locked = Array.isArray(row.email_lock) && row.email_lock.length > 0;
  if (!row.pct_off_list && !row.waive_plan_fee && !row.plan_months && !locked) return null;
  const s = {};
  if (locked) s.email = row.email_lock;
  if (row.pct_off_list) s.pctOffList = row.pct_off_list;
  if (row.waive_plan_fee) s.waivePlanFee = true;
  if (row.plan_months) s.months = row.plan_months;
  if (row.balance_cents) s.creditCents = row.balance_cents;
  // Todd (Aug 18): a code must be restrictable to one show/product, not
  // sitewide. Items outside the scope keep their normal pricing.
  if (Array.isArray(row.scope_activity_ids) && row.scope_activity_ids.length) s.scopeActivityIds = row.scope_activity_ids;
  if (Array.isArray(row.scope_shows) && row.scope_shows.length) s.scopeShows = row.scope_shows;
  return s;
}

// Does this cart item fall inside a special's product scope? An unscoped
// special covers everything (the pre-scoping behavior).
export function specialCovers(special, it) {
  if (!special) return false;
  const scoped = (special.scopeActivityIds && special.scopeActivityIds.length) ||
                 (special.scopeShows && special.scopeShows.length);
  if (!scoped) return true;
  if (it.activity_id && (special.scopeActivityIds || []).includes(it.activity_id)) return true;
  if (it.show && (special.scopeShows || []).includes(it.show)) return true;
  return false;
}

export function perKidRate(nCampsForKid, now = new Date()) {
  if (now > new Date(EARLYBIRD_END)) return 0;
  if (nCampsForKid >= 3) return 0.20;
  if (nCampsForKid === 2) return 0.15;
  if (nCampsForKid === 1) return 0.10;
  return 0;
}

// Class bundles: per registrant per month. The bundle replaces the old
// per-class $90 + sibling math — no further stacking on classes.
// CJ, Sep 14 2026: "two classes is $150 and 3 classes is $180" (was
// $159 / $199 from Jul 31). The second class is therefore $60 more than
// one, the third $30 more than two — those two deltas are what the
// checkout dangles when a camper is in one class.
export const CLASS_BUNDLE_CENTS = [0, 9000, 15000, 18000];
export function classMonthlyCents(nClassesForKid) {
  if (nClassesForKid <= 0) return 0;
  if (nClassesForKid < CLASS_BUNDLE_CENTS.length) return CLASS_BUNDLE_CENTS[nClassesForKid];
  const top = CLASS_BUNDLE_CENTS.length - 1;
  const step = CLASS_BUNDLE_CENTS[top] - CLASS_BUNDLE_CENTS[top - 1];
  return CLASS_BUNDLE_CENTS[top] + (nClassesForKid - top) * step; // past three: 3rd-class step
}
// What one more class costs a camper already in n — the number the
// "add a second class" nudge shows. Never negative.
export function classNextDeltaCents(nClassesForKid) {
  const n = Math.max(0, nClassesForKid || 0);
  return Math.max(0, classMonthlyCents(n + 1) - classMonthlyCents(n));
}
// A camper already paying for nPrior classes adds nNew more: the new lines
// are worth what they add to the bundle, never the bundle over again.
// CJ, Sep 14 2026 ("price it separately"): the added classes become their
// own subscription at this amount — $60/mo for a second, $30/mo for a
// third — and the running subscription is left exactly as it is.
export function classAddedMonthlyCents(nPrior, nNew) {
  const p = Math.max(0, nPrior || 0), n = Math.max(0, nNew || 0);
  return Math.max(0, classMonthlyCents(p + n) - classMonthlyCents(p));
}

export function siblingActive(isBB, now = new Date()) {
  // classes/non-BB: sibling runs now; BB camps/shows: only after the sale
  return isBB ? now > new Date(EARLYBIRD_END) : true;
}

// Monthly installment timestamps: on the 1st, starting the later of
// Sep 1 2026 / the 1st of next month, ending on the last 1st that is
// >= 14 days before startISO. Max MAX_INSTALLMENTS. [] => pay in full only.
export function installmentDates(startISO, now = new Date(), forceMonths = 0) {
  const dates = [];
  let d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 4, 0, 0));
  // forceMonths (SPECIAL_PLANS): exactly N monthly firsts, no cutoffs
  if (forceMonths > 0) {
    while (dates.length < forceMonths) {
      dates.push(Math.floor(d.getTime() / 1000));
      d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 4, 0, 0));
    }
    return dates;
  }
  if (!startISO) return [];
  const start = new Date(startISO + "T00:00:00-04:00");
  const lastOk = new Date(Math.min(
    start.getTime() - PAY_FULL_CUTOFF_DAYS * 86400000, LAST_INSTALLMENT_UTC));
  while (d <= lastOk && dates.length < MAX_INSTALLMENTS) {
    dates.push(Math.floor(d.getTime() / 1000));
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 4, 0, 0));
  }
  return dates;
}

// Price a cart of one-time items (summer camps + BB shows may mix).
// items: [{show, band, camper}] and/or [{activity_id, camper, name, price_cents, start}]
// Returns per-item unit prices (discounts applied), totals, plan math.
// Kid identity: items carry `ci` (camper index in the family) so two campers
// with the same name never merge for per-kid tiers / sibling math.
export const kidKey = (it) => (it && it.ci != null ? "i" + it.ci : (it && it.camper) || "?");

export function priceCart(cart, plan, opts = {}) {
  const now = opts.now || new Date();
  const insurance = !!opts.insurance;
  // SPECIAL_PLANS adjustment: replaces coupon math entirely (the code is the
  // vehicle; its numbers live in the special, not the coupons row)
  const special = opts.special || null;
  const couponPct = special ? 0 : Math.min(100, Math.max(0, opts.couponPct || 0));
  // A special may carry a fixed credit of its own (creditCents) — e.g. a
  // retro true-up approved alongside a discount. It rides the exact same
  // rails a fixed coupon would; an ordinary coupon's amount still never
  // stacks on a special.
  const couponFixed = special
    ? Math.max(0, special.creditCents || 0)
    : Math.max(0, opts.couponFixedCents || 0);
  // Unified show tiers (CJ, Jul 31 — supersedes camp tiers, the 10% show
  // bundle, and the Jul 30 show+camp combo): every Broadway Bound show counts
  // the same, summer camp or school-year. Per registrant, through Aug 15:
  // 1 show = 10%, 2 = 15%, 3+ = 20% — on all of that kid's shows. Mean Girls
  // counts too; Teen Conservatory / DEH / day camps stay outside. Prior
  // registrations (Sawyer/Regpack/web) qualify a kid, but only cart items
  // get the price — nothing reprices retroactively.
  const priorCampsByKid = opts.priorCampsByKid || {};
  const priorShowsByKid = opts.priorShowsByKid || {};
  // Coaching before the day-camp test: several services cost less than a day
  // camp, and without this a $120 acting session would inherit the day-camp
  // sibling 5%.
  const isDayCampItem = (it) =>
    kindOf(it)
      ? kindOf(it) === "day_camp"
      : !it.show && !isCoaching(it) && (it.price_cents || 0) <= DAY_CAMP_MAX_CENTS;
  // Every Broadway Bound program counts, including the teen intensives and the
  // teen mainstage shows (CJ, Jul 31 — this supersedes the flat rules those
  // two carried through July). Day camps, classes, and coaching stay outside.
  const isCounted = (it) =>
    it.show || (!isDayCampItem(it) && !isCoaching(it) && it.activity_id !== DAY_CAMP_PACK_ID);
  const countByKid = {};
  for (const it of cart) if (isCounted(it)) {
    const k = kidKey(it);
    countByKid[k] = (countByKid[k] || 0) + 1;
  }
  for (const k of Object.keys(countByKid)) {
    countByKid[k] += (priorCampsByKid[k] || 0) + (priorShowsByKid[k] || 0);
  }
  // sibling (post-sale for BB; the tier is 0 then so no stacking)
  const kidOrder = [...new Set(cart.map(kidKey))];
  const firstKid = kidOrder[0];

  const priced = cart.map((it) => {
    // credit pack: flat $349, settled today like a day camp, outside every
    // discount (no tier, no sibling, no insurance, never financed)
    const packDef = dayCampPack(it.activity_id);
    if (packDef) {
      return { ...it, unit: packDef.cents, rate: 0, daycamp: true, pack: true };
    }
    if (it.show) {
      const kid = kidKey(it);
      const rate = perKidRate(countByKid[kid], now);
      let unit = Math.round(PRICE_CENTS * (1 - rate));
      if (rate === 0 && siblingActive(true, now) && kid !== firstKid) {
        unit = Math.round(unit * (1 - SIBLING_PCT / 100));
      }
      return { ...it, unit, rate };
    }
    // coaching: list price, full stop. `daycamp: true` is what carries the
    // "charged in full today, never insurable, never on installments" part —
    // same handling, different reason.
    if (isCoaching(it)) {
      return { ...it, unit: it.price_cents || 0, rate: 0, daycamp: true, coaching: true };
    }
    // day camp: no bundle/tier, sibling 5% for 2nd+ child (non-BB — runs now)
    if (isDayCampItem(it)) {
      let unit = it.price_cents;
      if (kidKey(it) !== firstKid) {
        unit = Math.round(unit * (1 - SIBLING_PCT / 100));
      }
      return { ...it, unit, rate: 0, daycamp: true };
    }
    // Every other Broadway Bound program — Frozen and Mermaid casts, Mean
    // Girls, the Dear Evan Hansen intensive, and the teen mainstage shows —
    // takes the same per-registrant tier. The flat rules those last two
    // carried through July are gone (CJ, Jul 31); a teen doing two mainstage
    // shows now gets 15% rather than the old 10%.
    const kid = kidKey(it);
    const rate = perKidRate(countByKid[kid], now);
    let unit = Math.round((it.price_cents || 0) * (1 - rate));
    if (rate === 0 && siblingActive(true, now) && kid !== firstKid) {
      unit = Math.round(unit * (1 - SIBLING_PCT / 100));
    }
    return { ...it, unit, rate };
  }).map((it) => {
    // special: flat pct off LIST on every camp/show IN SCOPE, REPLACING the
    // tier/bundle/trio/sibling math above — never stacking on it. Items
    // outside a scoped special keep their normal pricing.
    if (!special || !special.pctOffList || it.daycamp || !specialCovers(special, it)) return it;
    const list = it.show ? PRICE_CENTS : (it.price_cents || 0);
    const rate = special.pctOffList / 100;
    return { ...it, unit: Math.round(list * (1 - rate)), rate };
  });

  // Day Camp 5-Pack, cart form (Jason, Aug 2 evening — replaces the credit-
  // pack product UX): a camper booked into 5 day camps in ONE order pays
  // $349 flat for those 5 (per camper, packs stack). Applied by scaling the
  // camper's priciest day-camp units so every downstream number inherits it.
  // The webhook still grants 2 snow-day credits per pack bought by Sep 21 2026.
  const byKidDc = {};
  for (const it of priced) {
    if (it.daycamp && !it.coaching && !it.pack) (byKidDc[kidKey(it)] = byKidDc[kidKey(it)] || []).push(it);
  }
  const dayPacksByKid = {};
  for (const k of Object.keys(byKidDc)) {
    const arr = byKidDc[k];
    const packs = Math.floor(arr.length / DAY_CAMP_PACK_SIZE);
    if (!packs) continue;
    dayPacksByKid[k] = packs;
    arr.sort((a, b) => b.unit - a.unit);
    const packed = arr.slice(0, packs * DAY_CAMP_PACK_SIZE);
    const target = packs * DAY_CAMP_PACK_CENTS;
    const packedSum = packed.reduce((sum, it) => sum + it.unit, 0);
    let acc = 0;
    packed.forEach((it, i) => {
      const u = (i === packed.length - 1) ? target - acc : Math.round(it.unit * target / packedSum);
      acc += u; it.unit = u; it.pack = true;
    });
  }

  // Credit redemption: a camper's day credits zero out their day-camp lines
  // (snow-day events pull from snow credits instead). Priciest lines redeem
  // first so a credit never burns on a sibling-discounted price while a
  // full-price line pays cash. opts.creditsByKid = { kidKey: {day, snow} }
  // comes from the DB in reg-pay; the webhook deducts on payment.
  const creditsByKid = opts.creditsByKid || {};
  const creditsUsed = {};
  const redeemable = priced.filter((it) => it.daycamp && !it.coaching && !it.pack)
    .sort((a, b) => b.unit - a.unit);
  for (const it of redeemable) {
    const k = kidKey(it);
    const bal = creditsByKid[k];
    if (!bal) continue;
    const kind = isSnowDayName(it.name) ? "snow" : "day";
    const used = creditsUsed[k] || (creditsUsed[k] = { day: 0, snow: 0 });
    if ((bal[kind] || 0) - used[kind] > 0) {
      used[kind] += 1;
      it.unit = 0;
      it.credited = true;
    }
  }

  const grossSubtotal = priced.reduce((s, it) => s + it.unit, 0);
  const couponCents = couponPct
    ? Math.round(grossSubtotal * couponPct / 100)
    : Math.min(couponFixed, grossSubtotal);
  const subtotal = grossSubtotal - couponCents;
  const couponFactor = grossSubtotal > 0 ? subtotal / grossSubtotal : 1;
  // insurance covers camps/shows only (day camps excluded) and is ALWAYS
  // 10% of the LIST price — discounts and coupons never shrink it
  const listInsurableCents = priced.reduce(
    (s, it) => s + (it.daycamp ? 0 : (it.show ? PRICE_CENTS : (it.price_cents || 0))), 0);
  // percent coupons cover insurance too (a 100% code means a $0 order)
  const insuranceCents = insurance
    ? Math.round(listInsurableCents * INSURANCE_PCT / 100 * (1 - couponPct / 100)) : 0;
  const totalCents = subtotal + insuranceCents;

  // earliest start in cart governs the installment window
  const starts = cart.map((it) => it.show ? CAMP_START[it.show] : (it.start || showStartFor(it.name || "")))
    .filter(Boolean).sort();
  const fixed = (special && special.months) ? null : fixedPlanDates(cart.map((it) => it.activity_id), now);
  const schedule = fixed || installmentDates(starts[0], now, (special && special.months) || 0);
  const payFullOnly = schedule.length === 0;

  if (plan === "full" || payFullOnly) {
    return {
      items: priced, creditsUsed, dayPacksByKid, subtotal, couponCents, insuranceCents, totalCents,
      planFeeCents: 0,
      todayCents: totalCents, installmentCents: 0, installmentDatesUTC: [],
      payFullOnly, plan: "full",
    };
  }
  // day camps are cheap one-offs: charged in full today, never spread over installments
  const dayCampCents = priced.reduce((s, it) => s + (it.daycamp ? it.unit : 0), 0);
  const planFeeCents = (special && special.waivePlanFee)
    ? 0 : Math.round(subtotal * PLAN_FEE_PCT / 100);

  if (special) {
    // SPECIAL_PLANS carts keep the legacy $180-per-item deposit shape — the
    // families holding these codes were quoted exact numbers in writing
    const planCount = priced.filter((it) => !it.daycamp).length;
    const depositCents = Math.min(DEPOSIT_PER_ITEM_CENTS * planCount + dayCampCents, subtotal);
    const remainder = subtotal - depositCents;
    if (remainder <= 0) {
      return {
        items: priced, creditsUsed, dayPacksByKid, subtotal, couponCents, insuranceCents, totalCents,
        planFeeCents: 0,
        todayCents: totalCents, installmentCents: 0, installmentDatesUTC: [],
        payFullOnly: false, plan: "full",
      };
    }
    return {
      items: priced, creditsUsed, dayPacksByKid, subtotal, couponCents, insuranceCents,
      totalCents: totalCents + planFeeCents, planFeeCents,
      todayCents: depositCents + insuranceCents,
      installmentCents: Math.max(0, Math.ceil((remainder + planFeeCents) / schedule.length)),
      installmentDatesUTC: schedule,
      payFullOnly: false, plan: "deposit",
    };
  }

  // Even split (Jason + CJ, Aug 1): the financed balance (everything except
  // day camps, plus the plan fee) divides into schedule+1 EQUAL payments —
  // the first at checkout instead of a stacked $180-per-item deposit. Insurance
  // and day camps still settle today. Rounding lands on the first payment.
  const financeable = subtotal - dayCampCents + planFeeCents;
  const payments = schedule.length + 1;
  const installmentCents = Math.floor(financeable / payments);
  const todayShare = financeable - installmentCents * schedule.length;
  if (installmentCents <= 0) {
    // tiny balance (deep coupon) — just collect it all today, no fee
    return {
      items: priced, creditsUsed, dayPacksByKid, subtotal, couponCents, insuranceCents, totalCents,
      planFeeCents: 0,
      todayCents: totalCents, installmentCents: 0, installmentDatesUTC: [],
      payFullOnly: false, plan: "full",
    };
  }
  return {
    items: priced, creditsUsed, dayPacksByKid, subtotal, couponCents, insuranceCents,
    totalCents: totalCents + planFeeCents, planFeeCents,
    todayCents: todayShare + insuranceCents + dayCampCents,
    installmentCents, installmentDatesUTC: schedule,
    payFullOnly: false, plan: "deposit",
  };
}
