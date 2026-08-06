// "My NOVAPA" family dashboard — POST /api/reg-account
// Bearer <supabase session token> -> { family, campers: [{name, items:[{title, dates}]}] }
//
// Read-only. The signed-in email is the key: web orders by email, plus
// imported Sawyer/Regpack enrollments matched by email OR camper name
// (legacy rows from portal sweeps often lack an email).

import { SHOWS, CAMP_START } from "./reg-config.mjs";

const SUPABASE_URL = "https://tlkuqwsqicxcjdmumkje.supabase.co";
const ANON_KEY = "sb_publishable_8ar97CkK-C0YlWuOGtI_tA_mwTDVE6H";

async function svc(path) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!r.ok) throw new Error(`db ${r.status}`);
  return r.json();
}

const fmtDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  const MO = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${MO[m - 1]} ${d}, ${y}`;
};

export default async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });

  // Two ways in: the family's private portal token (the link in their
  // emails — zero friction), or a Supabase session (OTP fallback).
  let email = "";
  let body = {};
  try { body = await req.json(); } catch {}
  if (body.portal_token && /^[0-9a-f-]{36}$/.test(body.portal_token)) {
    const fams = await svc(`families?select=email&portal_token=eq.${body.portal_token}&limit=1`);
    email = (fams[0]?.email || "").toLowerCase();
    if (!email) return Response.json({ error: "link not recognized" }, { status: 401 });
  } else {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return Response.json({ error: "sign in required" }, { status: 401 });
    const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!who.ok) return Response.json({ error: "sign in required" }, { status: 401 });
    email = ((await who.json()).email || "").toLowerCase();
    if (!email) return Response.json({ error: "sign in required" }, { status: 401 });
  }

  try {
    const fam = (await svc(`families?select=id,parent_name,email&email=eq.${encodeURIComponent(email)}&limit=1`))[0] || null;
    const campers = fam
      ? await svc(`campers?select=name&family_id=eq.${fam.id}&order=name`)
      : [];

    // Web orders (our checkout)
    const orders = await svc(`orders?select=id&email=eq.${encodeURIComponent(email)}&status=in.(paid,confirmed,complete,succeeded)`);
    let items = [];
    if (orders.length) {
      const ids = orders.map((o) => o.id).join(",");
      items = await svc(`order_items?select=show,band,camper_name,activity_id&order_id=in.(${ids})`);
    }
    const actIds = [...new Set(items.map((i) => i.activity_id).filter(Boolean))];
    const acts = actIds.length
      ? await svc(`activities?select=id,name&id=in.(${actIds.join(",")})`)
      : [];
    const actName = Object.fromEntries(acts.map((a) => [a.id, a.name]));

    // Imported enrollments (Sawyer / Regpack history and transfers)
    const names = campers.map((c) => `"${c.name.replace(/"/g, "")}"`);
    const orClauses = [`email.eq.${encodeURIComponent(email)}`];
    if (names.length) orClauses.push(`camper_name.in.(${names.join(",")})`);
    const legacy = await svc(`legacy_enrollments?select=camper_name,activity_text,dates&or=(${orClauses.join(",")})`);

    const byCamper = {};
    const add = (camper, title, dates) => {
      const key = camper || "Your family";
      byCamper[key] = byCamper[key] || [];
      if (!byCamper[key].some((x) => x.title === title)) byCamper[key].push({ title, dates: dates || "" });
    };
    for (const it of items) {
      if (it.show) {
        const title = `${SHOWS[it.show] || it.show}${it.band && it.band !== "tech" ? ` (Ages ${it.band})` : it.band === "tech" ? " (Tech Crew)" : ""}`;
        add(it.camper_name, title, CAMP_START[it.show] ? `Starts ${fmtDate(CAMP_START[it.show])}` : "");
      } else if (it.activity_id && actName[it.activity_id]) {
        add(it.camper_name, actName[it.activity_id], "");
      }
    }
    for (const le of legacy) add(le.camper_name, le.activity_text, le.dates);

    return Response.json({
      family: fam ? { parent_name: fam.parent_name, email: fam.email } : { email },
      campers: Object.entries(byCamper).map(([name, its]) => ({ name, items: its })),
    });
  } catch (e) {
    console.error("reg-account", e);
    return Response.json({ error: "server error" }, { status: 500 });
  }
};

export const config = { path: "/api/reg-account" };
