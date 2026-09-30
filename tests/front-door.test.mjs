// The parent-portal front door (CJ, 30 Sep 2026): one card entry pays a class
// and a show as two charges. The second charge may only use the card the
// first one saved, for the same family, in the same checkout, within the hour.
import { secondChargeCard } from "../netlify/functions/reg-frontdoor.mjs";
import { confirmationHtml } from "../netlify/functions/reg-email.mjs";

let fails = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};
const CART = "33333333-3333-4333-8333-333333333333";
const NOW = 1_800_000_000;
const pi = (o = {}) => ({ status: "succeeded", created: NOW - 60, customer: "cus_1", payment_method: "pm_1",
  metadata: { email: "sam@example.com", cart_id: CART }, ...o });
const ask = (p, o = {}) => secondChargeCard(p, { email: "Sam@Example.com", cartId: CART, nowSec: NOW, ...o });

eq("the first charge's card, for the same family and cart", ask(pi()), { customer: "cus_1", pm: "pm_1" });
eq("expanded objects are read by id", ask(pi({ customer: { id: "cus_2" }, payment_method: { id: "pm_2" } })), { customer: "cus_2", pm: "pm_2" });
eq("refused: the first charge did not succeed", ask(pi({ status: "requires_payment_method" })), null);
eq("refused: another family's email", ask(pi({ metadata: { email: "other@example.com", cart_id: CART } })), null);
eq("refused: another cart", ask(pi({ metadata: { email: "sam@example.com", cart_id: "44444444-4444-4444-8444-444444444444" } })), null);
eq("refused: no cart id at all", ask(pi({ metadata: { email: "sam@example.com" } })), null);
eq("refused: caller sent no cart id", ask(pi(), { cartId: "" }), null);
eq("refused: no card was saved", ask(pi({ payment_method: null })), null);
eq("refused: more than an hour old", ask(pi({ created: NOW - 3601 })), null);
eq("refused: nothing", ask(null), null);

const html = confirmationHtml({ email: "a@b.c", order_desc: "Ann — Tap", total_cents: "9000", portal_url: "https://portal.novapa.org/welcome/abc\"x" }, { amount_received: 9000 }, []);
eq("receipt: portal button when a link came back", html.includes("Open your Parent Portal"), true);
eq("receipt: the link is escaped", html.includes('welcome/abc&quot;x'), true);
const old = confirmationHtml({ email: "a@b.c", order_desc: "x", total_cents: "1" }, { amount: 1 }, []);
eq("receipt: old-page orders keep My NOVAPA", old.includes("View or update in My NOVAPA"), true);
const bad = confirmationHtml({ email: "a@b.c", order_desc: "x", total_cents: "1", portal_url: "javascript:alert(1)" }, { amount: 1 }, []);
eq("receipt: a non-https link is ignored", bad.includes("javascript:"), false);

console.log(fails ? `\n${fails} FAILED` : "\nall front-door tests passed");
if (fails) process.exit(1);
