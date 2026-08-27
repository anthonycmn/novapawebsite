// Scheduled alert for Find Your 5 leads.
//
// Why this lives on the NOVAPA site and not the DC Unifieds one: the DCU app
// already has a notifyCoach() that fires on every submission, but that site
// has no RESEND_API_KEY, so src/lib/email.ts silently falls back to writing an
// HTML file into ./outbox/ — a directory that does not survive a Netlify
// function invocation. Every lead alert since Aug 23 2026 went there. Rather
// than redeploy an app with no GitHub remote, we poll from the side that
// already has verified email.
//
// Watermark lives in Netlify Blobs, not a table, so this needed no migration.
// It tracks updated_at because a returning email UPDATEs its funnel_leads row
// instead of inserting a new one — keying off created_at would miss retakes.
import { getStore } from "@netlify/blobs";
import { resultsEmail, isTestAddress } from "./reg-lead-email.mjs";

const FROM = "NOVAPA Leads <leads@mail.novapa.org>";
const LEAD_FROM = "DC Unifieds <leads@mail.novapa.org>";
const STORE = "lead-alerts";
const KEY = "dcu-watermark";
const SENT_KEY = "results-emailed";

async function sendMail(resend, payload) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resend}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return r.ok;
}

// The lead-facing send is tracked by lead id, not by the watermark, because a
// failed team alert holds the watermark back — and replaying that window must
// never email the same family their list twice.
async function emailLeads(store, resend, rows) {
  if (String(process.env.LEAD_RESULTS_EMAIL || "").toLowerCase() !== "on") {
    return { sent: 0, skipped: "disabled" };
  }
  let sentIds = [];
  try { sentIds = JSON.parse((await store.get(SENT_KEY)) || "[]"); } catch {}
  const already = new Set(sentIds);
  let sent = 0;
  for (const lead of rows) {
    if (already.has(lead.id) || isTestAddress(lead.email)) continue;
    const { subject, html } = resultsEmail(lead);
    const ok = await sendMail(resend, { from: LEAD_FROM, to: [lead.email], subject, html });
    if (ok) { already.add(lead.id); sent++; }
  }
  // Keep the tail bounded; ids age out long after any replay window closes.
  await store.set(SENT_KEY, JSON.stringify([...already].slice(-2000)));
  return { sent };
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function card(x) {
  const a = (() => { try { return JSON.parse(x.answers || "{}"); } catch { return {}; } })();
  const m = (() => { try { return JSON.parse(x.matches || "[]"); } catch { return []; } })();
  const hot = a.certainty === "locked" && a.prescreen === "filmed";
  const pill = hot
    ? '<span style="background:#1F7A38;color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px;margin-left:8px">HOT</span>'
    : "";
  return `<tr><td style="padding:16px 0;border-bottom:1px solid #E4E7ED">
<div style="font:700 17px/1.3 Helvetica,Arial,sans-serif;color:#0B1422">${esc(x.name)}${pill}</div>
<div style="font:14px/1.6 Helvetica,Arial,sans-serif;margin-top:4px">
<a href="mailto:${esc(x.email)}" style="color:#0B1422">${esc(x.email)}</a> &middot;
<a href="tel:${esc(x.phone)}" style="color:#0B1422">${esc(x.phone)}</a></div>
<div style="font:13px/1.7 Helvetica,Arial,sans-serif;color:#5B6472;margin-top:6px">
${esc(x.role)} &middot; class of ${esc(x.grad_year)} &middot; ${esc(a.homeState || "?")}<br>
Wants <b>${esc(a.dream || "?")}</b>, ${esc(a.structure || "?")} &middot; dance ${esc(a.dance || "?")} &middot; GPA ${esc(a.gpa || "?")}<br>
Prescreens <b>${esc(a.prescreen || "?")}</b> &middot; decision <b>${esc(a.certainty || "?")}</b> &middot; aid ${esc(a.budget || "?")}</div>
<div style="font:12px/1.6 Helvetica,Arial,sans-serif;color:#5B6472;margin-top:6px">
<b>Top 5:</b> ${esc(m.map((s) => s.school).filter(Boolean).join(", "))}</div></td></tr>`;
}

export default async () => {
  const base = process.env.DCU_SUPABASE_URL;
  const key = process.env.DCU_SERVICE_KEY;
  const resend = process.env.RESEND_API_KEY;
  if (!base || !key || !resend) {
    return new Response(JSON.stringify({ skipped: "not_configured" }), { status: 200 });
  }

  const store = getStore(STORE);
  // First run must not blast the whole back catalogue at the team. Seeding
  // from "now" at first tick would instead skip anything that arrived between
  // deploy and that tick, so the start line is a fixed timestamp set at
  // deploy time (LEADS_ALERT_SINCE) — everything after it alerts exactly once.
  let since = await store.get(KEY);
  if (!since) {
    since = process.env.LEADS_ALERT_SINCE || new Date().toISOString();
    await store.set(KEY, since);
  }

  const url = `${base}/rest/v1/funnel_leads_ro?select=*&updated_at=gt.${encodeURIComponent(since)}` +
              `&order=updated_at.asc&limit=50`;
  const r = await fetch(url, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Accept-Profile": "leads_api" },
  });
  if (!r.ok) {
    return new Response(JSON.stringify({ error: `${r.status} ${(await r.text()).slice(0, 200)}` }), { status: 200 });
  }
  const rows = await r.json();
  if (!rows.length) return new Response(JSON.stringify({ new: 0 }), { status: 200 });

  const to = (process.env.LEADS_ALERT_TO || "jason@novapa.org")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const hotCount = rows.filter((x) => {
    try { const a = JSON.parse(x.answers || "{}"); return a.certainty === "locked" && a.prescreen === "filmed"; }
    catch { return false; }
  }).length;

  const subject = rows.length === 1
    ? `Find Your 5 lead: ${rows[0].name}${hotCount ? " (hot)" : ""}`
    : `${rows.length} Find Your 5 leads${hotCount ? ` (${hotCount} hot)` : ""}`;

  const html = `<div style="max-width:620px;margin:0 auto;padding:26px 22px;font-family:Helvetica,Arial,sans-serif">
<div style="font:700 21px/1.2 Helvetica,Arial,sans-serif;color:#0B1422;letter-spacing:-0.02em">${esc(subject)}</div>
<table style="width:100%;border-collapse:collapse;margin-top:10px">${rows.map(card).join("")}</table>
<div style="font:12px/1.6 Helvetica,Arial,sans-serif;color:#5B6472;margin-top:18px">
Full list in the NOVAPA admin dashboard under Leads.</div></div>`;

  // The family gets their promised list first — that is the time-sensitive
  // half. The team alert can retry next tick; a lead's first impression cannot.
  const leadRes = await emailLeads(store, resend, rows);

  const ok = await sendMail(resend, { from: FROM, to, subject, html });
  // Only advance the watermark on a confirmed send, so a Resend outage
  // re-alerts next tick instead of dropping the leads on the floor.
  if (!ok) {
    return new Response(JSON.stringify({ error: "resend failed", leads: leadRes }), { status: 200 });
  }
  await store.set(KEY, rows[rows.length - 1].updated_at);
  return new Response(JSON.stringify({ alerted: rows.length, hot: hotCount, leads: leadRes }), { status: 200 });
};

export const config = { schedule: "*/15 * * * *" };
