// The class bundle ladder (CJ, Sep 14 2026): "two classes is $150 and 3
// classes is $180". The deltas are what the checkout dangles at a camper in
// one class, so they are pinned here too — a change to the ladder must
// change the nudge copy with it.
import { classMonthlyCents, classNextDeltaCents, classAddedMonthlyCents, CLASS_BUNDLE_CENTS } from "../netlify/functions/reg-config.mjs";

let fails = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

eq("no classes, no charge", classMonthlyCents(0), 0);
eq("1 class $90/mo", classMonthlyCents(1), 9000);
eq("2 classes $150/mo", classMonthlyCents(2), 15000);
eq("3 classes $180/mo", classMonthlyCents(3), 18000);
eq("4 classes keep the 3rd-class step (+$30)", classMonthlyCents(4), 21000);
eq("5 classes", classMonthlyCents(5), 24000);
eq("the ladder is the source of the steps", CLASS_BUNDLE_CENTS, [0, 9000, 15000, 18000]);

eq("first class costs $90", classNextDeltaCents(0), 9000);
eq("second class is $60 more", classNextDeltaCents(1), 6000);
eq("third class is $30 more", classNextDeltaCents(2), 3000);
eq("fourth class is $30 more", classNextDeltaCents(3), 3000);
eq("delta never negative", classNextDeltaCents(-2), 9000);

// A returning family: the added classes are their own subscription at what
// they add to the bundle; the running subscription is untouched.
eq("returning: second class alone is $60/mo", classAddedMonthlyCents(1, 1), 6000);
eq("returning: third class alone is $30/mo", classAddedMonthlyCents(2, 1), 3000);
eq("returning: second and third together are $90/mo", classAddedMonthlyCents(1, 2), 9000);
eq("returning: a fourth is $30/mo", classAddedMonthlyCents(3, 1), 3000);
eq("nothing prior: same as the plain bundle", classAddedMonthlyCents(0, 2), classMonthlyCents(2));
eq("prior + new never sums past the bundle", classMonthlyCents(1) + classAddedMonthlyCents(1, 1), classMonthlyCents(2));

// The checkout client carries a copy of the ladder (register/index.html
// only draws numbers; reg-pay reprices) — it must match to the cent.
import { readFileSync } from "node:fs";
const html = readFileSync(new URL("../register/index.html", import.meta.url), "utf8");
const m = html.match(/var CLASS_BUNDLE = \[([^\]]+)\]/);
eq("register/index.html mirrors CLASS_BUNDLE_CENTS", m && m[1].split(",").map((s) => Number(s.trim())), CLASS_BUNDLE_CENTS);
// the page's own script spells the middle dot as the six-character escape ·
eq("the Classes tab quotes the same ladder", html.includes("<b>2 classes $150/mo</b> \\u00b7 <b>3 classes $180/mo</b> per student"), true);

if (fails) { console.error(`\n${fails} failing`); process.exit(1); }
console.log("\nclass bundle: all good");
