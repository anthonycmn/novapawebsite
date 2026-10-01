// Money heads-ups for CJ and Todd (CJ, Sep 30 2026): "anytime a payment is
// pulled, someone abandons a cart, a payment is made, a payment is late, a
// payment is declined, Todd and I want those emails."
//
// The checkout already sends "New registration" to admin_emails. What never
// reached anyone was everything after checkout: the monthly pulls on saved
// cards (Stripe's own "Payment of $125.00" notice was the only trace, and it
// reads like a registration that never arrived), the declines, and the carts
// people walked away from. This module is the shared piece: who gets them,
// the send-once claim, and the two Stripe invoice emails. reg-webhook.mjs
// calls the invoice ones; reg-cart-alert.mjs sends the abandoned carts.
//
// Recipients: MONEY_ALERT_TO (comma list), default CJ and Todd. Not the whole
// admin_emails list on purpose: that list includes staff who get the
// registration emails but were never asked to get every card decline.
//
// Send-once: Stripe redelivers events, and scheduled functions can overlap,
// so every alert first claims a key in public.lead_alert_sends (a text
// primary key, the same claim reg-leads-alert.mjs uses for leads). Only the
// caller whose INSERT comes back sends. Keys here are prefixed ("inv-paid:",
// "inv-failed:", "cart:") so they can never collide with a lead's uuid.
import { SUPABASE_URL } from "./reg-config.mjs";
import { sendMail, mailConfigured, logMailFailure } from "./reg-mail.mjs";

export function moneyAlertRecipients() {
  return (process.env.MONEY_ALERT_TO || "cj@novapa.org,todd@novapa.org")
    .split(",").map((s) => s.trim()).filter(Boolean);
}

// Abandoned carts go wider (CJ, Sep 30 2026): Jen and Katie Rivers work the
// call list, so they get the cart emails. Money emails stay CJ and Todd.
export function cartAlertRecipients() {
  return (process.env.CART_ALERT_TO ||
    "cj@novapa.org,todd@novapa.org,jen@novapa.org,katie@novapa.org")
    .split(",").map((s) => s.trim()).filter(Boolean);
}

export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

const usd = (cents) => "$" + ((Number(cents) || 0) / 100).toFixed(2);

const day = (unix) => new Date(unix * 1000).toLocaleDateString("en-US", {
  weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York",
});

// true when this caller won the key and should send; false when someone
// already did (or the claim table is unreachable, in which case staying
// quiet beats sending the same email on every retry).
export async function claimOnce(key) {
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!svc) return false;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/lead_alert_sends?on_conflict=lead_id`, {
    method: "POST",
    headers: {
      apikey: svc, Authorization: `Bearer ${svc}`, "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=representation",
    },
    body: JSON.stringify({ lead_id: key }),
  });
  if (!r.ok) return false;
  const won = await r.json();
  return Array.isArray(won) && won.length > 0;
}

// Give a key back after a failed send so the next delivery or tick retries.
export async function releaseClaim(key) {
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!svc) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/lead_alert_sends?lead_id=eq.${encodeURIComponent(key)}`, {
      method: "DELETE", headers: { apikey: svc, Authorization: `Bearer ${svc}` },
    });
  } catch (e) { console.error("claim release failed:", e.message); }
}

// Claim, send, and on a failed send release and log. Never throws: these run
// after the money has already been recorded.
export async function sendMoneyAlert(key, { fromName, subject, html, kind, fn, to }) {
  if (!mailConfigured()) return false;
  if (!(await claimOnce(key))) return false;
  try {
    await sendMail({ fromName, to: to || moneyAlertRecipients(), replyTo: "info@novapa.org", subject, html });
    return true;
  } catch (e) {
    console.error(`${kind} alert failed:`, e.message);
    await releaseClaim(key);
    await logMailFailure({ fn, kind, error: e });
    return false;
  }
}

function who(inv) {
  const name = inv.customer_name || "";
  const email = inv.customer_email || "";
  return { name, email, label: name || email || "unknown customer" };
}

function lineRows(inv) {
  const lines = (inv.lines && inv.lines.data) || [];
  return lines.map((l) =>
    `<tr><td style="padding:3px 14px 3px 0">${esc(l.description || "")}</td><td align="right">${usd(l.amount)}</td></tr>`).join("");
}

