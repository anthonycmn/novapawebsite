// A full cast must never quietly move a child into another age band.
//
// The register app used to fall back to "the first cast with a seat", so when
// Frozen JR. (9-12) filled, a ten year old was dropped into the 5-9 Kids cast
// or the 12-17 Teen cast with nothing on screen to say so. openCastsFor() is
// what replaced it: it returns only the casts a child's age allows, and an
// empty list means the waitlist. This pins that behaviour to the real fall
// casts, so the bug cannot come back by way of a tidy-up.

import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../register/index.html', import.meta.url), 'utf8');

// lift the three functions out of the page and run them for real
function lift(name) {
  const at = src.indexOf('\n  function ' + name + '(');
  if (at < 0) throw new Error('register/index.html no longer defines ' + name + '()');
  let depth = 0, i = src.indexOf('{', at);
  const start = at + 1;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error('could not find the end of ' + name + '()');
}

let CASTS = [];
const build = new Function(
  'getCasts',
  [lift('castRange'), lift('castTop'), lift('openCastsFor')].join('\n') +
    '\nfunction fallActsFor(){ return getCasts(); }\n' +
    'return openCastsFor;'
);
const openCastsFor = build(() => CASTS);

// the real fall Frozen casts, with Junior over capacity (40 seats, 44 taken)
const KIDS = { id: 1959789, name: 'Broadway Bound | Frozen, Kids', age_range: '5 – 9 yrs', remaining: 5 };
const JR = { id: 1959787, name: 'Broadway Bound Junior | Frozen, Jr.', age_range: '9 – 12 yrs', remaining: -4 };
const TEENS = { id: 1959805, name: 'Broadway Bound Teens | Frozen, Jr', age_range: '12 – 17 yrs', remaining: 9 };
const TECH = { id: 1961640, name: 'Broadway Bound Frozen | Technical Theatre', age_range: '10 – 15 yrs', remaining: 20 };

let failed = 0;
function is(label, got, want) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { console.log('PASS ' + label); return; }
  failed++;
  console.log('FAIL ' + label + '\n       got  ' + a + '\n       want ' + b);
}
const offers = (age, casts = [KIDS, JR, TEENS]) => {
  CASTS = casts;
  return openCastsFor('frozen', age, JR.id).map((c) => c.id);
};

console.log('\nFrozen JR. (9-12) is full — what may each age be offered?\n');

// 9 and 12 are the overlap years, 8 and 13 the one-year grace the pills allow
is('age 8 may take Kids', offers(8), [KIDS.id]);
is('age 9 may take Kids', offers(9), [KIDS.id]);
is('age 10 sits squarely in 9-12, so it is offered nothing and waitlists', offers(10), []);
is('age 11 may take Teens on the grace year', offers(11), [TEENS.id]);
is('age 12 may take Teens', offers(12), [TEENS.id]);
is('age 13 may take Teens', offers(13), [TEENS.id]);
is('age 17 may take Teens', offers(17), [TEENS.id]);

// the bug itself, stated twice
is('a ten year old is never offered the 5-9 Kids cast', offers(10).includes(KIDS.id), false);
is('a ten year old is never offered the 12-17 Teen cast', offers(10).includes(TEENS.id), false);

console.log('\nand the rest of the rules\n');

CASTS = [KIDS, JR, TEENS];
is('the full cast is never offered as its own alternative',
  openCastsFor('frozen', 11, JR.id).some((c) => c.id === JR.id), false);
is('a cast with no seats is not offered',
  offers(9, [{ ...KIDS, remaining: 0 }, JR, TEENS]), []);
is('unknown seat counts are treated as open',
  offers(9, [{ ...KIDS, remaining: null }, JR, TEENS]), [KIDS.id]);
is('tech crew is not offered in place of performing',
  offers(10, [KIDS, JR, TEENS, TECH]), []);
is('with no birthday on file every open cast is offered, labelled by age',
  offers(null), [KIDS.id, TEENS.id]);
is('when every cast is full the answer is the waitlist',
  offers(9, [{ ...KIDS, remaining: 0 }, JR, { ...TEENS, remaining: 0 }]), []);

console.log(failed ? '\n' + failed + ' failed.\n' : '\nAll green.\n');
process.exit(failed ? 1 : 0);
