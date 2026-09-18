// The note from CJ after a free class — scheduled, every 15 minutes.
//
// CJ, 11 Sep 2026: "how do we close the deal after they register? Should we
// set up an email to come directly from me, the CEO and ask them to register
// to continue - we'd love to have them!" Jason: "schedule it for as soon as
// the scheduled class ends." CJ, 16 Sep 2026: automate it through Resend,
// starting after tonight's classes.
//
// What it does. A visit the teacher marked `attended` on the register
// (free_class_bookings.status, via portal_mark_visit) gets ONE email once
// its class has ended: thanks for coming, when the class meets, the next
// date, a link that puts that class in the cart, the price, and a plain
// invitation to reply. It reads like an email a person typed, because the
// Monday and Tuesday families of the first week got exactly that, by hand,
// from CJ's own inbox.
//
// One email per family per day, not per visit: Ariannah and Sydni each
// sampled two Tuesday classes back to back, and the Kifle family booked
// three children on one night. Those get a single note naming every class
// and child, with a link that carries every listing (?activity=a,b).
//
// What it never does.
//   - Writes to a family whose visit is `converted`: convert_free_class_trials
//     flips attended -> converted the moment the family pays, so a family
//     that signed up in the lobby is not asked to sign up.
//   - Writes twice. followup_sent_at is stamped as the claim BEFORE the send
//     (the campaign runner's Aug 10 lesson: scheduled ticks are at-least-once
//     and two invocations can race), and only rows without it are picked up.
//   - Writes to anyone in email_suppressions, any scope.
//   - Writes about the first two nights. FOLLOWUP_SINCE keeps it off the
//     families CJ already wrote to by hand on 16 Sep.
//   - Runs when FREECLASS_FOLLOWUP=off is set in Netlify: a pause without a
//     deploy.
//
// Sends ride Resend on the mail.novapa.org subdomain like every other
// automated send here (the root domain is reserved for receipts and sign-in
// links). The From is CJ by name and replies go to his real inbox, so a
// parent who hits reply lands with him.
import { SUPABASE_URL } from "./reg-config.mjs";
import { CLASSES } from "./reg-freeclass.mjs";

export const FOLLOWUP_SINCE = "2026-09-16";  // class_date on or after this
export const FROM = "CJ Cimino-Johnson, NOVAPA <cj@mail.novapa.org>";
export const REPLY_TO = "cj@novapa.org";
const REGISTER = "https://novapa.org/register/";
// Where a family that missed its free class picks a new date. The utm tags
// keep the rebooking attributable, like every other link into the funnel.
export const REBOOK = "https://novapa.org/free-class/book?utm_source=novapa&utm_medium=email&utm_campaign=freeclass_missed";
const TZ = "America/New_York";
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ── Time ───────────────────────────────────────────────────────────────────
// "7:00pm - 8:30pm EDT" (activities.class_times[0].primary_text[0]) -> minutes
// since midnight, Eastern. Null when the listing's hours cannot be read.
export function parseHours(s) {
  const m = String(s || "").match(/(\d{1,2}):(\d{2})\s*(am|pm)\s*[-–]\s*(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!m) return null;
  const min = (h, mm, ap) => ((+h % 12) + (/pm/i.test(ap) ? 12 : 0)) * 60 + +mm;
  return { start: min(m[1], m[2], m[3]), end: min(m[4], m[5], m[6]) };
}
function easternOffsetMinutes(ms) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(ms));
  const g = (t) => +parts.find((p) => p.type === t).value;
  const local = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"));
  return Math.round((ms - local) / 60000);
}
// A wall-clock minute on an Eastern date, as an instant.
export function easternToUtc(dateIso, minutes) {
  const guess = Date.parse(`${dateIso}T00:00:00Z`) + minutes * 60000;
  return new Date(guess + easternOffsetMinutes(guess) * 60000);
}
// When the visit's class ends. The listing's hours win; a listing whose
// hours cannot be read falls back to the catalogue's start time plus an hour.
export function classEndsAt(classDate, hours, castKey) {
  const h = parseHours(hours);
  if (h) return easternToUtc(classDate, h.end);
  const cls = CLASSES[castKey];
  const m = cls && String(cls.time).match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return null;
  const start = ((+m[1] % 12) + (/pm/i.test(m[3]) ? 12 : 0)) * 60 + +m[2];
  return easternToUtc(classDate, start + 60);
}
const fmtTime = (min, withMeridiem = true) => {
  const h12 = ((Math.floor(min / 60) + 11) % 12) + 1;
  const mm = String(min % 60).padStart(2, "0");
  return withMeridiem ? `${h12}:${mm} ${min >= 720 ? "PM" : "AM"}` : `${h12}:${mm}`;
};
// "7:00 to 8:30 PM", or "11:30 AM to 12:20 PM" when the meridiem changes
export function prettyHours(hours) {
  const h = parseHours(hours);
  if (!h) return null;
  const same = (h.start >= 720) === (h.end >= 720);
  return `${fmtTime(h.start, !same)} to ${fmtTime(h.end)}`;
}
function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function weekdayOf(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
function prettyDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US",
    { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });
}

