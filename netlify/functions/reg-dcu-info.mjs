// POST /api/dcu-info — "email me the weekend" capture on dcunifieds.com's
// one-weekend landing page. Added 1 Sep 2026: session replays showed families
// researching for 30-70 minutes, clicking Register repeatedly, and leaving no
// contact behind — the quiz was the only email hook in the funnel.
//
// Saves the address as a light funnel_leads row via leads_api.submit_info_lead
// (INSERT-ONLY: an existing quiz lead's answers are never overwritten), then
// emails the requester the weekend rundown. New rows surface on the Leads
// board and trip the one-per-lead team alert automatically. Prices come from
// the activities table at send time so the email can never quote a stale sale.
import { SUPABASE_URL } from "./reg-config.mjs";
import { isTestAddress } from "./reg-lead-email.mjs";

const pick = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const usd = (c) => "$" + (c / 100).toLocaleString("en-US", { maximumFractionDigits: 0 });

export default async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const base = process.env.DCU_SUPABASE_URL;
  const dcuKey = process.env.DCU_SERVICE_KEY;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resend = process.env.RESEND_API_KEY;
  if (!base || !dcuKey || !svc) return Response.json({ error: "not configured" }, { status: 500 });

  let body = {};
  try { body = await req.json(); } catch {}
  const email = pick(body.email, 160).toLowerCase();
  const name = pick(body.name, 80);
  const phone = pick(body.phone, 40);
  const phoneDigits = (() => {
    const d = phone.replace(/\D/g, "");
    return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  })();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return Response.json({ error: "That email doesn't look right — mind checking it?" }, { status: 400 });
  }

  try {
    const r = await fetch(`${base}/rest/v1/rpc/submit_info_lead`, {
      method: "POST",
      headers: { apikey: dcuKey, Authorization: `Bearer ${dcuKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        p_email: email,
        p_name: name,
        p_phone: phone,
        p_phone_digits: phoneDigits,
        p_utm_source: pick(body.utm_source, 80),
        p_utm_medium: pick(body.utm_medium, 80),
        p_utm_campaign: pick(body.utm_campaign, 80),
        p_utm_content: pick(body.utm_content, 80),
        p_fbclid: pick(body.fbclid, 200),
        p_referrer: pick(body.referrer, 300),
        p_client_ip: req.headers.get("x-nf-client-connection-ip") || "",
      }),
    });
    if (!r.ok) throw new Error(`rpc ${r.status}: ${(await r.text()).slice(0, 160)}`);

    // Live tier prices so the email matches checkout to the dollar.
    let tiers = [];
    try {
      tiers = await (await fetch(
        `${SUPABASE_URL}/rest/v1/activities?id=in.(970601,970602,970603)&select=id,name,price_cents&order=price_cents.desc`,
        { headers: { apikey: svc, Authorization: `Bearer ${svc}` } })).json();
    } catch (e) { console.error("dcu-info prices:", e.message); }
    const tierRow = (a) => `<tr>
<td style="padding:7px 12px 7px 0;font:14.5px Helvetica,Arial,sans-serif;color:#0B1422">${esc(a.name.split("|")[1]?.trim() || a.name)}</td>
<td style="padding:7px 0;font:700 14.5px Helvetica,Arial,sans-serif;color:#0B1422;text-align:right">${usd(a.price_cents)}</td></tr>`;

    if (resend && !isTestAddress(email)) {
      const first = name.split(/\s+/)[0] || "";
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resend}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "DC Unifieds <hello@mail.novapa.org>",
          to: [email],
          reply_to: "info@novapa.org",
          subject: "DC Unifieds, in one email",
          html: `<div style="max-width:600px;margin:0 auto;padding:28px 22px;font-family:Helvetica,Arial,sans-serif;color:#0B1422">
<div style="font:700 22px/1.3 Helvetica,Arial,sans-serif;letter-spacing:-0.02em">The weekend, in one email</div>
<div style="font:15px/1.7 Helvetica,Arial,sans-serif;color:#5B6472;margin-top:10px">
Hi${first ? " " + esc(first) : ""} &mdash; here's everything about the weekend in one place, so you have it on hand whether you finish registering tonight or talk it over first.</div>

<table style="border-collapse:collapse;margin-top:16px;font:14.5px/1.6 Helvetica,Arial,sans-serif">
<tr><td style="padding:5px 12px 5px 0;color:#5B6472;white-space:nowrap">What it is</td><td style="padding:5px 0">Your student auditions once and is seen by 25+ college theatre programs &mdash; musical theatre, acting, dance, and tech &amp; design. Grades 9&ndash;12.</td></tr>
<tr><td style="padding:5px 12px 5px 0;color:#5B6472">When</td><td style="padding:5px 0">October 15&ndash;18, 2026</td></tr>
<tr><td style="padding:5px 12px 5px 0;color:#5B6472">Where</td><td style="padding:5px 0">The National Conference Center, Leesburg, VA</td></tr>
<tr><td style="padding:5px 12px 5px 0;color:#5B6472">Included</td><td style="padding:5px 0">The audition itself, workshops, and callbacks with attending programs &mdash; application and audition fees waived.</td></tr>
</table>

<div style="font:700 15px Helvetica,Arial,sans-serif;margin-top:18px">Current pricing</div>
<table style="border-collapse:collapse;margin-top:4px;width:100%;max-width:340px">${tiers.map(tierRow).join("")}</table>

<div style="margin-top:22px">
<a href="https://dcunifieds.com/one-weekend?utm_source=email&utm_medium=lead&utm_campaign=weekend-info"
   style="display:inline-block;background:#0B1422;color:#fff;font:700 15px/1 Helvetica,Arial,sans-serif;padding:13px 26px;border-radius:99px;text-decoration:none">Back to the weekend</a></div>

<div style="font:14px/1.7 Helvetica,Arial,sans-serif;color:#5B6472;margin-top:20px">
Questions &mdash; fit, tracks, travel, anything? Just reply to this email; a coach reads these.</div>

<div style="font:11.5px/1.9 Helvetica,Arial,sans-serif;color:#9AA1AC;margin-top:24px;border-top:1px solid #E4E7ED;padding-top:12px">
You started a registration at dcunifieds.com &mdash; this is that one email, not a mailing list.<br>
DC Unifieds &middot; The National Conference Center &middot; Leesburg, VA</div>
</div>`,
        }),
      }).catch((e) => console.error("dcu-info email:", e.message));
    }

    return Response.json({ ok: true });
  } catch (e) {
    console.error("dcu-info:", e.message);
    return Response.json({ error: "Something went wrong — try again." }, { status: 500 });
  }
};

export const config = { path: "/api/dcu-info" };
