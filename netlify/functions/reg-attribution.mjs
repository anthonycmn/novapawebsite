// Which ad an order came from, when the checkout itself cannot say.
//
// Why this exists (Sep 24 2026): the checkout only knows the utm_* and fbclid
// params on the /register/ URL of the visit that pays. No real NOVAPA family
// buys that way. They click a Meta ad, book a free class (which stores the
// full utm set on free_class_bookings), attend a week later, and check out
// from an email link or a typed address with nothing on the URL. Order
// 41762800 on Sep 24 was exactly that, from booking 40, and public.orders
// held 0 of 246 rows with any ad parameter while Meta claimed 18 purchases.
//
// The rule: when the order's own utm is empty, take the utm of the earliest
// tagged free-class booking for the same email, then the earliest tagged quiz
// lead. First touch wins, the same rule register/index.html applies to
// nova_attr, because the ad that started the journey is the one that earned
// it. An empty object counts as untagged: free-class/book.html posts {} when
// the URL has no params, and two bookings are stored that way.
//
// Nothing here throws. Each failure is logged under ATTRIBUTION_LOG so a
// broken lookup reads differently in the function log from a family who
// simply never clicked an ad.
import { SUPABASE_URL } from "./reg-config.mjs";

export const ATTRIBUTION_LOG = "[order-attribution]";
export const LEAD_TABLES = ["free_class_bookings", "quiz_leads"];

export function hasUtm(u) {
  return !!u && typeof u === "object" && !Array.isArray(u) && Object.keys(u).length > 0;
}

// The intent metadata carries utm as a JSON string ("" when the checkout had
// none). A string that will not parse is a bug upstream, so say so, and fall
// through to the lead lookup rather than lose the order's attribution.
export function parseMetaUtm(raw, orderId) {
  if (!raw) return null;
  try {
    const u = JSON.parse(raw);
    return hasUtm(u) ? u : null;
  } catch (e) {
    console.error(`${ATTRIBUTION_LOG} FAILED order ${orderId}: intent utm is not JSON (${e.message}): ${String(raw).slice(0, 120)}`);
    return null;
  }
}

// Earliest tagged lead for this email, as { utm, source } or null.
// ilike is only the index-friendly prefilter: "_" is a wildcard there, so the
// exact lowercase comparison below is what decides a match.
export async function firstTouchUtm(email, orderId, {
  fetchImpl = fetch, url = SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY,
} = {}) {
  const want = String(email || "").trim().toLowerCase();
  if (!want) return null;
  for (const table of LEAD_TABLES) {
    try {
      const r = await fetchImpl(
        `${url}/rest/v1/${table}?email=ilike.${encodeURIComponent(want)}&utm=not.is.null` +
        `&select=id,email,utm,created_at&order=created_at.asc&limit=20`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } });
      if (!r.ok) {
        console.error(`${ATTRIBUTION_LOG} FAILED order ${orderId}: ${table} lookup ${r.status}: ${(await r.text()).slice(0, 300)}`);
        continue;
      }
      const rows = await r.json();
      const hit = (Array.isArray(rows) ? rows : []).find((row) =>
        String(row.email || "").trim().toLowerCase() === want && hasUtm(row.utm));
      if (hit) return { utm: hit.utm, source: `${table}#${hit.id}` };
    } catch (e) {
      console.error(`${ATTRIBUTION_LOG} FAILED order ${orderId}: ${table} lookup threw: ${e.message}`);
    }
  }
  return null;
}

// Decide the order's utm and write it. Returns what happened, for the log and
// the tests: { wrote, source } on a write, { wrote: false, reason } otherwise.
export async function attributeOrder(orderId, meta, opts = {}) {
  const {
    fetchImpl = fetch, url = SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY,
  } = opts;
  try {
    let utm = parseMetaUtm(meta.utm, orderId);
    let source = "checkout";
    if (!utm) {
      const hit = await firstTouchUtm(meta.email, orderId, { fetchImpl, url, key });
      if (hit) ({ utm, source } = hit);
    }
    if (!utm) {
      console.log(`${ATTRIBUTION_LOG} order ${orderId}: no utm at checkout and no tagged lead for ${meta.email || "(no email)"}`);
      return { wrote: false, reason: "none" };
    }
    const r = await fetchImpl(`${url}/rest/v1/orders?id=eq.${orderId}`, {
      method: "PATCH",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ utm }),
    });
    if (!r.ok) {
      console.error(`${ATTRIBUTION_LOG} FAILED order ${orderId}: PATCH ${r.status}: ${(await r.text()).slice(0, 300)} (utm from ${source} was lost)`);
      return { wrote: false, reason: "patch", source, utm };
    }
    console.log(`${ATTRIBUTION_LOG} order ${orderId}: utm from ${source}`);
    return { wrote: true, source, utm };
  } catch (e) {
    console.error(`${ATTRIBUTION_LOG} FAILED order ${orderId}: ${e.message}`);
    return { wrote: false, reason: "error" };
  }
}
