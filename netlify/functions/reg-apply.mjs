// Employment interest form (Todd) — POST /api/apply
// Everything runs service-role here on purpose: the public page holds no
// Supabase credentials, so an applicant can submit but can never read the
// applicant table or anyone's résumé. Validation is server-side for the same
// reason — a hand-rolled POST gets the same checks the form does.
import { SUPABASE_URL } from "./reg-config.mjs";

const MAX_RESUME_BYTES = 3 * 1024 * 1024; // 3MB — résumés are well under this
const ALLOWED = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
};
// Kept in sync with employment.html; anything else is rejected rather than
// silently stored, so the options stay meaningful in reporting.
const POSITIONS = [
  "Teaching Artist — Theatre / Acting",
  "Teaching Artist — Dance",
  "Teaching Artist — Voice / Music",
  "Teaching Artist — Musical Theatre",
  "Music Director / Accompanist",
  "Choreographer",
  "Director / Assistant Director",
  "Summer Camp Staff / Counselor",
  "Production & Technical Theatre",
  "Stage Management",
  "Front Desk / Administrative",
  "Marketing / Social Media",
  "Substitute / On-Call",
];
const AVAILABILITY = [
  "Weekday daytime",
  "Weekday after-school (3–6pm)",
  "Weekday evenings (6–9pm)",
  "Saturdays",
  "Summer camps (weekdays, full-day)",
  "Seasonal productions / tech weeks",
];

function svcHeaders(extra = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}
function clean(s, max) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, max);
}
function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "bad_request" }, { status: 400 }); }

  // honeypot — real users never fill a hidden field. Answer 200 so bots don't
  // learn anything from the response.
  if (clean(body.website, 40)) return Response.json({ ok: true });

  const full_name = clean(body.full_name, 120);
  const email = clean(body.email, 160).toLowerCase();
  const phone = clean(body.phone, 40);
  if (!full_name) return Response.json({ error: "name_required" }, { status: 400 });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return Response.json({ error: "email_invalid" }, { status: 400 });

  const positions = (Array.isArray(body.positions) ? body.positions : []).filter((p) => POSITIONS.includes(p));
  const availability = (Array.isArray(body.availability) ? body.availability : []).filter((a) => AVAILABILITY.includes(a));
  if (!positions.length) return Response.json({ error: "position_required" }, { status: 400 });

  const earliest_start = clean(body.earliest_start, 60);
  const experience = clean(body.experience, 60);
  const message = clean(body.message, 4000);

  // résumé is optional; when present it must be a real document under the cap
  let resume_path = null, resume_name = null, resume_bytes = null;
  if (body.resume && body.resume.data) {
    const mime = clean(body.resume.type, 120);
    const ext = ALLOWED[mime];
    if (!ext) return Response.json({ error: "resume_type" }, { status: 400 });
    let bytes;
    try { bytes = Buffer.from(String(body.resume.data), "base64"); }
    catch { return Response.json({ error: "resume_unreadable" }, { status: 400 }); }
    if (!bytes.length) return Response.json({ error: "resume_unreadable" }, { status: 400 });
    if (bytes.length > MAX_RESUME_BYTES) return Response.json({ error: "resume_too_big" }, { status: 400 });

    const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
    const slug = full_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "applicant";
    // random suffix so a stored path can't be guessed from a name
    const rand = Math.random().toString(36).slice(2, 10);
    resume_path = `${stamp}-${slug}-${rand}.${ext}`;
    resume_name = clean(body.resume.name, 160) || `resume.${ext}`;
    resume_bytes = bytes.length;

    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/resumes/${encodeURIComponent(resume_path)}`, {
      method: "POST",
      headers: svcHeaders({ "Content-Type": mime, "x-upsert": "false" }),
      body: bytes,
    });
    if (!up.ok) {
      console.error("resume upload failed:", up.status, (await up.text()).slice(0, 200));
      return Response.json({ error: "resume_upload_failed" }, { status: 502 });
    }
  }

  const ins = await fetch(`${SUPABASE_URL}/rest/v1/job_applications`, {
    method: "POST",
    headers: svcHeaders({ "Content-Type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify({
      full_name, email, phone: phone || null, positions, availability,
      earliest_start: earliest_start || null, experience: experience || null,
      message: message || null, resume_path, resume_name, resume_bytes,
    }),
  });
  if (!ins.ok) {
    console.error("application insert failed:", ins.status, (await ins.text()).slice(0, 200));
    return Response.json({ error: "save_failed" }, { status: 502 });
  }

  // notify the team — failure here must never lose the application
  try {
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      const admins = await fetch(`${SUPABASE_URL}/rest/v1/admin_emails?select=email`, { headers: svcHeaders() })
        .then((r) => (r.ok ? r.json() : []))
        .then((rows) => rows.map((r) => r.email).filter(Boolean));
      if (admins.length) {
        const { default: nodemailer } = await import("nodemailer");
        const t = nodemailer.createTransport({
          host: "smtp.gmail.com", port: 465, secure: true,
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        });
        await t.sendMail({
          from: `NOVAPA Careers <${process.env.SMTP_USER}>`,
          to: admins.join(", "),
          replyTo: email,
          subject: `Employment interest: ${full_name}`,
          html: [
            `<b>${esc(full_name)}</b> &lt;${esc(email)}&gt;${phone ? " · " + esc(phone) : ""}`,
            `<b>Interested in:</b><br>${positions.map(esc).join("<br>")}`,
            availability.length ? `<b>Availability:</b><br>${availability.map(esc).join("<br>")}` : "",
            earliest_start ? `<b>Can start:</b> ${esc(earliest_start)}` : "",
            experience ? `<b>Experience:</b> ${esc(experience)}` : "",
            message ? `<b>Message:</b><br>${esc(message).replace(/\n/g, "<br>")}` : "",
            resume_path ? `Résumé attached to their record (${esc(resume_name)}).` : "No résumé uploaded.",
            `<a href="https://www.northernvirginiaperformingarts.org/register/admin/">Open admin dashboard</a>`,
          ].filter(Boolean).join("<br><br>"),
        });
      }
    }
  } catch (e) { console.error("applicant notify failed:", e.message); }

  return Response.json({ ok: true });
};

export const config = { path: "/api/apply" };
