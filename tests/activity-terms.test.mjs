// Money terms set on a listing in the staff portal (0333) — what checkout does with them.
import { priceCart, termsPlanDates, classLadder, classMonthlyCents, classAddedMonthlyCents, CLASS_BUNDLE_CENTS } from "../netlify/functions/reg-config.mjs";

let fails = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};
const NOW = new Date("2026-10-02T15:00:00Z");
const day = (sec) => new Date(sec * 1000).toISOString().slice(0, 10);
const line = (terms, extra = {}) => ({ activity_id: 5000500, name: "Winter Show", price_cents: 99500, start: "2027-02-01", camper: "Ann", ci: 0, offering_kind: "show", terms, ...extra });

// installment calendar
{
  const p = priceCart([line({ installment_dates: ["2026-09-01", "2026-11-15", "2026-12-15"] })], "deposit", { now: NOW });
  eq("terms calendar: past date dropped, others kept", p.installmentDatesUTC.map(day), ["2026-11-15", "2026-12-15"]);
  eq("terms calendar: even split + 5% fee, rounding today", p.todayCents + p.installmentCents * 2, 104475);
  eq("terms calendar: total includes fee", p.totalCents, 104475);
}
{
  const a = line({ installment_dates: ["2026-11-01", "2026-12-01", "2027-01-01"] });
  const b = line({ installment_dates: ["2026-11-01", "2026-12-01"] }, { camper: "Ben", ci: 1 });
  eq("two calendars: the one ending first wins", termsPlanDates([a, b], NOW).map(day), ["2026-11-01", "2026-12-01"]);
}
// deposit
{
  const p = priceCart([line({ installment_dates: ["2026-11-01", "2026-12-01", "2027-01-01"], deposit_cents: 20000, plan_fee_pct: 0 })], "deposit", { now: NOW });
  eq("deposit: no fee when the listing sets 0%", p.planFeeCents, 0);
  eq("deposit: installments are the rest over three", p.installmentCents, Math.floor(79500 / 3));
  eq("deposit: today is deposit + rounding", p.todayCents, 20000 + (79500 - Math.floor(79500 / 3) * 3));
  eq("deposit: every cent collected", p.todayCents + p.installmentCents * 3, 99500);
}
// early bird
{
  const t = { early_bird_price_cents: 89500, early_bird_ends_at: "2026-10-15T23:59:59-04:00" };
  eq("early bird: before the end", priceCart([line(t)], "full", { now: NOW }).totalCents, 89500);
  eq("early bird: after the end", priceCart([line(t)], "full", { now: new Date("2026-10-20T12:00:00Z") }).totalCents, 99500);
  eq("early bird: insurance still on list price", priceCart([line(t)], "full", { now: NOW, insurance: true }).insuranceCents, 9950);
}
// sibling
{
  const cart = [line({ sibling_pct: 10 }), line({ sibling_pct: 10 }, { camper: "Ben", ci: 1 })];
  eq("sibling: listing's own 10% on the second child", priceCart(cart, "full", { now: NOW }).items.map((i) => i.unit), [99500, 89550]);
  const house = [line({}), line({}, { camper: "Ben", ci: 1 })];
  eq("sibling: blank = house 5%", priceCart(house, "full", { now: NOW }).items.map((i) => i.unit), [99500, 94525]);
}
// insurance off
eq("insurance off: nothing insurable", priceCart([line({ insurance_eligible: false })], "full", { now: NOW, insurance: true }).insuranceCents, 0);
// plan off / plan required
{
  const cart = [line({ allow_plan: false }), line({ installment_dates: ["2026-11-01", "2026-12-01"] }, { camper: "Ben", ci: 1, activity_id: 5000501 })];
  const p = priceCart(cart, "deposit", { now: NOW });
  eq("plan off: that line is paid today in full", p.todayCents >= 94525, true);
  eq("plan off: collected in total", p.todayCents + p.installmentCents * p.installmentDatesUTC.length, p.totalCents);
  eq("pay-in-full off: flagged", priceCart([line({ allow_pay_in_full: false })], "full", { now: NOW }).planRequired, true);
  eq("pay-in-full on: not flagged", priceCart([line({})], "full", { now: NOW }).planRequired, undefined);
}
// class ladder from settings
eq("ladder: bad row falls back", classLadder([5, 1]), CLASS_BUNDLE_CENTS);
eq("ladder: null falls back", classLadder(null), CLASS_BUNDLE_CENTS);
eq("ladder: good row used", classLadder([0, 10000, 17000, 21000]), [0, 10000, 17000, 21000]);
eq("ladder: 2 classes at the new rate", classMonthlyCents(2, [0, 10000, 17000, 21000]), 17000);
eq("ladder: 4 classes adds the third step", classMonthlyCents(4, [0, 10000, 17000, 21000]), 25000);
eq("ladder: added class for a returning student", classAddedMonthlyCents(1, 1, [0, 10000, 17000, 21000]), 7000);
eq("ladder: default unchanged", classMonthlyCents(3), 18000);

console.log(fails ? `\n${fails} FAILED` : "\nall activity-terms tests passed");
if (fails) process.exit(1);
