// Free class funnel — /api/reg-freeclass (novapa.org/free-class)
//   GET  -> { classes: [{ key, name, ages, day, time, dates: [{ date, left }] }], card_required }
//   POST { parent_name, email, phone, child_name, child_age, class, date, utm, setup_intent }
//        -> { ok, booking } and sends the confirmation email.
//   POST { action: "precheck", ...same fields }  -> { ok } or the booking's error, no write
//   POST { action: "card", email, parent_name }  -> { client_secret } for the card step
//   POST { action: "manage", token }             -> the booking behind a cancel link
//   POST { action: "cancel", token }             -> cancels it, if 24+ hours out
//   POST { action: "enroll_info", tokens }       -> what the one-click enroll page shows
//
// Jason (Aug 26 2026): the free pass is for the real weekly CLASSES, any
// class on the schedule, booked 7 or more days out. The catalog mirrors
// classes.html (September–June season, $90/month per class — price never
// shown here, the visit is free). Writes go to free_class_bookings
// (RLS closed, service role only).
//
// The card on file (CJ, Sep 24 2026): the visit is still free, but the family
// saves a card to hold the seat. It is charged $30 if the child does not come
// and the family did not cancel 24 or more hours before the class
// (reg-freeclass-noshow.mjs), and it is the card the one-click enroll button
// uses afterward (free-class/enroll.html -> reg-pay). Saving it is a Stripe
// SetupIntent: no money moves at booking. FREECLASS_CARD=off in Netlify
// switches the card step off without a deploy.
import Stripe from "stripe";

const SUPABASE_URL = "https://tlkuqwsqicxcjdmumkje.supabase.co";

export const NO_SHOW_FEE_CENTS = 3000;
export const CANCEL_NOTICE_HOURS = 24;
const cardRequired = () => (process.env.FREECLASS_CARD || "").toLowerCase() !== "off"
  && !!process.env.STRIPE_SECRET_KEY;

// Weekly schedule verified against classes.html (Aug 26 2026).
// day: 0=Sun..6=Sat. Adult classes are deliberately absent — this funnel
// books kids.
//
// activityId is the listing a trial is a visit to. Bookings used to store a
// hardcoded 0, so a free seat belonged to no class and nothing could count it:
// the register page, the staff portal and the teacher's roster each had their
// own idea of who was in the room. Every id below was matched to a live
// listing on day of week + start time + age range (Sep 10 2026). All thirteen
// are the `bookable` FULL YEAR listings; the seven that are not bookable
// (ballet, hip-hop, K-Pop, the Wednesday Triple Threat) are absent on purpose,
// because they are not offered as trials.
//
// This table is maintained by hand and will drift from the catalogue.
// tests/free-class-classes.test.mjs pins its shape, and `npm run check:live`
// asks the database whether each id is still a listing that sells.
const CLASSES = {
  "acting-5-8":        { activityId: 1960867, name: "Acting",                                ages: [5, 8],   day: 1, time: "6:00 PM" },
  "triple-threat":     { activityId: 1960898, name: "Triple Threat Musical Theatre Training", ages: [13, 17], day: 1, time: "7:00 PM" },
  "mt-5-8":            { activityId: 1960924, name: "Musical Theatre",                       ages: [5, 8],   day: 2, time: "5:00 PM" },
  "mt-dance-13-17":    { activityId: 1960925, name: "Musical Theatre Dance",                 ages: [13, 17], day: 2, time: "7:00 PM" },
  "mt-acting-13-17":   { activityId: 1960927, name: "Musical Theatre Acting",                ages: [13, 17], day: 2, time: "8:00 PM" },
  // Homeschool MT/Theatre (hs-mt 1962566, hs-theatre 1962567) removed
  // Sep 14 2026: CJ retired the program Sep 11 ("take them down from the
  // website and registration form") but the trial list was missed and
  // check:live flagged trials pointing at listings that refuse to sell.
  // Restore both keys here when the program rolls out again.
  "acting-9-12":       { activityId: 1960936, name: "Acting",                                ages: [9, 12],  day: 3, time: "5:15 PM" },
  "mt-dance-9-12":     { activityId: 1960939, name: "Musical Theatre Dance",                 ages: [9, 12],  day: 3, time: "6:15 PM" },
  "mt-acting-9-12":    { activityId: 1960945, name: "Musical Theatre Acting",                ages: [9, 12],  day: 3, time: "7:15 PM" },
  "improv-9-12":       { activityId: 1960959, name: "Improv for Actors",                     ages: [9, 12],  day: 4, time: "6:30 PM" },
  "improv-13-17":      { activityId: 1960961, name: "Improv for Actors",                     ages: [13, 17], day: 4, time: "7:30 PM" },
  "acting-mt-sat":     { activityId: 1962562, name: "Acting & Musical Theatre",              ages: [9, 12],  day: 6, time: "12:00 PM" },
  "film-tv":           { activityId: 992001,  name: "Film & Television",                   ages: [11, 17], day: 1, time: "8:00 PM" },
};
// Exported for the tests and the preflight live check, nothing else reads it.
export { CLASSES };

