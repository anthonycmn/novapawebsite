// Free class funnel — /api/reg-freeclass (novapa.org/free-class)
//   GET  -> { classes: [{ key, name, ages, day, time, dates: [{ date, left }] }] }
//   POST { parent_name, email, phone, child_name, child_age, class, date, utm }
//        -> { ok, booking } and sends the confirmation email.
//
// Jason (Aug 26 2026): the free pass is for the real weekly CLASSES, any
// class on the schedule, booked 7 or more days out. The catalog mirrors
// classes.html (September–June season, $90/month per class — price never
// shown here, the visit is free). Writes go to free_class_bookings
// (RLS closed, service role only).

const SUPABASE_URL = "https://tlkuqwsqicxcjdmumkje.supabase.co";

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
  "hs-mt":             { activityId: 1962566, name: "Homeschool Musical Theatre",            ages: [9, 13],  day: 3, time: "1:00 PM" },
  "hs-theatre":        { activityId: 1962567, name: "Homeschool Theatre",                    ages: [9, 13],  day: 3, time: "2:00 PM" },
  "acting-9-12":       { activityId: 1960936, name: "Acting",                                ages: [9, 12],  day: 3, time: "5:15 PM" },
  "mt-dance-9-12":     { activityId: 1960939, name: "Musical Theatre Dance",                 ages: [9, 12],  day: 3, time: "6:15 PM" },
  "mt-acting-9-12":    { activityId: 1960945, name: "Musical Theatre Acting",                ages: [9, 12],  day: 3, time: "7:15 PM" },
  "improv-9-12":       { activityId: 1960959, name: "Improv for Actors",                     ages: [9, 12],  day: 4, time: "6:30 PM" },
  "improv-13-17":      { activityId: 1960961, name: "Improv for Actors",                     ages: [13, 17], day: 4, time: "7:30 PM" },
  "acting-mt-sat":     { activityId: 1962562, name: "Acting & Musical Theatre",              ages: [9, 12],  day: 6, time: "12:00 PM" },
};
// Exported for the tests and the preflight live check, nothing else reads it.
export { CLASSES };

const MIN_DAYS_OUT = 2;    // 48 hours (CJ, Sep 10 2026; was 7 per Jason Aug 26).
// The SEASON_START floor below is what stops pre-season dates being offered,
// not this number, so shortening the notice does not reopen the Sep 8 bug.
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
// family if so. CJ, 10 Sep 2026: "a no show burns the free visit." The offer is
// a first class free, singular: a visit that was used, or booked and skipped,
// or that became an enrolment, is the one visit. A visit still booked in the
// future does not count here; the per-class duplicate check handles that.
//
//   prior   the child's earlier bookings, any class: [{ status, class_date }]
//   returns null when a new booking is allowed, else the sentence to send
export function freeVisitUsed(prior) {
  const by = (st) => prior.find((p) => p.status === st);
  const noShow = by("no_show");
  if (noShow)
    return `This child's free visit was booked for ${prettyDate(noShow.class_date)} and not used, so there is not another one. Register at novapa.org/register, or email info@novapa.org and we will help.`;
  if (by("converted"))
    return "This child is enrolled already, so the free visit is done. Register for another class at novapa.org/register.";
  if (by("attended"))
    return "This child has had their free class. Register at novapa.org/register, or email info@novapa.org if you want to try a different class first.";
  return null;
}
const VENUE = "National Conference Center, 18945 Conference Center Drive, Plaza C, Leesburg, VA 20176";

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
// next N occurrences of `day` that are at least MIN_DAYS_OUT days from today,
// clamped inside the season
function upcomingDates(day) {
  let start = addDays(todayEastern(), MIN_DAYS_OUT);
  if (start < SEASON_START) start = SEASON_START;
  const offset = (day - weekdayOf(start) + 7) % 7;
  let d = addDays(start, offset);
  const out = [];
  while (out.length < DATES_SHOWN && d <= SEASON_END) { out.push(d); d = addDays(d, 7); }
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
    name: c.name,
    ages: `${c.ages[0]}–${c.ages[1]}`,
    day: ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][c.day],
    time: c.time,
    dates: upcomingDates(c.day)
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
  <p style="margin:16px 0 0">Life happens. If you need a different date or class, reply to this email and we will move the seat.</p>
  <div style="height:1px;background:#e5e5e5;margin:22px 0"></div>
  <p style="font-size:14px;color:#444;margin:0">Questions before the day? Call (571) 571-2120 or reply here. A person answers.</p>
</td></tr>
<tr><td style="padding:18px 28px 24px;background:#fafafa;color:#888;font-size:12px;line-height:1.6;font-family:Arial,sans-serif">
  Northern Virginia Performing Arts &middot; ${VENUE}
</td></tr>
</table></div>`;
}

async function sendConfirmation(b, cls) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return;
  const { default: nodemailer } = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transporter.sendMail({
    from: `NOVAPA <${process.env.SMTP_USER}>`,
    replyTo: "info@novapa.org",
    to: b.email,
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
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return;
  const admins = await db("GET", "admin_emails?select=email")
    .then((rows) => (rows || []).map((r) => r.email).filter(Boolean))
    .catch(() => []);
  if (!admins.length) return;
  const { default: nodemailer } = await import("nodemailer");
  await nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  }).sendMail({
    from: `NOVAPA <${process.env.SMTP_USER}>`,
    to: admins.join(", "),
    replyTo: "info@novapa.org",
    subject: `Free class confirmation did NOT send: ${b.child_name}`,
    html: `<p><b>${b.child_name}</b> has a free class seat on ${prettyDate(b.class_date)}, `
      + `but the confirmation to <b>${b.email}</b> failed twice.</p>`
      + `<p>The seat is held. Please send the details by hand today.</p>`
      + `<p style="color:#888;font-size:12px">${String(err.message).slice(0, 200)}</p>`,
  });
}

export default async (req) => {
  if (req.method === "GET") {
    try {
      return Response.json({ classes: await availability(), venue: VENUE, min_days_out: MIN_DAYS_OUT });
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
  if (date < addDays(todayEastern(), MIN_DAYS_OUT))
    return Response.json({ error: `Free classes are booked ${MIN_DAYS_OUT} or more days ahead. Pick a later date.` }, { status: 400 });

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

    const utm = body.utm && typeof body.utm === "object"
      ? Object.fromEntries(Object.entries(body.utm).slice(0, 8).map(([k, v]) => [String(k).slice(0, 40), String(v).slice(0, 120)]))
      : null;

    const rows = await db("POST", "free_class_bookings", {
      parent_name: parent, email, phone: phone || null, child_name: child,
      child_age: age, cast_key: clsKey, activity_id: cls.activityId,
      class_date: date, utm,
    });
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
