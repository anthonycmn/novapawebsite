// Wraps CJ's plain-text Gmail drafts in the NOVAPA email chrome (same rules as
// the newsletter: tables + inline styles, Georgia, navy bands, gold rule, white
// card, light-only, fluid 620px). Text is kept verbatim; bare URLs become
// full-width buttons labelled from the line above them, and "Name: URL" lines
// become a small linked list.
//
// Gmail's compose editor drops the CSS `background:` shorthand on table cells,
// so every coloured band carries a bgcolor attribute as well (13 Sep 2026: the
// first pass rendered white headers in Drafts).
//
//   node scripts/brand-gmail-drafts.mjs <list_drafts.json ...> --out=branded.json
//
// Input: one or more Gmail list_drafts responses ({drafts:[...]}). Output: a
// JSON array of {id,to,subject,body,html}; apply each html with update_draft.
import fs from "node:fs";
const args = process.argv.slice(2);
const OUT = (args.find((a) => a.startsWith("--out=")) || "--out=branded-drafts.json").slice(6);
const files = args.filter((a) => !a.startsWith("--"));
if (!files.length) { console.error("usage: node scripts/brand-gmail-drafts.mjs <list_drafts.json ...> [--out=branded.json]"); process.exit(1); }
const MINE = /Founder and Executive Director, Northern Virginia Performing Arts\s*$/;
const SKIP = new Set(["maggie.larson.920@gmail.com", "heathertalksgood@gmail.com"]); // CJ's own drafts

const unwrap = (b) => b.replace(/https:\/\/www\.google\.com\/url\?q=([^&\s]+)&[^\s]*/g, (m, q) => decodeURIComponent(q));
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const F = "font-family:Georgia,'Times New Roman',serif;";
const P = (t) => `<p style="margin:0 0 16px 0;">${t}</p>`;
const button = (href, label) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;"><tr><td bgcolor="#14213d" align="center" style="border-radius:3px;"><a href="${esc(href)}" style="display:block;padding:14px 20px;font-weight:bold;color:#ffffff;text-decoration:none;">${esc(label)}</a></td></tr></table>`;
const URL_LINE = /^https?:\/\/\S+$/;
const NAMED_URL = /^([^:\n]{2,60}):\s+(https?:\/\/\S+)$/;
// Button text says what the tap does; the URL decides, the prose above it is the fallback.
const LABELS = [
  [/frozen-checkout/, "Join the Frozen JR. waitlist"], [/free-class\/book/, "Book a free class this week"],
  [/activity=1959789/, "Register for Frozen KIDS"], [/activity=1959805/, "Register for Frozen Teen"], [/activity=1959787/, "Register for Frozen JR."],
  [/activity=1959854/, "Register for The Little Mermaid JR."], [/activity=1959850/, "Register for The Little Mermaid KIDS"],
  [/activity=1960811/, "Register for Hadestown"], [/activity=990001/, "Register for Mean Girls"], [/activity=990002/, "Register for the Mean Girls tech crew"],
  [/activity=1959675/, "Register for Charlie and the Chocolate Factory JR."], [/activity=1962568/, "Register for the Adult Acting Class"],
  [/activity=970208/, "Book a consultation"], [/activity=970601/, "Register for DC Unifieds"],
  [/activity=1960936/, "Enroll in Acting, ages 9 to 12"], [/activity=1960867/, "Enroll in Acting, ages 5 to 8"], [/activity=1962562/, "Enroll in Acting and Musical Theatre"],
  [/activity=1960924/, "Enroll in Musical Theatre, ages 5 to 8"], [/activity=1960945/, "Enroll in Musical Theatre Acting"], [/activity=1960939/, "Enroll in Musical Theatre Dance"],
  [/activity=1960959/, "Enroll in Improv for Actors"], [/activity=1960898/, "Enroll in Triple Threat"],
];
const labelFor = (url, fallback) => { const hit = LABELS.find(([re]) => re.test(url)); return hit ? hit[1] : fallback; };

