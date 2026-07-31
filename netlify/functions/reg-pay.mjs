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
import { sendConfirmationEmail } from "./reg-email.mjs";
import {
  SUPABASE_URL, SUPABASE_ANON_KEY, SHOWS, priceCart, kidKey,
  CLASS_PRICE_CENTS, SIBLING_PCT, INSURANCE_PCT, DAY_CAMP_MAX_CENTS, showStartFor,
  SPECIAL_PLANS, isCoachingId,
} from "./reg-config.mjs";

// first day of care per summer camp — the date the IRS under-13 test runs on
const CAMP_STARTS = { httyd: "2027-07-05", charlie: "2027-07-19", trolls: "2027-08-02" };
function fsaUnder13(bday, startISO) {
  if (!bday) return false;
  const b = new Date(bday + "T00:00:00"), s = startISO ? new Date(startISO + "T00:00:00") : new Date();
  let age = s.getFullYear() - b.getFullYear();
  if (s.getMonth() < b.getMonth() || (s.getMonth() === b.getMonth() && s.getDate() < b.getDate())) age--;
  return age < 13;
}

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
  let couponPct = 0, couponFixedCents = 0, special = null;
  if (couponCode) {
    const c = await anonRpc("check_coupon", { p_code: couponCode });
    if (!c || (!c.pct && !c.amount_cents)) return Response.json({ error: "bad_coupon" }, { status: 400 });
    couponPct = c.pct || 0;
    couponFixedCents = c.amount_cents || 0;
    // account-locked one-off adjustments (Todd/CJ approvals) — the coupons row
    // gates existence/uses, the SPECIAL_PLANS entry carries the actual terms
    special = SPECIAL_PLANS[couponCode.toUpperCase()] || null;
    if (special && special.email.toLowerCase() !== email) {
      return Response.json({ error: "bad_coupon" }, { status: 400 });
    }
  }

  const items = hold.items;
  const summerItems = items.filter((it) => it.show);
  const activityItems = items.filter((it) => it.activity_id);

  // prior registrations per kid (already_registered on their camper rows) —
  // they count toward the per-kid tier and the show bundle (CJ)
  const priorCampsByKid = {}, priorShowsByKid = {};
  const bdayByKid = {};
  const SUMMER_SLUGS = new Set(["httyd", "charlie", "trolls"]);
  try {
    const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const fr = await fetch(`${SUPABASE_URL}/rest/v1/families?email=ilike.${encodeURIComponent(email)}&select=id`, {
      headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}` },
    });
    const fams = await fr.json();
    if (Array.isArray(fams) && fams.length) {
      const cr = await fetch(`${SUPABASE_URL}/rest/v1/campers?family_id=eq.${fams[0].id}&select=name,already_registered,birthdate`, {
        headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}` },
      });
      const camps = await cr.json();
      const byName = {};
      for (const c of (Array.isArray(camps) ? camps : [])) {
        const reg = c.already_registered || [];
        byName[String(c.name || "").trim().toLowerCase()] = {
          camps: reg.filter((s) => SUMMER_SLUGS.has(s)).length,
          shows: reg.filter((s) => !SUMMER_SLUGS.has(s)).length,
          bday: c.birthdate || null,
        };
      }
      for (const it of items) {
        const p = byName[String(it.camper || "").trim().toLowerCase()];
        if (!p) continue;
        if (p.camps) priorCampsByKid[kidKey(it)] = p.camps;
        if (p.shows) priorShowsByKid[kidKey(it)] = p.shows;
        if (p.bday) bdayByKid[kidKey(it)] = p.bday;
      }
    }
  } catch (e) { console.error("prior lookup failed:", e.message); }

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
    // Class bundles (CJ, Jul 31): per registrant 1 = $90, 2 = $159, 3 = $199
    // a month. The kid's bundle is spread across their class lines so Stripe
    // statements stay per-class (remainder lands on the last line).
    const kk = (it) => (it && it.ci != null ? "i" + it.ci : (it && it.camper) || "");
    const byKidClasses = {};
    classItems.forEach((it, idx) => {
      (byKidClasses[kk(it)] = byKidClasses[kk(it)] || []).push(idx);
    });
    const unitPrices = new Array(classItems.length).fill(0);
    for (const k of Object.keys(byKidClasses)) {
      const idxs = byKidClasses[k];
      const bundle = classMonthlyCents(idxs.length);
      const per = Math.floor(bundle / idxs.length);
      idxs.forEach((idx, j) => {
        unitPrices[idx] = j === idxs.length - 1 ? bundle - per * (idxs.length - 1) : per;
      });
    }
    const subtotal = unitPrices.reduce((s, v) => s + v, 0);
    const couponCents = couponPct ? Math.round(subtotal * couponPct / 100) : Math.min(couponFixedCents, subtotal);

    // First month free (CJ, Jul 31): any family already holding a 2026-27
    // show/camp registration — a paid web order with a non-class item, or a
    // Sawyer-imported registration on one of their campers — pays $0 today;
    // billing simply starts with the Oct 1 pull. Failure of this check must
    // never block checkout, so it degrades to "pay the first month".
    let firstMonthFree = false;
    try {
      const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const hdrs = { apikey: svcKey, Authorization: `Bearer ${svcKey}` };
      const fam = await (await fetch(`${SUPABASE_URL}/rest/v1/families?email=ilike.${encodeURIComponent(email)}&select=id`, { headers: hdrs })).json();
      if (fam.length) {
        const kids = await (await fetch(`${SUPABASE_URL}/rest/v1/campers?family_id=eq.${fam[0].id}&select=already_registered`, { headers: hdrs })).json();
        firstMonthFree = kids.some((c) => Array.isArray(c.already_registered) && c.already_registered.length);
      }
      if (!firstMonthFree) {
        const ords = await (await fetch(`${SUPABASE_URL}/rest/v1/orders?email=ilike.${encodeURIComponent(email)}&status=in.(paid,confirmed,complete,succeeded)&select=id`, { headers: hdrs })).json();
        if (ords.length) {
          const ids = ords.map((o) => o.id).join(",");
          const its = await (await fetch(`${SUPABASE_URL}/rest/v1/order_items?order_id=in.(${ids})&select=activity_id`, { headers: hdrs })).json();
          const actIds = [...new Set(its.map((i) => i.activity_id).filter(Boolean))];
          if (its.some((i) => !i.activity_id)) firstMonthFree = true; // summer camp lines carry no activity_id
          else if (actIds.length) {
            const acts = await (await fetch(`${SUPABASE_URL}/rest/v1/activities?id=in.(${actIds.join(",")})&select=id,category`, { headers: hdrs })).json();
            firstMonthFree = acts.some((a) => a.category !== "class");
          }
        }
      }
    } catch (e) { console.error("first-month-free check failed:", e.message); }

    pricing = {
      todayCents: firstMonthFree ? 0 : subtotal - couponCents,
      totalCents: firstMonthFree ? 0 : subtotal - couponCents,
      subtotalCents: subtotal, couponCents,
      insuranceCents: 0, // built into the monthly price for classes
      installmentCents: 0, nInstallments: 0, firstInstallmentUTC: 0,
      unitPrices, monthlyItems: unitPrices, discountPct: 0,
      firstMonthFree,
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
    const p = priceCart(cart, plan, { insurance, couponPct, couponFixedCents, priorCampsByKid, priorShowsByKid, special });
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

  // 100%-off orders: nothing to charge — skip Stripe entirely.
  // (Not for class subscriptions: those still need the monthly plan created.)
  if (pricing.todayCents === 0 && pricing.totalCents === 0 && plan !== "subscription") {
    if (!body.confirm_free) {
      return Response.json({
        free: true,
        pricing: {
          n: items.length,
          discount_pct: pricing.discountPct,
          unit_prices: pricing.unitPrices,
          subtotal_cents: pricing.subtotalCents,
          coupon_cents: pricing.couponCents || 0,
          coupon: (couponPct || couponFixedCents) ? couponCode.toUpperCase() : null,
          plan_fee_cents: 0,
          insurance_cents: pricing.insuranceCents,
          total_cents: 0, today_cents: 0,
          installment_cents: 0, n_installments: 0, first_installment_utc: 0,
          monthly_items: [],
        },
      });
    }
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const svc = async (fn, args) => {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify(args),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(`rpc ${fn} failed ${r.status}: ${t.slice(0, 200)}`);
      try { return JSON.parse(t); } catch { return t; }
    };
    await svc("confirm_order", {
      p_hold_id: hold_id, p_email: email, p_parent_name: parent_name || null,
      p_plan: "full", p_amount_today_cents: 0, p_total_cents: 0,
      p_installment_cents: null, p_stripe_payment_intent: "free_" + hold_id,
      p_stripe_customer: null, p_unit_prices: pricing.unitPrices,
    });
    try {
      const held = await svc("hold_items_admin", { p_hold_id: hold_id });
      if (Array.isArray(held) && held.length) await svc("mark_registered", { p_email: email, p_items: held });
    } catch (e) { console.error("free order: mark_registered failed:", e.message); }
    if (couponCode) {
      // pass what was actually applied — a credit is spent down by that amount,
      // not consumed whole
      try { await svc("redeem_coupon", { p_code: couponCode, p_applied_cents: pricing.couponCents || 0 }); }
      catch (e) { console.error("free order: redeem_coupon failed:", e.message); }
    }
    if (parent_name && email) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/families?email=ilike.${encodeURIComponent(email)}`, {
          method: "PATCH",
          headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ parent_name }),
        });
      } catch {}
    }
    try {
      await sendConfirmationEmail({
        email, parent_name: parent_name || "",
        order_desc: description.slice(0, 480),
        total_cents: "0", coupon: couponCode.toUpperCase(),
        coupon_cents: String(pricing.couponCents || 0),
        fsa_eligible: "0",
      }, { amount_received: 0, amount: 0 });
    } catch (e) { console.error("free order: email failed:", e.message); }
    return Response.json({ confirmed: true });
  }

  // First-month-free class carts: nothing to charge today, but the card must
  // still be saved for the Oct 1 pull — a SetupIntent instead of a payment.
  if (plan === "subscription" && pricing.firstMonthFree && pricing.todayCents === 0) {
    const stripeS = new Stripe(process.env.STRIPE_SECRET_KEY);
    const customerS = await stripeS.customers.create({
      email, name: parent_name || undefined, metadata: { source: "novapa-register" },
    });
    const si = await stripeS.setupIntents.create({
      customer: customerS.id,
      payment_method_types: ["card", "link"],
      metadata: {
        hold_id, plan, email,
        parent_name: (parent_name || "").slice(0, 100),
        total_cents: "0", installment_cents: "0", n_installments: "0",
        first_installment_utc: "0", insurance_cents: "0", insured: "0",
        coupon: "", coupon_cents: "0", plan_fee_cents: "0", fsa_eligible: "0",
        first_month_free: "1",
        unit_prices: JSON.stringify(pricing.unitPrices).slice(0, 450),
        monthly_items: JSON.stringify(pricing.monthlyItems).slice(0, 450),
        n_items: String(items.length),
        order_desc: description.slice(0, 480),
      },
    });
    return Response.json({
      client_secret: si.client_secret, setup: true,
      pricing: {
        n: items.length, discount_pct: 0,
        unit_prices: pricing.unitPrices,
        subtotal_cents: pricing.subtotalCents,
        coupon_cents: 0, coupon: null, plan_fee_cents: 0, insurance_cents: 0,
        total_cents: 0, today_cents: 0, installment_cents: 0,
        n_installments: 0, first_installment_utc: 0,
        monthly_cents: pricing.monthlyItems.reduce((s, v) => s + v, 0),
        first_month_free: true,
      },
    });
  }

  if (pricing.todayCents < 50) {
    return Response.json({ error: "coupon_too_small" }, { status: 400 });
  }

  // Referral (Jason, Jul 30): ?ref=CODE from a family's share link. A reward
  // is earned only when the payer is a NEW family (no prior paid order) and
  // not the referrer themselves. Never blocks payment — a bad ref is
  // silently dropped, the webhook writes the reward on payment success.
  const refCodeRaw = String((body || {}).ref || "").trim().toUpperCase().slice(0, 20);
  let refMeta = {};
  if (refCodeRaw && /^[A-Z0-9]+$/.test(refCodeRaw)) {
    try {
      const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const hdrs = { apikey: svcKey, Authorization: `Bearer ${svcKey}` };
      const fr = await fetch(`${SUPABASE_URL}/rest/v1/families?ref_code=eq.${encodeURIComponent(refCodeRaw)}&select=email`, { headers: hdrs });
      const rows = await fr.json();
      const referrer = (rows && rows[0] && rows[0].email || "").toLowerCase();
      if (referrer && referrer !== email) {
        const or = await fetch(`${SUPABASE_URL}/rest/v1/orders?email=ilike.${encodeURIComponent(email)}&status=in.(paid,confirmed,complete,succeeded)&select=id&limit=1`, { headers: hdrs });
        const prior = await or.json();
        if (Array.isArray(prior) && prior.length === 0) {
          refMeta = { ref_code: refCodeRaw, ref_referrer: referrer };
        }
      }
    } catch (e) { console.error("referral check failed:", e.message); }
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
      // IRS Pub. 503: FSA language only for daytime day camps (summer camps +
      // one-day specialty camps, never classes or show fees) AND only when the
      // camper is under 13 when care starts. No birthday on file = not
      // eligible (checkout collects birthdays; fail closed on a tax flag).
      fsa_eligible: (
        summerItems.some((it) => fsaUnder13(bdayByKid[kidKey(it)], CAMP_STARTS[it.show])) ||
        showItems.some((it) => (byId[it.activity_id].price_cents || 0) <= DAY_CAMP_MAX_CENTS &&
          !isCoachingId(it.activity_id) &&
          fsaUnder13(bdayByKid[kidKey(it)], null))
      ) ? "1" : "0",
      unit_prices: JSON.stringify(pricing.unitPrices).slice(0, 450),
      monthly_items: JSON.stringify(pricing.monthlyItems).slice(0, 450),
      n_items: String(items.length),
      order_desc: description.slice(0, 480),
      ...refMeta,
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
