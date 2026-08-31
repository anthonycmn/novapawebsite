// The Find Your 5 results email — the one the quiz promises the family.
//
// FitQuiz.tsx tells every lead "we'll email a copy so you still have the
// list next week." The template (reg-lead-email.mjs) was written and
// approved Aug 27 2026 but shipped switched off and never enabled; this
// function is its sender, stood up Aug 31 once Jason confirmed "I want
// people to get an email with their results."
//
// Same one-email-per-lead model as reg-leads-alert.mjs: no watermark, no
// blobs — each lead must win an atomic INSERT claim (primary key lead_id,
// ignore-duplicates) in lead_results_sends before anything sends, so
// concurrent invocations can never double-send and retakes never resend.
// The claims table starts EMPTY on purpose: the first enabled tick is the
// backfill that pays down the promise to every real lead already in the
// table.
import { SUPABASE_URL } from "./reg-config.mjs";
import { isTestAddress, resultsEmail } from "./reg-lead-email.mjs";

// Only mail.novapa.org is verified in Resend; the display name carries the
// DCU brand. Replies go to the customer inbox Jen works.
const FROM = "DC Unifieds <hello@mail.novapa.org>";
const REPLY_TO = "info@novapa.org";

export default async () => {
  if (String(process.env.LEAD_RESULTS_EMAIL || "").toLowerCase() !== "on") {
    return new Response(JSON.stringify({ skipped: "disabled" }), { status: 200 });
  }
  const base = process.env.DCU_SUPABASE_URL;
  const key = process.env.DCU_SERVICE_KEY;
  const resend = process.env.RESEND_API_KEY;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key || !resend || !svc) {
    return new Response(JSON.stringify({ skipped: "not_configured" }), { status: 200 });
  }

  const r = await fetch(
    `${base}/rest/v1/funnel_leads_ro?select=*&order=created_at.desc&limit=100`,
    { headers: { apikey: key, Authorization: `Bearer ${key}`, "Accept-Profile": "leads_api" } }
  );
  if (!r.ok) {
    return new Response(JSON.stringify({ error: `${r.status} ${(await r.text()).slice(0, 200)}` }), { status: 200 });
  }
  const rows = await r.json();

  let sent = 0;
  for (const x of rows) {
    if (isTestAddress(x.email)) continue;

    // Only leads with an actual list — the one-weekend quiz writes to the
    // same table with no matches, and an empty "your five programs" email
    // would read as a bug to the family.
    const matches = (() => { try { return JSON.parse(x.matches || "[]"); } catch { return []; } })();
    if (!Array.isArray(matches) || !matches.length) continue;

    const claim = await fetch(`${SUPABASE_URL}/rest/v1/lead_results_sends?on_conflict=lead_id`, {
      method: "POST",
      headers: {
        apikey: svc, Authorization: `Bearer ${svc}`, "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify({ lead_id: x.id }),
    });
    if (!claim.ok) continue;
    const won = await claim.json();
    if (!Array.isArray(won) || !won.length) continue; // already sent

    const { subject, html } = resultsEmail(x);
    const ok = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resend}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [x.email], reply_to: REPLY_TO, subject, html }),
    });
    if (!ok.ok) {
      // release the claim so the next tick retries this lead
      await fetch(`${SUPABASE_URL}/rest/v1/lead_results_sends?lead_id=eq.${encodeURIComponent(x.id)}`, {
        method: "DELETE", headers: { apikey: svc, Authorization: `Bearer ${svc}` },
      });
      continue;
    }
    sent++;
  }
  return new Response(JSON.stringify({ sent }), { status: 200 });
};

export const config = { schedule: "7,22,37,52 * * * *" };
