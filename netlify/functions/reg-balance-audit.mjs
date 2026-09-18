// The daily registration audit. Every morning, to CJ.
//
// Sep 11 2026: Alida Perez paid the second half of her Frozen KIDS fee on
// Sep 4 and the parent portal went on saying she owed it for a week. It
// turned out every deposit-plan family was in that state — $16,760 of
// installments Stripe had collected that this database had never heard of —
// and a sibling bought a Day Camp Pack on Sep 7 was in no roster at all. CJ:
// "run an audit every single day ... make sure that balances in Stripe match
// the balances in the parent portal and that the children are signed up for
// the right programs."
//
// Two halves, in order, one email:
//
//   1. STRIPE ↔ ORDERS. For every deposit-plan order, read the paid invoices
//      on its schedule(s) and hand each to record_installment_paid — the
//      same idempotent write the webhook does on invoice.paid, so a day where
//      the webhook missed nothing records nothing. The audit therefore heals
//      the one thing it is allowed to (a payment that happened) and reports
//      the rest: an installment invoice Stripe could not collect, a plan that
//      stopped with money still owed.
//
//   2. ORDERS ↔ PARENT PORTAL. registration_portal_audit() in the database
//      (db/registration/portal_audit.sql): every paid line has a portal
//      enrollment, on the right child, in the right show or class, not
//      withdrawn, and the portal's balance for the order is the order's.
//      The portal sync runs every 15 minutes, so what this finds is what a
//      family has been looking at all night.
//
// Always sends — an "all clear" is the point on the mornings there is
// nothing to fix. Read-only against Stripe; a restricted read key is enough.
import { SUPABASE_URL } from "./reg-config.mjs";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
const usd = (c) => "$" + ((c || 0) / 100).toFixed(2);

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

async function db(path, init = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      "Content-Type": "application/json", ...(init.headers || {}),
    },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${path}: ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

// ---- half 1: Stripe ↔ orders ---------------------------------------------

async function auditStripe() {
  const orders = await db(
    "orders?select=id,order_no,email,total_cents,amount_today_cents,installments_paid_cents,stripe_schedule" +
    "&plan=eq.deposit&status=eq.paid&stripe_schedule=not.is.null");
  const healed = [];   // installments recorded today that the webhook missed
  const failing = [];  // invoices Stripe is trying and failing to collect
  const stopped = [];  // plan cancelled/released with a balance still owed
  const unreadable = [];

  for (const o of orders) {
    // One order can carry several schedules, comma-joined (a plan split by
    // hand — Amy Ngo, order 15095 — is two schedules on one order).
    const ids = String(o.stripe_schedule).split(",").map((s) => s.trim()).filter(Boolean);
    let paidHere = 0;
    for (const schedId of ids) {
      try {
        let subId = schedId;
        let schedStatus = null;
        if (schedId.startsWith("sub_sched_")) {
          const sched = await stripe(`subscription_schedules/${schedId}`);
          schedStatus = sched.status;
          subId = typeof sched.subscription === "string" ? sched.subscription : sched.subscription?.id;
        }
        if (!subId) continue; // not_started: nothing billed yet
        const inv = await stripe("invoices", { subscription: subId, limit: "24" });
        for (const i of inv.data || []) {
          if (i.status === "paid" && (i.amount_paid || 0) > 0) {
            paidHere += i.amount_paid;
            const recorded = await db("rpc/record_installment_paid", {
              method: "POST",
              body: JSON.stringify({
                p_order_id: o.id, p_invoice: i.id, p_amount_cents: i.amount_paid,
                p_paid_at: new Date((i.status_transitions?.paid_at || i.created) * 1000).toISOString(),
                p_schedule: schedId,
              }),
            });
            if (recorded === true) healed.push({ ...o, invoice: i.id, cents: i.amount_paid });
          } else if (["open", "past_due", "uncollectible"].includes(i.status) && (i.amount_due || 0) > 0) {
            failing.push({ ...o, invoice: i.id, cents: i.amount_due, attempts: i.attempt_count,
              next: i.next_payment_attempt ? new Date(i.next_payment_attempt * 1000).toLocaleDateString("en-US", { timeZone: "America/New_York" }) : null,
              status: i.status });
          }
        }
        const owed = o.total_cents - o.amount_today_cents - Math.max(o.installments_paid_cents, paidHere);
        if (schedStatus && ["canceled", "released", "completed"].includes(schedStatus) && owed > 1) {
          stopped.push({ ...o, schedule: schedId, status: schedStatus, cents: owed });
        }
      } catch (e) {
        unreadable.push({ ...o, schedule: schedId, error: e.message });
      }
    }
  }
  return { orders: orders.length, healed, failing, stopped, unreadable };
}

