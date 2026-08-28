// Hold the slot, then hand the family to Stripe.
// POST /api/lessons/checkout
//
// The price is recomputed here from the store — the browser's number is never
// trusted. The hold is placed *before* the Stripe session is created and torn
// down if that call fails, so a slot is never stranded.

import Stripe from "stripe";
import { quoteForCheckout } from "../lib/lessons-availability.mjs";
import {
  CHECKOUT_MINUTES,
  MODES,
  SESSION_MINUTES,
  dayName,
  prettyDate,
  prettyTime,
} from "../lib/lessons-config.mjs";
import { claimSlot, linkStripeSession, releaseClaim, saveBooking } from "../lib/lessons-store.mjs";

const MAX_FIELD = 120;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 12;
const rateBuckets = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.start > RATE_WINDOW_MS) {
    rateBuckets.set(ip, { start: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_MAX;
}

function clean(value) {
  return typeof value === "string" ? value.trim().slice(0, MAX_FIELD) : "";
}

export default async (req, context) => {
  if (req.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return Response.json({ error: "payments_not_configured" }, { status: 503 });
  }

  const ip = context.ip || req.headers.get("x-nf-client-connection-ip") || "unknown";
  if (rateLimited(ip)) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }

  const teacherId = clean(body.teacherId);
  const planId = clean(body.planId);
  const time = clean(body.time);
  const day = Number(body.day);
  const mode = clean(body.mode);

  const contact = {
    parentName: clean(body.parentName),
    email: clean(body.email).toLowerCase(),
    phone: clean(body.phone),
    studentName: clean(body.studentName),
    studentAge: clean(body.studentAge),
    notes: typeof body.notes === "string" ? body.notes.trim().slice(0, 600) : "",
  };

  if (!Number.isInteger(day) || day < 0 || day > 6) {
    return Response.json({ error: "bad_day" }, { status: 400 });
  }
  if (!contact.parentName || !contact.studentName) {
    return Response.json({ error: "missing_name" }, { status: 400 });
  }
  if (!EMAIL_RE.test(contact.email)) {
    return Response.json({ error: "bad_email" }, { status: 400 });
  }
  if (!MODES.some((m) => m.id === mode)) {
    return Response.json({ error: "bad_mode" }, { status: 400 });
  }

  const now = new Date();
  const resolved = await quoteForCheckout({ teacherId, day, time, planId, now });
  if (resolved.error) {
    return Response.json({ error: resolved.error }, { status: 409 });
  }
  const { teacher, plan, slotKey: key, quote } = resolved;

  if (!teacher.modes.includes(mode)) {
    return Response.json({ error: "mode_unavailable" }, { status: 400 });
  }

  const bookingId = crypto.randomUUID();
  const claim = await claimSlot(key, { bookingId, dates: quote.dates, status: "held" });
  if (!claim.ok) {
    return Response.json({ error: claim.reason, conflicts: claim.conflicts || [] }, { status: 409 });
  }

  const origin = new URL(req.url).origin;
  const when = `${dayName(day)}s at ${prettyTime(time)}`;
  const range = `${prettyDate(quote.firstDate)} – ${prettyDate(quote.lastDate)}`;
  const label = `${plan.name} with ${teacher.name}`;
  const detail =
    `${quote.sessions} × ${SESSION_MINUTES}-minute private lessons · ${when} · ${range}` +
    ` · ${MODES.find((m) => m.id === mode).label}`;

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: contact.email,
      client_reference_id: bookingId,
      // Stamped from the clock *here*, not from `now` above: the quote and
      // the slot claim in between are a blob list plus a write per lesson
      // date, so `now` is seconds stale by the time Stripe sees this — enough
      // to drop the window under Stripe's 30-minute floor and fail the call.
      expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_MINUTES * 60,
      success_url: `${origin}/lesson-confirmed.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/private-lessons.html?cancelled=1`,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: quote.totalCents,
            product_data: { name: label, description: detail },
          },
        },
      ],
      // Everything the webhook needs, and everything you'd want to see in the
      // Stripe dashboard without opening another tab.
      metadata: {
        bookingId,
        teacher: teacher.name,
        plan: plan.name,
        slot: when,
        dates: range,
        sessions: String(quote.sessions),
        student: contact.studentName,
        mode,
      },
    });

    const booking = {
      id: bookingId,
      status: "pending",
      createdAt: now.toISOString(),
      paidAt: null,
      teacherId: teacher.id,
      teacherName: teacher.name,
      planId: plan.id,
      planName: plan.name,
      day,
      time,
      when,
      mode,
      slotKey: key,
      sessions: quote.sessions,
      dates: quote.dates,
      firstDate: quote.firstDate,
      lastDate: quote.lastDate,
      rateCents: quote.rateCents,
      grossCents: quote.grossCents,
      discountPct: quote.discountPct,
      discountCents: quote.discountCents,
      totalCents: quote.totalCents,
      contact,
      stripeSessionId: session.id,
    };

    await saveBooking(booking);
    await linkStripeSession(session.id, bookingId);

    return Response.json({ url: session.url, bookingId });
  } catch (err) {
    console.error("lessons-checkout stripe error:", err?.message || err);
    await releaseClaim(key, bookingId, quote.dates);
    return Response.json({ error: "checkout_failed" }, { status: 502 });
  }
};

export const config = { path: "/api/lessons/checkout" };
