// One-click unsubscribe endpoint for NOVAPA Mail (Gmail/Yahoo bulk rules).
// GET renders a confirmation page and unsubscribes; POST is the RFC 8058
// one-click path mail clients call directly. Token is an HMAC of the email so
// links can't be forged to unsubscribe other people.
import { SUPABASE_URL } from "./reg-config.mjs";
import { unsubToken } from "./reg-campaign.mjs";

export default async (req) => {
  const url = new URL(req.url);
  const email = (url.searchParams.get("e") || "").toLowerCase().trim();
  const token = url.searchParams.get("t") || "";
  if (!email || token !== unsubToken(email)) {
    return new Response("Invalid unsubscribe link.", { status: 400 });
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  await fetch(`${SUPABASE_URL}/rest/v1/email_suppressions?on_conflict=email`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates" },
    body: JSON.stringify({ email, reason: "unsubscribe link" }),
  });
  return new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<body style="font-family:system-ui,sans-serif;background:#0B1B33;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0">
<div style="text-align:center;padding:24px;max-width:420px">
<h2 style="margin:0 0 8px">You're unsubscribed</h2>
<p style="opacity:.8;line-height:1.5">${email} won't receive marketing emails from NOVAPA anymore.
Registration receipts and account emails still arrive. Changed your mind? Just reply to any of our past emails.</p>
</div></body>`, { status: 200, headers: { "Content-Type": "text/html" } });
};

export const config = { path: "/api/unsubscribe" };
