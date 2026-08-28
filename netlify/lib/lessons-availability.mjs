// Turns the config + what's already sold into "here is exactly what this
// family can buy." Both the catalog endpoint and checkout call this, so the
// price the page shows and the price Stripe charges can never drift apart.

import {
  CLOSURES,
  TEACHERS,
  TERM,
  allPlans,
  earliestBookableDate,
  getPlan,
  getTeacher,
  planDates,
  priceFor,
  slotKey,
  toDate,
} from "./lessons-config.mjs";
import { loadClaimIndex } from "./lessons-store.mjs";

const NO_DATES = new Set();

/**
 * What one plan looks like on one weekday for one teacher.
 * Availability is all-or-nothing: we will not sell a run with holes in it,
 * because the whole promise is "same time every week."
 */
export function quote({ teacher, planId, day, taken, now = new Date() }) {
  const plan = getPlan(planId);
  if (!plan) return null;

  const dates = planDates(planId, day, now);
  if (!dates.length) {
    return { planId, available: false, reason: "plan_over", sessions: 0 };
  }

  const blocked = dates.filter((d) => taken.has(d));
  if (blocked.length) {
    return { planId, available: false, reason: "slot_taken", sessions: 0, blocked };
  }

  // The semester sells as a whole term at a fixed price. Coaching is flat
  // priced in the registration system, so a prorated semester would need
  // per-order pricing that reg-config.mjs deliberately does not allow. Once
  // lessons are under way the packs take over — a family joining in November
  // buys a 6- or 10-pack on the same weekly slot and gets the same seat.
  if (plan.kind === "term" && earliestBookableDate(now) > toDate(TERM.startDate)) {
    return { planId, available: false, reason: "term_started", sessions: 0 };
  }

  // Which closures this run steps over, so the plan card can say so up front
  // rather than leaving a parent to notice a missing week on the receipt.
  const last = dates[dates.length - 1];
  const skips = CLOSURES.filter((c) => c.to >= dates[0] && c.from <= last).map((c) => c.name);

  return {
    planId,
    available: true,
    sessions: dates.length,
    dates,
    skips,
    firstDate: dates[0],
    lastDate: last,
    ...priceFor({
      rate: teacher.rate,
      sessions: dates.length,
      discountPct: plan.discountPct ?? null,
      price: plan.price ?? null,
    }),
  };
}

/** Everything the booking page needs, in one payload. */
export async function buildCatalog(now = new Date()) {
  const claimed = await loadClaimIndex(now.getTime());

  const teachers = TEACHERS.map((teacher) => ({
    id: teacher.id,
    name: teacher.name,
    initials: teacher.initials,
    photo: teacher.photo || null,
    title: teacher.title,
    specialties: teacher.specialties,
    bio: teacher.bio,
    rate: teacher.rate,
    modes: teacher.modes,
    slots: teacher.slots.map((slot) => {
      const key = slotKey(teacher.id, slot.day, slot.time);
      const taken = claimed.get(key) || NO_DATES;
      const quotes = {};
      for (const plan of allPlans()) {
        quotes[plan.id] = quote({ teacher, planId: plan.id, day: slot.day, taken, now });
      }
      return {
        key,
        day: slot.day,
        time: slot.time,
        anyAvailable: Object.values(quotes).some((q) => q?.available),
        quotes,
      };
    }),
  }));

  return { teachers, generatedAt: now.toISOString() };
}

/**
 * Re-derive a single quote at checkout time, straight from the store.
 * This is the number that actually gets charged.
 */
export async function quoteForCheckout({ teacherId, day, time, planId, now = new Date() }) {
  const teacher = getTeacher(teacherId);
  if (!teacher) return { error: "unknown_teacher" };

  const slot = teacher.slots.find((s) => s.day === day && s.time === time);
  if (!slot) return { error: "unknown_slot" };

  const plan = getPlan(planId);
  if (!plan) return { error: "unknown_plan" };

  const key = slotKey(teacher.id, day, time);
  const claimed = await loadClaimIndex(now.getTime());
  const taken = claimed.get(key) || NO_DATES;

  const q = quote({ teacher, planId, day, taken, now });
  if (!q?.available) return { error: q?.reason || "unavailable" };

  return { teacher, plan, slot, slotKey: key, quote: q };
}
