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
const TEEN_CONS_IDS = [1960809, 1960811, 1805731]; // Sweeney, Hadestown, Dear Evan Hansen

// "8:30am - 4:00pm EDT" -> true. Evening rehearsals never cross lunch, so the
// pack-a-lunch note only shows where it applies.
function spansLunch(w) {
  if (!w || !w.time) return false;
  const m = String(w.time).match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm).*?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!m) return false;
  const h = (hh, ap) => (Number(hh) % 12) + (/pm/i.test(ap) ? 12 : 0);
  return h(m[1], m[3]) <= 12 && h(m[4], m[6]) >= 13;
}
const VENUE = "National Conference Center, 18945 Conference Center Drive, Plaza C, Leesburg, VA 20176";
const MAP_URL = "https://maps.google.com/?q=" + encodeURIComponent("18945 Conference Center Drive, Plaza C, Leesburg, VA 20176");
const ARRIVAL = [
  "We are in the South Building at Plaza C. Park in the south parking lot and take the walkway to the entrance.",
  "Parking is free. If you are dropping off and going, drop off at Plaza C.",
  "Pick-up has a fifteen minute grace period, after which a late fee of $15 per fifteen minutes applies. If you are running late, email us rather than letting us wonder.",
  "Email is our official channel for schedule changes, closures, casting and billing. Please check your spam folder and mark us as safe.",
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
    ? await svcJson(`activities?id=in.(${ids.join(",")})&select=id,name,class_times,location,age_range,category,price_cents`)
    : [];
  const byId = Object.fromEntries(acts.map((a) => [a.id, a]));
  return rows.map((r) => {
    const a = r.activity_id ? byId[r.activity_id] : null;
    const w = a ? whenFrom(a.class_times) : null;
    // A summer camp booked by (show, band) has no activity row, but it is
    // always an all-day production.
    const summer = !!r.show;
    const price = a ? (a.price_cents || 0) : 99500;
    const cat = a ? a.category : "camp";
    return {
      camper: r.camper_name || "Camper",
      name: a ? a.name : (r.show ? `${r.show} (ages ${r.band})` : "Program"),
      ages: a && a.age_range ? a.age_range : "",
      when: w,
      price: r.unit_price_cents,
      // Day-1 auditions run for every production. Teen Conservatory casts
      // audition months ahead, so Sweeney, Hadestown and Dear Evan Hansen are
      // out — Mean Girls is back on day-1 auditions (Jason, Aug 13).
      production: summer || (cat === "camp" && price >= 50000 && !TEEN_CONS_IDS.includes(a && a.id)),
      allDay: summer || spansLunch(w),
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

      ${(details && details.some((d) => d.production)) ? `
      <tr><td style="padding:14px 32px 4px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fdfbf6;border:1px solid #eee5d2;border-radius:10px">
          <tr><td style="padding:16px 18px">
            <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#8a7a55">Auditions are on day one</div>
            <p style="margin:8px 0 0;font-size:14px;color:#2a2a2a;line-height:1.6">
              This is for placement only. <b>Everyone who registered is in the company and everyone is cast.</b>
              Day one decides where your performer fits best.</p>
            <p style="margin:10px 0 0;font-size:13.5px;color:#555;line-height:1.6">What to bring to the audition:</p>
            <ul style="margin:6px 0 0;padding-left:18px;font-size:13.5px;color:#555;line-height:1.6">
              <li style="margin:4px 0"><b>A song they are confident singing.</b> Sixteen to thirty-two bars is plenty. Sheet music in a binder, or a backing track on a phone with a way to play it.</li>
              <li style="margin:4px 0"><b>A short monologue</b> if they have one they like. Optional, but it helps us.</li>
              <li style="margin:4px 0">Themselves, warmed up, having slept.</li>
            </ul>
            <p style="margin:10px 0 0;font-size:13.5px;color:#666;line-height:1.6">
              An audition here is not a test anyone can fail. We already want them. We are listening for where their
              voice sits and which room will stretch them most.</p>
          </td></tr>
        </table>
      </td></tr>` : ""}
      <tr><td style="padding:14px 32px 4px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fdfbf6;border:1px solid #eee5d2;border-radius:10px">
          <tr><td style="padding:16px 18px">
            <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#8a7a55">What to bring and wear</div>
            <ul style="margin:8px 0 0;padding-left:18px;font-size:13.5px;color:#555;line-height:1.6">
              ${(details && details.some((d) => d.allDay)) ? `<li style="margin:4px 0"><b>A packed lunch and a snack.</b> Lunch is not provided. No delivery during the day, and that one is firm.</li>` : ""}
              <li style="margin:4px 0">A refillable <b>water bottle</b>, named.</li>
              <li style="margin:4px 0">A <b>pencil</b>. Not a pen.</li>
              <li style="margin:4px 0">A <b>layer</b> — the building runs cold.</li>
              <li style="margin:4px 0">Anything with a name on it stands a much better chance of coming home.</li>
            </ul>
            <p style="margin:10px 0 0;font-size:13.5px;color:#555;line-height:1.6">
              <b>What to wear:</b> modest movement clothes with closed-toed shoes or dance shoes. Leggings, joggers or
              athletic shorts with a fitted top or t-shirt, things that stay put when you bend, lift your arms or lie on
              the floor. Hair tied back and off the face. No dangling jewellery or smartwatches. On the build crew,
              closed-toed shoes are the rule, not a suggestion.</p>
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
