/* Sweeps the site for information that has gone stale or self-contradictory.
 *
 * WHY
 *   A season's worth of copy is written across forty pages by hand, and it
 *   rots in predictable ways: a deadline passes and the page still sells it,
 *   a show closes and the chatbot still lists it, a price changes in the
 *   server config and not in the sentence a parent reads. Every one of those
 *   has happened here. This finds them on a schedule instead of by accident.
 *
 * WHAT IT DOES AND DOES NOT DO
 *   Some rot has one provably correct answer — "doors open 30 minutes" when
 *   the house opens 15, "private registration" after registration went
 *   public. Those it can fix, and --fix does.
 *   The rest is judgement: which of two prices is right, whether a passed
 *   deadline should move or go. It never guesses at those. It reports them
 *   and names the pages, and a human decides.
 *
 * RUN
 *   node tools/sweep.mjs           report only
 *   node tools/sweep.mjs --fix     apply the fixable ones, then report
 *   node tools/sweep.mjs --json    machine-readable, for a scheduled run
 *   node tools/sweep.mjs --days 21 how far ahead to warn about deadlines
 *
 * EXIT CODE
 *   0 when nothing needs a person, 1 when something does. A scheduled run
 *   uses that to decide whether it is worth interrupting anyone.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const FIX = argv.includes('--fix');
const JSON_OUT = argv.includes('--json');
const WARN_DAYS = Number((argv.find((a) => a.startsWith('--days')) || '').split('=')[1]
  || argv[argv.indexOf('--days') + 1] || 21) || 21;
const NOW = new Date();
const TODAY = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate());

// ── the canonical facts ─────────────────────────────────────────────────
const shows = (() => {
  globalThis.window = undefined;
  const g = {};
  new Function('module', 'globalThis', readFileSync(join(ROOT, 'shows.js'), 'utf8')).call(g, {}, g);
  return g.NOVAPA_SHOWS;
})();

const serverCfg = readFileSync(join(ROOT, 'netlify/functions/reg-config.mjs'), 'utf8');
const clientCfg = readFileSync(join(ROOT, 'register/config.js'), 'utf8');
const constOf = (src, name) => {
  const m = src.match(new RegExp('(?:export const|\\b)' + name + '\\s*[:=]\\s*("[^"]*"|\\d+)'));
  return m ? m[1].replace(/"/g, '') : null;
};

// Pages that are archives or templates on purpose. Their dates are supposed
// to be in the past; nagging about them every week trains people to ignore
// the report.
const FROZEN_IN_TIME = new Set([
  'camp-info-2026-archive.html',       // last summer's parent info, kept for reference
  'summer-camp-newsletters.html',      // the newsletter archive
  'teen_conservatory_auditions.html',  // redirected; kept as next season's template
  'brand.html',                        // internal brand reference
  'star-pages.html',
]);
// Legal pages carry the date a policy took effect. That is not staleness.
const EFFECTIVE_DATE_PAGES = new Set(['privacy.html', 'terms.html', 'cookies.html', 'policies.html']);

const htmlFiles = () => [
  ...readdirSync(ROOT).filter((f) => f.endsWith('.html')),
  ...readdirSync(join(ROOT, 'register')).filter((f) => f.endsWith('.html')).map((f) => 'register/' + f),
];
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const write = (f, s) => writeFileSync(join(ROOT, f), s);
// Copy a visitor actually reads: no scripts, no styles, no comments, no
// base64. Almost every false positive this sweep could produce comes from
// forgetting one of those.
const visible = (s) => s
  .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/"data:[^"]*"/g, '""')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&middot;/g, '·')
  .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&rsquo;/g, '’')
  .replace(/\s+/g, ' ');

const findings = [];
const fixed = [];
// level: 'fix'  — one provably right answer, --fix applies it
//        'ask'  — a person has to choose
//        'watch'— nothing wrong yet, but it expires soon
const add = (level, kind, detail, where) =>
  findings.push({ level, kind, detail, where: [].concat(where) });

// ── 1. contradictions between the two config files ──────────────────────
// The browser shows one number and the server charges another. This has to
// be first because it is the only class of finding that costs money.
const CONFIG_PAIRS = [
  ['price of a summer camp', 'PRICE', 'PRICE_CENTS', (c) => String(Number(c) * 100)],
  ['deposit per camp', 'DEPOSIT_PER_CAMP', 'DEPOSIT_PER_ITEM_CENTS', (c) => String(Number(c) * 100)],
  ['number of installments', 'INSTALLMENTS', 'MAX_INSTALLMENTS', (c) => c],
  ['insurance percentage', 'INSURANCE_PCT', 'INSURANCE_PCT', (c) => c],
  ['pay-in-full cutoff', 'PAY_FULL_CUTOFF_DAYS', 'PAY_FULL_CUTOFF_DAYS', (c) => c],
  ['launch sale end', 'EARLYBIRD_END', 'EARLYBIRD_END', (c) => c],
  ['public registration open', 'PUBLIC_OPEN_AT', 'PUBLIC_OPEN_AT', (c) => c],
];
for (const [label, clientName, serverName, toServer] of CONFIG_PAIRS) {
  const c = constOf(clientCfg, clientName);
  const s = constOf(serverCfg, serverName);
  if (c == null || s == null) {
    add('ask', 'config', `cannot read the ${label} from both configs ` +
      `(register/config.js ${clientName}=${c}, reg-config.mjs ${serverName}=${s})`,
      ['register/config.js', 'netlify/functions/reg-config.mjs']);
    continue;
  }
  if (toServer(c) !== s) {
    add('ask', 'config', `the ${label} disagrees: the browser shows ${c} ` +
      `(config.js ${clientName}) but the server uses ${s} (reg-config.mjs ${serverName})`,
      ['register/config.js', 'netlify/functions/reg-config.mjs']);
  }
}

const EARLYBIRD_END = new Date(constOf(serverCfg, 'EARLYBIRD_END'));
const PUBLIC_OPEN_AT = new Date(constOf(serverCfg, 'PUBLIC_OPEN_AT'));

// ── 2. registration state vs the copy on the page ───────────────────────
if (NOW >= PUBLIC_OPEN_AT) {
  const priv = [];
  for (const f of htmlFiles()) {
    if (/Private [Rr]egistration/.test(visible(read(f)))) priv.push(f);
  }
  if (priv.length) {
    add('fix', 'registration', 'registration went public on ' +
      PUBLIC_OPEN_AT.toDateString() + ' but these pages still call it private', priv);
    if (FIX) {
      for (const f of priv) {
        const before = read(f);
        const after = before
          .replace(/<span class="ab-pulse"><\/span>Private Registration Now Open/g,
            '<span class="ab-pulse"></span>Registration Now Open')
          .replace(/aria-label="Private registration for Summer 2027 now open &mdash; register now"/g,
            'aria-label="Summer 2027 registration now open to everyone &mdash; register now"');
        if (after !== before) { write(f, after); fixed.push(f + ' — banner copy is public now'); }
      }
    }
  }
}

// ── 3. the launch sale ──────────────────────────────────────────────────
// The sale date is in the copy on two dozen pages and in no script. Nothing
// flips it, so it has to be a person, and they need warning.
const saleDays = Math.ceil((EARLYBIRD_END - NOW) / 86400000);
const salePages = htmlFiles().filter((f) => /through August 15|by August 15|Register by August 15/i
  .test(visible(read(f))));
if (salePages.length) {
  if (saleDays < 0) {
    add('ask', 'sale', `the launch sale ended ${-saleDays} day(s) ago (${EARLYBIRD_END.toDateString()}) ` +
      'but these pages still advertise it — decide whether to extend the date in ' +
      'register/config.js and reg-config.mjs, or take the copy down', salePages);
  } else if (saleDays <= WARN_DAYS) {
    add('watch', 'sale', `the launch sale ends in ${saleDays} day(s) and is written into the copy ` +
      `on ${salePages.length} pages — nothing flips it automatically`, salePages);
  }
}

// ── 4. the house ────────────────────────────────────────────────────────
// One rule, every production, and it is printed by hand on every show page.
const HOUSE = shows.houseOpensMinutes;
const HOUSE_RX = /(?:house|doors)\s+opens?\s+(\d+)\s+minutes/gi;
for (const f of htmlFiles()) {
  const src = read(f);
  const wrong = [...visible(src).matchAll(HOUSE_RX)].filter((m) => Number(m[1]) !== HOUSE);
  if (!wrong.length) continue;
  add('fix', 'house', `says the house opens ${wrong.map((m) => m[1]).join('/')} minutes ` +
    `before curtain; every production opens ${HOUSE}`, [f]);
  if (FIX) {
    const after = src.replace(
      /[Cc]urtain times are released when tickets go on sale &mdash; doors open \d+ minutes before each performance\./g,
      shows.houseOpensNote)
      .replace(/([Dd]oors|[Hh]ouse) open(s?) \d+ minutes before (each|every) (performance|curtain)/g,
        (m, w, s2) => (w[0] === w[0].toUpperCase() ? 'House' : 'house') + ' open' + s2 +
          ' ' + HOUSE + ' minutes before every curtain');
    if (after !== src) { write(f, after); fixed.push(f + ' — house opens ' + HOUSE + ' minutes'); }
  }
}

// ── 5. shows we no longer produce ───────────────────────────────────────
// A closed show that is still listed is the site selling something that
// does not exist. Saying a show has closed is not the same as listing it,
// so a mention that is explicitly in the past tense does not count.
const PAST_TENSE = /\b(clos(ed|es|ing)|ended|is over|retired|past|last (summer|season|year)|archive)\b/i;
const LIVE_TITLES = shows.shows.map((s) => s.title.replace(/\s*(JR\.|KIDS)$/i, '').trim());
const WATCHED_TITLES = ['Shrek', 'Matilda', 'Newsies', 'Annie', 'Seussical', 'Aladdin', 'Moana',
  'Lion King', 'Descendants', 'High School Musical', 'Willy Wonka'];
const stillSells = (text, title) => {
  const rx = new RegExp('.{0,90}\\b' + title + '\\b.{0,90}', 'gs');
  return [...text.matchAll(rx)].some((m) => !PAST_TENSE.test(m[0]));
};
const chatSrc = readFileSync(join(ROOT, 'netlify/functions/chat.mjs'), 'utf8');
for (const title of WATCHED_TITLES) {
  if (LIVE_TITLES.some((t) => t.toLowerCase().includes(title.toLowerCase()))) continue;
  const on = htmlFiles().filter((f) => !FROZEN_IN_TIME.has(basename(f)) &&
    stillSells(visible(read(f)), title));
  const inChat = stillSells(chatSrc, title);
  if (!on.length && !inChat) continue;
  add('ask', 'retired show', `${title} is not in this season's schedule but is still named on ` +
    `${on.length} page(s)${inChat ? ' and in the chatbot' : ''} — confirm it is retired and ` +
    'should come down, or add it to shows.js if it is really running',
    on.concat(inChat ? ['netlify/functions/chat.mjs'] : []));
}

// ── 6. how many shows we say we have ────────────────────────────────────
// "Nine shows across the season" outlived the ninth show by two months.
// Compared against the list right underneath it, not against shows.js —
// shows.js counts casts, the list counts productions, and those are
// different numbers for good reasons.
const COUNT_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const WORD_FOR = Object.fromEntries(Object.entries(COUNT_WORDS).map(([w, n]) => [n, w]));
const cap = (w) => w[0].toUpperCase() + w.slice(1);
for (const f of htmlFiles().concat(['netlify/functions/chat.mjs'])) {
  const src = readFileSync(join(ROOT, f), 'utf8');
  let out = src;
  for (const m of src.matchAll(/(\w+) shows across the season!<\/strong>([\s\S]{0,1600}?)`/g)) {
    const claimed = COUNT_WORDS[m[1].toLowerCase()] ?? Number(m[1]);
    const listed = (m[2].match(/•/g) || []).length;
    if (!claimed || !listed || claimed === listed) continue;
    const right = WORD_FOR[listed] || String(listed);
    add('fix', 'show count', `says "${m[1]} shows across the season" over a list of ${listed} — ` +
      `the sentence should say ${right}`, [f]);
    out = out.replace(m[1] + ' shows across the season!',
      (/^[A-Z]/.test(m[1]) ? cap(right) : right) + ' shows across the season!');
  }
  if (FIX && out !== src) {
    writeFileSync(join(ROOT, f), out);
    fixed.push(f + ' — the season count matches the list under it');
  }
}

// ── 7. deadlines that have already passed ───────────────────────────────
// Only where the sentence treats the date as something still to come. A
// yearless date is read as the nearest one, which is how a reader reads it.
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sept: 9, sep: 9, oct: 10, nov: 11, dec: 12 };
// The trigger word has to be immediately in front of the date — "register by
// August 1" — not merely somewhere in the paragraph. A loose window turned
// every curtain time on a show page into a missed deadline, because the words
// "on sale soon" were forty characters away.
const FUTURE_TALK = /\b(register by|sign up (?:by|for)|reserve[sd]? (?:by|your)|deadline[^.]{0,20}|due|opens?|open to|closes?|closing|submit(?:ted)? by|submissions? (?:by|through)|accepted through|apply by|last chance|ends?|save your|join the waitlist|through|until|no later than)[:\s]*$/i;
const DATE_RX = new RegExp(
  '(' + Object.keys(MONTHS).join('|') + ')\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(20\\d\\d))?', 'gi');
// Every day we have a curtain on. A performance is not a deadline, and the
// schedule suite already owns those dates — without this, a 2027 show read as
// a 2026 date that had "passed".
const CURTAIN_DAYS = new Set(shows.shows.flatMap((s) => s.performances
  .map((p) => shows.parse(p.at)).filter(Boolean)
  .map((d) => (d.getMonth() + 1) + '/' + d.getDate())));
const nearest = (mon, day, year) => {
  if (year) return new Date(year, mon - 1, day);
  let best = null;
  for (const y of [NOW.getFullYear() - 1, NOW.getFullYear(), NOW.getFullYear() + 1]) {
    const d = new Date(y, mon - 1, day);
    if (!best || Math.abs(d - TODAY) < Math.abs(best - TODAY)) best = d;
  }
  return best;
};
for (const f of htmlFiles()) {
  const name = basename(f);
  if (FROZEN_IN_TIME.has(name)) continue;
  const t = visible(read(f));
  const seen = new Set();
  // "the last pull is June 1, 2027" and "monthly through June 1" are the same
  // day. Read the bare one with the year its spelled-out twin carries, or the
  // nearest-year guess turns a 2027 date into a 2026 one that has "passed".
  const yearOnPage = new Map();
  for (const m of t.matchAll(DATE_RX)) {
    if (!m[3]) continue;
    yearOnPage.set(MONTHS[m[1].toLowerCase().replace('.', '')] + '/' + Number(m[2]), Number(m[3]));
  }
  for (const m of t.matchAll(DATE_RX)) {
    const mon = MONTHS[m[1].toLowerCase().replace('.', '')];
    const day = Number(m[2]);
    if (!m[3] && CURTAIN_DAYS.has(mon + '/' + day)) continue;   // a curtain, not a deadline
    const year = m[3] ? Number(m[3]) : yearOnPage.get(mon + '/' + day);
    const d = nearest(mon, day, year);
    if (!d || d >= TODAY) continue;
    const before = t.slice(Math.max(0, m.index - 40), m.index);
    if (!FUTURE_TALK.test(before)) continue;
    const around = t.slice(Math.max(0, m.index - 110), m.index + m[0].length + 60);
    if (EFFECTIVE_DATE_PAGES.has(name) && /effective date/i.test(around)) continue;
    const key = m[0] + '|' + before.slice(-20);
    if (seen.has(key)) continue;
    seen.add(key);
    add('ask', 'passed deadline',
      `"${m[0]}" reads as still to come but was ${Math.round((TODAY - d) / 86400000)} day(s) ago — ` +
      `…${around.trim().slice(-150)}`, [f]);
  }
}

// ── 8. links that go nowhere, and pages nothing links to ────────────────
const redirected = readFileSync(join(ROOT, 'netlify.toml'), 'utf8');
const hasRedirect = (t) => new RegExp('from = "' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"')
  .test(redirected);
const pageSet = new Set(htmlFiles().map((f) => f.replace(/^\.\//, '')));
const linkedTo = new Set();
const broken = [];
// The shared nav and the registration flow build their links in JavaScript,
// so a page linked only from nav.js is not an orphan.
const linkSources = htmlFiles().concat(['nav.js', 'register/catalog.html']
  .filter((f) => existsSync(join(ROOT, f))));
for (const f of linkSources) {
  const dir = f.includes('/') ? f.split('/')[0] + '/' : '';
  const src = readFileSync(join(ROOT, f), 'utf8');
  for (const m of src.matchAll(/(?:href=|["'`])(\/?[\w./-]+?\.html)(?:[#?][^"'`]*)?["'`]/g)) {
    let target = m[1];
    if (/^(https?:)?\/\//.test(target)) continue;
    target = target.replace(/^\.\//, '');
    const candidates = [target.replace(/^\//, ''), dir + target, target];
    const hit = candidates.find((c) => pageSet.has(c) || existsSync(join(ROOT, c)));
    if (hit) linkedTo.add(pageSet.has(hit) ? hit : hit.replace(/^\//, ''));
    else if (!hasRedirect('/' + target.replace(/^\//, ''))) broken.push(`${f} → ${m[1]}`);
  }
}
// nav.js names pages without the extension, e.g. href="/classes".
for (const m of (existsSync(join(ROOT, 'nav.js'))
  ? readFileSync(join(ROOT, 'nav.js'), 'utf8') : '').matchAll(/["'`]\/([\w-]+)\/?["'`]/g)) {
  if (pageSet.has(m[1] + '.html')) linkedTo.add(m[1] + '.html');
  if (pageSet.has(m[1] + '/index.html')) linkedTo.add(m[1] + '/index.html');
}
if (broken.length) {
  add('ask', 'broken link', 'these links point at a page that is neither in the repository ' +
    'nor redirected in netlify.toml: ' + broken.join('; '),
    [...new Set(broken.map((b) => b.split(' → ')[0]))]);
}
const orphans = htmlFiles().filter((f) => {
  const name = basename(f);
  if (f === 'index.html' || f === 'register/index.html') return false;
  if (FROZEN_IN_TIME.has(name)) return false;
  if (linkedTo.has(f) || linkedTo.has(name)) return false;
  if (hasRedirect('/' + name) || hasRedirect('/' + name.replace('.html', ''))) return false;
  return true;
});
if (orphans.length) {
  add('ask', 'orphan page', 'live and reachable by URL, but nothing on the site links to it — ' +
    'either link it, redirect it, or confirm it is meant to be unlisted', orphans);
}

// ── 9. the schedule suite ───────────────────────────────────────────────
// tests/shows.mjs already knows every date, time, title and cast on every
// page. No point restating it here — just run it and carry its failures.
try {
  execFileSync(process.execPath, [join(ROOT, 'tests/shows.mjs')], { encoding: 'utf8' });
} catch (e) {
  const fails = String(e.stdout || '').split('\n').filter((l) => l.includes('FAIL'));
  add('ask', 'schedule', 'the schedule suite disagrees with shows.js:\n      ' +
    fails.map((l) => l.replace(/^\s*FAIL\s*/, '')).join('\n      '), ['tests/shows.mjs']);
}