// Booking cutoff (Jason, Sep 11 2026; supersedes CJ's 48 hours of Sep 10,
// which superseded Jason's original 7 days): a family can book right up
// until ONE HOUR before the session starts, Eastern time. Same-day walk-ups
// are welcome; staff checks the visitor register day-of.
// The SEASON_START floor below is what stops pre-season dates being offered,
// not this number, so shortening the notice does not reopen the Sep 8 bug.
const CUTOFF_MINUTES = 60;
const DATES_SHOWN = 3;     // next N valid dates per class
// The season's real boundaries. Without the floor, late-August bookings were
// offered "next Tuesday" dates BEFORE classes began — two families were told
// Sep 8 and one Sep 10, and one walked into an empty building (Sep 8 2026).
// The ceiling prevents the mirror bug in June (offering July dates for
// classes that ended).
const SEASON_START = "2026-09-14";
const SEASON_END = "2027-06-12";
const FREE_SEATS_PER_DATE = 6;  // ops cap per class per date, not a sales number

// How many trial seats are open on one date of one class.
//
// A trial is a visit to a single session; an enrolment is for the term. So a
// trial is never subtracted from what a paying family can buy (catalog_list's
// `remaining` is untouched, paid always wins), but a trial CAN fill the room
// on its own date, and CJ's rule (10 Sep 2026) is that it may not take a seat
// in a full class. The six-per-date ops cap and the room's real capacity
// reconcile as the smaller of the two.
//
//   trialsOnDate  booked trials already on that date
//   roomLeft      the public page's remaining figure for the listing:
//                   a number  -> that many paid seats are still open
//                   null      -> the listing has no capacity set, so the room
//                                does not limit trials, only the cap does
//                   undefined -> the listing is not for sale at all, so there
//                                is nothing to visit; treated as full
export function trialSeatsLeft(trialsOnDate, roomLeft, cap = FREE_SEATS_PER_DATE) {
  const byCap = cap - trialsOnDate;
  const byRoom = roomLeft === undefined ? 0
               : roomLeft === null      ? Infinity
               : roomLeft - trialsOnDate;
  return Math.max(0, Math.min(byCap, byRoom));
}

// Whether this child has already had their free visit, and what to tell the
// family if so. CJ, 10 Sep 2026: "a no show burns the free visit." CJ, 16 Sep
// 2026, revised: a family that misses its free class gets ONE more chance.
// The no-show follow-up email invites them to pick a new date, so a single
// no-show leaves the offer open and a second one closes it. A visit that was
// used, or that became an enrolment, is still the one visit. A visit still
// booked in the future does not count here; the per-class duplicate check
// handles that.
//
//   prior   the child's earlier bookings, any class: [{ status, class_date }]
//   returns null when a new booking is allowed, else the sentence to send
export const NO_SHOW_RESCHEDULES = 1;
export function freeVisitUsed(prior) {
  const by = (st) => prior.find((p) => p.status === st);
  if (by("converted"))
    return "This child is enrolled already, so the free visit is done. Register for another class at novapa.org/register.";
  if (by("attended"))
    return "This child has had their free class. Register at novapa.org/register, or email info@novapa.org if you want to try a different class first.";
  const noShows = prior.filter((p) => p.status === "no_show")
    .sort((a, b) => String(a.class_date).localeCompare(String(b.class_date)));
  if (noShows.length > NO_SHOW_RESCHEDULES) {
    const last = noShows[noShows.length - 1];
    return `This child's free visit was rescheduled once and the ${prettyDate(last.class_date)} class was not used either, so there is not another one. Register at novapa.org/register, or email info@novapa.org and we will help.`;
  }
  return null;
}
const VENUE = "National Conference Center, 18945 Conference Center Drive, Plaza C, Leesburg, VA 20176";
export const MANAGE_URL = "https://novapa.org/free-class/manage.html";

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