// ── Grouping ───────────────────────────────────────────────────────────────
// visits: free_class_bookings rows (attended, unsent, since FOLLOWUP_SINCE)
// listings: { [activity_id]: { name, age_range, hours } }
// -> one group per family per class date, due when its LAST class has ended.
export function groupVisits(visits, listings) {
  const groups = new Map();
  for (const v of visits) {
    const status = v.status === "no_show" ? "no_show" : "attended";
    const key = `${v.email.toLowerCase()}|${v.class_date}|${status}`;
    if (!groups.has(key)) {
      groups.set(key, { email: v.email.toLowerCase(), parent_name: v.parent_name, class_date: v.class_date, status, ids: [], visits: [], ends_at: null });
    }
    const g = groups.get(key);
    const l = listings[v.activity_id] || {};
    const ends = classEndsAt(v.class_date, l.hours, v.cast_key);
    g.ids.push(v.id);
    g.visits.push({
      child: v.child_name, activity_id: v.activity_id,
      name: l.name || CLASSES[v.cast_key]?.name || "the class",
      ages: l.age_range || (CLASSES[v.cast_key] ? `${CLASSES[v.cast_key].ages[0]} – ${CLASSES[v.cast_key].ages[1]} yrs` : ""),
      hours: l.hours || null, ends_at: ends,
    });
    if (ends && (!g.ends_at || ends > g.ends_at)) g.ends_at = ends;
  }
  return [...groups.values()];
}
export const isDue = (g, now = new Date()) => !!g.ends_at && g.ends_at <= now;

// ── The note ───────────────────────────────────────────────────────────────
const uniq = (xs) => [...new Set(xs)];
const list = (xs) => xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
const poss = (s) => `${s}'s`;
export function firstName(parent) {
  const w = String(parent || "").trim().split(/\s+/)[0] || "";
  if (!w || w.includes("@") || w.length < 2) return "there";
  return w[0].toUpperCase() + w.slice(1);
}

