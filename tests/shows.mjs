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
import { readFileSync, existsSync } from 'node:fs';
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

// A card row labelled "Season" does not answer "when does my child start?".
// Each conservatory production states its first rehearsal explicitly, and that
// date has to agree with the show page's own "from <date> through opening
// night" line. Sweeney moved from 17 to 24 August on 12 Aug 2026 and four
// separate places had to change; this is what catches the fifth.
console.log('\nFIRST REHEARSAL');
const REHEARSALS = [
  ['Sweeney Todd', 'Mon, Aug 24, 2026', 'sweeney-todd.html', 'from August 24 through opening night'],
  ['Hadestown', 'Mon, Nov 16, 2026', 'hadestown.html', 'from November 16 through opening night'],
];
const textOf = (f) => plain(read(f).replace(/<[^>]+>/g, ' '));
for (const [show, stated, page, prose] of REHEARSALS) {
  A(textOf('teen-conservatory.html').includes('First rehearsal ' + stated),
    show + ' states its first rehearsal on the conservatory page: ' + stated);
  A(plain(read(page)).includes(prose),
    '  …and ' + page + ' agrees: "' + prose + '"');
}
A(!/August 17|Aug 17/.test(read('sweeney-todd.html') + read('teen-conservatory.html')),
  'nothing still says Sweeney rehearsals start 17 August');

// ── class catalogue ─────────────────────────────────────────────────────
// classes.html is a hand-written catalogue and the registration portal is the
// thing that actually sells. On 12 Aug 2026 the page still advertised eleven
// classes the portal would not sell: three Ballet, two Hip-Hop, K-Pop, the
// Wednesday Triple Threat, Adult Dance, Adult Musical Theatre, and two
// Saturday cards with no register link at all.
//
// These checks are self-consistency only — they cannot see Supabase. To
// refresh the snapshot, run:
//   select id from activities where category='class' and bookable order by id;
console.log('\nCLASS CATALOGUE');
const classes = read('classes.html');
const CARD = /<div class="card" data-day="(\w+)"[\s\S]*?<\/div>\s*(?=<div class="card"|<\/div>)/g;
const cardIds = [...classes.matchAll(/<div class="card" data-day="(\w+)"[^>]*>\s*<a[^>]*activity=(\d+)/g)];
const cardCount = (classes.match(/<div class="card" data-day=/g) || []).length;
A(cardIds.length === cardCount,
  'every class card links to a registration activity — ' + cardIds.length + ' of ' + cardCount +
  (cardIds.length === cardCount ? '' : '; a card with no link advertises something nobody can book'));

// the ids the portal listed as bookable on 12 Aug 2026
const PORTAL_CLASS_IDS = ['1960867', '1960898', '1960924', '1960925', '1960927', '1960936',
  '1960939', '1960945', '1960959', '1960961', '1962562', '1962566', '1962567', '1962568'];
const onPage = [...new Set(cardIds.map((m) => m[2]))].sort();
const extra = onPage.filter((id) => !PORTAL_CLASS_IDS.includes(id));
A(extra.length === 0, 'no class card sells something the portal does not' +
  (extra.length ? ' — orphan activity ids: ' + extra.join(', ') : ''));

// each day heading states how many classes are under it
const perDay = {};
for (const [, day] of cardIds) perDay[day] = (perDay[day] || 0) + 1;
const stated = [...classes.matchAll(/(\d+) weekly class(?:es)?/g)].map((m) => Number(m[1]));
const realCounts = ['mon', 'tue', 'wed', 'thu', 'sat'].map((d) => perDay[d] || 0);
A(JSON.stringify(stated) === JSON.stringify(realCounts),
  'each day says how many classes it has — page says [' + stated.join(', ') +
  '], cards are [' + realCounts.join(', ') + ']');

