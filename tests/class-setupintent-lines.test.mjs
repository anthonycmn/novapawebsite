// What a class order's lines record when nothing was charged at checkout.
//
// Why this file exists: six class orders on the SetupIntent path (8fe324de,
// a13bb32d, b97326ba, cc7db6ab, d30f916f, d6d5f870) record $0 against
// $510.00 a month of real billing. The fix puts the monthly price on the
// order LINES and deliberately leaves orders.total_cents at $0, because the
// parent portal reads total minus paid as the family's balance and a $90
// total would tell them they owe $90 forever. These pin both halves.
import { orderUnitPrices } from "../netlify/functions/reg-webhook.mjs";

let fails = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

// The metadata reg-pay puts on a SetupIntent class enrollment.
const setupMeta = (o) => ({
  plan: "subscription", total_cents: "0", n_items: "1",
  unit_prices: "[0]", monthly_items: "[9000]", ...o,
});

// ── The SetupIntent path records the monthly price ─────────────────────────
eq("one class, free class covers the month: the line records $90",
  orderUnitPrices(setupMeta({}), true), [9000]);
eq("a two-class bundle keeps each line's share of the $150",
  orderUnitPrices(setupMeta({ n_items: "2", unit_prices: "[0,0]", monthly_items: "[7500,7500]" }), true), [7500, 7500]);
eq("a second class at the next bundle step ($60, like d6d5f870) records $60",
  orderUnitPrices(setupMeta({ monthly_items: "[6000]" }), true), [6000]);

// ── And never puts a price on the wrong line ───────────────────────────────
eq("monthly items that do not line up leave the lines alone",
  orderUnitPrices(setupMeta({ n_items: "2", unit_prices: "[0,0]", monthly_items: "[9000]" }), true), [0, 0]);
eq("unreadable monthly items leave the lines alone",
  orderUnitPrices(setupMeta({ monthly_items: "not json" }), true), [0]);

// ── Nothing else changes ───────────────────────────────────────────────────
eq("a PaymentIntent class order keeps what it charged (mid-month $60 of $90)",
  orderUnitPrices(setupMeta({ unit_prices: "[6000]" }), false), [6000]);
eq("a camp or show order on a PaymentIntent is untouched",
  orderUnitPrices({ plan: "full", unit_prices: "[69500,7900]", monthly_items: "[]" }, false), [69500, 7900]);
eq("a SetupIntent that is not a class plan is untouched",
  orderUnitPrices({ plan: "full", unit_prices: "[0]", monthly_items: "[9000]" }, true), [0]);
eq("old intents with no unit_prices still fall back to unit_cents per item",
  orderUnitPrices({ plan: "full", n_items: "2", unit_cents: "7900" }, false), [7900, 7900]);

if (fails) {
  console.error(`\n${fails} failing`);
  process.exit(1);
}
console.log("\nall SetupIntent line price checks pass");
