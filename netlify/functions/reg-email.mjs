// Shared confirmation-email rendering + sending (webhook + free orders)
const GOLD = "#C8892A", NAVY = "#0F1E36";
export function money(cents) {
  return "$" + (cents / 100).toLocaleString("en-US",
    { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
}

// ---- Sawyer-parity detail (Todd, Aug 13) -------------------------------
// Families kept replying to ask when their program starts, what time, where
// to park and what to bring — all of which Sawyer's confirmation answered and
// ours did not. The data was already in the catalog; it just never made it
// into the email. Pulled here rather than crammed into Stripe metadata,
// which caps at 500 characters per key.
const VENUE = "National Conference Center, 18945 Conference Center Drive, Plaza C, Leesburg, VA 20176";
const MAP_URL = "https://maps.google.com/?q=" + encodeURIComponent("18945 Conference Center Drive, Plaza C, Leesburg, VA 20176");
const ARRIVAL = [
  "We are in the South Building at Plaza C. Park in the south parking lot and take the walkway to the entrance.",
  "Follow the signs for pick-up and drop-off once you arrive.",
  "For any all-day program, please pack a lunch and a snack.",
];

async function svcJson(path) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return [];
  try {
    const r = await fetch(`https://tlkuqwsqicxcjdmumkje.supabase.co/rest/v1/${path}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    return r.ok ? await r.json() : [];
  } catch { return []; }
}

// class_times is Sawyer's own shape: [{title_text:"Tue", primary_text:["6:15pm - 7:45pm EDT"],
// secondary_text:"Sep 15, 2026 - Jan 26, 2027"}]
function whenFrom(classTimes) {
  const t = Array.isArray(classTimes) ? classTimes[0] : null;
  if (!t) return null;
  const day = (t.title_text || "").trim();
  const time = Array.isArray(t.primary_text) ? t.primary_text.join(", ") : (t.primary_text || "");
  const span = t.secondary_text || t.product_detail_date || "";
  return { day, time, span };
}

// One enriched line per seat: who, what, when, where.
export async function itemDetails(m, pi) {
  const piId = pi && pi.id;
  let rows = [];
  if (piId) {
    const orders = await svcJson(`orders?stripe_payment_intent=eq.${encodeURIComponent(piId)}&select=id,order_items(camper_name,show,band,activity_id,unit_price_cents)`);
    rows = (orders[0] && orders[0].order_items) || [];
    if (orders[0]) m.__order_id = orders[0].id;
  }
  if (!rows.length) return [];
  const ids = [...new Set(rows.map((r) => r.activity_id).filter(Boolean))];
  const acts = ids.length
    ? await svcJson(`activities?id=in.(${ids.join(",")})&select=id,name,class_times,location,age_range`)
    : [];
  const byId = Object.fromEntries(acts.map((a) => [a.id, a]));
  return rows.map((r) => {
    const a = r.activity_id ? byId[r.activity_id] : null;
    const w = a ? whenFrom(a.class_times) : null;
    return {
      camper: r.camper_name || "Camper",
      name: a ? a.name : (r.show ? `${r.show} (ages ${r.band})` : "Program"),
      ages: a && a.age_range ? a.age_range : "",
      when: w,
      price: r.unit_price_cents,
    };
  });
}

export function confirmationHtml(m, pi, details) {
  const items = (m.order_desc || "").split("; ").filter(Boolean);
  const today = pi.amount_received ?? pi.amount;
  const total = parseInt(m.total_cents || "0", 10) || today;
  const nInst = parseInt(m.n_installments || "0", 10) || 0;
  const instCents = parseInt(m.installment_cents || "0", 10) || 0;
  const firstInst = parseInt(m.first_installment_utc || "0", 10) || 0;
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  let planLine = "Paid in full — no future charges.";
  if (m.plan === "deposit" && nInst && firstInst) {
    const d = new Date(firstInst * 1000);
    planLine = `Then ${nInst} monthly payments of ${money(instCents)}, automatic on your card, ` +
      `starting ${months[d.getUTCMonth()]} 1, ${d.getUTCFullYear()} — fully paid before your program begins.`;
  } else if (m.plan === "subscription") {
    planLine = "Monthly tuition continues automatically on the 1st of each month through June 1, 2027. Cancel anytime with 30 days' notice.";
  }
  const esc = (x) => String(x == null ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const rows = (details && details.length)
    ? details.map((d) => `<tr><td style="padding:14px 0;border-bottom:1px solid #eee8dd">
        <div style="font-size:15px;color:#2a2a2a"><b>${esc(d.name)}</b></div>
        <div style="font-size:14px;color:#444;margin-top:3px">Participant: ${esc(d.camper)}${d.ages ? " &nbsp;·&nbsp; ages " + esc(d.ages) : ""}</div>
        ${d.when && (d.when.day || d.when.span) ? `<div style="font-size:14px;color:#444;margin-top:3px">
          ${d.when.day ? "<b>" + esc(d.when.day) + "</b>" : ""}${d.when.time ? " &nbsp;" + esc(d.when.time) : ""}
          ${d.when.span ? "<br>" + esc(d.when.span) : ""}</div>` : ""}
        ${d.price != null ? `<div style="font-size:13.5px;color:#666;margin-top:3px">${money(d.price)}</div>` : ""}
      </td></tr>`).join("")
    : items.map((it) =>
        `<tr><td style="padding:10px 0;border-bottom:1px solid #eee8dd;font-size:15px;color:#2a2a2a">${it}</td></tr>`
      ).join("");
  const couponRow = m.coupon
    ? `<tr><td style="padding:6px 0;font-size:14px;color:#2e7d4f">Coupon ${m.coupon}: −${money(parseInt(m.coupon_cents || "0", 10))}</td></tr>` : "";
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f5f2ec;font-family:Georgia,'Times New Roman',serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f2ec;padding:28px 12px"><tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e7e0d2">
      <tr><td style="background:${NAVY};padding:26px 32px;text-align:center">
        <div style="font-family:Georgia,serif;font-size:22px;letter-spacing:0.25em;color:#ffffff">NOVA<span style="color:#E8B84B">PA</span></div>
        <div style="font-size:12px;letter-spacing:0.18em;color:#c9b47a;text-transform:uppercase;margin-top:6px">Registration Confirmed</div>
      </td></tr>
      <tr><td style="padding:30px 32px 8px">
        <p style="margin:0 0 16px;font-size:16px;color:#2a2a2a">Hi${m.parent_name ? " " + m.parent_name.split(" ")[0] : ""},</p>
        <p style="margin:0 0 18px;font-size:15px;color:#444;line-height:1.6">You're in! Here's what we have for your family:</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
      </td></tr>
      <tr><td style="padding:14px 32px 6px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf7f0;border:1px solid #eee5d2;border-radius:10px">
          <tr><td style="padding:16px 18px">
            ${couponRow ? '<table role="presentation" width="100%">' + couponRow + "</table>" : ""}
            <div style="font-size:15px;color:#2a2a2a"><b>Paid today: ${money(today)}</b>${total > today ? " &nbsp;·&nbsp; Program total: " + money(total) : ""}</div>
            <div style="font-size:13.5px;color:#666;margin-top:6px;line-height:1.5">${planLine}</div>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:18px 32px 4px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf7f0;border:1px solid #eee5d2;border-radius:10px">
          <tr><td style="padding:16px 18px">
            <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#8a7a55">Where to go</div>
            <div style="font-size:14.5px;color:#2a2a2a;margin-top:6px">${VENUE}</div>
            <div style="margin-top:8px"><a href="${MAP_URL}" style="color:${GOLD};font-size:14px">Get directions &rarr;</a></div>
            <ul style="margin:12px 0 0;padding-left:18px;font-size:13.5px;color:#555;line-height:1.6">
              ${ARRIVAL.map((l) => `<li style="margin:4px 0">${l}</li>`).join("")}
            </ul>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:14px 32px 6px">
        <p style="margin:0;font-size:13.5px;color:#555;line-height:1.7">
          ${m.__order_id ? `Reference: order ${String(m.__order_id).slice(0, 8).toUpperCase()}<br>` : ""}
          ${m.fsa_eligible === "1" && pi && pi.id ? `Using a Dependent Care FSA? <a href="https://www.northernvirginiaperformingarts.org/api/fsa-receipt?pi=${pi.id}" style="color:${GOLD}">View and print your dependent-care receipt</a> (Tax ID 99-1421341).<br>`
            : m.fsa_eligible === "1" ? 'Using a Dependent Care FSA? Print your dependent-care receipt from your confirmation page (Tax ID 99-1421341).<br>' : ""}
          All sales are final — full policies at <a href="https://www.northernvirginiaperformingarts.org/policies" style="color:${GOLD}">novapa.org/policies</a>.
        </p>
      </td></tr>
      <tr><td style="padding:20px 32px 26px">
        <p style="margin:0;font-size:13px;color:#999;line-height:1.6;border-top:1px solid #eee8dd;padding-top:16px">
          Northern Virginia Performing Arts · Leesburg, VA<br>
          <a href="mailto:info@novapa.org" style="color:${GOLD}">info@novapa.org</a> · (571) 571-2120
        </p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}
// Some families want a second parent on every receipt (families.cc_email).
// Looked up here rather than threaded through every caller.
async function ccFor(email) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !email) return null;
  try {
    const r = await fetch(
      `https://tlkuqwsqicxcjdmumkje.supabase.co/rest/v1/families?select=cc_email&email=eq.${encodeURIComponent(email.toLowerCase())}&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const rows = r.ok ? await r.json() : [];
    return rows[0]?.cc_email || null;
  } catch { return null; }
}

export async function sendConfirmationEmail(m, pi) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS || !m.email) return;
  const { default: nodemailer } = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const cc = await ccFor(m.email);
  let details = [];
  try { details = await itemDetails(m, pi); } catch (e) { console.error("item details failed:", e.message); }
  await transporter.sendMail({
    from: `NOVAPA <${process.env.SMTP_USER}>`,
    replyTo: "info@novapa.org",
    to: m.email,
    ...(cc ? { cc } : {}),
    subject: "You're in — NOVAPA registration confirmed",
    html: confirmationHtml(m, pi, details),
  });
}
