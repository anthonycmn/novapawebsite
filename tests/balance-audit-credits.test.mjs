// The morning audit's third half: day camp credits.
//
// Why this file exists: on Sep 10 2026 the Skelton family bought a $349 Day
// Camp Pack and the credits landed on a camper row the parent portal does not
// read. The daily audit said "all clear" every morning for eleven days,
// correctly, because it followed orders and enrollments and a credit pack is
// neither. These drive the real handler against a fake register and pin that
// a credit finding reaches the email and the issue count, and that a database
// missing credit_audit() still gets CJ his audit.
//   node tests/balance-audit-credits.test.mjs
process.env.STRIPE_READ_KEY = "rk_test_unused";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
process.env.RESEND_API_KEY = "re_test";
delete process.env.CONTEXT;

let fails = 0;
const ok = (label, cond, extra) => {
  if (!cond) fails++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond && extra !== undefined) console.log(`      ${extra}`);
};
const json = (v, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

const CREDIT_ROW = {
  kind: "credits_not_in_portal",
  email: "mjskelton@yahoo.com",
  camper: "Cullen Skelton",
  detail: "5 day, 2 snow on camper 73a423c3, no parent portal student carries that camper id",
};

// One fake register. `credits` is what rpc/credit_audit answers with, or the
// string "missing" to answer the way PostgREST does for a function that has
// not been applied.
function install({ credits }) {
  const sent = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes("/rest/v1/orders")) return json([]);              // nothing recurring
    if (u.includes("rpc/registration_portal_audit")) return json([]); // portal agrees
    if (u.includes("rpc/credit_audit")) {
      return credits === "missing"
        ? json({ code: "PGRST202", message: "Could not find the function public.credit_audit" }, 404)
        : json(credits);
    }
    if (u.includes("api.resend.com/emails")) {
      sent.push(JSON.parse(init.body));
      return json({ id: "email_test" });
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
  return sent;
}

const { default: audit } = await import("../netlify/functions/reg-balance-audit.mjs");

// 1. A credit finding is the only thing wrong, and it still breaks "all clear".
{
  const sent = install({ credits: [CREDIT_ROW] });
  const res = await audit();
  const mail = sent[0] || {};
  ok("a credit finding is counted as a thing to look at",
    mail.subject === "Registration audit: 1 thing to look at", mail.subject);
  ok("the family and the child are named in the email",
    /Cullen Skelton/.test(mail.html || "") && /mjskelton@yahoo\.com/.test(mail.html || ""));
  ok("the section says what it costs the family",
    /cannot see or spend them/.test(mail.html || ""));
  ok("the handler reports the credit count",
    /credits 1\b/.test(await res.text()));
}

// 2. Nothing wrong anywhere: still all clear, and it says credits were read.
{
  const sent = install({ credits: [] });
  await audit();
  const mail = sent[0] || {};
  ok("no credit findings leaves the all clear intact",
    mail.subject === "Registration audit: all clear", mail.subject);
  ok("the summary says credits were checked",
    /every day camp credit against the camper the portal reads/.test(mail.html || ""));
}

// 3. credit_audit() not applied yet: the audit still sends and says so.
{
  const sent = install({ credits: "missing" });
  const res = await audit();
  const mail = sent[0] || {};
  ok("a missing credit_audit() does not cost CJ the audit", sent.length === 1);
  ok("the email says the check is not applied yet",
    /credit_audit\(\) is not applied yet/.test(mail.html || ""));
  ok("a missing function is not counted as a finding",
    mail.subject === "Registration audit: all clear", mail.subject);
  ok("the handler says credits were not deployed",
    /credits not deployed/.test(await res.text()));
}

console.log(fails ? `\n${fails} failing` : "\nall passing");
process.exit(fails ? 1 : 0);
