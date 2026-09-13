// SMS opt-in — /api/reg-sms-optin (novapa.org/sms)
//   POST { phone, email?, name?, consent, consent_text, source, hp }
//        -> { ok: true }
//
// Exists for Telnyx 10DLC compliance: carriers require a PUBLIC, directly
// loadable opt-in form (the checkout's phone field is buried behind the
// cart steps, which is exactly what the Sep 2026 vetting review rejected).
// Rows land in sms_optins (RLS closed, service role only) with the exact
// consent language — that column is the audit trail, so the client must
// send it and we refuse rows without it. When the email matches a family,
// the families row gets sms_consent stamped too, same shape reg-webhook
// writes for checkout opt-ins.
//
// hp is a honeypot: a visually hidden field real people never fill. Bots
// that fill it get { ok: true } and no row — arguing with a bot teaches it.

const SUPABASE_URL = "https://tlkuqwsqicxcjdmumkje.supabase.co";

async function db(method, path, body) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`db ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

export default async (req) => {
  if (req.method !== "POST") return Response.json({ error: "method" }, { status: 405 });
  let b;
  try { b = await req.json(); } catch { return Response.json({ error: "bad_json" }, { status: 400 }); }

  if (String(b.hp || "").trim()) return Response.json({ ok: true });

  const phone = String(b.phone || "").trim().slice(0, 40);
  const digits = phone.replace(/\D/g, "");
  const email = String(b.email || "").trim().toLowerCase().slice(0, 200) || null;
  const name = String(b.name || "").trim().slice(0, 120) || null;
  const consentText = String(b.consent_text || "").trim().slice(0, 1200);
  const source = ["sms-page", "register-checkout"].includes(b.source) ? b.source : "sms-page";

  if (b.consent !== true) return Response.json({ error: "consent_required" }, { status: 400 });
  if (digits.length < 10 || digits.length > 11) return Response.json({ error: "bad_phone" }, { status: 400 });
  if (!consentText) return Response.json({ error: "consent_text_required" }, { status: 400 });
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return Response.json({ error: "bad_email" }, { status: 400 });

  try {
    await db("POST", "sms_optins", {
      phone,
      phone_digits: digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits,
      email,
      name,
      consent: true,
      consent_text: consentText,
      source,
      ip: req.headers.get("x-nf-client-connection-ip") || null,
      user_agent: (req.headers.get("user-agent") || "").slice(0, 300) || null,
    });
    if (email) {
      // Best-effort mirror onto the family record; a miss is fine — the
      // sms_optins row alone is the consent of record.
      await db("PATCH",
        `families?email=ilike.${encodeURIComponent(email.replace(/([%_])/g, "\\$1"))}`,
        { phone, sms_consent: true, sms_consent_at: new Date().toISOString() }
      ).catch(() => {});
    }
    return Response.json({ ok: true });
  } catch (e) {
    console.error("sms-optin failed:", e.message);
    return Response.json({ error: "server" }, { status: 500 });
  }
};

export const config = { path: "/api/reg-sms-optin" };
