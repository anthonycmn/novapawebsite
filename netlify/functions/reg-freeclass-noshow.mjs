// The $30 free-class no-show fee — scheduled, every 15 minutes.
//
// CJ, 24 Sep 2026: families save a card to book a free class, and "charge
// automatically on no-show", with free cancellation up to 24 hours before.
//
// What it does. A visit the teacher marked `no_show` on the register
// (free_class_bookings.status, via portal_mark_visit) whose booking saved a
// card is charged NO_SHOW_FEE_CENTS once, off-session, to that card, two
// hours after the class ends. The two hours are for the teacher: a child who
// walked in late and was re-marked Here in that window is never charged.
// Stripe emails the receipt (receipt_email).
//
// What it never does.
//   - Charges a visit booked before cards were collected (no card, no fee),
//     a canceled visit (status is `cancelled`, never `no_show`), or a visit
//     more than LOOKBACK_DAYS old: a mark corrected weeks later is the
//     office's call, not a machine's.
//   - Charges twice. no_show_fee_state is stamped `charging` as the claim
//     BEFORE the charge, and only rows with no state are picked up; the
//     Stripe idempotency key is the booking id, so even a claim that raced
//     would hit one payment.
//   - Retries a refused card. It is marked `failed` and the office is
//     emailed with the family's details, once.
//   - Runs when FREECLASS_NOSHOW_FEE=off is set in Netlify.
//
// To forgive a fee: refund it in Stripe and set no_show_fee_state='waived'.
// A fee not yet charged is forgiven by setting 'waived' before it runs, or by
// the teacher changing the mark to Here.
import Stripe from "stripe";
import { SUPABASE_URL } from "./reg-config.mjs";
import { CLASSES, NO_SHOW_FEE_CENTS } from "./reg-freeclass.mjs";
import { classEndsAt } from "./reg-freeclass-followup.mjs";
import { withHeartbeat } from "./reg-heartbeat.mjs";
import { sendMail } from "./reg-mail.mjs";

export const GRACE_MINUTES = 120;
export const LOOKBACK_DAYS = 7;

// When a no-show's fee may be charged: GRACE_MINUTES after its class ends.
export function feeDueAt(visit, hours) {
  const ends = classEndsAt(visit.class_date, hours, visit.cast_key);
  return ends ? new Date(ends.getTime() + GRACE_MINUTES * 60000) : null;
}

export function feeDescription(v) {
  const cls = CLASSES[v.cast_key];
  return `NOVAPA free class no-show fee: ${v.child_name}, ${cls ? cls.name : "class"} on ${v.class_date}`;
}

async function svc(path, init = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`db ${path} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

async function tellOffice(v, why) {
  const admins = await svc("admin_emails?select=email").then((rows) => (rows || []).map((r) => r.email).filter(Boolean)).catch(() => []);
  if (!admins.length) return;
  await sendMail({
    fromName: "NOVAPA Registrations",
    to: admins,
    subject: `No-show fee NOT charged: ${v.child_name}`,
    html: `<p><b>${v.child_name}</b> was marked a no-show for ${CLASSES[v.cast_key]?.name || "the free class"} on ${v.class_date}, `
      + `but the $${(NO_SHOW_FEE_CENTS / 100).toFixed(2)} fee to the card on file did not go through.</p>`
      + `<p>Parent: <b>${v.parent_name || "(no name)"}</b> &lt;${v.email}&gt;${v.phone ? ` · ${v.phone}` : ""}</p>`
      + `<p>Stripe said: ${String(why).slice(0, 200)}</p>`
      + `<p>It will not be retried. Collect it by hand or let it go (booking ${v.id}).</p>`,
  });
}

const run = async () => {
  if ((process.env.FREECLASS_NOSHOW_FEE || "").toLowerCase() === "off")
    return new Response("no-show fee: paused (FREECLASS_NOSHOW_FEE=off)", { status: 200 });
  if (!process.env.STRIPE_SECRET_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    return new Response("no-show fee: not configured", { status: 200 });

  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);
  const visits = await svc(
    `free_class_bookings?status=eq.no_show&stripe_payment_method_id=not.is.null&no_show_fee_state=is.null&class_date=gte.${since}` +
    `&select=id,parent_name,email,phone,child_name,cast_key,activity_id,class_date,stripe_customer_id,stripe_payment_method_id`);
  if (!visits?.length) return new Response("no-show fee: nothing due", { status: 200 });

  const ids = [...new Set(visits.map((v) => v.activity_id))];
  const hours = {};
  for (const a of await svc(`activities?id=in.(${ids.join(",")})&select=id,class_times`))
    hours[a.id] = a.class_times?.[0]?.primary_text?.[0] || null;

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const now = new Date();
  let charged = 0, waiting = 0, failed = 0;
  for (const v of visits) {
    const due = feeDueAt(v, hours[v.activity_id]);
    if (!due || due > now) { waiting++; continue; }
    // The claim: only a row still no_show with no state comes back.
    const claimed = await svc(`free_class_bookings?id=eq.${v.id}&status=eq.no_show&no_show_fee_state=is.null`, {
      method: "PATCH", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ no_show_fee_state: "charging", no_show_fee_at: now.toISOString() }),
    });
    if (!Array.isArray(claimed) || !claimed.length) continue;
    try {
      const pi = await stripe.paymentIntents.create({
        amount: NO_SHOW_FEE_CENTS, currency: "usd",
        customer: v.stripe_customer_id, payment_method: v.stripe_payment_method_id,
        off_session: true, confirm: true,
        payment_method_types: ["card", "link"],
        description: feeDescription(v),
        statement_descriptor_suffix: "NOVAPA",
        receipt_email: v.email,
        // no hold_id: reg-webhook acknowledges this and creates no order
        metadata: { kind: "free_class_no_show", free_class_booking_id: String(v.id), email: v.email },
      }, { idempotencyKey: `fc-noshow-${v.id}` });
      if (pi.status !== "succeeded") throw new Error(`payment ${pi.id} is ${pi.status}`);
      await svc(`free_class_bookings?id=eq.${v.id}`, {
        method: "PATCH", body: JSON.stringify({ no_show_fee_state: "charged", no_show_fee_pi: pi.id }),
      });
      charged++;
    } catch (e) {
      failed++;
      console.error(`no-show fee failed for booking ${v.id}:`, e.message);
      await svc(`free_class_bookings?id=eq.${v.id}`, {
        method: "PATCH",
        body: JSON.stringify({ no_show_fee_state: "failed", no_show_fee_note: String(e.message).slice(0, 300),
          no_show_fee_pi: e.raw?.payment_intent?.id || null }),
      }).catch(() => {});
      await tellOffice(v, e.message).catch((m) => console.error("no-show fee office mail failed:", m.message));
    }
  }
  return new Response(`no-show fee: charged ${charged}, failed ${failed}, waiting for grace ${waiting}`, { status: 200 });
};

export default withHeartbeat("reg-freeclass-noshow", run);

export const config = { schedule: "*/15 * * * *" };
