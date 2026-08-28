// POST /api/dcu-quiz-lead — lead capture for the dcunifieds.com "one weekend"
// quiz funnel (quiz.html → quiz-result.html on the static site).
//
// Writes into the SAME table as the portal's Find Your Five quiz —
// public.funnel_leads in the DCU Supabase project — so the admin kanban,
// the purchase-linking, and the coach board all see these leads with zero
// extra plumbing. The two funnels are told apart by answers.quiz.
//
// Reached same-origin from dcunifieds.com through its /api/* → novapa.org
// proxy, so no CORS dance is needed and the browser sends no preflight.
//
// The gate asks everyone the same four questions (see the 28 Aug 2026
// decision): student's first name, parent's name, parent's email, parent's
// mobile. `name`/`email`/`phone` are the PARENT — the person who can say yes
// to a $699 weekend — whoever was actually holding the phone.

const GRAD_YEAR = { senior: "2027", junior: "2028", younger: "2029" };

function digitsOnly(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

const pick = (v, max) => String(v == null ? "" : v).trim().slice(0, max);

export default async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });

  const base = process.env.DCU_SUPABASE_URL;
  const key = process.env.DCU_SERVICE_KEY;
  if (!base || !key) return Response.json({ error: "not configured" }, { status: 500 });

  let body = {};
  try { body = await req.json(); } catch {}

  const studentName = pick(body.student, 80);
  const name = pick(body.contact, 80);
  const email = pick(body.email, 160).toLowerCase();
  const phone = pick(body.phone, 40);
  const phoneDigits = digitsOnly(phone);
  const role = body.role === "parent" ? "parent" : "student";

  if (studentName.length < 2) return Response.json({ error: "Please add the student's first name." }, { status: 400 });
  if (name.length < 2) return Response.json({ error: "Please add a parent's name." }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return Response.json({ error: "That email doesn't look right — mind checking it?" }, { status: 400 });
  if (phoneDigits.length < 10) return Response.json({ error: "Please add a 10-digit phone number." }, { status: 400 });

  const answers = {
    quiz: "one-weekend",
    role,
    grade: pick(body.grade, 20),
    track: pick(body.track, 20),
    travel: pick(body.travel, 20),
    priority: pick(body.priority, 20),
    ready: pick(body.ready, 20),
    // Recommendation the result page will show, computed client-side; kept so
    // a coach knows which tier the family was steered toward.
    rec: pick(body.rec, 20),
  };

  // public is deliberately NOT exposed over PostgREST on the DCU project
  // (Aug 2026 RLS hardening) — all writes go through the one fixed-shape RPC
  // in the leads_api schema, granted to service_role only. Its source is
  // tracked at audition-atlas/db/leads_api/submit_quiz_lead.sql.
  const hdrs = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

  try {
    const r = await fetch(`${base}/rest/v1/rpc/submit_quiz_lead`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        p_email: email,
        p_name: name,
        p_phone: phone,
        p_phone_digits: phoneDigits,
        p_role: role,
        p_student_name: studentName,
        p_grad_year: GRAD_YEAR[answers.grade] || "",
        p_answers: JSON.stringify(answers),
        p_utm_source: pick(body.utm_source, 80),
        p_utm_medium: pick(body.utm_medium, 80),
        p_utm_campaign: pick(body.utm_campaign, 80),
        p_utm_content: pick(body.utm_content, 80),
        p_fbclid: pick(body.fbclid, 200),
        p_referrer: pick(body.referrer, 300),
        p_client_ip: req.headers.get("x-nf-client-connection-ip") || "",
      }),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`rpc ${r.status}: ${t.slice(0, 160)}`);
    const leadId = JSON.parse(t);

    // Alert — fire-and-forget shape, but awaited so the function doesn't get
    // frozen mid-send. A failed email must never fail the lead.
    try {
      const resend = process.env.RESEND_API_KEY;
      const to = (process.env.LEADS_ALERT_TO || "jason@novapa.org").split(",").map((s) => s.trim()).filter(Boolean);
      if (resend) {
        const esc = (s) => String(s || "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]);
        const line = (l, v) => (v ? `<tr><td style="padding:3px 10px 3px 0;color:#5B6472;font:13px Helvetica,Arial,sans-serif">${l}</td><td style="padding:3px 0;font:14px Helvetica,Arial,sans-serif;color:#0B1422">${esc(v)}</td></tr>` : "");
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resend}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "NOVAPA Leads <leads@mail.novapa.org>",
            to,
            subject: `New DCU lead — ${studentName} (one-weekend quiz)`,
            html: `<div style="max-width:600px;margin:0 auto;padding:26px 22px;font-family:Helvetica,Arial,sans-serif">
<div style="font:700 21px/1.25 Helvetica,Arial,sans-serif;color:#0B1422">${esc(studentName)} just finished the one-weekend quiz</div>
<table style="border-collapse:collapse;margin-top:10px">
${line("Call", `${name} (parent)`)}${line("Email", email)}${line("Phone", phone)}
${line("Filled in by", role === "parent" ? "the parent" : `${studentName} (the student)`)}
${line("Grade", answers.grade)}${line("Track", answers.track)}${line("Travel", answers.travel)}
${line("Priority", answers.priority)}${line("Materials", answers.ready)}${line("Steered to", answers.rec)}
${line("Ad", [pick(body.utm_campaign, 80), pick(body.utm_content, 80)].filter(Boolean).join(" / "))}
</table>
<div style="font:13px/1.7 Helvetica,Arial,sans-serif;color:#5B6472;margin-top:16px">On the Leads board (DC Unifieds) in the admin dashboard.</div></div>`,
          }),
        });
      }
    } catch (e) {
      console.error("dcu-quiz-lead alert:", e.message);
    }

    return Response.json({ ok: true, id: leadId });
  } catch (e) {
    console.error("dcu-quiz-lead:", e.message);
    return Response.json({ error: "save failed" }, { status: 500 });
  }
};

export const config = { path: "/api/dcu-quiz-lead" };