// Returns { subject, paragraphs }: paragraphs are strings, or { link } for a
// line that is a URL on its own. The same list renders to text and to HTML,
// so the plain-text part and the rich part never disagree.
export function composeNote(g) {
  const children = uniq(g.visits.map((v) => v.child));
  const classes = uniq(g.visits.map((v) => v.activity_id))
    .map((id) => g.visits.find((v) => v.activity_id === id));
  const one = children.length === 1;
  const child = one ? children[0] : list(children);
  const day = weekdayOf(g.class_date);
  const next = prettyDate(addDays(g.class_date, 7));
  const url = `${REGISTER}?activity=${classes.map((c) => c.activity_id).join(",")}`;
  const classesLabel = classes.length === 1 ? classes[0].name : list(classes.map((c) => c.name));

  const p = [];
  p.push(`Hi ${firstName(g.parent_name)},`);
  // CJ, 16 Sep 2026: no "tonight" or "today" anywhere in the note.
  p.push(`Thank you for bringing ${child} to ${classesLabel}. It was great to have ${one ? child : "them"} in the room, and I hope the class ended with a smile.`);

  if (classes.length === 1) {
    const c = classes[0];
    const hrs = prettyHours(c.hours);
    p.push(`If ${one ? child : "they"} loved it, the class meets every ${day}${hrs ? ` from ${hrs}` : ""}, and the next one is this coming ${next}. Registering takes about a minute here:`);
    p.push({ link: url });
    p.push(`It is $90 a month, and if ${one ? child : "they"} want${one ? "s" : ""} to add a second class later it is $150 for two, $180 for three.`);
  } else {
    p.push(`If ${one ? child : "they"} loved them, the classes meet every ${day}:`);
    for (const c of classes) {
      const who = one ? "" : `${uniq(g.visits.filter((v) => v.activity_id === c.activity_id).map((v) => v.child)).join(" and ")}: `;
      const hrs = prettyHours(c.hours);
      p.push(`• ${who}${c.name}${c.ages ? ` (ages ${c.ages.replace(/\s*yrs$/, "")})` : ""}${hrs ? `, ${hrs}` : ""}`);
    }
    p.push(`The next ones are this coming ${next}. This link puts ${classes.length === 2 ? "both" : "all of them"} in the cart, and registering takes about a minute:`);
    p.push({ link: url });
    p.push(one
      ? `Two classes together are $150 a month. If ${child} would rather start with just one, either is $90 a month on its own, and you can always add the other later.`
      : `Each class is $90 a month, and a child taking more than one pays less: $150 for two, $180 for three.`);
  }

  p.push(`We would love to see ${child} back on ${day}. If you have any questions at all, about the class, the schedule, or anything else, please don't hesitate to ask. Just reply to this email and it comes straight to me.`);
  p.push("Warmly,\nMr. Cimino-Johnson\nCo-Founder & CEO, Northern Virginia Performing Arts\ncj@novapa.org · 571-571-2120\n18945 Conference Center Drive, Plaza C, Leesburg, VA 20176");

  const subject = one
    ? `${poss(child)} first class, and what comes next`
    : `${poss(list(children))} first classes, and what comes next`;
  return { subject, paragraphs: p, url };
}

