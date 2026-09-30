// Golden carts: priceCart's answer for every legacy shape, captured before
// activity_pricing existed. A listing with no terms must price identically
// forever after. Run with --write to (re)capture; normally it compares.
import fs from "node:fs";
import { priceCart } from "../netlify/functions/reg-config.mjs";

const NOWS = ["2026-07-20T12:00:00Z", "2026-10-02T15:00:00Z", "2027-01-10T15:00:00Z"].map((s) => new Date(s));
const show = (id, price, start, extra = {}) => ({ activity_id: id, name: `Show ${id}`, price_cents: price, start, ...extra });
const CARTS = {
  summer_one: [{ show: "httyd", band: "9-12", camper: "Ann", ci: 0 }],
  summer_two_kids: [{ show: "httyd", band: "9-12", camper: "Ann", ci: 0 }, { show: "trolls", band: "5-9", camper: "Ben", ci: 1 }],
  show_one: [show(5000100, 89500, "2027-02-03", { camper: "Ann", ci: 0, offering_kind: "show" })],
  show_frozen_fixed: [show(1959789, 69500, "2026-09-15", { camper: "Ann", ci: 0, name: "Broadway Bound | Frozen, Kids" })],
  show_two_kids: [show(5000100, 89500, "2027-02-03", { camper: "Ann", ci: 0 }), show(5000100, 89500, "2027-02-03", { camper: "Ben", ci: 1 })],
  daycamp_one: [show(5000200, 7900, null, { camper: "Ann", ci: 0, offering_kind: "day_camp", name: "Day Camp" })],
  daycamp_five: [0, 1, 2, 3, 4].map((i) => show(5000200 + i, 7900, null, { camper: "Ann", ci: 0, offering_kind: "day_camp", name: "Day Camp " + i })),
  mixed_show_daycamp: [show(5000100, 89500, "2027-02-03", { camper: "Ann", ci: 0 }), show(5000200, 7900, null, { camper: "Ben", ci: 1, name: "Day Camp" })],
  coaching: [show(970001, 12000, null, { camper: "Ann", ci: 0, offering_kind: "coaching", name: "Coaching" })],
  pack: [{ activity_id: 990010, camper: "Ann", ci: 0, name: "Pack", price_cents: 34900 }],
};
const OPTS = {
  plain: {},
  insured: { insurance: true },
  coupon10: { couponPct: 10 },
  fixed50: { couponFixedCents: 5000 },
  special: { special: { waivePlanFee: true, months: 5 } },
  specialPct: { special: { pctOffList: 20 } },
};
const out = {};
for (const now of NOWS) for (const [cn, cart] of Object.entries(CARTS)) for (const plan of ["full", "deposit"]) for (const [on, o] of Object.entries(OPTS)) {
  out[`${now.toISOString().slice(0, 10)}|${cn}|${plan}|${on}`] = priceCart(JSON.parse(JSON.stringify(cart)), plan, { ...o, now });
}
const file = new URL("./activity-terms.golden.json", import.meta.url);
if (process.argv.includes("--write")) {
  fs.writeFileSync(file, JSON.stringify(out, null, 0));
  console.log(`wrote ${Object.keys(out).length} golden carts`);
} else {
  const want = JSON.parse(fs.readFileSync(file, "utf8"));
  let fails = 0;
  for (const k of Object.keys(want)) {
    if (JSON.stringify(out[k]) !== JSON.stringify(want[k])) { fails++; if (fails < 6) console.log("FAIL", k, "\n got ", JSON.stringify(out[k]), "\n want", JSON.stringify(want[k])); }
  }
  console.log(`${Object.keys(want).length - fails}/${Object.keys(want).length} golden carts unchanged`);
  if (fails) process.exit(1);
}
