// Abandoned-cart heads-up (CJ, Sep 30 2026) for CJ, Todd, Jen, and Katie
// Rivers (CART_ALERT_TO). One email per abandoned checkout, so the office can
// call while the family still cares. A declined card says so, with the reason.
//
// A checkout starts by taking a 30-minute hold (public.holds). A paid hold
// turns "confirmed"; one that expires unpaid stays "active" or is
// "released". A hold counts as abandoned when:
//   - it expired at least 30 minutes ago (so a family who is still typing
//     their card or retrying is left alone),
//   - it was created in the last 48 hours (so the first run does not mail
//     every stale cart since July),
//   - it is the newest hold that email has (a retry supersedes it), and
//   - no order exists for that email since the hold was made.
// Seats are not the question here: this is a sales signal, not inventory.
//
// Also here: "New account, no registration" for someone who signed up and
// never reached a cart (CJ: "someone goes to register and abandons").
//
// Send-once through the shared claim in reg-admin-alerts.mjs ("cart:<hold>",
// "signup:<email>").
import { SUPABASE_URL } from "./reg-config.mjs";
import { isTestAddress } from "./reg-lead-email.mjs";
import { withHeartbeat } from "./reg-heartbeat.mjs";
import Stripe from "stripe";
import { sendMoneyAlert, esc, cartAlertRecipients } from "./reg-admin-alerts.mjs";

// Did the family try to pay and get declined? Checkout's PaymentIntent carries
// the hold id, so ask Stripe for intents on this hold that hold a card error.
// The email then says "card declined: insufficient funds" instead of leaving
// the office to guess whether they walked away or were turned away.
async function declineFor(stripe, holdId) {
  if (!stripe) return "";
  try {
    const res = await stripe.paymentIntents.search({
      query: `metadata['hold_id']:'${String(holdId).replace(/'/g, "")}'`, limit: 5,
    });
    const hit = (res.data || []).find((p) => p.last_payment_error);
    if (!hit) return "";
    const e = hit.last_payment_error;
    return e.message || String(e.decline_code || e.code || "declined").replace(/_/g, " ");
  } catch (e) {
    console.error("decline lookup failed:", e.message);
    return "";
  }
}

const GRACE_MIN = 30;
const WINDOW_H = 48;

async function svc(path) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!r.ok) throw new Error(`${path.split("?")[0]} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// Supabase and PostgREST stamp times as "Z" or "+00:00"; compare instants.
const ms = (t) => Date.parse(t) || 0;

const inList =(xs) => `(${xs.map((x) => `"${String(x).replace(/"/g, "")}"`).join(",")})`;

const run = async () => {
  if (String(process.env.CART_ALERT || "on").toLowerCase() === "off") {
    return new Response(JSON.stringify({ skipped: "disabled" }), { status: 200 });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ skipped: "not_configured" }), { status: 200 });
  }
  const now = Date.now();
  const since = new Date(now - WINDOW_H * 3600e3).toISOString();
  const expiredBefore = new Date(now - GRACE_MIN * 60e3).toISOString();

  // Every hold in the window, newest first, so "newest per email" is the
  // first one seen.
  const holds = await svc(
    `holds?select=id,email,items,status,created_at,expires_at&created_at=gte.${since}&order=created_at.desc&limit=500`);
  const newest = new Map();
  for (const h of holds) {
    const e = String(h.email || "").trim().toLowerCase();
    if (!e || isTestAddress(e) || newest.has(e)) continue;
    newest.set(e, h);
  }
  const candidates = [...newest.entries()].filter(([, h]) =>
    h.status !== "confirmed" && h.expires_at && ms(h.expires_at) < ms(expiredBefore));
  const signups = await alertSignups({ since, expiredBefore });
  if (!candidates.length) return new Response(JSON.stringify({ sent: 0, signups }), { status: 200 });

  const emails = candidates.map(([e]) => e);
  const [orders, fams] = await Promise.all([
    svc(`orders?select=email,created_at&email=in.${encodeURIComponent(inList(emails))}&created_at=gte.${since}`),
    svc(`families?select=email,parent_name,phone&email=in.${encodeURIComponent(inList(emails))}`),
  ]);
  const boughtAt = {};
  for (const o of orders) {
    const e = String(o.email || "").toLowerCase();
    if (!boughtAt[e] || ms(o.created_at) > ms(boughtAt[e])) boughtAt[e] = o.created_at;
  }
  const fam = Object.fromEntries(fams.map((f) => [String(f.email || "").toLowerCase(), f]));

  const abandoned = candidates.filter(([e, h]) => !(boughtAt[e] && ms(boughtAt[e]) >= ms(h.created_at)));
  if (!abandoned.length) return new Response(JSON.stringify({ sent: 0, signups }), { status: 200 });

  const actIds = [...new Set(abandoned.flatMap(([, h]) =>
    (h.items || []).map((it) => it.activity_id).filter(Boolean)))];
  const acts = actIds.length ? await svc(`activities?select=id,name&id=in.(${actIds.join(",")})`) : [];
  const actName = Object.fromEntries(acts.map((a) => [a.id, a.name]));

  const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
  let sent = 0;
  for (const [email, h] of abandoned) {
    const f = fam[email] || {};
    const declined = await declineFor(stripe, h.id);
    const items = (h.items || []).map((it) => {
      const what = it.activity_id
        ? (actName[it.activity_id] || `activity ${it.activity_id}`)
        : [it.show, it.band].filter(Boolean).join(" ") || "an item";
      return `<li>${esc(it.camper || "(no student name)")}: ${esc(what)}</li>`;
    }).join("");
    const started = new Date(h.created_at).toLocaleString("en-US", {
      weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      timeZone: "America/New_York",
    });
    const label = f.parent_name || email;
    const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;max-width:620px">
<div style="font:700 19px/1.3 Helvetica,Arial,sans-serif;color:#8A5A00">Abandoned cart</div>
<div style="margin-top:12px"><b>${esc(f.parent_name || "(no name on file)")}</b>
&lt;<a href="mailto:${esc(email)}">${esc(email)}</a>&gt;${f.phone ? ` · <a href="tel:${esc(f.phone)}">${esc(f.phone)}</a>` : ""}</div>
<div style="color:#555;margin-top:4px">Started checkout ${esc(started)} and did not pay.</div>
${declined ? `<div style="margin-top:8px;color:#B3261E"><b>Their card was declined:</b> ${esc(declined)}. They tried to pay; a call to help with another card will likely close it.</div>` : ""}
<ul style="margin:10px 0 0 18px;padding:0">${items}</ul>
<div style="color:#555;margin-top:14px">Worth a call or a short note. <a href="https://novapa.org/register/admin/">Admin dashboard</a></div></div>`;
    const ok = await sendMoneyAlert(`cart:${h.id}`, {
      fn: "reg-cart-alert", kind: "admin_abandoned_cart",
      fromName: "NOVAPA Registrations",
      subject: declined ? `Abandoned cart (card declined): ${label}` : `Abandoned cart: ${label}`,
      html,
      to: cartAlertRecipients(),
    });
    if (ok) sent++;
  }
  return new Response(JSON.stringify({ sent, abandoned: abandoned.length, signups }), { status: 200 });
};