function wrap(title, color, rows, links) {
  return `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;max-width:620px">
<div style="font:700 19px/1.3 Helvetica,Arial,sans-serif;color:${color}">${title}</div>
<table style="border-collapse:collapse;font-size:14px;margin-top:12px">${rows}</table>
<div style="margin-top:16px">${links}</div></div>`;
}

const kv = (k, v) =>
  `<tr><td style="padding:3px 14px 3px 0;color:#555">${k}</td><td>${v}</td></tr>`;

const familyRow = (p) =>
  kv("Family", `<b>${esc(p.name || "(no name on file)")}</b> &lt;${esc(p.email || "?")}&gt;`);

// charge.dispute.created: a family asked their bank to reverse a charge.
// Stripe decides against us automatically if nobody submits evidence by the
// due date, so the date leads the email.
export async function alertDispute(dispute, p = {}) {
  const due = dispute.evidence_details?.due_by;
  const rows = [
    familyRow(p),
    kv("Amount", `<b>${usd(dispute.amount)}</b> (held from our balance now)`),
    kv("Bank's reason", esc(String(dispute.reason || "unknown").replace(/_/g, " "))),
    due ? kv("Respond by", `<b style="color:#B3261E">${day(due)}</b>`) : "",
    p.what ? kv("Charge was for", esc(p.what)) : "",
  ].join("");
  return sendMoneyAlert(`dispute:${dispute.id}`, {
    fn: "reg-webhook", kind: "admin_dispute",
    fromName: "NOVAPA Payments",
    subject: `CHARGEBACK: ${p.label || p.email || "a family"}, ${usd(dispute.amount)}` +
      (due ? `, respond by ${day(due)}` : ""),
    html: wrap("Chargeback opened", "#B3261E", rows,
      `If nobody responds in Stripe by the date above, the bank gives the money back to the family automatically. ` +
      `Upload the registration, the policy they agreed to, and any emails.<br><br>` +
      `<a href="https://dashboard.stripe.com/disputes/${dispute.id}">Respond in Stripe</a>`),
  });
}

// refund.created: money went back to a family, whoever clicked it.
export async function alertRefund(refund, p = {}) {
  const rows = [
    familyRow(p),
    kv("Refunded", `<b>${usd(refund.amount)}</b>` +
      (p.chargeAmount ? ` of the original ${usd(p.chargeAmount)}` : "")),
    refund.reason ? kv("Reason", esc(String(refund.reason).replace(/_/g, " "))) : "",
    p.what ? kv("Original charge", esc(p.what)) : "",
    kv("Status", esc(refund.status || "")),
  ].join("");
  return sendMoneyAlert(`refund:${refund.id}`, {
    fn: "reg-webhook", kind: "admin_refund",
    fromName: "NOVAPA Payments",
    subject: `Refund issued: ${p.label || p.email || "a family"}, ${usd(refund.amount)}`,
    html: wrap("Refund issued", "#8A5A00", rows,
      refund.charge ? `<a href="https://dashboard.stripe.com/payments/${esc(p.paymentIntent || refund.charge)}">View in Stripe</a>` : ""),
  });
}

// customer.subscription.deleted, only when it ended EARLY: a family or staff
// member cancelled, or Stripe gave up after declines. Plans that ran their
// course (a class membership reaching its season-end cancel_at, a payment
// schedule after its last installment) are the normal ending and say nothing.
export async function alertSubscriptionEnded(sub, p = {}) {
  const reason = sub.cancellation_details?.reason || "";
  const why = reason === "payment_failed"
    ? "Stripe cancelled it after the card kept declining"
    : reason === "payment_disputed"
      ? "Stripe cancelled it because of a chargeback"
      : "Cancelled (by the family through Stripe, or by staff in the dashboard)";
  const rows = [
    familyRow(p),
    p.what ? kv("Plan", esc(p.what)) : "",
    p.monthly ? kv("Monthly amount", `<b>${usd(p.monthly)}</b> no longer coming in`) : "",
    kv("Why", esc(why)),
    sub.cancellation_details?.comment ? kv("Their note", esc(sub.cancellation_details.comment)) : "",
    sub.start_date ? kv("Started", day(sub.start_date)) : "",
  ].join("");
  return sendMoneyAlert(`sub-ended:${sub.id}`, {
    fn: "reg-webhook", kind: "admin_subscription_ended",
    fromName: "NOVAPA Payments",
    subject: `Plan cancelled: ${p.label || p.email || "a family"}` + (p.monthly ? `, ${usd(p.monthly)}/month` : ""),
    html: wrap("Payment plan or class cancelled", "#B3261E", rows,
      `<a href="https://dashboard.stripe.com/subscriptions/${sub.id}">View in Stripe</a> · ` +
      `<a href="https://novapa.org/register/admin/">Admin dashboard</a>`),
  });
}

