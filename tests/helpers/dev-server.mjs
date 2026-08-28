// Local harness: serves the static site and runs the real lesson functions
// against the Blobs emulator, so the booking page can be driven end to end
// without Netlify or Stripe. Checkout is stubbed at the Stripe boundary only.
//
//   node tests/helpers/dev-server.mjs        → http://localhost:8888
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { BlobsServer } from "@netlify/blobs/server";
import { startSerializingProxy } from "./serializing-proxy.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const blobs = new BlobsServer({ directory: mkdtempSync(join(tmpdir(), "dev-blobs-")), token: "t", port: 8961 });
await blobs.start();
const proxy = await startSerializingProxy("http://localhost:8961", 8960);
process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify({
  edgeURL: "http://localhost:8960", uncachedEdgeURL: "http://localhost:8960",
  siteID: "dev", token: "t", primaryRegion: "us-east-1",
})).toString("base64");

const catalog = (await import("../../netlify/functions/lessons-catalog.mjs")).default;
const bookingFn = (await import("../../netlify/functions/lessons-booking.mjs")).default;
const { quoteForCheckout } = await import("../../netlify/lib/lessons-availability.mjs");
const store = await import("../../netlify/lib/lessons-store.mjs");
const { dayName, prettyTime } = await import("../../netlify/lib/lessons-config.mjs");

const TYPES = { ".html":"text/html", ".css":"text/css", ".js":"text/javascript",
  ".jpg":"image/jpeg", ".png":"image/png", ".svg":"image/svg+xml", ".json":"application/json" };

async function send(res, r) {
  const body = Buffer.from(await r.arrayBuffer());
  const headers = {};
  r.headers.forEach((v, k) => { headers[k] = v; });
  res.writeHead(r.status, headers);
  res.end(body);
}

// Stripe stand-in: does everything the real handler does except call Stripe.
async function fakeCheckout(req, res, body) {
  const now = new Date();
  const resolved = await quoteForCheckout({
    teacherId: body.teacherId, day: Number(body.day), time: body.time, planId: body.planId, now,
  });
  if (resolved.error) {
    res.writeHead(409, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: resolved.error }));
  }
  const { teacher, plan, slotKey: key, quote } = resolved;
  const bookingId = crypto.randomUUID();
  const claim = await store.claimSlot(key, { bookingId, dates: quote.dates, status: "held" });
  if (!claim.ok) {
    res.writeHead(409, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: claim.reason }));
  }
  const sessionId = "cs_test_" + bookingId.replace(/-/g, "");
  await store.saveBooking({
    id: bookingId, status: "pending", createdAt: now.toISOString(), paidAt: null,
    teacherId: teacher.id, teacherName: teacher.name, planId: plan.id, planName: plan.name,
    day: Number(body.day), time: body.time, mode: body.mode, slotKey: key,
    when: body.time, sessions: quote.sessions, dates: quote.dates,
    firstDate: quote.firstDate, lastDate: quote.lastDate,
    rateCents: quote.rateCents, grossCents: quote.grossCents, discountPct: quote.discountPct,
    discountCents: quote.discountCents, totalCents: quote.totalCents,
    contact: { studentName: body.studentName, parentName: body.parentName, email: body.email,
      phone: body.phone, studentAge: body.studentAge, notes: body.notes },
    stripeSessionId: sessionId,
  });
  await store.linkStripeSession(sessionId, bookingId);
  // Simulate the webhook firing immediately.
  await store.confirmClaim(key, bookingId, quote.dates);
  const b = await store.readBooking(bookingId);
  b.status = "confirmed"; b.paidAt = new Date().toISOString();
  b.when = `${dayName(b.day)}s at ${prettyTime(b.time)}`;
  await store.saveBooking(b);
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ url: `/lesson-confirmed.html?session_id=${sessionId}`, bookingId }));
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:8888");

  if (url.pathname === "/api/lessons/catalog") {
    return send(res, await catalog(new Request(url, { method: "GET" })));
  }
  if (url.pathname === "/api/lessons/booking") {
    return send(res, await bookingFn(new Request(url, { method: "GET" })));
  }
  if (url.pathname === "/api/lessons/checkout") {
    const chunks = []; for await (const c of req) chunks.push(c);
    return fakeCheckout(req, res, JSON.parse(Buffer.concat(chunks).toString() || "{}"));
  }

  const rel = normalize(decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)).replace(/^[\\/]+/, "");
  try {
    const data = await readFile(join(ROOT, rel));
    res.writeHead(200, { "content-type": TYPES[extname(rel)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404); res.end("not found");
  }
}).listen(8888, () => console.log("dev harness on http://localhost:8888/private-lessons.html"));

process.on("SIGINT", async () => { proxy.close(); await blobs.stop(); process.exit(0); });
