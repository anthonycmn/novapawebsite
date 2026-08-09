// Every page that prints a performance, checked against /shows.js.
//
// The show pages carry their own hand-set markup on purpose — a show page has
// to read correctly with no JavaScript at all. The cost of that is a dozen
// copies of the same dates, which is exactly how they drifted apart before.
// This is what stops them drifting again: change a curtain in shows.js, run
// `node tests/shows.mjs`, and it names every page that no longer agrees.
//
// Run: node tests/shows.mjs        (needs a static server on :8899 for the
//                                   calendar check; skipped without one)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = undefined;
const g = {};
new Function('module', 'globalThis', readFileSync(join(ROOT, 'shows.js'), 'utf8'))
  .call(g, {}, g);
const S = g.NOVAPA_SHOWS;

let fails = 0;
const A = (ok, msg) => { if (!ok) { fails++; console.log('  FAIL ' + msg); } else console.log('  ok   ' + msg); };
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const plain = (s) => s
  .replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&middot;/g, '·')
  .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&rsquo;/g, '’')
  .replace(/\s+/g, ' ');

console.log('CANONICAL');
A(S && S.shows.length === 14, 'shows.js loads with 14 companies');
A(S.houseOpensMinutes === 15, 'the house opens 15 minutes before curtain');
const total = S.shows.reduce((n, s) => n + s.performances.length, 0);
A(total === 76, 'the season has 76 performances — got ' + total);

// A date and its printed weekday can never disagree, because the weekday is
// derived. This checks the dates themselves are the days they claim to be.
console.log('\nDATES');
const EXPECT_DAY = {
  'frozen-kids': ['Fri', 'Sat', 'Sat'], 'frozen-jr': ['Fri', 'Sat', 'Sat'],
  'frozen-teen': ['Fri', 'Sat', 'Sat'], 'mermaid-kids': ['Fri', 'Sat', 'Sat'],
  'mermaid-jr': ['Fri', 'Sat', 'Sat'], 'mermaid-teen': ['Fri', 'Sat', 'Sat'],
  httyd: ['Fri', 'Fri', 'Sat', 'Sat', 'Sat', 'Sat'],
  charlie: ['Fri', 'Fri', 'Sat', 'Sat', 'Sat', 'Sat'],
  trolls: ['Fri', 'Fri', 'Sat', 'Sat', 'Sat', 'Sat'],
  deh: ['Fri', 'Sat', 'Sat', 'Sun'],
  sweeney: ['Fri', 'Sat', 'Sat', 'Sun', 'Fri', 'Sat', 'Sun'],
  carol: ['Fri', 'Sat', 'Sat', 'Sun', 'Thu', 'Fri', 'Sat', 'Sat', 'Sun', 'Fri', 'Sat', 'Sat', 'Sun'],
  hadestown: ['Fri', 'Sat', 'Sat', 'Sun', 'Thu', 'Fri', 'Sat', 'Sat', 'Sun', 'Fri', 'Sat', 'Sat'],
  'mean-girls': ['Fri', 'Sat', 'Sat', 'Sun'],
};
for (const show of S.shows) {
  const got = show.performances.map((p) => S.dayName(p.at));
  A(JSON.stringify(got) === JSON.stringify(EXPECT_DAY[show.key]),
    show.key + ' falls on ' + EXPECT_DAY[show.key].join('/') + ' — got ' + got.join('/'));
}

