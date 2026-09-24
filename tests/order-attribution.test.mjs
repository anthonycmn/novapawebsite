// Which ad an order is credited to, when the checkout visit carried no params.
//
// Why this file exists: until Sep 24 2026 public.orders held 0 of 246 rows
// with any ad parameter, because only a same-visit checkout with the query
// string intact was ever attributed. The real journey is ad -> free class ->
// checkout a week later with a bare URL (order 41762800, from booking 40).
// These pin the fallback to the family's first tagged lead, and that every
// way it can fail is logged as a failure and never breaks the webhook.
import Stripe from "stripe";
import { attributeOrder, parseMetaUtm, hasUtm, ATTRIBUTION_LOG } from "../netlify/functions/reg-attribution.mjs";

let fails = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

const URL_ = "https://db.test";
const ORDER = "41762800-769a-49c9-abb8-ec038d952559";
// Booking 40 as stored on Sep 17 2026 (fbclid shortened).
const BOOKING_40 = {
  utm_source: "meta", utm_medium: "paid", utm_campaign: "novapa-classes-2026",
  utm_content: "freeclass-static-castle", fbclid: "IwcGRvZgVmZGlkFlDpvhKT",
};
const QUIZ_UTM = { utm_source: "meta", utm_content: "quiz-static" };

// A fake PostgREST. `tables` maps a lead table to the rows it returns (already
// in created_at order, as the query asks); `fail` maps a path fragment to a
// status or "throw". Every call is recorded.
function fakeDb({ tables = {}, fail = {} } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || "GET", body: init.body ? JSON.parse(init.body) : undefined });
    for (const [frag, how] of Object.entries(fail)) {
      if (u.includes(frag)) {
        if (how === "throw") throw new Error("fetch failed");
        return new Response("boom", { status: how });
      }
    }
    for (const [t, rows] of Object.entries(tables)) {
      if (u.includes(`/rest/v1/${t}?`)) return Response.json(rows);
    }
    if (u.includes("/rest/v1/orders?")) return new Response(null, { status: 204 });
    return Response.json([]);
  };
  return { calls, fetchImpl, patches: () => calls.filter((c) => c.method === "PATCH") };
}

// Collect console.error lines, so "failed loudly" is something we can check.
async function withErrors(fn) {
  const errs = [], orig = console.error;
  console.error = (...a) => { errs.push(a.join(" ")); };
  try { return { out: await fn(), errs }; } finally { console.error = orig; }
}
const run = (meta, db) => attributeOrder(ORDER, meta, { fetchImpl: db.fetchImpl, url: URL_, key: "k" });

// ── Checkout utm still wins when it exists ──────────────────────────────────
{
  const db = fakeDb({ tables: { free_class_bookings: [{ id: 40, email: "a@x.com", utm: BOOKING_40 }] } });
  const out = await run({ email: "a@x.com", utm: JSON.stringify({ utm_source: "google" }) }, db);
  eq("checkout utm is written as is", db.patches()[0]?.body, { utm: { utm_source: "google" } });
  eq("and no lead lookup is made", db.calls.filter((c) => c.url.includes("free_class_bookings")).length, 0);
  eq("source is the checkout", out.source, "checkout");
}

// ── The Sep 24 journey: bare checkout, tagged free-class booking ────────────
{
  const db = fakeDb({ tables: { free_class_bookings: [{ id: 40, email: "Parent@Example.com", utm: BOOKING_40 }] } });
  const out = await run({ email: "parent@example.com", utm: "" }, db);
  eq("empty utm falls back to the booking's utm", db.patches()[0]?.body, { utm: BOOKING_40 });
  eq("credited to booking 40", out.source, "free_class_bookings#40");
  const q = db.calls[0].url;
  eq("lookup asks for the earliest row first", q.includes("order=created_at.asc"), true);
  eq("lookup skips null utm server side", q.includes("utm=not.is.null"), true);
  eq("the PATCH targets this order only", db.patches()[0].url, `${URL_}/rest/v1/orders?id=eq.${ORDER}`);
}
{
  const db = fakeDb({ tables: { free_class_bookings: [{ id: 40, email: "p@x.com", utm: BOOKING_40 }] } });
  await run({ email: "p@x.com" }, db);
  eq("absent utm key behaves like empty", db.patches()[0]?.body, { utm: BOOKING_40 });
}
{
  const db = fakeDb({ tables: { free_class_bookings: [{ id: 40, email: "p@x.com", utm: BOOKING_40 }] } });
  await run({ email: "p@x.com", utm: "{}" }, db);
  eq("an empty object at checkout counts as no utm", db.patches()[0]?.body, { utm: BOOKING_40 });
}

