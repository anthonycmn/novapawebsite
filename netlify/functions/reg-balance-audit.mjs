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
//   1. STRIPE ↔ ORDERS. For every order Stripe bills again (a deposit plan's
//      schedule, a class membership's subscription), read the paid invoices
//      and hand each to record_installment_paid, the same idempotent write
//      the webhook does on invoice.paid, so a day where the webhook missed
//      nothing records nothing. The audit therefore heals the one thing it is
//      allowed to (a payment that happened) and reports the rest: an invoice
//      Stripe could not collect, a plan that stopped with money still owed.
//
//      Sep 20 2026: class memberships were left out of this query until now
//      (plan=eq.deposit), and record_installment_paid declined them anyway,
//      so the first tuition pull on Oct 1 would have had no record from either
//      path. The database side is db/registration/class-tuition-recorded.sql;
//      this side reads both plans. A class row is revenue against no balance,
//      so the "still owed" arithmetic below stays deposit-only.
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
import { getStore } from "@netlify/blobs";
import { withHeartbeat } from "./reg-heartbeat.mjs";

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
    "orders?select=id,order_no,email,plan,total_cents,amount_today_cents,installments_paid_cents,stripe_schedule" +
    "&plan=in.(deposit,subscription)&status=eq.paid&stripe_schedule=not.is.null");
  const deposits = orders.filter((o) => o.plan === "deposit").length;
  const classes = orders.length - deposits;
  const healed = [];   // installments recorded today that the webhook missed
  const failing = [];  // invoices Stripe is trying and failing to collect
  const stopped = [];  // plan cancelled/released with a balance still owed
  const unreadable = [];

  for (const o of orders) {
    // One order can carry several schedules, comma-joined (a plan split by
    // hand, Amy Ngo, order 15095, is two schedules on one order). A class
    // order carries its subscription id (sub_...) in the same column.
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
        // Only a deposit plan has a balance to be short of. A class
        // membership's tuition pays nothing down, and its subscription ending
        // is the season ending, not a plan stopping early.
        if (o.plan === "deposit") {
          const owed = o.total_cents - o.amount_today_cents - Math.max(o.installments_paid_cents, paidHere);
          if (schedStatus && ["canceled", "released", "completed"].includes(schedStatus) && owed > 1) {
            stopped.push({ ...o, schedule: schedId, status: schedStatus, cents: owed });
          }
        }
      } catch (e) {
        unreadable.push({ ...o, schedule: schedId, error: e.message });
      }
    }
  }
  return { orders: orders.length, deposits, classes, healed, failing, stopped, unreadable };
}

// ---- the email -----------------------------------------------------------

const cell = (s, extra = "") =>
  `<td style="padding:7px 10px 7px 0;font:13px/1.45 Helvetica,Arial,sans-serif;color:#0B1422;vertical-align:top;${extra}">${s}</td>`;
const section = (title, rows, blurb) => rows.length ? `
<div style="font:700 15px/1.3 Helvetica,Arial,sans-serif;color:#0B1422;margin-top:22px">${esc(title)} <span style="color:#9E2B2B">(${rows.length})</span></div>
${blurb ? `<div style="font:13px/1.6 Helvetica,Arial,sans-serif;color:#5B6472;margin-top:4px">${blurb}</div>` : ""}
<table style="width:100%;border-collapse:collapse;margin-top:8px">${rows.join("")}</table>` : "";

// ---- one send a day ------------------------------------------------------
//
// Sep 17 and Sep 18 2026 the audit arrived twice, 50 and 44 seconds apart,
// identical. The schedule is a single "0 11 * * *", so the platform invoked
// it twice: scheduled functions are at-least-once, not exactly-once. No money
// risk, record_installment_paid is idempotent, but CJ reads two of the same
// email and stops trusting the one that matters.
//
// So the day is claimed in a blob before the send, strongly consistent so a
// second invocation reads the first one's claim. A claim that is still
// "sending" after STALE_MS belongs to a run that died, and the next
// invocation takes it: better a duplicate than a morning with no audit.
// Same reason the whole guard is wrapped: if Blobs is unavailable, send.
const CLAIM_STORE = "reg-audit";
const STALE_MS = 10 * 60 * 1000;

const etDay = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

function claimStore() {
  return getStore({ name: CLAIM_STORE, consistency: "strong" });
}

// Returns null when this run should send, or a reason string when it must not.
async function claimToday() {
  try {
    const store = claimStore();
    const key = `sent-${etDay()}`;
    const prev = JSON.parse((await store.get(key)) || "null");
    if (prev?.state === "sent") return `already sent today at ${prev.at}`;
    if (prev?.state === "sending" && Date.now() - Date.parse(prev.at) < STALE_MS) {
      return `another run started at ${prev.at}`;
    }
    await store.set(key, JSON.stringify({ state: "sending", at: new Date().toISOString() }));
  } catch (e) {
    console.log(`balance audit: claim unavailable (${e.message}), sending anyway`);
  }
  return null;
}

