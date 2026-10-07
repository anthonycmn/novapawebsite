// Rehearsal check-in by badge QR — /api/checkin (page: /checkin/)
//   POST { pass, op: "scan", code: "<camper32hex>.<prod8hex>" } -> card + status
//   POST { pass, op: "today" }                                -> who is in, per production
//
// Each cast badge's QR opens /checkin/?b=<code>. The door device scans it and
// this function marks the child in staff_portal.curriculum_attendance through
// public.production_checkin (db/registration/functions/production_checkin.sql),
// the same rows the staff portal attendance grid reads.
//
// The card it returns carries allergies and emergency contacts, so every call
// needs the staff passcode in CHECKIN_PASSCODE. Unset means closed, not open.

import { timingSafeEqual } from "node:crypto";

const SUPABASE_URL = "https://tlkuqwsqicxcjdmumkje.supabase.co";

async function rpc(fn, args) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(args || {}),
  });
  if (!r.ok) throw new Error(`rpc ${fn} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

function passOk(given) {
  const want = process.env.CHECKIN_PASSCODE || "";
  const a = Buffer.from(String(given || "").trim().toLowerCase());
  const b = Buffer.from(want.trim().toLowerCase());
  return b.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

// Accepts the bare code or the whole badge URL, whichever the scanner read.
export function parseCode(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/(?:[?&]b=)?([0-9a-f]{32})\.([0-9a-f]{8})(?:$|[&#\s])/i);
  if (!m) return null;
  const h = m[1].toLowerCase();
  const camper = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  return { camper, prod: m[2].toLowerCase() };
}

export default async (req) => {
  if (req.method !== "POST") return Response.json({ error: "method" }, { status: 405 });
  if (!process.env.CHECKIN_PASSCODE) return Response.json({ error: "not_configured" }, { status: 503 });
  let b;
  try { b = await req.json(); } catch { return Response.json({ error: "bad_json" }, { status: 400 }); }
  if (!passOk(b.pass)) return Response.json({ error: "passcode" }, { status: 401 });

  try {
    if (b.op === "today") return Response.json({ ok: true, productions: await rpc("production_checkin_today") });
    if (b.op === "scan") {
      const c = parseCode(b.code);
      if (!c) return Response.json({ ok: false, error: "bad_code" }, { status: 400 });
      const by = String(b.by || "").trim().slice(0, 60);
      const out = await rpc("production_checkin", {
        p_camper: c.camper, p_prod_prefix: c.prod, p_by: by ? `QR check-in (${by})` : "QR check-in",
      });
      return Response.json(out, { status: out.ok ? 200 : 404 });
    }
    if (b.op === "ping") return Response.json({ ok: true });
    return Response.json({ error: "op" }, { status: 400 });
  } catch (e) {
    console.error("checkin failed:", e.message);
    return Response.json({ error: "server" }, { status: 500 });
  }
};

export const config = { path: "/api/checkin" };
