// POST /api/reg-webhook — Stripe webhook.
// payment_intent.succeeded -> confirm the order in Supabase (service role),
// and for deposit plans create the 8-installment subscription schedule.
import Stripe from "stripe";
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
const GOLD = "#C8892A", NAVY = "#0F1E36";
function money(cents) {
  return "$" + (cents / 100).toLocaleString("en-US",
    { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
}
function confirmationHtml(m, pi) {
  const items = (m.order_desc || "").split("; ").filter(Boolean);
  const today = pi.amount_received ?? pi.amount;
  const total = parseInt(m.total_cents || "0", 10) || today;
  const nInst = parseInt(m.n_installments || "0", 10) || 0;
  const instCents = parseInt(m.installment_cents || "0", 10) || 0;
  const firstInst = parseInt(m.first_installment_utc || "0", 10) || 0;
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  let planLine = "Paid in full — no future charges.";
  if (m.plan === "deposit" && nInst && firstInst) {
    const d = new Date(firstInst * 1000);
    planLine = `Then ${nInst} monthly payments of ${money(instCents)}, automatic on your card, ` +
      `starting ${months[d.getUTCMonth()]} 1, ${d.getUTCFullYear()} — fully paid before your program begins.`;
  } else if (m.plan === "subscription") {
    planLine = "Monthly tuition continues automatically on the 1st of each month through June 1, 2027. Cancel anytime with 30 days' notice.";
  }
  const rows = items.map((it) =>
    `<tr><td style="padding:10px 0;border-bottom:1px solid #eee8dd;font-size:15px;color:#2a2a2a">${it}</td></tr>`
  ).join("");
  const couponRow = m.coupon
    ? `<tr><td style="padding:6px 0;font-size:14px;color:#2e7d4f">Coupon ${m.coupon}: −${money(parseInt(m.coupon_cents || "0", 10))}</td></tr>` : "";
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f5f2ec;font-family:Georgia,'Times New Roman',serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f2ec;padding:28px 12px"><tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e7e0d2">
      <tr><td style="background:${NAVY};padding:26px 32px;text-align:center">
        <div style="font-family:Georgia,serif;font-size:22px;letter-spacing:0.25em;color:#ffffff">NOVA<span style="color:#E8B84B">PA</span></div>
        <div style="font-size:12px;letter-spacing:0.18em;color:#c9b47a;text-transform:uppercase;margin-top:6px">Registration Confirmed</div>
      </td></tr>
      <tr><td style="padding:30px 32px 8px">
        <p style="margin:0 0 16px;font-size:16px;color:#2a2a2a">Hi${m.parent_name ? " " + m.parent_name.split(" ")[0] : ""},</p>
        <p style="margin:0 0 18px;font-size:15px;color:#444;line-height:1.6">You're in! Here's what we have for your family:</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
      </td></tr>
      <tr><td style="padding:14px 32px 6px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf7f0;border:1px solid #eee5d2;border-radius:10px">
          <tr><td style="padding:16px 18px">
            ${couponRow ? '<table role="presentation" width="100%">' + couponRow + "</table>" : ""}
            <div style="font-size:15px;color:#2a2a2a"><b>Paid today: ${money(today)}</b>${total > today ? " &nbsp;·&nbsp; Program total: " + money(total) : ""}</div>
            <div style="font-size:13.5px;color:#666;margin-top:6px;line-height:1.5">${planLine}</div>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:18px 32px 6px">
        <p style="margin:0;font-size:13.5px;color:#555;line-height:1.7">
          Programs are held at the National Conference Center, 18980 Upper Belmont Place, Leesburg, VA 20176.<br>
          ${m.fsa_eligible === "1" ? 'Using a Dependent Care FSA? Print your dependent-care receipt from your confirmation page (Tax ID 99-1421341).<br>' : ""}
          All sales are final — full policies at <a href="https://www.northernvirginiaperformingarts.org/policies" style="color:${GOLD}">novapa.org/policies</a>.
        </p>
      </td></tr>
      <tr><td style="padding:20px 32px 26px">
        <p style="margin:0;font-size:13px;color:#999;line-height:1.6;border-top:1px solid #eee8dd;padding-top:16px">
          Northern Virginia Performing Arts · Leesburg, VA<br>
          <a href="mailto:info@novapa.org" style="color:${GOLD}">info@novapa.org</a> · (571) 571-2120
        </p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}
async function sendConfirmationEmail(m, pi) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS || !m.email) return;
  const { default: nodemailer } = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transporter.sendMail({
    from: `NOVAPA <${process.env.SMTP_USER}>`,
    to: m.email,
    subject: "You're in — NOVAPA registration confirmed",
    html: confirmationHtml(m, pi),
  });
}

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

  if (event.type !== "payment_intent.succeeded") {
    return new Response("ignored", { status: 200 });
  }

  const pi = event.data.object;
  const m = pi.metadata || {};
  if (!m.hold_id || !m.plan) return new Response("no metadata", { status: 200 });

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
      p_amount_today_cents: pi.amount_received ?? pi.amount,
      p_total_cents: parseInt(m.total_cents || "0", 10),
      p_installment_cents: parseInt(m.installment_cents || "0", 10) || null,
      p_stripe_payment_intent: pi.id,
      p_stripe_customer: typeof pi.customer === "string" ? pi.customer : pi.customer?.id,
      p_unit_prices: unitPrices,
    });

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
    if (m.coupon) {
      try { await serviceRpc("redeem_coupon", { p_code: m.coupon }); }
      catch (e) { console.error("coupon redeem failed:", e.message); }
    }
    try { await sendConfirmationEmail(m, pi); }
    catch (e) { console.error("confirmation email failed:", e.message); }

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("reg-webhook error:", err.message);
    // 500 -> Stripe retries; confirm_order is idempotent on payment_intent id.
    return new Response("error", { status: 500 });
  }
};

export const config = { path: "/api/reg-webhook" };
