// POST /api/reg-referral-blast — one-off referral announcement to every
// registered 2026-27 family, sent on our own rails (same Gmail SMTP +
// personalization approach as the drip; Gmail-compose mail merge kept
// mangling the merge tags and link wrappers, Jul 31).
//
// Admin-JWT-gated. Default is a DRY RUN that returns the recipient list;
// { send: true } actually sends. Each family is stamped
// referral_email_sent_at so re-runs never double-send.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./reg-config.mjs";

const SUBJECT = "Give 2 tickets, get 2 tickets.";
const BODY = (first, link) => `Hi ${first},

Got a friend thinking about Broadway Bound? We've made something exciting just for you!

Share your family's referral link below, and when a new family registers for any show through it, you both get 2 free tickets to any NOVAPA production.

Your family's link:
${link}

One more thing, because you're already registered: your first month of classes is free.

Add any weekly class (dance, acting, voice, musical theatre) and pay $0 today, with tuition starting Oct 1. It applies automatically at checkout: https://www.northernvirginiaperformingarts.org/register/?season=classes

See you at the theatre,
Jason from Broadway Bound`;

async function isAdmin(userToken) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${userToken}`, "Content-Type": "application/json" },
    body: "{}",
  });
  return r.ok && (await r.text()).trim() === "true";
}

export default async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!auth || !(await isAdmin(auth))) return Response.json({ error: "not admin" }, { status: 403 });
  let body = {};
  try { body = await req.json(); } catch {}

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const hdrs = { apikey: key, Authorization: `Bearer ${key}` };

  // registered = at least one paid order; skip admins and anyone already sent
  const orders = await (await fetch(`${SUPABASE_URL}/rest/v1/orders?status=in.(paid,confirmed,complete,succeeded)&select=email`, { headers: hdrs })).json();
  const buyerEmails = [...new Set(orders.map((o) => (o.email || "").toLowerCase()))];
  const fams = await (await fetch(`${SUPABASE_URL}/rest/v1/families?select=email,parent_name,ref_code,referral_email_sent_at`, { headers: hdrs })).json();
  const targets = fams.filter((f) =>
    buyerEmails.includes((f.email || "").toLowerCase()) &&
    f.ref_code && !f.referral_email_sent_at &&
    !(f.email || "").endsWith("@novapa.org"));

  const list = targets.map((f) => ({
    email: f.email,
    first: (f.parent_name || "").trim().split(" ")[0] || "there",
    link: `https://www.northernvirginiaperformingarts.org/register/?ref=${f.ref_code}`,
  }));

  // { test_to: "addr" } — one real send to that address using that family's
  // own code (falls back to the NOVAPA4747 house code); never stamps anyone
  if (body.test_to) {
    const tf = fams.filter((f) => (f.email || "").toLowerCase() === String(body.test_to).toLowerCase())[0];
    const first = (tf?.parent_name || "").trim().split(" ")[0] || "Jason";
    const link = `https://www.northernvirginiaperformingarts.org/register/?ref=${tf?.ref_code || "NOVAPA4747"}`;
    const { default: nodemailer } = await import("nodemailer");
    const t = nodemailer.createTransport({
      host: "smtp.gmail.com", port: 465, secure: true,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await t.sendMail({
      from: `Jason from Broadway Bound <${process.env.SMTP_USER}>`,
      to: String(body.test_to), subject: SUBJECT, text: BODY(first, link),
    });
    return Response.json({ ok: true, test: true, to: body.test_to, link });
  }

  if (!body.send) return Response.json({ dry_run: true, count: list.length, recipients: list });

  const { default: nodemailer } = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  // batched sends ({limit}, default 15): spreads the blast over several
  // calls minutes apart — reads as personal mail, not a blast, and each
  // invocation stays well inside the function time limit. The sent-stamp
  // makes every call pick up exactly where the last one stopped.
  const batch = list.slice(0, Math.max(1, Math.min(50, body.limit || 15)));
  let sent = 0;
  const errors = [];
  for (const r of batch) {
    try {
      await transporter.sendMail({
        from: `Jason from Broadway Bound <${process.env.SMTP_USER}>`,
        to: r.email,
        subject: SUBJECT,
        text: BODY(r.first, r.link),
      });
      await fetch(`${SUPABASE_URL}/rest/v1/families?email=ilike.${encodeURIComponent(r.email)}`, {
        method: "PATCH",
        headers: { ...hdrs, "Content-Type": "application/json" },
        body: JSON.stringify({ referral_email_sent_at: new Date().toISOString() }),
      });
      sent++;
    } catch (e) { errors.push({ email: r.email, error: e.message }); }
  }
  return Response.json({ ok: true, sent, remaining: list.length - sent, errors });
};