// invoice.paid with money in it: a monthly installment, class tuition, or a
// payment plan someone set up by hand in Stripe. $0 invoices (a class trial
// starting) are not payments and are skipped.
export async function alertInvoicePaid(inv, { orderId = null } = {}) {
  const amount = inv.amount_paid ?? 0;
  if (!amount) return false;
  const p = who(inv);
  const kindLabel = inv.billing_reason === "manual" ? "invoice" : "automatic monthly payment";
  const rows = [
    kv("Family", `<b>${esc(p.name || "(no name on file)")}</b> &lt;${esc(p.email)}&gt;`),
    kv("Amount", `<b>${usd(amount)}</b>`),
    kv("Type", `${kindLabel}, card on file`),
    kv("Paid", day(inv.status_transitions?.paid_at || inv.created)),
    orderId ? kv("Order", `#${esc(orderId)}`) : "",
  ].join("") + `<tr><td colspan="2" style="border-top:1px solid #ddd;height:6px"></td></tr>` + lineRows(inv);
  return sendMoneyAlert(`inv-paid:${inv.id}`, {
    fn: "reg-webhook", kind: "admin_payment_received",
    fromName: "NOVAPA Payments",
    subject: `Payment received: ${p.label}, ${usd(amount)}`,
    html: wrap("Payment received", "#1F7A38", rows,
      `<a href="https://dashboard.stripe.com/invoices/${inv.id}">View in Stripe</a> · ` +
      `<a href="https://novapa.org/register/admin/">Admin dashboard</a>`),
  });
}

// invoice.payment_failed: one email per attempt. Stripe retries on its own
// schedule; while it still will, this is a decline. Once it has stopped
// (next_payment_attempt empty), the payment is late and needs a person.
export async function alertInvoiceFailed(inv, { reason = "" } = {}) {
  const amount = inv.amount_due ?? inv.amount_remaining ?? 0;
  if (!amount) return false;
  const p = who(inv);
  const attempt = inv.attempt_count || 1;
  const late = !inv.next_payment_attempt;
  const status = late
    ? `<b>Stripe has stopped retrying. This payment is now late.</b> Call or email the family to update their card.`
    : `Stripe will try the card again on <b>${day(inv.next_payment_attempt)}</b>.`;
  const rows = [
    kv("Family", `<b>${esc(p.name || "(no name on file)")}</b> &lt;${esc(p.email)}&gt;`),
    kv("Amount", `<b>${usd(amount)}</b>`),
    kv("Attempt", String(attempt)),
    reason ? kv("Bank said", esc(reason)) : "",
    kv("Next", status),
  ].join("") + `<tr><td colspan="2" style="border-top:1px solid #ddd;height:6px"></td></tr>` + lineRows(inv);
  return sendMoneyAlert(`inv-failed:${inv.id}:${attempt}`, {
    fn: "reg-webhook", kind: "admin_payment_failed",
    fromName: "NOVAPA Payments",
    subject: late
      ? `LATE payment: ${p.label}, ${usd(amount)} (Stripe stopped retrying)`
      : `Payment DECLINED: ${p.label}, ${usd(amount)} (attempt ${attempt})`,
    html: wrap(late ? "Payment late" : "Payment declined", "#B3261E", rows,
      `<a href="https://dashboard.stripe.com/invoices/${inv.id}">View in Stripe</a>` +
      (inv.hosted_invoice_url ? ` · <a href="${esc(inv.hosted_invoice_url)}">Pay link to send the family</a>` : "")),
  });
}
