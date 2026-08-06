// End-of-day rehearsal report from the Dear Evan Hansen staff dashboard, and
// the purchasing list that goes with it.
//
// The dashboard POSTs a structured summary; this renders it and mails it.
// `kind` picks which of the two it is — see RECIPIENTS.
//
// SAFETY
//   Every recipient is hardcoded. The dashboard is behind a shared word rather
//   than a login, so anyone who reaches it can call this — which is fine when
//   the only thing they can do is send the production team a rehearsal report,
//   and is not fine the moment the caller picks the address. `kind` chooses
//   between two fixed lists and nothing else. Do not add a `to` parameter.
//
// TRANSPORT
//   Gmail SMTP, same as reg-email.mjs. This is internal transactional mail,
//   not a campaign, so it should not ride the marketing subdomain.

// The report goes to the people who have to act on it overnight; the buy list
// goes to whoever is actually placing the orders, with CJ copied because it
// commits the production's money.
const RECIPIENTS = {
  report: { to: ["colton@novapa.org", "ryyana@novapa.org", "katieh@novapa.org", "cj@novapa.org"] },
  buy:    { to: ["todd@novapa.org"], cc: ["cj@novapa.org"] },
};

const NAVY = "#0F1E36";
const GOLD = "#C8892A";

const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Never put a javascript: or data: URL into an href, even one that reached us
// through our own dashboard.
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || "").trim()) ? String(u).trim() : "");
const linksOf = (x) => {
  const raw = Array.isArray(x?.links) && x.links.length ? x.links : (x?.link ? [x.link] : []);
  const out = [];
  for (const u of raw) {
    const s = safeUrl(u);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= 12) break;
  }
  return out;
};

// Keys and order match DEPTS in deh/app.js.
const DEPT_ORDER = [
  "general", "stage", "music", "scenic", "lighting", "sound", "projection",
  "sfx", "props", "costume", "hair", "wigs", "safety",
];
const DEPTS = {
  general: "General", stage: "Stage", music: "Music",
  scenic: "Scenic", lighting: "Lighting", sound: "Sound",
  projection: "Projection", sfx: "Special FX", props: "Props",
  costume: "Costumes", hair: "Hair & Make-Up", wigs: "Wigs",
  safety: "Safety",
  // Filed before the design departments were split apart.
  tech: "Set / Lights / Sound",
};
const deptRank = (k) => {
  const i = DEPT_ORDER.indexOf(k);
  return i < 0 ? DEPT_ORDER.length : i;
};
const STATUS = { present: "Present", late: "Late", absent: "Absent", excused: "Excused" };

function money(cents) {
  const n = (cents || 0) / 100;
  return "$" + n.toLocaleString("en-US", {
    minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2,
  });
}

