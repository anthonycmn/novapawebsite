// The terms a family agreed to, kept word for word (Oct 9 2026, Todd: "when
// parents sign the terms and conditions as written we need the system to
// capture what is in the terms and conditions").
//
// The checkout's "I agree" checkbox links to /terms and /policies. This reads
// those two pages and the checkbox sentence itself from the same deploy the
// function runs in, keeps only the legal text, and stores it once per version
// in terms_versions, keyed by a hash of the text. Every confirmed order then
// gets a terms_acceptances row pointing at the version that was live when it
// was paid. See db/terms-versions.sql.
//
// Reading the published pages, rather than keeping a second copy of the terms
// in code, means the record can never drift from what families were shown.
// The cost is that the extraction depends on the page markup; preflight runs
// the same extractors against the repo's files (check "terms-capture"), so a
// redesign that breaks them blocks the deploy instead of silently storing
// nothing.
//
// recordAcceptance never throws. A family who paid is registered whether or
// not we can file their copy of the terms; failures log as
// "[terms-acceptance] FAILED" and the row is written with a null hash when
// the text could not be read, so the gap is visible in admin.
import crypto from "node:crypto";
import { SUPABASE_URL } from "./reg-config.mjs";

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  mdash: "—", ndash: "–", middot: "·", rsaquo: "›",
  lsaquo: "‹", hellip: "…", copy: "©", reg: "®", trade: "™",
};

// HTML -> readable text. Headings become "## " lines so a version can be
// split into sections later (the change notice lists which ones moved).
export function htmlToText(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<span class="h\d-num">([^<]*)<\/span>/gi, "$1. ")
    .replace(/<h[1-4][^>]*>/gi, "\n## ")
    .replace(/<\/(h[1-6]|p|li|div|section|ul|ol|tr)>|<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n* ")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .split("\n").map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l, i, a) => l && !(l === "##" || l === "*"))
    .join("\n");
}

// Each extractor returns null when the markup it expects is not there.
// /terms: everything inside <main>.
export function extractTerms(html) {
  const m = String(html || "").match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  const t = m && htmlToText(m[1]);
  return t && t.length > 2000 ? t : null;
}
// /policies: the Terms & Conditions section only (privacy and cookies are
// not what the checkbox agrees to, and change for their own reasons).
export function extractPolicies(html) {
  const m = String(html || "").match(/<section\b[^>]*\bid="terms"[^>]*>([\s\S]*?)<\/section>/i);
  const t = m && htmlToText(m[1]);
  return t && t.length > 2000 ? t : null;
}
// /register/: the sentence beside the "I agree" checkbox.
export function extractCheckbox(html) {
  const m = String(html || "").match(/id="policyOk"[^>]*>\s*<span>([\s\S]*?)<\/span>/i);
  const t = m && htmlToText(m[1]).replace(/\n/g, " ");
  return t && /agree/i.test(t) ? t : null;
}

export function hashTerms(termsText, policiesText, checkboxText) {
  return crypto.createHash("sha256")
    .update(JSON.stringify([termsText, policiesText, checkboxText])).digest("hex");
}

// Sections of a stored text, by "## " heading: Map(heading -> body).
export function sections(text) {
  const out = new Map();
  let head = "(top)";
  for (const line of String(text || "").split("\n")) {
    if (line.startsWith("## ")) { head = line.slice(3).replace(/^\d+(\.\d+)*\.?\s*/, ""); out.set(head, out.get(head) || ""); continue; }
    out.set(head, (out.get(head) || "") + line + "\n");
  }
  return out;
}

// Which sections differ between two versions, by name. Effective-date lines
// live in the page hero, outside what is stored, so a date bump alone is not
// a change here.
export function changedSections(prev, next) {
  const changed = [];
  for (const key of ["terms_text", "policies_text"]) {
    const a = sections(prev?.[key]), b = sections(next?.[key]);
    for (const [h, body] of b) if (a.get(h) !== body) changed.push(a.has(h) ? h : `${h} (new)`);
    for (const h of a.keys()) if (!b.has(h)) changed.push(`${h} (removed)`);
  }
  if ((prev?.checkbox_text || "") !== (next?.checkbox_text || "")) changed.push("The agreement checkbox at checkout");
  return [...new Set(changed)];
}

