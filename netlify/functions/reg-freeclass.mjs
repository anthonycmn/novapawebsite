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
const CLASSES = {
  "acting-5-8":        { name: "Acting",                                ages: [5, 8],   day: 1, time: "6:00 PM" },
  "triple-threat":     { name: "Triple Threat Musical Theatre Training", ages: [13, 17], day: 1, time: "7:00 PM" },
  "mt-5-8":            { name: "Musical Theatre",                       ages: [5, 8],   day: 2, time: "5:00 PM" },
  "mt-dance-13-17":    { name: "Musical Theatre Dance",                 ages: [13, 17], day: 2, time: "7:00 PM" },
  "mt-acting-13-17":   { name: "Musical Theatre Acting",                ages: [13, 17], day: 2, time: "8:00 PM" },
  "hs-mt":             { name: "Homeschool Musical Theatre",            ages: [9, 13],  day: 3, time: "1:00 PM" },
  "hs-theatre":        { name: "Homeschool Theatre",                    ages: [9, 13],  day: 3, time: "2:00 PM" },
  "acting-9-12":       { name: "Acting",                                ages: [9, 12],  day: 3, time: "5:15 PM" },
  "mt-dance-9-12":     { name: "Musical Theatre Dance",                 ages: [9, 12],  day: 3, time: "6:15 PM" },
  "mt-acting-9-12":    { name: "Musical Theatre Acting",                ages: [9, 12],  day: 3, time: "7:15 PM" },
  "improv-9-12":       { name: "Improv for Actors",                     ages: [9, 12],  day: 4, time: "6:30 PM" },
  "improv-13-17":      { name: "Improv for Actors",                     ages: [13, 17], day: 4, time: "7:30 PM" },
  "acting-mt-sat":     { name: "Acting & Musical Theatre",              ages: [9, 12],  day: 6, time: "12:00 PM" },
};
const MIN_DAYS_OUT = 7;    // Jason: bookable only 7+ days ahead
const DATES_SHOWN = 3;     // next N valid dates per class
const FREE_SEATS_PER_DATE = 6;  // ops cap per class per date, not a sales number
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
// next N occurrences of `day` that are at least MIN_DAYS_OUT days from today
function upcomingDates(day) {
  const start = addDays(todayEastern(), MIN_DAYS_OUT);
  const offset = (day - weekdayOf(start) + 7) % 7;
  let d = addDays(start, offset);
  const out = [];
  while (out.length < DATES_SHOWN) { out.push(d); d = addDays(d, 7); }
  return out;
}

async function availability() {
  const rows = await db("GET",
    "free_class_bookings?status=eq.booked&select=cast_key,class_date");
  const used = {};
  for (const r of rows) used[`${r.cast_key}|${r.class_date}`] = (used[`${r.cast_key}|${r.class_date}`] || 0) + 1;
  return Object.entries(CLASSES).map(([key, c]) => ({
    key,
    name: c.name,
    ages: `${c.ages[0]}–${c.ages[1]}`,
    day: ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][c.day],
    time: c.time,
    dates: upcomingDates(c.day)
      .map((d) => ({ date: d, left: Math.max(0, FREE_SEATS_PER_DATE - (used[`${key}|${d}`] || 0)) })),
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

  try {
    const existing = await db("GET",
      `free_class_bookings?status=eq.booked&cast_key=eq.${clsKey}&class_date=eq.${date}&select=id,email,child_name`);
    if (existing.some((r) => r.email === email && r.child_name.toLowerCase() === child.toLowerCase()))
      return Response.json({ error: "This child already has a seat in that class. Check your inbox." }, { status: 409 });
    if (existing.length >= FREE_SEATS_PER_DATE)
      return Response.json({ error: "That date just filled for this class. Pick another." }, { status: 409 });

    const utm = body.utm && typeof body.utm === "object"
      ? Object.fromEntries(Object.entries(body.utm).slice(0, 8).map(([k, v]) => [String(k).slice(0, 40), String(v).slice(0, 120)]))
      : null;

    const rows = await db("POST", "free_class_bookings", {
      parent_name: parent, email, phone: phone || null, child_name: child,
      child_age: age, cast_key: clsKey, activity_id: 0,
      class_date: date, utm,
    });
    const booking = rows[0];

    try { await sendConfirmation(booking, cls); }
    catch (e) { console.error("freeclass email failed:", e.message); }

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
