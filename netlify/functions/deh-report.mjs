// End-of-day rehearsal report from the Dear Evan Hansen staff dashboard.
//
// The dashboard POSTs a structured summary; this renders it and mails it.
//
// SAFETY
//   The recipient is hardcoded. The dashboard is behind a shared word rather
//   than a login, so anyone who reaches it can call this — which is fine when
//   the only thing they can do is send CJ a rehearsal report, and is not fine
//   the moment the caller picks the address. Do not add a `to` parameter.
//
// TRANSPORT
//   Gmail SMTP, same as reg-email.mjs. This is internal transactional mail,
//   not a campaign, so it should not ride the marketing subdomain.

const TO = "cj@novapa.org";
const NAVY = "#0F1E36";
const GOLD = "#C8892A";

const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const DEPTS = {
  general: "General", stage: "Stage", music: "Music",
  costume: "Costume / Hair / Makeup", tech: "Set / Lights / Sound",
  props: "Props", safety: "Safety",
};
const STATUS = { present: "Present", late: "Late", absent: "Absent", excused: "Excused" };

function money(cents) {
  const n = (cents || 0) / 100;
  return "$" + n.toLocaleString("en-US", {
    minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2,
  });
}

function reportHtml(r) {
  const row = (label, value) => `
    <tr>
      <td style="padding:7px 0;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#8a94a6;width:38%;vertical-align:top">${esc(label)}</td>
      <td style="padding:7px 0;font-size:15px;color:#1a1a1a">${value}</td>
    </tr>`;

  const pct = r.blocksTotal ? Math.round((r.blocksDone / r.blocksTotal) * 100) : 0;

  const absent = (r.attendance || []).filter((a) => a.status !== "present");
  const attendanceBlock = !(r.attendance || []).length
    ? `<p style="margin:0;color:#8a94a6;font-size:14px">Attendance was not taken.</p>`
    : absent.length === 0
      ? `<p style="margin:0;font-size:15px">Full company present — all ${r.attendance.length} accounted for.</p>`
      : `<p style="margin:0 0 10px;font-size:15px">${r.attendance.length - absent.length} of ${r.attendance.length} present.</p>` +
        `<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">` +
        absent.map((a) => `
          <tr>
            <td style="padding:6px 0;font-size:15px;color:#1a1a1a;border-bottom:1px solid #eee8dd">${esc(a.name)}${a.role ? ` <span style="color:#8a94a6">· ${esc(a.role)}</span>` : ""}</td>
            <td style="padding:6px 0;font-size:14px;text-align:right;border-bottom:1px solid #eee8dd;white-space:nowrap;color:${a.status === "absent" ? "#B3261E" : "#8a6d1f"}">
              ${esc(STATUS[a.status] || a.status)}${a.note ? ` <span style="color:#8a94a6">· ${esc(a.note)}</span>` : ""}
            </td>
          </tr>`).join("") +
        `</table>`;

  const byDept = {};
  (r.notes || []).forEach((n) => { (byDept[n.dept] = byDept[n.dept] || []).push(n); });
  const notesBlock = !(r.notes || []).length
    ? `<p style="margin:0;color:#8a94a6;font-size:14px">No notes were filed today.</p>`
    : Object.keys(byDept).map((d) => `
        <p style="margin:0 0 4px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:${GOLD};font-weight:700">${esc(DEPTS[d] || d)}</p>
        <ul style="margin:0 0 16px;padding-left:20px">
          ${byDept[d].map((n) => `<li style="font-size:15px;line-height:1.6;color:#1a1a1a;margin-bottom:5px">${esc(n.body)}${n.author ? ` <span style="color:#8a94a6">— ${esc(n.author)}</span>` : ""}</li>`).join("")}
        </ul>`).join("");

  const completed = (r.completed || []).length
    ? `<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">` +
      r.completed.map((b) => `
        <tr>
          <td style="padding:6px 0;font-size:13px;color:#8a94a6;white-space:nowrap;vertical-align:top;width:78px">${esc(b.t)}</td>
          <td style="padding:6px 0;font-size:14.5px;line-height:1.5;color:#1a1a1a">${esc(b.a)}${b.by ? `<br><span style="font-size:12.5px;color:#8a94a6">signed off by ${esc(b.by)}</span>` : ""}</td>
        </tr>`).join("") + `</table>`
    : `<p style="margin:0;color:#8a94a6;font-size:14px">Nothing was checked off today.</p>`;

  return `<!doctype html><html><body style="margin:0;background:#f6f4ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <table cellpadding="0" cellspacing="0" style="width:100%;background:#f6f4ef"><tr><td align="center" style="padding:26px 12px">
    <table cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#fff;border-radius:14px;overflow:hidden">

      <tr><td style="background:${NAVY};padding:26px 32px">
        <p style="margin:0 0 5px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:${GOLD}">Rehearsal Report</p>
        <h1 style="margin:0;font-size:25px;color:#fff;font-weight:700">Dear Evan Hansen</h1>
        <p style="margin:7px 0 0;font-size:15px;color:rgba(255,255,255,.72)">${esc(r.dayLabel)}${r.code ? ` · ${esc(r.code)}` : ""}</p>
      </td></tr>

      <tr><td style="padding:22px 32px 6px">
        <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">
          ${row("Filed by", esc(r.by || "staff") + (r.at ? ` <span style="color:#8a94a6">· ${esc(r.at)}</span>` : ""))}
          ${row("Today", `${r.blocksDone} of ${r.blocksTotal} blocks complete <span style="color:#8a94a6">(${pct}%)</span>`)}
          ${row("Whole show", `${r.showDone} of ${r.showTotal} blocks complete`)}
          ${row("Spent so far", `${money(r.spentCents)} of ${money(r.budgetCents)}` +
            (r.outstandingCents ? ` <span style="color:#8a94a6">· ${money(r.outstandingCents)} ordered, not arrived</span>` : ""))}
        </table>
      </td></tr>

      <tr><td style="padding:18px 32px 0">
        <h2 style="margin:0 0 10px;font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:${NAVY};border-bottom:2px solid ${GOLD};padding-bottom:6px">Attendance</h2>
        ${attendanceBlock}
      </td></tr>

      <tr><td style="padding:22px 32px 0">
        <h2 style="margin:0 0 10px;font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:${NAVY};border-bottom:2px solid ${GOLD};padding-bottom:6px">Notes</h2>
        ${notesBlock}
      </td></tr>

      <tr><td style="padding:14px 32px 0">
        <h2 style="margin:0 0 10px;font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:${NAVY};border-bottom:2px solid ${GOLD};padding-bottom:6px">Completed today</h2>
        ${completed}
      </td></tr>

      <tr><td style="padding:24px 32px 28px">
        <p style="margin:0;font-size:12.5px;color:#999;line-height:1.6;border-top:1px solid #eee8dd;padding-top:14px">
          Generated from the Dear Evan Hansen staff dashboard.<br>
          Northern Virginia Performing Arts · 18945 Conference Center Drive, Plaza C, Leesburg VA 20175
        </p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

function reportText(r) {
  const L = [];
  L.push(`REHEARSAL REPORT — Dear Evan Hansen`);
  L.push(`${r.dayLabel}${r.code ? ` (${r.code})` : ""}`);
  L.push(`Filed by ${r.by || "staff"}${r.at ? ` at ${r.at}` : ""}`);
  L.push("");
  L.push(`Today: ${r.blocksDone}/${r.blocksTotal} blocks complete`);
  L.push(`Whole show: ${r.showDone}/${r.showTotal} blocks complete`);
  L.push(`Spent: ${money(r.spentCents)} of ${money(r.budgetCents)}`);
  L.push("");
  L.push("ATTENDANCE");
  const att = r.attendance || [];
  if (!att.length) L.push("  Not taken.");
  else {
    const out = att.filter((a) => a.status !== "present");
    L.push(`  ${att.length - out.length} of ${att.length} present.`);
    out.forEach((a) => L.push(`  ${a.name} — ${STATUS[a.status] || a.status}${a.note ? ` (${a.note})` : ""}`));
  }
  L.push("");
  L.push("NOTES");
  if (!(r.notes || []).length) L.push("  None filed.");
  else (r.notes || []).forEach((n) => L.push(`  [${DEPTS[n.dept] || n.dept}] ${n.body}${n.author ? ` — ${n.author}` : ""}`));
  L.push("");
  L.push("COMPLETED TODAY");
  if (!(r.completed || []).length) L.push("  Nothing checked off.");
  else (r.completed || []).forEach((b) => L.push(`  ${b.t}  ${b.a}${b.by ? ` — ${b.by}` : ""}`));
  return L.join("\n");
}

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let r;
  try { r = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }
  if (!r || !r.dayLabel) return new Response("Missing dayLabel", { status: 400 });

  // Trim anything unbounded before it reaches an inbox.
  r.notes = (r.notes || []).slice(0, 200);
  r.attendance = (r.attendance || []).slice(0, 200);
  r.completed = (r.completed || []).slice(0, 200);

  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  if (!user || !pass) {
    return Response.json({ ok: false, error: "mail-not-configured" }, { status: 503 });
  }

  try {
    const { default: nodemailer } = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass },
    });
    await transporter.sendMail({
      from: `NOVAPA Rehearsal Report <${user}>`,
      to: TO,
      replyTo: user,
      subject: `DEH rehearsal report — ${r.dayLabel}`,
      text: reportText(r),
      html: reportHtml(r),
    });
    return Response.json({ ok: true, to: TO });
  } catch (e) {
    return Response.json({ ok: false, error: String(e && e.message || e) }, { status: 502 });
  }
};

export const config = { path: "/api/deh-report" };
