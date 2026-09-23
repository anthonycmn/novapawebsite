// Reads Resend on the agents' behalf and parks the answers in Supabase. Hourly.
//
// Since the NOVAPA agents moved to Claude Code cloud routines on 16 Sep 2026,
// the email marketing run has opened with the same four Data gaps every day:
// bounce and complaint rate, the sending domain status as Resend itself
// reports it, whether the hourly watchdog actually fires, and whether the
// parent portal's newsletter carries an unsubscribe link. None of the four is
// hard to read. They are simply unreadable from where the agent stands: the
// session egress allowlist refuses api.resend.com, no agent holds a Resend
// key, and Netlify function logs are not exposed to any connector.
//
// This runtime has none of those problems. RESEND_API_KEY is already here and
// already sends mail every day, so the fix is not to hand an agent a key, it
// is to have the place that already holds one write down what it can see.
//
// Read-only against Resend. It lists and fetches; it never sends, schedules,
// cancels, or resumes anything, and it touches no audience and no broadcast.
//
// Every failure is recorded rather than thrown. A 401, a 404 on an endpoint
// that does not exist, a rate limit: each lands as a row with ok=false and a
// reason. That matters more than it sounds. The whole point of the exercise is
// that an agent stops guessing, and "we asked and got a 403" is a real answer
// where a missing row is not. Tables live in db/mail-telemetry.sql; if they
// have not been created yet the writes 404 and this still exits 200, so
// deploying ahead of the SQL is harmless.
import { SUPABASE_URL } from "./reg-config.mjs";
import { beat } from "./reg-heartbeat.mjs";

const FN = "reg-mail-telemetry";

// The two domains that send NOVAPA mail. mail.novapa.org carries marketing and
// the registration system; portal.novapa.org carries the parent portal. Both
// are kept off the root domain so a marketing reputation problem can never
// take receipts and sign-in links down with it.
const SENDING_DOMAINS = ["mail.novapa.org", "portal.novapa.org"];

// A marketing body must offer a way off the list. The portal composes its own
// HTML in the novapaapp repo, which no agent run has ever had checked out, so
// the only way to answer the question is to read what actually went out.
const UNSUB_MARKERS = [
  "unsubscribe",
  "{{{RESEND_UNSUBSCRIBE_URL}}}",
  "/unsubscribe/",
  "list-unsubscribe",
];

async function resend(path) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "RESEND_API_KEY not set on this site" };
  try {
    const r = await fetch(`https://api.resend.com/${path}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const text = await r.text();
    if (!r.ok) return { ok: false, error: `${r.status} on /${path}`, body: text.slice(0, 300) };
    try {
      return { ok: true, json: JSON.parse(text) };
    } catch {
      return { ok: false, error: `/${path} returned non-JSON`, body: text.slice(0, 300) };
    }
  } catch (e) {
    return { ok: false, error: `/${path} threw: ${e.message}` };
  }
}

async function record(source, ok, data) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/mail_telemetry`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ source, ok, data }),
    });
  } catch {
    // Nothing useful to do: the next run writes again an hour from now.
  }
}

// ---------------------------------------------------------------------------
// 1. Sending domain status, as Resend reports it rather than as DNS implies.
//
// DNS is already checkable from anywhere, and the agent does check it. What
// DNS cannot tell you is whether Resend considers the domain verified: a key
// rotated, a domain re-added, or a region change all show green in DNS and
// still refuse to send.

async function domains() {
  const r = await resend("domains");
  if (!r.ok) return record("resend-domains", false, { error: r.error, body: r.body });

  const list = Array.isArray(r.json?.data) ? r.json.data : [];
  const seen = list.map((d) => ({
    name: d.name,
    status: d.status,
    region: d.region,
    created_at: d.created_at,
  }));
  // Name the ones we expect and did not find. A domain that quietly vanished
  // from the account is the failure mode worth catching here.
  const missing = SENDING_DOMAINS.filter((want) => !list.some((d) => d.name === want));
  const unverified = seen.filter((d) => d.status && d.status !== "verified").map((d) => d.name);
  return record("resend-domains", missing.length === 0 && unverified.length === 0, {
    domains: seen,
    missing,
    unverified,
  });
}

