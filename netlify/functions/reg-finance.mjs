// Admin accounting endpoint — POST /api/reg-finance  { year }
// Joins our order data (Supabase) with money truth from Stripe
// (fees, refunds, disputes, payouts). Admin-gated via the caller's JWT.
import Stripe from "stripe";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./reg-config.mjs";

async function isAdmin(userToken) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${userToken}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!r.ok) return false;
  const t = (await r.text()).trim();
  return t === "true";
}

async function svcGet(path) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!r.ok) throw new Error(`db ${path} ${r.status}`);
  return r.json();
}

export default async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!auth || !(await isAdmin(auth))) {
    return Response.json({ error: "not admin" }, { status: 403 });
  }
  let body = {};
  try { body = await req.json(); } catch {}
  const year = parseInt(body.year, 10) || new Date().getUTCFullYear();
  const from = Math.floor(Date.UTC(year, 0, 1) / 1000);
  const to = Math.floor(Date.UTC(year + 1, 0, 1) / 1000);

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  // --- our order data ---
  const [orders, items, activities] = await Promise.all([
    svcGet("orders?select=*&order=created_at.desc&limit=1000"),
    svcGet("order_items?select=*&limit=5000"),
    svcGet("activities?select=id,name,category,price_cents&limit=200"),
  ]);
  const itemsByOrder = {};
  for (const it of items) (itemsByOrder[it.order_id] = itemsByOrder[it.order_id] || []).push(it);

  // --- Stripe: payments with fees (paginated; volumes are small) ---
  const txns = [];
  let after;
  for (let page = 0; page < 10; page++) {
    const res = await stripe.paymentIntents.list({
      limit: 100, created: { gte: from, lt: to },
      starting_after: after,
      expand: ["data.latest_charge.balance_transaction", "data.latest_charge.payment_method_details"],
    });
    for (const pi of res.data) {
      const ch = pi.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
      const bt = ch && ch.balance_transaction && typeof ch.balance_transaction === "object" ? ch.balance_transaction : null;
      const pmd = ch && ch.payment_method_details;
      txns.push({
        pi: pi.id,
        charge: ch ? ch.id : null,
        status: pi.status,
        created: pi.created,
        amount: pi.amount,
        amount_received: pi.amount_received,
        fee: bt ? bt.fee : null,
        net: bt ? bt.net : null,
        refunded: ch ? ch.amount_refunded : 0,
        disputed: ch ? !!ch.disputed : false,
        method: pmd ? (pmd.card ? `${pmd.card.brand} ****${pmd.card.last4}` : pmd.type) : null,
        customer: typeof pi.customer === "string" ? pi.customer : pi.customer && pi.customer.id,
        invoice: typeof pi.invoice === "string" ? pi.invoice : pi.invoice && pi.invoice.id,
        metadata: pi.metadata || {},
      });
    }
    if (!res.has_more) break;
    after = res.data[res.data.length - 1].id;
  }

  // --- refunds + disputes in the window ---
  const refunds = [];
  const rf = await stripe.refunds.list({ limit: 100, created: { gte: from, lt: to } });
  for (const r of rf.data) refunds.push({ id: r.id, charge: r.charge, amount: r.amount, created: r.created, reason: r.reason, status: r.status });
  const disputes = [];
  const dp = await stripe.disputes.list({ limit: 100, created: { gte: from, lt: to } });
  for (const d of dp.data) disputes.push({ id: d.id, charge: d.charge, amount: d.amount, created: d.created, reason: d.reason, status: d.status });

  // --- payouts (bank deposits) + which charges each one contains ---
  const payouts = [];
  const chargePayout = {};
  const po = await stripe.payouts.list({ limit: 100, created: { gte: from, lt: to } });
  for (const p of po.data) {
    payouts.push({ id: p.id, amount: p.amount, arrival_date: p.arrival_date, status: p.status });
    try {
      const bts = await stripe.balanceTransactions.list({ payout: p.id, limit: 100 });
      for (const bt of bts.data) {
        if (bt.source && typeof bt.source === "string" && bt.source.startsWith("ch_")) {
          chargePayout[bt.source] = p.arrival_date;
        }
      }
    } catch {}
  }
  for (const t of txns) if (t.charge && chargePayout[t.charge]) t.payout_date = chargePayout[t.charge];

  return Response.json({
    year, orders, items_by_order: itemsByOrder, activities,
    transactions: txns, refunds, disputes, payouts,
  });
};

export const config = { path: "/api/reg-finance" };
