// End-to-end test of slot locking against a real Netlify Blobs server.
import { BlobsServer } from "@netlify/blobs/server";
import { getStore } from "@netlify/blobs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startSerializingProxy } from "./helpers/serializing-proxy.mjs";

const dir = mkdtempSync(join(tmpdir(), "blobs-"));
const token = "test-token";
const server = new BlobsServer({ directory: dir, token, port: 8971 });
await server.start();

// See helpers/serializing-proxy.mjs — the emulator's conditional writes are
// concurrency, so everything goes through a serializing proxy to give us the
// create-if-absent semantics production actually provides.
const proxy = await startSerializingProxy("http://localhost:8971", 8970);
const url = "http://localhost:8970";
process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify({
  edgeURL: url, uncachedEdgeURL: url, siteID: "test-site", token, primaryRegion: "us-east-1",
})).toString("base64");

const store = await import("../netlify/lib/lessons-store.mjs");
const avail = await import("../netlify/lib/lessons-availability.mjs");
const cfg = await import("../netlify/lib/lessons-config.mjs");
const raw = getStore({ name: "novapa-lessons", consistency: "strong" });

let fails = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};
const taken = async (key) => [...((await store.loadClaimIndex()).get(key) || [])].sort();

/** Backdate a hold past its expiry in both the lock layer and the display cache. */
async function ageOut(slotKey, bookingId, dates) {
  const old = new Date(Date.now() - 90 * 60_000).toISOString();
  for (const d of dates) {
    await raw.setJSON(`claim/${slotKey}/${d}`, { bookingId, status: "held", claimedAt: old });
  }
  const summary = await raw.get(`slot/${slotKey}`, { type: "json" });
  summary.holds = summary.holds.map((h) => ({ ...h, expiresAt: old }));
  await raw.setJSON(`slot/${slotKey}`, summary);
}

const NOW = new Date("2026-08-08T12:00:00Z");
const KEY = cfg.slotKey("tony-cimino-johnson", 3, "17:30");
const TERM_DATES = cfg.planDates(cfg.TERM.id, 3, NOW);   // 15 Wednesdays, Sep 16 – Jan 13, holidays skipped
const PRE_TERM = cfg.planDates("pack-3", 3, NOW);        // 3 Wednesdays, Aug 12 – Aug 26

// ── 1. First family takes the whole term ────────────────────────────────────
eq("first claim succeeds", (await store.claimSlot(KEY, { bookingId:"A", dates:TERM_DATES })).ok, true);
eq("  all 15 dates locked", (await taken(KEY)).length, 15);

// ── 2. Second family cannot take the same term ──────────────────────────────
const second = await store.claimSlot(KEY, { bookingId:"B", dates:TERM_DATES });
eq("duplicate term rejected", second.ok, false);
eq("  reason", second.reason, "slot_taken");
eq("  no extra locks left behind", (await taken(KEY)).length, 15);

// ── 3. Rollback: a run that collides part-way leaves nothing behind ─────────
const straddle = ["2026-09-09", "2026-09-16"];   // first free, second inside the term
eq("straddling run rejected", (await store.claimSlot(KEY, { bookingId:"C", dates:straddle })).ok, false);
eq("  partial lock rolled back", (await taken(KEY)).includes("2026-09-09"), false);

// ── 4. A genuinely free run on the same slot is allowed ─────────────────────
eq("pre-term 3-pack allowed", (await store.claimSlot(KEY, { bookingId:"D", dates:PRE_TERM })).ok, true);
eq("  now 18 dates locked", (await taken(KEY)).length, 18);

// ── 5. Other teachers / days untouched ──────────────────────────────────────
const other = cfg.slotKey("colton-sorenson", 2, "16:00");
eq("different slot unaffected", (await store.claimSlot(other, { bookingId:"E", dates:TERM_DATES })).ok, true);

// ── 6. THE RACE: 8 families hit the same fresh slot simultaneously ──────────
const hot = cfg.slotKey("ryyana-cunningham", 4, "16:00");
const racers = await Promise.all(
  Array.from({ length: 8 }, (_, i) => store.claimSlot(hot, { bookingId:`R${i}`, dates:TERM_DATES }))
);
const winners = racers.filter((r) => r.ok);
eq("exactly one racer wins", winners.length, 1);
eq("the rest are told no", racers.filter((r) => !r.ok).length, 7);
eq("  slot holds exactly one run", (await taken(hot)).length, 15);
const owners = new Set(await Promise.all(TERM_DATES.map(async (d) =>
  (await raw.get(`claim/${hot}/${d}`, { type:"json" })).bookingId)));
eq("  every date owned by the same booking", owners.size, 1);

// ── 7. Hold → booked ────────────────────────────────────────────────────────
eq("confirm promotes the hold", (await store.confirmClaim(KEY, "A", TERM_DATES)).ok, true);
eq("  status is booked",
  (await raw.get(`claim/${KEY}/${TERM_DATES[0]}`, { type:"json" })).status, "booked");
eq("confirming twice is safe", (await store.confirmClaim(KEY, "A", TERM_DATES)).ok, true);
eq("confirming a stranger fails", (await store.confirmClaim(KEY, "ZZZ", TERM_DATES)).reason, "hold_lost");
eq("  and did not corrupt the owner",
  (await raw.get(`claim/${KEY}/${TERM_DATES[0]}`, { type:"json" })).bookingId, "A");

