// Server-side gateway for the Dear Evan Hansen staff dashboard.
//
// WHY THIS EXISTS
//   The dashboard used to talk to Supabase straight from the browser with a
//   publishable key. That works, but it means a key sits in a public repo and
//   the browser can call anything that key is granted. This function is the
//   only thing that touches the database. The browser holds no key at all and
//   can only ask for the operations named in OPS below.
//
//   It also means the gate word is checked on a server rather than in
//   JavaScript anyone can read, so it is a real check rather than a curtain.
//
// WHICH DATABASE
//   DEH_SUPABASE_URL + DEH_SUPABASE_SERVICE_ROLE_KEY if they are set — the
//   dedicated novapa-deh project, which is the intended home.
//   Otherwise it falls back to the main project, so the dashboard keeps
//   working while that project is being set up. Either way the tables from
//   db/deh-standalone.sql have to exist in whichever one it lands on.
//
// SECURITY NOTES
//   - The service-role key never leaves this function. It is not returned,
//     logged, or echoed in an error.
//   - OPS is an allow-list. An operation not named there is a 400, so this
//     cannot be used as a general-purpose SQL proxy.
//   - Every argument is coerced to the type the RPC expects before it is
//     forwarded, so a client cannot smuggle an object where text is expected.
//   - The gate word is compared with a length-safe constant-time comparison.

import { SUPABASE_URL as MAIN_URL } from "./reg-config.mjs";

const GATE = process.env.DEH_GATE_WORD || "orchard";

const DB_URL = process.env.DEH_SUPABASE_URL || MAIN_URL;
const DB_KEY = process.env.DEH_SUPABASE_SERVICE_ROLE_KEY
            || process.env.SUPABASE_SERVICE_ROLE_KEY;

const S = (v) => (v == null ? "" : String(v)).slice(0, 4000);
const I = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };
const B = (v) => v === true || v === "true";
const D = (v) => {                       // YYYY-MM-DD or nothing
  const s = S(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

// The complete list of what the dashboard may ask for. Anything else is a 400.
const OPS = {
  progress_list:  { fn: "deh_progress_list",   args: () => ({}) },
  progress_set:   { fn: "deh_progress_set",    args: (a) => ({
                      p_block_id: S(a.block_id), p_done: B(a.done), p_by: S(a.by) }) },

  items_list:     { fn: "deh_items_list",      args: () => ({}) },
  item_set:       { fn: "deh_item_set",        args: (a) => ({
                      p_item_id: S(a.item_id), p_status: S(a.status), p_vendor: S(a.vendor),
                      p_link: S(a.link), p_price_cents: I(a.price_cents),
                      p_qty: I(a.qty) || 1, p_by: S(a.by) }) },

  roster_list:    { fn: "deh_roster_list",     args: () => ({}) },
  roster_set:     { fn: "deh_roster_set",      args: (a) => ({
                      p_person_id: S(a.person_id), p_name: S(a.name), p_role: S(a.role),
                      p_kind: S(a.kind) || "cast", p_sort: I(a.sort) || 100,
                      p_active: a.active === false ? false : true }) },

  attendance_list:{ fn: "deh_attendance_list", args: (a) => ({ p_day: D(a.day) }) },
  attendance_set: { fn: "deh_attendance_set",  args: (a) => ({
                      p_day: D(a.day), p_person_id: S(a.person_id),
                      p_status: S(a.status) || "present", p_note: S(a.note), p_by: S(a.by) }) },

  notes_list:     { fn: "deh_notes_list",      args: (a) => ({ p_day: D(a.day) }) },
  note_add:       { fn: "deh_note_add",        args: (a) => ({
                      p_note_id: S(a.note_id), p_day: D(a.day), p_dept: S(a.dept) || "general",
                      p_body: S(a.body), p_author: S(a.author) }) },
  note_delete:    { fn: "deh_note_delete",     args: (a) => ({ p_note_id: S(a.note_id) }) },

  reports_list:   { fn: "deh_reports_list",    args: () => ({}) },
  report_log:     { fn: "deh_report_log",      args: (a) => ({
                      p_day: D(a.day), p_by: S(a.by), p_to: S(a.to),
                      p_summary: a.summary && typeof a.summary === "object" ? a.summary : {} }) },
};

function wordOk(given) {
  const a = String(given || "").trim().toLowerCase();
  const b = String(GATE).trim().toLowerCase();
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body;
  try { body = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }

  if (!wordOk(body.word)) {
    return Response.json({ ok: false, error: "not-authorised" }, { status: 403 });
  }
  const spec = OPS[body.op];
  if (!spec) return Response.json({ ok: false, error: "unknown-op" }, { status: 400 });

  if (!DB_URL || !DB_KEY) {
    return Response.json({ ok: false, error: "db-not-configured" }, { status: 503 });
  }

  try {
    const res = await fetch(`${DB_URL}/rest/v1/rpc/${spec.fn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: DB_KEY,
        Authorization: `Bearer ${DB_KEY}`,
      },
      body: JSON.stringify(spec.args(body.args || {})),
    });
    const text = await res.text();
    if (!res.ok) {
      // Pass the status through but never the key or the full upstream body,
      // which can echo connection details.
      return Response.json({ ok: false, error: `db-${res.status}` }, { status: 502 });
    }
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return Response.json({ ok: true, data });
  } catch {
    return Response.json({ ok: false, error: "db-unreachable" }, { status: 502 });
  }
};

export const config = { path: "/api/deh-db" };