// ── First touch wins, and {} is not a touch ─────────────────────────────────
{
  const db = fakeDb({ tables: { free_class_bookings: [
    { id: 12, email: "p@x.com", utm: {} },
    { id: 40, email: "p@x.com", utm: BOOKING_40 },
    { id: 55, email: "p@x.com", utm: { utm_source: "meta", utm_content: "later-ad" } },
  ] } });
  const out = await run({ email: "p@x.com", utm: "" }, db);
  eq("an untagged {} booking is skipped", out.source, "free_class_bookings#40");
  eq("the earliest tagged booking wins over a later one", db.patches()[0]?.body, { utm: BOOKING_40 });
}

// ── Email match is exact, ignoring case only ────────────────────────────────
{
  // ilike treats "_" as a wildcard, so the server may hand back a near miss.
  const db = fakeDb({ tables: { free_class_bookings: [{ id: 9, email: "axb@x.com", utm: BOOKING_40 }] } });
  const out = await run({ email: "a_b@x.com", utm: "" }, db);
  eq("a wildcard near miss is not a match", out.reason, "none");
  eq("and nothing is written", db.patches().length, 0);
}

// ── Quiz leads are the second source ────────────────────────────────────────
{
  const db = fakeDb({ tables: { free_class_bookings: [], quiz_leads: [{ id: 3, email: "q@x.com", utm: QUIZ_UTM }] } });
  const out = await run({ email: "q@x.com", utm: "" }, db);
  eq("no booking: the quiz lead's utm", db.patches()[0]?.body, { utm: QUIZ_UTM });
  eq("credited to the quiz lead", out.source, "quiz_leads#3");
}
{
  const db = fakeDb({ tables: {
    free_class_bookings: [{ id: 40, email: "b@x.com", utm: BOOKING_40 }],
    quiz_leads: [{ id: 3, email: "b@x.com", utm: QUIZ_UTM }] } });
  await run({ email: "b@x.com", utm: "" }, db);
  eq("a booking is preferred over a quiz lead", db.patches()[0]?.body, { utm: BOOKING_40 });
  eq("and the quiz table is not asked", db.calls.some((c) => c.url.includes("quiz_leads")), false);
}

// ── Nothing to credit ───────────────────────────────────────────────────────
{
  const db = fakeDb();
  const { out, errs } = await withErrors(() => run({ email: "n@x.com", utm: "" }, db));
  eq("no lead anywhere: nothing written", db.patches().length, 0);
  eq("and it is not reported as a failure", errs.length, 0);
  eq("reason is none", out.reason, "none");
}
{
  const db = fakeDb();
  const out = await run({ utm: "" }, db);
  eq("no email: no lookup at all", [db.calls.length, out.reason], [0, "none"]);
}

