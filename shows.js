/* The performance schedule for every NoVAPA production, in one place.
 *
 * WHY THIS FILE EXISTS
 *   Performance dates were written out by hand on the show pages, the show
 *   cards, the season pages and the calendar — a dozen copies of the same
 *   facts, which drifted apart the moment one of them was corrected. This is
 *   the copy everything else is checked against.
 *
 * WHO USES IT
 *   calendar.html renders its performance entries straight from here.
 *   Every other page still carries its own hand-set markup, because a show
 *   page has to read correctly with no JavaScript at all — but tests/shows.mjs
 *   parses those pages and fails if a single date, time or run length in them
 *   disagrees with this file. Change a performance here, run the test, and it
 *   tells you every page that now needs to match.
 *
 * HOW TO EDIT
 *   `at` is local wall-clock time in ISO order — "2027-01-22 19:00" is Friday
 *   22 January 2027 at 7:00 PM at the venue. No time zone, because a curtain
 *   is a wall-clock fact about a room. The weekday is derived, never written,
 *   so a date and its printed day can never disagree.
 *
 * HOUSE
 *   The house opens 15 minutes before every curtain, for every production.
 *
 * RUN VS SLOT
 *   `runMinutes` is what we publish: how long the audience is in their seats.
 *   `slotMinutes` is how much of the room we hold, which is longer when the
 *   licensed edition is short — a Disney KIDS show is a 30-minute script in a
 *   60-minute slot. Only the run is ever printed on the site; the slot is here
 *   so the two numbers cannot be taken for each other again (CJ, Aug 9).
 */
