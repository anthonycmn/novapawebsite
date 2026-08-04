// Server-side data store for the Dear Evan Hansen staff dashboard.
//
// WHY THIS EXISTS
//   The browser holds no credentials of any kind. This function is the only
//   thing that touches storage. It checks the company word itself and accepts
//   an allow-list of named operations, so it cannot be used as a general
//   data proxy.
//
// WHERE THE DATA LIVES
//   Netlify Blobs by default — a store built into this site. It needs no
//   account, no key, no schema and no setup: it exists as soon as the
//   function deploys. For one production's rehearsal data that is exactly
//   the right size of tool.
//
//   If DEH_SUPABASE_URL and DEH_SUPABASE_SERVICE_ROLE_KEY are ever set, it
//   uses Supabase instead, calling the RPCs in db/deh-standalone.sql. The
//   operation contract below is identical either way, so the dashboard does
//   not know or care which one is answering.
//
// CONCURRENCY
//   Five people edit this at once during a rehearsal. Each collection is one
//   document, and every write is read-modify-write guarded by the document's
//   etag (onlyIfMatch). If someone else wrote first the write is retried
//   against the new version rather than overwriting it, so two people ticking
//   different blocks in the same second cannot lose each other's work.

import { getStore } from "@netlify/blobs";

const GATE = process.env.DEH_GATE_WORD || "orchard";

const SB_URL = process.env.DEH_SUPABASE_URL;
const SB_KEY = process.env.DEH_SUPABASE_SERVICE_ROLE_KEY;
const USE_SUPABASE = !!(SB_URL && SB_KEY);

const S = (v) => (v == null ? "" : String(v)).slice(0, 4000);
const I = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };
const B = (v) => v === true || v === "true";
const D = (v) => {
  const s = S(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

// ── Netlify Blobs backend ────────────────────────────────────────────────
// Strong consistency is what we want: five people editing one rehearsal
// should not read each other's stale data. It needs an `uncachedEdgeURL` in
// the function environment, which Netlify supplies — but if it is ever
// absent the store throws on every call, which would take the whole
// dashboard down. So: try strong, and drop to the default once if the
// environment cannot do it. Better slightly stale than entirely broken.
let _store = null, _strong = true;
function store() {
  if (!_store) _store = getStore(_strong ? { name: "deh", consistency: "strong" } : { name: "deh" });
  return _store;
}
function downgrade(e) {
  if (_strong && /consistency|uncachedEdgeURL/i.test(String((e && e.message) || e))) {
    _strong = false; _store = null;
    return true;
  }
  return false;
}
async function withStore(fn) {
  try { return await fn(store()); }
  catch (e) {
    if (downgrade(e)) return await fn(store());
    throw e;
  }
}

async function readDoc(key) {
  try {
    const r = await withStore((s) => s.getWithMetadata(key, { type: "json" }));
    return { data: (r && r.data) || {}, etag: r && r.etag };
  } catch {
    return { data: {}, etag: undefined };
  }
}

// Read, apply, write-if-unchanged. Retries when another writer got there
// first — that is the whole point, not an error path.
//
// NOTE, and it is the whole reason this works: a conditional set that loses
// the race does NOT throw. It resolves with { modified: false }. Treating a
// resolved promise as success silently drops the write, which during a
// rehearsal means an attendance mark or a note simply vanishing. Check the
// flag, not the absence of an exception.
async function mutate(key, apply, tries = 8) {
  for (let i = 0; i < tries; i++) {
    const { data, etag } = await readDoc(key);
    const next = apply({ ...data });
    const res = await withStore((s) =>
      s.setJSON(key, next, etag ? { onlyIfMatch: etag } : { onlyIfNew: true }));
    if (res && res.modified) return true;
    // Someone else wrote between our read and our write. Re-read and re-apply
    // on top of their version, with a little jitter so retries fan out.
    await new Promise((r) => setTimeout(r, 8 + Math.floor(Math.random() * 25)));
  }
  // Eight collisions in a row is not a rehearsal, it is a bug. Take the last
  // word rather than silently dropping what someone typed.
  const { data } = await readDoc(key);
  await withStore((s) => s.setJSON(key, apply({ ...data })));
  return true;
}

const asRows = (obj, map) => Object.keys(obj || {}).map((k) => map(k, obj[k]));

const BLOBS = {
  progress_list: async () => asRows(
    (await readDoc("progress")).data,
    (k, v) => ({ block_id: k, done: !!v.done, done_by: v.by || "", done_at: v.at || null })
  ).filter((r) => r.done),

  progress_set: async (a) => mutate("progress", (d) => {
    if (B(a.done)) d[S(a.block_id)] = { done: true, by: S(a.by), at: new Date().toISOString() };
    else delete d[S(a.block_id)];
    return d;
  }),

  items_list: async () => asRows(
    (await readDoc("items")).data,
    (k, v) => ({ item_id: k, status: v.status || "todo", vendor: v.vendor || "", link: v.link || "",
                 price_cents: v.price_cents || 0, qty: v.qty || 1, updated_by: v.by || "" })
  ),

  item_set: async (a) => mutate("items", (d) => {
    d[S(a.item_id)] = { status: S(a.status) || "todo", vendor: S(a.vendor), link: S(a.link),
                        price_cents: I(a.price_cents), qty: I(a.qty) || 1, by: S(a.by) };
    return d;
  }),

  roster_list: async () => asRows(
    (await readDoc("roster")).data,
    (k, v) => ({ person_id: k, name: v.name || "", role: v.role || "",
                 kind: v.kind || "cast", sort: v.sort == null ? 100 : v.sort })
  ).sort((x, y) => (x.sort - y.sort) || x.person_id.localeCompare(y.person_id)),

  roster_set: async (a) => mutate("roster", (d) => {
    if (a.active === false) delete d[S(a.person_id)];
    else d[S(a.person_id)] = { name: S(a.name), role: S(a.role),
                               kind: S(a.kind) || "cast", sort: I(a.sort) || 100 };
    return d;
  }),

  attendance_list: async (a) => {
    const day = D(a.day); if (!day) return [];
    return asRows((await readDoc(`attendance/${day}`)).data,
      (k, v) => ({ day, person_id: k, status: v.status || "present",
                   note: v.note || "", updated_by: v.by || "" }));
  },

  attendance_set: async (a) => {
    const day = D(a.day); if (!day) return false;
    return mutate(`attendance/${day}`, (d) => {
      d[S(a.person_id)] = { status: S(a.status) || "present", note: S(a.note), by: S(a.by) };
      return d;
    });
  },

  notes_list: async (a) => {
    const day = D(a.day); if (!day) return [];
    return asRows((await readDoc(`notes/${day}`)).data,
      (k, v) => ({ note_id: k, day, dept: v.dept || "general", body: v.body || "",
                   author: v.author || "", created_at: v.created_at || null }))
      .sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)));
  },

  note_add: async (a) => {
    const day = D(a.day); if (!day) return false;
    return mutate(`notes/${day}`, (d) => {
      d[S(a.note_id)] = { dept: S(a.dept) || "general", body: S(a.body),
                          author: S(a.author), created_at: new Date().toISOString() };
      return d;
    });
  },

  // The note id carries its own day, so the document can be found without
  // the client having to send it again.
  note_delete: async (a) => {
    const id = S(a.note_id), day = D(id.split("|")[0]);
    if (!day) return false;
    return mutate(`notes/${day}`, (d) => { delete d[id]; return d; });
  },

  reports_list: async () => asRows(
    (await readDoc("reports")).data,
    (k, v) => ({ day: k, sent_at: v.at || null, sent_by: v.by || "", sent_to: v.to || "" })
  ),

  report_log: async (a) => {
    const day = D(a.day); if (!day) return false;
    return mutate("reports", (d) => {
      d[day] = { at: new Date().toISOString(), by: S(a.by), to: S(a.to) };
      return d;
    });
  },
};

