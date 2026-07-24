// Shared confirmation-email rendering + sending (webhook + free orders)
const GOLD = "#C8892A", NAVY = "#0F1E36";
export function money(cents) {
  return "$" + (cents / 100).toLocaleString("en-US",
    { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
}
export function confirmationHtml(m, pi) {
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
  const rows = items.map((it) =>
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
      <tr><td style="padding:18px 32px 6px">
        <p style="margin:0;font-size:13.5px;color:#555;line-height:1.7">
          Programs are held at the National Conference Center, 18980 Upper Belmont Place, Leesburg, VA 20176.<br>
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
export async function sendConfirmationEmail(m, pi) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS || !m.email) return;
  const { default: nodemailer } = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transporter.sendMail({
    from: `NOVAPA <${process.env.SMTP_USER}>`,
    to: m.email,
    subject: "You're in — NOVAPA registration confirmed",
    html: confirmationHtml(m, pi),
  });
}
