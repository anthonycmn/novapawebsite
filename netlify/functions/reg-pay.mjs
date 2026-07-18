// POST /api/reg-pay — create a Stripe PaymentIntent for an active hold.
// Body: { hold_id, plan: "deposit"|"full"|"subscription", parent_name }
// Auth: Authorization: Bearer <supabase user JWT>
// Pricing is computed here — client math is display-only.
//
// Two cart kinds (not mixed):
//  - summer items {show, band, camper}: tiered camps, deposit or pay-in-full
//  - catalog items {activity_id, camper}: classes ($90/mo sub, first month now,
//    5% sibling on 2nd+ child) or BB shows (pay-in-full at listed price)
import Stripe from "stripe";
import {
  SUPABASE_URL, SUPABASE_ANON_KEY, SHOWS, priceOrder,
  CLASS_PRICE_CENTS, SIBLING_PCT, FAMILY_FEE_CENTS,
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

  const items = hold.items;
  const summerItems = items.filter((it) => it.show);
  const catalogItems = items.filter((it) => it.activity_id);
  if (summerItems.length && catalogItems.length) {
    return Response.json({ error: "mixed_cart" }, { status: 400 });
  }

  let pricing;         // { todayCents, totalCents, installmentCents, unitPrices[], monthlyItems[] }
  let description;

  if (summerItems.length) {
    // existing summer camp path — unchanged math
    if (plan === "subscription") return Response.json({ error: "bad_plan" }, { status: 400 });
    const p = priceOrder(summerItems, plan);
    pricing = {
      todayCents: p.todayCents, totalCents: p.totalCents,
      installmentCents: p.installmentCents,
      unitPrices: summerItems.map(() => p.unitCents),
      monthlyItems: [], discountPct: Math.round(p.rate * 100),
      familyFeeCents: p.familyFeeCents,
    };
    description = summerItems
      .map((it) => `${it.camper || "Camper"} — ${SHOWS[it.show] || it.show} (${it.band})`)
      .join("; ");
  } else {
    // catalog path
    const ids = [...new Set(catalogItems.map((it) => it.activity_id))];
    const acts = await anonRpc("activity_prices", { p_ids: ids });
    if (!acts || acts.length !== ids.length) {
      return Response.json({ error: "unknown_activity" }, { status: 400 });
    }
    const byId = Object.fromEntries(acts.map((a) => [a.id, a]));
    const allClasses = catalogItems.every((it) => byId[it.activity_id].category === "class");
    const anyClasses = catalogItems.some((it) => byId[it.activity_id].category === "class");
    if (anyClasses && !allClasses) return Response.json({ error: "mixed_cart" }, { status: 400 });
    if (allClasses && plan !== "subscription") return Response.json({ error: "bad_plan" }, { status: 400 });
    if (!allClasses && plan !== "full") return Response.json({ error: "bad_plan" }, { status: 400 });

    const feeDue = !!(await anonRpc("family_fee_due", { p_email: email }));
    const firstChild = (catalogItems[0] || {}).camper;
    const unitPrices = catalogItems.map((it) => {
      const a = byId[it.activity_id];
      if (a.category === "class") {
        const base = CLASS_PRICE_CENTS;
        // 5% sibling discount: class registrations for 2nd+ distinct child
        return it.camper && it.camper !== firstChild
          ? Math.round(base * (1 - SIBLING_PCT / 100)) : base;
      }
      return a.price_cents;
    });
    const subtotal = unitPrices.reduce((s, v) => s + v, 0);
    const feeCents = feeDue ? FAMILY_FEE_CENTS : 0;
    pricing = {
      todayCents: subtotal + feeCents, totalCents: subtotal + feeCents,
      installmentCents: 0, unitPrices,
      monthlyItems: allClasses ? unitPrices : [],
      discountPct: 0, familyFeeCents: feeCents,
    };
    description = catalogItems
      .map((it) => `${it.camper || "Camper"} — ${byId[it.activity_id].name}`)
      .join("; ");
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
    automatic_payment_methods: { enabled: true },
    description: `NOVAPA — ${plan === "deposit" ? "camp reservation deposit"
      : plan === "subscription" ? "class enrollment (first month)" : "paid in full"}`,
    statement_descriptor_suffix: "NOVAPA",
    metadata: {
      hold_id, plan, email,
      parent_name: (parent_name || "").slice(0, 100),
      total_cents: String(pricing.totalCents),
      installment_cents: String(pricing.installmentCents),
      unit_prices: JSON.stringify(pricing.unitPrices).slice(0, 450),
      monthly_items: JSON.stringify(pricing.monthlyItems).slice(0, 450),
      fee_charged: pricing.familyFeeCents > 0 ? "1" : "0",
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
      family_fee_cents: pricing.familyFeeCents,
      total_cents: pricing.totalCents,
      today_cents: pricing.todayCents,
      installment_cents: pricing.installmentCents,
      monthly_items: pricing.monthlyItems,
    },
  });
};

export const config = { path: "/api/reg-pay" };
