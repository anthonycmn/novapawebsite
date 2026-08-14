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

async function svcPatch(path, body) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      "Content-Type": "application/json", Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`db ${r.status}`);
  return r.json();
}

// Referral tickets for this family: every earned reward where they are the
// referrer or the referred side, one entry per side they own.
async function rewardsFor(email) {
  const enc = encodeURIComponent(email);
  const rows = await svc(
    `referral_rewards?select=*&status=eq.earned&or=(referrer_email.ilike.${enc},referred_email.ilike.${enc})&order=created_at.desc`
  );
  const others = [...new Set(rows.map((r) =>
    r.referrer_email.toLowerCase() === email ? r.referred_email : r.referrer_email
  ))];
  const fams = others.length
    ? await svc(`families?select=email,parent_name&email=in.(${others.map(encodeURIComponent).join(",")})`)
    : [];
  const nameOf = Object.fromEntries(fams.map((f) => [f.email.toLowerCase(), f.parent_name]));
  return rows.map((r) => {
    const side = r.referrer_email.toLowerCase() === email ? "referrer" : "referred";
    const other = side === "referrer" ? r.referred_email : r.referrer_email;
    return {
      id: r.id,
      side,
      other_name: nameOf[other.toLowerCase()] || other,
      redeemed_at: side === "referrer" ? r.referrer_redeemed_at : r.referred_redeemed_at,
      created_at: r.created_at,
    };
  });
}

const fmtDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  const MO = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${MO[m - 1]} ${d}, ${y}`;
};

// Legacy `dates` strings are free text ("Wednesdays Sep 16 2026 - Jan 13 2027",
// "Mon, 7/13/2026, Tue, ..."). An item is "past" when the LATEST date we can
// find in the text is behind us; no parseable date = assume upcoming (safer).
const MONTHS = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
function isPast(text) {
  if (!text) return false;
  let max = null;
  for (const m of text.matchAll(/([A-Za-z]{3,9})\.?,? (\d{1,2}),? (\d{4})/g)) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo == null) continue;
    const d = new Date(Date.UTC(+m[3], mo, +m[2]));
    if (!max || d > max) max = d;
  }
  for (const m of text.matchAll(/(\d{1,2})\/(\d{1,2})\/(\d{4})/g)) {
    const d = new Date(Date.UTC(+m[3], +m[1] - 1, +m[2]));
    if (!max || d > max) max = d;
  }
  return max ? max < new Date() : false;
}

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

  // Self-serve redemption: the parent taps Redeem at the box office. Only the
  // side belonging to the signed-in email can be stamped, only once — the
  // is.null filter makes a double-tap (or a race) a no-op, not a re-stamp.
  if (body.action === "redeem_referral") {
    const id = String(body.reward_id || "");
    if (!/^[0-9a-f-]{36}$/.test(id)) return Response.json({ error: "bad reward" }, { status: 400 });
    try {
      const rw = (await svc(`referral_rewards?select=*&id=eq.${id}&limit=1`))[0];
      if (!rw) return Response.json({ error: "reward not found" }, { status: 404 });
      const side = rw.referrer_email.toLowerCase() === email ? "referrer"
        : rw.referred_email.toLowerCase() === email ? "referred" : null;
      if (!side) return Response.json({ error: "not your reward" }, { status: 403 });
      const col = side === "referrer" ? "referrer_redeemed_at" : "referred_redeemed_at";
      if (rw[col]) return Response.json({ error: "already redeemed" }, { status: 409 });
      const upd = await svcPatch(
        `referral_rewards?id=eq.${id}&${col}=is.null`,
        { [col]: new Date().toISOString() }
      );
      if (!upd.length) return Response.json({ error: "already redeemed" }, { status: 409 });
      return Response.json({ ok: true, redeemed_at: upd[0][col] });
    } catch (e) {
      console.error("reg-account redeem", e);
      return Response.json({ error: "server error" }, { status: 500 });
    }
  }

  try {
    const fam = (await svc(`families?select=id,parent_name,email&email=eq.${encodeURIComponent(email)}&limit=1`))[0] || null;
    const campers = fam
      ? await svc(`campers?select=name,day_camp_credits,snow_day_credits&family_id=eq.${fam.id}&order=name`)
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
      if (!byCamper[key].some((x) => x.title === title))
        byCamper[key].push({ title, dates: dates || "", past: isPast(dates) });
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

    // Day Camp Pack credits. A family buys the 5-day pack up front and picks
    // their dates later, from here. Credits live on the camper row; the picker
    // hands off to the normal checkout with the chosen dates preselected, so
    // priceCart applies the credits and the order completes at $0 through the
    // same money path as everything else.
    const credits = campers
      .map((c) => ({ name: c.name, day: c.day_camp_credits || 0, snow: c.snow_day_credits || 0 }))
      .filter((c) => c.day > 0 || c.snow > 0);

    // Only fetch the date list when somebody can actually use it.
    let dayCamps = [];
    if (credits.length) {
      const rows = await svc(
        `activities?select=id,name,price_cents,capacity,sold,booked_offline` +
        `&active=is.true&bookable=is.true&hidden=is.false&name=ilike.*day camp*&order=name`);
      dayCamps = rows
        .map((a) => ({
          id: a.id,
          name: a.name,
          remaining: a.capacity == null ? null
            : Math.max(0, a.capacity - (a.sold || 0) - (a.booked_offline || 0)),
          // "Ages 5–9 Day Camp · Mar 22, 2027" -> the date half, for sorting
          when: (a.name.split("·")[1] || "").trim(),
        }))
        .filter((a) => a.remaining === null || a.remaining > 0)
        .sort((a, b) => (Date.parse(a.when) || 0) - (Date.parse(b.when) || 0));
    }

    return Response.json({
      family: fam ? { parent_name: fam.parent_name, email: fam.email } : { email },
      campers: Object.entries(byCamper).map(([name, its]) => ({ name, items: its })),
      rewards: await rewardsFor(email),
      credits,
      dayCamps,
    });
  } catch (e) {
    console.error("reg-account", e);
    return Response.json({ error: "server error" }, { status: 500 });
  }
};

export const config = { path: "/api/reg-account" };
