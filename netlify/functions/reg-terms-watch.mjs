// Notices when the live Terms change and drafts the notice to families
// (Oct 9 2026, Todd: "when Terms and Conditions change on our website, can
// you have an automatic email sent out to all those registered").
//
// Once a day this reads /terms, the Terms & Conditions section of /policies
// and the checkout's "I agree" sentence from production (reg-terms.mjs). When
// that text is a version production has not served before, it:
//
//   1. stamps the version went_live_at,
//   2. writes the notice as a 'draft' campaign to buyers_2027, listing the
//      sections that changed,
//   3. emails the admin list that a draft is waiting.
//
// It never sends the notice. CJ's call (Oct 9): drafted automatically, sent
// by a person. Not every edit is a material change: a comma fix would
// otherwise email every registered family, and the policies page promises
// notice of material changes, not of every revision. To send, set the
// campaign's status to 'scheduled' with a scheduled_at, and reg-campaign
// delivers it like any other. To skip, set it to 'cancelled'.
//
// The very first version it sees is the baseline: stamped, no notice.
import { SUPABASE_URL } from "./reg-config.mjs";
import { withHeartbeat } from "./reg-heartbeat.mjs";
import { sendMail } from "./reg-mail.mjs";
import { readVersion, saveVersion, changedSections } from "./reg-terms.mjs";

const LIVE = "https://novapa.org";

export function noticeBody(changed) {
  const list = changed.length
    ? changed.map((c) => `* ${c}`).join("\n")
    : "* Wording updates throughout";
  return [
    "Hi {first_name},",
    "We have updated the Northern Virginia Performing Arts Terms and Conditions. The sections that changed:",
    list,
    "The Terms and Conditions in effect when you registered continue to govern that registration unless we both agree to the updated terms. The updated terms apply to registrations and purchases from today on.",
    "[READ THE UPDATED TERMS](https://novapa.org/policies)",
    "If you have a question about any of it, reply to this email and we will walk you through it.",
    "Northern Virginia Performing Arts",
  ].join("\n\n");
}

const run = async () => {
  // production only: branch deploys share the database
  if (process.env.CONTEXT && process.env.CONTEXT !== "production") {
    return new Response("skipped: non-production context", { status: 200 });
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const hdrs = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const svc = async (path, opts = {}) => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...hdrs, ...(opts.headers || {}) } });
    const t = await r.text();
    if (!r.ok) throw new Error(`${path.split("?")[0]} ${r.status}: ${t.slice(0, 200)}`);
    return t ? JSON.parse(t) : null;
  };

  const v = await readVersion(LIVE);
  await saveVersion(v);

  const prev = (await svc(
    `terms_versions?went_live_at=not.is.null&hash=neq.${v.hash}&order=went_live_at.desc&limit=1` +
    `&select=hash,terms_text,policies_text,checkbox_text,went_live_at`))[0];

  // Claim: only the run whose PATCH flips went_live_at from null goes on, so
  // two overlapping runs cannot draft the notice twice.
  const claimed = await svc(`terms_versions?hash=eq.${v.hash}&went_live_at=is.null`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ went_live_at: new Date().toISOString(), is_baseline: !prev }),
  });
  if (!Array.isArray(claimed) || !claimed.length) {
    return new Response(`no change (${v.hash.slice(0, 12)})`, { status: 200 });
  }
  if (!prev) return new Response(`baseline recorded (${v.hash.slice(0, 12)})`, { status: 200 });

  const changed = changedSections(prev, v);
  const today = new Date().toISOString().slice(0, 10);
  const [camp] = await svc("campaigns", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      name: `terms-notice-${today}`,
      subject: "We updated our Terms and Conditions",
      body: noticeBody(changed),
      audience: "buyers_2027",
      status: "draft",
      sent_count: 0,
    }),
  });
  await svc(`terms_versions?hash=eq.${v.hash}`, {
    method: "PATCH", body: JSON.stringify({ notice_campaign_id: camp.id }),
  });

  try {
    const admins = (await svc("admin_emails?select=email")).map((r) => r.email).filter(Boolean);
    if (admins.length) {
      const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
      await sendMail({
        fromName: "NOVAPA Registrations",
        to: admins,
        subject: "Terms and Conditions changed: family notice drafted",
        html: [
          `The Terms and Conditions on novapa.org changed. Sections that differ from the last version:`,
          `<ul>${changed.map((c) => `<li>${esc(c)}</li>`).join("") || "<li>wording only</li>"}</ul>`,
          `A notice to every registered family is waiting as a <b>draft</b> campaign ` +
          `(<code>${camp.name}</code>). Nothing has been sent.`,
          `If this is a material change, schedule the draft to send it. If it was a small fix, cancel it. ` +
          `Families' agreements are filed per version either way: Admin, Families, Signed terms.`,
        ].join("<br><br>"),
      });
    }
  } catch (e) { console.error("terms watch: admin notify failed:", e.message); }

  return new Response(`new version ${v.hash.slice(0, 12)}: drafted ${camp.name}, ${changed.length} section(s)`, { status: 200 });
};

export default withHeartbeat("reg-terms-watch", run);

// 14:00 UTC = 10 AM Eastern, after any overnight release has gone live
export const config = { schedule: "0 14 * * *" };