// ── licensed titles ─────────────────────────────────────────────────────
// We license Frozen KIDS, Frozen JR., Little Mermaid KIDS and Little Mermaid
// JR. There is no teen edition of either title. Our teen band performs the JR.
// script, and "Broadway Bound Teen" names the band, never the show. Printing a
// version that does not exist is a licensing problem, not a wording one, so it
// is checked here. (CJ, 9 Aug 2026.)
console.log('\nLICENSED TITLES');
const LICENSED = {
  'frozen-kids': 'Frozen KIDS', 'frozen-jr': 'Frozen JR.', 'frozen-teen': 'Frozen JR.',
  'mermaid-kids': 'Little Mermaid KIDS', 'mermaid-jr': 'Little Mermaid JR.',
  'mermaid-teen': 'Little Mermaid JR.',
};
for (const [key, title] of Object.entries(LICENSED)) {
  A(S.byKey(key).title === title,
    key + ' is billed as "' + title + '" — got "' + S.byKey(key).title + '"');
}
for (const key of ['frozen-teen', 'mermaid-teen']) {
  A(S.byKey(key).ages === '12–15', key + ' is the 12–15 band');
  A(/Broadway Bound Teen/.test(S.byKey(key).company),
    key + ' names the band, not an edition: ' + S.byKey(key).company);
}
// Two names, two programs, and they are not interchangeable (CJ, 9 Aug 2026):
//   Teen Conservatory     — the audition-based track, ages 13–18: Dear Evan
//                           Hansen, Sweeney Todd, A Christmas Carol, Hadestown,
//                           Mean Girls.
//   Broadway Bound Teen   — the 12–15 cast inside the Broadway Bound JR. shows,
//                           Frozen JR. and The Little Mermaid JR.
// The site briefly used "Broadway Bound Teen" for both, which put a 13–18
// audition track and a 12–15 junior cast under one name.
for (const key of ['deh', 'sweeney', 'carol', 'hadestown', 'mean-girls']) {
  A(S.byKey(key).season === 'Teen Conservatory',
    key + ' belongs to the Teen Conservatory — got "' + S.byKey(key).season + '"');
}
for (const key of ['frozen-kids', 'frozen-jr', 'frozen-teen', 'mermaid-kids', 'mermaid-jr',
  'mermaid-teen']) {
  A(S.byKey(key).season === 'Broadway Bound', key + ' belongs to Broadway Bound');
}
// "Broadway Bound Teen" may only ever appear next to a JR. show.
const TEEN_BAND = /.{0,80}Broadway Bound Teen.{0,80}/gs;
for (const file of ['index.html', 'calendar.html', 'broadway-bound.html', 'summer-2027.html',
  'teen-conservatory.html', 'register/index.html', 'netlify/functions/chat.mjs']) {
  const stray = (read(file).replace(/"data:[^"]*"/g, '""').match(TEEN_BAND) || [])
    .filter((t) => !/Frozen|Mermaid|JR\./.test(t));
  A(stray.length === 0, file + ' only uses "Broadway Bound Teen" for a JR. show cast' +
    (stray.length ? '\n        stray: ' + stray[0].replace(/\s+/g, ' ').slice(0, 140) : ''));
}
A(!/formerly Teen Conservatory/.test(read('index.html')),
  'nothing still calls the Teen Conservatory a former name');

// Hadestown: Teen Edition is a real licensed edition and stays.
const INVENTED = /(Frozen|Little Mermaid|Mermaid)[^<>]{0,30}Teen Edition|Teen Edition[^<>]{0,30}(Frozen|Mermaid)/;
for (const file of ['index.html', 'calendar.html', 'broadway-bound.html', 'frozen-jr.html',
  'frozen-kids.html', 'little-mermaid-jr.html', 'register/index.html', 'shows.js',
  'netlify/functions/chat.mjs']) {
  A(!INVENTED.test(read(file)), file + ' claims no teen edition of Frozen or The Little Mermaid');
}

// ── the NOVAPA ADMIN calendar ───────────────────────────────────────────
// Read off the NOVAPA ADMIN Google calendar (cj@novapa.org, America/New_York)
// on 9 Aug 2026 and written down here, curtain by curtain, so the website can
// never quietly drift away from the calendar the company actually runs on.
// If CJ moves a curtain in Google, change it here first — this block is the
// calendar's word, and shows.js has to answer to it, not the other way round.
console.log('\nNOVAPA ADMIN CALENDAR');
const ADMIN_CALENDAR = {
  deh: ['2026-08-14 19:00', '2026-08-15 14:00', '2026-08-15 19:00', '2026-08-16 14:00'],
  sweeney: ['2026-10-23 19:00', '2026-10-24 14:00', '2026-10-24 19:00', '2026-10-25 14:00',
    '2026-10-30 19:00', '2026-10-31 14:00', '2026-11-01 14:00'],
  carol: ['2026-12-04 19:00', '2026-12-05 14:00', '2026-12-05 19:00', '2026-12-06 14:00',
    '2026-12-10 19:00', '2026-12-11 19:00', '2026-12-12 14:00', '2026-12-12 19:00',
    '2026-12-13 14:00', '2026-12-18 19:00', '2026-12-19 14:00', '2026-12-19 19:00',
    '2026-12-20 14:00'],
  'frozen-kids': ['2027-01-22 19:00', '2027-01-23 14:00', '2027-01-23 19:00'],
  'frozen-jr': ['2027-01-29 19:00', '2027-01-30 14:00', '2027-01-30 19:00'],
  'frozen-teen': ['2027-02-05 19:00', '2027-02-06 14:00', '2027-02-06 19:00'],
  hadestown: ['2027-03-05 19:00', '2027-03-06 14:00', '2027-03-06 19:00', '2027-03-07 14:00',
    '2027-03-11 19:00', '2027-03-12 19:00', '2027-03-13 14:00', '2027-03-13 19:00',
    '2027-03-14 14:00', '2027-03-19 19:00', '2027-03-20 14:00', '2027-03-20 19:00'],
  'mermaid-kids': ['2027-05-14 19:00', '2027-05-15 14:00', '2027-05-15 19:00'],
  'mermaid-jr': ['2027-05-21 19:00', '2027-05-22 14:00', '2027-05-22 19:00'],
  'mermaid-teen': ['2027-06-04 19:00', '2027-06-05 14:00', '2027-06-05 19:00'],
  'mean-girls': ['2027-06-25 19:00', '2027-06-26 14:00', '2027-06-26 19:00', '2027-06-27 14:00'],
  httyd: ['2027-07-16 17:00', '2027-07-16 19:00', '2027-07-17 11:00', '2027-07-17 13:00',
    '2027-07-17 16:00', '2027-07-17 19:00'],
  charlie: ['2027-07-30 17:00', '2027-07-30 19:00', '2027-07-31 11:00', '2027-07-31 13:00',
    '2027-07-31 16:00', '2027-07-31 19:00'],
  trolls: ['2027-08-13 17:00', '2027-08-13 19:00', '2027-08-14 11:00', '2027-08-14 13:00',
    '2027-08-14 16:00', '2027-08-14 19:00'],
};
A(Object.keys(ADMIN_CALENDAR).length === S.shows.length,
  'the calendar covers every company on the season');
for (const show of S.shows) {
  const want = ADMIN_CALENDAR[show.key] || [];
  const got = show.performances.map((p) => p.at);
  A(JSON.stringify(got) === JSON.stringify(want),
    show.key + ' matches the admin calendar, curtain for curtain' +
    (JSON.stringify(got) === JSON.stringify(want) ? ''
      : '\n        calendar: ' + want.join(' · ') + '\n        site:     ' + got.join(' · ')));
}

// ── show pages ──────────────────────────────────────────────────────────
// Each cast block on a page must be exactly the performances of its company,
// in order, with the same times.
console.log('\nSHOW PAGES');
const PAGE_BLOCKS = {
  'frozen-kids.html': ['frozen-kids'],
  'frozen-jr.html': ['frozen-jr', 'frozen-teen'],
  'little-mermaid-jr.html': ['mermaid-kids', 'mermaid-jr', 'mermaid-teen'],
  'dear-evan-hansen.html': ['deh'],
  'sweeney-todd.html': ['sweeney'],
  // three weekend blocks that together are the whole run
  'hadestown.html': ['hadestown'],
};
const CAST_RE = /<div class="perf-cast-name">(.*?)<\/div>\s*<div class="perf-cast-tag">(.*?)<\/div>\s*<ul class="perf-list">([\s\S]*?)<\/ul>/g;
const ITEM_RE = /<span class="perf-day">(.*?)<\/span>\s*<span class="perf-date">(.*?)<\/span>\s*<span class="perf-time">(.*?)<\/span>/g;

for (const [file, keys] of Object.entries(PAGE_BLOCKS)) {
  const html = read(file);
  const blocks = [...html.matchAll(CAST_RE)].map((m) => [...m[3].matchAll(ITEM_RE)]
    .map((i) => i[1] + ' ' + i[2] + ' ' + i[3]));
  const onPage = blocks.flat();
  const want = keys.flatMap((k) => S.byKey(k).performances
    .map((p) => S.dayName(p.at) + ' ' + S.monthDay(p.at) + ' ' + S.clock(p.at)));
  A(JSON.stringify(onPage) === JSON.stringify(want),
    file + ' prints exactly its ' + want.length + ' performances' +
    (JSON.stringify(onPage) === JSON.stringify(want) ? ''
      : '\n        page: ' + onPage.join(' · ') + '\n        want: ' + want.join(' · ')));
  A(html.includes(S.houseOpensNote), file + ' carries the house-opens note');
  A(!/Doors open 30 minutes/.test(html), file + ' has no stale doors-open line');
}

// The run we publish is how long the audience sits, which is not the slot we
// hold: a Disney KIDS show is a 30-minute script in a 60-minute room. Both
// numbers exist on purpose, and the pages must print the run.
console.log('\nRUN TIMES');
const RUNS = [
  ['frozen-kids.html', 'frozen-kids', 30, 'Each performance runs about 30 minutes'],
  ['little-mermaid-jr.html', 'mermaid-kids', 30, 'The Kids run is about 30 minutes'],
  ['frozen-jr.html', 'frozen-jr', 90, 'Each performance runs about 90 minutes'],
  ['sweeney-todd.html', 'sweeney', 150, 'about 2 hours 30 minutes'],
  ['hadestown.html', 'hadestown', 150, 'about 2 hours 30 minutes'],
  ['dear-evan-hansen.html', 'deh', 150, 'about 2 hours 30 minutes'],
];
for (const [file, key, minutes, text] of RUNS) {
  A(S.byKey(key).runMinutes === minutes, key + ' publishes a ' + minutes + '-minute run');
  A(plain(read(file)).includes(text), file + ' prints "' + text + '"');
}
for (const key of ['frozen-kids', 'mermaid-kids']) {
  A(S.byKey(key).slotMinutes === 60, key + ' still holds the 60-minute slot');
}
A(!/runs about 60 minutes/.test(plain(read('frozen-kids.html'))),
  'frozen-kids.html no longer publishes the slot as the run');

// ── season pages and cards ──────────────────────────────────────────────
console.log('\nSEASON PAGES AND CARDS');
// Each entry: the page, the text that must be on it, and why.
const first = (k) => S.monthDay(S.byKey(k).performances[0].at);
const last = (k) => {
  const p = S.byKey(k).performances;
  return S.monthDay(p[p.length - 1].at);
};
const RANGES = [
  ['broadway-bound.html', 'frozen-kids', 'Jan 22–23, 2027'],
  ['broadway-bound.html', 'frozen-jr', 'Jan 29–30, 2027'],
  ['broadway-bound.html', 'frozen-teen', 'Feb 5–6, 2027'],
  ['broadway-bound.html', 'mermaid-kids', 'May 14–15, 2027'],
  ['broadway-bound.html', 'mermaid-jr', 'May 21–22, 2027'],
  ['broadway-bound.html', 'mermaid-teen', 'Jun 4–5, 2027'],
  ['broadway-bound.html', 'mean-girls', 'Jun 25–27, 2027'],
  ['summer-2027.html', 'httyd', 'Jul 16 – 17, 2027'],
  ['summer-2027.html', 'charlie', 'Jul 30 – 31, 2027'],
  ['summer-2027.html', 'trolls', 'Aug 13 – 14, 2027'],
];
// (the registration cards moved from a bare range to the full curtain list —
// they are checked in CURTAIN TIMES below)
for (const [file, key, text] of RANGES) {
  const html = plain(read(file));
  A(html.includes(text), file + ' shows ' + key + ' as "' + text + '"');
  // and the text has to be the real first and last day of that run
  const f = first(key).replace(/^[A-Za-z]+ /, ''), l = last(key).replace(/^[A-Za-z]+ /, '');
  A(text.includes(f) && text.includes(l),
    '  …which is the real first (' + first(key) + ') and last (' + last(key) + ') day');
}

// A date with no time sends a family to Leesburg on the right day and the
// wrong hour. Every page that names a run has to name its curtains too.
console.log('\nCURTAIN TIMES');
const CURTAINS = [
  ['broadway-bound.html', ['frozen-kids']], ['broadway-bound.html', ['frozen-jr']],
  ['broadway-bound.html', ['frozen-teen']], ['broadway-bound.html', ['mermaid-kids']],
  ['broadway-bound.html', ['mermaid-jr']], ['broadway-bound.html', ['mermaid-teen']],
  ['broadway-bound.html', ['mean-girls']], ['broadway-bound.html', ['httyd']],
  ['broadway-bound.html', ['charlie']], ['broadway-bound.html', ['trolls']],
  ['summer-2027.html', ['httyd']], ['summer-2027.html', ['charlie']],
  ['summer-2027.html', ['trolls']],
  ['teen-conservatory.html', ['sweeney']], ['teen-conservatory.html', ['hadestown']],
  ['register/index.html', ['httyd']], ['register/index.html', ['charlie']],
  ['register/index.html', ['trolls']], ['register/index.html', ['mean-girls']],
];
for (const [file, keys] of CURTAINS) {
  const want = S.dayTimes(keys.flatMap((k) => S.byKey(k).performances)).join(' · ');
  A(plain(read(file)).includes(want), file + ' prints ' + keys.join('+') + ' curtains: ' + want);
}
// The camp performance times are typed out separately in the registration
// flow, keyed by age band. They have to be the same curtains.
const regJs = read('register/index.html');
for (const [band, text] of [['5-9', 'FRI 5:00 PM &middot; SAT 11:00 AM'],
  ['9-12', 'FRI 7:00 PM &middot; SAT 1:00 PM'], ['12-15', 'SAT 4:00 PM &middot; SAT 7:00 PM']]) {
  A(regJs.includes("'" + band + "':"), 'the registration flow still has a ' + band + ' band');
  A(regJs.includes(text), '  …booking ' + band + ' as ' + plain(text));
  const want = S.byKey('httyd').performances.filter((p) => p.ages.replace('–', '-') === band)
    .map((p) => S.dayName(p.at) + ' ' + S.clock(p.at));
  const got = plain(text).replace(/FRI/g, 'Fri').replace(/SAT/g, 'Sat').split(' · ');
  A(JSON.stringify(got) === JSON.stringify(want),
    '  …which is what shows.js holds for that band (' + want.join(' · ') + ')');
}
A(/replace\(\/SAT\/g/.test(regJs),
  'the SAT swap is global, so the 12–15 band does not print a literal "SAT"');

// Every index card carries its curtain days AND its curtain times. A card that
// prints only the dates sends a family to the box office on the right day at
// the wrong hour, so the times are not decoration.
console.log('\nINDEX CARDS');
const idx = plain(read('index.html'));
const P = (k) => S.byKey(k).performances;
const part = (label, k) => ({ label, performances: P(k) });
const CARDS = [
  ['Dear Evan Hansen', P('deh')],
  ['Sweeney Todd', P('sweeney')],
  ['A Christmas Carol', P('carol')],
  ['Frozen Kids', P('frozen-kids')],
  ['Frozen', [part('JR.', 'frozen-jr'), part('Teen', 'frozen-teen')]],
  ['Hadestown', P('hadestown')],
  ['The Little Mermaid',
    [part('KIDS', 'mermaid-kids'), part('JR.', 'mermaid-jr'), part('Teen', 'mermaid-teen')]],
  ['Mean Girls', P('mean-girls')],
  ['How to Train Your Dragon Jr.', P('httyd')],
  ['Charlie and the Chocolate Factory', P('charlie')],
  ['Trolls Jr.', P('trolls')],
];
A((read('index.html').match(/class="sperf"/g) || []).length === CARDS.length,
  'all eleven show cards carry a performance line');
for (const [title, parts] of CARDS) {
  const line = S.cardLine(parts);
  A(idx.includes(line), 'the ' + title + ' card reads "' + line + '"');
}
// The bleed the cards used to have was structural: .sbody was absolutely
// positioned over a fixed-height poster inside overflow:hidden, so a longer
// line rode up over the artwork and then got clipped. The card is a column now.
const cardCss = read('index.html').match(/\.scard \{[\s\S]*?\}/)[0];
A(/flex-direction:\s*column/.test(cardCss), '.scard is a column, so text can never overlap the poster');
A(!/position:\s*absolute/.test(read('index.html').match(/\.sbody \{[\s\S]*?\}/)[0]),
  '.sbody is in flow, so a longer performance line grows the card instead of bleeding out');

// ── nothing anywhere still says the old dates ───────────────────────────
console.log('\nNO STALE DATES');
const STALE = [
  ['Sun Jan 24', 'the dropped Frozen KIDS Sunday'],
  ['Sun Jan 31', 'the dropped Frozen JR. Sunday'],
  ['Sun Feb 7', 'the dropped Frozen Teen Sunday'],
  ['Sun May 16', 'the dropped Mermaid KIDS Sunday'],
  ['Sun May 23', 'the dropped Mermaid JR. Sunday'],
  ['Sun Jun 6', 'the dropped Mermaid Teen Sunday'],
  ['Thu Oct 29', 'the dropped Sweeney Thursday'],
  ['3:00 PM', 'the old 3pm matinee'],
  ['Jan 22&ndash;24', 'the old Frozen KIDS range'],
  ['Jan 29&ndash;31', 'the old Frozen JR. range'],
  ['Feb 5&ndash;7', 'the old Frozen Teen range'],
  ['May 14&ndash;16', 'the old Mermaid KIDS range'],
  ['May 21&ndash;23', 'the old Mermaid JR. range'],
  ['June 4&ndash;6', 'the old Mermaid Teen range'],
];
const PAGES = ['index.html', 'broadway-bound.html', 'summer-2027.html', 'calendar.html',
  'frozen-kids.html', 'frozen-jr.html', 'little-mermaid-jr.html', 'dear-evan-hansen.html',
  'sweeney-todd.html', 'hadestown.html', 'teen-conservatory.html', 'day-camps.html',
  'classes.html', 'register/index.html'];
for (const [text, why] of STALE) {
  const hits = PAGES.filter((p) => read(p).includes(text));
  A(hits.length === 0, 'no page still shows ' + why + (hits.length ? ' — ' + hits.join(', ') : ''));
}

console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'every page agrees with shows.js'));
process.exitCode = fails ? 1 : 0;