// CJ, 16 Sep 2026: a family whose child was marked absent hears from him
// too, with one more free date to pick. reg-freeclass allows exactly one
// reschedule after a missed visit, so the link in this note works once.
export function composeMissedNote(g) {
  const children = uniq(g.visits.map((v) => v.child));
  const one = children.length === 1;
  const child = one ? children[0] : list(children);
  const classes = uniq(g.visits.map((v) => v.name));
  const p = [];
  p.push(`Hi ${firstName(g.parent_name)},`);
  p.push(`We saved a seat for ${child} in ${list(classes)} on ${prettyDate(g.class_date)} and missed ${one ? child : "them"} in the room. Life with kids is busy, and it happens.`);
  p.push(`The free class is still yours. Pick a new date that works better here, it takes about a minute:`);
  p.push({ link: REBOOK });
  p.push(`If a different day or class would be a better fit, or you have any questions at all, just reply to this email and it comes straight to me. We would love to meet ${one ? child : "them"}.`);
  p.push("Warmly,\nMr. Cimino-Johnson\nCo-Founder & CEO, Northern Virginia Performing Arts\ncj@novapa.org · 571-571-2120\n18945 Conference Center Drive, Plaza C, Leesburg, VA 20176");
  const subject = `We missed ${child}. Pick a new free class date`;
  return { subject, paragraphs: p, url: REBOOK };
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function renderNote({ paragraphs }) {
  const text = paragraphs.map((p) => (typeof p === "string" ? p : p.link)).join("\n\n");
  const html = `<!doctype html><html><body style="margin:0;padding:0"><div style="max-width:560px;padding:8px 4px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.55;color:#1a2233">
${paragraphs.map((p) => typeof p === "string"
    ? `<p style="margin:0 0 18px">${esc(p).replace(/\n/g, "<br>")}</p>`
    : `<p style="margin:0 0 18px"><a href="${esc(p.link)}" style="color:#0b5fff">${esc(p.link)}</a></p>`).join("\n")}
</div></body></html>`;
  return { text, html };
}

// ── Plumbing ───────────────────────────────────────────────────────────────
async function svc(path, init = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`db ${path} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

async function sendResend({ to, subject, text, html }) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, reply_to: REPLY_TO, to: [to], subject, text, html }),
  });
  if (!r.ok) throw new Error(`resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

export default async () => {
  if ((process.env.FREECLASS_FOLLOWUP || "").toLowerCase() === "off")
    return new Response("free-class follow-up: paused (FREECLASS_FOLLOWUP=off)", { status: 200 });
  if (!process.env.RESEND_API_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    return new Response("free-class follow-up: not configured", { status: 200 });

  // Attended, unsent, and from the automated era onward. A visit stays
  // `attended` only until the family pays (then it is `converted`), so this is
  // exactly the set still to be asked.
  const visits = await svc(
    `free_class_bookings?status=in.(attended,no_show)&followup_sent_at=is.null&class_date=gte.${FOLLOWUP_SINCE}` +
    `&select=id,status,parent_name,email,child_name,cast_key,activity_id,class_date,attended_at&order=class_date,email`);
  if (!visits?.length) return new Response("free-class follow-up: nothing to send", { status: 200 });

  const ids = [...new Set(visits.map((v) => v.activity_id))];
  const listings = {};
  for (const a of await svc(`activities?id=in.(${ids.join(",")})&select=id,name,age_range,class_times`)) {
    listings[a.id] = { name: a.name, age_range: a.age_range, hours: a.class_times?.[0]?.primary_text?.[0] || null };
  }
  const suppressed = new Set((await svc("email_suppressions?select=email")).map((s) => s.email.toLowerCase()));

  const now = new Date();
  let sent = 0, waiting = 0, skipped = 0;
  for (const g of groupVisits(visits, listings)) {
    if (!isDue(g, now)) { waiting++; continue; }
    try {
      // The claim. Stamp first, and only rows nobody else stamped come back;
      // an empty result means another tick owns this family tonight.
      const claimed = await svc(
        `free_class_bookings?id=in.(${g.ids.join(",")})&followup_sent_at=is.null`,
        { method: "PATCH", headers: { Prefer: "return=representation" },
          body: JSON.stringify({ followup_sent_at: now.toISOString() }) });
      if (!Array.isArray(claimed) || !claimed.length) { skipped++; continue; }
      if (suppressed.has(g.email)) { skipped++; continue; }   // stamped, so never retried
      const note = g.status === "no_show" ? composeMissedNote(g) : composeNote(g);
      const { text, html } = renderNote(note);
      const res = await sendResend({ to: g.email, subject: note.subject, text, html });
      await svc(`free_class_bookings?id=in.(${g.ids.join(",")})`, {
        method: "PATCH", body: JSON.stringify({ followup_message_id: res?.id || null }),
      });
      sent++;
    } catch (e) {
      // The stamp stays: a family is never emailed twice because a send
      // half-failed. The row's note says why, for whoever opens the roster.
      console.error(`free-class follow-up failed ${g.email}:`, e.message);
      await svc(`free_class_bookings?id=in.(${g.ids.join(",")})`, {
        method: "PATCH",
        body: JSON.stringify({ followup_message_id: `FAILED ${now.toISOString().slice(0, 16)} ${String(e.message).slice(0, 120)}` }),
      }).catch(() => {});
    }
  }
  return new Response(`free-class follow-up: sent ${sent}, waiting for class to end ${waiting}, skipped ${skipped}`, { status: 200 });
};

export const config = { schedule: "*/15 * * * *" };
