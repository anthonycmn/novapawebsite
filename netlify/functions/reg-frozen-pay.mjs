// /api/frozen-pay — one-page guest checkout for the Frozen fall show
// (novapa.org/frozen-checkout, the ad-funnel A/B variant vs the register app).
//
// Built 1 Sep 2026 on the dcu-pay.mjs pattern: session replays showed cold ad
// traffic reaching the register portal's payment step and stalling in the
// options, so this variant sells exactly one thing — a seat in one Frozen
// cast — with no account, no cart, no catalog. Everything downstream is the
// shared rails: same holds -> confirm_order -> reg-webhook chain, so orders
// land in the dashboard, the books, and the standard NOVAPA confirmation
// email exactly like a register-app sale.
//
// Deliberate differences from dcu-pay:
// - PAY IN FULL ONLY. Per Todd's rule installments must clear before the
//   program starts; rehearsals begin Sep 15/16 so no plan can exist here.
// - Availability includes booked_offline (the migrated Regpack seats) — the
//   Frozen bands carry real offline enrollment and ignoring it would oversell
//   the capped casts.
import Stripe from "stripe";
import { SUPABASE_URL } from "./reg-config.mjs";

// The three Frozen casts. Age routing happens client-side (the page shows the
// chosen night before payment); the server just refuses anything else.
const FROZEN_IDS = new Set([1959787, 1959789, 1959805]);

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

const clean = (v, max) => String(v == null ? "" : v).trim().slice(0, max);

async function bands() {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/activities?id=in.(1959787,1959789,1959805)` +
    `&select=id,name,age_range,price_cents,capacity,sold,booked_offline,bookable,hidden,class_times,starts_on`,
    { headers: svcHeaders() });
  return r.ok ? await r.json() : [];
}

async function seatsLeft(act) {
  let held = 0;
  try { held = (await serviceRpc("held_count_activity", { p_activity_id: act.id })) || 0; }
  catch { /* stale hold count must not block the page */ }
  if (act.capacity == null) return null;
  return Math.max(0, act.capacity - (act.sold || 0) - (act.booked_offline || 0) - held);
}

// GET /api/frozen-pay — live band data the page renders from: price, night,
// and honest per-cast seat counts (the design's rule: never fake the bar).
async function quote() {
  const rows = await bands();
  const out = [];
  for (const a of rows) {
    const left = await seatsLeft(a);
    const ct = Array.isArray(a.class_times) ? a.class_times[0] : null;
    out.push({
      activity_id: a.id,
      name: a.name,
      age_range: a.age_range,
      price_cents: a.price_cents,
      capacity: a.capacity,
      taken: a.capacity != null && left != null ? a.capacity - left : null,
      left,
      available: !!a.bookable && !a.hidden && (left == null || left > 0),
      day: ct?.title_text || "",
      time: (ct?.primary_text || [])[0] || "",
      dates: ct?.secondary_text || "",
      starts_on: a.starts_on,
    });
  }
  return Response.json({ bands: out });
}

export default async (req) => {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: "payments_not_configured" }, { status: 503 });
  }
  if (req.method === "GET") return quote();
  if (req.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  if (!process.env.STRIPE_SECRET_KEY) {
    return Response.json({ error: "payments_not_configured" }, { status: 503 });
  }

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "bad_json" }, { status: 400 }); }

  const activityId = parseInt(body.activity_id, 10);
  const email = clean(body.email, 200).toLowerCase();
  const parentName = clean(body.parent_name, 100);
  const camperName = clean(body.camper_name, 100);
  const phone = clean(body.phone, 40);

  if (!FROZEN_IDS.has(activityId)) return Response.json({ error: "unknown_activity" }, { status: 400 });
  if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) return Response.json({ error: "bad_email" }, { status: 400 });
  if (!camperName || !parentName) return Response.json({ error: "missing_name" }, { status: 400 });
  if (phone.replace(/\D/g, "").length < 10) return Response.json({ error: "bad_phone" }, { status: 400 });

  const act = (await bands()).find((a) => a.id === activityId);
  if (!act) return Response.json({ error: "unknown_activity" }, { status: 400 });
  if (!act.bookable || act.hidden) return Response.json({ error: "not_for_sale" }, { status: 409 });
  const left = await seatsLeft(act);
  if (left != null && left <= 0) return Response.json({ error: "sold_out" }, { status: 409 });

  const totalCents = act.price_cents || 0;
  if (totalCents < 50) return Response.json({ error: "bad_price" }, { status: 500 });

  // Hold the seat — confirm_order (via reg-webhook on payment success) reads
  // this row, so the item shape matches what the register app writes.
  const holdRes = await fetch(`${SUPABASE_URL}/rest/v1/holds`, {
    method: "POST",
    headers: { ...svcHeaders(), Prefer: "return=representation" },
    body: JSON.stringify({
      email,
      items: [{ activity_id: activityId, camper: camperName }],
      expires_at: new Date(Date.now() + HOLD_MINUTES * 60 * 1000).toISOString(),
      status: "active",
    }),
  });
  if (!holdRes.ok) {
    console.error("frozen hold insert failed:", await holdRes.text());
    return Response.json({ error: "hold_failed" }, { status: 500 });
  }
  const hold = (await holdRes.json())[0];

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const customer = await stripe.customers.create({
    email, name: parentName || undefined, phone: phone || undefined,
    metadata: { source: "frozen-checkout", camper_name: camperName },
  });

  const pi = await stripe.paymentIntents.create({
    amount: totalCents,
    currency: "usd",
    customer: customer.id,
    payment_method_types: ["card", "link"],
    description: `Frozen fall show — ${camperName} (paid in full)`,
    metadata: {
      // --- contract read by reg-webhook.mjs; names must match reg-pay.mjs ---
      hold_id: hold.id,
      plan: "full",
      email,
      parent_name: parentName,
      total_cents: String(totalCents),
      installment_cents: "0",
      n_installments: "0",
      first_installment_utc: "0",
      insurance_cents: "0",
      insured: "0",
      coupon: "",
      coupon_cents: "0",
      plan_fee_cents: "0",
      fsa_eligible: "0",
      unit_prices: JSON.stringify([totalCents]),
      monthly_items: "[]",
      n_items: "1",
      order_desc: `${camperName} — ${act.name}`.slice(0, 480),
      credit_grants: "[]",
      credit_redeems: "[]",
      funnel: "frozen-checkout",
      phone,
    },
  });

  return Response.json({
    client_secret: pi.client_secret,
    hold_id: hold.id,
    pricing: { name: act.name, total_cents: totalCents, today_cents: totalCents },
  });
};

export const config = { path: "/api/frozen-pay" };
