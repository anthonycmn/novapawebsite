// Free class funnel — /api/reg-freeclass (novapa.org/free-class, Aug 2026)
//   GET  -> { casts: [{ key, label, ages, day, time, dates: [{ date, left }] }] }
//   POST { parent_name, email, phone, child_name, child_age, cast, date, utm }
//        -> { ok, booking } and sends the confirmation email.
//
// A "free day" is a real seat in a real fall rehearsal, so the dates here are
// the actual September rehearsal nights per cast, not a marketing calendar.
// Writes go to free_class_bookings (RLS closed, service role only).

const SUPABASE_URL = "https://tlkuqwsqicxcjdmumkje.supabase.co";

// Verified against be-in-frozen.html and the activities catalog (Aug 26 2026).
const CASTS = {
  kids:  { label: "Frozen Kids",  ages: [5, 9],   day: "Wednesday", time: "5:15 – 6:45 PM", activity_id: 1959789, dates: ["2026-09-16", "2026-09-23", "2026-09-30"] },
  jr:    { label: "Frozen JR.",   ages: [9, 12],  day: "Tuesday",   time: "6:15 – 7:45 PM", activity_id: 1959787, dates: ["2026-09-15", "2026-09-22", "2026-09-29"] },
  teens: { label: "Frozen Teens", ages: [12, 17], day: "Wednesday", time: "7:00 – 9:00 PM", activity_id: 1959805, dates: ["2026-09-16", "2026-09-23", "2026-09-30"] },
};
// Free visitors we will seat per cast per night. Ops cap, not a sales number.
const FREE_SEATS_PER_NIGHT = 12;
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

async function availability() {
  const today = todayEastern();
  const rows = await db("GET",
    "free_class_bookings?status=eq.booked&select=cast_key,class_date");
  const used = {};
  for (const r of rows) used[`${r.cast_key}|${r.class_date}`] = (used[`${r.cast_key}|${r.class_date}`] || 0) + 1;
  return Object.entries(CASTS).map(([key, c]) => ({
    key,
    label: c.label,
    ages: `${c.ages[0]}–${c.ages[1]}`,
    day: c.day,
    time: c.time,
    dates: c.dates
      .filter((d) => d > today)
      .map((d) => ({ date: d, left: Math.max(0, FREE_SEATS_PER_NIGHT - (used[`${key}|${d}`] || 0)) })),
  }));
}

function prettyDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US",
    { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function confirmationHtml(b, cast) {
  const when = `${prettyDate(b.class_date)}, ${cast.time}`;
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
    <tr><td style="color:#888;padding-right:18px">Who</td><td><b>${b.child_name}</b> (${cast.label}, ages ${cast.ages[0]}&ndash;${cast.ages[1]})</td></tr>
    <tr><td style="color:#888;padding-right:18px">When</td><td><b>${when}</b></td></tr>
    <tr><td style="color:#888;padding-right:18px">Where</td><td>${VENUE}</td></tr>
  </table>
  <p style="margin:18px 0 0"><b>What to bring:</b> comfortable clothes your child can move in, sneakers, and a water bottle. Nothing else is needed. No preparation, no audition, no experience.</p>
  <p style="margin:16px 0 0">We are in the South Building at Plaza C. Park free in the south lot and take the walkway to the entrance. An instructor will greet ${b.child_name} by name.</p>
  <p style="margin:16px 0 0">Life happens. If you need a different date, reply to this email and we will move the seat.</p>
  <div style="height:1px;background:#e5e5e5;margin:22px 0"></div>
  <p style="font-size:14px;color:#444;margin:0">Questions before the day? Call (571) 571-2120 or reply here. A person answers.</p>
</td></tr>
<tr><td style="padding:18px 28px 24px;background:#fafafa;color:#888;font-size:12px;line-height:1.6;font-family:Arial,sans-serif">
  Northern Virginia Performing Arts &middot; ${VENUE}
</td></tr>
</table></div>`;
}

async function sendConfirmation(b, cast) {
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
    html: confirmationHtml(b, cast),
  });
}

export default async (req) => {
  if (req.method === "GET") {
    try {
      return Response.json({ casts: await availability(), venue: VENUE });
    } catch (e) {
      console.error("reg-freeclass GET", e);
      return Response.json({ error: "server error" }, { status: 500 });
    }
  }
  if (req.method !== "POST") return new Response("GET or POST", { status: 405 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }

  const parent = String(body.parent_name || "").trim().slice(0, 120);
  const email = String(body.email || "").trim().toLowerCase();
  const phone = String(body.phone || "").trim().slice(0, 40);
  const child = String(body.child_name || "").trim().slice(0, 120);
  const age = Number(body.child_age);
  const castKey = String(body.cast || "");
  const date = String(body.date || "").slice(0, 10);
  const cast = CASTS[castKey];

  if (!parent) return Response.json({ error: "Your name is required" }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200)
    return Response.json({ error: "A valid email is required" }, { status: 400 });
  if (!child) return Response.json({ error: "Your child's first name is required" }, { status: 400 });
  if (!cast) return Response.json({ error: "Pick a class" }, { status: 400 });
  if (!Number.isInteger(age) || age < cast.ages[0] || age > cast.ages[1])
    return Response.json({ error: `${cast.label} is for ages ${cast.ages[0]}–${cast.ages[1]}. Pick the class that matches your child's age.` }, { status: 400 });
  if (!cast.dates.includes(date)) return Response.json({ error: "Pick a date" }, { status: 400 });
  if (date <= todayEastern()) return Response.json({ error: "That date has passed. Pick an upcoming one." }, { status: 400 });

  try {
    const existing = await db("GET",
      `free_class_bookings?status=eq.booked&cast_key=eq.${castKey}&class_date=eq.${date}&select=id,email,child_name`);
    if (existing.some((r) => r.email === email && r.child_name.toLowerCase() === child.toLowerCase()))
      return Response.json({ error: "This child already has a seat on that date. Check your inbox." }, { status: 409 });
    if (existing.length >= FREE_SEATS_PER_NIGHT)
      return Response.json({ error: "That night just filled. Pick another date." }, { status: 409 });

    const utm = body.utm && typeof body.utm === "object"
      ? Object.fromEntries(Object.entries(body.utm).slice(0, 8).map(([k, v]) => [String(k).slice(0, 40), String(v).slice(0, 120)]))
      : null;

    const rows = await db("POST", "free_class_bookings", {
      parent_name: parent, email, phone: phone || null, child_name: child,
      child_age: age, cast_key: castKey, activity_id: cast.activity_id,
      class_date: date, utm,
    });
    const booking = rows[0];

    try { await sendConfirmation(booking, cast); }
    catch (e) { console.error("freeclass email failed:", e.message); }

    return Response.json({
      ok: true,
      booking: {
        child_name: booking.child_name,
        date, pretty_date: prettyDate(date),
        cast: castKey, cast_label: cast.label, time: cast.time,
      },
    });
  } catch (e) {
    console.error("reg-freeclass POST", e);
    return Response.json({ error: "server error" }, { status: 500 });
  }
};

export const config = { path: "/api/reg-freeclass" };