async function markClaim(state) {
  try {
    const store = claimStore();
    const key = `sent-${etDay()}`;
    if (state === "sent") {
      await store.set(key, JSON.stringify({ state: "sent", at: new Date().toISOString() }));
    } else {
      // The send failed. Drop the claim so the next invocation retries.
      await store.delete(key);
    }
  } catch (e) {
    console.log(`balance audit: could not record the claim (${e.message})`);
  }
}

async function runAudit(resend) {
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
Checked ${s.deposits} deposit plan${s.deposits === 1 ? "" : "s"} and ${s.classes} class membership${s.classes === 1 ? "" : "s"} against Stripe, and every paid order line against the parent portal.
${s.healed.length ? `<b>Recorded ${s.healed.length} payment${s.healed.length === 1 ? "" : "s"} (${usd(s.healed.reduce((t, h) => t + h.cents, 0))}) the webhook had not</b>: deposit balances are corrected on the next sync; nothing for you to do.` : "Stripe and the orders already agreed."}
</div>
${section("Payment Stripe cannot collect", s.failing.map((f) => rowOrder(f, `${usd(f.cents)} ${f.plan === "subscription" ? "tuition" : "installment"} ${esc(f.status)}, ${f.attempts || 0} attempt${f.attempts === 1 ? "" : "s"}${f.next ? `, next ${esc(f.next)}` : ", no retry scheduled"} · <a href="https://dashboard.stripe.com/invoices/${f.invoice}">invoice</a>`)),
  "The card was declined. Stripe retries for a while, then gives up; the family may need a new card.")}
${section("Plan stopped with a balance owed", s.stopped.map((x) => rowOrder(x, `${usd(x.cents)} still owed, schedule is ${esc(x.status)} · <a href="https://dashboard.stripe.com/subscription_schedules/${x.schedule}">schedule</a>`)),
  "The schedule will not bill again on its own.")}
${section("Could not read from Stripe", s.unreadable.map((x) => rowOrder(x, esc(x.error))), "")}
${Object.entries(label).map(([kind, [title, blurb]]) =>
  section(title, (byKind[kind] || []).map((p) => `<tr>${cell(`#${p.order_no}`)}${cell(esc(p.email))}${cell(`${p.camper ? `<b>${esc(p.camper)}</b> — ` : ""}${esc(p.detail)}`)}</tr>`), blurb)).join("")}
${s.healed.length ? section("Recorded today", s.healed.map((h) => rowOrder(h, `${usd(h.cents)} ${h.plan === "subscription" ? "class tuition" : "installment"} · <a href="https://dashboard.stripe.com/invoices/${h.invoice}">invoice</a>`)), "") : ""}
<div style="font:12.5px/1.7 Helvetica,Arial,sans-serif;color:#9AA1AC;margin-top:22px">
Runs every morning from netlify/functions/reg-balance-audit.mjs. Stripe is read-only here; the only write is recording a payment that already happened.</div></div>`;

  // The one-send-a-day claim is claimToday() at the top of the handler, held
  // in the strongly consistent "reg-audit" store and released by markClaim()
  // below. Two guards lived here for two days (#134 put an eventually
  // consistent "lead-alerts" key on this line; #137 added the strong one
  // without removing it). The older one never cleared on a Resend refusal, so
  // a morning whose send failed could not be retried that day. Gone.
  const to = (process.env.AUDIT_ALERT_TO || "cj@novapa.org").split(",").map((x) => x.trim()).filter(Boolean);
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resend}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "NOVAPA Alerts <leads@mail.novapa.org>", reply_to: "info@novapa.org", to, subject, html }),
  });
  if (!r.ok) {
    await markClaim("failed");
    return new Response(`resend ${r.status}`, { status: 200 });
  }
  await markClaim("sent");
  return new Response(`${subject}; healed ${s.healed.length}, portal ${(portal || []).length}`, { status: 200 });
}

const run = async () => {
  if (process.env.CONTEXT && process.env.CONTEXT !== "production") {
    return new Response("skipped: non-production", { status: 200 });
  }
  const resend = process.env.RESEND_API_KEY;
  if (!resend || !process.env.SUPABASE_SERVICE_ROLE_KEY ||
      !(process.env.STRIPE_READ_KEY || process.env.STRIPE_SECRET_KEY)) {
    return new Response("not configured", { status: 200 });
  }

  const skip = await claimToday();
  if (skip) return new Response(`skipped: ${skip}`, { status: 200 });

  try {
    return await runAudit(resend);
  } catch (e) {
    // A run that died holds no claim: a platform retry, or any later
    // invocation the same morning, still has to be able to send.
    await markClaim("failed");
    throw e;
  }
};

// 11:00 UTC = 7am EDT / 6am EST, before the office opens.
export default withHeartbeat("reg-balance-audit", run);

export const config = { schedule: "0 11 * * *" };
