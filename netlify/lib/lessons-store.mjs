// Persistence for private-lesson bookings, on Netlify Blobs.
//
// Two layers, deliberately separated, because they have different jobs.
//
// ── 1. The arbiter: one lock blob per lesson date ───────────────────────────
//   claim/<slotKey>/<YYYY-MM-DD>  →  { bookingId, status, claimedAt }
//
// Written with `onlyIfNew` — create-if-absent, the one primitive that is
// atomic without an ETag round-trip (Netlify's local emulator does not return
// ETags on reads, so anything built on compare-and-swap would quietly lose its
// guarantee in dev). First writer wins; everyone else gets modified:false.
// Buying a 12-week Wednesday creates twelve locks, all or nothing.
//
// A lock is reclaimable only if it is still `held` and its own `claimedAt` has
// aged past HOLD_MINUTES. Liveness is judged from the lock itself, never from
// a separate index — a half-finished run must not look abandoned to a rival
// racing it in the same millisecond.
//
// ── 2. The display cache: one summary blob per slot ─────────────────────────
//   slot/<slotKey>  →  { booked: [...], holds: [...] }
//
// This is what paints the booking page, so the page costs a handful of reads
// instead of one per date. It is best-effort and never decides anything: if it
// ever falls behind, checkout still re-checks the locks and refuses. A stale
// cache can cost someone a "just taken" message. It cannot oversell a slot.

import { getStore } from "@netlify/blobs";
import { HOLD_MINUTES } from "./lessons-config.mjs";

const STORE_NAME = "novapa-lessons";
const CLAIM_PREFIX = "claim/";
const SLOT_PREFIX = "slot/";
// Markers are keyed by the abandoned booking's UUID, which is never reused, so
// they are write-once and need no cleanup.
const RECLAIM_PREFIX = "reclaim/";
const HOLD_MS = HOLD_MINUTES * 60_000;
const RMW_ATTEMPTS = 3;

function store() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

const claimKey = (slotKey, date) => `${CLAIM_PREFIX}${slotKey}/${date}`;
const summaryKey = (slotKey) => `${SLOT_PREFIX}${slotKey}`;

// ── Display cache ───────────────────────────────────────────────────────────

function liveDates(summary, now) {
  const dates = new Set();
  for (const entry of summary?.booked || []) {
    for (const date of entry.dates) dates.add(date);
  }
  for (const hold of summary?.holds || []) {
    if (new Date(hold.expiresAt).getTime() <= now) continue;
    for (const date of hold.dates) dates.add(date);
  }
  return dates;
}

async function readSummary(slotKey) {
  try {
    return (await store().get(summaryKey(slotKey), { type: "json" })) || { booked: [], holds: [] };
  } catch {
    return { booked: [], holds: [] };
  }
}

/**
 * Read-modify-write on one slot's summary. Contention is near-zero (a slot is
 * only touched when someone buys it) and a lost update is harmless, so this
 * retries a few times and then gives up quietly rather than failing a booking.
 */
async function updateSummary(slotKey, mutate) {
  for (let attempt = 0; attempt < RMW_ATTEMPTS; attempt += 1) {
    try {
      const summary = await readSummary(slotKey);
      const now = Date.now();
      summary.holds = (summary.holds || []).filter(
        (h) => new Date(h.expiresAt).getTime() > now,
      );
      summary.booked = summary.booked || [];
      mutate(summary, now);
      await store().setJSON(summaryKey(slotKey), summary);
      return;
    } catch (err) {
      if (attempt === RMW_ATTEMPTS - 1) {
        console.error("slot summary write failed:", err?.message || err);
      }
    }
  }
}

/**
 * Every taken lesson date, as Map<slotKey, Set<date>> — the whole booking page
 * in one list plus a handful of parallel reads.
 */
