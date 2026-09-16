// The note from CJ after a free class: who gets one, when, and what it says.
//
// Why this file exists: the follow-up is the one automated email that goes
// out in CJ's own name, to a family that has been in the building once. It
// has to wait for the class to actually end, say the right class and day,
// carry a link that puts that class (or both classes) in the cart, and never
// go to the same family twice on one night. These pin each of those.
import {
  parseHours, prettyHours, easternToUtc, classEndsAt, groupVisits, isDue,
  composeNote, renderNote, firstName, FOLLOWUP_SINCE,
} from "../netlify/functions/reg-freeclass-followup.mjs";

let fails = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};
const has = (label, got, needle) => eq(label, typeof got === "string" && got.includes(needle), true);
const lacks = (label, got, needle) => eq(label, typeof got === "string" && got.includes(needle), false);

// ── Hours ──────────────────────────────────────────────────────────────────
eq("listing hours parse", parseHours("7:15pm - 8:05pm EDT"), { start: 19 * 60 + 15, end: 20 * 60 + 5 });
eq("noon parses as 12 PM", parseHours("12:00pm - 12:50pm EDT"), { start: 720, end: 770 });
eq("unreadable hours are null", parseHours("see schedule"), null);
eq("hours read as people say them", prettyHours("7:00pm - 8:30pm EDT"), "7:00 to 8:30 PM");
eq("a class across noon says both", prettyHours("11:30am - 12:20pm EDT"), "11:30 AM to 12:20 PM");

// ── The class has to end first ─────────────────────────────────────────────
// 8:05 PM Eastern on 16 Sep 2026 is 00:05 UTC on the 17th (EDT, UTC-4).
eq("Eastern wall clock becomes the right instant (EDT)",
  easternToUtc("2026-09-16", 20 * 60 + 5).toISOString(), "2026-09-17T00:05:00.000Z");
eq("and in winter (EST)",
  easternToUtc("2026-12-16", 20 * 60 + 5).toISOString(), "2026-12-17T01:05:00.000Z");
eq("a listing's hours decide when it ends",
  classEndsAt("2026-09-16", "7:15pm - 8:05pm EDT", "mt-acting-9-12").toISOString(), "2026-09-17T00:05:00.000Z");
eq("no readable hours: catalogue start plus an hour",
  classEndsAt("2026-09-16", null, "mt-acting-9-12").toISOString(), "2026-09-17T00:15:00.000Z");

const listings = {
  1960945: { name: "Musical Theatre Acting", age_range: "9 – 12 yrs", hours: "7:15pm - 8:05pm EDT" },
  1960925: { name: "Musical Theatre Dance", age_range: "13 – 17 yrs", hours: "7:00pm - 7:50pm EDT" },
  1960927: { name: "Musical Theatre Acting", age_range: "13 – 17 yrs", hours: "8:00pm - 8:50pm EDT" },
  1960867: { name: "Acting", age_range: "5 – 8 yrs", hours: "6:00pm - 6:55pm EDT" },
  1962562: { name: "Acting and Musical Theatre", age_range: "9 – 12 yrs", hours: "12:00pm - 12:50pm EDT" },
};
const visit = (o) => ({ id: 1, parent_name: "Scott Pitts", email: "scottypitts@gmail.com", child_name: "Hamilton",
  cast_key: "mt-acting-9-12", activity_id: 1960945, class_date: "2026-09-16", ...o });

const [ham] = groupVisits([visit({})], listings);
eq("not due while the class is still running", isDue(ham, new Date("2026-09-17T00:00:00Z")), false);
eq("due once it has ended",                    isDue(ham, new Date("2026-09-17T00:06:00Z")), true);

