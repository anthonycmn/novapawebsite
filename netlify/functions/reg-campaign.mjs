// NOVAPA Mail v1 — scheduled campaign runner (Jason, Aug 1 2026).
// Campaigns are rows in `campaigns`; this ticks every 5 minutes on the
// production deploy, picks up due campaigns, and sends BATCH_SIZE emails per
// tick via the same Gmail SMTP identity as the drip. The audience is computed
// live each tick (a family that buys mid-campaign drops out automatically),
// campaign_sends makes every send exactly-once, and email_suppressions is
// honored everywhere forever. One-click unsubscribe via /api/unsubscribe
// with an HMAC token (List-Unsubscribe + List-Unsubscribe-Post headers, per
// Gmail/Yahoo bulk-sender rules).
import crypto from "node:crypto";
import { SUPABASE_URL } from "./reg-config.mjs";

const BATCH_SIZE = 25; // ~18s of SMTP at ~0.7s/send, inside the fn limit

// Mass sends ride Resend (mail.novapa.org subdomain) so marketing reputation
// never touches the root domain that receipts and sign-in links depend on.
// Replies go to Jason's real inbox.
export const FROM = "Broadway Bound <hello@mail.novapa.org>";
export const REPLY_TO = "jason@novapa.org";
export async function mailer() {
  const { default: nodemailer } = await import("nodemailer");
  return nodemailer.createTransport({
    host: "smtp.resend.com", port: 465, secure: true,
    auth: { user: "resend", pass: process.env.RESEND_API_KEY },
  });
}

export function unsubToken(email) {
  return crypto.createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY)
    .update(email.toLowerCase()).digest("hex").slice(0, 24);
}
export function unsubUrl(email) {
  return `https://www.northernvirginiaperformingarts.org/api/unsubscribe?e=${encodeURIComponent(email.toLowerCase())}&t=${unsubToken(email)}`;
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

async function audienceFor(campaign) {
  // non_buyers_2027: every known family without a paid 2026-27 web order
  const [fams, orders, supp, sent] = await Promise.all([
    svc("families?select=email,parent_name&limit=10000"),
    svc("orders?status=in.(paid,confirmed,complete,succeeded)&select=email&limit=10000"),
    svc("email_suppressions?select=email&limit=10000"),
    svc(`campaign_sends?campaign_id=eq.${campaign.id}&select=email&limit=20000`),
  ]);
  const buyers = new Set(orders.map((o) => (o.email || "").toLowerCase()));
  const out = new Set([...supp.map((s) => s.email.toLowerCase()), ...sent.map((s) => s.email.toLowerCase())]);
  return fams.filter((f) => {
    const e = (f.email || "").toLowerCase();
    if (!e.includes("@") || e.endsWith("@novapa.org")) return false;
    if (campaign.audience === "non_buyers_2027" && buyers.has(e)) return false;
    if (campaign.audience === "buyers_2027" && !buyers.has(e)) return false;
    return !out.has(e);
  }).map((f) => ({
    email: (f.email || "").toLowerCase(),
    first: (f.parent_name || "").trim().split(" ")[0] || "there",
  }));
}

async function isAdmin(userToken) {
  const { SUPABASE_ANON_KEY } = await import("./reg-config.mjs");
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${userToken}`, "Content-Type": "application/json" },
    body: "{}",
  });
  return r.ok && (await r.text()).trim() === "true";
}

export default async () => {
  // production deploy only — branch deploys share the DB (same rule as the drip)
  if (process.env.CONTEXT && process.env.CONTEXT !== "production") {
    return new Response("skipped: non-production context", { status: 200 });
  }

  const due = await svc(`campaigns?status=in.(scheduled,sending)&scheduled_at=lte.${encodeURIComponent(new Date().toISOString())}&order=scheduled_at&limit=1`);
  if (!due.length) return new Response("no due campaigns", { status: 200 });
  const c = due[0];

  const audience = await audienceFor(c);
  if (!audience.length) {
    await svc(`campaigns?id=eq.${c.id}`, { method: "PATCH", body: JSON.stringify({ status: "done" }) });
    return new Response(`campaign ${c.name}: done (${c.sent_count} total)`, { status: 200 });
  }
  if (c.status === "scheduled") {
    await svc(`campaigns?id=eq.${c.id}`, { method: "PATCH", body: JSON.stringify({ status: "sending" }) });
  }

  const transporter = await mailer();

  const batch = audience.slice(0, BATCH_SIZE);
  let sent = 0;
  for (const r of batch) {
    const unsub = unsubUrl(r.email);
    try {
      await transporter.sendMail({
        from: FROM, replyTo: REPLY_TO,
        to: r.email,
        subject: c.subject,
        text: c.body.replaceAll("{first_name}", r.first).replaceAll("{unsub_url}", unsub),
        headers: {
          "List-Unsubscribe": `<${unsub}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
      await svc("campaign_sends", {
        method: "POST", headers: { Prefer: "resolution=ignore-duplicates" },
        body: JSON.stringify({ campaign_id: c.id, email: r.email }),
      });
      sent++;
    } catch (e) { console.error(`campaign send failed ${r.email}:`, e.message); }
  }
  await svc(`campaigns?id=eq.${c.id}`, {
    method: "PATCH", body: JSON.stringify({ sent_count: c.sent_count + sent }),
  });
  return new Response(`campaign ${c.name}: sent ${sent}, ~${audience.length - sent} remaining`, { status: 200 });
};

export const config = { schedule: "*/5 * * * *" };