function todayEastern() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
function weekdayOf(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
// "5:00 PM" -> minutes since midnight
function timeToMinutes(t) {
  const m = String(t).match(/(\d+):(\d+)\s*(AM|PM)/i);
  let h = (+m[1]) % 12;
  if (/pm/i.test(m[3])) h += 12;
  return h * 60 + (+m[2]);
}
function nowEasternMinutes() {
  const p = new Intl.DateTimeFormat("en-US",
    { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" }).format(new Date());
  const [h, mm] = p.split(":").map(Number);
  return (h % 24) * 60 + mm;
}
// A session is bookable until CUTOFF_MINUTES before its Eastern start time.
// The season's closures, published on the classes, Teen Conservatory and
// Broadway Bound pages and drawn from calendar.html. Until Sep 16 2026 this
// function knew only the season bounds, so it would happily offer a family a
// trial visit on Thanksgiving Monday or in the middle of Winter Break, and
// nobody would have been in the building.
const CLOSED = [
  ["2026-11-22", "2026-11-28"],  // Thanksgiving Break
  ["2026-12-20", "2027-01-03"],  // Winter Break
  ["2027-03-22", "2027-03-26"],  // Spring Break
  ["2027-05-31", "2027-05-31"],  // Memorial Day
];
export function isClosed(dateIso) {
  return CLOSED.some(([a, b]) => dateIso >= a && dateIso <= b);
}

export function bookable(dateIso, timeStr) {
  const today = todayEastern();
  if (dateIso < SEASON_START || dateIso > SEASON_END) return false;
  if (isClosed(dateIso)) return false;
  if (dateIso > today) return true;
  if (dateIso < today) return false;
  return timeToMinutes(timeStr) - nowEasternMinutes() >= CUTOFF_MINUTES;
}
// The instant a class starts: its Eastern wall-clock time on that date,
// daylight saving included.
export function classStartsAt(dateIso, timeStr) {
  const guess = Date.parse(`${dateIso}T00:00:00Z`) + timeToMinutes(timeStr) * 60000;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour12: false, year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(guess));
  const g = (t) => +parts.find((p) => p.type === t).value;
  const local = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"));
  return new Date(guess + (guess - local));
}
// CJ, Sep 24 2026: a family can cancel for free until 24 hours before the
// class. After that the seat stands, and a no-show is charged the $30.
export function cancelDeadline(dateIso, timeStr) {
  return new Date(classStartsAt(dateIso, timeStr).getTime() - CANCEL_NOTICE_HOURS * 3600000);
}
export function canCancelFree(dateIso, timeStr, now = new Date()) {
  return now.getTime() <= cancelDeadline(dateIso, timeStr).getTime();
}
// "Monday, September 28 at 6:00 PM", for the deadline sentence
export function prettyDeadline(d) {
  return d.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "long",
    month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).replace(/, (\d{1,2}:\d{2})/, " at $1");
}

// next N bookable occurrences of `day`, clamped inside the season
function upcomingDates(day, time) {
  let start = todayEastern();
  if (start < SEASON_START) start = SEASON_START;
  const offset = (day - weekdayOf(start) + 7) % 7;
  let d = addDays(start, offset);
  const out = [];
  while (out.length < DATES_SHOWN && d <= SEASON_END) {
    if (bookable(d, time)) out.push(d);
    d = addDays(d, 7);
  }
  return out;
}

// Paid seats still open per listing, keyed by activity id, from the same
// function and the same arithmetic the public register page uses, so the two
// cannot disagree. A listing catalog_list does not return (retired, or hidden
// and not asked for) is absent from the map, which trialSeatsLeft reads as
// "nothing to visit". A listing that is listed but not currently bookable is
// mapped to 0 for the same reason: no sale, no trial.
async function paidSeatsLeft() {
  const ids = Object.values(CLASSES).map((c) => c.activityId);
  const rows = await db("POST", "rpc/catalog_list", { p_ids: ids });
  const out = {};
  for (const r of rows || []) out[r.id] = r.bookable ? r.remaining : 0;
  return out;
}

async function availability() {
  const [rows, room] = await Promise.all([
    db("GET", "v_free_class_trials?select=activity_id,class_date,trials"),
    paidSeatsLeft(),
  ]);
  const used = {};
  for (const r of rows) used[`${r.activity_id}|${r.class_date}`] = r.trials;
  return Object.entries(CLASSES).map(([key, c]) => ({
    key,
    // the weekly grid in register/classes.html joins trials to catalog_list()
    // rows on this, because name+day+time is not a stable key
    activity_id: c.activityId,
    name: c.name,
    ages: `${c.ages[0]}–${c.ages[1]}`,
    day: ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][c.day],
    time: c.time,
    dates: upcomingDates(c.day, c.time)
      .map((d) => ({ date: d, left: trialSeatsLeft(used[`${c.activityId}|${d}`] || 0, room[c.activityId]) })),
  }));
}

function prettyDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US",
    { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function confirmationHtml(b, cls) {
  const when = `${prettyDate(b.class_date)}, ${cls.time}`;
  return `<div style="background:#f5f2ec;padding:24px 12px;font-family:Georgia,'Times New Roman',serif;color:#1c2434">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff">
<tr><td style="background:#0F1E36;padding:26px 28px">
  <div style="color:#E8B84B;font-size:12px;letter-spacing:2px;font-family:Arial,sans-serif">NOVAPA</div>
  <div style="color:#ffffff;font-size:24px;margin-top:8px">${b.child_name}'s free class is booked.</div>
</td></tr>
<tr><td style="height:4px;background:#E8B84B"></td></tr>
<tr><td style="padding:26px 28px;font-size:15px;line-height:1.7">
  <p style="margin:0 0 16px">That seat is held for ${b.child_name} specifically. Here is everything you need.</p>
  <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:15px;line-height:1.8">
    <tr><td style="color:#888;padding-right:18px">Who</td><td><b>${b.child_name}</b></td></tr>
    <tr><td style="color:#888;padding-right:18px">Class</td><td><b>${cls.name}</b> (ages ${cls.ages[0]}&ndash;${cls.ages[1]})</td></tr>
    <tr><td style="color:#888;padding-right:18px">When</td><td><b>${when}</b></td></tr>
    <tr><td style="color:#888;padding-right:18px">Where</td><td>${VENUE}</td></tr>
  </table>
  <p style="margin:18px 0 0"><b>What to bring:</b> comfortable clothes your child can move in, sneakers, and a water bottle. Nothing else is needed. No preparation, no audition, no experience.</p>
  <p style="margin:16px 0 0">We are in the South Building at Plaza C. Park free in the south lot and take the walkway to the entrance. An instructor will greet ${b.child_name} by name.</p>
  <p style="margin:16px 0 0"><b>Two minutes before the day:</b> tell us your emergency contact and any allergies, and sign the release, at <a href="https://novapa.org/free-class/details.html?e=${encodeURIComponent(b.email)}&n=${encodeURIComponent(b.child_name)}" style="color:#C8892A;font-weight:700">novapa.org/free-class/details</a>. Check in takes seconds when this is done.</p>
${b.stripe_payment_method_id ? `  <p style="margin:16px 0 0"><b>Can't make it?</b> Cancel free until ${prettyDeadline(cancelDeadline(b.class_date, cls.time))} at <a href="${MANAGE_URL}?t=${b.link_token}" style="color:#C8892A;font-weight:700">novapa.org/free-class/manage</a>. The class is free, and your card is only charged the $30 no-show fee if ${b.child_name} doesn't come and the seat wasn't canceled by then. To move to a different date or class, reply to this email.</p>`
  : `  <p style="margin:16px 0 0">Life happens. If you need a different date or class, reply to this email and we will move the seat.</p>`}
  <div style="height:1px;background:#e5e5e5;margin:22px 0"></div>
  <p style="font-size:14px;color:#444;margin:0">Questions before the day? Call (571) 571-2120 or reply here. A person answers.</p>
</td></tr>
<tr><td style="padding:18px 28px 24px;background:#fafafa;color:#888;font-size:12px;line-height:1.6;font-family:Arial,sans-serif">
  Northern Virginia Performing Arts &middot; ${VENUE}
</td></tr>
</table></div>`;
}

// CJ, 16 Sep 2026: every booking confirmation comes from info@novapa.org,
// with cj@ and katieh@ blind-copied so the team sees each new family.
export const CONFIRM_FROM = "Northern Virginia Performing Arts <info@novapa.org>";
export const CONFIRM_REPLY_TO = "info@novapa.org";
export const CONFIRM_BCC = ["cj@novapa.org", "katieh@novapa.org"];

async function sendConfirmation(b, cls) {
  if (!process.env.SMTP_USER || !(process.env.SMTP_PASS || process.env.RESEND_API_KEY)) return;
  const { default: nodemailer } = await import("nodemailer");
  // env-driven transport, same as reg-email.mjs (Resend since Sep 2026)
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com", port: 465, secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || process.env.RESEND_API_KEY },
  });
  await transporter.sendMail({
    from: CONFIRM_FROM,
    replyTo: CONFIRM_REPLY_TO,
    to: b.email,
    bcc: CONFIRM_BCC.join(", "),
    subject: `${b.child_name}'s free class is booked`,
    html: confirmationHtml(b, cls),
  });
}

