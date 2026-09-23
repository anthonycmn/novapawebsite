// Takes a day camp off sale once its date has passed. Hourly.
//
// Nothing did this before. Heroes & Villains (5 to 9, and 9 to 12) and the
// Audition Boot Camp Elite ran on Mon Sep 21 2026 and were still bookable on
// Wednesday: the registration audit asked three mornings running, and they
// came off only when a person switched them off by hand. Every Monday camp
// depended on someone remembering.
//
// Why a scheduled job and not a date check inside catalog_list and the hold
// RPCs: `bookable` is the one switch every surface already obeys. The
// storefront, the day camp page, the quiz, the admin, and the free-class
// page all read it through catalog_list, and the hold RPCs refuse on it.
// There are two live hold RPCs (acquire_hold_v3 and acquire_hold_guest) and
// v2 is dead, so a date check would be three function migrations applied by
// hand, where this is one file that ships with the site. It also leaves an
// honest record: every flip lands in activities_audit stamped with this
// job's name. A past camp switched back on by hand comes off again within
// the hour; to keep selling one, move its starts_on.
//
// Only offering_kind = 'day_camp'. Classes and shows keep selling after
// their start date on purpose (a mid-season class is prorated; a show sells
// until it is full), so a past starts_on means nothing for them.
//
// "Past" is the studio's day (America/New_York): a camp on the 21st stays
// buyable through the 21st and comes off in the first run on the 22nd. The
// job runs hourly, not daily, because scheduled functions can miss a run
// (reg-balance-audit did on Sep 23), and the query is idempotent: a camp
// already off is never touched again.
import { SUPABASE_URL, etToday } from "./reg-config.mjs";

export const CLOSED_BY = "reg-daycamp-close";

// The PostgREST filter for every day camp that is still on sale but whose
// day is over. Exported so the test pins exactly what this can touch.
export function pastDayCampFilter(today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error(`bad date: ${today}`);
  return `offering_kind=eq.day_camp&active=is.true&bookable=is.true&starts_on=lt.${today}`;
}

export default async () => {
  if (process.env.CONTEXT && process.env.CONTEXT !== "production") {
    return new Response("skipped: non-production", { status: 200 });
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return new Response("not configured", { status: 200 });

  const today = etToday();
  const r = await fetch(`${SUPABASE_URL}/rest/v1/activities?${pastDayCampFilter(today)}&select=id,name,starts_on`, {
    method: "PATCH",
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      "Content-Type": "application/json", Prefer: "return=representation",
    },
    // updated_by is what activities_audit records as changed_by. Without it
    // the flip is credited to whoever last edited the row (the Sep 23 manual
    // flip was logged under a Sep 9 price change).
    body: JSON.stringify({ bookable: false, updated_by: CLOSED_BY, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) {
    const msg = `day camp close failed ${r.status}: ${(await r.text()).slice(0, 300)}`;
    console.error(msg);
    return new Response(msg, { status: 500 });
  }
  const closed = await r.json();
  if (!closed.length) return new Response(`ok: no past day camps on sale (${today})`, { status: 200 });
  const list = closed.map((a) => `${a.id} ${a.name} (${a.starts_on})`).join("; ");
  console.log(`took ${closed.length} past day camp(s) off sale: ${list}`);
  return new Response(`closed ${closed.length}: ${list}`, { status: 200 });
};

export const config = { schedule: "5 * * * *" };
