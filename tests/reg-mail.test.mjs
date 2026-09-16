// The shared transactional transport (netlify/functions/reg-mail.mjs).
// Pins the routing rule and the Resend payload; nothing here touches the
// network (fetch is replaced for the run).
//   node tests/reg-mail.test.mjs
import assert from "node:assert/strict";
import { sendMail, mailTransport, mailConfigured, fromAddr } from "../netlify/functions/reg-mail.mjs";

const saved = { ...process.env };
function env(vars) {
  for (const k of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "FROM_ADDR", "RESEND_API_KEY", "RESEND_FROM_ADDR"]) delete process.env[k];
  Object.assign(process.env, vars);
}

let calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  calls.push({ url, init, body: JSON.parse(init.body) });
  return new Response(JSON.stringify({ id: "re_123" }), { status: 200, headers: { "Content-Type": "application/json" } });
};

try {
  // Nothing set: no transport, and sendMail says so instead of guessing.
  env({});
  assert.equal(mailTransport(), null);
  assert.equal(mailConfigured(), false);
  await assert.rejects(() => sendMail({ fromName: "NOVAPA", to: "a@b.c", subject: "x", text: "y" }), /not configured/);

  // The cutover shape: SMTP_HOST/USER/FROM_ADDR left over, no SMTP_PASS, a
  // Resend key present. That is the HTTP API from the verified domain.
  env({ SMTP_HOST: "smtp.resend.com", SMTP_USER: "resend", FROM_ADDR: "info@novapa.org", RESEND_API_KEY: "re_test" });
  assert.equal(mailTransport(), "resend");
  assert.equal(fromAddr(), "hello@mail.novapa.org");
  calls = [];
  const r = await sendMail({
    fromName: "NOVAPA Box Office", to: "family@example.com", subject: "Your tickets", html: "<p>hi</p>",
  });
  assert.equal(r.transport, "resend");
  assert.equal(r.id, "re_123");
  assert.equal(r.messageId, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal(calls[0].init.headers.Authorization, "Bearer re_test");
  assert.deepEqual(calls[0].body, {
    from: "NOVAPA Box Office <hello@mail.novapa.org>",
    to: ["family@example.com"],
    reply_to: "info@novapa.org",
    subject: "Your tickets",
    html: "<p>hi</p>",
  });

  // A caller's reply-to, cc list, comma-joined to, headers and text all ride
  // along; a legacy "Name <addr>" from keeps its name and loses its address.
  calls = [];
  await sendMail({
    from: "NOVAPA Careers <old@gmail.com>", to: "cj@novapa.org, todd@novapa.org", cc: ["jen@novapa.org"],
    replyTo: "applicant@example.com", subject: "s", text: "t",
    headers: { "In-Reply-To": "<abc@x>", References: "<abc@x>" },
  });
  assert.deepEqual(calls[0].body, {
    from: "NOVAPA Careers <hello@mail.novapa.org>",
    to: ["cj@novapa.org", "todd@novapa.org"],
    cc: ["jen@novapa.org"],
    reply_to: "applicant@example.com",
    subject: "s",
    text: "t",
    headers: { "In-Reply-To": "<abc@x>", References: "<abc@x>" },
  });

  // A Resend refusal surfaces as an error the caller's try/catch logs.
  globalThis.fetch = async () => new Response("{\"message\":\"domain not verified\"}", { status: 403 });
  await assert.rejects(() => sendMail({ fromName: "N", to: "a@b.c", subject: "x", text: "y" }), /resend 403/);

  // SMTP_PASS present: SMTP wins even with a Resend key beside it, from the
  // env mailbox. (No SMTP send is attempted here.)
  env({ SMTP_USER: "jason@novapa.org", SMTP_PASS: "app-password", FROM_ADDR: "info@novapa.org", RESEND_API_KEY: "re_test" });
  assert.equal(mailTransport(), "smtp");
  assert.equal(fromAddr(), "info@novapa.org");
  env({ SMTP_USER: "jason@novapa.org", SMTP_PASS: "app-password" });
  assert.equal(fromAddr(), "jason@novapa.org");

  // A password with no user is not a transport.
  env({ SMTP_PASS: "app-password" });
  assert.equal(mailTransport(), null);

  console.log("reg-mail: 6 checks pass");
} finally {
  globalThis.fetch = realFetch;
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
}
