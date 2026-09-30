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
export async function sendMoneyAlert(key, { fromName, subject, html, kind, fn }) {
  if (!mailConfigured()) return false;
  if (!(await claimOnce(key))) return false;
  try {
    await sendMail({ fromName, to: moneyAlertRecipients(), replyTo: "info@novapa.org", subject, html });
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
