// Hourly mail health snapshot, written to public.mail_telemetry. Sends nothing.
//
// Why this exists (Sep 24 2026): Resend marked mail.novapa.org "failed" and
// refused every send from it with a 403 for 33 hours while the DNS records sat
// there correct. The site's own functions caught the error and returned 200,
// and no cloud agent can read Resend or a Netlify function log, so the first
// sign was an audit noticing that no mail had arrived. The website runtime
// already holds RESEND_API_KEY, so it writes the facts down where an agent can
// read them with SQL.
//
// One row per run, source "resend-domains":
//   ok    true only when the domain sendMail sends from is "verified"
//   data  { sender_domain, sender_status, domains: [{ name, status }],
//           mail_failures_24h }  or  { error } when Resend could not be read
//
// If RESEND_API_KEY is a sending-only key, GET /domains answers 401 and the
// row says so in data.error. That is an answer, not a gap: give the site a
// key that can read domains, or accept the mail_failures count alone.
import { SUPABASE_URL } from "./reg-config.mjs";
import { resendFromAddr } from "./reg-mail.mjs";
import { withHeartbeat } from "./reg-heartbeat.mjs";

function svcHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

async function failuresSince(iso) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/mail_failures?select=id&created_at=gte.${encodeURIComponent(iso)}`,
    { headers: { ...svcHeaders(), Prefer: "count=exact", Range: "0-0" } }
  );
  if (!r.ok) return null;
  const total = (r.headers.get("content-range") || "").split("/")[1];
  return total && total !== "*" ? Number(total) : 0;
}

const run = async () => {
  if (process.env.CONTEXT && process.env.CONTEXT !== "production") {
    return new Response("skipped: non-production", { status: 200 });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return new Response("no supabase key", { status: 200 });

  const senderDomain = resendFromAddr().split("@")[1];
  const dayAgo = new Date(Date.now() - 86400_000).toISOString();
  const mailFailures24h = await failuresSince(dayAgo).catch(() => null);

  let ok = false;
  let data;
  if (!process.env.RESEND_API_KEY) {
    data = { error: "RESEND_API_KEY not set", sender_domain: senderDomain, mail_failures_24h: mailFailures24h };
  } else {
    try {
      const r = await fetch("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) {
        data = { error: `resend ${r.status}: ${(await r.text()).slice(0, 300)}`, sender_domain: senderDomain, mail_failures_24h: mailFailures24h };
      } else {
        const body = await r.json();
        const domains = (body.data || []).map((d) => ({ name: d.name, status: d.status }));
        const sender = domains.find((d) => d.name === senderDomain);
        const senderStatus = sender ? sender.status : "missing";
        ok = senderStatus === "verified";
        data = { sender_domain: senderDomain, sender_status: senderStatus, domains, mail_failures_24h: mailFailures24h };
      }
    } catch (e) {
      data = { error: `resend unreachable: ${e.message}`, sender_domain: senderDomain, mail_failures_24h: mailFailures24h };
    }
  }

  const w = await fetch(`${SUPABASE_URL}/rest/v1/mail_telemetry`, {
    method: "POST",
    headers: { ...svcHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify({ source: "resend-domains", ok, data }),
  });
  if (!w.ok) return new Response(`telemetry not written: ${w.status}`, { status: 500 });
  return new Response(`${ok ? "ok" : "NOT OK"} ${senderDomain} ${data.sender_status || data.error}, failures 24h ${mailFailures24h}`, { status: 200 });
};

export default withHeartbeat("reg-mail-telemetry", run);

// 20 past the hour, clear of the :00 and :05 crowd of other schedules.
export const config = { schedule: "20 * * * *" };
