// Retargeting drip engine — runs every 15 minutes (scheduled).
// Sequences + per-lead state live in Supabase (email_sequences / retarget_state),
// editable from the admin Marketing tab. Sends as jason@novapa.org.
//
// Rules (Jason):
// - 'abandoned': enroll on first successful sign-in with no purchase; step 1
//   fires 30m after the LAST activity (new session inside the window resets
//   the clock; an unexpired hold = active timer = wait).
// - Any purchase at any point -> status 'purchased', no more emails ever.
// - Once past step 1, new checkout sessions never re-enroll or reset.
// - Never enroll an email that has ever purchased.
// - 'linkexpired': requested a sign-in link, never signed in -> one nudge.
import { SUPABASE_URL } from "./reg-config.mjs";

const SITE = "https://www.northernvirginiaperformingarts.org";
const SHOW_TITLES = {
  httyd: "How to Train Your Dragon JR.",
  charlie: "Charlie and the Chocolate Factory JR.",
  trolls: "Trolls The Musical JR.",
};

function svcHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}
async function svc(path, opts = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { ...svcHeaders(), ...(opts.headers || {}) }, method: opts.method || "GET", body: opts.body });
  if (!r.ok) throw new Error(`db ${path} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t; }
}

function joinNames(arr) {
  const a = [...new Set(arr.filter(Boolean))];
  if (!a.length) return "";
  if (a.length === 1) return a[0];
  return a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
}
function firstName(s) { return String(s || "").trim().split(/\s+/)[0] || ""; }

function render(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
}

async function sendMail({ to, subject, html, refs }) {
  const { default: nodemailer } = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const headers = {};
  if (refs && refs.length) {
    headers["In-Reply-To"] = refs[refs.length - 1];
    headers["References"] = refs.join(" ");
  }
  const info = await transporter.sendMail({
    from: `Jason from Broadway Bound <${process.env.SMTP_USER}>`,
    to, subject, headers,
    html: html.replace(/\n/g, "<br>"),
  });
  return info.messageId;
}

export default async () => {
  const now = Date.now();

  // sequence templates
  let steps;
  try { steps = await svc("email_sequences?select=*&enabled=eq.true&order=seq,step"); }
  catch (e) { console.error("sequences missing:", e.message); return new Response("no sequences", { status: 200 }); }
  const stepsBySeq = {};
  for (const s of steps) (stepsBySeq[s.seq] = stepsBySeq[s.seq] || []).push(s);

  // all orders (suppression) + holds + families/campers context
  const [orders, holds, families] = await Promise.all([
    svc("orders?select=email,created_at&limit=2000"),
    svc("holds?select=email,items,created_at,expires_at&order=created_at.desc&limit=1000"),
    svc("families?select=email,parent_name&limit=2000"),
  ]);
  const purchased = new Set(orders.map((o) => String(o.email || "").toLowerCase()));
  const parentByEmail = {};
  for (const f of families) parentByEmail[String(f.email).toLowerCase()] = f.parent_name || "";
  const holdsByEmail = {};
  for (const h of holds) {
    const e = String(h.email || "").toLowerCase();
    (holdsByEmail[e] = holdsByEmail[e] || []).push(h);
  }

  // signed-in users (Supabase auth admin API)
  const users = [];
  for (let page = 1; page <= 10; page++) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: svcHeaders() });
    if (!r.ok) break;
    const j = await r.json();
    const batch = j.users || j;
    if (!Array.isArray(batch) || !batch.length) break;
    users.push(...batch);
    if (batch.length < 200) break;
  }

  // current state
  const states = await svc("retarget_state?select=*&limit=2000");
  const stateByEmail = {};
  for (const s of states) stateByEmail[s.email] = s;

  const log = { enrolled: 0, reset: 0, sent: 0, purchased_out: 0 };

  // ---- enrollment + anchor resets ----
  for (const u of users) {
    const email = String(u.email || "").toLowerCase();
    if (!email || !u.last_sign_in_at) continue;
    const signIn = new Date(u.last_sign_in_at).getTime();
    if (now - signIn > 7 * 86400000) continue; // stale
    const st = stateByEmail[email];
    if (purchased.has(email)) {
      if (st && st.status === "active") {
        await svc(`retarget_state?email=eq.${encodeURIComponent(email)}`, { method: "PATCH", body: JSON.stringify({ status: "purchased", updated_at: new Date().toISOString() }) });
        log.purchased_out++;
      }
      continue; // never enroll buyers
    }
    if (!st) {
      // build context from their latest hold, if any
      const hs = holdsByEmail[email] || [];
      const items = hs.length ? (hs[0].items || []) : [];
      const campTitles = [...new Set(items.map((it) => it.show ? SHOW_TITLES[it.show] : null).filter(Boolean))];
      const campers = [...new Set(items.map((it) => firstName(it.camper)).filter(Boolean))];
      const parent = firstName(parentByEmail[email]);
      await svc("retarget_state", {
        method: "POST", headers: { Prefer: "resolution=ignore-duplicates" },
        body: JSON.stringify({
          email, seq: "abandoned", stage: 0, status: "active",
          anchor_at: new Date(signIn).toISOString(),
          ctx: { parent, campers, camps: campTitles },
        }),
      });
      log.enrolled++;
    } else if (st.status === "active" && st.stage === 0 && signIn > new Date(st.anchor_at).getTime()) {
      // new session before step 1 fired — reset the clock (Jason's rule)
      await svc(`retarget_state?email=eq.${encodeURIComponent(email)}`, { method: "PATCH", body: JSON.stringify({ anchor_at: new Date(signIn).toISOString(), updated_at: new Date().toISOString() }) });
      log.reset++;
    }
  }

  // refresh states after enrollment
  const states2 = await svc("retarget_state?select=*&status=eq.active&limit=2000");

  // ---- sends ----
  for (const st of states2) {
    const email = st.email;
    if (purchased.has(email)) {
      await svc(`retarget_state?email=eq.${encodeURIComponent(email)}`, { method: "PATCH", body: JSON.stringify({ status: "purchased", updated_at: new Date().toISOString() }) });
      log.purchased_out++;
      continue;
    }
    const seqSteps = stepsBySeq[st.seq] || [];
    const next = seqSteps.find((s) => s.step === st.stage + 1);
    if (!next) {
      if (st.stage > 0) await svc(`retarget_state?email=eq.${encodeURIComponent(email)}`, { method: "PATCH", body: JSON.stringify({ status: "done", updated_at: new Date().toISOString() }) });
      continue;
    }
    const base = st.stage === 0 ? new Date(st.anchor_at).getTime() : new Date(st.last_sent_at || st.anchor_at).getTime();
    if (now - base < next.delay_minutes * 60000) continue;

    // active timer check: unexpired hold = they're mid-checkout, wait
    if (st.seq === "abandoned") {
      const hs = holdsByEmail[email] || [];
      const active = hs.some((h) => h.expires_at && new Date(h.expires_at).getTime() > now);
      if (active) continue;
    }

    const ctx = st.ctx || {};
    const campers = ctx.campers || [];
    const camps = (ctx.camps && ctx.camps.length) ? ctx.camps : ["Summer 2027"];
    const vars = {
      parentName: ctx.parent || "there",
      parentComma: ctx.parent ? " " + ctx.parent : "",
      camperName: campers[0] || "your camper",
      camperNames: joinNames(campers) || "your camper",
      camp: camps[0],
      campName: camps[0],
      camps: joinNames(camps),
      link: `${SITE}/register/?go=1&utm_source=retarget&utm_campaign=${st.seq}_${next.step}`,
    };
    try {
      const refs = Array.isArray(st.msg_refs) ? st.msg_refs : [];
      const msgId = await sendMail({
        to: email,
        subject: render(next.subject, vars),
        html: render(next.body, vars),
        refs: next.step > 2 ? refs : [], // step 3 threads onto step 2
      });
      refs.push(msgId);
      await svc(`retarget_state?email=eq.${encodeURIComponent(email)}`, {
        method: "PATCH",
        body: JSON.stringify({ stage: next.step, last_sent_at: new Date().toISOString(), msg_refs: refs, updated_at: new Date().toISOString() }),
      });
      log.sent++;
    } catch (e) { console.error(`send failed ${email}:`, e.message); }
  }

  // ---- linkexpired: requested a link, never signed in ----
  const lxSteps = stepsBySeq["linkexpired"] || [];
  if (lxSteps.length) {
    for (const u of users) {
      const email = String(u.email || "").toLowerCase();
      if (!email || u.last_sign_in_at) continue; // they got in
      if (purchased.has(email) || stateByEmail[email]) continue;
      const created = new Date(u.created_at).getTime();
      if (now - created < lxSteps[0].delay_minutes * 60000) continue; // still fresh
      if (now - created > 5 * 86400000) continue; // too old, skip
      const parent = firstName(parentByEmail[email]);
      const vars = {
        parentName: parent || "there", parentComma: parent ? " " + parent : "",
        link: `${SITE}/register/?go=1&utm_source=retarget&utm_campaign=linkexpired`,
      };
      try {
        const msgId = await sendMail({ to: email, subject: render(lxSteps[0].subject, vars), html: render(lxSteps[0].body, vars) });
        await svc("retarget_state", {
          method: "POST", headers: { Prefer: "resolution=ignore-duplicates" },
          body: JSON.stringify({ email, seq: "linkexpired", stage: 1, status: "done", last_sent_at: new Date().toISOString(), msg_refs: [msgId], ctx: { parent } }),
        });
        log.sent++;
      } catch (e) { console.error(`linkexpired send failed ${email}:`, e.message); }
    }
  }

  console.log("drip:", JSON.stringify(log));
  return new Response(JSON.stringify(log), { status: 200 });
};

// PAUSED (Jason, pre-review): schedule disabled — no runs, no sends.
// To arm the engine, restore:  export const config = { schedule: "*/15 * * * *" };
