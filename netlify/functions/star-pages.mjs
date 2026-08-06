// Star Page Ads — playbill ad orders, reachable only by private URL.
// POST /api/star-pages with { action, ... }:
//   { action: 'upload_url', filename, content_type }          -> { path, url }  (signed upload to private bucket)
//   { action: 'create_order', email, performer, message,
//             size, photo_path }                              -> { url }  (Stripe Checkout redirect)
//   { action: 'verify', session_id }                          -> { paid, performer, size }
//
// Currently DEH-only (show hardcoded below); the page is unlisted/noindex and
// shared privately with DEH families — no account gate by design (grandparents
// buy these too). Payment is a hosted Stripe Checkout with redirect-verify
// (no webhook); the admin money trail lives in star_page_ads + Stripe.
import Stripe from "stripe";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./reg-config.mjs";

const SHOW = "deh";
const PRICES = { full: 15000, half: 9000, quarter: 6000 };
const SIZE_LABEL = { full: "Full Page", half: "Half Page", quarter: "Quarter Page" };
const SITE = "https://www.northernvirginiaperformingarts.org";
const MAX_MESSAGE = 600;

function svc(extra = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}
async function db(path, init = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: svc({ "Content-Type": "application/json", ...(init.headers || {}) }) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 200)}`);
  try { return JSON.parse(t); } catch { return null; }
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export default async function handler(req) {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  let body;
  try { body = await req.json(); } catch { return json(400, { error: "bad json" }); }
  const email = String(body.email || "").trim().toLowerCase();

  try {
    if (body.action === "upload_url") {
      const clean = String(body.filename || "photo.jpg").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
      const path = `${SHOW}/${crypto.randomUUID()}-${clean}`;
      const r = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/star-pages/${path}`, {
        method: "POST", headers: svc({ "Content-Type": "application/json" }), body: "{}",
      });
      const t = await r.json();
      if (!r.ok || !t.url) return json(500, { error: "upload url failed" });
      return json(200, { path, url: `${SUPABASE_URL}/storage/v1${t.url}` });
    }

    if (body.action === "create_order") {
      if (!email || email.indexOf("@") < 0) return json(400, { error: "valid email required" });
      const size = String(body.size || "");
      if (!PRICES[size]) return json(400, { error: "bad size" });
      const performer = String(body.performer || "").trim().slice(0, 120);
      const message = String(body.message || "").trim().slice(0, MAX_MESSAGE);
      if (!performer || !message) return json(400, { error: "performer and message required" });
      if (!body.photo_path) return json(400, { error: "photo required" });

      const [row] = await db("star_page_ads", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          show: SHOW, family_email: email, performer_name: performer, message,
          photo_path: String(body.photo_path), size, amount_cents: PRICES[size],
        }),
      });

      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: email,
        line_items: [{
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: PRICES[size],
            product_data: {
              name: `Star Page Ad — ${SIZE_LABEL[size]}`,
              description: `Dear Evan Hansen playbill · for ${performer}`,
            },
          },
        }],
        metadata: { star_id: row.id, show: SHOW },
        success_url: `${SITE}/star-pages?done=1&sid={CHECKOUT_SESSION_ID}`,
        cancel_url: `${SITE}/star-pages?canceled=1`,
      });
      await db(`star_page_ads?id=eq.${row.id}`, { method: "PATCH", body: JSON.stringify({ stripe_session: session.id }) });
      return json(200, { url: session.url });
    }

    if (body.action === "verify") {
      const sid = String(body.session_id || "");
      if (!sid) return json(400, { error: "session_id required" });
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      const session = await stripe.checkout.sessions.retrieve(sid);
      const paid = session && session.payment_status === "paid";
      if (paid && session.metadata && session.metadata.star_id) {
        await db(`star_page_ads?id=eq.${session.metadata.star_id}&status=eq.pending`, {
          method: "PATCH", body: JSON.stringify({ status: "paid" }),
        });
        const [row] = await db(`star_page_ads?id=eq.${session.metadata.star_id}&select=performer_name,size`);
        return json(200, { paid: true, performer: row?.performer_name, size: SIZE_LABEL[row?.size] || row?.size });
      }
      return json(200, { paid: false });
    }

    if (body.action === "admin_list") {
      // Zoe's playbill view — every order, newest first, with 1-hour signed
      // photo links. Guarded by the same is_admin check as the rest of admin.
      const auth = req.headers.get("authorization") || "";
      const userToken = auth.replace(/^Bearer\s+/i, "");
      const chk = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, {
        method: "POST",
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${userToken}`, "Content-Type": "application/json" },
        body: "{}",
      });
      if (!chk.ok || (await chk.text()).trim() !== "true") return json(403, { error: "admins only" });

      const rows = await db("star_page_ads?select=*&order=created_at.desc");
      for (const r of rows) {
        if (!r.photo_path) continue;
        const s = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/star-pages/${r.photo_path}`, {
          method: "POST", headers: svc({ "Content-Type": "application/json" }), body: JSON.stringify({ expiresIn: 3600 }),
        });
        const t = await s.json().catch(() => null);
        r.photo_url = t && t.signedURL ? `${SUPABASE_URL}/storage/v1${t.signedURL}` : null;
      }
      return json(200, { ads: rows });
    }

    return json(400, { error: "unknown action" });
  } catch (e) {
    return json(500, { error: String(e.message || e).slice(0, 200) });
  }
}

export const config = { path: "/api/star-pages" };
