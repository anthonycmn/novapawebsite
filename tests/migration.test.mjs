// Verify db/private-lessons.sql against a real Postgres before it goes near Supabase.
//
// Needs a throwaway cluster on port 55432. These are not project dependencies —
// install them only when you want to re-check the migration:
//
//   npm i --no-save embedded-postgres pg
//   BIN=node_modules/@embedded-postgres/*/native/bin
//   echo postgres > pw.txt
//   $BIN/initdb.exe -D pgdata -U postgres --pwfile=pw.txt -E UTF8 --locale=C
//   $BIN/pg_ctl.exe -D pgdata -o "-p 55432 -c listen_addresses=127.0.0.1" -l pg.log start
//   node tests/migration.test.mjs
//   $BIN/pg_ctl.exe -D pgdata stop
//
// -E UTF8 is not optional. initdb follows the system locale, so on a Windows
// box it lands on WIN1252 and the migration dies on the arrows in its own
// comments — nothing to do with the SQL. Supabase is UTF8.
//
// It drops and recreates `public`, so point it at a scratch cluster only —
// never at Supabase.
import { readFileSync } from "node:fs";
import pg from "pg";

const SQL = readFileSync(new URL("../db/private-lessons.sql", import.meta.url), "utf8");
const cfg = { host: "127.0.0.1", port: 55432, user: "postgres", password: "postgres", database: "postgres" };

let fails = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};
const db = new pg.Client(cfg);
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const val = async (sql, params) => Object.values((await one(sql, params)) || { v: null })[0];

// Does a statement fail with a permission error?
async function denied(sql, role) {
  const c = new pg.Client(cfg);
  await c.connect();
  try {
    await c.query(`set role ${role}`);
    await c.query(sql);
    return false;
  } catch (e) {
    return /permission denied|must be owner/i.test(e.message);
  } finally {
    await c.end();
  }
}

await db.connect();

// ── A clean database that looks like the Supabase project ───────────────────
await db.query(`
  drop schema public cascade; create schema public;
  grant usage on schema public to public;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  end $$;
  grant usage on schema public to anon, authenticated;
  create table activities (
    id bigint primary key, name text not null, category text, price_cents integer,
    schedule_name text, age_range text, description text,
    bookable boolean default true, bb_gated boolean default false, capacity integer
  );
`);

// ── Apply it ────────────────────────────────────────────────────────────────
try { await db.query(SQL); eq("migration applies cleanly", true, true); }
catch (e) { eq("migration applies cleanly", e.message, "no error"); process.exit(1); }

try { await db.query(SQL); eq("migration is idempotent (ran twice)", true, true); }
catch (e) { eq("migration is idempotent (ran twice)", e.message, "no error"); }

eq("4 coaches seeded", Number(await val("select count(*) from lesson_teachers")), 4);
eq("23 slots seeded", Number(await val("select count(*) from lesson_slots")), 23);
eq("no duplicate slots after re-run",
  Number(await val("select count(*) from (select teacher_id,weekday,start_time from lesson_slots group by 1,2,3 having count(*)>1) x")), 0);
eq("coach names",
  (await db.query("select name from lesson_teachers order by sort_order")).rows.map(r => r.name),
  ["Tony Cimino-Johnson", "Colton Sorenson", "Ryyana Cunningham", "Katie Hamburger"]);
eq("all 7 private-lesson products priced",
  (await db.query("select id, price_cents from activities where id between 970601 and 970703 order by id")).rows
    .map(r => `${r.id}=$${r.price_cents / 100}`),
  ["970601=$1530", "970602=$1428", "970603=$1760", "970604=$1642",
   "970701=$403", "970702=$759", "970703=$1208"]);
eq("every price is a whole dollar",
  Number(await val("select count(*) from activities where id between 970601 and 970703 and price_cents % 100 <> 0")), 0);
eq("rates: Tony $138 premium, the others $120",
  (await db.query("select rate_cents from lesson_teachers order by sort_order")).rows.map(r => r.rate_cents),
  [13800, 12000, 12000, 12000]);
eq("Katie is studio-only",
  await val("select modes from lesson_teachers where slug='katie-hamburger'"), ["studio"]);

// ── The lock ────────────────────────────────────────────────────────────────
const SLOT = Number(await val(`select s.id from lesson_slots s join lesson_teachers t on t.id=s.teacher_id
  where t.slug='tony-cimino-johnson' and s.weekday=3 and s.start_time='17:30'`));
const TERM = ["2026-09-16","2026-09-23","2026-09-30","2026-10-07","2026-10-14","2026-10-21","2026-10-28",
  "2026-11-04","2026-11-11","2026-11-18","2026-12-02","2026-12-09","2026-12-16","2027-01-06","2027-01-13"];
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";
const hold = (dates, id, slot = SLOT) => val("select lesson_hold($1,$2::date[],$3)", [slot, dates, id]);
const heldOn = async (slot = SLOT) => Number(await val("select count(*) from lesson_bookings where slot_id=$1", [slot]));

eq("family A claims the term", (await hold(TERM, A)).ok, true);
eq("  15 rows written", await heldOn(), 15);
const b1 = await hold(TERM, B);
eq("family B is refused", b1.ok, false);
eq("  reason", b1.reason, "slot_taken");
eq("  and told which date", b1.first_clash, "2026-09-16");
eq("  nothing extra written", await heldOn(), 15);
eq("partial overlap also refused", (await hold(["2026-12-02","2026-12-09"], B)).ok, false);
eq("  still only A's rows", await heldOn(), 15);
eq("  every row still A's",
  Number(await val("select count(distinct hold_id) from lesson_bookings where slot_id=$1", [SLOT])), 1);

