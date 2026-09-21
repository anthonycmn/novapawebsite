// A comped DC Unifieds seat tells the office.
//
// Why this file exists: the "DC Unifieds registration" alert to the admin list
// was sent in exactly one place, the Stripe webhook, and a seat comped to
// $0.00 never reaches Stripe. Sep 20 2026 proved it twice in 23 minutes:
// order 15268 (Brooke Zapata, a camp settled with a day camp credit, 7:59 PM
// ET) raised an alert because reg-pay.mjs got this block in PR #141; order
// 15269 (Tiffany O'Neill-Stuermann, DC Unifieds In Person, a $699 seat comped
// to $0.00, 8:22 PM ET) raised none. The family's confirmation, the family row
// and the coupon redemption all ran; only the office was blind. These drive
// the real dcu-pay handler through its free branch against a fake register and
// pin that the alert now goes out, that everything that already worked still
// does, and that a failed alert never fails the family's order.
//   node tests/dcu-free-order-admin-alert.test.mjs
process.env.STRIPE_SECRET_KEY = "sk_test_unused";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
process.env.RESEND_API_KEY = "re_test";
delete process.env.SMTP_PASS;
const { default: dcuPay } = await import("../netlify/functions/dcu-pay.mjs");

let fails = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};
const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

const HOLD = "7c31f4a2-5d8b-4e60-9c12-3a7d5e0b6f11";
const EMAIL = "toneill.stuermann@gmail.com";
const PARENT = "Tiffany O'Neill-Stuermann";
const STUDENT = "Maeve O'Neill-Stuermann";
// The real thing: DC Unifieds 2026, In Person, $699.00, comped whole by a
// 100% code. Any activity outside 970600-970699 is not a DCU track.
const TRACK = { id: 970601, name: "DC Unifieds 2026 In Person", price_cents: 69900, capacity: 60, sold: 12, bookable: true, hidden: false };
const COUPON = "DCU-COACHING";
const ADMINS = ["todd@novapa.org", "cj@novapa.org", "jen@novapa.org", "katie@novapa.org"];

// A fake register: one DCU track on sale, one 100%-off code scoped to it, and
// a brand-new buyer (no family, no camper). Records every RPC, every write and
// every email sent.
function fakeRegister({ adminEmailsStatus = 200, resendFails = () => false } = {}) {
  const rpcs = [], mails = [], writes = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    if (u.hostname === "api.resend.com") {
      if (resendFails(body)) return json({ message: "boom" }, 500);
      mails.push(body);
      return json({ id: `re_${mails.length}` });
    }
    const path = u.pathname;
    if (path.startsWith("/rest/v1/rpc/")) {
      const fn = path.split("/").pop();
      rpcs.push({ fn, args: body });
      if (fn === "check_coupon") return json({ code: COUPON, pct: 100, amount_cents: 0 });
      if (fn === "held_count_activity") return json(0);
      if (fn === "confirm_order") return json(15269);
      return json(null);
    }
    if (path.endsWith("/activities")) return json([TRACK]);
    if (path.endsWith("/coupons")) return json([{ email_lock: null, scope_activity_ids: [TRACK.id] }]);
    if (path.endsWith("/holds")) {
      writes.push({ table: "holds", body });
      return json([{ id: HOLD, status: "active", items: body.items }]);
    }
    // A buyer nobody has seen before: no family row, no camper of that name.
    if (path.endsWith("/families")) {
      if (method === "POST") { writes.push({ table: "families", body }); return json([{ id: "fam-dcu-1" }]); }
      return json([]);
    }
    if (path.endsWith("/campers")) {
      if (method === "POST") { writes.push({ table: "campers", body }); return json([{ id: "camper-dcu-1" }]); }
      return json([]);
    }
    if (path.endsWith("/admin_emails")) return json(ADMINS.map((email) => ({ email })), adminEmailsStatus);
    return json([]);
  };
  return { rpcs, mails, writes };
}

