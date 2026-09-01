// POST /api/reg-waitlist — join the waitlist for a full cast.
//
// Born Aug 31 2026 when the Frozen bands were capped at 40 per CJ and the
// 9–12 cast hit 2 remaining. Distinct from the old join_waitlist RPC /
// public.waitlist pair, which captured emails while registration was gated
// to returning families; this one is per-activity and carries the camper.
//
// The server, not the pill the family clicked, decides whether the cast is
// actually full: a stale page can show Full after a cancellation freed a
// seat, and the right answer then is "go register", not a waitlist row.
// Joining is idempotent — the unique constraint plus ignore-duplicates means
// double-taps and repeat visits produce one row and one set of emails, the
// same one-per-submission rule the lead alerts follow.
import { SUPABASE_URL } from "./reg-config.mjs";
import { isTestAddress } from "./reg-lead-email.mjs";

const pick = (v, max) => String(v == null ? "" : v).trim().slice(0, max);

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

export default async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!svc) return Response.json({ error: "not configured" }, { status: 500 });
  const hdrs = { apikey: svc, Authorization: `Bearer ${svc}`, "Content-Type": "application/json" };

  let body = {};
  try { body = await req.json(); } catch {}
  const activityId = parseInt(body.activity_id, 10);
  const email = pick(body.email, 160).toLowerCase();
  const camperName = pick(body.camper_name, 80);
  const parentName = pick(body.parent_name, 80);

  if (!Number.isFinite(activityId)) return Response.json({ error: "bad activity" }, { status: 400 });
  if (camperName.length < 2) return Response.json({ error: "Please add the camper's name." }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return Response.json({ error: "That email doesn't look right — mind checking it?" }, { status: 400 });
  }

  try {
    const ar = await fetch(
      `${SUPABASE_URL}/rest/v1/activities?id=eq.${activityId}&select=id,name,capacity,sold,booked_offline`,
      { headers: hdrs });
    const acts = ar.ok ? await ar.json() : [];
    if (!acts.length) return Response.json({ error: "bad activity" }, { status: 400 });
    const a = acts[0];
    const remaining = a.capacity == null
      ? null : Math.max(0, a.capacity - (a.sold || 0) - (a.booked_offline || 0));
    // Uncapped or not actually full — the family should just register.
    if (remaining === null || remaining > 0) return Response.json({ open: true, remaining });

    const ins = await fetch(`${SUPABASE_URL}/rest/v1/cast_waitlist?on_conflict=activity_id,email,camper_name`, {
      method: "POST",
      headers: { ...hdrs, Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({ activity_id: activityId, email, camper_name: camperName, parent_name: parentName || null }),
    });
    if (!ins.ok) throw new Error(`insert ${ins.status}: ${(await ins.text()).slice(0, 160)}`);
    const rows = await ins.json();
    const isNew = Array.isArray(rows) && rows.length > 0;

    // Emails only on a genuinely new row — a repeat join stays silent.
    // Best-effort: a failed email never fails the join.
    if (isNew && !isTestAddress(email) && process.env.RESEND_API_KEY) {
      const rk = process.env.RESEND_API_KEY;
      const send = (msg) => fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${rk}`, "Content-Type": "application/json" },
        body: JSON.stringify(msg),
      }).catch((e) => console.error("reg-waitlist email:", e.message));

      const to = (process.env.LEADS_ALERT_TO || "jason@novapa.org").split(",").map((s) => s.trim()).filter(Boolean);
      const posr = await fetch(
        `${SUPABASE_URL}/rest/v1/cast_waitlist?activity_id=eq.${activityId}&select=id`,
        { headers: { ...hdrs, Prefer: "count=exact", Range: "0-0" } });
      const position = parseInt((posr.headers.get("content-range") || "").split("/")[1], 10) || null;

      await Promise.all([
        send({
          from: "NOVAPA Alerts <leads@mail.novapa.org>", to,
          subject: `Waitlist: ${camperName} for ${a.name}`,
          html: `<div style="max-width:600px;margin:0 auto;padding:26px 22px;font-family:Helvetica,Arial,sans-serif;color:#0B1422">
<div style="font:700 20px/1.3 Helvetica,Arial,sans-serif">${esc(camperName)} joined the waitlist</div>
<div style="font:14px/1.8 Helvetica,Arial,sans-serif;margin-top:10px">
${esc(a.name)} (full)${position ? ` &middot; #${position} on the list` : ""}<br>
Parent: ${esc(parentName || "?")} &middot; <a href="mailto:${esc(email)}" style="color:#0B1422">${esc(email)}</a></div>
<div style="font:13px/1.7 Helvetica,Arial,sans-serif;color:#5B6472;margin-top:14px">
If a seat opens, offer it here first and stamp notified_at so nobody is offered twice.</div></div>`,
        }),
        send({
          from: "NOVAPA <hello@mail.novapa.org>", to: [email], reply_to: "info@novapa.org",
          subject: `You're on the waitlist for ${a.name}`,
          html: `<div style="max-width:600px;margin:0 auto;padding:26px 22px;font-family:Helvetica,Arial,sans-serif;color:#0B1422">
<div style="font:700 20px/1.3 Helvetica,Arial,sans-serif">You're on the list</div>
<div style="font:15px/1.8 Helvetica,Arial,sans-serif;margin-top:10px">
Hi${parentName ? " " + esc(parentName.split(/\s+/)[0]) : ""} &mdash; ${esc(camperName)} is on the waitlist for
<b>${esc(a.name)}</b>. The cast is full right now, but spots do open up, and when one does
we email the waitlist in order before anyone else can take it.</div>
<div style="font:14px/1.7 Helvetica,Arial,sans-serif;color:#5B6472;margin-top:14px">
No payment, no commitment &mdash; you'll only hear from us if a spot opens.
Questions? Just reply to this email.</div>
<div style="font:11.5px/1.9 Helvetica,Arial,sans-serif;color:#9AA1AC;margin-top:24px;border-top:1px solid #E4E7ED;padding-top:12px">
Northern Virginia Performing Arts &middot; 18945 Conference Center Drive, Plaza C, Leesburg VA 20176</div></div>`,
        }),
      ]);
    }

    return Response.json({ ok: true, already: !isNew });
  } catch (e) {
    console.error("reg-waitlist:", e.message);
    return Response.json({ error: "Something went wrong — try again." }, { status: 500 });
  }
};

export const config = { path: "/api/reg-waitlist" };
