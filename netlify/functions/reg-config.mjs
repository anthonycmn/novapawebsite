// Shared pricing + window config for the NOVAPA registration flow.
// Single source of truth for money math — the client only displays numbers,
// reg-pay.mjs recomputes everything server-side.
//
// Pricing rules (CJ, Jul 20 2026):
//  - No family fee.
//  - Summer tiers are PER KID: 1 camp 10% / 2 camps 15% / 3 camps 20%,
//    summer camps only, through the launch sale (EARLYBIRD_END).
//  - Frozen + Little Mermaid: 10% off both when one kid bundles both;
//    10% off either when bundled with a summer camp (camps keep their tier).
//  - Sibling 5%: non-BB items (classes) immediately; BB camps/shows only
//    after the launch sale ends. Never stacks with tier/bundle discounts.
//  - Deposit plans: $180/item today, monthly installments on the 1st,
//    last installment no later than 14 days before the item's start date.
//    Within 14 days of start: pay-in-full only.
//  - Classes: $90/mo, first month at checkout, next pull Oct 1, monthly
//    through Jun 1 2027 (subscription auto-cancels Jul 1 2027).
//    Cancellation: 30 days notice (policy-enforced, not code).
//  - Tuition insurance (opt-in, camps & shows only — NOT classes): +10% of
//    the discounted subtotal, collected at checkout. Coverage per
//    /policies#tuition-insurance: refund 100% at 90-76 days before start,
//    75% at 75-51d, 50% at 50-31d, 0% within 30d; premium non-refundable.
//  - All sales final — no refunds (insurance is the exception path).
//  - Day camps ($70 one-day events, price <= DAY_CAMP_MAX_CENTS): pay-in-full
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

export const CLASS_PRICE_CENTS = 9000;
export const CLASS_BILL_ANCHOR_UTC = Date.UTC(2026, 9, 1, 4, 0, 0) / 1000;  // Oct 1 2026
export const CLASS_SEASON_END_UTC = Date.UTC(2027, 6, 1, 4, 0, 0) / 1000;   // Jul 1 2027 (last pull Jun 1)
export const SIBLING_PCT = 5;
export const INSURANCE_PCT = 10;
// Items at or under this price are "day camps" ($70 one-day events):
// pay-in-full only, no bundle/tier discounts, no insurance, sibling 5% now.
export const DAY_CAMP_MAX_CENTS = 20000;

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
export function showStartFor(name) {
  if (/frozen/i.test(name)) return "2026-09-15";
  if (/mermaid/i.test(name)) return "2027-02-03";
  return null;
}

export function perKidRate(nCampsForKid, now = new Date()) {
  if (now > new Date(EARLYBIRD_END)) return 0;
  if (nCampsForKid >= 3) return 0.20;
  if (nCampsForKid === 2) return 0.15;
  if (nCampsForKid === 1) return 0.10;
  return 0;
}

export function siblingActive(isBB, now = new Date()) {
  // classes/non-BB: sibling runs now; BB camps/shows: only after the sale
  return isBB ? now > new Date(EARLYBIRD_END) : true;
}

// Monthly installment timestamps: on the 1st, starting the later of
// Sep 1 2026 / the 1st of next month, ending on the last 1st that is
// >= 14 days before startISO. Max MAX_INSTALLMENTS. [] => pay in full only.
export function installmentDates(startISO, now = new Date()) {
  if (!startISO) return [];
  const start = new Date(startISO + "T00:00:00-04:00");
  const lastOk = new Date(start.getTime() - PAY_FULL_CUTOFF_DAYS * 86400000);
  const dates = [];
  let d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 4, 0, 0));
  while (d <= lastOk && dates.length < MAX_INSTALLMENTS) {
    dates.push(Math.floor(d.getTime() / 1000));
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 4, 0, 0));
  }
  return dates;
}

