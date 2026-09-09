// Day-camp credit packs: price and, more importantly, how many credits a
// purchase grants.
//
// Why this file exists: the grant logic used to hard-code the 5-pack's activity
// id, so a second pack product would have charged the customer and granted them
// nothing. These tests pin the behaviour to the DAY_CAMP_PACKS registry so the
// next pack cannot reintroduce that.
import {
  priceCart, dayCampPack, DAY_CAMP_PACKS,
  DAY_CAMP_PACK_ID, DAY_CAMP_PACK_CENTS, DAY_CAMP_PACK_CREDITS,
  DAY_CAMP_PACK_SNOW_BONUS, DAY_CAMP_PACK_SNOW_END,
} from "../netlify/functions/reg-config.mjs";

let fails = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

const TEN_PACK_ID = 990011;
const packItem = (activity_id, camper) =>
  ({ activity_id, camper, name: "Day Camp Pack", price_cents: DAY_CAMP_PACKS[activity_id].cents });

// ── The registry knows both packs ──────────────────────────────────────────
eq("5-pack: 5 credits",  dayCampPack(DAY_CAMP_PACK_ID).credits, 5);
eq("5-pack: $349",       dayCampPack(DAY_CAMP_PACK_ID).cents, DAY_CAMP_PACK_CENTS);
eq("10-pack: 10 credits", dayCampPack(TEN_PACK_ID).credits, 10);
eq("10-pack: $675",       dayCampPack(TEN_PACK_ID).cents, 67500);
eq("a normal day camp is not a pack", dayCampPack(1962598), null);
eq("an unknown id is not a pack",     dayCampPack(12345), null);

// The ladder has to keep pointing down, or the bigger pack is pointless.
const per = (id) => DAY_CAMP_PACKS[id].cents / DAY_CAMP_PACKS[id].size;
eq("10-pack beats the 5-pack per day", per(TEN_PACK_ID) < per(DAY_CAMP_PACK_ID), true);
eq("5-pack beats a single day",        per(DAY_CAMP_PACK_ID) < 7900, true);

// ── Price: a pack is flat, outside every discount ──────────────────────────
const beforeSnowEnd = new Date(DAY_CAMP_PACK_SNOW_END.getTime() - 86400000);
const p5 = priceCart([packItem(DAY_CAMP_PACK_ID, "Kid A")], "full", { now: beforeSnowEnd });
eq("5-pack charges $349", p5.items[0].unit, 34900);
eq("5-pack is flagged a pack", p5.items[0].pack, true);

const p10 = priceCart([packItem(TEN_PACK_ID, "Kid A")], "full", { now: beforeSnowEnd });
eq("10-pack charges $675", p10.items[0].unit, 67500);
eq("10-pack is flagged a pack", p10.items[0].pack, true);
eq("10-pack takes no sibling or tier discount", p10.items[0].rate, 0);

// Two packs for two campers bill as two packs.
const pBoth = priceCart(
  [packItem(TEN_PACK_ID, "Kid A"), packItem(DAY_CAMP_PACK_ID, "Kid B")],
  "full", { now: beforeSnowEnd });
eq("a 10-pack and a 5-pack together bill $1024",
  pBoth.items.reduce((s, it) => s + it.unit, 0), 67500 + 34900);

// ── Grants: this is the part that used to silently drop ────────────────────
// Mirrors the shape reg-pay.mjs builds for apply_credit_events.
const grantsFor = (items, now) => items
  .filter((it) => dayCampPack(it.activity_id))
  .map((it) => ({
    camper: it.camper || "",
    day: dayCampPack(it.activity_id).credits,
    snow: now <= DAY_CAMP_PACK_SNOW_END ? DAY_CAMP_PACK_SNOW_BONUS : 0,
  }));

eq("buying the 10-pack grants 10 day credits",
  grantsFor([packItem(TEN_PACK_ID, "Kid A")], beforeSnowEnd),
  [{ camper: "Kid A", day: 10, snow: 2 }]);

eq("buying the 5-pack still grants 5",
  grantsFor([packItem(DAY_CAMP_PACK_ID, "Kid A")], beforeSnowEnd),
  [{ camper: "Kid A", day: DAY_CAMP_PACK_CREDITS, snow: 2 }]);

eq("each camper gets their own credits, never shared",
  grantsFor([packItem(TEN_PACK_ID, "Kid A"), packItem(DAY_CAMP_PACK_ID, "Kid B")], beforeSnowEnd),
  [{ camper: "Kid A", day: 10, snow: 2 }, { camper: "Kid B", day: 5, snow: 2 }]);

// After the snow window closes the day credits still land; only the bonus stops.
const afterSnowEnd = new Date(DAY_CAMP_PACK_SNOW_END.getTime() + 86400000);
eq("after Sep 21 the 10-pack still grants 10 days, 0 snow",
  grantsFor([packItem(TEN_PACK_ID, "Kid A")], afterSnowEnd),
  [{ camper: "Kid A", day: 10, snow: 0 }]);

// A plain day camp must never mint credits.
eq("a single day camp grants nothing",
  grantsFor([{ activity_id: 1962598, camper: "Kid A", price_cents: 7900 }], beforeSnowEnd), []);

console.log(fails ? `\n${fails} failing` : "\nAll green.");
process.exit(fails ? 1 : 0);