export function reportHtml(r) {
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
    : Object.keys(byDept).sort((a, b) => deptRank(a) - deptRank(b)).map((d) => `
        <p style="margin:0 0 4px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:${GOLD};font-weight:700">${esc(DEPTS[d] || d)}</p>
        <ul style="margin:0 0 16px;padding-left:20px">
          ${byDept[d].map((n) => `<li style="font-size:15px;line-height:1.6;color:#1a1a1a;margin-bottom:5px">${esc(n.body)}${n.author ? ` <span style="color:#8a94a6">— ${esc(n.author)}</span>` : ""}</li>`).join("")}
        </ul>`).join("");

  // CJ wants the day's buy links in the email itself, so purchasing can happen
  // straight off the report rather than by going back into the dashboard.
  const STATUS_L = { todo: "To source", sourced: "Sourced", ordered: "Ordered", arrived: "Arrived", done: "Done" };
  const srcTotal = (r.sourcing || []).reduce((a, x) => a + (x.line_cents || 0), 0);
  const sourcing = (r.sourcing || []).length
    ? `<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">` +
      r.sourcing.map((x) => {
        const ls = linksOf(x);
        return `
        <tr>
          <td style="padding:9px 0;border-bottom:1px solid #eee8dd">
            ${ls.length
              ? `<a href="${esc(ls[0])}" style="font-size:15px;color:${GOLD};font-weight:600;text-decoration:none">${esc(x.name)}${x.qty > 1 ? ` &times;${x.qty}` : ""}</a>`
              : `<span style="font-size:15px;color:#1a1a1a;font-weight:600">${esc(x.name)}${x.qty > 1 ? ` &times;${x.qty}` : ""}</span>`}
            <div style="font-size:12.5px;color:#8a94a6;margin-top:3px">${esc(x.who || x.scene || "")}${x.who && x.scene ? ` &middot; ${esc(x.scene)}` : ""}${x.cat ? ` &middot; ${esc(x.cat)}` : ""}${x.vendor ? ` &middot; ${esc(x.vendor)}` : ""}${x.status ? ` &middot; ${esc(STATUS_L[x.status] || x.status)}` : ""}${x.by ? ` &middot; ${esc(x.by)}` : ""}</div>
            ${ls.map((u, i) => `<div style="font-size:12px;color:#b0b6c0;margin-top:3px;word-break:break-all">${ls.length > 1 ? `<b style="color:#8a94a6">${i + 1}.</b> ` : ""}<a href="${esc(u)}" style="color:#b0b6c0;text-decoration:none">${esc(u)}</a></div>`).join("")}
          </td>
          <td style="padding:9px 0;border-bottom:1px solid #eee8dd;text-align:right;vertical-align:top;white-space:nowrap;font-size:14px;color:#1a1a1a">${x.line_cents ? money(x.line_cents) : `<span style="color:#8a94a6">no price</span>`}</td>
        </tr>`;
      }).join("") + `</table>
      <p style="margin:10px 0 0;font-size:13px;color:#8a94a6">Every title above is a link to the source. Added today: <b style="color:#1a1a1a">${money(srcTotal)}</b>.</p>`
    : `<p style="margin:0;color:#8a94a6;font-size:14px">No new buy links today.</p>`;

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

      <tr><td style="padding:22px 32px 0">
        <h2 style="margin:0 0 10px;font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:${NAVY};border-bottom:2px solid ${GOLD};padding-bottom:6px">Sourced today &mdash; links to buy</h2>
        ${sourcing}
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

export function reportText(r) {
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
  else [...(r.notes || [])].sort((a, b) => deptRank(a.dept) - deptRank(b.dept))
    .forEach((n) => L.push(`  [${DEPTS[n.dept] || n.dept}] ${n.body}${n.author ? ` — ${n.author}` : ""}`));
  L.push("");
  L.push("SOURCED TODAY \u2014 LINKS TO BUY");
  if (!(r.sourcing || []).length) L.push("  No new buy links today.");
  else (r.sourcing || []).forEach((x) => {
    L.push(`  ${x.name}${x.qty > 1 ? ` x${x.qty}` : ""}${x.who ? `  (${x.who})` : ""}${x.vendor ? `  [${x.vendor}]` : ""}${x.line_cents ? `  ${money(x.line_cents)}` : ""}${x.by ? `  - ${x.by}` : ""}`);
    linksOf(x).forEach((u) => L.push(`      ${u}`));
  });
  L.push("");
  L.push("COMPLETED TODAY");
  if (!(r.completed || []).length) L.push("  Nothing checked off.");
  else (r.completed || []).forEach((b) => L.push(`  ${b.t}  ${b.a}${b.by ? ` — ${b.by}` : ""}`));
  return L.join("\n");
}

// ── the buy list ─────────────────────────────────────────────────────────
// Sent when someone has finished loading links in and presses the button.
// One job: put every link in front of the person doing the buying, grouped
// the way they will actually shop — by vendor, one tab per line.

export function buyHtml(r) {
  const items = r.items || [];
  const byVendor = {};
  items.forEach((x) => {
    const v = String(x.vendor || "").trim() || "Not sourced yet";
    (byVendor[v] = byVendor[v] || []).push(x);
  });
  const vendors = Object.keys(byVendor).sort((a, b) =>
    a === "Not sourced yet" ? 1 : b === "Not sourced yet" ? -1 : a.localeCompare(b));

  const linkCount = items.reduce((a, x) => a + linksOf(x).length, 0);

  const groups = vendors.map((v) => {
    const list = byVendor[v];
    const sub = list.reduce((a, x) => a + (x.line_cents || 0), 0);
    return `
      <tr><td style="padding:20px 32px 0">
        <h2 style="margin:0 0 4px;font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:${NAVY};border-bottom:2px solid ${GOLD};padding-bottom:6px">
          ${esc(v)} <span style="float:right;color:#8a94a6;letter-spacing:0;text-transform:none;font-weight:400">${list.length} item${list.length === 1 ? "" : "s"} &middot; ${money(sub)}</span>
        </h2>
        <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">
          ${list.map((x) => {
            const ls = linksOf(x);
            return `
            <tr>
              <td style="padding:11px 0;border-bottom:1px solid #eee8dd">
                <div style="font-size:15px;color:#1a1a1a;font-weight:600">${esc(x.name)}${x.qty > 1 ? ` &times;${x.qty}` : ""}</div>
                <div style="font-size:12.5px;color:#8a94a6;margin-top:3px">${esc(x.who || "")}${x.who && x.scene ? " &middot; " : ""}${esc(x.scene || "")}${x.cat ? ` &middot; ${esc(x.cat)}` : ""}</div>
                ${ls.map((u, i) => `<div style="margin-top:6px;font-size:13.5px;word-break:break-all"><a href="${esc(u)}" style="color:${GOLD};text-decoration:none">${ls.length > 1 ? `${i + 1}. ` : ""}${esc(u)}</a></div>`).join("")}
              </td>
              <td style="padding:11px 0;border-bottom:1px solid #eee8dd;text-align:right;vertical-align:top;white-space:nowrap;font-size:14px;color:#1a1a1a">
                ${x.line_cents ? money(x.line_cents) : `<span style="color:#8a94a6">no price</span>`}
              </td>
            </tr>`;
          }).join("")}
        </table>
      </td></tr>`;
  }).join("");

  const unlinked = (r.unlinked || []).length
    ? `<tr><td style="padding:22px 32px 0">
        <h2 style="margin:0 0 10px;font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:${NAVY};border-bottom:2px solid #ddd;padding-bottom:6px">Still has no link &mdash; not ready to buy</h2>
        <p style="margin:0 0 8px;font-size:13.5px;color:#8a94a6">Listed so the total below is read as partial, not final.</p>
        <ul style="margin:0;padding-left:20px">
          ${r.unlinked.map((x) => `<li style="font-size:14px;line-height:1.6;color:#1a1a1a">${esc(x.name)}${x.qty > 1 ? ` &times;${x.qty}` : ""} <span style="color:#8a94a6">&middot; ${esc(x.scene || "")}${x.cat ? ` &middot; ${esc(x.cat)}` : ""}</span></li>`).join("")}
        </ul>
      </td></tr>`
    : "";

  return `<!doctype html><html><body style="margin:0;background:#f6f4ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <table cellpadding="0" cellspacing="0" style="width:100%;background:#f6f4ef"><tr><td align="center" style="padding:26px 12px">
    <table cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#fff;border-radius:14px;overflow:hidden">

      <tr><td style="background:${NAVY};padding:26px 32px">
        <p style="margin:0 0 5px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:${GOLD}">Links to buy</p>
        <h1 style="margin:0;font-size:25px;color:#fff;font-weight:700">Dear Evan Hansen</h1>
        <p style="margin:7px 0 0;font-size:15px;color:rgba(255,255,255,.72)">${esc(r.dayLabel)} &middot; sent by ${esc(r.by || "staff")}${r.at ? ` at ${esc(r.at)}` : ""}</p>
      </td></tr>

      <tr><td style="padding:22px 32px 4px">
        <p style="margin:0;font-size:15.5px;line-height:1.6;color:#1a1a1a">
          Todd &mdash; ${linkCount} link${linkCount === 1 ? "" : "s"} across ${items.length} item${items.length === 1 ? "" : "s"},
          <b>${money(r.totalCents || 0)}</b> at the prices entered. Everything below is grouped by where it was found,
          so each block is one shop in one pass.
        </p>
      </td></tr>

      ${groups}
      ${unlinked}

      <tr><td style="padding:24px 32px 28px">
        <p style="margin:0;font-size:12.5px;color:#999;line-height:1.6;border-top:1px solid #eee8dd;padding-top:14px">
          Sent from the Dear Evan Hansen staff dashboard. Reply to this email to reach the production team.<br>
          Northern Virginia Performing Arts &middot; 18945 Conference Center Drive, Plaza C, Leesburg VA 20175
        </p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

export function buyText(r) {
  const items = r.items || [];
  const byVendor = {};
  items.forEach((x) => {
    const v = String(x.vendor || "").trim() || "Not sourced yet";
    (byVendor[v] = byVendor[v] || []).push(x);
  });
  const L = [`DEAR EVAN HANSEN — LINKS TO BUY`, `${r.dayLabel} · sent by ${r.by || "staff"}${r.at ? ` at ${r.at}` : ""}`, ""];
  const linkCount = items.reduce((a, x) => a + linksOf(x).length, 0);
  L.push(`${linkCount} link${linkCount === 1 ? "" : "s"} across ${items.length} item${items.length === 1 ? "" : "s"} — ${money(r.totalCents || 0)} at the prices entered.`);
  L.push("");
  Object.keys(byVendor).sort().forEach((v) => {
    const sub = byVendor[v].reduce((a, x) => a + (x.line_cents || 0), 0);
    L.push(`${v.toUpperCase()}  (${money(sub)})`);
    byVendor[v].forEach((x) => {
      L.push(`  - ${x.name}${x.qty > 1 ? ` x${x.qty}` : ""}${x.who ? `  (${x.who})` : ""}  ${x.line_cents ? money(x.line_cents) : "no price"}   [${x.scene || ""}${x.cat ? ` / ${x.cat}` : ""}]`);
      linksOf(x).forEach((u) => L.push(`      ${u}`));
    });
    L.push("");
  });
  if ((r.unlinked || []).length) {
    L.push("STILL HAS NO LINK — NOT READY TO BUY");
    r.unlinked.forEach((x) => L.push(`  - ${x.name}${x.qty > 1 ? ` x${x.qty}` : ""}   [${x.scene || ""}]`));
    L.push("");
  }
  L.push(`Total on this list: ${money(r.totalCents || 0)}`);
  return L.join("\n");
}

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let r;
  try { r = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }
  if (!r || !r.dayLabel) return new Response("Missing dayLabel", { status: 400 });

  // Two shapes on one endpoint. Anything that is not the buy list is the
  // rehearsal report, so an older dashboard that sends no `kind` still works.
  const isBuy = r.kind === "buy";

  // Trim anything unbounded before it reaches an inbox.
  r.notes = (r.notes || []).slice(0, 200);
  r.attendance = (r.attendance || []).slice(0, 200);
  r.completed = (r.completed || []).slice(0, 200);
  r.sourcing = (r.sourcing || []).slice(0, 200);
  r.items = (r.items || []).slice(0, 400);
  r.unlinked = (r.unlinked || []).slice(0, 400);

  if (isBuy && !r.items.length) {
    return Response.json({ ok: false, error: "nothing-to-send" }, { status: 400 });
  }

  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  if (!user || !pass) {
    return Response.json({ ok: false, error: "mail-not-configured" }, { status: 503 });
  }

  const who = isBuy ? RECIPIENTS.buy : RECIPIENTS.report;

  try {
    const { default: nodemailer } = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass },
    });
    await transporter.sendMail({
      from: isBuy ? `NOVAPA Production <${user}>` : `NOVAPA Rehearsal Report <${user}>`,
      to: who.to,
      ...(who.cc ? { cc: who.cc } : {}),
      replyTo: user,
      subject: isBuy
        ? `DEH — links to buy (${r.items.length} item${r.items.length === 1 ? "" : "s"}, ${money(r.totalCents || 0)})`
        : `DEH rehearsal report — ${r.dayLabel}`,
      text: isBuy ? buyText(r) : reportText(r),
      html: isBuy ? buyHtml(r) : reportHtml(r),
    });
    return Response.json({ ok: true, to: who.to, cc: who.cc || [] });
  } catch (e) {
    return Response.json({ ok: false, error: String(e && e.message || e) }, { status: 502 });
  }
};

export const config = { path: "/api/deh-report" };
