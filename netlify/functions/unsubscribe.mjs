// Email preference center for NOVAPA Mail. The link in an email body lands
// here as a GET, which only SHOWS the preference form — nothing changes until
// they save, so an accidental click costs nothing (Jason's call, Aug 2026,
// after his own test click silently suppressed him). The RFC 8058 one-click
// POST that Gmail/Yahoo fire from their own unsubscribe button must act
// immediately per their bulk-sender rules, so that path still suppresses
// marketing instantly. Token is an HMAC of the email so links can't be forged
// to manage other people's preferences.
import { SUPABASE_URL } from "./reg-config.mjs";
import { unsubToken } from "./reg-campaign.mjs";

// checked box = subscribed = no suppression row; unchecked = row exists
const SCOPES = [
  { key: "marketing", label: "Sales & announcements", hint: "Season openings, launch sales, new shows" },
  { key: "informational", label: "Important program updates", hint: "Schedules, reminders, and updates about your programs" },
];

function db(path, init = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
}

function page(title, inner) {
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="font-family:system-ui,sans-serif;background:#0B1B33;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0">
<div style="padding:28px;max-width:440px;width:100%;box-sizing:border-box">${inner}</div></body>`, {
    status: 200, headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export default async (req) => {
  const url = new URL(req.url);
  const email = (url.searchParams.get("e") || "").toLowerCase().trim();
  const token = url.searchParams.get("t") || "";
  if (!email || token !== unsubToken(email)) {
    return new Response("Invalid link.", { status: 400 });
  }

  if (req.method === "POST") {
    const body = await req.text();
    const params = new URLSearchParams(body);
    if (params.get("List-Unsubscribe") === "One-Click") {
      // mail-client button: must take effect immediately, no page shown
      await db("email_suppressions?on_conflict=email,scope", {
        method: "POST", headers: { Prefer: "resolution=ignore-duplicates" },
        body: JSON.stringify({ email, scope: "marketing", reason: "one-click unsubscribe" }),
      });
      return new Response("Unsubscribed.", { status: 200 });
    }
    // preference form save: unchecked scopes get a row, checked scopes lose theirs
    for (const s of SCOPES) {
      if (params.get(s.key) === "on") {
        await db(`email_suppressions?email=eq.${encodeURIComponent(email)}&scope=eq.${s.key}`, { method: "DELETE" });
      } else {
        await db("email_suppressions?on_conflict=email,scope", {
          method: "POST", headers: { Prefer: "resolution=ignore-duplicates" },
          body: JSON.stringify({ email, scope: s.key, reason: "preference page" }),
        });
      }
    }
    return page("Preferences saved", `<h2 style="margin:0 0 8px">Preferences saved</h2>
<p style="opacity:.8;line-height:1.5">Your email preferences for ${email} are updated.
Registration receipts and account emails always arrive.</p>`);
  }

  const supp = await (await db(`email_suppressions?email=eq.${encodeURIComponent(email)}&select=scope`)).json();
  const off = new Set(supp.map((r) => r.scope));
  const boxes = SCOPES.map((s) => `
<label style="display:flex;gap:12px;align-items:flex-start;padding:14px;border:1px solid rgba(255,255,255,.18);border-radius:10px;margin:0 0 10px;cursor:pointer">
<input type="checkbox" name="${s.key}" ${off.has(s.key) ? "" : "checked"} style="width:18px;height:18px;margin-top:2px;accent-color:#E8B84B">
<span><strong>${s.label}</strong><br><span style="opacity:.7;font-size:13px">${s.hint}</span></span></label>`).join("");
  return page("Email preferences", `<h2 style="margin:0 0 6px">Email preferences</h2>
<p style="opacity:.8;margin:0 0 18px;font-size:14px">for ${email}</p>
<form method="POST">${boxes}
<button type="submit" style="width:100%;padding:14px;border:0;border-radius:10px;background:#E8B84B;color:#0B1B33;font-weight:700;font-size:16px;cursor:pointer">Save preferences</button>
<p style="opacity:.55;font-size:12.5px;margin:14px 0 0;text-align:center">Registration receipts and sign-in links always arrive.</p>
</form>`);
};

export const config = { path: "/api/unsubscribe" };
