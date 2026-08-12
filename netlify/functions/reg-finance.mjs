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

  // action: replace_schedule — reshape an order's FUTURE installments without
  // touching money already collected (Amy Ngo, Jul 31: fall show paid off by
  // its start, summer spread out). Cancels the order's current subscription
  // schedule and creates one new schedule per group of {ts, cents} phases on
  // the same customer + saved card. Validates before mutating; returns
  // everything it did. Admin-gated like the rest of this endpoint.
  if (body.action === "replace_schedule") {
    const { order_id, schedules } = body;
    if (!order_id || !Array.isArray(schedules) || !schedules.length ||
        !schedules.every((g) => Array.isArray(g.phases) && g.phases.length &&
          g.phases.every((p) => p.ts > Date.now() / 1000 && p.cents > 0))) {
      return Response.json({ error: "bad_request" }, { status: 400 });
    }
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const orders = await svcGet(`orders?id=eq.${order_id}&select=id,email,stripe_schedule,stripe_customer,stripe_payment_intent`);
    if (!orders.length) return Response.json({ error: "order_not_found" }, { status: 404 });
    const o = orders[0];
    if (!o.stripe_schedule) return Response.json({ error: "no_schedule" }, { status: 400 });

    const oldSched = await stripe.subscriptionSchedules.retrieve(o.stripe_schedule);
    if (oldSched.status === "canceled" || oldSched.status === "released") {
      return Response.json({ error: "schedule_already_" + oldSched.status }, { status: 409 });
    }
    // the saved card: prefer the schedule's own default, fall back to the PI's
    let pm = oldSched.default_settings?.default_payment_method || null;
    if (!pm && o.stripe_payment_intent) {
      const pi = await stripe.paymentIntents.retrieve(o.stripe_payment_intent);
      pm = typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id;
    }
    const customer = oldSched.customer;
    if (!customer || !pm) return Response.json({ error: "no_payment_method" }, { status: 400 });

    // dry_run: every validation above has passed — report the exact plan
    // without touching Stripe, so nobody runs this blind from curl again
    if (body.dry_run) {
      const remaining = (oldSched.phases || [])
        .filter((p) => p.end_date > Date.now() / 1000)
        .map((p) => ({ start: p.start_date, end: p.end_date }));
      return Response.json({
        ok: true, dry_run: true,
        would_cancel: o.stripe_schedule, schedule_status: oldSched.status,
        customer, payment_method: pm,
        current_remaining_phases: remaining, would_create: schedules,
      });
    }

    await stripe.subscriptionSchedules.cancel(o.stripe_schedule);

    const INSTALLMENT_PRODUCT_ID = "novapa-summer-2027-installments"; // same product the webhook bills installments on
    try { await stripe.products.retrieve(INSTALLMENT_PRODUCT_ID); }
    catch { await stripe.products.create({ id: INSTALLMENT_PRODUCT_ID, name: "NOVAPA Summer 2027 — Installments" }); }

    const created = [];
    for (const g of schedules) {
      // consecutive monthly 1-iteration phases land on successive 1sts —
      // same shape the webhook creates, just with per-month amounts
      const sched = await stripe.subscriptionSchedules.create({
        customer,
        start_date: g.phases[0].ts,
        end_behavior: "cancel",
        default_settings: { default_payment_method: pm, collection_method: "charge_automatically" },
        phases: g.phases.map((p) => ({
          items: [{ quantity: 1, price_data: {
            currency: "usd", product: INSTALLMENT_PRODUCT_ID,
            recurring: { interval: "month" }, unit_amount: p.cents,
          } }],
          iterations: 1,
          proration_behavior: "none",
        })),
        metadata: { order_id, label: g.label || "", split: "replace_schedule" },
      });
      created.push({ label: g.label || "", id: sched.id, phases: g.phases });
    }

    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${order_id}`, {
      method: "PATCH",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ stripe_schedule: created.map((c) => c.id).join(",") }),
    });
    return Response.json({ ok: true, canceled: o.stripe_schedule, created });
  }

  const year = parseInt(body.year, 10) || new Date().getUTCFullYear();
  const from = Math.floor(Date.UTC(year, 0, 1) / 1000);
  const to = Math.floor(Date.UTC(year + 1, 0, 1) / 1000);

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  // The Cash Flow tab only needs the forward-looking schedule. Skipping the
  // year's payment/refund/payout walk (10 paginated PI pages with expands plus
  // a balanceTransactions call per payout) is the difference between a tab that
  // opens instantly and one Todd waits on every time.
  const forecastOnly = !!body.forecast_only;

  // The full sweep costs ~10s of serial Stripe pagination, and the dashboard
  // asks for it on every open. Cache the finished payload per year for 5
  // minutes: the first request in a window pays the sweep, everyone else gets
  // it instantly. Pass {refresh:true} to bypass.
  const CACHE_TTL_MS = 5 * 60 * 1000;
  if (!forecastOnly && !body.refresh) {
    try {
      const rows = await svcGet(`finance_cache?year=eq.${year}&select=payload,computed_at`);
      if (rows.length && Date.now() - new Date(rows[0].computed_at).getTime() < CACHE_TTL_MS) {
        return Response.json({ ...rows[0].payload, cached_at: rows[0].computed_at });
      }
    } catch (e) { console.error("finance cache read:", e.message); }
  }

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
  for (let page = 0; !forecastOnly && page < 10; page++) {
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
  const disputes = [];
  const payouts = [];
  if (!forecastOnly) {
    const rf = await stripe.refunds.list({ limit: 100, created: { gte: from, lt: to } });
    for (const r of rf.data) refunds.push({ id: r.id, charge: r.charge, amount: r.amount, created: r.created, reason: r.reason, status: r.status });
    const dp = await stripe.disputes.list({ limit: 100, created: { gte: from, lt: to } });
    for (const d of dp.data) disputes.push({ id: d.id, charge: d.charge, amount: d.amount, created: d.created, reason: d.reason, status: d.status });

    // --- payouts (bank deposits) + which charges each one contains ---
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
  }

  // --- cash-flow forecast: every future auto-billing pull (Todd) ---
  // Classes ride subscriptions; camp installment plans ride subscription
  // schedules (not_started until the first pull). Walk both.
  const upcoming = [];
  const priceCache = {};
  async function priceAmt(priceId) {
    if (typeof priceId === "object" && priceId) return priceId.unit_amount || 0;
    if (priceCache[priceId] != null) return priceCache[priceId];
    try {
      const p = await stripe.prices.retrieve(priceId);
      priceCache[priceId] = p.unit_amount || 0;
    } catch { priceCache[priceId] = 0; }
    return priceCache[priceId];
  }
  const schedByRef = {};
  for (const o of orders) if (o.stripe_schedule) schedByRef[o.stripe_schedule] = o;
  const nowSec = Math.floor(Date.now() / 1000);
  // Step a month without letting the day-of-month roll over: Date.UTC(y, m+1, 31)
  // silently lands in the month after next. Every pull we create is on the 1st,
  // but a legacy or hand-made schedule must not corrupt the whole series.
  function addMonth(d) {
    const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
    const last = new Date(Date.UTC(y, m + 2, 0)).getUTCDate();
    return new Date(Date.UTC(y, m + 1, Math.min(day, last), 12));
  }

  // class + released-schedule subscriptions
  try {
    const subs = await stripe.subscriptions.list({ status: "all", limit: 100, expand: ["data.items.data.price"] });
    for (const s of subs.data) {
      if (["canceled", "incomplete", "incomplete_expired", "unpaid"].includes(s.status)) continue;
      let monthly = 0;
      for (const it of s.items.data) monthly += (it.price.unit_amount || 0) * (it.quantity || 1);
      if (!monthly) continue;
      const o = schedByRef[s.id] || (s.schedule && schedByRef[s.schedule]);
      // Next pull = the later of trial_end and the current period end. As of
      // Stripe's 2025 basil API versions current_period_end lives on the
      // subscription ITEM, not the subscription — reading s.current_period_end
      // returned undefined, so any subscription past its trial fell through to
      // "now" and forecast every future pull on today's day of the month
      // instead of the 1st. That is the wrong-date Todd reported.
      let periodEnd = 0;
      for (const it of s.items.data) periodEnd = Math.max(periodEnd, it.current_period_end || 0);
      const t = Math.max(s.trial_end || 0, periodEnd) || nowSec;
      const stop = s.cancel_at || (t + 366 * 86400);
      let d = new Date(t * 1000);
      for (let i = 0; i < 14; i++) {
        const ts = Math.floor(d.getTime() / 1000);
        if (ts > stop) break;
        if (ts > nowSec) upcoming.push({ date: d.toISOString().slice(0, 10), amount: monthly, kind: "class/monthly", email: o ? o.email : null, ref: s.id });
        d = addMonth(d);
      }
    }
  } catch (e) { console.error("subs forecast:", e.message); }

  // not-yet-started installment schedules
  try {
    const scheds = await stripe.subscriptionSchedules.list({ limit: 100 });
    for (const sc of scheds.data) {
      if (sc.status !== "not_started" && sc.status !== "active") continue;
      if (sc.subscription) continue; // already counted via subscriptions above
      const o = schedByRef[sc.id];
      for (const ph of (sc.phases || [])) {
        let monthly = 0;
        for (const it of (ph.items || [])) monthly += (await priceAmt(it.price)) * (it.quantity || 1);
        if (!monthly) continue;
        let d = new Date((ph.start_date || nowSec) * 1000);
        const end = ph.end_date || (ph.start_date + 366 * 86400);
        for (let i = 0; i < 14; i++) {
          const ts = Math.floor(d.getTime() / 1000);
          if (ts >= end) break;
          if (ts > nowSec) upcoming.push({ date: d.toISOString().slice(0, 10), amount: monthly, kind: "installment", email: o ? o.email : null, ref: sc.id });
          d = addMonth(d);
        }
      }
    }
  } catch (e) { console.error("scheds forecast:", e.message); }

  upcoming.sort((a, b) => a.date < b.date ? -1 : 1);

  const payload = {
    year, orders, items_by_order: itemsByOrder, activities,
    transactions: txns, refunds, disputes, payouts, upcoming,
  };

  if (!forecastOnly) {
    try {
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      await fetch(`${SUPABASE_URL}/rest/v1/finance_cache?on_conflict=year`, {
        method: "POST",
        headers: {
          apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify({ year, payload, computed_at: new Date().toISOString() }),
      });
    } catch (e) { console.error("finance cache write:", e.message); }
  }

  return Response.json(payload);
};

export const config = { path: "/api/reg-finance" };