// ── 10. prices on pages vs the catalog ──────────────────────────────────
// The DB (activities.price_cents) is what checkout charges. Marketing pages
// hand-write dollar amounts next to their register links, and nothing else
// compares the two — this is how a page advertised $1,695 while three other
// sources said $1,950. Any register link with dollar amounts nearby must
// have at least one amount that matches the catalog price for that id.
// Needs the network; when the catalog is unreachable the section skips
// rather than crying wolf.
await (async () => {
  const url = constOf(serverCfg, 'SUPABASE_URL');
  const anon = constOf(serverCfg, 'SUPABASE_ANON_KEY');
  if (!url || !anon) return;
  let catalog;
  try {
    const res = await fetch(url + '/rest/v1/rpc/catalog_list', {
      method: 'POST',
      headers: { apikey: anon, Authorization: 'Bearer ' + anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_ids: [] }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return;
    catalog = await res.json();
  } catch { return; }   // offline run — the scheduled run will catch it
  const priceOf = new Map(catalog.map((a) => [String(a.id), a.price_cents]));
  const nameOf = new Map(catalog.map((a) => [String(a.id), a.name]));
  // hidden activities (teen shows, DEH) are absent from the bulk list but
  // resolve when asked for by id — that is the direct-link sales design
  const askCatalog = async (ids) => {
    try {
      const res = await fetch(url + '/rest/v1/rpc/catalog_list', {
        method: 'POST',
        headers: { apikey: anon, Authorization: 'Bearer ' + anon, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_ids: ids.map(Number) }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) for (const a of await res.json()) {
        priceOf.set(String(a.id), a.price_cents);
        nameOf.set(String(a.id), a.name);
      }
    } catch { /* leave them missing; the finding below stands */ }
  };
  const linkedIds = new Set();
  for (const f of htmlFiles()) {
    for (const m of read(f).matchAll(/\/register\/\?activity=(\d+)/g)) linkedIds.add(m[1]);
  }
  const missing = [...linkedIds].filter((id) => !priceOf.has(id));
  if (missing.length) await askCatalog(missing);
  const asDollars = (cents) => {
    const d = cents / 100;
    return Number.isInteger(d) ? d.toLocaleString('en-US') : d.toLocaleString('en-US', { minimumFractionDigits: 2 });
  };
  for (const f of htmlFiles()) {
    if (FROZEN_IN_TIME.has(basename(f))) continue;
    const src = read(f);
    // Judged per page, per activity: a page passes if ANY of its register
    // links for that id states the right price nearby. Per-link judgement
    // flagged the value-comparison table above a correct price card.
    const pages = new Map();   // id -> {stated:boolean, amounts:Set}
    for (const m of src.matchAll(/\/register\/\?activity=(\d+)/g)) {
      const id = m[1];
      const cents = priceOf.get(id);
      if (cents == null) {
        add('ask', 'price', `links to activity ${id} which is not in the catalog — the link ` +
          'dead-ends at "unknown activity"', [f]);
        continue;
      }
      const windowTxt = visible(src.slice(Math.max(0, m.index - 1200), m.index + 400));
      // "$2,570 à la carte" / "save $875" are comparisons, not the price.
      // Direction matters: the compare-word AFTER an amount belongs to that
      // amount ("$2,570 à la carte"), but a trailing compare-word from the
      // PREVIOUS amount often sits right before the real price — so leading
      // words only disqualify when they directly govern it ("save $875").
      const AFTER = /^.{0,30}?(à la carte|a la carte|piece by piece|value|savings|per month|\/mo)/i;
      const BEFORE = /(save|don'?t pay|instead of|was|worth)\s*$/i;
      const amounts = [...windowTxt.matchAll(/\$\s?([\d,]+(?:\.\d\d)?)/g)]
        .filter((a) => !AFTER.test(windowTxt.slice(a.index + a[0].length)) &&
                       !BEFORE.test(windowTxt.slice(Math.max(0, a.index - 15), a.index)))
        .map((a) => a[1].replace(/,/g, ''));
      const want = asDollars(cents).replace(/,/g, '');
      const rec = pages.get(id) || { stated: false, sawAmounts: new Set(), cents };
      if (amounts.includes(want)) rec.stated = true;
      amounts.forEach((a) => rec.sawAmounts.add(a));
      pages.set(id, rec);
    }
    for (const [id, rec] of pages) {
      if (rec.stated || !rec.sawAmounts.size) continue;
      add('ask', 'price', `advertises ${[...rec.sawAmounts].map((a) => '$' + a).join('/')} near ` +
        `register link(s) for "${nameOf.get(id)}" (${id}) but the catalog — what checkout charges — ` +
        `says $${asDollars(rec.cents)}`, [f]);
    }
  }
  // register/coaching.js is a hand-kept display mirror of the same rows
  const co = readFileSync(join(ROOT, 'register/coaching.js'), 'utf8');
  for (const m of co.matchAll(/id:\s*(9\d{5}),[\s\S]{0,200}?price:\s*(\d+)/g)) {
    const cents = priceOf.get(m[1]);
    if (cents != null && Number(m[2]) !== cents) {
      add('ask', 'price', `register/coaching.js says ${m[1]} costs $${asDollars(Number(m[2]))} but the ` +
        `catalog says $${asDollars(cents)} — the page shows the catalog price, fix the mirror`,
        ['register/coaching.js']);
    }
  }
})();

// ── report ──────────────────────────────────────────────────────────────
// The same sentence lives on twenty pages, so the same problem is found
// twenty times. One row per problem, with the pages listed under it — a
// report nobody scrolls is a report nobody reads.
const merged = [];
for (const f of findings) {
  const same = merged.find((m) => m.level === f.level && m.kind === f.kind && m.detail === f.detail);
  if (same) same.where.push(...f.where);
  else merged.push({ ...f, where: [...f.where] });
}
merged.forEach((m) => { m.where = [...new Set(m.where)]; });
findings.length = 0;
findings.push(...merged);
const byLevel = (l) => findings.filter((f) => f.level === l);
if (JSON_OUT) {
  console.log(JSON.stringify({ ran: NOW.toISOString(), fixed, findings }, null, 2));
} else {
  const list = (rows) => rows.map((r) =>
    `  • [${r.kind}] ${r.detail}\n      ${r.where.slice(0, 8).join(', ')}` +
    (r.where.length > 8 ? ` … and ${r.where.length - 8} more` : '')).join('\n\n');
  console.log(`NOVAPA site sweep — ${NOW.toDateString()}\n`);
  if (fixed.length) console.log(`FIXED (${fixed.length})\n` + fixed.map((f) => '  • ' + f).join('\n') + '\n');
  const stillFixable = byLevel('fix').length && !FIX;
  if (stillFixable) console.log(`CAN BE FIXED AUTOMATICALLY — rerun with --fix (${byLevel('fix').length})\n` +
    list(byLevel('fix')) + '\n');
  const ask = byLevel('ask');
  console.log(ask.length ? `NEEDS A DECISION (${ask.length})\n` + list(ask) + '\n'
    : 'NEEDS A DECISION\n  nothing — no contradictions found.\n');
  const watch = byLevel('watch');
  if (watch.length) console.log(`EXPIRING SOON (${watch.length})\n` + list(watch) + '\n');
  console.log(ask.length || stillFixable
    ? `${ask.length + (stillFixable ? byLevel('fix').length : 0)} item(s) want attention.`
    : 'Nothing wants attention.');
}
process.exitCode = (byLevel('ask').length || (byLevel('fix').length && !FIX)) ? 1 : 0;