// ── Failures are loud and never throw ───────────────────────────────────────
{
  const db = fakeDb({ tables: { quiz_leads: [{ id: 3, email: "f@x.com", utm: QUIZ_UTM }] },
    fail: { "free_class_bookings?": 500 } });
  const { out, errs } = await withErrors(() => run({ email: "f@x.com", utm: "" }, db));
  eq("a failed booking lookup still tries the quiz", out.source, "quiz_leads#3");
  eq("and the failure is logged as FAILED", errs.some((e) => e.includes(`${ATTRIBUTION_LOG} FAILED`) && e.includes("free_class_bookings")), true);
}
{
  const db = fakeDb({ tables: { free_class_bookings: [{ id: 40, email: "p@x.com", utm: BOOKING_40 }] },
    fail: { "/rest/v1/orders?": 500 } });
  const { out, errs } = await withErrors(() => run({ email: "p@x.com", utm: "" }, db));
  eq("a failed PATCH does not throw", out.reason, "patch");
  eq("and is logged as FAILED with the order id", errs.some((e) => e.includes("FAILED") && e.includes(ORDER) && e.includes("PATCH 500")), true);
}
{
  const db = fakeDb({ fail: { "/rest/v1/": "throw" } });
  let threw = false, res;
  const { errs } = await withErrors(async () => { try { res = await run({ email: "p@x.com", utm: "" }, db); } catch { threw = true; } });
  eq("a network failure does not throw", threw, false);
  eq("both lookups are logged as FAILED", errs.filter((e) => e.includes("FAILED")).length, 2);
  eq("and it ends as none, not a write", res.reason, "none");
}
{
  const { out, errs } = await withErrors(async () => parseMetaUtm("{not json", ORDER));
  eq("unparseable checkout utm is null", out, null);
  eq("and logged as FAILED", errs.some((e) => e.includes("FAILED") && e.includes("not JSON")), true);
}
eq("hasUtm: {} is not tagged", hasUtm({}), false);
eq("hasUtm: an array is not tagged", hasUtm(["x"]), false);

// ── The whole webhook, with a signed Stripe event ───────────────────────────
// The real handler, fed a payment_intent.succeeded whose utm is "" and whose
// email matches a tagged free-class booking. Supabase is the fake above
// (global fetch); mail is unconfigured so nothing is sent; plan "full" and a
// signed-in family means no Stripe API call is made.
{
  for (const k of ["SMTP_PASS", "SMTP_USER", "RESEND_API_KEY"]) delete process.env[k];
  process.env.STRIPE_SECRET_KEY = "sk_test_attribution";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_attribution";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || "GET", body: init.body });
    if (u.includes("/rpc/confirm_order")) return Response.json(ORDER);
    if (u.includes("/rest/v1/free_class_bookings?")) {
      return Response.json([{ id: 40, email: "parent@example.com", created_at: "2026-09-17T23:27:00Z", utm: BOOKING_40 }]);
    }
    if (u.includes("/rest/v1/orders?") && init.method === "PATCH") return new Response(null, { status: 204 });
    return Response.json([]);
  };
  const { default: handler } = await import("../netlify/functions/reg-webhook.mjs");
  const payload = JSON.stringify({
    id: "evt_test_attr", object: "event", type: "payment_intent.succeeded",
    data: { object: {
      id: "pi_test_attr", object: "payment_intent", amount: 9000, amount_received: 9000, customer: "cus_test",
      metadata: { hold_id: "00000000-0000-0000-0000-000000000040", plan: "full", email: "Parent@Example.com",
        guest: "0", n_items: "1", unit_cents: "9000", total_cents: "9000", utm: "" },
    } },
  });
  const stripe = new Stripe("sk_test_attribution");
  const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_attribution" });
  const res = await handler(new Request("https://site.test/api/reg-webhook", {
    method: "POST", headers: { "stripe-signature": sig }, body: payload,
  }));
  globalThis.fetch = realFetch;
  const patch = calls.find((c) => c.method === "PATCH" && c.url.includes(`/rest/v1/orders?id=eq.${ORDER}`));
  eq("webhook: event accepted", res.status, 200);
  eq("webhook: booking lookup is by the checkout email, lowercased",
    calls.some((c) => c.url.includes("free_class_bookings?email=ilike.parent%40example.com")), true);
  eq("webhook: order utm resolves to booking 40's utm", patch && JSON.parse(patch.body), { utm: BOOKING_40 });
  eq("webhook: nothing left the fake database", calls.every((c) => c.url.startsWith("https://tlkuqwsqicxcjdmumkje.supabase.co/")), true);
}

console.log(fails ? `\n${fails} FAILED` : "\nall order-attribution checks pass");
process.exit(fails ? 1 : 0);
