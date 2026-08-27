// One place to see every funnel lead. Three streams land here:
//
//   dcu       Find Your 5 quiz on portal.dcunifieds.com — a SEPARATE Supabase
//             project (audition-atlas). Its own app writes funnel_leads over a
//             direct Postgres connection; we read a narrow view, leads_api
//             .funnel_leads_ro, granted to service_role only. Deliberately NOT
//             the public schema: 33 of that project's 34 tables have RLS off
//             (users, password_resets, sessions...), so exposing `public` over
//             REST would publish the lot. The view is the whole blast radius.
//   quiz      NOVAPA quiz funnel  -> public.quiz_leads
//   freeclass NOVAPA free class   -> public.free_class_bookings
//
// Read-only by design; stage/notes edits still happen in the DCU coach board.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./reg-config.mjs";

async function isAdmin(userToken) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${userToken}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!r.ok) return false;
  return (await r.text()).trim() === "true";
}

function svc(extra = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

async function db(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: svc() });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 200)}`);
  try { return JSON.parse(t); } catch { return null; }
}

function parseJson(v, fallback) {
  if (v == null) return fallback;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

// The DCU quiz UPDATEs an existing row when a known email retakes it, so
// "newest" has to sort on updated_at, not created_at, or a returning parent
// silently stays buried at the bottom of the list.
async function loadDcu() {
  const base = process.env.DCU_SUPABASE_URL;
  const key = process.env.DCU_SERVICE_KEY;
  if (!base || !key) return { rows: [], status: "not_configured" };
  try {
    const r = await fetch(
      `${base}/rest/v1/funnel_leads_ro?select=*&order=updated_at.desc.nullslast&limit=500`,
      { headers: { apikey: key, Authorization: `Bearer ${key}`, "Accept-Profile": "leads_api" } }
    );
    const t = await r.text();
    if (!r.ok) return { rows: [], status: `error ${r.status}: ${t.slice(0, 120)}` };
    const raw = JSON.parse(t);
    const rows = raw.map((x) => {
      const a = parseJson(x.answers, {});
      const m = parseJson(x.matches, []);
      return {
        id: x.id,
        created_at: x.created_at,
        updated_at: x.updated_at,
        name: x.name,
        email: x.email,
        phone: x.phone,
        role: x.role,
        grad_year: x.grad_year,
        stage: x.stage,
        coach_notes: x.coach_notes,
        purchased_at: x.purchased_at,
        campaign: x.utm_campaign,
        content: x.utm_content,
        source: x.utm_source,
        dream: a.dream, structure: a.structure, distance: a.distance,
        home_state: a.homeState, dance: a.dance, gpa: a.gpa,
        budget: a.budget, prescreen: a.prescreen, certainty: a.certainty,
        // Prescreens already filmed + decision locked is the DC Unifieds
        // buyer. Surfacing it as a flag so the list can sort itself.
        hot: a.certainty === "locked" && a.prescreen === "filmed",
        matches: Array.isArray(m) ? m.map((s) => s.school).filter(Boolean) : [],
      };
    });
    return { rows, status: "ok" };
  } catch (e) {
    return { rows: [], status: `error: ${String(e.message).slice(0, 120)}` };
  }
}

export default async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!auth || !(await isAdmin(auth))) return Response.json({ error: "not admin" }, { status: 403 });

  let body = {};
  try { body = await req.json(); } catch {}
  if ((body.action || "list") !== "list") {
    return Response.json({ error: "unknown_action" }, { status: 400 });
  }

  const [dcu, quiz, freeclass] = await Promise.all([
    loadDcu(),
    db("quiz_leads?select=*&order=created_at.desc&limit=500").catch(() => []),
    db("free_class_bookings?select=*&order=created_at.desc&limit=500").catch(() => []),
  ]);

  return Response.json({
    dcu: dcu.rows,
    dcu_status: dcu.status,
    quiz: (quiz || []).map((q) => ({
      id: q.id, created_at: q.created_at, parent_name: q.parent_name,
      email: q.email, child_name: q.child_name, age_band: q.age_band,
      persona: q.persona, source: q.source,
    })),
    freeclass: (freeclass || []).map((f) => ({
      id: f.id, created_at: f.created_at, parent_name: f.parent_name,
      email: f.email, phone: f.phone, child_name: f.child_name,
      child_age: f.child_age, cast_key: f.cast_key, class_date: f.class_date,
      status: f.status,
    })),
  });
};

export const config = { path: "/api/reg-leads" };
