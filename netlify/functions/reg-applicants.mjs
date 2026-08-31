// Admin view of employment interest submissions — POST /api/reg-applicants
//   { action: 'list' }                       -> applicants (newest first)
//   { action: 'resume', id }                 -> short-lived signed résumé URL
//   { action: 'status', id, status, notes }  -> triage a record
// The résumés bucket is private; links are minted per request and expire, so a
// downloaded URL can't be forwarded around indefinitely.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./reg-config.mjs";

const STATUSES = ["new", "reviewing", "contacted", "hired", "archived"];

async function isAdmin(userToken) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_role`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${userToken}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!r.ok) return false;
  return (await r.text()).replace(/"/g, "").trim() === "full";
}
function svcHeaders(extra = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

export default async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!auth || !(await isAdmin(auth))) return Response.json({ error: "not admin" }, { status: 403 });

  let body = {};
  try { body = await req.json(); } catch {}
  const action = body.action || "list";

  if (action === "list") {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/job_applications?select=*&order=created_at.desc&limit=500`,
      { headers: svcHeaders() }
    );
    if (!r.ok) return Response.json({ error: "db" }, { status: 502 });
    return Response.json({ applicants: await r.json() });
  }

  if (action === "resume") {
    const rows = await fetch(
      `${SUPABASE_URL}/rest/v1/job_applications?id=eq.${encodeURIComponent(body.id || "")}&select=resume_path,resume_name`,
      { headers: svcHeaders() }
    ).then((r) => (r.ok ? r.json() : []));
    const path = rows[0] && rows[0].resume_path;
    if (!path) return Response.json({ error: "no_resume" }, { status: 404 });
    const sign = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/resumes/${encodeURIComponent(path)}`, {
      method: "POST",
      headers: svcHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ expiresIn: 300 }), // 5 minutes
    });
    if (!sign.ok) return Response.json({ error: "sign_failed" }, { status: 502 });
    const j = await sign.json();
    return Response.json({ url: `${SUPABASE_URL}/storage/v1${j.signedURL || j.signedUrl}`, name: rows[0].resume_name });
  }

  if (action === "status") {
    const status = STATUSES.includes(body.status) ? body.status : null;
    if (!status) return Response.json({ error: "bad_status" }, { status: 400 });
    const patch = { status };
    if (typeof body.notes === "string") patch.notes = body.notes.slice(0, 2000);
    const r = await fetch(`${SUPABASE_URL}/rest/v1/job_applications?id=eq.${encodeURIComponent(body.id || "")}`, {
      method: "PATCH",
      headers: svcHeaders({ "Content-Type": "application/json", Prefer: "return=representation" }),
      body: JSON.stringify(patch),
    });
    if (!r.ok) return Response.json({ error: "db" }, { status: 502 });
    return Response.json({ ok: true, row: (await r.json())[0] || null });
  }

  return Response.json({ error: "unknown_action" }, { status: 400 });
};

export const config = { path: "/api/reg-applicants" };
