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
// - 'linkexpired': requested a sign-in link AFTER the epoch below, never
//   signed in -> one nudge. Historical non-entries are never contacted.
import { SUPABASE_URL } from "./reg-config.mjs";

const SITE = "https://www.northernvirginiaperformingarts.org";
// Drip is the only bursty sender on the shared Gmail 2k/day budget — cap each
// 15-min run. Magic links are Supabase-side and untouched by this.
const MAX_SENDS_PER_RUN = 25;
// linkexpired only applies to requests made after this moment (Jason 7/22:
// "only new ones" — the old backlog moved on days ago and stays untouched)
const LINKEXPIRED_EPOCH = Date.parse("2026-07-22T22:00:00Z"); // 6pm ET Jul 22
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

// Anyone who has emailed us is in a human conversation — automated steps stop.
// Reads the shared inbox over IMAP (same Gmail app password as SMTP) and stops
// every active sequence whose lead appears as a sender. Failure-isolated: an
// IMAP hiccup skips the check for this run, never the sends.
async function stopRepliers(states) {
  const active = states.filter((s) => s.status === "active");
  if (!active.length) return 0;
  const senders = new Set();
  try {
    const { ImapFlow } = await import("imapflow");
    const client = new ImapFlow({
      host: "imap.gmail.com", port: 993, secure: true,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      logger: false,
    });
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const since = new Date(Date.now() - 5 * 24 * 3600 * 1000);
      for await (const msg of client.fetch({ since }, { envelope: true })) {
        for (const a of msg.envelope?.from || []) senders.add(String(a.address || "").toLowerCase());
      }
    } finally { lock.release(); }
    await client.logout();
  } catch (e) {
    console.error("imap reply check failed:", e.message);
    return 0;
  }
  let stopped = 0;
  for (const s of active) {
    if (!senders.has(String(s.email).toLowerCase())) continue;
    const rows = await svc(
      `retarget_state?email=eq.${encodeURIComponent(s.email)}&status=eq.active`,
      { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ status: "stopped" }) }
    );
    if (Array.isArray(rows) && rows.length) { stopped++; s.status = "stopped"; }
  }
  return stopped;
}

