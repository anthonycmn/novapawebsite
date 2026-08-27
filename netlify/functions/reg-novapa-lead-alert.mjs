// Emails Jason the moment a NOVAPA lead arrives — free class booking or quiz.
//
// The DC Unifieds side already had this (reg-leads-alert). The NOVAPA funnels
// had nothing: a quiz lead landed at 09:01 on Aug 27 and sat unseen all day
// because the only way to find it was to go looking in the database.
//
// Runs every 5 minutes rather than 15: these are small volumes, and a parent
// who just asked for a free class is worth calling the same hour.
import { SUPABASE_URL } from "./reg-config.mjs";
import { getStore } from "@netlify/blobs";

const STORE = "lead-alerts";
const KEY = "novapa-seen";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function svc() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}
async function db(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: svc() });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 160)}`);
  return r.json();
}

// Our own test rows must never trigger a "call this parent" email.
function isTest(email) {
  const e = String(email || "").toLowerCase();
  return !e || e.endsWith("@novapa.org") || e.endsWith("@stacksindustries.com") ||
         e.includes("+test") || e.includes("systemtest") || e === "x@x.com";
}

function line(label, value) {
  return value ? `<div style="font:14px/1.7 Helvetica,Arial,sans-serif;color:#5B6472">${label}: <b style="color:#0B1422">${esc(value)}</b></div>` : "";
}

function card(kind, r) {
  const who = r.parent_name || "Someone";
  const contact = [
    r.email ? `<a href="mailto:${encodeURIComponent(r.email)}" style="color:#0B1422">${esc(r.email)}</a>` : "",
    r.phone ? `<a href="tel:${String(r.phone).replace(/[^0-9+]/g, "")}" style="color:#0B1422">${esc(r.phone)}</a>` : "",
  ].filter(Boolean).join(" &middot; ");
  const detail = kind === "free"
    ? line("Class", `${r.cast_key || ""} on ${r.class_date || ""}`) + line("Child", `${r.child_name || ""}${r.child_age ? `, age ${r.child_age}` : ""}`)
    : line("Child", r.child_name) + line("Age band", r.age_band) + line("Result", r.persona);
  return `<tr><td style="padding:16px 0;border-bottom:1px solid #E4E7ED">
<div style="font:700 17px/1.3 Helvetica,Arial,sans-serif;color:#0B1422">${esc(who)}
<span style="background:${kind === "free" ? "#E2EFE8" : "#F0E4EE"};color:${kind === "free" ? "#1C6B45" : "#6B2D5B"};font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px;margin-left:8px">${kind === "free" ? "FREE CLASS" : "QUIZ"}</span></div>
<div style="font:14px/1.7 Helvetica,Arial,sans-serif;margin-top:4px">${contact || "no contact given"}</div>
${detail}</td></tr>`;
}

export default async () => {
  if (process.env.CONTEXT && process.env.CONTEXT !== "production") {
    return new Response("skipped: non-production", { status: 200 });
  }
  const resend = process.env.RESEND_API_KEY;
  if (!resend) return new Response("no resend key", { status: 200 });

  const store = getStore(STORE);
  // Track ids already alerted rather than a timestamp: these tables are tiny,
  // and an id set cannot double-send if a run overlaps or a send half-fails.
  let seen = { free: [], quiz: [] };
  try { seen = JSON.parse((await store.get(KEY)) || "") || seen; } catch {}
  const firstRun = !seen.free.length && !seen.quiz.length;

  const [free, quiz] = await Promise.all([
    db("free_class_bookings?select=*&order=created_at.desc&limit=50").catch(() => []),
    db("quiz_leads?select=*&order=created_at.desc&limit=50").catch(() => []),
  ]);

  const freshFree = free.filter((r) => !seen.free.includes(r.id) && !isTest(r.email));
  const freshQuiz = quiz.filter((r) => !seen.quiz.includes(r.id) && !isTest(r.email));

  // First run adopts everything already in the tables as "seen" without
  // mailing — switching this on should not replay the back catalogue.
  if (firstRun) {
    await store.set(KEY, JSON.stringify({ free: free.map((r) => r.id), quiz: quiz.map((r) => r.id) }));
    return new Response(`initialised: ${free.length} free, ${quiz.length} quiz`, { status: 200 });
  }
  if (!freshFree.length && !freshQuiz.length) return new Response("nothing new", { status: 200 });

  const rows = [...freshFree.map((r) => card("free", r)), ...freshQuiz.map((r) => card("quiz", r))].join("");
  const n = freshFree.length + freshQuiz.length;
  const what = freshFree.length && freshQuiz.length ? "NOVAPA leads"
    : freshFree.length ? (freshFree.length === 1 ? "free class booking" : "free class bookings")
    : (freshQuiz.length === 1 ? "quiz lead" : "quiz leads");

  const to = (process.env.LEADS_ALERT_TO || "jason@novapa.org").split(",").map((s) => s.trim()).filter(Boolean);
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resend}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "NOVAPA Leads <leads@mail.novapa.org>",
      to,
      subject: n === 1 ? `New ${what}: ${(freshFree[0] || freshQuiz[0]).parent_name || "no name"}` : `${n} new ${what}`,
      html: `<div style="max-width:600px;margin:0 auto;padding:26px 22px;font-family:Helvetica,Arial,sans-serif">
<div style="font:700 21px/1.25 Helvetica,Arial,sans-serif;color:#0B1422;letter-spacing:-0.02em">${n === 1 ? "A new NOVAPA lead" : `${n} new NOVAPA leads`}</div>
<table style="width:100%;border-collapse:collapse;margin-top:8px">${rows}</table>
<div style="font:13px/1.7 Helvetica,Arial,sans-serif;color:#5B6472;margin-top:18px">All leads live in the Leads tab of the admin dashboard.</div></div>`,
    }),
  });
  // Only mark seen on a confirmed send, so a Resend outage retries next tick.
  if (!r.ok) return new Response(`resend ${r.status}`, { status: 200 });
  await store.set(KEY, JSON.stringify({
    free: [...seen.free, ...freshFree.map((x) => x.id)].slice(-500),
    quiz: [...seen.quiz, ...freshQuiz.map((x) => x.id)].slice(-500),
  }));
  return new Response(`alerted ${n}`, { status: 200 });
};

export const config = { schedule: "*/5 * * * *" };
