// POST /api/reg-webhook — Stripe webhook.
// payment_intent.succeeded -> confirm the order in Supabase (service role),
// and for deposit plans create the 8-installment subscription schedule.
import Stripe from "stripe";
import { sendConfirmationEmail } from "./reg-email.mjs";
import {
  SUPABASE_URL, CLASS_BILL_ANCHOR_UTC, CLASS_SEASON_END_UTC,
} from "./reg-config.mjs";

const INSTALLMENT_PRODUCT_ID = "novapa-summer-2027-installments";
const CLASS_PRODUCT_ID = "novapa-class-monthly";

async function serviceRpc(fn, args) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      "Content-Type": "application/json", Prefer: "return=representation",
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`rpc ${fn} failed ${res.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return text; }
}

async function ensureProduct(stripe, id, name) {
  try {
    await stripe.products.retrieve(id);
  } catch {
    await stripe.products.create({ id, name });
  }
}

// ---------------------------------------------------------------------------
// Registration confirmation email — branded, table-based HTML (email-safe).
// Sent via Gmail SMTP (same Workspace app password as Supabase auth emails).
// Failure here never fails the webhook: the order is already confirmed.


export default async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET ||
      !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return new Response("not configured", { status: 503 });
  }
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers.get("stripe-signature");
  const rawBody = await req.text();

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("webhook signature verification failed:", err.message);
    return new Response("bad signature", { status: 400 });
  }

  // setup_intent.succeeded = a first-month-free class enrollment (CJ, Jul 31):
  // no money moved today, but the saved card + identical metadata drive the
  // same order + subscription creation. The subscription's trial already ends
  // at the Oct 1 anchor, so "skip today's charge" needs no other change.
  if (event.type !== "payment_intent.succeeded" && event.type !== "setup_intent.succeeded") {
    return new Response("ignored", { status: 200 });
  }

  const pi = event.data.object;
  const m = pi.metadata || {};
  if (!m.hold_id || !m.plan) return new Response("no metadata", { status: 200 });

  // Duplicate class-enrollment guard (Aug 7 2026): a parent who retried a
  // broken checkout has several succeeded intents for the SAME enrollment,
  // and Stripe auto-retries their failed events for days — confirm_order's
  // per-payment-intent idempotency can't see across intents, so without this
  // each retry would mint another monthly subscription (Anne Champlin: three
  // $90 charges for one Triple Threat spot). Same kid + same class + a
  // subscription order already on file = acknowledge and drop the event.
  if (m.plan === "subscription") {
    try {
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const hdrs = { apikey: key, Authorization: `Bearer ${key}` };
      const hr = await fetch(`${SUPABASE_URL}/rest/v1/holds?id=eq.${encodeURIComponent(m.hold_id)}&select=items`, { headers: hdrs });
      const holdRows = await hr.json();
      const holdItems = (holdRows[0] && holdRows[0].items) || [];
      const wanted = holdItems
        .filter((it) => it.activity_id)
        .map((it) => `${(it.camper || "").toLowerCase()}|${it.activity_id}`);
      if (wanted.length) {
        const or = await fetch(
          `${SUPABASE_URL}/rest/v1/orders?email=ilike.${encodeURIComponent(m.email || "")}&plan=eq.subscription&status=in.(paid,confirmed,complete,succeeded)&select=id,stripe_payment_intent,order_items(camper_name,activity_id)`,
          { headers: hdrs }
        );
        const prior = (await or.json()) || [];
        const dupe = prior.find((o) =>
          o.stripe_payment_intent !== pi.id &&
          (o.order_items || []).some((oi) => wanted.includes(`${(oi.camper_name || "").toLowerCase()}|${oi.activity_id}`))
        );
        if (dupe) {
          console.log(`duplicate class enrollment ignored: ${pi.id} matches order ${dupe.id}`);
          return new Response("duplicate enrollment ignored", { status: 200 });
        }
      }
    } catch (e) {
      // Guard failure must never block a legitimate enrollment — fall through.
      console.error("dupe guard failed:", e.message);
    }
  }

  try {
    const nItems = parseInt(m.n_items || "0", 10) || 0;
    let unitPrices;
    if (m.unit_prices) {
      try { unitPrices = JSON.parse(m.unit_prices); } catch { unitPrices = []; }
    } else {
      unitPrices = Array.from({ length: nItems }, () => parseInt(m.unit_cents || "0", 10));
    }

    const orderId = await serviceRpc("confirm_order", {
      p_hold_id: m.hold_id,
      p_email: m.email || "",
      p_parent_name: m.parent_name || null,
      p_plan: m.plan,
      p_amount_today_cents: pi.amount_received ?? pi.amount ?? 0, // SetupIntents carry no amount
      p_total_cents: parseInt(m.total_cents || "0", 10),
      p_installment_cents: parseInt(m.installment_cents || "0", 10) || null,
      p_stripe_payment_intent: pi.id,
      p_stripe_customer: typeof pi.customer === "string" ? pi.customer : pi.customer?.id,
      p_unit_prices: unitPrices,
    });

    // Save the parent's name so future checkouts prefill it.
    if (m.parent_name && m.email) {
      try {
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
        await fetch(`${SUPABASE_URL}/rest/v1/families?email=ilike.${encodeURIComponent(m.email)}`, {
          method: "PATCH",
          headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ parent_name: m.parent_name }),
        });
      } catch (e) { console.error("parent_name save failed:", e.message); }
    }

    const paymentMethodId = typeof pi.payment_method === "string"
      ? pi.payment_method : pi.payment_method?.id;
    const customerId = typeof pi.customer === "string" ? pi.customer : pi.customer?.id;

    // Class enrollment: create the ongoing $--/month subscription.
    // First month was charged via the PaymentIntent. Every recurring pull must
    // land on the 1st (CJ): anchor the first recurring invoice to the later of
    // the season anchor (Oct 1, 2026) or the 1st of next month — so early
    // signups start Oct 1 and mid-season signups still bill on the 1st.
    if (m.plan === "subscription") {
      let monthly = [];
      try { monthly = JSON.parse(m.monthly_items || "[]"); } catch {}
      if (monthly.length) {
        await ensureProduct(stripe, CLASS_PRODUCT_ID, "NOVAPA Season Class — Monthly Tuition");
        const nowUTC = new Date();
        const firstOfNextMonth = Math.floor(
          Date.UTC(nowUTC.getUTCFullYear(), nowUTC.getUTCMonth() + 1, 1, 4, 0, 0) / 1000);
        const trialEnd = Math.max(CLASS_BILL_ANCHOR_UTC, firstOfNextMonth);
        const sub = await stripe.subscriptions.create({
          customer: customerId,
          default_payment_method: paymentMethodId || undefined,
          trial_end: trialEnd,
          cancel_at: CLASS_SEASON_END_UTC, // season ends after the Jun 1 pull
          proration_behavior: "none",
          items: monthly.map((cents) => ({
            quantity: 1,
            price_data: {
              currency: "usd", product: CLASS_PRODUCT_ID,
              recurring: { interval: "month" }, unit_amount: cents,
            },
          })),
          metadata: { order_id: String(orderId), payment_intent: pi.id },
        });
        await serviceRpc("set_order_schedule", { p_order_id: orderId, p_schedule: sub.id });
      }
    }

    if (m.plan === "deposit" && parseInt(m.installment_cents || "0", 10) > 0) {
      await ensureProduct(stripe, INSTALLMENT_PRODUCT_ID, "NOVAPA Program — Monthly Installment");
      const paymentMethod = typeof pi.payment_method === "string"
        ? pi.payment_method : pi.payment_method?.id;
      const nInst = parseInt(m.n_installments || "0", 10) || 0;
      const firstInst = parseInt(m.first_installment_utc || "0", 10) || 0;
      if (!nInst || !firstInst) throw new Error("deposit plan missing installment schedule");
      const schedule = await stripe.subscriptionSchedules.create({
        customer: typeof pi.customer === "string" ? pi.customer : pi.customer?.id,
        start_date: firstInst,
        end_behavior: "cancel",
        default_settings: paymentMethod
          ? { default_payment_method: paymentMethod,
              collection_method: "charge_automatically" }
          : undefined,
        metadata: { order_id: String(orderId), payment_intent: pi.id },
        phases: [{
          iterations: nInst,
          proration_behavior: "none",
          items: [{
            quantity: 1,
            price_data: {
              currency: "usd",
              product: INSTALLMENT_PRODUCT_ID,
              recurring: { interval: "month" },
              unit_amount: parseInt(m.installment_cents, 10),
            },
          }],
        }],
      });
      await serviceRpc("set_order_schedule", {
        p_order_id: orderId, p_schedule: schedule.id,
      });
    }
    // post-confirm side effects — never fail the webhook over these
    try {
      // record camper x camp so the double-book guard blocks repeat purchases
      const holdItems = await serviceRpc("hold_items_admin", { p_hold_id: m.hold_id });
      if (Array.isArray(holdItems) && holdItems.length) {
        await serviceRpc("mark_registered", { p_email: m.email || "", p_items: holdItems });
      }
    } catch (e) { console.error("mark_registered failed:", e.message); }
    if (m.coupon) {
      // coupon_cents is what the order actually applied; a credit is spent down
      // by exactly that, so an unused balance survives for the next purchase
      try {
        await serviceRpc("redeem_coupon", {
          p_code: m.coupon,
          p_applied_cents: parseInt(m.coupon_cents || "0", 10) || 0,
        });
      } catch (e) { console.error("coupon redeem failed:", e.message); }
    }
    if (m.ref_code && m.ref_referrer && m.email) {
      // referral reward: both families earn 2 any-show tickets. The unique
      // constraint on referred_email makes retries and repeat orders no-ops.
      try {
        const rk = process.env.SUPABASE_SERVICE_ROLE_KEY;
        await fetch(`${SUPABASE_URL}/rest/v1/referral_rewards?on_conflict=referred_email`, {
          method: "POST",
          headers: { apikey: rk, Authorization: `Bearer ${rk}`,
                     "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates" },
          body: JSON.stringify({
            ref_code: m.ref_code, referrer_email: m.ref_referrer,
            referred_email: (m.email || "").toLowerCase(),
          }),
        });
      } catch (e) { console.error("referral reward failed:", e.message); }
    }
    // Day Camp Credit Pack: pack purchases grant per-camper credits, redeemed
    // credits deduct. apply_credit_events is keyed by payment intent, so
    // webhook redeliveries apply exactly once.
    try {
      const grants = JSON.parse(m.credit_grants || "[]");
      const redemptions = JSON.parse(m.credit_redeems || "[]");
      if ((grants.length || redemptions.length) && m.email) {
        const rk = process.env.SUPABASE_SERVICE_ROLE_KEY;
        await fetch(`${SUPABASE_URL}/rest/v1/rpc/apply_credit_events`, {
          method: "POST",
          headers: { apikey: rk, Authorization: `Bearer ${rk}`, "Content-Type": "application/json" },
          body: JSON.stringify({ p_pi: pi.id, p_email: m.email, p_detail: { grants, redemptions } }),
        });
      }
    } catch (e) { console.error("credit events failed:", e.message); }
    // internal heads-up to the admin list (Todd/CJ) — one email per order,
    // failure-isolated like everything else post-payment
    try {
      const key2 = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const ar = await fetch(`${SUPABASE_URL}/rest/v1/admin_emails?select=email`, {
        headers: { apikey: key2, Authorization: `Bearer ${key2}` },
      });
      const admins = (await ar.json()).map((r) => r.email).filter(Boolean);
      if (admins.length) {
        const { default: nodemailer } = await import("nodemailer");
        const t2 = nodemailer.createTransport({
          host: "smtp.gmail.com", port: 465, secure: true,
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        });
        // Sawyer-detail admin receipt (Todd, Aug 3): full line items with
        // prices, every fee/discount, the payment schedule, and a Stripe link.
        const paid = ((pi.amount_received ?? pi.amount) / 100).toFixed(2);
        const total = ((parseInt(m.total_cents || "0", 10) || 0) / 100).toFixed(2);
        const usd = (c) => "$" + ((parseInt(c || "0", 10) || 0) / 100).toFixed(2);
        let units = [];
        try { units = JSON.parse(m.unit_prices || "[]"); } catch {}
        const lines = (m.order_desc || "").split("; ");
        const itemRows = lines.map((ln, i) =>
          `<tr><td style="padding:3px 14px 3px 0">${ln}</td><td align="right">${units[i] != null ? usd(units[i]) : ""}</td></tr>`).join("");
        const subtotalCents = units.reduce((a, b) => a + (b || 0), 0);
        const nInst = parseInt(m.n_installments || "0", 10) || 0;
        const instCents = parseInt(m.installment_cents || "0", 10) || 0;
        const firstInst = parseInt(m.first_installment_utc || "0", 10) || 0;
        const remaining = Math.max(0, (parseInt(m.total_cents || "0", 10) || 0) - Math.round(parseFloat(paid) * 100));
        const moneyRows = [
          [`Subtotal`, usd(subtotalCents)],
          m.coupon ? [`Coupon ${m.coupon}`, "−" + usd(m.coupon_cents)] : null,
          (parseInt(m.plan_fee_cents || "0", 10) || 0) ? [`Payment plan fee (5%)`, usd(m.plan_fee_cents)] : null,
          m.insured === "1" ? [`Tuition insurance`, usd(m.insurance_cents)] : null,
          [`<b>Order total</b>`, `<b>${usd(m.total_cents)}</b>`],
          [`Paid today`, `$${paid}`],
          remaining ? [`Remaining balance`, usd(remaining)] : null,
          nInst ? [`Schedule`, `${nInst} × ${usd(instCents)} monthly, first ${new Date(firstInst * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`] : null,
          m.first_month_free === "1" ? [`First month free`, "card saved, billing starts Oct 1"] : null,
          [`FSA eligible`, m.fsa_eligible === "1" ? "yes" : "no"],
        ].filter(Boolean).map(([k, v]) =>
          `<tr><td style="padding:3px 14px 3px 0;color:#555">${k}</td><td align="right">${v}</td></tr>`).join("");
        await t2.sendMail({
          from: `NOVAPA Registrations <${process.env.SMTP_USER}>`,
          to: admins.join(", "),
          subject: `New registration: ${m.parent_name || m.email} — $${paid} (${m.plan})`,
          html: [
            `<b>${m.parent_name || "(no name)"}</b> &lt;${m.email}&gt; · plan: <b>${m.plan}</b>`,
            `<table style="border-collapse:collapse;font-size:14px">${itemRows}<tr><td colspan="2" style="border-top:1px solid #ddd;padding:0;height:6px"></td></tr>${moneyRows}</table>`,
            `<a href="https://dashboard.stripe.com/payments/${pi.id}">View payment in Stripe</a> · ` +
            `<a href="https://www.northernvirginiaperformingarts.org/register/admin/">Admin dashboard</a>`,
          ].join("<br><br>"),
        });
      }
    } catch (e) { console.error("admin notify failed:", e.message); }
    try { await sendConfirmationEmail(m, pi); }
    catch (e) { console.error("confirmation email failed:", e.message); }

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("reg-webhook error:", err.message);
    // Money moved but the order didn't happen — that must never be silent
    // again (the Jul 29-Aug 7 class-enrollment bug ran 9 days unseen because
    // failures only showed in Stripe's retry log). Alert the admins with
    // enough context to act; alert failure itself must not mask the 500.
    try {
      if (process.env.SMTP_USER && process.env.SMTP_PASS) {
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const ar = await fetch(`${SUPABASE_URL}/rest/v1/admin_emails?select=email`, {
          headers: { apikey: key, Authorization: `Bearer ${key}` },
        });
        const admins = (await ar.json()).map((r) => r.email).filter(Boolean);
        if (admins.length) {
          const { default: nodemailer } = await import("nodemailer");
          const t = nodemailer.createTransport({
            host: "smtp.gmail.com", port: 465, secure: true,
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
          });
          const md = (pi && pi.metadata) || {};
          await t.sendMail({
            from: `NOVAPA Alerts <${process.env.SMTP_USER}>`,
            to: admins.join(", "),
            subject: `WEBHOOK FAILED: payment without order — ${md.email || "unknown"}`,
            html: [
              `A Stripe event was received but order creation FAILED. The customer paid (or saved a card) and got nothing.`,
              `<b>Error:</b> ${String(err.message || err).slice(0, 300)}`,
              `<b>Customer:</b> ${md.email || "?"} · <b>plan:</b> ${md.plan || "?"} · <b>desc:</b> ${md.order_desc || "?"}`,
              `<b>Payment intent:</b> ${pi ? pi.id : "?"} — <a href="https://dashboard.stripe.com/payments/${pi ? pi.id : ""}">open in Stripe</a>`,
              `Stripe will auto-retry for up to 3 days; if this alert repeats for the same intent, the failure is persistent and needs a code/data fix before the retries run out.`,
            ].join("<br><br>"),
          });
        }
      }
    } catch (mailErr) { console.error("failure alert email failed:", mailErr.message); }
    // 500 -> Stripe retries; confirm_order is idempotent on payment_intent id.
    return new Response("error", { status: 500 });
  }
};

export const config = { path: "/api/reg-webhook" };