// ── One note per family per night ──────────────────────────────────────────
const tue = groupVisits([
  visit({ id: 17, parent_name: "Tonya Washington", email: "2tonyawash@gmail.com", child_name: "Ariannah", cast_key: "mt-acting-13-17", activity_id: 1960927, class_date: "2026-09-22" }),
  visit({ id: 18, parent_name: "Tonya Washington", email: "2TonyaWash@gmail.com", child_name: "Ariannah", cast_key: "mt-dance-13-17", activity_id: 1960925, class_date: "2026-09-22" }),
  visit({ id: 26, parent_name: "Kidist kifle", email: "gkki2@yahoo.com", child_name: "Soliyana", cast_key: "acting-5-8", activity_id: 1960867, class_date: "2026-09-21" }),
  visit({ id: 27, parent_name: "Kidist kifle", email: "gkki2@yahoo.com", child_name: "Liya", cast_key: "acting-5-8", activity_id: 1960867, class_date: "2026-09-21" }),
], listings);
eq("two classes, one child, one night: one group", tue.filter((g) => g.email === "2tonyawash@gmail.com").length, 1);
eq("email case does not split a family", tue.find((g) => g.email === "2tonyawash@gmail.com").ids, [17, 18]);
eq("the group waits for the LATER class to end",
  tue.find((g) => g.email === "2tonyawash@gmail.com").ends_at.toISOString(), "2026-09-23T00:50:00.000Z");
eq("two children, one class, one night: one group", tue.filter((g) => g.email === "gkki2@yahoo.com").length, 1);

// ── What it says ───────────────────────────────────────────────────────────
const one = composeNote(ham);
const oneText = renderNote(one).text;
eq("subject names the child", one.subject, "Hamilton's first class, and what comes next");
has("opens with the parent's first name", oneText, "Hi Scott,");
has("names the class", oneText, "Hamilton to Musical Theatre Acting.");
has("says when it meets", oneText, "every Wednesday from 7:15 to 8:05 PM");
has("names the next date", oneText, "this coming Wednesday, September 23");
has("links that class into the cart", oneText, "https://novapa.org/register/?activity=1960945");
has("prices it", oneText, "$90 a month");
has("says we hope to see them back", oneText, "We would love to see Hamilton back on Wednesday");
has("invites questions", oneText, "please don't hesitate to ask");
has("signed by CJ", oneText, "Mr. Cimino-Johnson");
lacks("no bullet list for a single class", oneText, "•");

const two = composeNote(tue.find((g) => g.email === "2tonyawash@gmail.com"));
const twoText = renderNote(two).text;
has("two classes are both named", twoText, "Musical Theatre Acting and Musical Theatre Dance");
has("two classes: one link carries both", twoText, "?activity=1960927,1960925");
has("two classes: priced as a pair", twoText, "Two classes together are $150 a month");
has("two classes: each is listed with its hours", twoText, "• Musical Theatre Dance (ages 13 – 17), 7:00 to 7:50 PM");
has("Tuesday classes come back on Tuesday", twoText, "back on Tuesday");

const kids = composeNote(tue.find((g) => g.email === "gkki2@yahoo.com"));
eq("two children: subject names both", kids.subject, "Soliyana and Liya's first classes, and what comes next");
has("two children: the family is addressed together", renderNote(kids).text, "bringing Soliyana and Liya to Acting.");

// CJ, 16 Sep 2026: "remove the word 'tonight' altogether." The note never
// says when the class was, evening or noon; the family was there.
const sat = composeNote(groupVisits([visit({ cast_key: "acting-mt-sat", activity_id: 1962562, class_date: "2026-09-19" })], listings)[0]);
for (const [label, note] of [["one class", one], ["two classes", two], ["two children", kids], ["a noon class", sat]]) {
  eq(`${label}: never says tonight or today`, /(tonight|today)/i.test(renderNote(note).text), false);
}

// ── The rich part is the plain part ────────────────────────────────────────
const { html } = renderNote(one);
has("HTML carries the link as an anchor", html, 'href="https://novapa.org/register/?activity=1960945"');
has("HTML escapes the ampersand in the signature", html, "Co-Founder &amp; CEO");

// ── Who is addressed ───────────────────────────────────────────────────────
eq("first name from a full name", firstName("Kidist kifle"), "Kidist");
eq("an email in the name field is not a greeting", firstName("boogie46@gmail.com"), "there");
eq("an empty name is 'there'", firstName(""), "there");

// ── The hand-written week stays hand-written ───────────────────────────────
eq("automation starts with the Wednesday classes", FOLLOWUP_SINCE, "2026-09-16");

if (fails) { console.log(`\n${fails} failing`); process.exit(1); }
console.log("\nall free-class follow-up checks pass");