// A confirmation that never sent has to leave a trace someone will see: a
// note on the booking for whoever opens the roster, and mail to the team so
// it is chased today rather than discovered by the parent.
async function noteSendFailure(b, err) {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  await db("PATCH", `free_class_bookings?id=eq.${b.id}`, {
    notes: [b.notes, `[${stamp}] confirmation email FAILED to ${b.email}: ${String(err.message).slice(0, 140)}`]
      .filter(Boolean).join("\n"),
  });
  if (!process.env.SMTP_USER || !(process.env.SMTP_PASS || process.env.RESEND_API_KEY)) return;
  const admins = await db("GET", "admin_emails?select=email")
    .then((rows) => (rows || []).map((r) => r.email).filter(Boolean))
    .catch(() => []);
  if (!admins.length) return;
  const { default: nodemailer } = await import("nodemailer");
  await nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com", port: 465, secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || process.env.RESEND_API_KEY },
  }).sendMail({
    from: `NOVAPA <${process.env.FROM_ADDR || process.env.SMTP_USER}>`,
    to: admins.join(", "),
    replyTo: "info@novapa.org",
    subject: `Free class confirmation did NOT send: ${b.child_name}`,
    html: `<p><b>${b.child_name}</b> has a free class seat on ${prettyDate(b.class_date)}, `
      + `but the confirmation to <b>${b.email}</b> failed twice.</p>`
      + `<p>The seat is held. Please send the details by hand today.</p>`
      + `<p style="color:#888;font-size:12px">${String(err.message).slice(0, 200)}</p>`,
  });
}

// ── The card on file ─────────────────────────────────────────────────────────
// A SetupIntent for the booking page: a new Stripe customer for this email,
// card and Link only (Apple Pay and Google Pay ride the card rails through the
// Express Checkout element, the same as the register page), saved for charges
// made later without the family present. No money moves.
async function saveCardIntent(body) {
  if (!cardRequired()) return Response.json({ error: "The card step is off." }, { status: 409 });
  const email = String(body.email || "").trim().toLowerCase();
  const parent = String(body.parent_name || "").trim().slice(0, 120);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "A valid email is required" }, { status: 400 });
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const customer = await stripe.customers.create({
      email, name: parent || undefined, metadata: { source: "novapa-free-class" },
    });
    const si = await stripe.setupIntents.create({
      customer: customer.id,
      usage: "off_session",
      payment_method_types: ["card", "link"],
      description: "NOVAPA free class: card on file for the $30 no-show fee and enrollment",
      metadata: { source: "free-class", email },
    });
    return Response.json({ client_secret: si.client_secret });
  } catch (e) {
    console.error("reg-freeclass card", e.message);
    return Response.json({ error: "We couldn't open the card form. Refresh, or call (571) 571-2120." }, { status: 500 });
  }
}

// The SetupIntent the page says it confirmed: it must be one this endpoint
// made (metadata.source), for this email, and actually succeeded. Returns
// { customer, pm } or null.
async function verifiedCard(siId, email) {
  if (!/^seti_[A-Za-z0-9]+$/.test(siId)) return null;
  try {
    const si = await new Stripe(process.env.STRIPE_SECRET_KEY).setupIntents.retrieve(siId);
    const m = si.metadata || {};
    if (si.status !== "succeeded" || m.source !== "free-class" || m.email !== email) return null;
    const pm = typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id;
    const customer = typeof si.customer === "string" ? si.customer : si.customer?.id;
    return pm && customer ? { pm, customer } : null;
  } catch (e) {
    console.error("reg-freeclass verify card", e.message);
    return null;
  }
}

