// POST /api/reg-pay — create a Stripe PaymentIntent for an active hold.
// Body: { hold_id, plan: "deposit"|"full", parent_name }
// Auth: Authorization: Bearer <supabase user JWT>
// Pricing is computed here from the hold's items — client math is display-only.
import Stripe from "stripe";
import {
  SUPABASE_URL, SUPABASE_ANON_KEY, SHOWS, priceOrder,
} from "./reg-config.mjs";

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
  if (!hold_id || !["deposit", "full"].includes(plan)) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  // Verify the user and fetch their hold (RPC enforces ownership via JWT).
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}` },
  });
  if (!userRes.ok) return Response.json({ error: "unauthorized" }, { status: 401 });
  const user = await userRes.json();
  const email = (user.email || "").toLowerCase();
  if (!email) return Response.json({ error: "unauthorized" }, { status: 401 });

  const holdRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_my_hold`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_hold_id: hold_id }),
  });
  const hold = holdRes.ok ? await holdRes.json() : null;
  if (!hold || !hold.items) return Response.json({ error: "hold_not_found" }, { status: 404 });
  if (hold.status !== "active" || new Date(hold.expires_at) < new Date()) {
    return Response.json({ error: "hold_expired" }, { status: 409 });
  }

  const items = hold.items;
  const pricing = priceOrder(items, plan);

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const customer = await stripe.customers.create({
    email,
    name: parent_name || undefined,
    metadata: { source: "novapa-register" },
  });

  const description = items
    .map((it) => `${it.camper || "Camper"} — ${SHOWS[it.show] || it.show} (${it.band})`)
    .join("; ")
    .slice(0, 480);

  const pi = await stripe.paymentIntents.create({
    amount: pricing.todayCents,
    currency: "usd",
    customer: customer.id,
    setup_future_usage: plan === "deposit" ? "off_session" : undefined,
    automatic_payment_methods: { enabled: true },
    description: `NOVAPA Summer 2027 — ${plan === "deposit" ? "reservation deposit" : "paid in full"}`,
    statement_descriptor_suffix: "NOVAPA CAMP",
    metadata: {
      hold_id,
      plan,
      email,
      parent_name: (parent_name || "").slice(0, 100),
      total_cents: String(pricing.totalCents),
      installment_cents: String(pricing.installmentCents),
      unit_cents: String(pricing.unitCents),
      n_items: String(pricing.n),
      items: JSON.stringify(items).slice(0, 490),
      order_desc: description,
    },
  });

  return Response.json({
    client_secret: pi.client_secret,
    pricing: {
      n: pricing.n,
      discount_pct: Math.round(pricing.rate * 100),
      unit_cents: pricing.unitCents,
      subtotal_cents: pricing.subtotalCents,
      family_fee_cents: pricing.familyFeeCents,
      total_cents: pricing.totalCents,
      today_cents: pricing.todayCents,
      installment_cents: pricing.installmentCents,
    },
  });
};

export const config = { path: "/api/reg-pay" };
