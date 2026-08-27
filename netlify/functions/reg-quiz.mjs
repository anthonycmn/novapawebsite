// Quiz funnel — /api/reg-quiz (novapa.org/quiz)
//   POST { parent_name, email, phone, child_name, answers (q1..q5), persona, utm }
//        -> { ok: true }, stores the lead in quiz_leads and emails the
//           parent their child's result.
//
// The persona names and program facts here mirror quiz/start.html exactly:
// persona comes from Q3, program from the Q1 age band. Writes go to
// quiz_leads (RLS closed, service role only). The email keeps to plain
// sentences: no dashes as connectors, no emojis (Jason's standing rules).

const SUPABASE_URL = "https://tlkuqwsqicxcjdmumkje.supabase.co";
const VENUE = "National Conference Center, 18945 Conference Center Drive, Plaza C, Leesburg, VA 20176";

const PERSONAS = {
  "The Quiet Spark":
    "Shy, but curious is where a surprising number of our performers start. Kids like this warm up once they feel safe. A small group class with a patient room gives them time, familiar faces, and space to open up at their own pace.",
  "The Firecracker":
    "All that energy is fuel. Theatre gives it a place to go every single week: moving, singing, playing scenes with a room of kids who match their pace. The class does not ask them to sit still. It asks them to bring it.",
  "The Born Performer":
    "The living room shows are real. Kids like this already have the instinct. What they are ready for is an actual stage, real material, and an audience that is not just family. That is exactly what a NOVAPA season builds toward.",
  "The Undiscovered":
    "Some kids do not know this is their thing until they are standing in the room. A weekly class is the low stakes way to find out: real instructors, kids their age, and no pressure to be anything on day one.",
};

const PROGRAMS = {
  "5-8": {
    name: "Broadway Bound Kids",
    // The 5-9 cast performs Frozen KIDS, not Jr. — activity 1959789.
    show: "Disney's Frozen KIDS",
    meta: "Ages 5 to 9, Wednesdays 5:15 to 6:45 PM, September 2026 through January 2027, $695",
  },
  "9-12": {
    name: "Broadway Bound Junior",
    show: "Disney's Frozen Jr.",
    meta: "Ages 9 to 12, Tuesdays 6:15 to 7:45 PM, September 2026 through January 2027, $695",
  },
  "13-17": {
    name: "Broadway Bound Teens",
    show: "Disney's Frozen Jr.",
    meta: "Ages 12 to 17, Wednesdays 7:00 to 9:00 PM, September 2026 through February 2027, $695",
  },
};

async function db(method, path, body) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`db ${r.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function resultHtml(child, personaName, personaCopy, prog) {
  const kid = esc(child || "Your child");
  return `<div style="background:#f5f2ec;padding:24px 12px;font-family:Georgia,'Times New Roman',serif;color:#1c2434">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff">
<tr><td style="background:#0F1E36;padding:26px 28px">
  <div style="color:#E8B84B;font-size:12px;letter-spacing:2px;font-family:Arial,sans-serif">NOVAPA</div>
  <div style="color:#ffffff;font-size:24px;margin-top:8px">${kid}'s result: ${esc(personaName)}</div>
</td></tr>
<tr><td style="height:4px;background:#E8B84B"></td></tr>
<tr><td style="padding:26px 28px;font-size:15px;line-height:1.7">
  <p style="margin:0 0 16px">You asked where ${kid} fits at NOVAPA. Here is the answer.</p>
  <p style="margin:0 0 16px"><b>${kid} is ${esc(personaName)}.</b> ${esc(personaCopy)}</p>
  <div style="height:1px;background:#e5e5e5;margin:22px 0"></div>
  <p style="margin:0 0 6px;color:#888;font-size:13px;font-family:Arial,sans-serif;letter-spacing:1px;text-transform:uppercase">Their best fit program</p>
  <p style="margin:0 0 4px;font-size:18px"><b>${esc(prog.name)}</b></p>
  <p style="margin:0 0 10px">${esc(prog.show)}</p>
  <p style="margin:0 0 16px;color:#444;font-size:14px">${esc(prog.meta)}. The season ends on a real stage in front of a real audience.</p>
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 4px"><tr><td style="background:#E8B84B;border-radius:999px">
    <a href="https://novapa.org/register/?season=fall" style="display:inline-block;padding:13px 34px;color:#0F1E36;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;text-decoration:none">See open spots</a>
  </td></tr></table>
  <div style="height:1px;background:#e5e5e5;margin:22px 0"></div>
  <p style="font-size:14px;color:#444;margin:0">Questions about the fit? Reply to this email or call (571) 571-2120. A person answers.</p>
</td></tr>
<tr><td style="padding:18px 28px 24px;background:#fafafa;color:#888;font-size:12px;line-height:1.6;font-family:Arial,sans-serif">
  Northern Virginia Performing Arts &middot; ${VENUE}
</td></tr>
</table></div>`;
}

async function sendResult(lead, personaName, personaCopy, prog) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return;
  const { default: nodemailer } = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transporter.sendMail({
    from: `NOVAPA <${process.env.SMTP_USER}>`,
    replyTo: "info@novapa.org",
    to: lead.email,
    subject: `${lead.child_name || "Your child"}'s NOVAPA result`,
    html: resultHtml(lead.child_name, personaName, personaCopy, prog),
  });
}

export default async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }

  const parent = String(body.parent_name || "").trim().slice(0, 120);
  const email = String(body.email || "").trim().toLowerCase();
  const child = String(body.child_name || "").trim().slice(0, 120);
  // Kept loose on purpose: a parent who types "571-555-0123 (cell)" should not
  // lose the whole lead over formatting. Store what they gave us.
  const phone = String(body.phone || "").trim().slice(0, 40) || null;

  if (!parent) return Response.json({ error: "Your name is required" }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200)
    return Response.json({ error: "A valid email is required" }, { status: 400 });

  // answers: keep only q1..q5, short string values
  const answers = {};
  if (body.answers && typeof body.answers === "object") {
    for (const k of ["q1", "q2", "q3", "q4", "q5"]) {
      if (body.answers[k] != null) answers[k] = String(body.answers[k]).slice(0, 40);
    }
  }
  const ageBand = PROGRAMS[answers.q1] ? answers.q1 : null;
  const personaName = PERSONAS[String(body.persona || "").slice(0, 60)]
    ? String(body.persona).slice(0, 60)
    : "The Undiscovered";
  const personaCopy = PERSONAS[personaName];
  const prog = PROGRAMS[ageBand || "9-12"];

  const utm = body.utm && typeof body.utm === "object"
    ? Object.fromEntries(Object.entries(body.utm).slice(0, 8).map(([k, v]) => [String(k).slice(0, 40), String(v).slice(0, 120)]))
    : null;

  try {
    const rows = await db("POST", "quiz_leads", {
      parent_name: parent, email, phone, child_name: child || null,
      age_band: ageBand, answers: Object.keys(answers).length ? answers : null,
      persona: personaName, source: "quiz-funnel", utm,
    });
    const lead = rows[0];

    try { await sendResult(lead, personaName, personaCopy, prog); }
    catch (e) { console.error("quiz result email failed:", e.message); }

    return Response.json({ ok: true });
  } catch (e) {
    console.error("reg-quiz POST", e);
    return Response.json({ error: "server error" }, { status: 500 });
  }
};

export const config = { path: "/api/reg-quiz" };