// The earlier drop-off: made an account (signed in with the emailed code)
// and never put anything in a cart. Same window and grace as carts, so the
// email lands 30 minutes after sign-up at the soonest. Anyone with a hold is the
// cart email's job; anyone with an order is a customer.
async function alertSignups({ since, expiredBefore }) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const users = [];
  for (let page = 1; page <= 10; page++) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=200`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!r.ok) break;
    const j = await r.json();
    const batch = j.users || j;
    if (!Array.isArray(batch) || !batch.length) break;
    users.push(...batch);
    if (batch.length < 200) break;
  }
  const fresh = users.filter((u) =>
    u.email && !isTestAddress(u.email) && u.last_sign_in_at &&
    ms(u.created_at) >= ms(since) && ms(u.created_at) < ms(expiredBefore));
  if (!fresh.length) return 0;

  const emails = fresh.map((u) => u.email.toLowerCase());
  const q = encodeURIComponent(inList(emails));
  const [holds, orders, fams] = await Promise.all([
    svc(`holds?select=email&email=in.${q}`),
    svc(`orders?select=email&email=in.${q}`),
    svc(`families?select=email,parent_name,phone&email=in.${q}`),
  ]);
  const busy = new Set([...holds, ...orders].map((x) => String(x.email || "").toLowerCase()));
  const fam = Object.fromEntries(fams.map((f) => [String(f.email || "").toLowerCase(), f]));

  let sent = 0;
  for (const u of fresh) {
    const email = u.email.toLowerCase();
    if (busy.has(email)) continue;
    const f = fam[email] || {};
    const when = new Date(u.created_at).toLocaleString("en-US", {
      weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      timeZone: "America/New_York",
    });
    const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;max-width:620px">
<div style="font:700 19px/1.3 Helvetica,Arial,sans-serif;color:#8A5A00">New account, nothing in the cart</div>
<div style="margin-top:12px"><b>${esc(f.parent_name || "(no name on file)")}</b>
&lt;<a href="mailto:${esc(email)}">${esc(email)}</a>&gt;${f.phone ? ` · <a href="tel:${esc(f.phone)}">${esc(f.phone)}</a>` : ""}</div>
<div style="color:#555;margin-top:4px">Created an account ${esc(when)} and has not started a registration.</div>
<div style="color:#555;margin-top:14px">Worth a note asking what they were looking for. <a href="https://novapa.org/register/admin/">Admin dashboard</a></div></div>`;
    const ok = await sendMoneyAlert(`signup:${email}`, {
      fn: "reg-cart-alert", kind: "admin_signup_no_cart",
      fromName: "NOVAPA Registrations",
      subject: `New account, no registration: ${f.parent_name || email}`,
      html,
    });
    if (ok) sent++;
  }
  return sent;
}

export default withHeartbeat("reg-cart-alert", run);

export const config = { schedule: "*/15 * * * *" };
