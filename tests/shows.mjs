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
  ['register/index.html', 'httyd', 'Performances Jul 16–17'],
  ['register/index.html', 'charlie', 'Performances Jul 30–31'],
  ['register/index.html', 'trolls', 'Performances Aug 13–14'],
];
for (const [file, key, text] of RANGES) {
  const html = plain(read(file));
  A(html.includes(text), file + ' shows ' + key + ' as "' + text + '"');
  // and the text has to be the real first and last day of that run
  const f = first(key).replace(/^[A-Za-z]+ /, ''), l = last(key).replace(/^[A-Za-z]+ /, '');
  A(text.includes(f) && text.includes(l),
    '  …which is the real first (' + first(key) + ') and last (' + last(key) + ') day');
}

// every index card carries its curtain days
console.log('\nINDEX CARDS');
const idx = plain(read('index.html'));
const CARDS = {
  'Dear Evan Hansen': 'deh', 'Sweeney Todd': 'sweeney', 'A Christmas Carol': 'carol',
  'Frozen Kids': 'frozen-kids', Hadestown: 'hadestown', 'Mean Girls': 'mean-girls',
  'How to Train Your Dragon Jr.': 'httyd',
  'Charlie and the Chocolate Factory': 'charlie', 'Trolls Jr.': 'trolls',
};
A((read('index.html').match(/class="sperf"/g) || []).length === 11,
  'all eleven show cards carry a performance line');
for (const [title, key] of Object.entries(CARDS)) {
  const show = S.byKey(key);
  const days = [...new Set(show.performances.map((p) => S.monthDay(p.at)))];
  const n = show.performances.length;
  A(idx.includes(n + ' performance' + (n === 1 ? '' : 's') + ' — ' + days.join(' · ')),
    'the ' + title + ' card lists ' + n + ' performances on ' + days.join(', '));
}

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