export default async () => {
  // Only the published production deploy runs the engine. Branch deploys share
  // the same database — two runners = duplicate sends (learned 7/22 the hard way).
  if (process.env.CONTEXT && process.env.CONTEXT !== "production") {
    return new Response("skipped: non-production context", { status: 200 });
  }
  const now = Date.now();

  // sequence templates
  let steps;
  try { steps = await svc("email_sequences?select=*&enabled=eq.true&order=seq,step"); }
  catch (e) { console.error("sequences missing:", e.message); return new Response("no sequences", { status: 200 }); }
  const stepsBySeq = {};
  for (const s of steps) (stepsBySeq[s.seq] = stepsBySeq[s.seq] || []).push(s);

  // all orders (suppression) + holds + families/campers context
  const [orders, holds, families, activities] = await Promise.all([
    svc("orders?select=email,created_at&limit=2000"),
    svc("holds?select=email,items,created_at,expires_at&order=created_at.desc&limit=1000"),
    svc("families?select=email,parent_name&limit=2000"),
    svc("activities?select=id,name&limit=2000"),
  ]);
  const purchased = new Set(orders.map((o) => String(o.email || "").toLowerCase()));
  // Cart items are either a summer camp (it.show) or a catalog item
  // (it.activity_id) — Mean Girls, Frozen, Mermaid, classes. Without this the
  // catalog half resolved to nothing and every email fell back to the generic
  // "Summer 2027", naming the wrong program in the exact line meant to be
  // personal.
  const actNameById = {};
  for (const a of activities) actNameById[a.id] = a.name || "";
  const prettyActName = (raw) => {
    const n = String(raw || "");
    if (/mean girls/i.test(n)) return "Mean Girls";
    if (/frozen/i.test(n)) return "Frozen";
    if (/mermaid/i.test(n)) return "The Little Mermaid JR.";
    return n.split("|").pop().trim() || n.trim();
  };
  const itemTitle = (it) => it.show
    ? SHOW_TITLES[it.show]
    : (it.activity_id != null ? prettyActName(actNameById[it.activity_id]) : null);
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

  const log = { enrolled: 0, reset: 0, sent: 0, purchased_out: 0, replied_stop: 0 };
  log.replied_stop = await stopRepliers(states);

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
      const campTitles = [...new Set(items.map(itemTitle).filter(Boolean))];
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
    if (log.sent >= MAX_SENDS_PER_RUN) break;
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
    // Enrollment fires on sign-in, which is often BEFORE the cart exists, so
    // ctx can be empty or stale. Prefer their latest hold at send time — that's
    // the cart they actually walked away from.
    const latestItems = (holdsByEmail[email] || [])[0]?.items || [];
    const liveCamps = [...new Set(latestItems.map(itemTitle).filter(Boolean))];
    const liveCampers = [...new Set(latestItems.map((it) => firstName(it.camper)).filter(Boolean))];
    const campers = liveCampers.length ? liveCampers : (ctx.campers || []);
    const camps = liveCamps.length ? liveCamps
      : (ctx.camps && ctx.camps.length) ? ctx.camps : ["Summer 2027"];
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
    // claim the step FIRST (conditional on current stage) — if another runner
    // got here before us, zero rows come back and we skip. A claimed-but-failed
    // send means one missed email, never a duplicate.
    const claim = await fetch(`${SUPABASE_URL}/rest/v1/retarget_state?email=eq.${encodeURIComponent(email)}&stage=eq.${st.stage}&status=eq.active`, {
      method: "PATCH",
      headers: { ...svcHeaders(), Prefer: "return=representation" },
      body: JSON.stringify({ stage: next.step, updated_at: new Date().toISOString() }),
    });
    let claimedRows = [];
    try { claimedRows = await claim.json(); } catch {}
    if (!Array.isArray(claimedRows) || !claimedRows.length) continue;
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
        body: JSON.stringify({ last_sent_at: new Date().toISOString(), msg_refs: refs, updated_at: new Date().toISOString() }),
      });
      log.sent++;
    } catch (e) { console.error(`send failed ${email} (step claimed, not retried):`, e.message); }
  }

  // ---- linkexpired: requested a link, never signed in ----
  const lxSteps = stepsBySeq["linkexpired"] || [];
  if (lxSteps.length) {
    for (const u of users) {
      if (log.sent >= MAX_SENDS_PER_RUN) break;
      const email = String(u.email || "").toLowerCase();
      if (!email || u.last_sign_in_at) continue; // clicked a link at some point — never nudge
      if (purchased.has(email) || stateByEmail[email]) continue;
      // measure from their LATEST link request, not account creation — a fresh
      // link must actually go stale before we claim it expired
      const lastLink = Math.max(...[u.created_at, u.confirmation_sent_at, u.recovery_sent_at, u.email_change_sent_at]
        .filter(Boolean).map((t) => new Date(t).getTime()));
      if (lastLink < LINKEXPIRED_EPOCH) continue; // pre-launch backlog: never nudge
      if (now - lastLink < lxSteps[0].delay_minutes * 60000) continue; // their link is still fresh
      if (now - lastLink > 2 * 86400000) continue; // stale, skip
      const parent = firstName(parentByEmail[email]);
      const vars = {
        parentName: parent || "there", parentComma: parent ? " " + parent : "",
        link: `${SITE}/register/?go=1&utm_source=retarget&utm_campaign=linkexpired`,
      };
      try {
        // claim by inserting the state row first — duplicate insert returns
        // nothing, so only one runner ever sends
        const ins = await fetch(`${SUPABASE_URL}/rest/v1/retarget_state`, {
          method: "POST",
          headers: { ...svcHeaders(), Prefer: "resolution=ignore-duplicates,return=representation" },
          body: JSON.stringify({ email, seq: "linkexpired", stage: 1, status: "done", ctx: { parent } }),
        });
        let insRows = [];
        try { insRows = await ins.json(); } catch {}
        if (!Array.isArray(insRows) || !insRows.length) continue;
        const msgId = await sendMail({ to: email, subject: render(lxSteps[0].subject, vars), html: render(lxSteps[0].body, vars) });
        await svc(`retarget_state?email=eq.${encodeURIComponent(email)}`, {
          method: "PATCH",
          body: JSON.stringify({ last_sent_at: new Date().toISOString(), msg_refs: [msgId], updated_at: new Date().toISOString() }),
        });
        log.sent++;
      } catch (e) { console.error(`linkexpired send failed ${email}:`, e.message); }
    }
  }

  console.log("drip:", JSON.stringify(log));
  return new Response(JSON.stringify(log), { status: 200 });
};

export const config = { schedule: "*/15 * * * *" };