function hdrs() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

// Read the three texts from a site origin. Throws when any is unreadable.
export async function readVersion(base) {
  const get = async (path) => {
    const r = await fetch(base.replace(/\/$/, "") + path, { redirect: "follow", signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`${path} answered ${r.status}`);
    return r.text();
  };
  const [t, p, c] = await Promise.all([get("/terms"), get("/policies"), get("/register/")]);
  const v = { terms_text: extractTerms(t), policies_text: extractPolicies(p), checkbox_text: extractCheckbox(c) };
  for (const [k, val] of Object.entries(v)) if (!val) throw new Error(`could not find ${k} on ${base}`);
  v.hash = hashTerms(v.terms_text, v.policies_text, v.checkbox_text);
  v.source_url = base;
  return v;
}

// Insert the version if it is new. Rows are never updated here.
export async function saveVersion(v) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/terms_versions?on_conflict=hash`, {
    method: "POST",
    headers: { ...hdrs(), Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({
      hash: v.hash, source_url: v.source_url,
      terms_text: v.terms_text, policies_text: v.policies_text, checkbox_text: v.checkbox_text,
    }),
  });
  if (!r.ok) throw new Error(`terms_versions insert ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

// The deploy this function belongs to. DEPLOY_URL is that exact deploy, so
// the text read is the text this checkout served, even mid-release.
function ownOrigin() {
  return process.env.DEPLOY_URL || process.env.URL || "https://novapa.org";
}

// One read and one insert per warm function instance, refreshed every ten
// minutes. A webhook burst after a campaign should not fetch three pages per
// order.
let cached = null;
async function currentHash() {
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.hash;
  const v = await readVersion(ownOrigin());
  await saveVersion(v);
  cached = { at: Date.now(), hash: v.hash };
  return v.hash;
}

// order: the confirmed order id. info: { email, intent, hold_id, source, ip, ua }.
//
// The row is keyed by stripe_intent (pi_/seti_ id, or "free_<hold>" for a $0
// order), the same key the parent-portal front door writes with (PR #168).
// Insert-if-absent first, so a row the front door already wrote keeps its
// version label; then fill in the text hash and checkout details on whichever
// row is there.
export async function recordAcceptance(orderId, info = {}) {
  if (!orderId || !info.intent) return;
  let hash = null;
  try { hash = await currentHash(); }
  catch (e) { console.error(`[terms-acceptance] FAILED to read terms for order ${orderId}: ${e.message}`); }
  const intent = String(info.intent);
  try {
    const ins = await fetch(`${SUPABASE_URL}/rest/v1/terms_acceptances?on_conflict=stripe_intent`, {
      method: "POST",
      headers: { ...hdrs(), Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({
        stripe_intent: intent,
        order_id: orderId,
        email: String(info.email || "").toLowerCase(),
        // the label column is required; the website's label is the text hash
        terms_version: hash ? `site-${hash.slice(0, 12)}` : "site-unread",
        source: info.source || "register",
      }),
    });
    if (!ins.ok) throw new Error(`insert ${ins.status}: ${(await ins.text()).slice(0, 200)}`);
    const upd = await fetch(`${SUPABASE_URL}/rest/v1/terms_acceptances?stripe_intent=eq.${encodeURIComponent(intent)}`, {
      method: "PATCH",
      headers: { ...hdrs(), Prefer: "return=minimal" },
      body: JSON.stringify({
        ...(hash ? { terms_hash: hash } : {}),
        hold_id: info.hold_id || null,
        checkout_ip: info.ip ? String(info.ip).slice(0, 64) : null,
        user_agent: info.ua ? String(info.ua).slice(0, 300) : null,
      }),
    });
    if (!upd.ok) throw new Error(`update ${upd.status}: ${(await upd.text()).slice(0, 200)}`);
  } catch (e) {
    console.error(`[terms-acceptance] FAILED for order ${orderId}: ${e.message}`);
  }
}
