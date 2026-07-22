// Send a TEST render of one drip template to the signed-in admin.
// POST /api/reg-drip-test  { step_id }  (admin JWT required)
// Ignores the enabled flag and touches no lead state — pure preview.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./reg-config.mjs";

async function caller(userToken) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${userToken}` },
  });
  if (!r.ok) return null;
  return r.json();
}
async function isAdmin(userToken) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${userToken}`, "Content-Type": "application/json" },
    body: "{}",
  });
  return r.ok && (await r.text()).trim() === "true";
}

const SAMPLE = {
  parentName: "Jason",
  parentComma: " Jason",
  camperName: "Ava",
  camperNames: "Ava and John",
  camp: "Charlie and the Chocolate Factory JR.",
  campName: "Charlie and the Chocolate Factory JR.",
  camps: "Charlie and the Chocolate Factory JR. and Trolls The Musical JR.",
  link: "https://www.northernvirginiaperformingarts.org/register/?go=1&utm_source=retarget&utm_campaign=test",
};

export default async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!auth || !(await isAdmin(auth))) return Response.json({ error: "not admin" }, { status: 403 });
  const user = await caller(auth);
  const to = user && user.email;
  if (!to) return Response.json({ error: "no email on session" }, { status: 400 });

  let body = {};
  try { body = await req.json(); } catch {}
  const stepId = parseInt(body.step_id, 10);
  if (!stepId) return Response.json({ error: "step_id required" }, { status: 400 });

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/email_sequences?id=eq.${stepId}&select=*`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const rows = await r.json();
  if (!Array.isArray(rows) || !rows.length) return Response.json({ error: "step not found" }, { status: 404 });
  const step = rows[0];

  const render = (tpl) => tpl.replace(/\{(\w+)\}/g, (m, k) => (SAMPLE[k] != null ? SAMPLE[k] : m));
  const { default: nodemailer } = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transporter.sendMail({
    from: `Jason from Broadway Bound <${process.env.SMTP_USER}>`,
    to,
    subject: `[TEST] ${render(step.subject)}`,
    html: render(step.body).replace(/\n/g, "<br>"),
  });
  return Response.json({ ok: true, to, seq: step.seq, step: step.step });
};

export const config = { path: "/api/reg-drip-test" };
