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
// Notes stay read-only; stage is the one field the board writes back. DCU
// stages go home to DCU's own function so their coach board sees the move;
// NOVAPA stages live in public.lead_stages because quiz_leads and
// free_class_bookings are append-only capture tables with no stage column.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./reg-config.mjs";

// The five ids DCU's stage column is constrained to. We ship the labels with
// the payload so the board doesn't hardcode a sixth stage we can't store.
// "Interested" reads better to us than DCU's internal "nurturing", but the id
// is theirs — renaming it would fail their check constraint.
const STAGES = [
  { id: "new", label: "New" },
  { id: "contacted", label: "Contacted" },
  { id: "nurturing", label: "Interested" },
  { id: "registered", label: "Registered" },
  { id: "closed_lost", label: "Closed lost" },
];
const STAGE_IDS = new Set(STAGES.map((s) => s.id));

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

async function dbPost(path, body, prefer) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "POST",
    headers: svc({ "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) }),
    body: JSON.stringify(body),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 200)}`);
  try { return JSON.parse(t); } catch { return null; }
}

// The token already cleared is_admin, so this is only for attribution — who
// dragged the card. Never read it to decide what someone is allowed to do.
function emailFromToken(token) {
  try {
    const seg = String(token).split(".")[1];
    const pad = seg.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(pad + "=".repeat((4 - (pad.length % 4)) % 4))).email || null;
  } catch { return null; }
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
        key: `dcu:${x.id}`,
        board: "dcu",
        created_at: x.created_at,
        updated_at: x.updated_at,
        name: x.name,
        email: x.email,
        phone: x.phone,
        role: x.role,
        grad_year: x.grad_year,
        // DCU rows predating their stage column come back null; the board has
        // no null column to drop them in, so they land in New.
        stage: x.stage || "new",
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

// Sending the move back to DCU rather than shadowing it locally: their coaches
// work the same people on their own board, and two boards disagreeing about a
// lead's stage is worse than no board at all. p_by is stamped so they can see
// the change came from our side.
async function dcuSetStage(id, stage, by) {
  const base = process.env.DCU_SUPABASE_URL;
  const key = process.env.DCU_SERVICE_KEY;
  if (!base || !key) return { ok: false, error: "dcu_not_configured" };
  const r = await fetch(`${base}/rest/v1/rpc/set_lead_stage`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      // RPC is a write, so PostgREST wants Content-Profile here — Accept-Profile
      // (what the read path uses) is ignored on POST and the call 404s.
      "Content-Profile": "leads_api",
    },
    body: JSON.stringify({ p_id: String(id), p_stage: stage, p_by: by || "novapa-admin" }),
  });
  const t = await r.text();
  if (!r.ok) return { ok: false, error: `dcu ${r.status}: ${t.slice(0, 160)}` };
  return { ok: true };
}

// One fetch of the whole side table, not one per lead. It only ever holds rows
// somebody actually dragged, so it stays far smaller than the lead lists.
async function loadStageMap() {
  try {
    const rows = await db("lead_stages?select=board,lead_id,stage&limit=5000");
    const m = new Map();
    for (const r of rows || []) m.set(`${r.board}:${r.lead_id}`, r.stage);
    return m;
  } catch { return new Map(); }
}

// Proof of payment for NOVAPA leads: one lookup for the whole list, not one
// per lead. Batched at 100 because 1500 leads' worth of emails in a single
// in.() would blow past the URL length limit. Both the as-typed and the
// lowercased form go into the filter — in.() compares bytes, and a parent who
// checked out as "Foo@Bar.com" is the same buyer as the "foo@bar.com" lead —
// and the returned rows are folded to lowercase before matching.
async function loadPaidEmails(emails) {
  const variants = new Set();
  for (const e of emails) {
    if (!e) continue;
    const v = String(e).trim();
    if (v) { variants.add(v); variants.add(v.toLowerCase()); }
  }
  const list = [...variants];
  const paid = new Set();
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100).map(encodeURIComponent).join(",");
    try {
      const rows = await db(`orders?select=email&email=in.(${chunk})&status=eq.paid`);
      for (const o of rows || []) if (o.email) paid.add(String(o.email).trim().toLowerCase());
    } catch { /* a missing batch just means those leads keep their manual stage */ }
  }
  return paid;
}

// Payment is the one stage we don't let a human be wrong about: if we have
// money, the lead is Registered no matter where the card was last dropped.
// Derived on read only — writing it back would stomp a DCU coach's own stage.
function applyPaid(lead, isPaid) {
  if (!isPaid) return { ...lead, stage_locked: false };
  return { ...lead, stage: "registered", stage_locked: true };
}

export default async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!auth || !(await isAdmin(auth))) return Response.json({ error: "not admin" }, { status: 403 });

  let body = {};
  try { body = await req.json(); } catch {}
  const action = body.action || "list";

  if (action === "set_stage") {
    const key = String(body.key || "");
    const stage = String(body.stage || "");
    if (!STAGE_IDS.has(stage)) return Response.json({ error: "bad_stage" }, { status: 400 });
    const cut = key.indexOf(":");
    const prefix = cut < 0 ? "" : key.slice(0, cut);
    const id = cut < 0 ? "" : key.slice(cut + 1);
    if (!id) return Response.json({ error: "bad_key" }, { status: 400 });
    // The body may name a `by`, but the token is the one we trust to be a real
    // admin, so it wins; body.by is only a fallback for scripted calls.
    const by = emailFromToken(auth) || body.by || null;

    if (prefix === "dcu") {
      const r = await dcuSetStage(id, stage, by);
      if (!r.ok) return Response.json({ error: r.error }, { status: 502 });
      return Response.json({ ok: true, stage });
    }
    if (prefix === "quiz" || prefix === "free") {
      // lead_stages keys on the funnel, not on "novapa" — quiz #5 and free
      // class booking #5 are different people sharing an id sequence.
      try {
        await dbPost(
          "lead_stages",
          { board: prefix, lead_id: id, stage, updated_at: new Date().toISOString(), updated_by: by },
          "resolution=merge-duplicates"
        );
      } catch (e) {
        return Response.json({ error: String(e.message).slice(0, 200) }, { status: 502 });
      }
      return Response.json({ ok: true, stage });
    }
    return Response.json({ error: "bad_key" }, { status: 400 });
  }

  if (action !== "list") {
    return Response.json({ error: "unknown_action" }, { status: 400 });
  }

  const [dcu, quiz, freeclass, stageMap] = await Promise.all([
    loadDcu(),
    db("quiz_leads?select=*&order=created_at.desc&limit=500").catch(() => []),
    db("free_class_bookings?select=*&order=created_at.desc&limit=500").catch(() => []),
    loadStageMap(),
  ]);

  const quizRows = (quiz || []).map((q) => ({
    id: q.id, key: `quiz:${q.id}`, board: "novapa",
    stage: stageMap.get(`quiz:${q.id}`) || "new",
    created_at: q.created_at, parent_name: q.parent_name,
    email: q.email, phone: q.phone, child_name: q.child_name, age_band: q.age_band,
    persona: q.persona, source: q.source,
  }));
  const freeRows = (freeclass || []).map((f) => ({
    id: f.id, key: `free:${f.id}`, board: "novapa",
    stage: stageMap.get(`free:${f.id}`) || "new",
    created_at: f.created_at, parent_name: f.parent_name,
    email: f.email, phone: f.phone, child_name: f.child_name,
    child_age: f.child_age, cast_key: f.cast_key, class_date: f.class_date,
    status: f.status,
  }));

  // DCU carries its own purchased_at; our two funnels only know they paid
  // because an order exists, so both lists get looked up in one pass.
  const paid = await loadPaidEmails([...quizRows, ...freeRows].map((l) => l.email));
  const isPaid = (e) => !!e && paid.has(String(e).trim().toLowerCase());

  return Response.json({
    stages: STAGES,
    dcu: dcu.rows.map((d) => applyPaid(d, !!d.purchased_at)),
    dcu_status: dcu.status,
    quiz: quizRows.map((q) => applyPaid(q, isPaid(q.email))),
    freeclass: freeRows.map((f) => applyPaid(f, isPaid(f.email))),
  });
};

export const config = { path: "/api/reg-leads" };