// The calendar's weekly grid is the third place classes are listed, after
// classes.html and the chat script. On 16 Aug 2026 it carried 48 rows: the 14
// real ones plus 34 that no longer exist anywhere — Tiny Tots, Bollywood,
// Film & TV, K-Pop, Ballet, Hip-Hop, Adult Voice & Choir, two troupes. A
// family reads that grid expecting to be able to book what is on it.
const cal = read('calendar.html');
const weekly = (cal.match(/WEEKLY_CLASSES = \[[\s\S]*?\];/) || [''])[0];
const weeklyRows = (weekly.match(/\[\d,'/g) || []).length;
A(weeklyRows === 19,
  'the weekly grid holds 19 rows: 14 classes plus 5 rehearsal/conservatory — got ' + weeklyRows);
for (const dead of ['Tiny Tots', 'Bollywood', 'K-Pop', 'Hip-Hop', 'Film & TV',
  'Ballet', 'Junior Thespian', 'Adult Voice']) {
  A(!weekly.includes(dead), '  …and does not list ' + dead);
}
// the classes on the grid and the classes on classes.html are the same set
const gridNames = [...weekly.matchAll(/\[\d,'[^']*','([^']*)','[^']*','(?!Production|Conservatory)[^']*'\]/g)]
  .map((m) => m[1]);
A(gridNames.length === 14, 'the grid lists exactly the 14 sold classes — got ' + gridNames.length);

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
// Both teen bands are 12–17 (CJ, 26 Aug 2026 — Frozen first, then Little
// Mermaid). Still asserted per key rather than as one shared value: they were
// briefly different that same day, and a single constant would let a change to
// one silently move the other.
const TEEN_AGES = { 'frozen-teen': '12–17', 'mermaid-teen': '12–17' };
for (const [key, ages] of Object.entries(TEEN_AGES)) {
  A(S.byKey(key).ages === ages,
    key + ' is the ' + ages + ' band — got ' + S.byKey(key).ages);
  A(/Broadway Bound Teen/.test(S.byKey(key).company),
    key + ' names the band, not an edition: ' + S.byKey(key).company);
}
// ── printed age bands ───────────────────────────────────────────────────
// shows.js was the only copy of a cast's age band that anything checked, so
// when Frozen's teen band widened to 12–17 (CJ, 26 Aug 2026) every hand-set
// "Ages 12–15" on the show pages and season cards could have been left behind
// and this suite would still have gone green. The printed strings are checked
// against shows.js too now, the same way the dates already are.
console.log('\nPRINTED AGE BANDS');
// longest name first: "Frozen JR. — Broadway Bound Teen" also contains
// "Frozen JR.", so the teen patterns have to win.
const CARD_KEY = [
  [/Frozen JR\.[\s\S]*Broadway Bound Teen/, 'frozen-teen'],
  [/Little Mermaid JR\.[\s\S]*Broadway Bound Teen/, 'mermaid-teen'],
  [/Little Mermaid JR\./, 'mermaid-jr'],
  [/Little Mermaid KIDS/, 'mermaid-kids'],
  [/Frozen JR\./, 'frozen-jr'],
  [/Frozen KIDS/, 'frozen-kids'],
];
let cardsChecked = 0;
for (const file of ['broadway-bound.html', 'summer-2027.html']) {
  const src = read(file).replace(/"data:[^"]*"/g, '""');
  for (const card of src.match(/<article class="pgm-card[\s\S]*?<\/article>/g) || []) {
    const name = (card.match(/<h3 class="pgm-name">([\s\S]*?)<\/h3>/) || [])[1];
    const ages = (card.match(/<div class="pgm-ages">([\s\S]*?)<\/div>/) || [])[1];
    if (!name || !ages) continue;
    const hit = CARD_KEY.find(([re]) => re.test(plain(name)));
    if (!hit) continue;                      // camp cards list several bands
    cardsChecked++;
    const want = 'Ages ' + S.byKey(hit[1]).ages;
    A(plain(ages).trim() === want,
      file + ' · ' + plain(name).trim() + ' prints "' + want + '" — got "' +
      plain(ages).trim() + '"');
  }
}
A(cardsChecked === 12, 'all 12 Broadway Bound season cards were checked — got ' + cardsChecked);

const PAGE_CASTS = {
  'frozen-kids.html': { 'Frozen KIDS Cast': 'frozen-kids' },
  'frozen-jr.html': { 'Junior Cast': 'frozen-jr', 'Broadway Bound Teen Cast': 'frozen-teen' },
  'little-mermaid-jr.html': {
    'Kids Cast': 'mermaid-kids', 'Junior Cast': 'mermaid-jr',
    'Broadway Bound Teen Cast': 'mermaid-teen',
  },
};
for (const [file, casts] of Object.entries(PAGE_CASTS)) {
  const pairs = [...read(file).matchAll(
    /<div class="perf-cast-name">([\s\S]*?)<\/div>\s*<div class="perf-cast-tag">([\s\S]*?)<\/div>/g)];
  A(pairs.length === Object.keys(casts).length,
    file + ' has ' + Object.keys(casts).length + ' cast blocks — found ' + pairs.length);
  for (const [, rawName, rawTag] of pairs) {
    const name = plain(rawName).trim();
    const key = casts[name];
    A(!!key, file + ' names a known cast — got "' + name + '"');
    if (!key) continue;
    const want = 'Performers Ages ' + S.byKey(key).ages;
    A(plain(rawTag).trim() === want,
      file + ' · ' + name + ' prints "' + want + '" — got "' + plain(rawTag).trim() + '"');
  }
}

// Two names, two programs, and they are not interchangeable (CJ, 9 Aug 2026):
//   Teen Conservatory     — the audition-based track, ages 13–18: Dear Evan
//                           Hansen, Sweeney Todd, A Christmas Carol, Hadestown,
//                           Mean Girls.
//   Broadway Bound Teen   — the teen cast inside the Broadway Bound JR. shows,
//                           ages 12–17: Frozen JR. and The Little Mermaid JR.
// The two now overlap on age; what separates them is that the Conservatory
// auditions and these cast everyone.
// The site briefly used "Broadway Bound Teen" for both, which put a 13–18
// audition track and a junior cast under one name.
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

// Shrek Jr. closed in July 2026 and its card and page were removed, but the
// chat widget kept selling it as part of the current season on every page.
for (const file of ['index.html', 'broadway-bound.html', 'calendar.html', 'classes.html',
  'teen-conservatory.html', 'netlify/functions/chat.mjs']) {
  A(!/<strong>Shrek Jr\.<\/strong> &mdash; Summer 2026|Shrek Jr\.<\/strong> — Summer 2026/.test(read(file)),
    file + ' no longer sells Shrek Jr. as a current production');
}
// Registration went public on 1 August 2026. A script flipped the banner on
// four pages; the other twenty-one were never given it and still read "Private
// Registration Now Open" eight days later. The copy is static and public now,
// and the script sets the same words.
import { readdirSync } from 'node:fs';
for (const file of readdirSync(ROOT).filter((f) => f.endsWith('.html'))) {
  const html = read(file).replace(/<script[\s\S]*?<\/script>/g, ' ');
  A(!/Private [Rr]egistration/.test(html),
    file + ' does not still advertise private registration');
}

// The audition call closed in June. The page is unlinked but still on disk as
// next season's template, so it has to be redirected, not merely orphaned.
const toml = read('netlify.toml');
A(/from = "\/teen_conservatory_auditions\.html"/.test(toml) &&
  /from = "\/teen_conservatory_auditions"/.test(toml),
  'the closed audition call redirects to the Teen Conservatory page');

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
  'christmas-carol.html': ['carol'],
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
  // Case-insensitive on purpose: this check used to be anchored on a capital
  // D and sailed straight past hadestown.html's lowercase "doors open 30
  // minutes", which sat under a full list of curtain times for weeks.
  A(!/doors open \d+ minutes/i.test(html), file + ' has no stale doors-open line');
  A(!/[Cc]urtain times are released when tickets go on sale/.test(html),
    file + ' does not claim its curtain times are unknown while printing them');
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

// A show card says when the show is, in months — "October – November 2026" —
// and nothing finer. The dates and curtain times live on the show's own page,
// where someone buying a ticket is actually looking. (CJ, 9 Aug 2026.)
console.log('\nINDEX CARDS');
const idx = plain(read('index.html'));
const P = (k) => S.byKey(k).performances;
const CARDS = [
  ['Dear Evan Hansen', P('deh')],
  ['Sweeney Todd', P('sweeney')],
  ['A Christmas Carol', P('carol')],
  ['Frozen Kids', P('frozen-kids')],
  ['Frozen', [...P('frozen-jr'), ...P('frozen-teen')]],
  ['Hadestown', P('hadestown')],
  ['The Little Mermaid', [...P('mermaid-kids'), ...P('mermaid-jr'), ...P('mermaid-teen')]],
  ['Mean Girls', P('mean-girls')],
  ['How to Train Your Dragon Jr.', P('httyd')],
  ['Charlie and the Chocolate Factory', P('charlie')],
  ['Trolls Jr.', P('trolls')],
];
A(!/class="sperf"/.test(read('index.html')),
  'no show card lists individual performances any more');

// Where each card goes. Four of them used to land on classes.html, which says
// nothing about the show a family just clicked. A card's link has to be a page
// that actually names it.
const CARD_LINKS = {
  'Dear Evan Hansen': 'dear-evan-hansen.html', 'Sweeney Todd': 'sweeney-todd.html',
  'A Christmas Carol': 'christmas-carol.html',
  'Frozen Kids': 'frozen-kids.html', Frozen: 'frozen-jr.html',
  Hadestown: 'hadestown.html', 'The Little Mermaid': 'little-mermaid-jr.html',
  'How to Train Your Dragon Jr.': 'summer-2027.html',
  'Charlie and the Chocolate Factory': 'summer-2027.html',
  'Trolls Jr.': 'summer-2027.html',
};
const cards = read('index.html').split('<a class="scard"').slice(1);
for (const card of cards) {
  const title = (card.match(/<div class="stitle">\s*([\s\S]*?)\s*<\/div>/) || [])[1];
  const href = (card.match(/^\s*href="([^"]*)"/) || [])[1];
  if (!title) continue;
  const want = CARD_LINKS[plain(title).trim()];
  if (!want) continue;                       // linked into the registration flow
  A(href === want, 'the ' + plain(title).trim() + ' card links to ' + want +
    (href === want ? '' : ' — got ' + href));
  A(existsSync(join(ROOT, want)), '  …and ' + want + ' exists');
}
A(!cards.some((c) => /^\s*href="classes\.html"/.test(c)),
  'no show card dumps a family on the classes page');
const chips = [...read('index.html').matchAll(/<div class="sdate">\s*([\s\S]*?)\s*<\/div>/g)]
  .map((m) => plain(m[1]).trim());
A(chips.length === CARDS.length, 'all eleven show cards carry a date chip');
CARDS.forEach(([title, perfs], i) => {
  const want = S.monthRange(perfs);
  A(chips[i] === want, 'the ' + title + ' card reads "' + want + '"' +
    (chips[i] === want ? '' : ' — got "' + chips[i] + '"'));
});
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
  // written out in full month names too — the short forms below were the only
  // ones checked, and "February 5-7" sat in frozen-jr.html's prose untouched
  ['February 5&ndash;7', 'the dropped Frozen Teen Sunday, spelled out'],
  ['January 22&ndash;24', 'the dropped Frozen KIDS Sunday, spelled out'],
  ['January 29&ndash;31', 'the dropped Frozen JR. Sunday, spelled out'],
  ['May 14&ndash;16', 'the dropped Mermaid KIDS Sunday, spelled out'],
  ['May 21&ndash;23', 'the dropped Mermaid JR. Sunday, spelled out'],
  ['June 4&ndash;6', 'the dropped Mermaid Teen Sunday, spelled out'],
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
