// Outbound email volume watchdog. Hourly.
//
// On Aug 27 2026 the retargeting drip sent 425 emails in an afternoon — normal
// is one to six a day — and the first anyone knew was parents replying. Every
// individual guard was working: the per-run cap held at 25, the context check
// held, the send loop did exactly what it was told. Nothing was watching the
// TOTAL. This does.
//
// It does not send customer email and cannot stop a send; it only tells Jason.
// The drip has its own hard ceiling (MAX_SENDS_PER_DAY) that halts the engine.
import { SUPABASE_URL } from "./reg-config.mjs";
import { getStore } from "@netlify/blobs";

// Baselines from the 30 days before the incident: drip 1-6/day, campaigns fire
// only when a human schedules one. Thresholds sit well above normal so this
// stays quiet, and every one is tunable without a deploy.
const DRIP_HOUR = Number(process.env.WATCH_DRIP_HOUR || 30);
const DRIP_DAY = Number(process.env.WATCH_DRIP_DAY || 60);
const CAMPAIGN_HOUR = Number(process.env.WATCH_CAMPAIGN_HOUR || 400);

function svcHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

// Only the count is needed, so ask PostgREST for the count and no rows —
// this must never page through thousands of records just to watch them.
async function countSince(table, column, iso) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?select=${column}&${column}=gte.${encodeURIComponent(iso)}`,
    { headers: { ...svcHeaders(), Prefer: "count=exact", Range: "0-0" } }
  );
  const cr = r.headers.get("content-range") || "";
  const total = cr.split("/")[1];
  return total && total !== "*" ? Number(total) : 0;
}

export default async () => {
  if (process.env.CONTEXT && process.env.CONTEXT !== "production") {
    return new Response("skipped: non-production", { status: 200 });
  }
  const resend = process.env.RESEND_API_KEY;
  if (!resend) return new Response("no resend key", { status: 200 });

  const now = new Date();
  const hourAgo = new Date(now.getTime() - 3600_000).toISOString();
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);

  let dripHour = 0, dripDay = 0, campHour = 0;
  try {
    [dripHour, dripDay, campHour] = await Promise.all([
      countSince("retarget_state", "created_at", hourAgo),
      countSince("retarget_state", "created_at", midnight.toISOString()),
      countSince("campaign_sends", "sent_at", hourAgo),
    ]);
  } catch (e) {
    return new Response(`count failed: ${e.message}`, { status: 200 });
  }

  const hits = [];
  if (dripHour >= DRIP_HOUR) hits.push(`Retargeting drip: <b>${dripHour}</b> in the last hour (normal is 0-1, alert at ${DRIP_HOUR}).`);
  if (dripDay >= DRIP_DAY) hits.push(`Retargeting drip: <b>${dripDay}</b> so far today (a normal day is 1-6, alert at ${DRIP_DAY}).`);
  if (campHour >= CAMPAIGN_HOUR) hits.push(`Campaign sender: <b>${campHour}</b> in the last hour (alert at ${CAMPAIGN_HOUR}) — expected if you scheduled a blast.`);
  if (!hits.length) return new Response(`ok drip ${dripHour}/h ${dripDay}/d, campaigns ${campHour}/h`, { status: 200 });

  // One alert per condition per day. A spike that persists should not turn into
  // an hourly alarm — that is how people learn to ignore the alarm.
  const store = getStore("lead-alerts");
  const key = "sendwatch-" + now.toISOString().slice(0, 10) + "-" + hits.length;
  if (await store.get(key)) return new Response("already alerted today", { status: 200 });
  await store.set(key, String(Date.now()));

  const to = (process.env.LEADS_ALERT_TO || "jason@novapa.org").split(",").map((s) => s.trim()).filter(Boolean);
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resend}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "NOVAPA Alerts <leads@mail.novapa.org>",
      to,
      subject: `Email volume spike: ${dripDay} drip sends today`,
      html: `<div style="max-width:560px;margin:0 auto;padding:26px 22px;font-family:Helvetica,Arial,sans-serif;color:#0B1422">
<div style="font:700 20px/1.3 Helvetica,Arial,sans-serif;letter-spacing:-0.01em">Unusual outbound email volume</div>
<ul style="font:15px/1.8 Helvetica,Arial,sans-serif;color:#5B6472;margin:12px 0 0;padding-left:20px">
${hits.map((h) => `<li>${h}</li>`).join("")}</ul>
<div style="font:14px/1.7 Helvetica,Arial,sans-serif;color:#5B6472;margin-top:16px">
The drip stops itself at ${DRIP_DAY} sends a day. The campaign sender does not stop on its own &mdash;
if that number is unexpected, set the campaign to <code>done</code> in the admin Marketing tab.</div>
<div style="font:12.5px/1.7 Helvetica,Arial,sans-serif;color:#9AA1AC;margin-top:18px">
One alert per day. Thresholds: WATCH_DRIP_HOUR, WATCH_DRIP_DAY, WATCH_CAMPAIGN_HOUR.</div></div>`,
    }),
  });
  return new Response(`alerted: ${hits.length} condition(s)`, { status: 200 });
};

export const config = { schedule: "0 * * * *" };