const checkout = (extra = {}) => dcuPay(new Request("https://www.dcunifieds.com/api/dcu-pay", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    activity_id: TRACK.id, plan: "full", email: EMAIL, parent_name: PARENT,
    student_name: STUDENT, phone: "703-555-0142", coupon: COUPON, ...extra,
  }),
}));

// The order: everything that already worked, plus the office alert
{
  const { rpcs, mails, writes } = fakeRegister();
  const r = await (await checkout()).json();
  eq("a fully comped seat takes the free path", [r.free, r.pricing.total_cents, r.pricing.coupon], [true, 0, COUPON]);

  const confirm = rpcs.find((c) => c.fn === "confirm_order");
  eq("confirm_order runs at $0 on the synthetic intent",
    [confirm.args.p_stripe_payment_intent, confirm.args.p_amount_today_cents, confirm.args.p_total_cents],
    ["free_" + HOLD, 0, 0]);
  eq("the coupon is still redeemed for what it took",
    (rpcs.find((c) => c.fn === "redeem_coupon") || {}).args, { p_code: COUPON, p_applied_cents: 69900 });

  // The family row the webhook would have minted on a paid seat.
  eq("the family row is still minted",
    (writes.find((w) => w.table === "families") || {}).body,
    { email: EMAIL, parent_name: PARENT, phone: "703-555-0142", source: "dcunifieds" });
  eq("  and the student, who is new to the register",
    (writes.find((w) => w.table === "campers") || {}).body,
    { family_id: "fam-dcu-1", name: STUDENT, source: "dcunifieds" });

  const family = mails.find((m) => m.from.startsWith("DC Unifieds <"));
  eq("the family confirmation still goes out, DCU branded", family && family.to, [EMAIL]);

  // The fix. Same sender and list as the webhook's alert, and the brand's
  // subject shape, so a comped seat sits with the paid ones in the inbox.
  const admin = mails.filter((m) => m.from.startsWith("NOVAPA Registrations <"));
  eq("exactly one office alert", admin.length, 1);
  eq("  to the admin list", admin[0] && admin[0].to, ADMINS);
  eq("  subject reads like the webhook's for this brand",
    admin[0] && admin[0].subject, `DC Unifieds registration: ${PARENT} - $0.00 (full)`);
  eq("  names the student and the track",
    admin[0] && admin[0].html.includes(STUDENT) && admin[0].html.includes(TRACK.name), true);
  eq("  shows the list price it was comped from", admin[0] && admin[0].html.includes("$699.00"), true);
  eq("  says a coupon paid for it", admin[0] && admin[0].html.includes(`coupon ${COUPON}`), true);
}

// The alert must never fail the order
{
  // The admin list is unreadable: the family is still confirmed and told.
  const { rpcs, mails, writes } = fakeRegister({ adminEmailsStatus: 500 });
  const res = await checkout();
  const r = await res.json();
  eq("admin list down: the browser still gets 200", res.status, 200);
  eq("  the order still confirms free", [r.free, r.hold_id], [true, HOLD]);
  eq("  confirm_order and the coupon still ran",
    ["confirm_order", "redeem_coupon"].every((fn) => rpcs.some((c) => c.fn === fn)), true);
  eq("  the family row is still minted", writes.some((w) => w.table === "families"), true);
  eq("  the family still gets the confirmation",
    mails.some((m) => m.from.startsWith("DC Unifieds <") && m.to[0] === EMAIL), true);
}
{
  // Resend refuses the office alert: same outcome for the family.
  const { mails } = fakeRegister({ resendFails: (b) => b.from.startsWith("NOVAPA Registrations <") });
  const res = await checkout();
  const r = await res.json();
  eq("alert send fails: the browser still gets 200", res.status, 200);
  eq("  the order still confirms free", r.free, true);
  eq("  the family still gets the confirmation",
    mails.some((m) => m.from.startsWith("DC Unifieds <") && m.to[0] === EMAIL), true);
  eq("  and no office alert was recorded as sent",
    mails.some((m) => m.from.startsWith("NOVAPA Registrations <")), false);
}

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
