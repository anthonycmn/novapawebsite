// Stripe tells us the money landed; we make the slot permanent.
// POST /api/lessons/webhook
//
// Set this URL as a webhook endpoint in the Stripe dashboard and subscribe to
// `checkout.session.completed` and `checkout.session.expired`. Put the signing
// secret in STRIPE_WEBHOOK_SECRET.

import Stripe from "stripe";
import { confirmClaim, readBooking, releaseClaim, saveBooking } from "../lib/lessons-store.mjs";
import { prettyDate, prettyTime, dayName } from "../lib/lessons-config.mjs";

async function notify(booking) {
  const hook = process.env.BOOKING_NOTIFY_WEBHOOK;
  if (!hook) return;
  try {
    await fetch(hook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "private_lesson_booked",
        summary:
          `${booking.contact.studentName} booked ${booking.sessions} lessons with ` +
          `${booking.teacherName}, ${dayName(booking.day)}s at ${prettyTime(booking.time)}, ` +
          `${prettyDate(booking.firstDate)}–${prettyDate(booking.lastDate)} ` +
          `($${(booking.totalCents / 100).toFixed(2)})`,
        booking,
      }),
    });
  } catch (err) {
    console.error("booking notify failed:", err?.message || err);
  }
}

export default async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const signature = req.headers.get("stripe-signature");
  const raw = await req.text();

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      raw,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    console.error("lessons-webhook bad signature:", err?.message || err);
    return Response.json({ error: "bad_signature" }, { status: 400 });
  }

  const session = event.data?.object;
  const bookingId = session?.metadata?.bookingId || session?.client_reference_id;
  if (!bookingId) return Response.json({ received: true });

  const booking = await readBooking(bookingId);
  if (!booking) {
    console.error("lessons-webhook unknown booking:", bookingId);
    return Response.json({ received: true });
  }

  if (event.type === "checkout.session.completed") {
    if (booking.status === "confirmed") return Response.json({ received: true });

    const result = await confirmClaim(booking.slotKey, bookingId, booking.dates);
    // If the hold somehow lapsed, we still record the payment and flag it
    // rather than dropping a paid booking on the floor.
    booking.status = result.ok ? "confirmed" : "needs_review";
    booking.holdIssue = result.ok ? null : result.reason;
    booking.paidAt = new Date().toISOString();
    booking.stripePaymentIntent = session.payment_intent || null;
    await saveBooking(booking);

    if (!result.ok) console.error("lessons-webhook hold lost for", bookingId, result.reason);
    await notify(booking);
    return Response.json({ received: true });
  }

  if (event.type === "checkout.session.expired") {
    if (booking.status === "pending") {
      await releaseClaim(booking.slotKey, bookingId, booking.dates);
      booking.status = "expired";
      await saveBooking(booking);
    }
    return Response.json({ received: true });
  }

  return Response.json({ received: true });
};

export const config = { path: "/api/lessons/webhook" };