// ---------------------------------------------------------------------------
// 2. Recent event tally: the bounce and complaint rate nobody can see.
//
// The public API gives last_event per email. Counting them over the most
// recent page is not the same number the dashboard shows for a 7 day window,
// and it must never be reported as if it were, so the row carries the window
// it actually covers and the agent quotes it that way.

async function events() {
  const r = await resend("emails?limit=100");
  if (!r.ok) return record("resend-events", false, { error: r.error, body: r.body });

  const list = Array.isArray(r.json?.data) ? r.json.data : [];
  if (!list.length) {
    return record("resend-events", true, { sample: 0, note: "no emails returned on this page" });
  }

  const tally = {};
  for (const e of list) {
    const k = e.last_event || "unknown";
    tally[k] = (tally[k] || 0) + 1;
  }
  const stamps = list.map((e) => e.created_at).filter(Boolean).sort();
  const bounced = (tally.bounced || 0) + (tally.failed || 0);
  const complained = tally.complained || 0;
  const pct = (n) => Math.round((n / list.length) * 10000) / 100;

  return record("resend-events", true, {
    sample: list.length,
    window_oldest: stamps[0] || null,
    window_newest: stamps[stamps.length - 1] || null,
    tally,
    bounce_pct_of_sample: pct(bounced),
    complaint_pct_of_sample: pct(complained),
    // Said out loud so no report can quote these as 7 day rates by accident.
    note: "percentages are of this sample page, not of a fixed time window",
  });
}

// ---------------------------------------------------------------------------
// 3. Does the parent portal's newsletter carry a way off the list?
//
// The bodies stored in family_hub.email_sends hold no anchor tag and no
// unsubscribe token, but the portal wraps them before sending and that wrapper
// lives in a repo no agent run has had checked out. Reading one delivered
// email settles it. Nine families have reached /unsubscribe/[token], so a
// footer probably exists; probably is not an answer anyone should be filing.

async function portalUnsubCheck() {
  const r = await resend("emails?limit=100");
  if (!r.ok) return record("portal-unsub-check", false, { error: r.error, body: r.body });

  const list = Array.isArray(r.json?.data) ? r.json.data : [];
  const fromPortal = list.filter((e) => String(e.from || "").includes("portal.novapa.org"));
  if (!fromPortal.length) {
    return record("portal-unsub-check", true, {
      checked: null,
      note: "no portal.novapa.org email on this page; portal sends are occasional",
    });
  }

  const newest = fromPortal[0];
  const one = await resend(`emails/${newest.id}`);
  if (!one.ok) return record("portal-unsub-check", false, { error: one.error, id: newest.id });

  const html = String(one.json?.html || "");
  const text = String(one.json?.text || "");
  const haystack = (html + " " + text).toLowerCase();
  const found = UNSUB_MARKERS.filter((m) => haystack.includes(m.toLowerCase()));

  return record("portal-unsub-check", found.length > 0, {
    // The id and subject are enough to find it again. The recipient is not
    // recorded: this table is read by every agent and quoted into reports.
    checked_id: newest.id,
    subject: one.json?.subject || newest.subject || null,
    sent_at: newest.created_at || null,
    markers_found: found,
    has_unsubscribe: found.length > 0,
  });
}

export default async () => {
  // Production only. Branch deploys share the database, so a preview running
  // this would scribble telemetry that looks like the live site's.
  if (process.env.CONTEXT && process.env.CONTEXT !== "production") {
    return new Response("skipped: non-production context", { status: 200 });
  }
  if (!process.env.RESEND_API_KEY) {
    await beat(FN, "no-key", "RESEND_API_KEY not set on this site");
    return new Response("no resend key", { status: 200 });
  }

  // Sequential on purpose: three calls an hour against a shared rate limit is
  // not worth parallelising, and a 429 here would cost the run its answer.
  const results = [];
  for (const [name, run] of [["domains", domains], ["events", events], ["portal-unsub", portalUnsubCheck]]) {
    try {
      await run();
      results.push(name);
    } catch (e) {
      results.push(`${name} failed: ${e.message}`);
      await record(name, false, { error: e.message });
    }
  }

  const detail = `collected ${results.join(", ")}`;
  await beat(FN, "ok", detail);
  return new Response(detail, { status: 200 });
};

// Twenty past, so this never shares a minute with reg-send-watch on the hour.
export const config = { schedule: "20 * * * *" };