function render(text) {
  const paras = text.trim().split(/\n\s*\n/);
  const out = [];
  let pendingLabel = null;
  for (let para of paras) {
    let lines = para.split("\n").map((l) => l.trim()).filter(Boolean);
    if (/^Warmly,$/i.test(lines[0])) break; // sign-off rendered by the template
    // A single "Label: URL" line -> text + button
    if (lines.length === 1 && NAMED_URL.test(lines[0])) {
      const m = lines[0].match(NAMED_URL);
      out.push(P(esc(m[1]) + ":"));
      out.push(button(m[2], labelFor(m[2], m[1])));
      continue;
    }
    // An intro line followed by "Name: URL" lines -> intro + linked list
    if (lines.length >= 2 && !NAMED_URL.test(lines[0]) && !URL_LINE.test(lines[0]) && lines.slice(1).every((l) => NAMED_URL.test(l))) {
      out.push(P(esc(lines[0])));
      lines = lines.slice(1);
    }
    // A whole paragraph of "Name: URL" lines -> linked list
    if (lines.length && lines.every((l) => NAMED_URL.test(l))) {
      out.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;">${lines.map((l) => { const m = l.match(NAMED_URL); return `<tr><td style="padding:7px 0;border-bottom:1px solid #d3d8e2;font-size:15px;"><a href="${esc(m[2])}" style="color:#14213d;font-weight:bold;text-decoration:none;">${esc(m[1])} &rarr;</a></td></tr>`; }).join("")}</table>`);
      continue;
    }
    // Paragraph that is label line(s) followed by a bare URL -> text + button
    if (lines.length >= 2 && URL_LINE.test(lines[lines.length - 1])) {
      const url = lines[lines.length - 1];
      const labelRaw = lines.slice(0, -1).join(" ");
      const label = labelRaw.replace(/:$/, "");
      out.push(P(esc(labelRaw)));
      out.push(button(url, labelFor(url, label.length <= 44 ? label : "Open the link")));
      continue;
    }
    if (lines.length === 1 && URL_LINE.test(lines[0])) { out.push(button(lines[0], labelFor(lines[0], pendingLabel || "Open the link"))); pendingLabel = null; continue; }
    // A paragraph of short lines (class list) -> keep line breaks
    if (lines.length > 1 && lines.every((l) => l.length < 90)) {
      out.push(P(lines.map(esc).join("<br>")));
      continue;
    }
    // Prose that ends in a URL on the same line -> prose + button
    const joined = lines.join(" ");
    const tail = joined.match(/^(.*?):?\s+(https?:\/\/\S+)$/);
    if (tail) { out.push(P(esc(tail[1]) + ":")); out.push(button(tail[2], labelFor(tail[2], "Open the link"))); continue; }
    out.push(P(esc(joined)));
  }
  return out.join("\n");
}

const shell = (inner) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0;padding:0;background-color:#22262e;" bgcolor="#22262e">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#22262e" style="background-color:#22262e;">
<tr><td align="center" style="padding:16px 6px;">
<table role="presentation" width="620" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:620px;background-color:#ffffff;">
  <tr><td bgcolor="#08111f" style="background-color:#08111f;padding:18px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="left" style="${F}font-size:23px;font-weight:bold;letter-spacing:1px;color:#ffffff;">NOVA<span style="color:#c9a227;">PA</span></td>
      <td align="right" style="${F}font-size:11px;font-weight:bold;letter-spacing:2px;color:#c9a227;">A NOTE FROM CJ</td>
    </tr></table>
  </td></tr>
  <tr><td bgcolor="#c9a227" style="background-color:#c9a227;height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>
  <tr><td style="padding:28px 24px 8px 24px;${F}font-size:16px;line-height:1.55;color:#2f3033;">
${inner}
  </td></tr>
  <tr><td style="padding:0 24px 0 24px;${F}font-size:16px;line-height:1.55;color:#2f3033;">
    <p style="margin:0 0 4px 0;">Warmly,</p>
    <p style="margin:0;font-weight:bold;color:#14213d;">CJ</p>
    <p style="margin:2px 0 0 0;font-size:14px;color:#6b6c70;">Mr. Cimino-Johnson, Founder and Executive Director, Northern Virginia Performing Arts</p>
  </td></tr>
  <tr><td style="height:26px;font-size:0;line-height:0;">&nbsp;</td></tr>
  <tr><td bgcolor="#08111f" style="background-color:#08111f;padding:22px 24px;${F}text-align:center;">
    <div style="font-size:12px;font-weight:bold;letter-spacing:3px;color:#c9a227;">CREATE. INNOVATE. INSPIRE.</div>
    <div style="font-size:12px;line-height:1.7;color:#9ba0aa;padding-top:12px;">Northern Virginia Performing Arts<br>The National Conference Center, 18945 Conference Center Drive, Leesburg, VA 20176</div>
    <div style="font-size:12px;line-height:1.7;color:#9ba0aa;padding-top:12px;">Reply to this email to reach me directly &middot; <a href="https://northernvirginiaperformingarts.org" style="color:#c9a227;text-decoration:underline;">northernvirginiaperformingarts.org</a></div>
  </td></tr>
</table></td></tr></table>
</body>
</html>`;

const all = files.flatMap((f) => JSON.parse(fs.readFileSync(f, "utf8")).drafts || []);
const out = [];
for (const d of all) {
  const to = d.toRecipients[0];
  const text = unwrap(d.plaintextBody || "");
  if (SKIP.has(to) || !MINE.test(text)) continue;
  const html = shell(render(text)).replace(/\n\s*/g, "");
  if (/google\.com\/url/.test(html)) throw new Error("unwrap failed " + to);
  if (/—/.test(html.replace(/&mdash;/g, ""))) console.log("note: em dash present in", to);
  out.push({ id: d.id, to, subject: d.subject, body: text, html });
}
fs.writeFileSync(OUT, JSON.stringify(out));
if (out[0]) fs.writeFileSync(OUT.replace(/\.json$/, "") + "-preview.html", out[0].html);
console.log("drafts:", out.length, "| unique recipients:", new Set(out.map((o) => o.to)).size);
