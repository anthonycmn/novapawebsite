// Ticket confirmation: called by reg-webhook when a PaymentIntent carries
// tix_hold_id metadata. Writes the order + per-seat tickets (idempotent on the
// payment intent) and emails the tickets. Kept out of reg-webhook.mjs so the
// camp confirmation path stays exactly as long as it was.
const SUPABASE_URL = "https://tlkuqwsqicxcjdmumkje.supabase.co";

async function svcRpc(fn, args) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${fn} ${r.status}: ${t.slice(0, 250)}`);
  try { return JSON.parse(t); } catch { return t; }
}

export async function confirmTickets(pi) {
  const m = pi.metadata || {};
  const res = await svcRpc("tix_confirm", {
    p_hold_id: m.tix_hold_id,
    p_email: m.email || "",
    p_buyer_name: m.buyer_name || null,
    p_total_cents: parseInt(m.total_cents || "0", 10),
    p_stripe_payment_intent: pi.id,
  });

  if (!res.duplicate) {
    try { await sendTicketEmail(m, res.code); }
    catch (e) { console.error("ticket email failed:", e.message); }
  }
  return res;
}

async function sendTicketEmail(m, code) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS || !m.email) return;
  const { default: nodemailer } = await import("nodemailer");
  const t = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const GOLD = "#C8892A";
  const seats = (m.seats || "").split(", ").filter(Boolean);
  const usd = (c) => "$" + ((parseInt(c || "0", 10) || 0) / 100).toFixed(2);
  await t.sendMail({
    from: `NOVAPA Box Office <${process.env.SMTP_USER}>`,
    replyTo: "info@novapa.org",
    to: m.email,
    subject: `Your tickets — ${m.show_title}, ${m.performance_when}`,
    html: `
<div style="font-family:Georgia,serif;background:#f5f2ec;padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="background:#0F1E36;padding:24px 28px">
  <div style="color:#fff;font-size:20px;font-weight:700">NOVAPA</div>
  <div style="color:${GOLD};font-size:13px;letter-spacing:.12em;margin-top:4px">BOX OFFICE</div>
</td></tr>
<tr><td style="padding:28px">
  <div style="font-size:22px;font-weight:700;color:#1a1a1a">${m.show_title}</div>
  <div style="font-size:15px;color:#444;margin-top:4px">${m.performance_when} · Loudoun Auditorium</div>
  <div style="margin:22px 0;padding:18px;background:#f8f5ef;border-radius:10px;text-align:center">
    <div style="font-size:12px;letter-spacing:.14em;color:#888">ORDER CODE</div>
    <div style="font-size:32px;font-weight:800;letter-spacing:.18em;color:#0F1E36;margin-top:4px">${code}</div>
    <div style="font-size:12.5px;color:#666;margin-top:6px">Give this code and your name at the door.</div>
  </div>
  <div style="font-size:12px;letter-spacing:.1em;color:#888;margin-bottom:6px">YOUR SEATS (${seats.length})</div>
  ${seats.map((s) => `<div style="padding:8px 0;border-bottom:1px solid #eee;font-size:15px;color:#1a1a1a">${s}</div>`).join("")}
  <div style="padding:12px 0;font-size:15px"><b>Total paid: ${usd(m.total_cents)}</b></div>
  <p style="font-size:13px;color:#666;line-height:1.6;margin-top:16px">
    The auditorium is between the ballroom and the hotel lobby at the Northern Virginia Conference Center,
    18980 West Belmont Place, Leesburg. Park in the garage. House opens 15 minutes before curtain.
    All sales are final; tickets are non-refundable and non-transferable.</p>
</td></tr>
</table></div>`,
  });
}
