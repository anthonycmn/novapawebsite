// The Resend event webhook (netlify/functions/resend-webhook.mjs).
// Pins what earns a suppression row and what does not; nothing here touches
// the network (fetch is replaced for the run).
//   node tests/resend-webhook.test.mjs
import assert from "node:assert/strict";
import crypto from "node:crypto";
import handler from "../netlify/functions/resend-webhook.mjs";

const SECRET_B64 = Buffer.from("test-signing-key").toString("base64");
process.env.RESEND_WEBHOOK_SECRET = `whsec_${SECRET_B64}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";

let writes = [];
globalThis.fetch = async (url, init) => {
  writes.push({ url: String(url), body: JSON.parse(init.body) });
  return new Response("[]", { status: 201 });
};

function signed(event) {
  const payload = JSON.stringify(event);
  const id = "msg_test", ts = String(Math.floor(Date.now() / 1000));
  const sig = crypto.createHmac("sha256", Buffer.from(SECRET_B64, "base64")).update(`${id}.${ts}.${payload}`).digest("base64");
  return new Request("https://novapa.org/api/resend-webhook", {
    method: "POST",
    headers: { "svix-id": id, "svix-timestamp": ts, "svix-signature": `v1,${sig}` },
    body: payload,
  });
}

const bounce = (type, to) => ({
  type: "email.bounced",
  data: { to: [to], bounce: { type, subType: "General", message: "…" } },
});

let checks = 0;
// An out-of-office read back as a bounce (Transient) writes nothing. This is
// the payload SES produced for every notification to CJ, 16–18 Sep 2026.
writes = [];
let res = await handler(signed(bounce("Transient", "Anthony Cimino-Johnson <cj@novapa.org>")));
assert.equal(res.status, 200);
assert.equal(await res.text(), "ignored (Transient)");
assert.deepEqual(writes, []);
checks++;

// A payload with no bounce block is not called a hard bounce either.
writes = [];
res = await handler(signed({ type: "email.bounced", data: { to: ["someone@example.com"] } }));
assert.equal(res.status, 200);
assert.deepEqual(writes, []);
checks++;

// A Permanent bounce suppresses, and the bare address is what gets stored.
writes = [];
res = await handler(signed(bounce("Permanent", "Gone Family <gone@example.com>")));
assert.equal(res.status, 200);
assert.equal(writes.length, 1);
assert.match(writes[0].url, /email_suppressions/);
assert.deepEqual(writes[0].body, { email: "gone@example.com", scope: "marketing", reason: "hard bounce (resend)" });
checks++;

// A spam complaint always suppresses.
writes = [];
res = await handler(signed({ type: "email.complained", data: { to: ["angry@example.com"] } }));
assert.equal(res.status, 200);
assert.deepEqual(writes[0].body, { email: "angry@example.com", scope: "marketing", reason: "spam complaint (resend)" });
checks++;

// A bad signature writes nothing.
writes = [];
const req = signed(bounce("Permanent", "x@example.com"));
const tampered = new Request(req.url, { method: "POST", headers: req.headers, body: JSON.stringify(bounce("Permanent", "y@example.com")) });
res = await handler(tampered);
assert.equal(res.status, 401);
assert.deepEqual(writes, []);
checks++;

console.log(`resend-webhook: ${checks} checks pass`);