const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// novapa.org/free-class/manage?t=<link_token>: what the booking is, and a
// free cancel while the class is 24 or more hours away. Inside 24 hours the
// page says the seat stands and how to reach a person; nothing here charges.
async function manage(body) {
  const token = String(body.token || "");
  if (!TOKEN_RE.test(token)) return Response.json({ error: "That link isn't right. Use the one in your confirmation email." }, { status: 404 });
  try {
    const rows = await db("GET", `free_class_bookings?link_token=eq.${token}&select=id,status,child_name,cast_key,class_date,stripe_payment_method_id`);
    const b = rows && rows[0];
    const cls = b && CLASSES[b.cast_key];
    if (!b || !cls) return Response.json({ error: "We couldn't find that booking. Reply to your confirmation email and we'll sort it." }, { status: 404 });
    const deadline = cancelDeadline(b.class_date, cls.time);
    const view = () => ({
      child_name: b.child_name, status: b.status,
      class_label: `${cls.name} (ages ${cls.ages[0]}–${cls.ages[1]})`,
      when: `${prettyDate(b.class_date)}, ${cls.time}`,
      deadline: prettyDeadline(deadline),
      can_cancel: b.status === "booked" && canCancelFree(b.class_date, cls.time),
      card_on_file: !!b.stripe_payment_method_id,
    });
    if (body.action === "manage") return Response.json({ ok: true, booking: view() });

    if (b.status === "cancelled") return Response.json({ ok: true, booking: view() });
    if (b.status !== "booked")
      return Response.json({ error: "This visit has already happened, so there's nothing to cancel." }, { status: 409 });
    if (!canCancelFree(b.class_date, cls.time))
      return Response.json({ error: `Free cancellation closed ${prettyDeadline(deadline)}. Call (571) 571-2120 or reply to your confirmation email.` }, { status: 409 });
    // status=eq.booked in the filter: a teacher's mark landing in the same
    // moment wins, and this PATCH updates nothing.
    const upd = await db("PATCH", `free_class_bookings?id=eq.${b.id}&status=eq.booked`,
      { status: "cancelled", cancelled_at: new Date().toISOString() });
    if (!upd || !upd.length) return Response.json({ error: "This booking just changed. Refresh the page." }, { status: 409 });
    b.status = "cancelled";
    return Response.json({ ok: true, booking: view() });
  } catch (e) {
    console.error("reg-freeclass manage", e.message);
    return Response.json({ error: "server error" }, { status: 500 });
  }
}

// What free-class/enroll.html shows before the parent presses Enroll: the
// family, each visit the link names, and which card will be charged. The
// tokens come from CJ's after-class note, one per child and class in it.
async function enrollInfo(body) {
  const tokens = [...new Set((Array.isArray(body.tokens) ? body.tokens : []).map(String))].filter((t) => TOKEN_RE.test(t)).slice(0, 6);
  if (!tokens.length) return Response.json({ error: "That link isn't right. Use the one in your email." }, { status: 404 });
  try {
    const rows = await db("GET",
      `free_class_bookings?link_token=in.(${tokens.join(",")})&select=parent_name,email,child_name,cast_key,activity_id,status,stripe_payment_method_id`);
    if (!rows || rows.length !== tokens.length || new Set(rows.map((r) => r.email)).size !== 1)
      return Response.json({ error: "We couldn't find that visit. Reply to the email and we'll enroll you by hand." }, { status: 404 });
    let card = null;
    const pm = rows[0].stripe_payment_method_id;
    if (pm && rows.every((r) => r.stripe_payment_method_id === pm)) {
      try {
        const p = await new Stripe(process.env.STRIPE_SECRET_KEY).paymentMethods.retrieve(pm);
        card = p.card ? { brand: p.card.brand, last4: p.card.last4, wallet: p.card.wallet?.type || null }
             : p.type === "link" ? { brand: "link", last4: null, wallet: null } : { brand: p.type, last4: null, wallet: null };
      } catch (e) { console.error("enroll_info card", e.message); }
    }
    return Response.json({
      ok: true,
      parent_name: rows[0].parent_name, email: rows[0].email, card,
      visits: rows.map((r) => ({
        child_name: r.child_name, activity_id: r.activity_id, status: r.status,
        class_label: CLASSES[r.cast_key] ? `${CLASSES[r.cast_key].name} (ages ${CLASSES[r.cast_key].ages[0]}–${CLASSES[r.cast_key].ages[1]})` : "the class",
        when: CLASSES[r.cast_key] ? `${["Sundays","Mondays","Tuesdays","Wednesdays","Thursdays","Fridays","Saturdays"][CLASSES[r.cast_key].day]} at ${CLASSES[r.cast_key].time}` : "",
      })),
    });
  } catch (e) {
    console.error("reg-freeclass enroll_info", e.message);
    return Response.json({ error: "server error" }, { status: 500 });
  }
}