export async function loadClaimIndex(now = Date.now()) {
  const index = new Map();
  try {
    const { blobs } = await store().list({ prefix: SLOT_PREFIX });
    const entries = await Promise.all(
      blobs.map(async (blob) => {
        const slotKey = blob.key.slice(SLOT_PREFIX.length);
        const summary = await store().get(blob.key, { type: "json" }).catch(() => null);
        return [slotKey, liveDates(summary, now)];
      }),
    );
    for (const [slotKey, dates] of entries) {
      if (dates.size) index.set(slotKey, dates);
    }
  } catch (err) {
    console.error("claim index read failed:", err?.message || err);
  }
  return index;
}

// ── Arbitration ─────────────────────────────────────────────────────────────

/**
 * Give up one date, but only if it is still ours.
 *
 * The owner check is what makes rollback safe. Two racers converge on the same
 * lock order, so a loser releasing dates 0..k-1 runs concurrently with the
 * winner re-acquiring them; an unconditional delete would reach across and
 * wipe a lock the winner had already taken.
 */
async function dropDate(slotKey, date, bookingId) {
  const key = claimKey(slotKey, date);
  try {
    const existing = await store().get(key, { type: "json" });
    if (existing?.bookingId === bookingId && existing.status !== "booked") {
      await store().delete(key);
    }
  } catch (err) {
    console.error("release failed:", err?.message || err);
  }
}

/**
 * Take one date. Returns true if we now own it.
 *
 * On collision the existing lock is reclaimed only when it is a hold that has
 * aged out, and only by whichever caller wins the reclaim election below.
 * Delete-then-create is not atomic on its own: without the election a late
 * delete would wipe the lock another reclaimer had just created.
 */
async function takeDate(slotKey, date, bookingId, status, now) {
  const key = claimKey(slotKey, date);
  const value = { bookingId, status, claimedAt: new Date(now).toISOString() };

  if ((await store().setJSON(key, value, { onlyIfNew: true })).modified) return true;

  const existing = await store().get(key, { type: "json" });
  if (!existing) {
    return (await store().setJSON(key, value, { onlyIfNew: true })).modified;
  }
  if (existing.bookingId === bookingId) return true; // already ours
  if (existing.status !== "held") return false;      // paid for; untouchable

  const age = now - new Date(existing.claimedAt).getTime();
  if (!(age > HOLD_MS)) return false;                // someone is mid-checkout

  // The hold is dead, but delete-then-create is not atomic: several callers
  // clearing the same corpse would each delete, and a late delete would wipe
  // the lock whichever one of them had just created. So elect a single
  // reclaimer first — create-if-absent on a marker naming this exact corpse.
  // Losers simply treat the date as unavailable this time around.
  const marker = `${RECLAIM_PREFIX}${slotKey}/${date}/${existing.bookingId}`;
  const elected = await store().setJSON(
    marker,
    { by: bookingId, at: new Date(now).toISOString() },
    { onlyIfNew: true },
  );
  if (!elected.modified) return false;

  await store().delete(key);
  return (await store().setJSON(key, value, { onlyIfNew: true })).modified;
}

/**
 * Reserve every date for one booking, all or nothing.
 * Returns { ok: true } or { ok: false, reason, conflicts }.
 */
export async function claimSlot(slotKey, { bookingId, dates, status = "held" }) {
  const now = Date.now();
  const won = [];

  for (const date of dates) {
    let ok = false;
    try {
      ok = await takeDate(slotKey, date, bookingId, status, now);
    } catch (err) {
      console.error("claim write failed:", err?.message || err);
    }
    if (ok) {
      won.push(date);
      continue;
    }
    // Beaten to it — give back everything this attempt took.
    await Promise.all(won.map((d) => dropDate(slotKey, d, bookingId)));
    return { ok: false, reason: "slot_taken", conflicts: [date] };
  }

  await updateSummary(slotKey, (summary) => {
    summary.holds = summary.holds.filter((h) => h.bookingId !== bookingId);
    if (status === "booked") {
      summary.booked = summary.booked.filter((b) => b.bookingId !== bookingId);
      summary.booked.push({ bookingId, dates });
    } else {
      summary.holds.push({
        bookingId,
        dates,
        expiresAt: new Date(now + HOLD_MS).toISOString(),
      });
    }
  });

  return { ok: true };
}

