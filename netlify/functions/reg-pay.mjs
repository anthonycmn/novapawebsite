// POST /api/reg-pay — create a Stripe PaymentIntent for an active hold.
// Body: { hold_id, plan: "deposit"|"full"|"subscription", parent_name, insurance }
// Auth: Authorization: Bearer <supabase user JWT>
// Pricing is computed here — client math is display-only.
//
// Cart kinds:
//  - one-time items: summer camps {show, band, camper} and BB shows
//    {activity_id, camper} may MIX in one cart (per-kid tiers, bundle 10%,
//    deposit plans w/ installments ending 2 weeks before earliest start)
//  - classes {activity_id, camper}: must be alone, plan=subscription
//    ($90/mo, 5% sibling for 2nd+ child, insurance = monthly x1.10)
import Stripe from "stripe";
import {
  SUPABASE_URL, SUPABASE_ANON_KEY, SHOWS, priceCart,
  CLASS_PRICE_CENTS, SIBLING_PCT, INSURANCE_PCT, DAY_CAMP_MAX_CENTS, showStartFor,
} from "./reg-config.mjs";

async function anonRpc(fn, args, jwt) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${jwt || SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) return null;
  return res.json();
}

export default async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return Response.json({ error: "payments_not_configured" }, { status: 503 });
  }

  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "bad_json" }, { status: 400 }); }
  const { hold_id, plan, parent_name } = body || {};
  const insurance = !!(body || {}).insurance;
  const couponCode = String((body || {}).coupon || "").trim();
  if (!hold_id || !["deposit", "full", "subscription"].includes(plan)) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}` },
  });
  if (!userRes.ok) return Response.json({ error: "unauthorized" }, { status: 401 });
  const user = await userRes.json();
  const email = (user.email || "").toLowerCase();
  if (!email) return Response.json({ error: "unauthorized" }, { status: 401 });

  const hold = await anonRpc("get_my_hold", { p_hold_id: hold_id }, jwt);
  if (!hold || !hold.items) return Response.json({ error: "hold_not_found" }, { status: 404 });
  if (hold.status !== "active" || new Date(hold.expires_at) < new Date()) {
    return Response.json({ error: "hold_expired" }, { status: 409 });
  }

  // coupon: validated server-side; invalid codes are a hard error so the
  // client never silently charges full price after showing a discount
  let couponPct = 0, couponFixedCents = 0;
  if (couponCode) {
    const c = await anonRpc("check_coupon", { p_code: couponCode });
    if (!c || (!c.pct && !c.amount_cents)) return Response.json({ error: "bad_coupon" }, { status: 400 });
    couponPct = c.pct || 0;
    couponFixedCents = c.amount_cents || 0;
  }

  const items = hold.items;
  const summerItems = items.filter((it) => it.show);
  const activityItems = items.filter((it) => it.activity_id);

  // resolve activity items
  let byId = {};
  if (activityItems.length) {
    const ids = [...new Set(activityItems.map((it) => it.activity_id))];
    const acts = await anonRpc("activity_prices", { p_ids: ids });
    if (!acts || acts.length !== ids.length) {
      return Response.json({ error: "unknown_activity" }, { status: 400 });
    }
    byId = Object.fromEntries(acts.map((a) => [a.id, a]));
  }
  const classItems = activityItems.filter((it) => byId[it.activity_id].category === "class");
  const showItems = activityItems.filter((it) => byId[it.activity_id].category !== "class");
  if (classItems.length && (summerItems.length || showItems.length)) {
    return Response.json({ error: "mixed_cart" }, { status: 400 });
  }

  let pricing;         // normalized for metadata + UI
  let description;

  if (classItems.length) {
    if (plan !== "subscription") return Response.json({ error: "bad_plan" }, { status: 400 });
    const kk = (it) => (it && it.ci != null ? "i" + it.ci : (it && it.camper) || "");
    const firstChild = kk(classItems[0] || {});
    const unitPrices = classItems.map((it) => {
      let base = CLASS_PRICE_CENTS;
      if (kk(it) && kk(it) !== firstChild) {
        base = Math.round(base * (1 - SIBLING_PCT / 100)); // sibling runs now (non-BB)
      }
      // no insurance on classes — 30-day cancellation makes it pointless
      return base;
    });
    const subtotal = unitPrices.reduce((s, v) => s + v, 0);
    const couponCents = couponPct ? Math.round(subtotal * couponPct / 100) : Math.min(couponFixedCents, subtotal);
    pricing = {
      todayCents: subtotal - couponCents, totalCents: subtotal - couponCents,
      subtotalCents: subtotal, couponCents,
      insuranceCents: 0, // built into the monthly price for classes
      installmentCents: 0, nInstallments: 0, firstInstallmentUTC: 0,
      unitPrices, monthlyItems: unitPrices, discountPct: 0,
    };
    description = classItems
      .map((it) => `${it.camper || "Camper"} — ${byId[it.activity_id].name}`)
      .join("; ");
  } else {
    if (plan === "subscription") return Response.json({ error: "bad_plan" }, { status: 400 });
    const cart = [
      ...summerItems,
      ...showItems.map((it) => ({
        ...it,
        name: byId[it.activity_id].name,
        price_cents: byId[it.activity_id].price_cents,
        start: showStartFor(byId[it.activity_id].name),
      })),
    ];
    const p = priceCart(cart, plan, { insurance, couponPct, couponFixedCents });
    if (plan === "deposit" && p.payFullOnly) {
      return Response.json({ error: "pay_full_only" }, { status: 400 });
    }
    pricing = {
      todayCents: p.todayCents, totalCents: p.totalCents, subtotalCents: p.subtotal,
      couponCents: p.couponCents || 0,
      planFeeCents: p.planFeeCents || 0,
      insuranceCents: p.insuranceCents,
      installmentCents: p.installmentCents,
      nInstallments: p.installmentDatesUTC.length,
      firstInstallmentUTC: p.installmentDatesUTC[0] || 0,
      unitPrices: p.items.map((it) => it.unit),
      monthlyItems: [],
      discountPct: Math.round(Math.max(...p.items.map((it) => it.rate), 0) * 100),
    };
    description = cart
      .map((it) => it.show
        ? `${it.camper || "Camper"} — ${SHOWS[it.show] || it.show} (${it.band})`
        : `${it.camper || "Camper"} — ${it.name}`)
      .join("; ");
  }

  if (pricing.todayCents < 50) {
    return Response.json({ error: "coupon_too_small" }, { status: 400 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const customer = await stripe.customers.create({
    email, name: parent_name || undefined,
    metadata: { source: "novapa-register" },
  });

  const pi = await stripe.paymentIntents.create({
    amount: pricing.todayCents,
    currency: "usd",
    customer: customer.id,
    setup_future_usage: (plan === "deposit" || plan === "subscription") ? "off_session" : undefined,
    // Cards + Link only. Apple Pay / Google Pay ride the card rails via the
    // Express Checkout element. Redirect methods (Amazon Pay, Klarna, ...)
    // are excluded deliberately: they hijack mobile checkout and cannot be
    // charged off-session for installment schedules / class subscriptions.
    payment_method_types: ["card", "link"],
    description: `NOVAPA — ${plan === "deposit" ? "reservation deposit"
      : plan === "subscription" ? "class enrollment (first month)" : "paid in full"}`,
    statement_descriptor_suffix: "NOVAPA",
    metadata: {
      hold_id, plan, email,
      parent_name: (parent_name || "").slice(0, 100),
      total_cents: String(pricing.totalCents),
      installment_cents: String(pricing.installmentCents),
      n_installments: String(pricing.nInstallments),
      first_installment_utc: String(pricing.firstInstallmentUTC),
      insurance_cents: String(pricing.insuranceCents),
      insured: insurance ? "1" : "0",
      coupon: (couponPct || couponFixedCents) ? couponCode.toUpperCase() : "",
      coupon_cents: String(pricing.couponCents || 0),
      plan_fee_cents: String(pricing.planFeeCents || 0),
      // IRS day-camp rule (Todd): FSA language only for daytime day camps —
      // summer camps + one-day specialty camps. Never classes or show fees.
      fsa_eligible: (summerItems.length > 0 ||
        showItems.some((it) => (byId[it.activity_id].price_cents || 0) <= DAY_CAMP_MAX_CENTS)) ? "1" : "0",
      unit_prices: JSON.stringify(pricing.unitPrices).slice(0, 450),
      monthly_items: JSON.stringify(pricing.monthlyItems).slice(0, 450),
      n_items: String(items.length),
      order_desc: description.slice(0, 480),
    },
  });

  return Response.json({
    client_secret: pi.client_secret,
    pricing: {
      n: items.length,
      discount_pct: pricing.discountPct,
      unit_prices: pricing.unitPrices,
      subtotal_cents: pricing.subtotalCents,
      coupon_cents: pricing.couponCents || 0,
      coupon: (couponPct || couponFixedCents) ? couponCode.toUpperCase() : null,
      plan_fee_cents: pricing.planFeeCents || 0,
      insurance_cents: pricing.insuranceCents,
      total_cents: pricing.totalCents,
      today_cents: pricing.todayCents,
      installment_cents: pricing.installmentCents,
      n_installments: pricing.nInstallments,
      first_installment_utc: pricing.firstInstallmentUTC,
      monthly_items: pricing.monthlyItems,
    },
  });
};

export const config = { path: "/api/reg-pay" };