eq("a genuinely free run is allowed", (await hold(["2026-08-12","2026-08-19","2026-08-26"], C)).ok, true);
eq("  18 rows now", await heldOn(), 18);

eq("A re-holding the same dates is fine", (await hold(TERM, A)).ok, true);
eq("  still 18 rows", await heldOn(), 18);

// The bug I fixed by inspection — prove it.
const clash = await hold(["2026-08-12", "2027-02-03"], A);
eq("A's failed retry is refused", clash.ok, false);
eq("  and A KEEPS the 15 it had",
  Number(await val("select count(*) from lesson_bookings where hold_id=$1", [A])), 15);

// first_clash must name the date that actually blocks the run. A's own live
// hold never does — the retry's delete clears it. Before the filter went in,
// catching the exception rolled A's rows back into view and the earliest of
// *those* got reported, pointing the family at a date they already owned.
const D = "77777777-7777-7777-7777-777777777777";
eq("a later Wednesday is parked by someone else", (await hold(["2027-02-10"], D)).ok, true);
const own = await hold(["2026-09-16", "2027-02-10"], A);   // A's own date sorts first
eq("A's retry across a foreign date is refused", own.ok, false);
eq("  first_clash names the foreign date, not A's own", own.first_clash, "2027-02-10");
eq("  and A still holds its 15", 
  Number(await val("select count(*) from lesson_bookings where hold_id=$1", [A])), 15);

// ── Payment ─────────────────────────────────────────────────────────────────
eq("confirm A", (await val("select lesson_confirm($1,$2)", [A, 5001])).ok, true);
eq("  all booked, no expiry",
  Number(await val("select count(*) from lesson_bookings where hold_id=$1 and status='booked' and expires_at is null", [A])), 15);
eq("confirm twice is safe", (await val("select lesson_confirm($1,$2)", [A, 5001])).ok, true);
const ghost = await val("select lesson_confirm($1,$2)", ["99999999-9999-9999-9999-999999999999", 5002]);
eq("confirming an unknown hold fails", ghost.ok, false);
eq("  reason", ghost.reason, "hold_lost");
eq("booked dates resist a fresh claim", (await hold(TERM, "44444444-4444-4444-4444-444444444444")).ok, false);

// ── Abandoned checkout ──────────────────────────────────────────────────────
await db.query("update lesson_bookings set expires_at = now() - interval '1 hour' where hold_id=$1", [C]);
eq("expired hold reads as free in availability",
  (await val("select taken_dates from lesson_availability('2026-08-01','2026-09-01') where slot_id=$1", [SLOT]) || []).length, 0);
await db.query("select lesson_sweep_expired()");
eq("sweep removes it", Number(await val("select count(*) from lesson_bookings where hold_id=$1", [C])), 0);
eq("  paid rows untouched", Number(await val("select count(*) from lesson_bookings where status='booked'")), 15);
eq("someone else can now take those weeks",
  (await hold(["2026-08-12","2026-08-19","2026-08-26"], "55555555-5555-5555-5555-555555555555")).ok, true);
eq("release hands them back",
  (await val("select lesson_release($1)", ["55555555-5555-5555-5555-555555555555"])).released, 3);
eq("  release cannot touch a paid booking",
  (await val("select lesson_release($1)", [A])).released, 0);
eq("  paid rows still there", Number(await val("select count(*) from lesson_bookings where status='booked'")), 15);

// ── Availability + roster ───────────────────────────────────────────────────
eq("availability returns every active slot",
  Number(await val("select count(*) from lesson_availability('2026-09-01','2027-01-31')")), 23);
eq("the sold slot reports 15 taken dates",
  (await val("select taken_dates from lesson_availability('2026-09-01','2027-01-31') where slot_id=$1", [SLOT])).length, 15);
eq("an untouched slot reports none",
  (await val("select taken_dates from lesson_availability('2026-09-01','2027-01-31') where slot_id<>$1 limit 1", [SLOT])).length, 0);
eq("roster lists the 15 confirmed lessons",
  Number(await val("select count(*) from lesson_roster('2026-01-01')")), 15);
eq("roster names the coach",
  await val("select teacher_name from lesson_roster('2026-01-01') limit 1"), "Tony Cimino-Johnson");

// ── Permissions ─────────────────────────────────────────────────────────────
eq("anon may read the catalog",
  await denied("select count(*) from lesson_availability('2026-09-01','2027-01-31')", "anon"), false);
eq("anon CANNOT read bookings directly", await denied("select * from lesson_bookings", "anon"), true);
eq("anon CANNOT confirm a payment", await denied(`select lesson_confirm('${A}',1)`, "anon"), true);
eq("anon CANNOT read the roster", await denied("select * from lesson_roster()", "anon"), true);
eq("authenticated may place a hold",
  await denied(`select lesson_hold(${SLOT}, array['2027-03-03']::date[], '66666666-6666-6666-6666-666666666666')`, "authenticated"), false);
eq("authenticated CANNOT confirm", await denied(`select lesson_confirm('${A}',1)`, "authenticated"), true);

await db.end();
console.log(fails ? `\n${fails} FAILING` : "\nAll green.");
process.exit(fails ? 1 : 0);