// ── 8. A booked slot can never be stolen, even by a reclaim attempt ─────────
eq("booked dates resist a new claim",
  (await store.claimSlot(KEY, { bookingId:"THIEF", dates:TERM_DATES })).ok, false);

// ── 9. An abandoned checkout frees the slot again ───────────────────────────
const stale = cfg.slotKey("colton-sorenson", 4, "17:00");
eq("hold placed", (await store.claimSlot(stale, { bookingId:"GONE", dates:TERM_DATES })).ok, true);
eq("  slot looks busy while the hold is live", (await taken(stale)).length, 15);

// wind that hold's clock back past expiry, in both layers
await ageOut(stale, "GONE", TERM_DATES);

eq("expired hold reads as free", (await taken(stale)).length, 0);
eq("expired hold is reclaimable", (await store.claimSlot(stale, { bookingId:"NEW", dates:TERM_DATES })).ok, true);
eq("  new owner recorded",
  (await raw.get(`claim/${stale}/${TERM_DATES[0]}`, { type:"json" })).bookingId, "NEW");

// ── 10. Two racers reclaiming the same dead hold — only one may win ─────────
const dead = cfg.slotKey("ryyana-cunningham", 6, "12:00");
await store.claimSlot(dead, { bookingId:"ZOMBIE", dates:TERM_DATES });
await ageOut(dead, "ZOMBIE", TERM_DATES);
const reclaimers = await Promise.all(
  Array.from({ length: 5 }, (_, i) => store.claimSlot(dead, { bookingId:`Z${i}`, dates:TERM_DATES }))
);
eq("one reclaimer wins", reclaimers.filter((r) => r.ok).length, 1);
const owners2 = new Set(await Promise.all(TERM_DATES.map(async (d) =>
  (await raw.get(`claim/${dead}/${d}`, { type:"json" })).bookingId)));
eq("  slot has a single owner", owners2.size, 1);

// ── 11. releaseClaim hands the dates back ───────────────────────────────────
await store.releaseClaim(dead, [...owners2][0], TERM_DATES);
eq("release empties the slot", (await taken(dead)).length, 0);
eq("release cannot delete a paid booking",
  await (async () => { await store.releaseClaim(KEY, "A", TERM_DATES); return (await taken(KEY)).length; })(), 18);

// ── 12. The catalog reflects reality ────────────────────────────────────────
const catalog = await avail.buildCatalog(NOW);
const c1 = catalog.teachers.find((t) => t.id === "tony-cimino-johnson");
const booked = c1.slots.find((s) => s.key === KEY);
const free = c1.slots.find((s) => s.key === cfg.slotKey("tony-cimino-johnson", 3, "18:30"));
eq("booked slot: term unavailable", booked.quotes[cfg.TERM.id].available, false);
eq("booked slot: reason surfaced", booked.quotes[cfg.TERM.id].reason, "slot_taken");
eq("booked slot: every plan blocked", booked.anyAvailable, false);
eq("free slot: still open", free.anyAvailable, true);
eq("free slot (premium coach): term $1,760", free.quotes[cfg.TERM.id].totalCents, 176000);
eq("free slot (premium coach): 10-pack $1,208", free.quotes["pack-10"].totalCents, 120800);
eq("free slot (premium coach): 6-pack $759", free.quotes["pack-6"].totalCents, 75900);
eq("free slot (premium coach): 3-pack $403", free.quotes["pack-3"].totalCents, 40300);

// ── 13. Checkout re-quote is the authority ──────────────────────────────────
eq("checkout blocks taken slot",
  (await avail.quoteForCheckout({ teacherId:"tony-cimino-johnson", day:3, time:"17:30", planId:cfg.TERM.id, now:NOW })).error,
  "slot_taken");
eq("checkout prices a free slot",
  (await avail.quoteForCheckout({ teacherId:"tony-cimino-johnson", day:3, time:"18:30", planId:cfg.TERM.id, now:NOW })).quote.totalCents,
  176000);
eq("checkout rejects unknown teacher",
  (await avail.quoteForCheckout({ teacherId:"ghost", day:3, time:"18:30", planId:cfg.TERM.id, now:NOW })).error,
  "unknown_teacher");
eq("checkout rejects a time the coach doesn't offer",
  (await avail.quoteForCheckout({ teacherId:"tony-cimino-johnson", day:3, time:"03:00", planId:cfg.TERM.id, now:NOW })).error,
  "unknown_slot");
eq("checkout rejects unknown plan",
  (await avail.quoteForCheckout({ teacherId:"tony-cimino-johnson", day:3, time:"18:30", planId:"free-lol", now:NOW })).error,
  "unknown_plan");

// ── 14. Bookings round-trip ─────────────────────────────────────────────────
await store.saveBooking({ id:"bk1", status:"confirmed", createdAt:"2026-08-08T00:00:00Z",
  totalCents:129600, sessions:12, contact:{ studentName:"Test" } });
await store.linkStripeSession("cs_test_123", "bk1");
eq("stripe session resolves to booking", (await store.bookingForStripeSession("cs_test_123")).id, "bk1");
eq("unknown stripe session → null", await store.bookingForStripeSession("cs_nope"), null);
eq("booking list works", (await store.listBookings()).length, 1);

await new Promise((r) => proxy.close(r));
await server.stop();
console.log(fails ? `\n${fails} FAILING` : "\nAll green.");
process.exit(fails ? 1 : 0);
