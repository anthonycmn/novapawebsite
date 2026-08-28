// Teachers, their open weekly times, and a live price for every plan.
// GET /api/lessons/catalog

import { buildCatalog } from "../lib/lessons-availability.mjs";
import { MODES, SESSION_MINUTES, TERM, allPlans } from "../lib/lessons-config.mjs";

export default async (req) => {
  if (req.method !== "GET") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }

  try {
    const catalog = await buildCatalog();
    return Response.json(
      {
        ...catalog,
        plans: allPlans(),
        term: TERM,
        modes: MODES,
        sessionMinutes: SESSION_MINUTES,
        paymentReady: Boolean(process.env.STRIPE_SECRET_KEY),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("lessons-catalog error:", err?.message || err);
    return Response.json({ error: "catalog_unavailable" }, { status: 502 });
  }
};

export const config = { path: "/api/lessons/catalog" };
