// The two things that happen after a family pays through the parent portal's
// front door (CJ, 30 Sep 2026), shared by reg-webhook (paid orders) and
// reg-pay ($0 orders, which never reach the webhook).
//
//  recordTerms    who agreed to the terms and conditions, which version, when,
//                 for which order. Until now the checkbox was enforced in the
//                 browser and saved nowhere.
//  portalWelcome  asks the parent portal to make the family's account NOW,
//                 rather than on the next 15-minute sync, and to email a
//                 sign-in link. Returns a second link for the receipt's
//                 "Open your parent portal" button, or "" when unavailable.
//
// Neither ever throws: the family has paid and is registered whatever
// happens here. Failures are logged; the 15-minute sync still makes the
// account, and the parent can always use "Forgot password".
import { SUPABASE_URL } from "./reg-config.mjs";

export async function recordTerms({ email, orderId, intent, version, source }) {
  if (!version || !email) return false;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return false;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/terms_acceptances?on_conflict=stripe_intent`, {
      method: "POST",
      headers: {
        apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=minimal",
      },
      body: JSON.stringify({
        email: String(email).toLowerCase(), order_id: orderId || null,
        stripe_intent: intent, terms_version: version, source: source || "register",
      }),
    });
    if (!r.ok) console.error("terms record failed:", r.status, (await r.text()).slice(0, 200));
    return r.ok;
  } catch (e) {
    console.error("terms record failed:", e.message);
    return false;
  }
}

export async function portalWelcome({ email, parentName, orderId, cartId }) {
  const url = process.env.PORTAL_WELCOME_URL;
  const secret = process.env.REGISTRATION_WEBHOOK_SECRET;
  if (!url || !secret || !email) return "";
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 9000);
    const r = await fetch(url, {
      method: "POST",
      signal: ctl.signal,
      headers: { "Content-Type": "application/json", "X-Registration-Secret": secret },
      body: JSON.stringify({ email, parent_name: parentName || "", order_id: orderId || null, cart_id: cartId || null }),
    });
    clearTimeout(t);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { console.error("portal welcome failed:", r.status, JSON.stringify(j).slice(0, 200)); return ""; }
    return typeof j.receipt_url === "string" ? j.receipt_url : "";
  } catch (e) {
    console.error("portal welcome failed:", e.message);
    return "";
  }
}

// The card a front-door cart's SECOND charge may use, or null. The first
// intent must have succeeded under an hour ago, for this same email, carrying
// this cart's id, with a saved card on a customer. Anything else is refused,
// so no other intent id can put a charge on someone's card.
export function secondChargeCard(first, { email, cartId, nowSec = Date.now() / 1000 }) {
  if (!first || !cartId || !email) return null;
  const fm = first.metadata || {};
  if (first.status !== "succeeded") return null;
  if (String(fm.email || "").toLowerCase() !== String(email).toLowerCase()) return null;
  if (fm.cart_id !== cartId) return null;
  if (!first.customer || !first.payment_method) return null;
  if (!(nowSec - first.created < 3600)) return null;
  return {
    customer: typeof first.customer === "string" ? first.customer : first.customer.id,
    pm: typeof first.payment_method === "string" ? first.payment_method : first.payment_method.id,
  };
}
