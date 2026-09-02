// Scheduled alert for Find Your 5 leads — ONE email per submission, ever.
//
// Rebuilt Aug 31 2026 after the watermark design spammed the team: batch
// digests keyed on updated_at re-alerted whenever anything touched a row
// (admin notes, stage drags, purchase marks), and concurrent scheduled
// invocations raced the blob state into duplicate sends.
//
// The new model has no watermark and no blobs. Every candidate lead must win
// an atomic claim first: INSERT into lead_alert_sends (primary key lead_id)
// with ignore-duplicates. Exactly one invocation ever gets the row back, so
// exactly one email ever goes out per lead — the same claim-before-send
// pattern reg-campaign.mjs adopted after its own Aug 10 duplicate incident.
// Retakes UPDATE the lead row and are invisible here on purpose: created_at
// is the only signal, one submission means one email.
//
// Why this lives on the NOVAPA site: the DCU app has no RESEND_API_KEY, so
// its own notifyCoach falls into a void. We poll from the side with email.
import { SUPABASE_URL } from "./reg-config.mjs";
import { isTestAddress } from "./reg-lead-email.mjs";

const FROM = "NOVAPA Leads <leads@mail.novapa.org>";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function card(x) {
  const a = (() => { try { return JSON.parse(x.answers || "{}"); } catch { return {}; } })();
  const m = (() => { try { return JSON.parse(x.matches || "[]"); } catch { return []; } })();
  // weekend-info = the light email hook on dcunifieds.com/one-weekend (Sep 1):
  // no quiz answers to show, so the card is just the contact + where they came from
  if (a.quiz === "weekend-info") {
    return { hot: false, info: true, html: `<div style="max-width:620px;margin:0 auto;padding:26px 22px;font-family:Helvetica,Arial,sans-serif">
<div style="font:700 21px/1.2 Helvetica,Arial,sans-serif;color:#0B1422;letter-spacing:-0.02em">Started a DCU registration</div>
<div style="font:14px/1.7 Helvetica,Arial,sans-serif;margin-top:10px">
<a href="mailto:${esc(x.email)}" style="color:#0B1422">${esc(x.email)}</a>${x.phone ? " &middot; <a href=\"tel:" + esc(x.phone) + "\" style=\"color:#0B1422\">" + esc(x.phone) + "</a>" : ""}${x.name && x.name !== "Info request" ? " &middot; " + esc(x.name) : ""}</div>
<div style="font:13px/1.7 Helvetica,Arial,sans-serif;color:#5B6472;margin-top:6px">
Entered the register flow from dcunifieds.com/one-weekend. If no purchase follows, this is a warm call.
${esc([x.utm_campaign, x.utm_content].filter(Boolean).join(" / "))}</div>
<div style="font:12px/1.6 Helvetica,Arial,sans-serif;color:#5B6472;margin-top:14px">
They already got the weekend-details email. On the Leads board (DC Unifieds) in the admin dashboard.</div></div>` };
  }
  const hot = a.certainty === "locked" && a.prescreen === "filmed";
  const pill = hot
    ? '<span style="background:#1F7A38;color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px;margin-left:8px">HOT</span>'
    : "";
  return { hot, html: `<div style="max-width:620px;margin:0 auto;padding:26px 22px;font-family:Helvetica,Arial,sans-serif">
<div style="font:700 21px/1.2 Helvetica,Arial,sans-serif;color:#0B1422;letter-spacing:-0.02em">New Find Your 5 lead${pill}</div>
<div style="font:700 17px/1.3 Helvetica,Arial,sans-serif;color:#0B1422;margin-top:12px">${esc(x.name)}</div>
<div style="font:14px/1.6 Helvetica,Arial,sans-serif;margin-top:4px">
<a href="mailto:${esc(x.email)}" style="color:#0B1422">${esc(x.email)}</a> &middot;
<a href="tel:${esc(x.phone)}" style="color:#0B1422">${esc(x.phone)}</a></div>
<div style="font:13px/1.7 Helvetica,Arial,sans-serif;color:#5B6472;margin-top:6px">
${esc(x.student_name ? "Student: " + x.student_name : "")}${x.student_name ? "<br>" : ""}
${esc(x.role)} &middot; class of ${esc(x.grad_year)} &middot; ${esc(a.homeState || "?")}<br>
Wants <b>${esc(a.dream || "?")}</b> &middot; dance ${esc(a.dance || "?")} &middot; GPA ${esc(a.gpa || "?")}<br>
Prescreens <b>${esc(a.prescreen || "?")}</b> &middot; decision <b>${esc(a.certainty || "?")}</b> &middot; aid ${esc(a.budget || "?")}</div>
<div style="font:12px/1.6 Helvetica,Arial,sans-serif;color:#5B6472;margin-top:6px">
<b>Top 5:</b> ${esc(m.map((s) => s.school).filter(Boolean).join(", "))}</div>
<div style="font:12px/1.6 Helvetica,Arial,sans-serif;color:#5B6472;margin-top:16px">
Full details in the NOVAPA admin dashboard under Leads.</div></div>` };
}

export default async () => {
  if (String(process.env.LEADS_ALERT_ENABLED || "").toLowerCase() !== "on") {
    return new Response(JSON.stringify({ skipped: "disabled" }), { status: 200 });
  }
  const base = process.env.DCU_SUPABASE_URL;
  const key = process.env.DCU_SERVICE_KEY;
  const resend = process.env.RESEND_API_KEY;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key || !resend || !svc) {
    return new Response(JSON.stringify({ skipped: "not_configured" }), { status: 200 });
  }

  // Newest 50 by created_at — a submission is the only thing that creates a
  // row, so this window plus the claim table is complete coverage.
  const r = await fetch(
    `${base}/rest/v1/funnel_leads_ro?select=*&order=created_at.desc&limit=50`,
    { headers: { apikey: key, Authorization: `Bearer ${key}`, "Accept-Profile": "leads_api" } }
  );
  if (!r.ok) {
    return new Response(JSON.stringify({ error: `${r.status} ${(await r.text()).slice(0, 200)}` }), { status: 200 });
  }
  const rows = await r.json();

  const to = (process.env.LEADS_ALERT_TO || "jason@novapa.org")
    .split(",").map((s) => s.trim()).filter(Boolean);

  let sent = 0;
  for (const x of rows) {
    if (isTestAddress(x.email)) continue;
    // Atomic claim: only the invocation whose INSERT returns the row sends.
    const claim = await fetch(`${SUPABASE_URL}/rest/v1/lead_alert_sends?on_conflict=lead_id`, {
      method: "POST",
      headers: {
        apikey: svc, Authorization: `Bearer ${svc}`, "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify({ lead_id: x.id }),
    });
    if (!claim.ok) continue;
    const won = await claim.json();
    if (!Array.isArray(won) || !won.length) continue; // someone else already sent

    const { hot, info, html } = card(x);
    const ok = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resend}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM, to,
        subject: info
          ? `DCU weekend-info request: ${x.email}`
          : `New Find Your 5 lead: ${x.name}${hot ? " (hot)" : ""}`,
        html,
      }),
    });
    if (!ok.ok) {
      // release the claim so the next tick retries this lead
      await fetch(`${SUPABASE_URL}/rest/v1/lead_alert_sends?lead_id=eq.${encodeURIComponent(x.id)}`, {
        method: "DELETE", headers: { apikey: svc, Authorization: `Bearer ${svc}` },
      });
      continue;
    }
    sent++;
  }
  return new Response(JSON.stringify({ sent }), { status: 200 });
};

export const config = { schedule: "*/15 * * * *" };
