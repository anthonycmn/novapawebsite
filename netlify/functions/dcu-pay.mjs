// POST /api/dcu-pay — guest checkout for DC Unifieds (dcunifieds.com).
//
// Why this exists instead of routing DC Unifieds through /register:
// a DC Unifieds buyer is a senior's parent making one purchase who will never
// log in again. The camp register app is account-first — magic link, family,
// campers — and Supabase allows exactly ONE auth email template per project,
// so a magic link sent from a dcunifieds.com checkout necessarily arrives
// branded NOVAPA. Dropping sign-in removes both the friction and the brand
// leak; there is no account to lose because there was never an account.
//
// Everything downstream is deliberately shared: same Stripe account, same
// `activities` rows, same holds -> confirm_order -> reg-webhook chain, so the
// order shows up in the admin dashboard and the books like any other sale.
// What is NOT shared is camp money math: reg-config's priceCart is not
// imported. Coaching-range items carry no tiers, bundles, sibling discounts,
// insurance, coupons or credits, so pricing here is a plain split — and no
// edit to this file can move a camp price.
import Stripe from "stripe";
import { SUPABASE_URL } from "./reg-config.mjs";

// DC Unifieds occupies 9706xx inside the coaching block (db/dc-unifieds-activities.sql).
const DCU_MIN = 970600, DCU_MAX = 970699;

// Every track must be paid in full before it runs ("all installments must be
// paid in full prior to the event" — dcunifieds.com terms). The earliest track
// starts Oct 15 2026, so Oct 1 is the last billable installment date for all
// three; using one cutoff keeps the promise true whichever track they buy.
const LAST_INSTALLMENT_UTC = Date.UTC(2026, 9, 1, 4, 0, 0); // Oct 1 2026, midnight ET

const HOLD_MINUTES = 30;

function svcHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

async function serviceRpc(fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: svcHeaders(), body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`rpc ${fn} failed ${res.status}`);
  const t = await res.text();
  try { return JSON.parse(t); } catch { return t; }
}

// Billing dates are the 1st of each month, midnight ET, through the cutoff.
// Buying in August yields Sep 1 + Oct 1; buying in September yields Oct 1
// alone; buying in October yields none and the plan is simply not offered.
export function installmentDatesUTC(now = new Date()) {
  const out = [];
  const y = now.getUTCFullYear(), mo = now.getUTCMonth();
  for (let i = 1; i <= 12; i++) {
    const t = Date.UTC(y, mo + i, 1, 4, 0, 0);
    if (t > LAST_INSTALLMENT_UTC) break;
    if (t > now.getTime()) out.push(Math.floor(t / 1000));
  }
  return out;
}

// Deposit today + n equal installments. The remainder rides on today's charge
// so the scheduled pulls are identical and the arithmetic closes exactly.
export function splitPrice(totalCents, plan, dates) {
  if (plan !== "deposit" || !dates.length) {
    return { todayCents: totalCents, installmentCents: 0, n: 0, first: 0 };
  }
  const n = dates.length;
  const inst = Math.floor(totalCents / (n + 1));
  return { todayCents: totalCents - inst * n, installmentCents: inst, n, first: dates[0] };
}

const clean = (v, max) => String(v == null ? "" : v).trim().slice(0, max);

