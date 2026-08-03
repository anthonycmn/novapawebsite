// Resend event webhook: auto-suppress hard bounces and spam complaints the
// moment they happen, so one stale Constant Contact address can't keep
// burning the mail.novapa.org reputation across a multi-day ramp. Configure
// in the Resend dashboard → Webhooks → point at /api/resend-webhook with
// events email.bounced + email.complained; paste the signing secret into
// Netlify as RESEND_WEBHOOK_SECRET. Signature scheme is svix: HMAC-SHA256
// over "id.timestamp.payload" with the base64 part of the whsec_ secret.
import crypto from "node:crypto";
import { SUPABASE_URL } from "./reg-config.mjs";

function verify(req, payload) {
  const secret = process.env.RESEND_WEBHOOK_SECRET || "";
  const id = req.headers.get("svix-id"), ts = req.headers.get("svix-timestamp");
  const sigs = (req.headers.get("svix-signature") || "").split(" ");
  if (!secret || !id || !ts) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = crypto.createHmac("sha256", key).update(`${id}.${ts}.${payload}`).digest("base64");
  return sigs.some((s) => {
    const v = s.split(",")[1] || "";
    return v.length === expected.length && crypto.timingSafeEqual(Buffer.from(v), Buffer.from(expected));
  });
}

export default async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const payload = await req.text();
  if (!verify(req, payload)) return new Response("bad signature", { status: 401 });

  let ev;
  try { ev = JSON.parse(payload); } catch { return new Response("bad json", { status: 400 }); }
  if (!["email.bounced", "email.complained"].includes(ev.type)) {
    return new Response("ignored", { status: 200 });
  }
  const reason = ev.type === "email.bounced" ? "hard bounce (resend)" : "spam complaint (resend)";
  const to = [].concat(ev.data?.to || []);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  for (const addr of to) {
    const email = String(addr).toLowerCase().trim();
    if (!email.includes("@")) continue;
    await fetch(`${SUPABASE_URL}/rest/v1/email_suppressions?on_conflict=email,scope`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates" },
      body: JSON.stringify({ email, scope: "marketing", reason }),
    });
  }
  return new Response("ok", { status: 200 });
};

export const config = { path: "/api/resend-webhook" };
