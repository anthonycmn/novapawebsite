// A cart paid entirely with Day Camp Pack credits tells the office.
//
// Why this file exists: the "New registration" alert to the admin list was
// sent in exactly one place, the Stripe webhook, and a fully credited day
// camp never reaches Stripe. Order 15263 (the $349 pack, Sep 19 2026) raised
// an alert; order 15264 from the same family ninety-five seconds later (Cora,
// Heroes & Villains, $0.00) raised none, and so on roughly once a week. The
// family's confirmation, the roster write and the credit deduction all ran;
// only the office was blind. These drive the real reg-pay handler through
// its free-order branch against a fake register and pin that the alert now
// goes out, that everything that already worked still does, and that a
// failed alert never fails the family's order.
//   node tests/free-order-admin-alert.test.mjs
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
const CAMP = { id: 1962598, name: "Heroes & Villains", price_cents: 7900, category: "day_camp", offering_kind: "day_camp", sells_now: true };
const ADMINS = ["todd@novapa.org", "cj@novapa.org", "jen@novapa.org", "katie@novapa.org"];

// A fake register: one family with one camper holding pack credits, one
// active hold on one day camp. Records every RPC and every email sent.
function fakeRegister({ adminEmailsStatus = 200, resendFails = () => false } = {}) {
  const rpcs = [], mails = [];
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
      if (fn === "activity_facts") return json([CAMP]);
      if (fn === "confirm_order") return json(15264);
      if (fn === "hold_items_admin") return json([{ activity_id: CAMP.id, camper: "Cora Kouhsari" }]);
      return json(null);
    }
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
    if (path.endsWith("/admin_emails")) return json(ADMINS.map((email) => ({ email })), adminEmailsStatus);
    if (path.endsWith("/seat_offers")) return json([]);
    if (path.endsWith("/activities")) return json([CAMP]);
    return json([]);
  };
  return { rpcs, mails };
}

const checkout = (extra = {}) => regPay(new Request("https://www.northernvirginiaperformingarts.org/api/reg-pay", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    hold_id: HOLD, plan: "full", email: EMAIL, parent_name: "Mer Kouhsari", phone: "703-555-0100",
    confirm_free: true, ...extra,
  }),
}));

// ── The quote: a credited camp is $0, and the till says so before confirming
{
  fakeRegister();
  const r = await (await checkout({ confirm_free: false })).json();
  eq("a fully credited camp quotes as free", [r.free, r.pricing.total_cents, r.pricing.today_cents], [true, 0, 0]);
}

// ── The order: everything that already worked, plus the office alert ──────
{
  const { rpcs, mails } = fakeRegister();
  const r = await (await checkout()).json();
  eq("the free order confirms", r, { confirmed: true });

  const confirm = rpcs.find((c) => c.fn === "confirm_order");
  eq("confirm_order runs at $0 on the synthetic intent",
    [confirm.args.p_stripe_payment_intent, confirm.args.p_amount_today_cents, confirm.args.p_total_cents],
    ["free_" + HOLD, 0, 0]);
  eq("the roster write still happens", rpcs.some((c) => c.fn === "mark_registered" && c.args.p_email === EMAIL), true);
  const credits = rpcs.find((c) => c.fn === "apply_credit_events");
  eq("the credit is still deducted, by camper name",
    credits && credits.args.p_detail.redemptions, [{ camper: "Cora Kouhsari", day: 1, snow: 0 }]);

  const family = mails.find((m) => m.from.startsWith("NOVAPA <"));
  eq("the family confirmation still goes out", family && family.to, [EMAIL]);

  // The fix. Same sender, list and subject shape as the webhook's alert, so
  // the pack purchase and the camp it bought sit together in the inbox.
  const admin = mails.filter((m) => m.from.startsWith("NOVAPA Registrations <"));
  eq("exactly one office alert", admin.length, 1);
  eq("  to the admin list", admin[0] && admin[0].to, ADMINS);
  eq("  subject reads like the webhook's", admin[0] && admin[0].subject, "New registration: Mer Kouhsari, $0.00 (full)");
  eq("  names the camp and the camper", admin[0] && /Cora Kouhsari — Heroes &amp; Villains|Cora Kouhsari — Heroes & Villains/.test(admin[0].html), true);
  eq("  says a credit paid for it", admin[0] && /Day camp credits.*1 redeemed/.test(admin[0].html), true);
  eq("  carries the order id", admin[0] && admin[0].html.includes("order 15264"), true);
}

// ── The alert must never fail the order ────────────────────────────────────
{
  // The admin list is unreadable: the family is still confirmed and told.
  const { rpcs, mails } = fakeRegister({ adminEmailsStatus: 500 });
  const r = await (await checkout()).json();
  eq("admin list down: order still confirms", r, { confirmed: true });
  eq("  roster and credits still written", ["mark_registered", "apply_credit_events"].every((fn) => rpcs.some((c) => c.fn === fn)), true);
  eq("  family still gets the confirmation", mails.some((m) => m.from.startsWith("NOVAPA <") && m.to[0] === EMAIL), true);
}
{
  // Resend refuses the office alert: same outcome for the family.
  const { mails } = fakeRegister({ resendFails: (b) => b.from.startsWith("NOVAPA Registrations <") });
  const r = await (await checkout()).json();
  eq("alert send fails: order still confirms", r, { confirmed: true });
  eq("  family still gets the confirmation", mails.some((m) => m.from.startsWith("NOVAPA <") && m.to[0] === EMAIL), true);
}

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
