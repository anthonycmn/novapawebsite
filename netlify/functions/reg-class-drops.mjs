// Ends the Stripe billing for a class a family has dropped. Every 15 minutes.
//
// CJ, Oct 9 2026: "a family MUST GIVE 30 DAYS notice to katieh@novapa.org that
// they are dropping the class, and the card will be charged for the remaining
// 30 days ... Do not allow them to just stop payments."
//
// The drop is recorded in the staff portal (staff_portal.class_drops, 0357),
// with the day the notice arrived. The staff portal holds no Stripe key, so
// this job does the Stripe half: it reads class_drop_stripe_queue(), sets
// cancel_at on the class subscription to the END of the last day billed
// (notice + 30 days, 23:59 Eastern), and stamps the answer back with
// class_drop_stripe_mark(). Any monthly invoice falling due in those 30 days
// is therefore charged as usual; nothing after it is.
//
// What it will not do by itself, and says so on the drop instead:
//   - a subscription carrying more than one class. Bundle pricing changes when
//     one goes, so a person ends that line in Stripe ('manual').
//   - a subscription managed by a schedule ('manual').
//   - move an end date LATER. A class subscription already ends with its class
//     (cancel_at at checkout); if that is sooner, it stands.
//
// It never cancels anything immediately and never refunds. Families still
// cannot cancel from the Stripe portal (reg-account.mjs, cancellation off).
import Stripe from "stripe";
import { SUPABASE_URL } from "./reg-config.mjs";
import { withHeartbeat } from "./reg-heartbeat.mjs";

const ALERT_TO = ["cj@novapa.org", "katieh@novapa.org"];
const ALERT_ON_ATTEMPT = 3;

async function portalRpc(fn, args) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "Content-Profile": "staff_portal", "Accept-Profile": "staff_portal",
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`rpc ${fn} failed ${res.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return text; }
}

// 23:59:59 Eastern on a YYYY-MM-DD, as unix seconds. The offset is read for
// that date, so EST and EDT both come out right.
export function endOfDayEastern(ymd) {
  const noonUtc = new Date(`${ymd}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", timeZoneName: "shortOffset",
  }).formatToParts(noonUtc);
  const off = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-5"; // "GMT-4"
  const hours = Number(off.replace("GMT", "")) || -5;
  return Math.floor(Date.parse(`${ymd}T23:59:59Z`) / 1000) - hours * 3600;
}

const fmt = (unix) => new Date(unix * 1000).toLocaleDateString("en-US", {
  timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric",
});

async function alert(subject, lines) {
  const resend = process.env.RESEND_API_KEY;
  if (!resend) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resend}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "NOVAPA Alerts <leads@mail.novapa.org>",
      reply_to: "info@novapa.org",
      to: ALERT_TO,
      subject,
      text: lines.join("\n"),
    }),
  }).catch(() => {});
}

export async function endOne(stripe, d) {
  const want = endOfDayEastern(d.billing_ends_on);
  const sub = await stripe.subscriptions.retrieve(d.stripe_subscription);

  if (["canceled", "incomplete_expired"].includes(sub.status)) {
    return { status: "none", detail: `Already ${sub.status} in Stripe; nothing left to bill.` };
  }
  if (sub.schedule) {
    return { status: "manual", detail: `This subscription is run by a Stripe schedule (${sub.schedule}). End it in Stripe by hand on ${fmt(want)}.` };
  }
  if ((sub.items?.data ?? []).length > 1) {
    return { status: "manual", detail: `This subscription bills ${sub.items.data.length} classes together. End only this class in Stripe by hand on ${fmt(want)}.` };
  }
  if (sub.cancel_at && sub.cancel_at <= want) {
    return { status: "scheduled", detail: `Already ends ${fmt(sub.cancel_at)}, with the class; left as it is.`, cancelAt: sub.cancel_at };
  }
  const updated = await stripe.subscriptions.update(sub.id, {
    cancel_at: want,
    proration_behavior: "none",
    metadata: { class_drop_id: String(d.id), class_drop_notice_on: d.notice_on },
  });
  return { status: "scheduled", detail: `Stripe ends it ${fmt(updated.cancel_at ?? want)} (notice ${d.notice_on} + 30 days).`, cancelAt: updated.cancel_at ?? want };
}

const run = async () => {
  if (process.env.CONTEXT && process.env.CONTEXT !== "production") {
    return new Response("skipped: non-production", { status: 200 });
  }
  if (!process.env.STRIPE_SECRET_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return new Response("not configured", { status: 200 });
  }
  const queue = (await portalRpc("class_drop_stripe_queue", {})) || [];
  if (!queue.length) return new Response("nothing to end", { status: 200 });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const out = [];
  for (const d of queue) {
    try {
      const r = await endOne(stripe, d);
      await portalRpc("class_drop_stripe_mark", {
        p_id: d.id, p_status: r.status, p_detail: r.detail,
        p_cancel_at: r.cancelAt ? new Date(r.cancelAt * 1000).toISOString() : null,
      });
      if (r.status === "manual") {
        await alert(`Class drop needs Stripe by hand: ${d.participant_name}, ${d.offering_name}`, [
          `${d.participant_name} dropped ${d.offering_name} (notice ${d.notice_on}).`,
          r.detail,
          `Subscription: https://dashboard.stripe.com/subscriptions/${d.stripe_subscription}`,
        ]);
      }
      out.push(`${d.id}:${r.status}`);
    } catch (e) {
      const msg = String(e?.message ?? e).slice(0, 300);
      await portalRpc("class_drop_stripe_mark", { p_id: d.id, p_status: "failed", p_detail: msg }).catch(() => {});
      if (d.stripe_attempts + 1 === ALERT_ON_ATTEMPT) {
        await alert(`Class drop: Stripe keeps refusing (${d.participant_name})`, [
          `${d.participant_name} dropped ${d.offering_name} (notice ${d.notice_on}); billing should end ${d.billing_ends_on}.`,
          `Stripe said: ${msg}`,
          `Subscription: https://dashboard.stripe.com/subscriptions/${d.stripe_subscription}`,
          "It keeps retrying every 15 minutes.",
        ]);
      }
      out.push(`${d.id}:failed`);
    }
  }
  return new Response(`class drops: ${out.join(", ")}`, { status: 200 });
};

export default withHeartbeat("reg-class-drops", run);

export const config = { schedule: "*/15 * * * *" };
