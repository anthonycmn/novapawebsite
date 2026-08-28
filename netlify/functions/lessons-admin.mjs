// Your roster of who booked what.
// GET /api/lessons/admin?key=<LESSONS_ADMIN_KEY>
//
// Deliberately plain JSON — point a browser at it, or pull it into a sheet.
// Returns 404 (not 401) when the key is unset or wrong, so the endpoint is
// invisible to anyone who doesn't already know it exists.

import { listBookings } from "../lib/lessons-store.mjs";
import { dayName, prettyDate, prettyTime } from "../lib/lessons-config.mjs";

export default async (req) => {
  const expected = process.env.LESSONS_ADMIN_KEY;
  const provided = new URL(req.url).searchParams.get("key") || "";
  if (!expected || provided !== expected) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const bookings = await listBookings();
    const confirmed = bookings.filter((b) => b.status === "confirmed");
    const revenueCents = confirmed.reduce((sum, b) => sum + b.totalCents, 0);

    return Response.json(
      {
        totals: {
          confirmed: confirmed.length,
          pending: bookings.filter((b) => b.status === "pending").length,
          needsReview: bookings.filter((b) => b.status === "needs_review").length,
          revenue: `$${(revenueCents / 100).toFixed(2)}`,
          sessionsSold: confirmed.reduce((sum, b) => sum + b.sessions, 0),
        },
        bookings: bookings.map((b) => ({
          reference: b.id.slice(0, 8).toUpperCase(),
          status: b.status,
          booked: b.createdAt,
          teacher: b.teacherName,
          slot: `${dayName(b.day)}s ${prettyTime(b.time)}`,
          plan: b.planName,
          sessions: b.sessions,
          runs: `${prettyDate(b.firstDate)} – ${prettyDate(b.lastDate)}`,
          mode: b.mode,
          paid: `$${(b.totalCents / 100).toFixed(2)}`,
          student: b.contact.studentName,
          studentAge: b.contact.studentAge,
          parent: b.contact.parentName,
          email: b.contact.email,
          phone: b.contact.phone,
          notes: b.contact.notes,
          dates: b.dates,
        })),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("lessons-admin error:", err?.message || err);
    return Response.json({ error: "unavailable" }, { status: 502 });
  }
};

export const config = { path: "/api/lessons/admin" };
