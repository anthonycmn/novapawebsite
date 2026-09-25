// A $0 order is credited to its ad like a paid one.
//
// Why this file exists: reg-webhook writes public.orders.utm for every Stripe
// payment (order-attribution.test.mjs), but a fully credited or comped cart
// is confirmed inside reg-pay and never reaches Stripe, so until Sep 24 2026
// those orders kept utm NULL whatever sent the family. These drive the real
// reg-pay handler through its free-order branch (the same fake register as
// free-order-admin-alert.test.mjs) and pin that the order gets the checkout's
// utm, else the family's first tagged free-class booking, and that a failed
// write never fails the family's order.
//   node tests/free-order-attribution.test.mjs
process.env.STRIPE_SECRET_KEY = "sk_test_unused";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
process.env.RESEND_API_KEY = "re_test";
delete process.env.SMTP_PASS;
const { default: regPay } = await import("../netlify/functions/reg-pay.mjs");

let fails = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};
const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

const HOLD = "0b6f2d5e-6c4a-4b1e-9a3f-2f1c6d8e9a00";
const EMAIL = "merkouhsari@gmail.com";
const ORDER = 15264;
const CAMP = { id: 1962598, name: "Heroes & Villains", price_cents: 7900, category: "day_camp", offering_kind: "day_camp", sells_now: true };
const BOOKING = { utm_source: "meta", utm_medium: "paid", utm_content: "freeclass-video", fbclid: "IwTest" };

// One family with pack credits, one active hold on one day camp. `bookings`
// is what free_class_bookings returns for the family's email; `orderPatch`
// is the status the orders PATCH answers with. Records every request.
function fakeRegister({ bookings = [], orderPatch = 204 } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), path: u.pathname, method, body });
    if (u.hostname === "api.resend.com") return json({ id: "re_1" });
    const path = u.pathname;
    if (path.startsWith("/rest/v1/rpc/")) {
      const fn = path.split("/").pop();
      if (fn === "activity_facts") return json([CAMP]);
      if (fn === "confirm_order") return json(ORDER);
      if (fn === "hold_items_admin") return json([{ activity_id: CAMP.id, camper: "Cora Kouhsari" }]);
      return json(null);
    }
    if (path.endsWith("/orders") && method === "PATCH") {
      return orderPatch === 204 ? new Response(null, { status: 204 }) : json({ message: "boom" }, orderPatch);
    }
    if (path.endsWith("/free_class_bookings")) return json(bookings);
    if (path.endsWith("/holds")) return json([{
      id: HOLD, status: "active", expires_at: new Date(Date.now() + 600_000).toISOString(),
      items: [{ activity_id: CAMP.id, camper: "Cora Kouhsari" }],
    }]);
    if (path.endsWith("/families")) {
      if (method === "PATCH") return json([]);
      return json([{ id: "fam-1", email: EMAIL, cc_email: null }]);
    }
    if (path.endsWith("/campers")) return json([{
      name: "Cora Kouhsari", already_registered: [], birthdate: null, day_camp_credits: 5, snow_day_credits: 2,
    }]);
    if (path.endsWith("/admin_emails")) return json([{ email: "cj@novapa.org" }]);
    if (path.endsWith("/activities")) return json([CAMP]);
    return json([]);
  };
  return {
    calls,
    orderPatches: () => calls.filter((c) => c.method === "PATCH" && c.path.endsWith("/orders")),
  };
}

const checkout = (extra = {}) => regPay(new Request("https://www.northernvirginiaperformingarts.org/api/reg-pay", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    hold_id: HOLD, plan: "full", email: EMAIL, parent_name: "Mer Kouhsari", phone: "703-555-0100",
    confirm_free: true, ...extra,
  }),
}));

// ── The checkout carried utm: it goes on the order ─────────────────────────
{
  const db = fakeRegister({ bookings: [{ id: 14, email: EMAIL, utm: BOOKING }] });
  const r = await (await checkout({ utm: { utm_source: "novapamail", utm_campaign: "weekly-2026-09-21" } })).json();
  eq("the free order confirms", r, { confirmed: true });
  const p = db.orderPatches();
  eq("exactly one utm write", p.length, 1);
  eq("  on this order", p[0] && p[0].url.endsWith(`/rest/v1/orders?id=eq.${ORDER}`), true);
  eq("  with the checkout's own utm", p[0] && p[0].body, { utm: { utm_source: "novapamail", utm_campaign: "weekly-2026-09-21" } });
  eq("  and no lead lookup", db.calls.some((c) => c.path.endsWith("/free_class_bookings")), false);
}

// ── A bare checkout: the family's first tagged booking ─────────────────────
{
  const db = fakeRegister({ bookings: [{ id: 14, email: EMAIL, utm: BOOKING }] });
  const r = await (await checkout()).json();
  eq("bare checkout: order confirms", r, { confirmed: true });
  eq("  booking looked up by the checkout email",
    db.calls.some((c) => c.path.endsWith("/free_class_bookings") && c.url.includes(`email=ilike.${encodeURIComponent(EMAIL)}`)), true);
  eq("  order utm is the booking's", db.orderPatches()[0]?.body, { utm: BOOKING });
}

// ── Nothing to credit: nothing written ─────────────────────────────────────
{
  const db = fakeRegister();
  const r = await (await checkout()).json();
  eq("no utm, no lead: order confirms", r, { confirmed: true });
  eq("  and no utm write", db.orderPatches().length, 0);
}

// ── A failed write never fails the family's order ──────────────────────────
{
  const db = fakeRegister({ bookings: [{ id: 14, email: EMAIL, utm: BOOKING }], orderPatch: 500 });
  const errs = [], orig = console.error;
  console.error = (...a) => { errs.push(a.join(" ")); };
  let r;
  try { r = await (await checkout()).json(); } finally { console.error = orig; }
  eq("utm write 500: order still confirms", r, { confirmed: true });
  eq("  roster still written", db.calls.some((c) => c.path.endsWith("/rpc/mark_registered")), true);
  eq("  failure logged as FAILED with the order id",
    errs.some((e) => e.includes("[order-attribution] FAILED") && e.includes(String(ORDER))), true);
}

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