async function activityById(activityId) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/activities?id=eq.${activityId}&select=id,name,price_cents,capacity,sold,bookable,hidden`,
    { headers: svcHeaders() });
  const rows = r.ok ? await r.json() : [];
  return rows[0] || null;
}

// GET /api/dcu-pay?activity_id=970601 — what a track costs and which plans it
// can offer today. The checkout page renders from this rather than repeating
// prices in markup, so the activities row stays the single source of truth.
// --- Coupons (added Aug 27 2026, CJ: parents had nowhere to enter a code) ---
// Deliberately strict: a code only works here if its coupons row is scoped to
// this DC Unifieds activity (scope_activity_ids). An unscoped or camp-scoped
// NOVAPA code must never discount a DCU track, so a broad camp promo cannot
// leak into this checkout. Percent and fixed-amount are both supported; the
// discount can never take an order below zero.
async function dcuCoupon(code, activityId, email) {
  const c = await serviceRpc("check_coupon", { p_code: code });
  if (!c) return { error: "bad_coupon" };
  let row = null;
  try {
    row = (await (await fetch(
      `${SUPABASE_URL}/rest/v1/coupons?code=ilike.${encodeURIComponent(code)}&select=email_lock,scope_activity_ids&limit=1`,
      { headers: svcHeaders() })).json())?.[0] || null;
  } catch (e) { console.error("dcu coupon row lookup", e.message); return { error: "bad_coupon" }; }
  const scope = row?.scope_activity_ids;
  if (!Array.isArray(scope) || !scope.map(Number).includes(Number(activityId))) {
    return { error: "coupon_not_for_this" };
  }
  if (row?.email_lock) {
    const locks = (Array.isArray(row.email_lock) ? row.email_lock : [row.email_lock])
      .map((e) => String(e).toLowerCase());
    if (!locks.includes(email)) return { error: "coupon_not_yours" };
  }
  const pct = Number(c.pct) || 0;
  const amt = Number(c.amount_cents) || 0;
  if (!pct && !amt) return { error: "bad_coupon" };
  return { pct, amountCents: amt, code: c.code || code };
}

async function quote(req) {
  const url = new URL(req.url);
  const activityId = parseInt(url.searchParams.get("activity_id"), 10);
  const qCoupon = clean(url.searchParams.get("coupon") || "", 40);
  const qEmail = clean(url.searchParams.get("email") || "", 200).toLowerCase();
  if (!activityId || activityId < DCU_MIN || activityId > DCU_MAX) {
    return Response.json({ error: "unknown_activity" }, { status: 400 });
  }
  const act = await activityById(activityId);
  if (!act) return Response.json({ error: "unknown_activity" }, { status: 400 });

  let held = 0;
  try { held = (await serviceRpc("held_count_activity", { p_activity_id: activityId })) || 0; }
  catch { /* a stale seat count must not block the page from rendering */ }
  const soldOut = act.capacity != null && (act.sold || 0) + held >= act.capacity;

  const dates = installmentDatesUTC();
  const listCents = act.price_cents || 0;
  // Preview a code before payment. The same validation runs again on POST, so
  // the preview can never be the thing that decides what is charged.
  let couponCents = 0, couponError = null, couponCode = "";
  if (qCoupon) {
    const cp = await dcuCoupon(qCoupon, activityId, qEmail);
    if (cp.error) couponError = cp.error;
    else {
      couponCents = cp.pct
        ? Math.round(listCents * Math.min(100, cp.pct) / 100)
        : Math.min(cp.amountCents, listCents);
      couponCode = cp.code;
    }
  }
  const total = Math.max(0, listCents - couponCents);
  const dep = splitPrice(total, "deposit", dates);
  return Response.json({
    activity_id: act.id,
    name: act.name,
    list_cents: listCents,
    coupon: couponCode,
    coupon_cents: couponCents,
    coupon_error: couponError,
    total_cents: total,
    available: !!act.bookable && !act.hidden && !soldOut,
    plans: {
      full: { today_cents: total },
      // Offered only while a full schedule can still complete before the event.
      deposit: dates.length
        ? { today_cents: dep.todayCents, installment_cents: dep.installmentCents,
            n_installments: dep.n, installment_dates: dates }
        : null,
    },
  });
}

export default async (req) => {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: "payments_not_configured" }, { status: 503 });
  }
  if (req.method === "GET") return quote(req);
  if (req.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  if (!process.env.STRIPE_SECRET_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: "payments_not_configured" }, { status: 503 });
  }

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "bad_json" }, { status: 400 }); }

  const activityId = parseInt(body.activity_id, 10);
  const plan = body.plan === "deposit" ? "deposit" : "full";
  const email = clean(body.email, 200).toLowerCase();
  const parentName = clean(body.parent_name, 100);
  const studentName = clean(body.student_name, 100);
  const phone = clean(body.phone, 40);
  const couponCode = clean(body.coupon, 40);

  if (!activityId || activityId < DCU_MIN || activityId > DCU_MAX) {
    return Response.json({ error: "unknown_activity" }, { status: 400 });
  }
  if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
    return Response.json({ error: "bad_email" }, { status: 400 });
  }
  if (!studentName || !parentName) {
    return Response.json({ error: "missing_name" }, { status: 400 });
  }

  // The activities row is the price of record, so an admin price change in the
  // dashboard takes effect here with no deploy.
  const act = await activityById(activityId);
  if (!act) return Response.json({ error: "unknown_activity" }, { status: 400 });
  if (!act.bookable || act.hidden) return Response.json({ error: "not_for_sale" }, { status: 409 });

  let held = 0;
  try { held = (await serviceRpc("held_count_activity", { p_activity_id: activityId })) || 0; }
  catch (e) { console.error("held count failed:", e.message); }
  if (act.capacity != null && (act.sold || 0) + held >= act.capacity) {
    return Response.json({ error: "sold_out" }, { status: 409 });
  }

  const listCents = act.price_cents || 0;
  if (listCents < 50) return Response.json({ error: "bad_price" }, { status: 500 });

  // Validated server-side; a bad code is a hard error so the page can never
  // show a discount and then quietly charge full price.
  let couponCents = 0, couponApplied = "";
  if (couponCode) {
    const cp = await dcuCoupon(couponCode, activityId, email);
    if (cp.error) return Response.json({ error: cp.error }, { status: 400 });
    couponCents = cp.pct
      ? Math.round(listCents * Math.min(100, cp.pct) / 100)
      : Math.min(cp.amountCents, listCents);
    couponApplied = cp.code;
  }
  const totalCents = Math.max(0, listCents - couponCents);
  if (totalCents < 50) return Response.json({ error: "coupon_too_large" }, { status: 400 });

  const dates = installmentDatesUTC();
  if (plan === "deposit" && !dates.length) {
    // Past the last billable date — the site may still advertise plans, so say
    // why rather than silently charging the full amount.
    return Response.json({ error: "plan_unavailable" }, { status: 409 });
  }
  const price = splitPrice(totalCents, plan, dates);

  // Hold the seat. confirm_order (called by reg-webhook on payment success)
  // reads this row, so the item shape must match what the camp flow writes.
  const holdRes = await fetch(`${SUPABASE_URL}/rest/v1/holds`, {
    method: "POST",
    headers: { ...svcHeaders(), Prefer: "return=representation" },
    body: JSON.stringify({
      email,
      items: [{ activity_id: activityId, camper: studentName }],
      expires_at: new Date(Date.now() + HOLD_MINUTES * 60 * 1000).toISOString(),
      status: "active",
    }),
  });
  if (!holdRes.ok) {
    console.error("hold insert failed:", await holdRes.text());
    return Response.json({ error: "hold_failed" }, { status: 500 });
  }
  const hold = (await holdRes.json())[0];

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const customer = await stripe.customers.create({
    email, name: parentName || undefined, phone: phone || undefined,
    metadata: { source: "dcunifieds", student_name: studentName },
  });

  const pi = await stripe.paymentIntents.create({
    amount: price.todayCents,
    currency: "usd",
    customer: customer.id,
    // A deposit plan charges the balance off-session on the 1st, so the card
    // has to be saved now — same rule as the camp deposit plans.
    setup_future_usage: plan === "deposit" ? "off_session" : undefined,
    payment_method_types: ["card", "link"],
    description: `DC Unifieds 2026 — ${plan === "deposit" ? "first payment" : "paid in full"}`,
    statement_descriptor_suffix: "DCUNIFIEDS",
    // No receipt_email on purpose: Stripe's automatic receipt is branded with
    // the Stripe account's business name (NOVAPA), which would undo the point
    // of this whole path. Our own confirmation carries the payment detail.
    metadata: {
      // --- contract read by reg-webhook.mjs; names must match reg-pay.mjs ---
      hold_id: hold.id,
      plan,
      email,
      parent_name: parentName,
      total_cents: String(totalCents),
      installment_cents: String(price.installmentCents),
      n_installments: String(price.n),
      first_installment_utc: String(price.first),
      insurance_cents: "0",
      insured: "0",
      coupon: couponApplied,
      coupon_cents: String(couponCents),
      plan_fee_cents: "0",
      fsa_eligible: "0", // college audition coaching is not dependent care
      unit_prices: JSON.stringify([totalCents]),
      monthly_items: "[]",
      n_items: "1",
      order_desc: `${studentName} — ${act.name}`.slice(0, 480),
      credit_grants: "[]",
      credit_redeems: "[]",
      // --- DC Unifieds additions ---
      brand: "dcu",
      activity_id: String(activityId),
      student_name: studentName,
      phone,
    },
  });

  return Response.json({
    client_secret: pi.client_secret,
    hold_id: hold.id,
    pricing: {
      name: act.name,
      total_cents: totalCents,
      today_cents: price.todayCents,
      installment_cents: price.installmentCents,
      n_installments: price.n,
      first_installment_utc: price.first,
      installment_dates: dates,
    },
  });
};

export const config = { path: "/api/dcu-pay" };
