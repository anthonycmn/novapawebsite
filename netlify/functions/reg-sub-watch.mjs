// Watches Stripe for subscriptions that will bill forever. Daily.
//
// Our own checkout has always been correct — reg-webhook.mjs sets
// cancel_at: CLASS_SEASON_END_UTC on every class subscription it creates. The
// open-ended ones found on Aug 27 2026 were all created OUTSIDE that path:
// Regpack migration rows and hand-made Stripe subscriptions. That is why
// auditing the code kept coming up short — the leak was never in the code.
//
// So this watches Stripe itself. A subscription with no cancel_at and no
// schedule bounding it has no stopping condition: it bills a family until a
// human notices. Two of those were live class memberships that would have
// charged for a July class that does not exist.
//
// Read-only. It cannot cancel anything — it tells a person, who decides.
import { getStore } from "@netlify/blobs";

const STORE = "lead-alerts";
const KEY = "openended-subs";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

async function stripe(path, params = {}) {
  const key = process.env.STRIPE_READ_KEY || process.env.STRIPE_SECRET_KEY;
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`https://api.stripe.com/v1/${path}${qs ? "?" + qs : ""}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const j = await r.json();
  if (j.error) throw new Error(`${path}: ${j.error.message}`);
  return j;
}

// A description like "2-Class Membership (MT Dance + MT Acting)" is a class and
// must stop in June. "Payment Plan - Stagelighter Bundle" is a balance and
// stops when it is paid. The distinction changes how urgent the row is.
const CLASSY = /\bclass|membership|\bdance\b|\bacting\b|season/i;

export default async () => {
  if (process.env.CONTEXT && process.env.CONTEXT !== "production") {
    return new Response("skipped: non-production", { status: 200 });
  }
  const resend = process.env.RESEND_API_KEY;
  if (!resend || !(process.env.STRIPE_READ_KEY || process.env.STRIPE_SECRET_KEY)) {
    return new Response("not configured", { status: 200 });
  }

  const subs = await stripe("subscriptions", { status: "all", limit: "100", "expand[]": "data.items.data.price" });
  const live = (subs.data || []).filter((s) =>
    !["canceled", "incomplete", "incomplete_expired", "unpaid"].includes(s.status));
  const open = live.filter((s) => !s.cancel_at && !s.schedule);

  const rows = [];
  for (const s of open) {
    const amount = (s.items?.data || []).reduce(
      (t, it) => t + (it.price?.unit_amount || 0) * (it.quantity || 1), 0);
    let desc = "", email = "";
    try {
      const inv = await stripe("invoices", { subscription: s.id, limit: "1" });
      desc = inv.data?.[0]?.lines?.data?.[0]?.description || "";
    } catch {}
    try {
      const c = await stripe(`customers/${s.customer}`);
      email = c.email || "";
    } catch {}
    rows.push({ id: s.id, amount, desc, email, status: s.status, isClass: CLASSY.test(desc) });
  }

  const store = getStore(STORE);
  let seen = [];
  try { seen = JSON.parse((await store.get(KEY)) || "[]"); } catch {}
  const isFirst = !seen.length;
  const fresh = rows.filter((r) => !seen.includes(r.id));

  // First run reports everything currently open-ended once, so the standing
  // backlog is seen rather than silently adopted. After that, only new ones.
  const report = isFirst ? rows : fresh;
  if (!report.length) {
    await store.set(KEY, JSON.stringify(rows.map((r) => r.id)));
    return new Response(`ok: ${rows.length} open-ended, none new`, { status: 200 });
  }

  const classes = report.filter((r) => r.isClass);
  const monthly = report.reduce((t, r) => t + r.amount, 0);
  const body = report
    .sort((a, b) => (b.isClass ? 1 : 0) - (a.isClass ? 1 : 0) || b.amount - a.amount)
    .map((r) => `<tr>
<td style="padding:9px 10px 9px 0;font:14px Helvetica,Arial,sans-serif;color:#0B1422;white-space:nowrap">$${(r.amount / 100).toFixed(2)}/mo</td>
<td style="padding:9px 10px 9px 0;font:14px Helvetica,Arial,sans-serif;color:#0B1422">${esc(r.email || r.id)}</td>
<td style="padding:9px 0;font:13px Helvetica,Arial,sans-serif;color:#5B6472">${esc(r.desc || "(no invoice yet)")}
${r.isClass ? '<b style="color:#9E2B2B"> — looks like a CLASS, should end Jun 30</b>' : ""}</td></tr>`).join("");

  const subject = classes.length
    ? `${classes.length} class subscription${classes.length > 1 ? "s" : ""} billing with no end date`
    : `${report.length} subscription${report.length > 1 ? "s" : ""} billing with no end date`;

  const to = (process.env.LEADS_ALERT_TO || "jason@novapa.org").split(",").map((s) => s.trim()).filter(Boolean);
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resend}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "NOVAPA Alerts <leads@mail.novapa.org>",
      to,
      subject,
      html: `<div style="max-width:620px;margin:0 auto;padding:26px 22px;font-family:Helvetica,Arial,sans-serif">
<div style="font:700 20px/1.3 Helvetica,Arial,sans-serif;color:#0B1422">Subscriptions with no stopping condition</div>
<div style="font:14px/1.7 Helvetica,Arial,sans-serif;color:#5B6472;margin-top:9px">
${isFirst ? "Everything currently open-ended, reported once so nothing is adopted silently."
          : `${report.length} new since the last check.`}
These have no <code>cancel_at</code> and no schedule, so they bill until someone stops them
&mdash; <b>$${(monthly / 100).toFixed(2)} per month</b>.</div>
<table style="width:100%;border-collapse:collapse;margin-top:14px">${body}</table>
${classes.length ? `<div style="font:14px/1.7 Helvetica,Arial,sans-serif;color:#0B1422;margin-top:16px;padding:13px 15px;background:#F6E4E4;border-radius:8px">
<b>${classes.length} of these look like classes.</b> A class subscription must end June 30 or a family pays for a July class that will not run.</div>` : ""}
<div style="font:12.5px/1.7 Helvetica,Arial,sans-serif;color:#9AA1AC;margin-top:18px">
Our checkout always sets an end date on class subscriptions. Anything appearing here was created outside it &mdash; a migration, or by hand in Stripe.</div></div>`,
    }),
  });
  if (!r.ok) return new Response(`resend ${r.status}`, { status: 200 });
  await store.set(KEY, JSON.stringify(rows.map((x) => x.id)));
  return new Response(`alerted ${report.length} (${classes.length} class-like)`, { status: 200 });
};

export const config = { schedule: "0 13 * * *" };
