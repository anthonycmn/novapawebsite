// Admin preflight for NOVAPA Mail campaigns: POST {test_to, campaign} sends
// one fully rendered copy through the real Resend transport. Lives outside
// the scheduled runner because Netlify blocks HTTP calls to scheduled fns.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./reg-config.mjs";
import { FROM, REPLY_TO, mailer, unsubUrl } from "./reg-campaign.mjs";

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
  if (!body.test_to || !body.campaign) return Response.json({ error: "bad_request" }, { status: 400 });

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const rows = await (await fetch(`${SUPABASE_URL}/rest/v1/campaigns?name=eq.${encodeURIComponent(body.campaign)}&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })).json();
  if (!rows.length) return Response.json({ error: "campaign_not_found" }, { status: 404 });
  const c = rows[0];
  const t = await mailer();
  const unsub = unsubUrl(String(body.test_to));
  await t.sendMail({
    from: FROM, replyTo: REPLY_TO, to: String(body.test_to),
    subject: c.subject,
    text: c.body.replaceAll("{first_name}", "Jason").replaceAll("{unsub_url}", unsub),
    headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  });
  return Response.json({ ok: true, test: true, to: body.test_to, from: FROM });
};
