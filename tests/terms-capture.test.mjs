// reg-terms.mjs: what a family agreed to is read off the published pages,
// and the daily watch names the sections that changed between versions.
import { readFileSync } from "node:fs";
import { extractTerms, extractPolicies, extractCheckbox, hashTerms, changedSections } from "../netlify/functions/reg-terms.mjs";
import { noticeBody } from "../netlify/functions/reg-terms-watch.mjs";

let fails = 0;
const ok = (label, cond) => { if (!cond) fails++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

const terms = extractTerms(read("terms.html"));
const policies = extractPolicies(read("policies.html"));
const checkbox = extractCheckbox(read("register/index.html"));

ok("terms text read from <main>", terms && terms.includes("Class-Action Waiver"));
ok("terms text leaves out the footer and scripts", terms && !/posthog|<script/i.test(terms));
ok("policies text is the Terms & Conditions section", policies && policies.includes("Refund Policy"));
ok("policies text stops before the Privacy Policy", policies && !policies.includes("Information We Collect"));
ok("policies text carries section 19", policies && policies.includes("in effect at the time of registration or purchase govern"));
ok("entities are decoded", policies && policies.includes("child’s") && !policies.includes("&rsquo;"));
ok("checkbox sentence read", checkbox && checkbox.startsWith("I agree to NOVAPA's terms") && checkbox.includes("all sales are final"));
ok("markup that moved reads as null, not as empty text", extractPolicies("<section id=\"privacy\">x</section>") === null);

const v1 = { terms_text: terms, policies_text: policies, checkbox_text: checkbox };
const h1 = hashTerms(terms, policies, checkbox);
ok("hash is stable", h1 === hashTerms(terms, policies, checkbox));

const v2 = { ...v1, policies_text: policies.replace("$900", "$950") };
ok("hash moves when one word moves", hashTerms(v2.terms_text, v2.policies_text, v2.checkbox_text) !== h1);
const ch = changedSections(v1, v2);
ok(`a microphone price edit names only Microphones (${JSON.stringify(ch)})`, ch.length === 1 && ch[0] === "Microphones");

const v3 = { ...v1, policies_text: policies + "\n## 20. Parking\nPark in the lot." };
ok("a new section is named as new", changedSections(v1, v3).includes("Parking (new)"));
ok("a checkbox edit is named", changedSections(v1, { ...v1, checkbox_text: "I agree." }).includes("The agreement checkbox at checkout"));
ok("same text names nothing", changedSections(v1, { ...v1 }).length === 0);

const body = noticeBody(["Microphones"]);
ok("notice lists the section as a bullet", body.includes("* Microphones"));
ok("notice links the policies page as a button", /^\[READ THE UPDATED TERMS\]\(https:\/\/novapa\.org\/policies\)$/m.test(body));
ok("notice has no em dash", !body.includes("—"));

if (fails) { console.log(`\n${fails} failed`); process.exit(1); }
console.log("\nall passed");