// Price a cart of one-time items (summer camps + BB shows may mix).
// items: [{show, band, camper}] and/or [{activity_id, camper, name, price_cents, start}]
// Returns per-item unit prices (discounts applied), totals, plan math.
export function priceCart(cart, plan, opts = {}) {
  const now = opts.now || new Date();
  const insurance = !!opts.insurance;
  const couponPct = Math.min(100, Math.max(0, opts.couponPct || 0));
  const campsByKid = {};
  for (const it of cart) if (it.show) {
    const k = it.camper || "?";
    campsByKid[k] = (campsByKid[k] || 0) + 1;
  }
  const kidsWithSummer = new Set(Object.keys(campsByKid));
  const isDayCampItem = (it) => !it.show && (it.price_cents || 0) <= DAY_CAMP_MAX_CENTS;
  const showsByKid = {};
  for (const it of cart) if (!it.show && !isDayCampItem(it)) {
    const k = it.camper || "?";
    (showsByKid[k] = showsByKid[k] || []).push(it);
  }
  // sibling (post-sale for BB; the tier is 0 then so no stacking)
  const kidOrder = [...new Set(cart.map((it) => it.camper || "?"))];
  const firstKid = kidOrder[0];

  const priced = cart.map((it) => {
    if (it.show) {
      const rate = perKidRate(campsByKid[it.camper || "?"], now);
      let unit = Math.round(PRICE_CENTS * (1 - rate));
      if (rate === 0 && siblingActive(true, now) && (it.camper || "?") !== firstKid) {
        unit = Math.round(unit * (1 - SIBLING_PCT / 100));
      }
      return { ...it, unit, rate };
    }
    // day camp: no bundle/tier, sibling 5% for 2nd+ child (non-BB — runs now)
    if (isDayCampItem(it)) {
      let unit = it.price_cents;
      if ((it.camper || "?") !== firstKid) {
        unit = Math.round(unit * (1 - SIBLING_PCT / 100));
      }
      return { ...it, unit, rate: 0, daycamp: true };
    }
    // BB show item (frozen/mermaid)
    const kid = it.camper || "?";
    const kidShows = showsByKid[kid] || [];
    const bundled = kidShows.length >= 2 || kidsWithSummer.has(kid);
    let unit = it.price_cents;
    let rate = 0;
    if (bundled) { rate = 0.10; unit = Math.round(unit * 0.9); }
    else if (siblingActive(true, now) && kid !== firstKid) {
      unit = Math.round(unit * (1 - SIBLING_PCT / 100));
    }
    return { ...it, unit, rate };
  });

  const grossSubtotal = priced.reduce((s, it) => s + it.unit, 0);
  const couponCents = couponPct ? Math.round(grossSubtotal * couponPct / 100) : 0;
  const subtotal = grossSubtotal - couponCents;
  // insurance covers camps/shows only — day camps excluded; coupon factor applies
  const insurableCents = priced.reduce((s, it) => s + (it.daycamp ? 0 : it.unit), 0);
  const insuranceCents = insurance
    ? Math.round(insurableCents * (1 - couponPct / 100) * INSURANCE_PCT / 100) : 0;
  const totalCents = subtotal + insuranceCents;

  // earliest start in cart governs the installment window
  const starts = cart.map((it) => it.show ? CAMP_START[it.show] : (it.start || showStartFor(it.name || "")))
    .filter(Boolean).sort();
  const schedule = installmentDates(starts[0], now);
  const payFullOnly = schedule.length === 0;

  if (plan === "full" || payFullOnly) {
    return {
      items: priced, subtotal, couponCents, insuranceCents, totalCents,
      todayCents: totalCents, installmentCents: 0, installmentDatesUTC: [],
      payFullOnly, plan: "full",
    };
  }
  // day camps are cheap one-offs: charged in full today, never spread over installments
  const dayCampCents = priced.reduce((s, it) => s + (it.daycamp ? it.unit : 0), 0);
  const planCount = priced.filter((it) => !it.daycamp).length;
  const factor = 1 - couponPct / 100;
  const depositCents = Math.min(
    Math.round((DEPOSIT_PER_ITEM_CENTS * planCount + dayCampCents) * (couponPct ? factor : 1)),
    subtotal);
  const remainder = subtotal - depositCents;
  if (remainder <= 0) {
    // coupon shrank the balance below the deposit — collect it all today
    return {
      items: priced, subtotal, couponCents, insuranceCents, totalCents,
      todayCents: totalCents, installmentCents: 0, installmentDatesUTC: [],
      payFullOnly: false, plan: "full",
    };
  }
  const todayCents = depositCents + insuranceCents;
  const installmentCents = Math.max(0, Math.ceil(remainder / schedule.length));
  return {
    items: priced, subtotal, couponCents, insuranceCents, totalCents,
    todayCents, installmentCents, installmentDatesUTC: schedule,
    payFullOnly: false, plan: "deposit",
  };
}