const bookedLock = (bookingId) => ({
  bookingId,
  status: "booked",
  claimedAt: new Date().toISOString(),
});

/**
 * Undo a lock this call created a moment ago.
 *
 * Not `dropDate`: that one refuses to touch anything marked `booked`, which is
 * exactly what a half-finished confirm leaves lying around. The ownership check
 * is still what makes it safe — a rollback racing somebody else's fresh claim
 * must not reach across and delete theirs.
 */
async function discardOwn(slotKey, date, bookingId) {
  const key = claimKey(slotKey, date);
  try {
    const existing = await store().get(key, { type: "json" });
    if (existing?.bookingId === bookingId) await store().delete(key);
  } catch (err) {
    console.error("confirm rollback failed:", err?.message || err);
  }
}

/**
 * Payment landed — make the locks permanent.
 *
 * Reads decide, then writes happen. Checking and re-taking in one pass meant a
 * confirm that failed on its fifth date had already re-taken its first four and
 * stamped them `booked` — for a booking that then reported `hold_lost`. Those
 * dates were unsellable and invisible to every release path, since nothing
 * deletes a booked lock. A confirm now either takes every date or none.
 */
export async function confirmClaim(slotKey, bookingId, dates) {
  // Pass 1 — read only. Anything already ours needs no write to keep; anything
  // belonging to someone else ends this now, with the store untouched.
  const lapsed = [];
  for (const date of dates) {
    const existing = await store().get(claimKey(slotKey, date), { type: "json" });
    if (!existing) {
      lapsed.push(date);
      continue;
    }
    if (existing.bookingId !== bookingId) return { ok: false, reason: "hold_lost" };
  }

  // Pass 2 — re-take the dates whose holds lapsed. These are the only writes
  // that can still lose a race, so they go first and on their own: if one is
  // beaten, the rollback has nothing to undo but its own siblings.
  const retaken = [];
  for (const date of lapsed) {
    const { modified } = await store().setJSON(
      claimKey(slotKey, date),
      bookedLock(bookingId),
      { onlyIfNew: true },
    );
    if (!modified) {
      await Promise.all(retaken.map((d) => discardOwn(slotKey, d, bookingId)));
      return { ok: false, reason: "hold_lost" };
    }
    retaken.push(date);
  }

  // Pass 3 — every date is ours. Promote the holds that were already here.
  await Promise.all(
    dates.map((date) => store().setJSON(claimKey(slotKey, date), bookedLock(bookingId))),
  );

  await updateSummary(slotKey, (summary) => {
    summary.holds = summary.holds.filter((h) => h.bookingId !== bookingId);
    summary.booked = summary.booked.filter((b) => b.bookingId !== bookingId);
    summary.booked.push({ bookingId, dates });
  });

  return { ok: true };
}

/** Checkout fell over or expired — hand the dates back. */
export async function releaseClaim(slotKey, bookingId, dates) {
  await Promise.all((dates || []).map((date) => dropDate(slotKey, date, bookingId)));

  await updateSummary(slotKey, (summary) => {
    summary.holds = summary.holds.filter((h) => h.bookingId !== bookingId);
  });
}

// ── Bookings ────────────────────────────────────────────────────────────────

export async function saveBooking(booking) {
  await store().setJSON(`bookings/${booking.id}`, booking);
}

export async function readBooking(bookingId) {
  return store().get(`bookings/${bookingId}`, { type: "json" });
}

export async function linkStripeSession(stripeSessionId, bookingId) {
  await store().setJSON(`stripe/${stripeSessionId}`, { bookingId });
}

export async function bookingForStripeSession(stripeSessionId) {
  const pointer = await store().get(`stripe/${stripeSessionId}`, { type: "json" });
  if (!pointer?.bookingId) return null;
  return readBooking(pointer.bookingId);
}

export async function listBookings() {
  const { blobs } = await store().list({ prefix: "bookings/" });
  const records = await Promise.all(
    blobs.map((b) => store().get(b.key, { type: "json" }).catch(() => null)),
  );
  return records.filter(Boolean).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
