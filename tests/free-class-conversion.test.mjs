// Which free-class trial a paid order converts: convert_free_class_trials,
// run for real against Postgres (PGlite, in process, no server).
//
// Why this file exists: booking 19 (Katelyn Johansen) stayed "attended" after
// her family bought the class she trialed, because the order said "Katy" and
// the function matched on first name alone. The rule is now the listing, with
// the first name as the tiebreaker when a family has two children booked on
// it, and the first name alone still converts a trial into a show. These pin
// each branch, including the ones that must NOT convert.
//
// CONVERSION_SQL points it at another file, which is how the old live
// function was shown to fail the Johansen case before the fix.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const file = process.env.CONVERSION_SQL || new URL("../db/free-class-conversion-listing.sql", import.meta.url);
const SQL = readFileSync(file, "utf8");

let fails = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table public.orders (id uuid primary key, email text, created_at timestamptz);
  create table public.order_items (id bigserial primary key, order_id uuid, activity_id bigint, camper_name text);
  create table public.free_class_bookings (
    id bigint primary key, email text, child_name text, activity_id bigint,
    status text, created_at timestamptz, converted_order_id uuid, converted_at timestamptz);
`);
await db.exec(SQL);

const TRIPLE_THREAT = 1960898, FROZEN_JR = 1959789, ACTING_5_8 = 1960867;
let seq = 0;
const uuid = () => `00000000-0000-0000-0000-${String(++seq).padStart(12, "0")}`;

async function reset() {
  await db.exec("truncate public.orders, public.order_items, public.free_class_bookings");
}
async function book(id, email, child, activity, { status = "attended", at = "2026-09-14" } = {}) {
  await db.query(
    "insert into public.free_class_bookings (id, email, child_name, activity_id, status, created_at) values ($1,$2,$3,$4,$5,$6)",
    [id, email, child, activity, status, at]);
}
async function order(email, lines, at = "2026-09-20") {
  const id = uuid();
  await db.query("insert into public.orders values ($1,$2,$3)", [id, email, at]);
  for (const [camper, activity] of lines) {
    await db.query("insert into public.order_items (order_id, activity_id, camper_name) values ($1,$2,$3)", [id, activity, camper]);
  }
  return id;
}
const convert = async (id) =>
  (await db.query("select public.convert_free_class_trials($1) as n", [id])).rows[0].n;
const statusOf = async (id) =>
  (await db.query("select status, converted_order_id from public.free_class_bookings where id = $1", [id])).rows[0];

// ── Katelyn and Katy: the case that was missed ─────────────────────────────
await reset();
await book(19, "ali.g.johansen@gmail.com", "Katelyn", TRIPLE_THREAT);
let o = await order("Ali.G.Johansen@gmail.com", [["Katy Johansen", TRIPLE_THREAT]]);
eq("a nickname on the listing she trialed converts her", await convert(o), 1);
eq("booking 19 reads converted, against that order", await statusOf(19), { status: "converted", converted_order_id: o });
eq("a redelivered webhook converts nothing twice", await convert(o), 0);

// ── The first name still converts a trial into a show (the Sep 18 rule) ────
await reset();
await book(14, "parent@example.com", "Grace", ACTING_5_8);
o = await order("parent@example.com", [["Grace Kontitsis", FROZEN_JR]]);
eq("trial a class, buy a show, same child: converts", await convert(o), 1);

// ── Two children on one listing: the first name decides ────────────────────
await reset();
await book(26, "gkki2@yahoo.com", "Soliyana", ACTING_5_8);
await book(27, "gkki2@yahoo.com", "Liya", ACTING_5_8);
o = await order("gkki2@yahoo.com", [["Liya Kifle", ACTING_5_8]]);
eq("two kids trialed, one enrolled: exactly one converts", await convert(o), 1);
eq("the enrolled child's trial is the one converted", (await statusOf(27)).status, "converted");
eq("her sister's trial is left alone", (await statusOf(26)).status, "attended");

await reset();
await book(26, "gkki2@yahoo.com", "Soliyana", ACTING_5_8);
await book(27, "gkki2@yahoo.com", "Liya", ACTING_5_8);
o = await order("gkki2@yahoo.com", [["Soli Kifle", ACTING_5_8]]);
eq("two kids on the listing and a name matching neither: nothing is guessed", await convert(o), 0);

// ── Things that must never convert ─────────────────────────────────────────
await reset();
await book(30, "a@example.com", "Katelyn", TRIPLE_THREAT);
o = await order("a@example.com", [["Katy A", FROZEN_JR]]);
eq("different listing and a different first name: no match", await convert(o), 0);

await reset();
await book(31, "a@example.com", "Katelyn", TRIPLE_THREAT);
o = await order("someone.else@example.com", [["Katelyn A", TRIPLE_THREAT]]);
eq("another family's order never converts this trial", await convert(o), 0);

await reset();
await book(32, "a@example.com", "Katelyn", TRIPLE_THREAT, { at: "2026-09-25" });
o = await order("a@example.com", [["Katelyn A", TRIPLE_THREAT]], "2026-09-20");
eq("a trial booked after the order did not produce it", await convert(o), 0);

await reset();
await book(33, "a@example.com", "Katelyn", TRIPLE_THREAT, { status: "cancelled" });
o = await order("a@example.com", [["Katelyn A", TRIPLE_THREAT]]);
eq("a cancelled trial never converts", await convert(o), 0);

await reset();
await book(34, "a@example.com", "Katelyn", TRIPLE_THREAT, { status: "no_show" });
o = await order("a@example.com", [["Katy A", TRIPLE_THREAT]]);
eq("a no show is not a conversion", await convert(o), 0);

// A cancelled sibling visit does not make the listing ambiguous.
await reset();
await book(35, "a@example.com", "Katelyn", TRIPLE_THREAT);
await book(36, "a@example.com", "Sam", TRIPLE_THREAT, { status: "cancelled" });
o = await order("a@example.com", [["Katy A", TRIPLE_THREAT]]);
eq("a cancelled sibling visit leaves the listing to one child", await convert(o), 1);

await db.close();
if (fails) {
  console.error(`\n${fails} failing`);
  process.exit(1);
}
console.log("\nall free-class conversion checks pass");