// ---- the email -----------------------------------------------------------

const cell = (s, extra = "") =>
  `<td style="padding:7px 10px 7px 0;font:13px/1.45 Helvetica,Arial,sans-serif;color:#0B1422;vertical-align:top;${extra}">${s}</td>`;
const section = (title, rows, blurb) => rows.length ? `
<div style="font:700 15px/1.3 Helvetica,Arial,sans-serif;color:#0B1422;margin-top:22px">${esc(title)} <span style="color:#9E2B2B">(${rows.length})</span></div>
${blurb ? `<div style="font:13px/1.6 Helvetica,Arial,sans-serif;color:#5B6472;margin-top:4px">${blurb}</div>` : ""}
<table style="width:100%;border-collapse:collapse;margin-top:8px">${rows.join("")}</table>` : "";

export default async () => {
  if (process.env.CONTEXT && process.env.CONTEXT !== "production") {
    return new Response("skipped: non-production", { status: 200 });
  }
  const resend = process.env.RESEND_API_KEY;
  if (!resend || !process.env.SUPABASE_SERVICE_ROLE_KEY ||
      !(process.env.STRIPE_READ_KEY || process.env.STRIPE_SECRET_KEY)) {
    return new Response("not configured", { status: 200 });
  }

  const s = await auditStripe();
  // Half 2 runs AFTER the heal so it judges the orders Stripe agrees with.
  const portal = await db("rpc/registration_portal_audit", { method: "POST", body: "{}" });

  const byKind = {};
  for (const p of portal || []) (byKind[p.kind] ||= []).push(p);
  const label = {
    not_in_portal: ["Paid, but not in the parent portal", "The family cannot see this child in this program."],
    wrong_child: ["Enrollment on a different child", "The portal enrollment is on a student whose name matches neither the order line nor its camper record."],
    wrong_program: ["Enrollment in the wrong program", "The portal has the child in a different show or class from the one that was bought."],
    withdrawn_but_paid: ["Paid, but the portal says withdrawn", ""],
    balance_mismatch: ["Portal balance differs from the order", "What the family sees as owed is not what the order (checkout + recorded installments) says. The sync runs every 15 minutes; if this persists, something is wrong in the hub."],
  };

  const issues = s.failing.length + s.stopped.length + s.unreadable.length + (portal || []).length;
  const subject = issues
    ? `Registration audit: ${issues} thing${issues === 1 ? "" : "s"} to look at`
    : `Registration audit: all clear`;

  const rowOrder = (o, extra) => `<tr>${cell(`#${o.order_no}`)}${cell(esc(o.email))}${cell(extra)}</tr>`;
  const html = `<div style="max-width:680px;margin:0 auto;padding:26px 22px;font-family:Helvetica,Arial,sans-serif">
<div style="font:700 20px/1.3 Helvetica,Arial,sans-serif;color:#0B1422">${issues ? "Registration audit" : "Registration audit — all clear"}</div>
<div style="font:14px/1.7 Helvetica,Arial,sans-serif;color:#5B6472;margin-top:9px">
${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/New_York" })}.
Checked ${s.orders} deposit-plan orders against Stripe and every paid order line against the parent portal.
${s.healed.length ? `<b>Recorded ${s.healed.length} installment${s.healed.length === 1 ? "" : "s"} (${usd(s.healed.reduce((t, h) => t + h.cents, 0))}) the webhook had not</b> — balances are corrected on the next sync; nothing for you to do.` : "Stripe and the orders already agreed."}
</div>
${section("Installment Stripe cannot collect", s.failing.map((f) => rowOrder(f, `${usd(f.cents)} ${esc(f.status)}, ${f.attempts || 0} attempt${f.attempts === 1 ? "" : "s"}${f.next ? `, next ${esc(f.next)}` : ", no retry scheduled"} · <a href="https://dashboard.stripe.com/invoices/${f.invoice}">invoice</a>`)),
  "The card was declined. Stripe retries for a while, then gives up; the family may need a new card.")}
${section("Plan stopped with a balance owed", s.stopped.map((x) => rowOrder(x, `${usd(x.cents)} still owed, schedule is ${esc(x.status)} · <a href="https://dashboard.stripe.com/subscription_schedules/${x.schedule}">schedule</a>`)),
  "The schedule will not bill again on its own.")}
${section("Could not read from Stripe", s.unreadable.map((x) => rowOrder(x, esc(x.error))), "")}
${Object.entries(label).map(([kind, [title, blurb]]) =>
  section(title, (byKind[kind] || []).map((p) => `<tr>${cell(`#${p.order_no}`)}${cell(esc(p.email))}${cell(`${p.camper ? `<b>${esc(p.camper)}</b> — ` : ""}${esc(p.detail)}`)}</tr>`), blurb)).join("")}
${s.healed.length ? section("Recorded today", s.healed.map((h) => rowOrder(h, `${usd(h.cents)} · <a href="https://dashboard.stripe.com/invoices/${h.invoice}">invoice</a>`)), "") : ""}
<div style="font:12.5px/1.7 Helvetica,Arial,sans-serif;color:#9AA1AC;margin-top:22px">
Runs every morning from netlify/functions/reg-balance-audit.mjs. Stripe is read-only here; the only write is recording a payment that already happened.</div></div>`;

  // Netlify scheduled ticks are at-least-once, so two invocations can race and
  // CJ gets the same audit twice, 44 seconds apart, which is what happened on
  // Sep 17 and Sep 18. Claim the day before sending, the way reg-send-watch
  // does. The claim goes here rather than at the top of the handler so a run
  // that fails while building the report does not burn the day: only a run
  // that is about to send takes the claim. A deliberate re-run needs this blob
  // key cleared.
  const { getStore } = await import("@netlify/blobs");
  const claims = getStore("lead-alerts");
  const claimKey = "audit-" + new Date().toISOString().slice(0, 10);
  if (await claims.get(claimKey)) return new Response("already sent today", { status: 200 });
  await claims.set(claimKey, String(Date.now()));

  const to = (process.env.AUDIT_ALERT_TO || "cj@novapa.org").split(",").map((x) => x.trim()).filter(Boolean);
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resend}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "NOVAPA Alerts <leads@mail.novapa.org>", to, subject, html }),
  });
  if (!r.ok) {
    // The claim above was made on the assumption this send would land. It did
    // not, so give the day back: an at-least-once tick that arrives seconds
    // later can still deliver the audit. Holding the claim here would cost CJ
    // the whole morning's audit over one refused API call.
    await claims.delete(claimKey).catch(() => {});
    return new Response(`resend ${r.status}`, { status: 200 });
  }
  return new Response(`${subject}; healed ${s.healed.length}, portal ${(portal || []).length}`, { status: 200 });
};

// 11:00 UTC = 7am EDT / 6am EST, before the office opens.
export const config = { schedule: "0 11 * * *" };
