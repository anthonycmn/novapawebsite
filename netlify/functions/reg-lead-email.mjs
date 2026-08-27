// The results email the Find Your 5 quiz promises but never sent.
//
// FitQuiz.tsx tells every lead, at the point it asks for their address:
// "the email is so you still have the list next week, with the deadlines
// attached." The DC Unifieds app has no lead-facing send anywhere — four
// sendEmail call sites, all to coaches or paying students — so from Aug 23
// 2026 every family that handed over an address got nothing. This module is
// that email, sent from the NOVAPA side which has verified sending.
//
// Deliberately NOT quoting per-school dates: match `notes` carries the LAST
// published cycle's prescreen window (e.g. "September 15, 2025 through
// December 4, 2025"). Printing those to a family applying a year later would
// be worse than sending nothing. We give the requirement, the official link,
// and the honest warning that windows close early.

const BUCKET = {
  reach:  { label: "Reach",  bg: "#F4E3E4", fg: "#8A2A31" },
  target: { label: "Target", bg: "#E3EDE5", fg: "#1F5C2E" },
  likely: { label: "Likely", bg: "#E4EAF4", fg: "#26406E" },
};

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function safeUrl(u) {
  const s = String(u || "");
  return /^https?:\/\//i.test(s) ? s : "";
}

function schoolCard(m, i) {
  const b = BUCKET[String(m.bucket || "").toLowerCase()] || null;
  const chip = b
    ? `<span style="background:${b.bg};color:${b.fg};font:700 11px/1 Helvetica,Arial,sans-serif;padding:4px 9px;border-radius:99px;margin-left:8px;white-space:nowrap">${b.label}</span>`
    : "";
  const place = [m.city, m.state].filter(Boolean).join(", ");
  const prog = [m.degree, m.major, m.track].filter(Boolean).join(" ");
  const reasons = Array.isArray(m.reasons) ? m.reasons.filter(Boolean) : [];
  const url = safeUrl(m.websiteUrl);

  const flags = [];
  if (m.prescreenRequired) flags.push("Prescreen video required");
  if (m.danceRequired) flags.push("Dance evaluated");

  return `<tr><td style="padding:16px 0;border-bottom:1px solid #E4E7ED">
  <div style="font:700 16px/1.35 Helvetica,Arial,sans-serif;color:#0B1422">
    <span style="color:#B07B1E">${i + 1}.</span> ${esc(m.school)}${chip}</div>
  <div style="font:14px/1.6 Helvetica,Arial,sans-serif;color:#0B1422;margin-top:3px">${esc(prog)}</div>
  ${place ? `<div style="font:13px/1.6 Helvetica,Arial,sans-serif;color:#5B6472">${esc(place)}</div>` : ""}
  ${reasons.length ? `<div style="font:13px/1.7 Helvetica,Arial,sans-serif;color:#5B6472;margin-top:6px">${esc(reasons.join(" &middot; "))}</div>` : ""}
  ${flags.length ? `<div style="font:700 12px/1.6 Helvetica,Arial,sans-serif;color:#8A2A31;margin-top:6px">${esc(flags.join(" &middot; "))}</div>` : ""}
  ${url ? `<div style="font:13px/1.6 Helvetica,Arial,sans-serif;margin-top:7px"><a href="${esc(url)}" style="color:#26406E">Audition requirements &rarr;</a></div>` : ""}
</td></tr>`;
}

// Addresses that must never receive a lead-facing send: our own staff, the
// test aliases we submit through the live form, and obvious junk.
export function isTestAddress(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e || !e.includes("@")) return true;
  if (e.endsWith("@novapa.org") || e.endsWith("@dcunifieds.test")) return true;
  if (e.endsWith("@stacksindustries.com")) return true;
  if (e.includes("+test") || e.includes("+rlstest") || e.includes("rlstest")) return true;
  if (e === "x@x.com") return true;
  return false;
}

export function resultsEmail(lead) {
  const matches = (() => {
    if (Array.isArray(lead.matches)) return lead.matches;
    try { return JSON.parse(lead.matches || "[]"); } catch { return []; }
  })();
  const answers = (() => {
    if (lead.answers && typeof lead.answers === "object") return lead.answers;
    try { return JSON.parse(lead.answers || "{}"); } catch { return {}; }
  })();

  const first = String(lead.name || "").trim().split(/\s+/)[0] || "there";
  const focus = answers.dream === "Acting" ? "acting" : "musical theatre";
  const anyPrescreen = matches.some((m) => m.prescreenRequired);

  const subject = `${first}, here are your five ${focus} programs`;

  const html = `<div style="max-width:600px;margin:0 auto;padding:30px 22px;font-family:Helvetica,Arial,sans-serif;color:#0B1422">
<div style="font:700 24px/1.25 Helvetica,Arial,sans-serif;letter-spacing:-0.02em">Your five programs</div>
<div style="font:15px/1.7 Helvetica,Arial,sans-serif;color:#5B6472;margin-top:10px">
Hi ${esc(first)} &mdash; here's the list from your Find Your 5 quiz, so you still have it next week.
Each one auditions at DC Unifieds, and each links straight to its official audition requirements.</div>

<table style="width:100%;border-collapse:collapse;margin-top:14px">
${matches.map(schoolCard).join("")}
</table>

${anyPrescreen ? `<div style="font:14px/1.7 Helvetica,Arial,sans-serif;color:#0B1422;margin-top:22px;padding:15px 17px;background:#FDF6E7;border-radius:9px">
<b>One thing worth doing early.</b> Most of these want a prescreen video before they'll offer a live audition, and those windows tend to close in the fall &mdash; earlier than families expect, and often before applications feel urgent.
Check each school's requirements page above for this year's exact dates, since they move every cycle.</div>` : ""}

<div style="margin-top:24px;padding:20px;background:#0B1422;border-radius:12px">
<div style="font:700 11px/1 Helvetica,Arial,sans-serif;color:#FFC866;letter-spacing:0.08em">DC UNIFIEDS &middot; OCT 15&ndash;18 &middot; LEESBURG, VA</div>
<div style="font:700 19px/1.3 Helvetica,Arial,sans-serif;color:#fff;margin-top:9px;letter-spacing:-0.01em">
Audition for all five in one weekend.</div>
<div style="font:14px/1.7 Helvetica,Arial,sans-serif;color:rgba(255,255,255,0.75);margin-top:9px">
One registration covers auditions with every college attending, plus workshops and callbacks, in one building &mdash; with application and audition fees waived.</div>
<div style="margin-top:15px">
<a href="https://dcunifieds.com/one-weekend?utm_source=email&utm_medium=lead&utm_campaign=findyour5-results"
   style="display:inline-block;background:#FFC866;color:#0B1422;font:700 15px/1 Helvetica,Arial,sans-serif;padding:13px 26px;border-radius:99px;text-decoration:none">See the weekend</a></div>
</div>

<div style="font:14px/1.7 Helvetica,Arial,sans-serif;color:#5B6472;margin-top:22px">
Questions about any of these programs? Just reply to this email &mdash; a coach will read it.</div>

<div style="font:11.5px/1.9 Helvetica,Arial,sans-serif;color:#9AA1AC;margin-top:26px;border-top:1px solid #E4E7ED;padding-top:14px">
You're getting this because you took the Find Your 5 quiz at findyour5.dcunifieds.com.<br>
Northern Virginia Performing Arts &middot; 18945 Conference Center Drive, Plaza C, Leesburg VA 20176</div>
</div>`;

  return { subject, html };
}
