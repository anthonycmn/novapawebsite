// What the confirmation page reads back after Stripe redirects.
// GET /api/lessons/booking?session_id=cs_...
//
// Webhooks can lag a second or two behind the redirect, so if the booking is
// still pending we ask Stripe directly and finalise it here. confirmClaim is
// idempotent, so whichever path gets there first wins and the other no-ops.

import Stripe from "stripe";
import {
  bookingForStripeSession,
  confirmClaim,
  readBooking,
  saveBooking,
} from "../lib/lessons-store.mjs";
import { MODES, SESSION_MINUTES, prettyDate } from "../lib/lessons-config.mjs";

function publicView(booking) {
  return {
    status: booking.status,
    teacherName: booking.teacherName,
    planName: booking.planName,
    when: booking.when,
    mode: MODES.find((m) => m.id === booking.mode) || null,
    sessions: booking.sessions,
    sessionMinutes: SESSION_MINUTES,
    dates: booking.dates,
    prettyDates: booking.dates.map(prettyDate),
    firstDate: booking.firstDate,
    lastDate: booking.lastDate,
    rateCents: booking.rateCents,
    grossCents: booking.grossCents,
    discountPct: booking.discountPct,
    discountCents: booking.discountCents,
    totalCents: booking.totalCents,
    studentName: booking.contact.studentName,
    email: booking.contact.email,
    reference: booking.id.slice(0, 8).toUpperCase(),
  };
}

export default async (req) => {
  if (req.method !== "GET") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }

  const sessionId = new URL(req.url).searchParams.get("session_id") || "";
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
    return Response.json({ error: "bad_session" }, { status: 400 });
  }

  try {
    const stripe = process.env.STRIPE_SECRET_KEY
      ? new Stripe(process.env.STRIPE_SECRET_KEY)
      : null;
    let session = null;

    let booking = await bookingForStripeSession(sessionId);
    if (!booking && stripe) {
      // The session-to-booking pointer is written once the session is already
      // live, so a checkout that otherwise went fine can be missing it. The
      // session still names the booking, so ask Stripe rather than tell a
      // family who has just paid that we have never heard of them.
      session = await stripe.checkout.sessions.retrieve(sessionId);
      const id = session?.metadata?.bookingId || session?.client_reference_id;
      if (id) booking = await readBooking(id);
    }
    if (!booking) return Response.json({ error: "not_found" }, { status: 404 });

    if (booking.status === "pending" && stripe) {
      session = session || (await stripe.checkout.sessions.retrieve(sessionId));
      if (session.payment_status === "paid") {
        const result = await confirmClaim(booking.slotKey, booking.id, booking.dates);
        booking.status = result.ok ? "confirmed" : "needs_review";
        booking.holdIssue = result.ok ? null : result.reason;
        booking.paidAt = booking.paidAt || new Date().toISOString();
        booking.stripePaymentIntent = session.payment_intent || null;
        await saveBooking(booking);
      }
    }

    return Response.json(publicView(booking), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("lessons-booking error:", err?.message || err);
    return Response.json({ error: "lookup_failed" }, { status: 502 });
  }
};

export const config = { path: "/api/lessons/booking" };
