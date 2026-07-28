// Credits & discount codes for the admin dashboard — POST /api/reg-coupons
//   { action: 'list' }                                  -> every code + what's left on it
//   { action: 'check_email', email }                    -> can this person actually sign in?
//   { action: 'create', ... }                           -> mint a code, returns it
//   { action: 'toggle', code, active }                  -> switch a code off/on
//
// Two kinds of code, and the difference matters:
//   credit   — a dollar balance that spends DOWN across as many orders as it takes.
//              A $792 credit used on a $90 class leaves $702 for next time.
//   discount — a percentage off one order, single use.
//
// Everything runs service-role behind an is_admin check, so Todd can mint codes
// without touching SQL and without the anon key ever seeing this table.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./reg-config.mjs";

const MAX_CREDIT_CENTS = 1000000; // $10,000 — a typo guard, not a policy

async function isAdmin(userToken) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${userToken}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!r.ok) return false;
  return (await r.text()).trim() === "true";
}
function svc(extra = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}
async function db(path, init = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: svc(init.headers || {}) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 200)}`);
  try { return JSON.parse(t); } catch { return null; }
}

// Readable, unambiguous codes: no O/0/I/1, so nobody mistypes one off a phone call.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function suffix(n = 4) {
  let s = "";
  for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}
function slug(label) {
  const words = String(label || "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  // surname is usually the last word and the most recognisable on a statement
  const pick = words.length > 1 ? words[words.length - 1] : (words[0] || "CREDIT");
  return pick.slice(0, 12);
}

export default async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!auth || !(await isAdmin(auth))) return Response.json({ error: "not admin" }, { status: 403 });

  let body = {};
  try { body = await req.json(); } catch {}
  const action = body.action || "list";

  if (action === "list") {
    const rows = await db("coupons?select=*&order=created_at.desc&limit=500");
    return Response.json({ coupons: rows || [] });
  }

  // Is this family actually able to redeem? A code is useless to someone who
  // can't get past the returning-family gate, and that is invisible otherwise.
  if (action === "check_email") {
    const email = String(body.email || "").trim().toLowerCase();
    if (!email) return Response.json({ known: null });
    const fam = await db(`families?email=ilike.${encodeURIComponent(email)}&select=email,parent_name`);
    return Response.json({ known: Array.isArray(fam) && fam.length > 0, family: (fam || [])[0] || null });
  }

  if (action === "create") {
    const kind = body.kind === "discount" ? "discount" : "credit";
    const label = String(body.label || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const note = String(body.note || "").trim();
    if (!label) return Response.json({ error: "Who is this for? Add a name." }, { status: 400 });

    let pct = null, amountCents = null, balanceCents = null, maxUses = null;

    if (kind === "credit") {
      const dollars = Number(body.amount);
      if (!isFinite(dollars) || dollars <= 0) {
        return Response.json({ error: "Enter a dollar amount greater than zero." }, { status: 400 });
      }
      amountCents = Math.round(dollars * 100);
      if (amountCents > MAX_CREDIT_CENTS) {
        return Response.json({ error: `That's over $${(MAX_CREDIT_CENTS / 100).toLocaleString()} — double-check the amount.` }, { status: 400 });
      }
      balanceCents = amountCents;      // spends down from here
      maxUses = null;                  // the balance governs, not a use counter
    } else {
      const p = Math.round(Number(body.pct));
      if (!isFinite(p) || p < 1 || p > 100) {
        return Response.json({ error: "Percentage must be between 1 and 100." }, { status: 400 });
      }
      pct = p;
      maxUses = Math.max(1, Math.round(Number(body.max_uses) || 1));
    }

    // expiry: whatever they picked, end of that day in ET
    let expires = null;
    if (body.expires) {
      const d = String(body.expires).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return Response.json({ error: "bad_date" }, { status: 400 });
      expires = `${d}T23:59:59-04:00`;
    }

    // Retry on the astronomically unlikely collision rather than 500 at Todd.
    let code = null, saved = null, lastErr = null;
    for (let attempt = 0; attempt < 5 && !saved; attempt++) {
      code = `${slug(label)}-${suffix()}`;
      try {
        const rows = await db("coupons", {
          method: "POST",
          headers: { "Content-Type": "application/json", Prefer: "return=representation" },
          body: JSON.stringify({
            code, pct, amount_cents: amountCents, balance_cents: balanceCents,
            active: true, expires_at: expires, max_uses: maxUses, uses: 0,
            note: [label, email ? `<${email}>` : null, note].filter(Boolean).join(" · "),
          }),
        });
        saved = (rows || [])[0] || null;
      } catch (e) {
        lastErr = e;
        if (!/duplicate|unique/i.test(e.message)) break;
      }
    }
    if (!saved) {
      console.error("coupon create failed:", lastErr && lastErr.message);
      return Response.json({ error: "Could not save that code — try again." }, { status: 502 });
    }

    // Tell them now if the recipient can't sign in, rather than after it fails.
    let warn = null;
    if (email) {
      const fam = await db(`families?email=ilike.${encodeURIComponent(email)}&select=email`);
      if (!Array.isArray(fam) || !fam.length) {
        warn = `${email} isn't in the registration system yet, so they won't get past the returning-family sign-in. Ask Jason to add them before you send this code.`;
      }
    }
    return Response.json({ coupon: saved, warn });
  }

  if (action === "toggle") {
    const code = String(body.code || "").trim();
    if (!code) return Response.json({ error: "no_code" }, { status: 400 });
    const rows = await db(`coupons?code=eq.${encodeURIComponent(code)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ active: !!body.active }),
    });
    return Response.json({ ok: true, coupon: (rows || [])[0] || null });
  }

  // Delete removes the row outright. Nothing references coupons — no foreign
  // keys, and orders don't store the code — so this orphans nothing. But for a
  // code that has been redeemed it also erases the only copy we hold of what it
  // was worth and who it was for; Stripe keeps it in the payment metadata and
  // we would not. So a used code needs an explicit confirm.
  if (action === "delete") {
    const code = String(body.code || "").trim();
    if (!code) return Response.json({ error: "no_code" }, { status: 400 });

    const rows = await db(`coupons?code=eq.${encodeURIComponent(code)}&select=*`);
    const c = (rows || [])[0];
    if (!c) return Response.json({ error: "That code no longer exists." }, { status: 404 });

    const used = (c.uses || 0) > 0;
    if (used && !body.confirm_used) {
      const spent = c.balance_cents != null
        ? ((c.amount_cents || 0) - c.balance_cents) : null;
      return Response.json({
        needs_confirm: true,
        uses: c.uses,
        spent_cents: spent,
        message: `${code} has been redeemed ${c.uses} time${c.uses === 1 ? "" : "s"}` +
          (spent ? ` for ${(spent / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}` : "") +
          `. Deleting it removes that record from this dashboard — Stripe keeps it on the payment, but you won't see it here again. Turning it off instead keeps the history.`,
      });
    }

    await db(`coupons?code=eq.${encodeURIComponent(code)}`, { method: "DELETE" });
    return Response.json({ ok: true, deleted: code });
  }

  return Response.json({ error: "unknown_action" }, { status: 400 });
};

export const config = { path: "/api/reg-coupons" };
