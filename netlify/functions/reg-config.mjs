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
//  - Classes (CJ, Jul 31 bundles): PER REGISTRANT 1 class $90/mo, 2 classes
//    $159/mo, 3 classes $199/mo (each past three +$40). No sibling stacking
//    on classes — the bundle IS the discount. First month at checkout, next
//    pull Oct 1, monthly through Jun 1 2027 (auto-cancels Jul 1 2027).
//    Cancellation: 30 days notice (policy-enforced, not code).
//  - Class + show cross-sell (CJ, Jul 31): a family with ANY 2026-27 show or
//    camp registration (web order or Sawyer import) pays $0 today on a class
//    checkout — first month free; billing simply starts Oct 1. Card is
//    collected via SetupIntent instead of a charge.
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
export const CLASS_SEASON_END_UTC = Date.UTC(2027, 6, 1, 4, 0, 0) / 1000;   // Jul 1 2027 (last pull Jun 1)
export const SIBLING_PCT = 5;
export const INSURANCE_PCT = 10;
export const PLAN_FEE_PCT = 5;   // surcharge for choosing a payment plan
// Items at or under this price are "day camps" ($79 one-day events):
// pay-in-full only, no bundle/tier discounts, no insurance, sibling 5% now.
export const DAY_CAMP_MAX_CENTS = 20000;
// Day Camp Credit Pack (the product /day-camps has advertised; CJ priced it
// Aug 2 2026): $349 buys ONE CAMPER 5 day-camp credits, good through Jun 30
// 2027, credits never shared between siblings. Bought by Labor Day, the pack
// adds 2 free Snow Day credits for that camper. Credits auto-redeem at
// checkout: a day camp for a camper with a day credit prices at $0 (snow-day
// events consume snow credits instead). The webhook grants/deducts via
// apply_credit_events, keyed by payment intent so retries are no-ops.
export const DAY_CAMP_PACK_ID = 990010;
export const DAY_CAMP_PACK_SIZE = 5;
export const DAY_CAMP_PACK_CENTS = 34900;
export const DAY_CAMP_PACK_CREDITS = 5;
export const DAY_CAMP_PACK_SNOW_BONUS = 2;
export const DAY_CAMP_PACK_SNOW_END = new Date("2026-09-08T03:59:59Z"); // end of Labor Day ET
export const isSnowDayName = (name) => /snow day/i.test(name || "");

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
const isCoaching = (it) => isCoachingId(it.activity_id);

export function perKidRate(nCampsForKid, now = new Date()) {
  if (now > new Date(EARLYBIRD_END)) return 0;
  if (nCampsForKid >= 3) return 0.20;
  if (nCampsForKid === 2) return 0.15;
  if (nCampsForKid === 1) return 0.10;
  return 0;
}

// Class bundles (CJ, Jul 31): per registrant per month. The bundle replaces
// the old per-class $90 + sibling math — no further stacking on classes.
export function classMonthlyCents(nClassesForKid) {
  if (nClassesForKid <= 0) return 0;
  if (nClassesForKid === 1) return 9000;
  if (nClassesForKid === 2) return 15900;
  return 19900 + (nClassesForKid - 3) * 4000; // past three: 3rd-class step
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
  const couponFixed = special ? 0 : Math.max(0, opts.couponFixedCents || 0);
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
    !it.show && !isCoaching(it) && (it.price_cents || 0) <= DAY_CAMP_MAX_CENTS;
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
    if (it.activity_id === DAY_CAMP_PACK_ID) {
      return { ...it, unit: DAY_CAMP_PACK_CENTS, rate: 0, daycamp: true, pack: true };
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
    // special: flat pct off LIST on every camp/show, REPLACING the
    // tier/bundle/trio/sibling math above — never stacking on it
    if (!special || !special.pctOffList || it.daycamp) return it;
    const list = it.show ? PRICE_CENTS : (it.price_cents || 0);
    const rate = special.pctOffList / 100;
    return { ...it, unit: Math.round(list * (1 - rate)), rate };
  });

  // Day Camp 5-Pack, cart form (Jason, Aug 2 evening — replaces the credit-
  // pack product UX): a camper booked into 5 day camps in ONE order pays
  // $349 flat for those 5 (per camper, packs stack). Applied by scaling the
  // camper's priciest day-camp units so every downstream number inherits it.
  // The webhook still grants 2 snow-day credits per pack bought by Labor Day.
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
  const schedule = installmentDates(starts[0], now, (special && special.months) || 0);
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