(function (root) {
  var HOUSE_OPENS_MINUTES = 15;
  var VENUE = 'National Conference Center, Plaza C';

  // Times repeat across the summer day camps, so they are named once.
  function dayCamp(fri, sat) {
    return [
      { at: fri + ' 17:00', ages: '5–9' },
      { at: fri + ' 19:00', ages: '9–12' },
      { at: sat + ' 11:00', ages: '5–9' },
      { at: sat + ' 13:00', ages: '9–12' },
      { at: sat + ' 16:00', ages: '12–15' },
      { at: sat + ' 19:00', ages: '12–15' }
    ];
  }

  var SHOWS = [
    // ── Broadway Bound · Frozen ──────────────────────────────────────────
    {
      key: 'frozen-kids', season: 'Broadway Bound', title: 'Frozen KIDS',
      company: 'Frozen KIDS', ages: '5–9', runMinutes: 30, slotMinutes: 60, page: 'frozen-kids.html',
      performances: [
        { at: '2027-01-22 19:00' },
        { at: '2027-01-23 14:00' },
        { at: '2027-01-23 19:00' }
      ]
    },
    {
      key: 'frozen-jr', season: 'Broadway Bound', title: 'Frozen JR.',
      company: 'Frozen JR.', ages: '9–12', runMinutes: 90, page: 'frozen-jr.html',
      performances: [
        { at: '2027-01-29 19:00' },
        { at: '2027-01-30 14:00' },
        { at: '2027-01-30 19:00' }
      ]
    },
    {
      key: 'frozen-teen', season: 'Broadway Bound', title: 'Frozen (Teen Edition)',
      company: 'Frozen (Teen Edition)', ages: '13–18', runMinutes: 90, page: 'frozen-jr.html',
      performances: [
        { at: '2027-02-05 19:00' },
        { at: '2027-02-06 14:00' },
        { at: '2027-02-06 19:00' }
      ]
    },

    // ── Broadway Bound · The Little Mermaid ──────────────────────────────
    {
      key: 'mermaid-kids', season: 'Broadway Bound', title: 'Little Mermaid KIDS',
      company: 'Little Mermaid KIDS', ages: '5–9', runMinutes: 30, slotMinutes: 60, page: 'little-mermaid-jr.html',
      performances: [
        { at: '2027-05-14 19:00' },
        { at: '2027-05-15 14:00' },
        { at: '2027-05-15 19:00' }
      ]
    },
    {
      key: 'mermaid-jr', season: 'Broadway Bound', title: 'Little Mermaid JR.',
      company: 'Little Mermaid JR.', ages: '9–12', runMinutes: 90, page: 'little-mermaid-jr.html',
      performances: [
        { at: '2027-05-21 19:00' },
        { at: '2027-05-22 14:00' },
        { at: '2027-05-22 19:00' }
      ]
    },
    {
      key: 'mermaid-teen', season: 'Broadway Bound', title: 'Little Mermaid (Teen Edition)',
      company: 'Little Mermaid (Teen Edition)', ages: '13–18', runMinutes: 90,
      page: 'little-mermaid-jr.html',
      performances: [
        { at: '2027-06-04 19:00' },
        { at: '2027-06-05 14:00' },
        { at: '2027-06-05 19:00' }
      ]
    },

    // ── Summer Day Camps 2027 ────────────────────────────────────────────
    // One showcase pattern for all three: two Friday slots and four Saturday
    // slots, each an age band with its own curtain.
    {
      key: 'httyd', season: 'Summer Day Camps', title: 'How to Train Your Dragon JR.',
      company: 'Summer Day Camp', ages: '5–15', runMinutes: 90, page: 'summer-2027.html',
      performances: dayCamp('2027-07-16', '2027-07-17')
    },
    {
      key: 'charlie', season: 'Summer Day Camps',
      title: 'Charlie and the Chocolate Factory JR.',
      company: 'Summer Day Camp', ages: '5–15', runMinutes: 90, page: 'summer-2027.html',
      performances: dayCamp('2027-07-30', '2027-07-31')
    },
    {
      key: 'trolls', season: 'Summer Day Camps', title: 'Trolls JR.',
      company: 'Summer Day Camp', ages: '5–15', runMinutes: 90, page: 'summer-2027.html',
      performances: dayCamp('2027-08-13', '2027-08-14')
    },

    // ── Teen Conservatory ────────────────────────────────────────────────
    {
      key: 'deh', season: 'Teen Conservatory', title: 'Dear Evan Hansen',
      company: 'Teen Conservatory', ages: '13–18', runMinutes: 150,
      page: 'dear-evan-hansen.html',
      performances: [
        { at: '2026-08-14 19:00' },
        { at: '2026-08-15 14:00' },
        { at: '2026-08-15 19:00' },
        { at: '2026-08-16 14:00' }
      ]
    },
    {
      key: 'sweeney', season: 'Teen Conservatory', title: 'Sweeney Todd',
      company: 'Teen Conservatory', ages: '13–18', runMinutes: 150,
      page: 'sweeney-todd.html',
      performances: [
        { at: '2026-10-23 19:00' },
        { at: '2026-10-24 14:00' },
        { at: '2026-10-24 19:00' },
        { at: '2026-10-25 14:00' },
        { at: '2026-10-30 19:00' },
        { at: '2026-10-31 14:00' },
        { at: '2026-11-01 14:00' }
      ]
    },
    {
      key: 'carol', season: 'Teen Conservatory', title: 'A Christmas Carol',
      company: 'Teen Conservatory', ages: '13–18', runMinutes: 150, page: null,
      performances: [
        { at: '2026-12-04 19:00' },
        { at: '2026-12-05 14:00' },
        { at: '2026-12-05 19:00' },
        { at: '2026-12-06 14:00' },
        { at: '2026-12-10 19:00' },
        { at: '2026-12-11 19:00' },
        { at: '2026-12-12 14:00' },
        { at: '2026-12-12 19:00' },
        { at: '2026-12-13 14:00' },
        { at: '2026-12-18 19:00' },
        { at: '2026-12-19 14:00' },
        { at: '2026-12-19 19:00' },
        { at: '2026-12-20 14:00' }
      ]
    },
    {
      key: 'hadestown', season: 'Teen Conservatory', title: 'Hadestown',
      company: 'Teen Conservatory', ages: '13–18', runMinutes: 150,
      page: 'hadestown.html',
      performances: [
        { at: '2027-03-05 19:00' },
        { at: '2027-03-06 14:00' },
        { at: '2027-03-06 19:00' },
        { at: '2027-03-07 14:00' },
        { at: '2027-03-11 19:00' },
        { at: '2027-03-12 19:00' },
        { at: '2027-03-13 14:00' },
        { at: '2027-03-13 19:00' },
        { at: '2027-03-14 14:00' },
        { at: '2027-03-19 19:00' },
        { at: '2027-03-20 14:00' },
        { at: '2027-03-20 19:00' }
      ]
    },
    {
      key: 'mean-girls', season: 'Teen Conservatory', title: 'Mean Girls',
      company: 'Teen Conservatory', ages: '13–18', runMinutes: 150, page: null,
      performances: [
        { at: '2027-06-25 19:00' },
        { at: '2027-06-26 14:00' },
        { at: '2027-06-26 19:00' },
        { at: '2027-06-27 14:00' }
      ]
    }
  ];

  // ── helpers, so nothing downstream formats a date by hand ──────────────
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Parsed as local wall-clock, never UTC: `new Date('2027-01-22')` is
  // midnight UTC and lands on the 21st in Virginia.
  function parse(at) {
    var m = String(at).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  }
  function dayName(at) { var d = parse(at); return d ? DAYS[d.getDay()] : ''; }
  function monthDay(at) { var d = parse(at); return d ? MONTHS[d.getMonth()] + ' ' + d.getDate() : ''; }
  function clock(at) {
    var d = parse(at);
    if (!d) return '';
    var h = d.getHours(), mi = d.getMinutes();
    return ((h % 12) || 12) + ':' + (mi < 10 ? '0' : '') + mi + ' ' + (h < 12 ? 'AM' : 'PM');
  }
  function runLabel(min) {
    if (min < 60) return min + ' min';
    var h = Math.floor(min / 60), m = min % 60;
    return m ? h + ' hr ' + m + ' min' : h + (h === 1 ? ' hour' : ' hours');
  }
  function byKey(key) {
    for (var i = 0; i < SHOWS.length; i++) if (SHOWS[i].key === key) return SHOWS[i];
    return null;
  }

  // A short curtain time for the home-page cards: 7pm, not 7:00 PM. The cards
  // are 300px wide and carry up to thirteen curtains, so every character of
  // "7:00 PM" that isn't load-bearing is a character that wraps the line.
  function shortClock(at) {
    var d = parse(at);
    if (!d) return '';
    var h = d.getHours(), mi = d.getMinutes();
    return ((h % 12) || 12) + (mi ? ':' + (mi < 10 ? '0' : '') + mi : '') + (h < 12 ? 'am' : 'pm');
  }
  function joinTimes(list) {
    if (list.length < 2) return list.join('');
    return list.slice(0, -1).join(', ') + ' & ' + list[list.length - 1];
  }
  // "Aug 14 7pm · Aug 15 2pm & 7pm · Aug 16 2pm" — one entry per day, however
  // many curtains that day holds.
  function dayTimes(perfs) {
    var order = [], byDay = {};
    for (var i = 0; i < perfs.length; i++) {
      var day = monthDay(perfs[i].at);
      if (!byDay[day]) { byDay[day] = []; order.push(day); }
      byDay[day].push(shortClock(perfs[i].at));
    }
    return order.map(function (day) { return day + ' ' + joinTimes(byDay[day]); });
  }
  // The whole line a show card prints. `parts` is either a company's
  // performances or, for the cards that carry two or three companies,
  // [{label, performances}, …].
  function cardLine(parts) {
    var groups = Array.isArray(parts) && parts.length && parts[0].performances
      ? parts : [{ label: '', performances: parts }];
    var n = 0, out = [];
    for (var i = 0; i < groups.length; i++) {
      n += groups[i].performances.length;
      out.push((groups[i].label ? groups[i].label + ' ' : '') +
        dayTimes(groups[i].performances).join(' · '));
    }
    return n + ' performance' + (n === 1 ? '' : 's') + ' — ' + out.join(' | ');
  }

  root.NOVAPA_SHOWS = {
    houseOpensMinutes: HOUSE_OPENS_MINUTES,
    houseOpensNote: 'House opens ' + HOUSE_OPENS_MINUTES + ' minutes before every curtain.',
    venue: VENUE,
    shows: SHOWS,
    parse: parse,
    dayName: dayName,
    monthDay: monthDay,
    clock: clock,
    shortClock: shortClock,
    dayTimes: dayTimes,
    cardLine: cardLine,
    runLabel: runLabel,
    byKey: byKey
  };
})(typeof window !== 'undefined' ? window : globalThis);
