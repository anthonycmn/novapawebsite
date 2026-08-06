// Free-class quiz funnel — POST /api/reg-funnel
//   { action: 'claim',   email, track, age_band, experience, offer } -> { lead_id }
//   { action: 'book',    lead_id, date }                             -> { ok }
//   { action: 'decline', lead_id }                                   -> { ok }
//
// Public endpoint (lead capture happens before any account exists), so it
// accepts nothing but the fields above and writes only to funnel_leads.
// The table is RLS-locked with no public policies; all access goes through
// the service role here.

const SUPABASE_URL = "https://tlkuqwsqicxcjdmumkje.supabase.co";

const TRACKS = ["performance", "tech"];
const AGES = ["5-9", "9-12", "12-19", "adult"];
const EXPERIENCE = ["first-show", "few-productions", "seasoned", "pre-professional"];

async function db(method, path, body) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`db ${r.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

export default async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  try {
    if (body.action === "claim") {
      const email = String(body.email || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200)
        return Response.json({ error: "valid email required" }, { status: 400 });
      const track = TRACKS.includes(body.track) ? body.track : null;
      const age = AGES.includes(body.age_band) ? body.age_band : null;
      const exp = EXPERIENCE.includes(body.experience) ? body.experience : null;
      const offer = String(body.offer || "").slice(0, 120);
      const rows = await db("POST", "funnel_leads", {
        email, track, age_band: age, experience: exp, offer,
      });
      return Response.json({ lead_id: rows[0].id });
    }

    if (body.action === "book" || body.action === "decline") {
      const id = String(body.lead_id || "");
      if (!/^[0-9a-f-]{36}$/.test(id))
        return Response.json({ error: "bad lead_id" }, { status: 400 });
      const patch =
        body.action === "book"
          ? { status: "booked", booking_date: String(body.date || "").slice(0, 10) || null }
          : { status: "declined" };
      await db("PATCH", `funnel_leads?id=eq.${id}`, patch);
      return Response.json({ ok: true });
    }

    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    console.error("reg-funnel", e);
    return Response.json({ error: "server error" }, { status: 500 });
  }
};

export const config = { path: "/api/reg-funnel" };