// ── Supabase backend (only if explicitly configured) ─────────────────────
const RPC = {
  progress_list:   ["deh_progress_list",   () => ({})],
  progress_set:    ["deh_progress_set",    (a) => ({ p_block_id: S(a.block_id), p_done: B(a.done), p_by: S(a.by) })],
  items_list:      ["deh_items_list",      () => ({})],
  item_set:        ["deh_item_set",        (a) => ({ p_item_id: S(a.item_id), p_status: S(a.status), p_vendor: S(a.vendor), p_link: S(a.link), p_price_cents: I(a.price_cents), p_qty: I(a.qty) || 1, p_by: S(a.by) })],
  roster_list:     ["deh_roster_list",     () => ({})],
  roster_set:      ["deh_roster_set",      (a) => ({ p_person_id: S(a.person_id), p_name: S(a.name), p_role: S(a.role), p_kind: S(a.kind) || "cast", p_sort: I(a.sort) || 100, p_active: a.active !== false })],
  attendance_list: ["deh_attendance_list", (a) => ({ p_day: D(a.day) })],
  attendance_set:  ["deh_attendance_set",  (a) => ({ p_day: D(a.day), p_person_id: S(a.person_id), p_status: S(a.status) || "present", p_note: S(a.note), p_by: S(a.by) })],
  notes_list:      ["deh_notes_list",      (a) => ({ p_day: D(a.day) })],
  note_add:        ["deh_note_add",        (a) => ({ p_note_id: S(a.note_id), p_day: D(a.day), p_dept: S(a.dept) || "general", p_body: S(a.body), p_author: S(a.author) })],
  note_delete:     ["deh_note_delete",     (a) => ({ p_note_id: S(a.note_id) })],
  reports_list:    ["deh_reports_list",    () => ({})],
  report_log:      ["deh_report_log",      (a) => ({ p_day: D(a.day), p_by: S(a.by), p_to: S(a.to), p_summary: a.summary && typeof a.summary === "object" ? a.summary : {} })],
};

async function viaSupabase(op, args) {
  const [fn, build] = RPC[op];
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    body: JSON.stringify(build(args)),
  });
  if (!res.ok) throw new Error(`db-${res.status}`);
  const t = await res.text();
  try { return t ? JSON.parse(t) : null; } catch { return null; }
}

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

  if (!wordOk(body.word)) return Response.json({ ok: false, error: "not-authorised" }, { status: 403 });
  if (!BLOBS[body.op]) return Response.json({ ok: false, error: "unknown-op" }, { status: 400 });

  try {
    const data = USE_SUPABASE
      ? await viaSupabase(body.op, body.args || {})
      : await BLOBS[body.op](body.args || {});
    return Response.json({ ok: true, data, store: USE_SUPABASE ? "supabase" : "blobs" });
  } catch (e) {
    // Never echo an upstream body — it can carry connection detail.
    return Response.json({ ok: false, error: String((e && e.message) || "store-error").slice(0, 80) },
                         { status: 502 });
  }
};

export const config = { path: "/api/deh-db" };