export default async (req) => {
  if (req.method === "GET") {
    try {
      return Response.json({ classes: await availability(), venue: VENUE, booking_cutoff_minutes: CUTOFF_MINUTES,
        card_required: cardRequired(), no_show_fee_cents: NO_SHOW_FEE_CENTS, cancel_notice_hours: CANCEL_NOTICE_HOURS });
    } catch (e) {
      console.error("reg-freeclass GET", e);
      return Response.json({ error: "server error" }, { status: 500 });
    }
  }
  if (req.method !== "POST") return new Response("GET or POST", { status: 405 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }

  // "Before the day" details: emergency contact, allergies, waiver agreement.
  // Attached to the booked row; check-in needs these before the visit.
  if (body.action === "details") {
    const email = String(body.email || "").trim().toLowerCase();
    const child = String(body.child_name || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !child)
      return Response.json({ error: "We could not match your booking. Use the link from your confirmation email." }, { status: 400 });
    if (body.agreed !== true)
      return Response.json({ error: "The agreement checkbox is required." }, { status: 400 });
    const details = {
      emergency_name: String(body.emergency_name || "").trim().slice(0, 120),
      emergency_phone: String(body.emergency_phone || "").trim().slice(0, 40),
      allergies: String(body.allergies || "").trim().slice(0, 400) || "None",
      epipen: body.epipen === true,
      agreed_terms_photo_release: true,
      agreed_at: new Date().toISOString(),
    };
    if (!details.emergency_name || !details.emergency_phone)
      return Response.json({ error: "Emergency contact name and phone are required." }, { status: 400 });
    try {
      const rows = await db("PATCH",
        `free_class_bookings?status=eq.booked&email=eq.${encodeURIComponent(email)}&child_name=ilike.${encodeURIComponent(child)}`,
        { notes: JSON.stringify(details) });
      if (!rows || !rows.length)
        return Response.json({ error: "We could not find a booking for that email and name. Reply to your confirmation email and we will sort it." }, { status: 404 });
      return Response.json({ ok: true });
    } catch (e) {
      console.error("reg-freeclass details", e);
      return Response.json({ error: "server error" }, { status: 500 });
    }
  }

  if (body.action === "card") return saveCardIntent(body);
  if (body.action === "manage" || body.action === "cancel") return manage(body);
  if (body.action === "enroll_info") return enrollInfo(body);

  const parent = String(body.parent_name || "").trim().slice(0, 120);
  const email = String(body.email || "").trim().toLowerCase();
  const phone = String(body.phone || "").trim().slice(0, 40);
  const child = String(body.child_name || "").trim().slice(0, 120);
  const age = Number(body.child_age);
  const clsKey = String(body["class"] || body.cast || "");
  const date = String(body.date || "").slice(0, 10);
  const cls = CLASSES[clsKey];

  if (!parent) return Response.json({ error: "Your name is required" }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200)
    return Response.json({ error: "A valid email is required" }, { status: 400 });
  if (!child) return Response.json({ error: "Your child's first name is required" }, { status: 400 });
  if (!cls) return Response.json({ error: "Pick a class" }, { status: 400 });
  if (!Number.isInteger(age) || age < cls.ages[0] || age > cls.ages[1])
    return Response.json({ error: `${cls.name} is for ages ${cls.ages[0]}–${cls.ages[1]}. Pick a class that matches your child's age.` }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || weekdayOf(date) !== cls.day)
    return Response.json({ error: "Pick a date" }, { status: 400 });
  if (!bookable(date, cls.time))
    return Response.json({ error: "That class has already started or starts within the hour. Pick the next date." }, { status: 400 });

  // Not a user error. A catalogue entry added without its listing id would
  // otherwise write a booking attached to no class, which is the bug this
  // whole change exists to remove. Refuse the booking instead, loudly.
  if (!Number.isInteger(cls.activityId) || cls.activityId <= 0) {
    console.error(`reg-freeclass: CLASSES["${clsKey}"] has no activityId`);
    return Response.json({ error: "That class is not bookable right now. Email info@novapa.org and we will book it for you." }, { status: 500 });
  }

  try {
    // One free visit per child. Asked before the seat arithmetic, because a
    // family that has used theirs should hear that, not "that date is full".
    const prior = await db("GET",
      `free_class_bookings?email=eq.${encodeURIComponent(email)}&child_name=ilike.${encodeURIComponent(child)}&status=in.(no_show,attended,converted)&select=status,class_date`);
    const used = freeVisitUsed(prior || []);
    if (used) return Response.json({ error: used }, { status: 409 });

    const existing = await db("GET",
      `free_class_bookings?status=eq.booked&cast_key=eq.${clsKey}&class_date=eq.${date}&select=id,email,child_name`);
    if (existing.some((r) => r.email === email && r.child_name.toLowerCase() === child.toLowerCase()))
      return Response.json({ error: "This child already has a seat in that class. Check your inbox." }, { status: 409 });
    const room = (await paidSeatsLeft())[cls.activityId];
    if (trialSeatsLeft(existing.length, room) <= 0) {
      // Say which limit was hit. A full class is not going to open up next
      // week, so send that family to the waitlist rather than another date.
      const classFull = room === undefined || (room !== null && room - existing.length <= 0);
      return Response.json({
        error: classFull
          ? "That class is full, so there is no seat to visit. Pick another class, or join the waitlist at novapa.org/register."
          : "That date just filled for this class. Pick another.",
      }, { status: 409 });
    }

    // The card step runs between these checks and the booking, so the page
    // asks first and a family never types a card for a seat it cannot have.
    if (body.action === "precheck") return Response.json({ ok: true, card_required: cardRequired() });

    // The saved card. The page confirmed a SetupIntent this endpoint minted
    // for this same email; the booking takes its customer and card. Without
    // one, and with the card step on, there is no booking.
    let card = null;
    if (cardRequired()) {
      card = await verifiedCard(String(body.setup_intent || ""), email);
      if (!card) return Response.json({ error: "We couldn't confirm your card. Enter it again, or call (571) 571-2120." }, { status: 402 });
    }

    const utm = body.utm && typeof body.utm === "object"
      ? Object.fromEntries(Object.entries(body.utm).slice(0, 8).map(([k, v]) => [String(k).slice(0, 40), String(v).slice(0, 120)]))
      : null;

    const row = {
      parent_name: parent, email, phone: phone || null, child_name: child,
      child_age: age, cast_key: clsKey, activity_id: cls.activityId,
      class_date: date, utm,
    };
    const rows = await db("POST", "free_class_bookings", card ? {
      ...row,
      stripe_customer_id: card.customer, stripe_payment_method_id: card.pm,
      card_saved_at: new Date().toISOString(),
    } : row);
    const booking = rows[0];

    // Joy Roque booked Semira at 6:05 and Pio at 6:06 on 11 Sep 2026 and only
    // Pio's confirmation arrived. Both seats were held correctly; one Gmail
    // send just failed, and this catch swallowed it — the booking returned ok,
    // the parent got nothing, and nobody knew until she emailed in. A seat a
    // family cannot see is the same to them as no seat. Retry once, then make
    // the failure visible instead of silent.
    try {
      await sendConfirmation(booking, cls);
    } catch (first) {
      console.error("freeclass email failed, retrying:", first.message);
      try {
        await new Promise((r) => setTimeout(r, 1500));
        await sendConfirmation(booking, cls);
      } catch (e) {
        console.error("freeclass email failed twice:", e.message);
        await noteSendFailure(booking, e).catch((n) =>
          console.error("freeclass: could not record the failed send:", n.message));
      }
    }

    return Response.json({
      ok: true,
      booking: {
        child_name: booking.child_name,
        date, pretty_date: prettyDate(date),
        "class": clsKey, class_label: `${cls.name} (ages ${cls.ages[0]}–${cls.ages[1]})`, time: cls.time,
      },
    });
  } catch (e) {
    console.error("reg-freeclass POST", e);
    return Response.json({ error: "server error" }, { status: 500 });
  }
};

export const config = { path: "/api/reg-freeclass" };
