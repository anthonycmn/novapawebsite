/* Dear Evan Hansen staff dashboard.
   Schedule data: deh/data.js. Scene breakdown: deh/scenes.js. Neither is
   hand-edited — rebuild them rather than patching, or the ids that carry
   everyone's check-offs and sourcing state detach from what they describe.

   Two kinds of state, both stored the same way:
     done[blockId]  = { by, at }                        — schedule check-offs
     item[itemId]   = { st, src, link, price, qty, by }  — sourcing + cost

   Both sync through Supabase when db/deh-progress.sql has been run; until
   then they live in localStorage on the phone that entered them. The UI is
   identical either way, so nobody has to know which mode they are in. */
(function () {
  var D = window.DEH, S = window.DEHSCENES;
  var LS_DONE = 'deh.done.v1', LS_ITEM = 'deh.items.v1', LS_ME = 'deh.me.v1', LS_GATE = 'deh.gate.v1';
  var LS_ROSTER = 'deh.roster.v1', LS_ATT = 'deh.att.v1', LS_NOTE = 'deh.notes.v1', LS_REP = 'deh.rep.v1';
  var LS_STRIKE = 'deh.strike.v1';
  var GATE_WORD = 'orchard';   // curtain, not a lock — change here and tell staff

  // Who can sign a block off. Anyone not listed picks "Someone else" and types.
  var STAFF = ['Danielle', 'Shelby', 'Ryyana', 'Colton', 'Tony', 'Stage Manager'];

  // Where the two outgoing emails land. These are printed on the buttons so
  // nobody sends one without knowing who reads it. The addresses themselves
  // are fixed inside netlify/functions/deh-report.mjs — this page only names
  // them, it cannot choose them.
  var REPORT_TO = ['colton@novapa.org', 'ryyana@novapa.org', 'katieh@novapa.org', 'cj@novapa.org'];
  var REPORT_WHO = 'Colton, Ryyana, Katie and CJ';
  var BUY_TO = 'todd@novapa.org';

  // Attendance states, in the order a tap cycles through them.
  var ATT = [
    { k: 'present', l: 'In',      s: '✓' },
    { k: 'late',    l: 'Late',    s: 'L' },
    { k: 'absent',  l: 'Out',     s: '✕' },
    { k: 'excused', l: 'Excused', s: 'E' }
  ];
  function attNext(k) {
    for (var i = 0; i < ATT.length; i++) if (ATT[i].k === k) return ATT[(i + 1) % ATT.length].k;
    return 'present';
  }
  function attLabel(k) {
    for (var i = 0; i < ATT.length; i++) if (ATT[i].k === k) return ATT[i];
    return ATT[0];
  }

  // Departments a note can be filed against, the way a stage manager files to
  // each design head. Keys match db/deh-progress.sql and deh-report.mjs, and
  // this order is the order the report prints them in.
  //
  // The design departments were one line each ("Costume / H&M", "Set / LX /
  // Sound") until CJ asked for them separately — a note for the wig head
  // should not have to be read out of a paragraph addressed to costumes.
  // The prompt is what the box says before anyone types in it. A stage manager
  // filling this in while the director is still working needs to be reminded
  // what this department wants to hear, not asked an open question.
  var DEPTS = [
    { k: 'general',    l: 'General',        p: 'Anything the whole team should know' },
    { k: 'stage',      l: 'Stage',          p: 'Blocking changes, spacing, calls, running order' },
    { k: 'music',      l: 'Music',          p: 'Cuts, tempi, harmony fixes, who needs a part call' },
    { k: 'scenic',     l: 'Scenic',         p: 'Set pieces, shifts, tracking, what is standing in for what' },
    { k: 'lighting',   l: 'Lighting',       p: 'Specials, cues, blackouts, anything the actor cannot find' },
    { k: 'sound',      l: 'Sound',          p: 'Mics, balance, playback, cue placement' },
    { k: 'projection', l: 'Projection',     p: 'Content, timing, surfaces, what is still a placeholder' },
    { k: 'sfx',        l: 'Special FX',     p: 'Practicals, haze, breakaways, anything that fires' },
    { k: 'props',      l: 'Props',          p: 'Adds, cuts, substitutions, what broke' },
    { k: 'costume',    l: 'Costumes',       p: 'Fittings, quick changes, adds and cuts, what needs a double' },
    { k: 'hair',       l: 'Hair & Make-Up', p: 'Looks, timing, what has to be done before the half' },
    { k: 'wigs',       l: 'Wigs',           p: 'Fittings, prep, changes, who is in what' },
    { k: 'safety',     l: 'Safety',         p: 'Injuries, near misses, anything that needs a spot or a rail' }
  ];
  // Notes filed before the split still carry this key. It is not offered in
  // the picker any more, but it has to keep rendering with a name on it.
  var DEPTS_OLD = { tech: 'Set / LX / Sound' };
  function deptLabel(k) {
    for (var i = 0; i < DEPTS.length; i++) if (DEPTS[i].k === k) return DEPTS[i].l;
    return DEPTS_OLD[k] || k;
  }
  function deptRank(k) {
    for (var i = 0; i < DEPTS.length; i++) if (DEPTS[i].k === k) return i;
    return DEPTS.length;   // anything retired sorts to the end
  }
  function deptPrompt(k) {
    for (var i = 0; i < DEPTS.length; i++) if (DEPTS[i].k === k) return DEPTS[i].p;
    return 'What happened, what is needed, what to watch';
  }

  var done = {}, item = {};
  // roster: [{person_id,name,role,kind,sort}]  att: { 'iso|person_id': {status,note,by} }
  // notes: [{note_id,day,dept,body,author,created_at}]  reports: { iso: {at,by} }
  var roster = [], att = {}, notes = [], reports = {};
  // strike: [{task_id,area,body,who,done,done_by,sort}]
  var strike = [];
  var loadedDays = {};   // iso -> true, so a day's attendance/notes fetch once
  var me = localStorage.getItem(LS_ME) || '';
  var remote = false;

  var TRACKS = {
    'STAGE': 'stage', 'STAGE (CLOSED)': 'stage', 'STAGE+MUSIC': 'stage',
    'SPACING': 'stage', 'RUN': 'run', 'REVIEW': 'stage', 'WORK': 'stage',
    'FINAL DRESS': 'perf', 'PERFORMANCE': 'perf', 'MILESTONE': 'perf',
    'MUSIC': 'music',
    'COSTUME/H&M': 'costume',
    'SET/LX/SND': 'tech', 'LOAD-IN: SET': 'tech', 'LOAD-IN: LX/SND': 'tech', 'TECH': 'tech',
    'STUDY': 'study',
    'ALL CO.': 'co', 'NOTES': 'co', 'RESET': 'co',
    'BREAK': 'rest', 'LUNCH': 'rest'
  };
  function trackClass(k) { return TRACKS[k] || 'co'; }
  function isTask(b) { return b.k !== 'BREAK' && b.k !== 'LUNCH'; }

  // Sourcing pipeline. `done` is the end state for anything, whether it was
  // bought, pulled from stock, or built in the shop.
  var STATES = [
    { k: 'todo',    l: 'To source' },
    { k: 'sourced', l: 'Sourced' },
    { k: 'ordered', l: 'Ordered' },
    { k: 'arrived', l: 'Arrived' },
    { k: 'done',    l: 'Done' }
  ];
  var VENDORS = ['Amazon', 'In stock', 'Build in shop', 'Facebook Marketplace', 'Thrift / consignment', 'Local store', 'Borrowed'];
  var CATS = { set: 'Set', prop: 'Props', costume: 'Costumes' };
  // Department budgets, in cents (CJ, Jul 31). $500 each.
  var BUDGET = { set: 50000, prop: 50000, costume: 50000 };
  var BUDGET_TOTAL = BUDGET.set + BUDGET.prop + BUDGET.costume;

  // Tracks and scripts. Everything below is drawn from the MTI and ProductionPro
  // correspondence on the company account, July 2026. No password is printed on
  // this page on purpose — see the ORG LOGIN row for why and for who holds it.
  var ACCESS = [
    { k: 'TRACKS AND SCRIPTS', v: '' },
    { k: 'MTI ACCOUNT', v: 'Northern Virginia Performing Arts, account number 9012523. Dear Evan Hansen sits under this account; the ProductionPro order on it is booking 7099101.' },
    { k: 'REHEARSAL TRACKS', v: 'MTI Player, opened with the rehearsal CODE. No login needed. Danielle and Shelby confirmed these working on 7/22 — ask either of them for the code.' },
    { k: 'PERFORMANCE TRACKS', v: 'MTI Player, and the rehearsal code will NOT open them. Performance tracks and the vocal sweeteners both need the organisation login.' },
    { k: 'ORG LOGIN', v: 'Held by Colton, Technical Director (CJ, 7/30). It is not printed here because this page lives in a public repository and our MTI licence does not permit publishing account credentials. Ask Colton, or CJ. If nobody has it, the account admin resets it in two minutes at player.mtishows.com/forgot.' },
    { k: 'PLAYBACK RULES', v: 'MTI is strict on these. Once the show is loaded on a device, do not update the app or iOS until we close. Put the device in airplane mode with WiFi off before every playback — a call, a text or an auto-update will interrupt the track mid-number.' },
    { k: 'SCRIPTS AND SCORES', v: 'ProductionPro, ordered 7/24. There is no shared login and there is no company password — every person is invited individually and signs in as themselves.' },
    { k: 'GETTING INVITED', v: 'Send your email address to CJ or Zoe and you are added to DEAR EVAN HANSEN on ProductionPro. The invite arrives from noreply@production.pro — check spam, that is where most of them land.' },
    { k: 'IF SOMETHING BREAKS', v: 'MTI Player support: (877) 845-4704 or player@mtishows.com. Licensing rep Spicer Carr: spicerc@mtishows.com, (212) 541-4684. Mid-performance emergency hotline: (888) 340-3505 — that one is for a track failing during a show, nothing else.' }
  ];

  function gateWord() { try { return localStorage.getItem(LS_GATE) || ''; } catch (e) { return ''; } }
  function $(id) { return document.getElementById(id); }
  // textContent -> innerHTML escapes &, < and >, but NOT quotes — and nearly
  // every use of this lands inside an attribute. A pasted link is the one
  // string on this page a person controls character by character, so the
  // quotes have to go too or a URL can close the attribute it sits in.
  // Escaping them costs nothing in text: &quot; still renders as ".
  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function clock(ts) {
    var d = new Date(ts), h = d.getHours(), m = d.getMinutes();
    return ((h % 12) || 12) + ':' + (m < 10 ? '0' : '') + m + (h < 12 ? 'am' : 'pm');
  }
  function money(c) {
    if (!c) return '$0';
    return '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
  }
  function shortWhen(iso) {
    if (!iso) return '';
    var t = +new Date(iso);
    if (!isFinite(t)) return '';
    var d = new Date(t), today = new Date();
    var sameDay = d.toDateString() === today.toDateString();
    return sameDay ? clock(t) : (d.getMonth() + 1) + '/' + d.getDate();
  }
  function safeUrl(u) {
    u = String(u || '').trim();
    return /^https?:\/\//i.test(u) ? u : '';   // never render a javascript: href
  }

  // ---------- storage ----------
  function loadLocal() {
    try { done = JSON.parse(localStorage.getItem(LS_DONE) || '{}'); } catch (e) { done = {}; }
    try { item = JSON.parse(localStorage.getItem(LS_ITEM) || '{}'); } catch (e) { item = {}; }
    try { roster = JSON.parse(localStorage.getItem(LS_ROSTER) || '[]'); } catch (e) { roster = []; }
    try { att = JSON.parse(localStorage.getItem(LS_ATT) || '{}'); } catch (e) { att = {}; }
    try { notes = JSON.parse(localStorage.getItem(LS_NOTE) || '[]'); } catch (e) { notes = []; }
    try { reports = JSON.parse(localStorage.getItem(LS_REP) || '{}'); } catch (e) { reports = {}; }
    try { strike = JSON.parse(localStorage.getItem(LS_STRIKE) || '[]'); } catch (e) { strike = []; }
    if (!roster.length) roster = seedRoster();
    if (!strike.length) strike = seedStrike();
  }
  function saveLocal() {
    try {
      localStorage.setItem(LS_DONE, JSON.stringify(done));
      localStorage.setItem(LS_ITEM, JSON.stringify(item));
      localStorage.setItem(LS_ROSTER, JSON.stringify(roster));
      localStorage.setItem(LS_ATT, JSON.stringify(att));
      localStorage.setItem(LS_NOTE, JSON.stringify(notes));
      localStorage.setItem(LS_REP, JSON.stringify(reports));
      localStorage.setItem(LS_STRIKE, JSON.stringify(strike));
    } catch (e) {}
  }

  // Until the cast list lands, attendance still has to work. Seed the creative
  // team plus one row per principal role from the scene breakdown; names get
  // corrected in the dashboard as students are cast.
  // The company, as given by CJ on 8/4. Nineteen students. Roles are left
  // blank because casting has not been published — type them in beside a name
  // and they save like anything else.
  // Bumped whenever a name is added below, so the addition reaches stores that
  // already hold an earlier version — see the seed logic in connect().
  var SEED_VERSION = 2;
  var COMPANY = [
    'Alexis Cottrell', 'Amara Perez', 'Aubrey Stapler', 'Ben Corliss',
    'Claire Sproule', 'Cooper Burns', 'Hailey Manuel', 'Haylee Bierd',
    'Jackson Kanatzar', 'James Grimes', 'Leah Vepraskas', 'Liam VanVeelen',
    'Madelyn Biehl', 'madz Cramer', 'Makenzie Kofchak', 'Regan Stroup',
    'Riddhima Verma', 'Ruth MacDonald', 'Ryan Rodgers', 'Vanessa (Kai) Stuermann'
  ];
  var CREATIVE = [
    { person_id: 'staff-danielle', name: 'Danielle Sirinsky', role: 'Director / Choreographer', kind: 'staff', sort: 1 },
    { person_id: 'staff-shelby', name: 'Shelby Milgram', role: 'Vocal Director', kind: 'staff', sort: 2 },
    { person_id: 'staff-ryyana', name: 'Ryyana Cunningham', role: 'Assistant Director', kind: 'staff', sort: 3 },
    { person_id: 'staff-colton', name: 'Colton Sorensen', role: 'Technical Director', kind: 'staff', sort: 4 },
    { person_id: 'staff-tony', name: 'Tony Cimino-Johnson', role: 'Intimacy / Study track', kind: 'staff', sort: 5 }
  ];
  function castRows() {
    return COMPANY.map(function (n, i) {
      return { person_id: 'cast-' + slug(n), name: n, role: '', kind: 'cast', sort: 10 + i };
    });
  }
  var SEED_KEY = '_seed-version';
  function seedRoster() {
    return CREATIVE.concat(castRows());
  }
  // The version marker lives in the roster table so it needs no new operation.
  // It is not a person and must never reach attendance or the report.
  function people() {
    return roster.filter(function (p) { return (p.kind || 'cast') !== 'meta'; });
  }
  function slug(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  }
  function personName(p) { return p.name || (p.role ? '(' + p.role + ' — unnamed)' : '(unnamed)'); }
  function attOf(iso, pid) { return att[iso + '|' + pid] || { status: 'present', note: '' }; }
  // Every database call goes through /api/deh-db. The browser holds no key:
  // the function on the other side has the service-role key and an allow-list
  // of exactly the operations below, and it checks the company word itself.
  function api(op, args) {
    return fetch('/api/deh-db', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word: gateWord(), op: op, args: args || {} })
    }).then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) throw new Error((j && j.error) || 'failed');
        return j.data;
      });
  }

  function connect() {
    return Promise.all([
      api('progress_list').then(function (rows) {
        remote = true;
        (rows || []).forEach(function (x) {
          if (x.done) done[x.block_id] = { by: x.done_by || '', at: x.done_at ? +new Date(x.done_at) : Date.now() };
          else delete done[x.block_id];
        });
      }).catch(function () {}),
      api('items_list').then(function (rows) {
        (rows || []).forEach(function (x) {
          item[x.item_id] = { st: x.status || 'todo', src: x.vendor || '', link: x.link || '',
                              links: x.links || (x.link ? [x.link] : []),
                              price: x.price_cents || 0, qty: x.qty || 1, by: x.updated_by || '',
                              at: x.updated_at || '',
                              sent: x.sent_at || '', sentBy: x.sent_by || '' };
        });
      }).catch(function () {}),
      api('roster_list').then(function (rows) {
        rows = rows || [];
        // Ask what the SERVER holds, not what this phone happens to have —
        // loadLocal() has already seeded a roster in memory, so checking that
        // would always look full and the company would never get published.
        var serverCast = rows.filter(function (x) { return (x.kind || 'cast') === 'cast'; }).length;
        var marker = rows.filter(function (x) { return x.person_id === SEED_KEY; })[0];
        var seenVersion = marker ? (marker.sort || 0) : 0;

        if (rows.length) {
          roster = rows.map(function (x) {
            return { person_id: x.person_id, name: x.name || '', role: x.role || '',
                     kind: x.kind || 'cast', sort: x.sort == null ? 100 : x.sort };
          });
        }

        // Two cases publish names:
        //   - an empty store, or one with staff but no students
        //   - a store seeded from an older COMPANY list than this build has
        // The version marker is what makes the second safe. Without it a
        // top-up would resurrect anyone the team had deliberately removed;
        // with it, each addition is applied exactly once and a later removal
        // sticks. Nothing here ever deletes.
        if (!serverCast || seenVersion < SEED_VERSION) {
          var have = {};
          roster.forEach(function (p) { have[p.person_id] = true; });
          var added = 0;
          seedRoster().forEach(function (p) {
            if (!have[p.person_id]) { roster.push(p); pushRoster(p); added++; }
          });
          if (!serverCast) roster.forEach(function (p) { pushRoster(p); });
          pushRoster({ person_id: SEED_KEY, name: 'roster version', role: '',
                       kind: 'meta', sort: SEED_VERSION });
          if (added) setSync('Roster updated — ' + added + ' name' + (added === 1 ? '' : 's') + ' added');
        }
      }).catch(function () {}),
      api('reports_list').then(function (rows) {
        (rows || []).forEach(function (x) { reports[x.day] = { at: x.sent_at, by: x.sent_by || '' }; });
      }).catch(function () {}),
      api('strike_list').then(function (rows) {
        rows = rows || [];
        var real = rows.filter(function (x) { return x.task_id !== STRIKE_SEED_KEY; });
        var seeded = rows.filter(function (x) { return x.task_id === STRIKE_SEED_KEY; }).length;
        if (real.length || seeded) {
          strike = real.map(function (x) {
            return { task_id: x.task_id, area: x.area || 'set', body: x.body || '',
                     who: x.who || '', done: !!x.done, done_by: x.done_by || '',
                     sort: x.sort == null ? 0 : x.sort };
          });
          return;
        }
        // Nothing there and never seeded: publish the starter list once, and
        // leave a marker so emptying the list later does not bring it back.
        strike = seedStrike();
        strike.forEach(function (t) { saveStrike(t); });
        api('strike_set', { task_id: STRIKE_SEED_KEY, area: 'meta', body: 'seeded',
                            who: '', done: false, done_by: '', sort: 0 }).catch(function () {});
      }).catch(function () {})
    ]).then(function () { saveLocal(); });
  }

  // Attendance and notes are per-day, so they load when a day is opened rather
  // than all at once. Cached after the first fetch.
  function loadDay(iso, then) {
    if (!remote || loadedDays[iso]) { if (then) then(); return; }
    loadedDays[iso] = true;
    Promise.all([
      api('attendance_list', { day: iso }).then(function (rows) {
        (rows || []).forEach(function (x) {
          att[iso + '|' + x.person_id] = { status: x.status || 'present', note: x.note || '', by: x.updated_by || '' };
        });
      }).catch(function () {}),
      api('notes_list', { day: iso }).then(function (rows) {
        notes = notes.filter(function (n) { return n.day !== iso; })
          .concat((rows || []).map(function (x) {
            return { note_id: x.note_id, day: iso, dept: x.dept || 'general',
                     body: x.body || '', author: x.author || '', created_at: x.created_at };
          }));
      }).catch(function () {})
    ]).then(function () { saveLocal(); if (then) then(); });
  }
  function pushAttendance(iso, pid) {
    if (!remote) return;
    var a = attOf(iso, pid);
    api('attendance_set', { day: iso, person_id: pid, status: a.status,
                            note: a.note || '', by: me || '' })
      .catch(function () { setSync('offline — saved on this phone'); });
  }
  function pushNote(n) {
    if (!remote) return;
    api('note_add', { note_id: n.note_id, day: n.day, dept: n.dept,
                      body: n.body, author: n.author || '' })
      .catch(function () { setSync('offline — saved on this phone'); });
  }
  function pushRoster(p) {
    if (!remote) return;
    api('roster_set', { person_id: p.person_id, name: p.name || '', role: p.role || '',
                        kind: p.kind || 'cast', sort: p.sort || 100, active: true })
      .catch(function () {});
  }
  function pushBlock(id, isDone, by) {
    if (!remote) return;
    api('progress_set', { block_id: id, done: isDone, by: by || '' })
      .catch(function () { setSync('offline — saved on this phone'); });
  }
  function pushItem(id) {
    if (!remote) return;
    var s = item[id] || {};
    api('item_set', { item_id: id, status: s.st || 'todo', vendor: s.src || '',
                      link: s.link || '', links: linksOf(s),
                      price_cents: s.price || 0, qty: s.qty || 1,
                      sent_at: s.sent || '', sent_by: s.sentBy || '',
                      by: s.by || me || '' })
      .catch(function () { setSync('offline — saved on this phone'); });
  }
  function setSync(msg) { $('syncNote').textContent = msg; }

  // The header is sticky and its height is not fixed — it changes with the
  // width, with the day label, and with whichever sync line is showing. The
  // scene stepper sticks directly beneath it, so it has to be told where that
  // is rather than guessing.
  function measureTopbar() {
    var tb = document.querySelector('.topbar');
    if (!tb) return;
    var h = Math.round(tb.getBoundingClientRect().height);
    if (h) document.documentElement.style.setProperty('--topbar-h', h + 'px');
  }
  function watchTopbar() {
    measureTopbar();
    window.addEventListener('resize', measureTopbar);
    window.addEventListener('orientationchange', measureTopbar);
    if (window.ResizeObserver) {
      var tb = document.querySelector('.topbar');
      if (tb) new ResizeObserver(measureTopbar).observe(tb);
    }
  }

  // ---------- live sync ----------
  // connect() only ran at boot, so a phone showed whatever was true when it
  // was opened. During a rehearsal that is useless: Danielle ticks a block and
  // Colton's phone still shows it open an hour later. Poll while the page is
  // visible, and refresh the moment someone returns to the app.
  var POLL_MS = 25000;
  var lastSync = 0, polling = null, refreshing = false;

  function editing() {
    var a = document.activeElement;
    var t = a && (a.tagName || '').toLowerCase();
    if (t === 'input' || t === 'select' || t === 'textarea') return true;
    // A department box can be holding a typed-but-not-yet-added note while the
    // stage manager is looking at a different one. Focus has moved on; the
    // words have not. A repaint here would throw them away.
    return !!pendingNotes().length;
  }
  function pendingNotes() {
    return Array.prototype.filter.call(
      document.querySelectorAll('[data-ntbody]'),
      function (x) { return (x.value || '').trim(); }
    );
  }
  function sinceLabel(ts) {
    if (!ts) return '';
    var secs = Math.round((Date.now() - ts) / 1000);
    if (secs < 45) return 'just now';
    if (secs < 90) return 'a minute ago';
    if (secs < 3600) return Math.round(secs / 60) + ' min ago';
    return clock(ts);
  }
  function syncLine() {
    if (!remote) { setSync('Not syncing — saved on this phone'); return; }
    setSync('Shared with the whole team · updated ' + sinceLabel(lastSync));
  }

  // Pull everything again and repaint. Never repaints over a field someone is
  // typing in — the data still lands, the screen just waits its turn.
  function refresh(force) {
    if (refreshing) return Promise.resolve();
    if (!force && editing()) return Promise.resolve();
    refreshing = true;
    var iso = D.days[cur].iso;
    loadedDays[iso] = false;
    return connect()
      .then(function () { return loadDayNow(iso); })
      .then(function () {
        lastSync = Date.now();
        if (!editing()) { renderAll(); renderDay(); }
        syncLine();
      })
      .catch(function () {})
      .then(function () { refreshing = false; });
  }
  function loadDayNow(iso) {
    if (!remote) return Promise.resolve();
    return Promise.all([
      api('attendance_list', { day: iso }).then(function (rows) {
        Object.keys(att).forEach(function (k) { if (k.indexOf(iso + '|') === 0) delete att[k]; });
        (rows || []).forEach(function (x) {
          att[iso + '|' + x.person_id] = { status: x.status || 'present', note: x.note || '', by: x.updated_by || '' };
        });
      }).catch(function () {}),
      api('notes_list', { day: iso }).then(function (rows) {
        notes = notes.filter(function (n) { return n.day !== iso; })
          .concat((rows || []).map(function (x) {
            return { note_id: x.note_id, day: iso, dept: x.dept || 'general',
                     body: x.body || '', author: x.author || '', created_at: x.created_at };
          }));
      }).catch(function () {})
    ]).then(function () { loadedDays[iso] = true; saveLocal(); });
  }
  function startPolling() {
    if (polling) clearInterval(polling);
    polling = setInterval(function () {
      if (document.visibilityState === 'visible') refresh();
      else syncLine();
    }, POLL_MS);
  }

  // ---------- schedule progress ----------
  function tasksOf(day) { return day.blocks.filter(isTask); }
  function doneCount(day) { return tasksOf(day).filter(function (b) { return done[b.id]; }).length; }
  function allTasks() { return D.days.reduce(function (a, d) { return a.concat(tasksOf(d)); }, []); }

  function renderTopProgress() {
    var all = allTasks(), n = all.filter(function (b) { return done[b.id]; }).length;
    var pct = all.length ? Math.round(n / all.length * 100) : 0;
    $('showFill').style.width = pct + '%';
    $('showPct').textContent = pct + '%';
    $('showCount').textContent = n + ' of ' + all.length + ' blocks complete';
    var fin = D.days.filter(function (d) { return tasksOf(d).length && doneCount(d) === tasksOf(d).length; }).length;
    $('showDays').textContent = fin + ' of ' + D.days.length + ' days finished';
  }

  var cur = 0;
  function renderChips() {
    $('dayChips').innerHTML = D.days.map(function (d, i) {
      var t = tasksOf(d).length, n = doneCount(d);
      var pct = t ? Math.round(n / t * 100) : 0;
      return '<button class="chip' + (i === cur ? ' sel' : '') + (pct === 100 ? ' full' : '') + '" data-i="' + i + '">' +
        '<span class="chip-d">' + esc(d.date) + '</span><span class="chip-p">' + pct + '%</span></button>';
    }).join('');
    var sel = $('dayChips').querySelector('.chip.sel');
    if (sel) sel.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  function renderDay() {
    var d = D.days[cur], t = tasksOf(d).length, n = doneCount(d);
    var pct = t ? Math.round(n / t * 100) : 0;
    var cov = D.coverage[d.date] || {};

    var head = '<div class="dayhead"><div class="dayhead-top">' +
      '<h2>' + esc(d.date) + '<span class="daycode">' + esc(d.code) + '</span></h2>' +
      '<span class="daypct">' + n + '/' + t + '</span></div>' +
      '<div class="bar"><i style="width:' + pct + '%"></i></div></div>';

    var staff = [['Danielle', cov.danielle], ['Shelby', cov.shelby], ['Ryyana', cov.ryyana],
                 ['Colton', cov.colton], ['Tony', cov.tony]]
      .filter(function (p) { return p[1]; })
      .map(function (p) {
        var out = /out of town|^out /i.test(p[1]);
        return '<span class="who' + (out ? ' out' : '') + '"><b>' + esc(p[0]) + '</b> ' + esc(p[1]) + '</span>';
      }).join('');
    var coverage = '<details class="cov"><summary>Who is in today</summary><div class="whos">' + staff + '</div>' +
      (cov.gap ? '<div class="gap"><b>Watch today</b>' + esc(cov.gap) + '</div>' : '') + '</details>';

    var blocks = d.blocks.map(function (b) {
      if (!isTask(b)) return '<div class="rest"><span>' + esc(b.t) + '</span><span>' + esc(b.a) + '</span></div>';
      var st = done[b.id];
      var meta = [
        b.s ? ['Lead', b.s] : null,
        b.w ? ['In this track', b.w + (b.n ? ' (' + b.n + ')' : '')] : null,
        b.l ? ['Where', b.l] : null,
        b.r ? ['Script', b.r] : null
      ].filter(Boolean).map(function (p) {
        return '<div class="m"><span class="mk">' + esc(p[0]) + '</span><span class="mv">' + esc(p[1]) + '</span></div>';
      }).join('');
      return '<div class="blk ' + trackClass(b.k) + (st ? ' done' : '') + '" data-id="' + esc(b.id) + '">' +
        '<button class="tick" data-tick="' + esc(b.id) + '" aria-pressed="' + (st ? 'true' : 'false') +
          '" aria-label="' + (st ? 'Mark not done' : 'Mark done and choose who') + '">' + (st ? '&#10003;' : '') + '</button>' +
        '<div class="blk-bd">' +
          '<div class="blk-top"><span class="time">' + esc(b.t) + '</span><span class="tag">' + esc(b.k) + '</span></div>' +
          '<div class="act">' + esc(b.a) + '</div>' +
          '<div class="meta">' + meta + '</div>' +
          (st ? '<div class="stamp">Done by <b>' + esc(st.by || 'staff') + '</b>' +
                (st.at ? ' &middot; ' + esc(clock(st.at)) : '') + '</div>' : '') +
        '</div></div>';
    }).join('');

    $('day').innerHTML = head + coverage + attendancePanel(d) + blocks + notesPanel(d) + reportBar(d);
  }

  // ---------- attendance ----------
  function attCounts(iso) {
    var c = { present: 0, late: 0, absent: 0, excused: 0, taken: 0 };
    people().forEach(function (p) {
      var k = iso + '|' + p.person_id;
      if (att[k]) { c.taken++; c[att[k].status] = (c[att[k].status] || 0) + 1; }
      else c.present++;
    });
    return c;
  }
  function attendancePanel(d) {
    var iso = d.iso, c = attCounts(iso);
    var inRoom = people().length - c.absent - c.excused;
    var groups = [['cast', 'Company'], ['crew', 'Crew'], ['staff', 'Creative team']];
    var body = groups.map(function (g) {
      var group = people().filter(function (p) { return (p.kind || 'cast') === g[0]; })
        .sort(function (x, y) { return (x.sort || 100) - (y.sort || 100); });
      if (!group.length) return '';
      return '<div class="at-grp">' + esc(g[1]) + '</div>' + group.map(function (p) {
        var a = attOf(iso, p.person_id), L = attLabel(a.status);
        return '<div class="at-row' + (a.status !== 'present' ? ' flag' : '') + '">' +
          '<button class="at-st s-' + a.status + '" data-att="' + esc(p.person_id) + '" ' +
            'aria-label="' + esc(personName(p)) + ': ' + esc(L.l) + '. Tap to change.">' + esc(L.s) + '</button>' +
          '<input class="at-name" data-pname="' + esc(p.person_id) + '" value="' + esc(p.name) + '" ' +
            'placeholder="' + esc(p.role || 'name') + '" autocomplete="off">' +
          // Unnamed cast already carry the role as the input placeholder —
          // printing it twice just makes the list harder to scan.
          (p.role && p.name ? '<span class="at-role">' + esc(p.role) + '</span>' : '') +
          (a.status !== 'present'
            ? '<input class="at-note" data-anote="' + esc(p.person_id) + '" value="' + esc(a.note || '') +
              '" placeholder="why / when" autocomplete="off">' : '') +
          '</div>';
      }).join('') + '</div>';
    }).join('');
    return '<details class="at"' + (c.absent || c.late ? ' open' : '') + '>' +
      '<summary>Attendance <b>' + inRoom + '/' + people().length + ' in</b>' +
      (c.absent ? '<span class="at-pill out">' + c.absent + ' out</span>' : '') +
      (c.late ? '<span class="at-pill late">' + c.late + ' late</span>' : '') +
      (!c.taken ? '<span class="at-pill todo">not taken</span>' : '') + '</summary>' +
      '<div class="at-bd">' + body +
      '<div class="at-add"><input id="atNew" placeholder="Add a person" autocomplete="off">' +
      '<select id="atKind"><option value="cast">Company</option><option value="crew">Crew</option>' +
      '<option value="staff">Creative team</option></select>' +
      '<button class="btn" id="atAdd" type="button">Add</button></div>' +
      '<p class="at-hint">Tap the box beside a name to cycle In &rarr; Late &rarr; Out &rarr; Excused. ' +
      'Names save as you type.</p></div></details>';
  }

  // ---------- rehearsal notes ----------
  // One box per department, the way a paper rehearsal report is laid out, so
  // the stage manager can work down it live while the director is still
  // working rather than stopping to choose a category from a dropdown.
  function notesOf(iso) { return notes.filter(function (n) { return n.day === iso; }); }
  function notesFor(iso, k) {
    return notes.filter(function (n) { return n.day === iso && n.dept === k; });
  }

  // Every department gets a box; any retired one still carrying a note today
  // gets one too, so an old note is never stranded somewhere nobody looks.
  function deptKeys(iso) {
    var keys = DEPTS.map(function (x) { return x.k; });
    notesOf(iso).forEach(function (n) { if (keys.indexOf(n.dept) < 0) keys.push(n.dept); });
    return keys;
  }

  function noteRow(n) {
    return '<div class="nt">' +
      '<div class="nt-h">' + (n.author ? '<span class="nt-a">' + esc(n.author) + '</span>' : '') +
        '<button class="nt-x" data-delnote="' + esc(n.note_id) + '" aria-label="Delete note">&times;</button></div>' +
      '<div class="nt-b">' + esc(n.body) + '</div></div>';
  }

  // Rendered on its own so adding or deleting a note repaints one department
  // instead of the whole day — a full re-render would close every other box
  // and throw away anything half-typed in them.
  function deptBox(iso, k) {
    var list = notesFor(iso, k);
    return '<details class="dn' + (list.length ? ' has' : '') + '"' + (list.length ? ' open' : '') +
        ' data-deptbox="' + esc(k) + '">' +
      '<summary><span class="dn-n">' + esc(deptLabel(k)) + '</span>' +
        (list.length ? '<span class="dn-c">' + list.length + '</span>'
                     : '<span class="dn-c none">&ndash;</span>') + '</summary>' +
      '<div class="dn-bd">' +
        list.map(noteRow).join('') +
        '<textarea data-ntbody="' + esc(k) + '" rows="2" placeholder="' + esc(deptPrompt(k)) + '"></textarea>' +
        '<button class="btn dn-add" data-ntadd="' + esc(k) + '" type="button">Add to ' +
          esc(deptLabel(k)) + '</button>' +
      '</div></details>';
  }

  function notesPanel(d) {
    var n = notesOf(d.iso).length;
    return '<div class="notes"><h3>Rehearsal report notes</h3>' +
      '<p class="nt-lead">' + (n
        ? n + ' note' + (n === 1 ? '' : 's') + ' filed for ' + esc(d.date) +
          '. They go out grouped by department when the report is sent.'
        : 'Nothing filed for ' + esc(d.date) + ' yet. Open a department and type — ' +
          'each one goes to its own head in the report.') + '</p>' +
      '<div class="dnlist">' + deptKeys(d.iso).map(function (k) {
        return deptBox(d.iso, k);
      }).join('') + '</div></div>';
  }

  // File a note without going through the click handler. Used by the Add
  // button and by the sweep below.
  function addNote(iso, dept, body) {
    var n = { note_id: iso + '|' + Date.now() + '|' + Math.floor(Math.random() * 1e4),
              day: iso, dept: dept, body: body,
              author: me || '', created_at: new Date().toISOString() };
    notes.push(n); pushNote(n);
    return n;
  }

  // Anything typed into a department box but never Added is still a note the
  // stage manager wrote on the rehearsal report. Sending the report with it
  // sitting on screen, unsent, is the one way this form could lose work — so
  // sending files it first, and says how many it took.
  function sweepPendingNotes(iso) {
    var pending = pendingNotes(), depts = [];
    pending.forEach(function (ta) {
      var k = ta.dataset.ntbody;
      addNote(iso, k, ta.value.trim());
      ta.value = '';
      if (depts.indexOf(k) < 0) depts.push(k);
    });
    if (pending.length) {
      saveLocal();
      depts.forEach(function (k) { refreshDeptBox(iso, k); });
    }
    return pending.length;
  }

  // Swap one department's box for a freshly rendered one, keeping it open.
  function refreshDeptBox(iso, k) {
    var el = document.querySelector('[data-deptbox="' + k.replace(/"/g, '') + '"]');
    if (!el) { renderDay(); return; }
    var open = el.open;
    el.outerHTML = deptBox(iso, k);
    var now = document.querySelector('[data-deptbox="' + k.replace(/"/g, '') + '"]');
    if (now) now.open = open || !!notesFor(iso, k).length;
    var lead = document.querySelector('.nt-lead');
    if (lead) {
      var n = notesOf(iso).length;
      lead.textContent = n
        ? n + ' note' + (n === 1 ? '' : 's') + ' filed. They go out grouped by department when the report is sent.'
        : 'Nothing filed yet. Open a department and type — each one goes to its own head in the report.';
    }
  }

  // ---------- end-of-day report ----------
  function reportBar(d) {
    var r = reports[d.iso];
    return '<div class="rep">' +
      (r ? '<div class="rep-sent">Sent to ' + esc(REPORT_WHO) +
            (r.by ? ' by <b>' + esc(r.by) + '</b>' : '') +
            (r.at ? ' &middot; ' + esc(clock(+new Date(r.at))) : '') + '</div>' : '') +
      '<button class="rep-go" id="repSend" type="button">' +
        (r ? 'Send again' : 'Send rehearsal report') + '</button>' +
      '<button class="rep-pv" id="repView" type="button">Preview</button>' +
      '<div class="rep-note" id="repNote"></div></div>';
  }

  // Anything with a buy link that was touched on this date. CJ wants the links
  // themselves in the end-of-day email so purchasing can happen off the report
  // rather than by going back into the dashboard.
  function sourcedOn(iso) {
    return S.allItems.filter(function (it) {
      var s = st(it.id);
      return linksOf(s).length && String(s.at || '').slice(0, 10) === iso;
    }).map(function (it) {
      var s = st(it.id), q = qtyOf(it), ls = linksOf(s);
      return { name: it.name, scene: it.scene, cat: CATS[it.cat] || it.cat, who: it.who || '',
               vendor: s.src || '', link: ls[0], links: ls, status: s.st || 'todo',
               qty: q, price_cents: s.price || 0, line_cents: s.price * q, by: s.by || '' };
    });
  }

  function buildReport(d) {
    var t = tasksOf(d), n = doneCount(d);
    var completed = t.filter(function (b) { return done[b.id]; })
      .map(function (b) { return { t: b.t, a: b.a, by: (done[b.id] || {}).by || '' }; });
    var attendance = people().map(function (p) {
      var a = attOf(d.iso, p.person_id);
      return { name: personName(p), role: p.role || '', status: a.status, note: a.note || '' };
    });
    var all = allTasks();
    return {
      day: d.iso, dayLabel: d.date, code: d.code,
      by: me || 'staff', at: clock(Date.now()),
      blocksDone: n, blocksTotal: t.length,
      showDone: all.filter(function (b) { return done[b.id]; }).length, showTotal: all.length,
      spentCents: spentTotal(), budgetCents: BUDGET_TOTAL, outstandingCents: outstandingTotal(),
      attendance: attendance,
      // Sorted the way the departments are listed, so the report reads down
      // the design table rather than in the order notes happened to be typed.
      notes: notesOf(d.iso).slice()
        .sort(function (a, b) { return deptRank(a.dept) - deptRank(b.dept); })
        .map(function (x) { return { dept: x.dept, body: x.body, author: x.author || '' }; }),
      completed: completed,
      sourcing: sourcedOn(d.iso)
    };
  }
  function reportPlainText(r) {
    var L = ['REHEARSAL REPORT — Dear Evan Hansen', r.dayLabel + (r.code ? ' (' + r.code + ')' : ''),
             'Filed by ' + r.by + ' at ' + r.at, '',
             'Today: ' + r.blocksDone + '/' + r.blocksTotal + ' blocks complete',
             'Whole show: ' + r.showDone + '/' + r.showTotal, 'Spent: ' + money(r.spentCents) +
             ' of ' + money(r.budgetCents), '', 'ATTENDANCE'];
    var out = r.attendance.filter(function (a) { return a.status !== 'present'; });
    L.push('  ' + (r.attendance.length - out.length) + ' of ' + r.attendance.length + ' present.');
    out.forEach(function (a) {
      L.push('  ' + a.name + ' — ' + attLabel(a.status).l + (a.note ? ' (' + a.note + ')' : ''));
    });
    L.push('', 'NOTES');
    if (!r.notes.length) L.push('  None filed.');
    r.notes.forEach(function (n) {
      L.push('  [' + deptLabel(n.dept) + '] ' + n.body + (n.author ? ' — ' + n.author : ''));
    });
    L.push('', 'SOURCED TODAY');
    if (!r.sourcing.length) L.push('  Nothing new sourced.');
    r.sourcing.forEach(function (x) {
      L.push('  ' + x.name + (x.qty > 1 ? ' x' + x.qty : '') +
             (x.vendor ? '  [' + x.vendor + ']' : '') +
             (x.price_cents ? '  ' + money(x.line_cents) : '') +
             (x.by ? '  - ' + x.by : ''));
      L.push('      ' + x.link);
    });
    L.push('', 'COMPLETED TODAY');
    if (!r.completed.length) L.push('  Nothing checked off.');
    r.completed.forEach(function (b) { L.push('  ' + b.t + '  ' + b.a + (b.by ? ' — ' + b.by : '')); });
    return L.join('\n');
  }
  function sendReport(d) {
    var note = $('repNote'), btn = $('repSend');
    if (!me) { note.textContent = 'Pick your name on any block first, so the report says who filed it.'; return; }
    var swept = sweepPendingNotes(d.iso);
    var r = buildReport(d);
    btn.disabled = true;
    note.textContent = swept
      ? 'Filed ' + swept + ' note' + (swept === 1 ? '' : 's') + ' still in the boxes. Sending…'
      : 'Sending…';
    fetch('/api/deh-report', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(r)
    }).then(function (res) { return res.json().catch(function () { return { ok: res.ok }; }); })
      .then(function (j) {
        btn.disabled = false;
        if (!j || !j.ok) throw new Error((j && j.error) || 'send failed');
        reports[d.iso] = { at: new Date().toISOString(), by: me };
        saveLocal();
        if (remote) {
          api('report_log', { day: d.iso, by: me, to: REPORT_TO.join(', '),
                              summary: { done: r.blocksDone, of: r.blocksTotal } })
            .catch(function () {});
        }
        renderDay();
      })
      .catch(function (e) {
        btn.disabled = false;
        note.innerHTML = 'Could not send &mdash; ' + esc(String(e.message || e)) +
          '. <a href="#" id="repCopy">Copy the report</a> and email it to ' + esc(REPORT_WHO) + '.';
        var c = $('repCopy');
        if (c) c.addEventListener('click', function (ev) {
          ev.preventDefault();
          copyText(reportPlainText(buildReport(d)), note);
        });
      });
  }
  function copyText(txt, noteEl, where) {
    function done() {
      if (noteEl) noteEl.textContent = 'Copied. Paste it into an email to ' + (where || REPORT_WHO) + '.';
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done, function () { fallback(); });
    } else fallback();
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) {}
      document.body.removeChild(ta);
    }
  }

  function renderSchedule() { renderTopProgress(); renderChips(); renderDay(); }

  // ---------- who-did-it menu ----------
  // Tapping an unchecked block asks who finished it rather than assuming the
  // phone's owner did — one person often ticks off a track someone else ran.
  var menuFor = null;
  function openWho(id, anchor) {
    closeWho();
    menuFor = id;
    var m = document.createElement('div');
    m.className = 'whomenu';
    m.innerHTML = '<div class="wm-h">Who completed this?</div>' +
      STAFF.map(function (n) { return '<button class="wm-b" data-name="' + esc(n) + '">' + esc(n) + '</button>'; }).join('') +
      '<button class="wm-b wm-other" data-name="">Someone else&hellip;</button>';
    document.body.appendChild(m);
    var r = anchor.getBoundingClientRect();
    var top = r.bottom + window.scrollY + 6;
    m.style.top = top + 'px';
    m.style.left = Math.max(8, Math.min(r.left, window.innerWidth - m.offsetWidth - 8)) + 'px';
    if (top + m.offsetHeight > window.scrollY + window.innerHeight) {
      m.style.top = Math.max(window.scrollY + 8, r.top + window.scrollY - m.offsetHeight - 6) + 'px';
    }
  }
  function closeWho() {
    var m = document.querySelector('.whomenu');
    if (m) m.remove();
    menuFor = null;
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.wm-b');
    if (b) {
      var name = b.dataset.name;
      if (!name) {
        name = (prompt('Who completed this?') || '').trim();
        if (!name) { closeWho(); return; }
      }
      markDone(menuFor, name);
      closeWho();
      return;
    }
    if (!e.target.closest || !e.target.closest('.whomenu')) closeWho();
  }, true);

  function markDone(id, name) {
    if (!id) return;
    done[id] = { by: name, at: Date.now() };
    me = name; localStorage.setItem(LS_ME, me);
    pushBlock(id, true, name);
    saveLocal(); renderSchedule();
  }
  function clearDone(id) {
    delete done[id];
    pushBlock(id, false, me);
    saveLocal(); renderSchedule();
  }

  // ---------- scene breakdown + sourcing ----------
  function st(id) {
    return item[id] || { st: 'todo', src: '', link: '', links: [], price: 0, qty: 0, by: '', at: '' };
  }

  // Once an item has gone to Todd it is frozen: it drops off the next buy
  // email, and its fields stop taking edits. Two people cannot both be
  // changing the price of something already sitting in someone's basket.
  // `sent` is the timestamp of the email that carried it.
  function isSent(id) { return !!st(id).sent; }
  function sentLabel(s) {
    var d = s.sent ? new Date(s.sent) : null;
    if (!d || !isFinite(+d)) return 'Sent to Todd';
    return 'Sent to Todd ' + (d.getMonth() + 1) + '/' + d.getDate() +
           (s.sentBy ? ' by ' + s.sentBy : '');
  }

  // One costume rarely comes from one page: a look is a top from one shop, a
  // pair of shoes from another and a jacket off Marketplace. Everything below
  // reads links through here, so an item saved back when there was a single
  // `link` field keeps working with no migration.
  var MAX_LINKS = 12;
  function linksOf(s) {
    var raw = (s && s.links && s.links.length) ? s.links : (s && s.link ? [s.link] : []);
    var out = [];
    for (var i = 0; i < raw.length && out.length < MAX_LINKS; i++) {
      var u = safeUrl(raw[i]);
      if (u && out.indexOf(u) < 0) out.push(u);
    }
    return out;
  }
  function itemLinks(id) { return linksOf(st(id)); }
  // `link` stays in step with the head of the list so anything still reading
  // the old single field — the store, the SQL column — sees the primary one.
  function setLinks(s, arr) {
    s.links = arr.slice(0, MAX_LINKS);
    s.link = s.links[0] || '';
    return s;
  }
  function shortLink(u) {
    var s = String(u).replace(/^https?:\/\//i, '').replace(/^www\./i, '');
    return s.length > 46 ? s.slice(0, 44) + '…' : s;
  }

  function qtyOf(it) { var s = st(it.id); return s.qty || it.qty || 1; }
  function lineCost(it) { return st(it.id).price * qtyOf(it); }
  function sceneItems(sc) { return sc.items; }
  function sceneCost(sc) { return sceneItems(sc).reduce(function (a, it) { return a + lineCost(it); }, 0); }
  function sceneDone(sc) {
    var xs = sceneItems(sc);
    return xs.filter(function (it) { return st(it.id).st === 'done'; }).length;
  }
  function grandTotal() { return S.allItems.reduce(function (a, it) { return a + lineCost(it); }, 0); }

  var openScene = null;
  function renderScenes() {
    var gt = grandTotal();
    var settled = S.allItems.filter(function (it) { return st(it.id).st === 'done'; }).length;
    var pct = S.allItems.length ? Math.round(settled / S.allItems.length * 100) : 0;

    var head = '<div class="sc-summary">' +
      '<div class="ss-row"><span>Everything sourced</span><b>' + settled + ' of ' + S.allItems.length + '</b></div>' +
      '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="ss-row big"><span>Running total</span><b>' + money(gt) + '</b></div>' +
      '<p class="ss-note">Items marked <span class="pv pv-proposed">proposed</span> were not taken from the script. ' +
      'Confirm them against it before spending. <span class="pv pv-script">script</span> items came from the ' +
      'scene breakdown built off the libretto.</p></div>';

    var standing = '<div class="scenecard" data-scene="ALL">' +
      '<div class="sch"><div><b>Whole show</b><span class="scsub">Looks and units that live across every scene</span></div>' +
      '<span class="sccost">' + money(S.standing.reduce(function (a, it) { return a + lineCost(it); }, 0)) + '</span></div></div>';

    var list = S.scenes.map(function (s) {
      var n = sceneDone(s), t = sceneItems(s).length;
      return '<div class="scenecard' + (n === t && t ? ' full' : '') + '" data-scene="' + esc(s.id) + '">' +
        '<div class="sch"><div><b>Act ' + esc(s.act) + ' Sc ' + esc(s.sc) + '</b>' +
        '<span class="scsub">' + esc(s.loc) + '</span></div>' +
        '<span class="sccost">' + money(sceneCost(s)) + '</span></div>' +
        '<div class="scmeta"><span>' + n + '/' + t + ' sourced</span><span>' + esc(s.when) + '</span></div></div>';
    }).join('');

    $('scenes').innerHTML = head + standing + list;
  }

  // Saved links, then one empty field to add another. Deleting is keyed on the
  // URL rather than its position: two people sourcing the same look at once
  // would otherwise delete each other's row by index.
  function linkBox(id, links) {
    var locked = isSent(id);
    var rows = links.map(function (u) {
      return '<li class="lkx">' +
        '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(shortLink(u)) + '</a>' +
        (locked ? '' :
          '<button class="lkx-x" type="button" data-dellink="' + esc(u) + '" data-lkitem="' + esc(id) + '" ' +
            'aria-label="Remove this link">&times;</button>') + '</li>';
    }).join('');
    var full = links.length >= MAX_LINKS;
    return '<div class="lks' + (links.length ? ' has' : '') + '">' +
      // With nothing saved yet, "Links" above "Add a link" is two headings
      // saying the same thing. The count is the only reason to print it.
      (links.length ? '<div class="lks-h">Links <b>' + links.length + '</b></div>' : '') +
      (rows ? '<ul class="lks-l">' + rows + '</ul>' : '') +
      (locked
        ? (links.length ? '' : '<p class="lks-none">No links were on this when it went out.</p>')
        : full
        ? '<p class="lks-none">That is ' + MAX_LINKS + ' links — remove one before adding another.</p>'
        : '<label class="lk"><span class="lk-lab">' +
            (links.length ? 'Add another' : 'Add a link') + '</span>' +
            '<span class="lk-row">' +
              '<input data-nl type="url" inputmode="url" placeholder="https://&hellip;">' +
              '<button class="lk-go" data-addlink type="button" aria-label="Add this link">Add</button>' +
            '</span></label>') +
      '</div>';
  }

  function itemRow(it) {
    var s = st(it.id);
    var q = qtyOf(it);
    var links = linksOf(s);
    var locked = !!s.sent;
    var off = locked ? ' disabled' : '';
    return '<div class="it it-' + esc(s.st) + (locked ? ' sent' : '') + '" data-item="' + esc(it.id) + '">' +
      '<div class="it-h">' +
        '<span class="it-cat it-' + esc(it.cat) + '">' + esc(CATS[it.cat] || it.cat) + '</span>' +
        (it.who ? '<span class="it-who">' + esc(it.who) + '</span>' : '') +
        '<span class="pv pv-' + esc(it.src) + '">' + esc(it.src) + '</span>' +
        '<span class="it-cost">' + money(lineCost(it)) + '</span>' +
      '</div>' +
      '<div class="it-n">' + esc(it.name) + '</div>' +
      (it.note ? '<div class="it-note">' + esc(it.note) + '</div>' : '') +
      (locked ? '<div class="it-lock">' + esc(sentLabel(s)) +
                ' &middot; locked so it cannot be bought twice</div>' : '') +
      '<div class="it-ctl">' +
        '<label>Status<select data-f="st"' + off + '>' + STATES.map(function (x) {
          return '<option value="' + x.k + '"' + (s.st === x.k ? ' selected' : '') + '>' + x.l + '</option>';
        }).join('') + '</select></label>' +
        '<label>Where from<input list="vendorList" data-f="src" value="' + esc(s.src) + '" placeholder="Amazon, in stock, build&hellip;"' + off + '></label>' +
        '<label>Unit price<input data-f="price" type="number" inputmode="decimal" min="0" step="0.01" value="' +
          (s.price ? (s.price / 100).toFixed(2) : '') + '" placeholder="0.00"' + off + '></label>' +
        '<label>Qty<input data-f="qty" type="number" inputmode="numeric" min="1" step="1" value="' + q + '"' + off + '></label>' +
      '</div>' +
      linkBox(it.id, links) +
      '<div class="it-foot">' +
        (locked
          // Not a way round the lock — a way to correct a mistake. Sending the
          // wrong price would otherwise freeze it into the record for good.
          ? '<button class="it-unlock" data-unlock="' + esc(it.id) + '" type="button">Unlock to edit</button>'
          : '<button class="it-save" data-saveitem type="button">Save this item</button>') +
        (s.by ? '<span class="it-by">Last touched by <b>' + esc(s.by) + '</b>' +
                (s.at ? ' &middot; ' + esc(shortWhen(s.at)) : '') + '</span>' : '') +
      '</div>' +
    '</div>';
  }

  // The show in order: the standing "whole show" list first, then every scene
  // as it plays. This is the spine for the prev/next arrows on an open scene.
  function sceneOrder() {
    return ['ALL'].concat(S.scenes.map(function (x) { return x.id; }));
  }
  function sceneLabel(id) {
    if (id === 'ALL') return 'Whole show';
    var s = S.scenes.filter(function (x) { return x.id === id; })[0];
    return s ? 'Act ' + s.act + ' Sc ' + s.sc : '';
  }
  function stepScene(dir) {
    if (!openScene) return;
    var order = sceneOrder();
    var i = order.indexOf(openScene) + dir;
    if (i < 0 || i >= order.length) return;
    renderSceneDetail(order[i]);
  }

  function renderSceneDetail(id) {
    var s = id === 'ALL'
      ? { id: 'ALL', act: '', sc: '', loc: 'Looks and units used across the whole show',
          songs: '', tech: '', cast: [], when: 'Sourced once, used everywhere', items: S.standing }
      : S.scenes.filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    var title = id === 'ALL' ? 'Whole show' : 'Act ' + s.act + ', Scene ' + s.sc;
    var cost = s.items.reduce(function (a, it) { return a + lineCost(it); }, 0);

    var groups = ['set', 'prop', 'costume'].map(function (cat) {
      var xs = s.items.filter(function (it) { return it.cat === cat; });
      if (!xs.length) return '';
      var sub = xs.reduce(function (a, it) { return a + lineCost(it); }, 0);
      return '<div class="itgrp"><h4>' + esc(CATS[cat]) + '<span>' + money(sub) + '</span></h4>' +
        xs.map(itemRow).join('') + '</div>';
    }).join('');

    // Walk the show without going back to the list every time.
    var order = sceneOrder();
    var pos = order.indexOf(id);
    var prevId = pos > 0 ? order[pos - 1] : null;
    var nextId = pos > -1 && pos < order.length - 1 ? order[pos + 1] : null;
    function arrow(target, dir) {
      if (!target) return '<span class="scstep empty" aria-hidden="true"></span>';
      var lab = esc(sceneLabel(target));
      return '<button class="scstep ' + (dir < 0 ? 'prev' : 'next') + '" type="button" ' +
        'data-goscene="' + esc(target) + '" aria-label="Go to ' + lab + '">' +
        (dir < 0 ? '<span class="scstep-ar">&larr;</span>' : '') +
        '<span class="scstep-l">' + lab + '</span>' +
        (dir > 0 ? '<span class="scstep-ar">&rarr;</span>' : '') +
        '</button>';
    }

    $('sceneDetail').innerHTML =
      '<div class="scnav">' +
        arrow(prevId, -1) +
        '<button class="back" id="scBack" type="button">All scenes</button>' +
        arrow(nextId, 1) +
      '</div>' +
      '<div class="scpos">' + (pos + 1) + ' of ' + order.length + '</div>' +
      '<div class="eyebrow">' + esc(s.when) + '</div>' +
      '<h1>' + esc(title) + '</h1>' +
      '<p class="sub">' + esc(s.loc) + '</p>' +
      (s.songs && s.songs !== '(none)' ? '<div class="sc-song">' + esc(s.songs) + '</div>' : '') +
      (s.cast && s.cast.length ? '<div class="sc-cast"><span class="mk">Who is in it</span><div>' +
        s.cast.map(function (c) { return '<span class="castpill">' + esc(c) + '</span>'; }).join('') + '</div></div>' : '') +
      (s.tech ? '<div class="gap"><b>Watch</b>' + esc(s.tech) + '</div>' : '') +
      '<div class="sc-total"><span>Scene total</span><b>' + money(cost) + '</b></div>' +
      groups +
      // finish a scene, carry straight on to the next one
      (nextId ? '<div class="scnav foot">' +
        '<button class="scstep next wide" type="button" data-goscene="' + esc(nextId) + '">' +
        '<span class="scstep-l">Next: ' + esc(sceneLabel(nextId)) + '</span>' +
        '<span class="scstep-ar">&rarr;</span></button></div>' : '');
    openScene = id;
    document.body.classList.remove('on-day');
    $('v-scenes').classList.remove('on');
    $('v-scene1').classList.add('on');
    window.scrollTo({ top: 0 });
  }

  function spentTotal() { return grandTotal(); }
  function outstandingTotal() {
    return S.allItems.filter(function (it) {
      var k = st(it.id).st; return k !== 'done' && k !== 'arrived';
    }).reduce(function (a, it) { return a + lineCost(it); }, 0);
  }

  // ---------- buy list ----------
  // The purchasing view: everything still to get, grouped by where it is being
  // got from, so one person can sit down and clear a vendor in one pass.
  function renderBuy() {
    var open = S.allItems.filter(function (it) {
      var k = st(it.id).st; return k !== 'done' && k !== 'arrived';
    });
    var byVendor = {};
    open.forEach(function (it) {
      var v = (st(it.id).src || '').trim() || 'Not sourced yet';
      (byVendor[v] = byVendor[v] || []).push(it);
    });
    var vendors = Object.keys(byVendor).sort(function (a, b) {
      if (a === 'Not sourced yet') return 1;
      if (b === 'Not sourced yet') return -1;
      return a.localeCompare(b);
    });

    var openCost = open.reduce(function (a, it) { return a + lineCost(it); }, 0);
    var noPrice = open.filter(function (it) { return !st(it.id).price; }).length;

    var head = '<div class="sc-summary">' +
      '<div class="ss-row big"><span>Still to buy</span><b>' + money(openCost) + '</b></div>' +
      '<div class="ss-row"><span>Items outstanding</span><b>' + open.length + '</b></div>' +
      '<div class="ss-row"><span>Budget left</span><b class="' +
        (BUDGET_TOTAL - spentTotal() < 0 ? 'over' : 'under') + '">' +
        money(Math.abs(BUDGET_TOTAL - spentTotal())) + '</b></div>' +
      (noPrice ? '<div class="ss-row"><span>No price entered</span><b class="over">' + noPrice + '</b></div>' : '') +
      '</div>';

    if (!open.length) {
      $('buy').innerHTML = head + '<p class="ss-note">Nothing outstanding. Every item is marked arrived or done.</p>';
      return;
    }

    var body = vendors.map(function (v) {
      var list = byVendor[v];
      var sub = list.reduce(function (a, it) { return a + lineCost(it); }, 0);
      // Nothing already with Todd — reopening those tabs is how a thing gets
      // ordered twice by two different people.
      var links = list.reduce(function (a, it) {
        return st(it.id).sent ? a : a.concat(itemLinks(it.id));
      }, []);
      return '<div class="ven">' +
        '<div class="ven-h"><b>' + esc(v) + '</b><span>' + list.length + ' item' +
          (list.length === 1 ? '' : 's') + ' &middot; ' + money(sub) + '</span></div>' +
        list.map(function (it) {
          var s = st(it.id), q = qtyOf(it), ls = linksOf(s);
          return '<div class="ven-i' + (s.sent ? ' sent' : '') + '">' +
            '<button class="ven-tick" data-buytick="' + esc(it.id) + '" ' +
              'aria-label="Mark ' + esc(it.name) + ' arrived">&#10003;</button>' +
            '<div class="ven-t">' + (ls.length
              ? '<a href="' + esc(ls[0]) + '" target="_blank" rel="noopener">' + esc(it.name) + '</a>'
              : esc(it.name)) +
              '<span class="ven-s">' + esc(it.scene) + ' &middot; ' + esc(CATS[it.cat] || it.cat) +
              (q > 1 ? ' &middot; &times;' + q : '') +
              (s.sent ? ' &middot; <b class="ven-sent">' + esc(sentLabel(s)) + '</b>' : '') + '</span>' +
              // Everything after the first link, so a look built from three
              // shops can be bought in one pass without opening the item.
              (ls.length > 1 ? '<span class="ven-more">' + ls.slice(1).map(function (u, i) {
                return '<a href="' + esc(u) + '" target="_blank" rel="noopener">Link ' + (i + 2) + '</a>';
              }).join('') + '</span>' : '') +
            '</div>' +
            '<span class="ven-c">' + (s.price ? money(s.price * q) : '<i>no price</i>') + '</span></div>';
        }).join('') +
        (links.length ? '<button class="ven-open" data-openall="' + esc(v) + '" type="button">Open ' +
          links.length + ' link' + (links.length === 1 ? '' : 's') + '</button>' : '') +
        '</div>';
    }).join('');

    var toBuy = buyLinkList();
    var linked = toBuy.items.length;

    $('buy').innerHTML = head +
      '<div class="buy-acts">' +
        '<button class="buy-send" id="buySend" type="button"' + (linked ? '' : ' disabled') + '>' +
          'Send links to Todd to buy</button>' +
        '<button class="btn buy-copy" id="buyCopy" type="button">Copy the whole list</button>' +
        '<span class="buy-hint">' + (linked
          ? linked + ' item' + (linked === 1 ? '' : 's') + ' with links, ' + money(toBuy.totalCents) +
            ', straight to ' + esc(BUY_TO) + '.' +
            (toBuy.missing ? ' ' + toBuy.missing + ' still ' + (toBuy.missing === 1 ? 'has' : 'have') +
              ' no link — those are listed too, marked.' : '')
          : toBuy.already.length
            ? 'Nothing new to send. ' + toBuy.already.length + ' item' +
              (toBuy.already.length === 1 ? ' is' : 's are') + ' already with ' + esc(BUY_TO) +
              ' — struck through below. Add links to something else and this lights up again.'
            : 'Nothing has a link yet. Add links on an item and this sends them to ' + esc(BUY_TO) + '.') +
        '</span>' +
        '<div class="buy-note" id="buyNote"></div>' +
      '</div>' + body;
  }

  // What goes to Todd: everything still outstanding, links and all. Items with
  // no link ride along at the bottom so he can see the list is not finished
  // rather than buying two thirds of a show and assuming that was all of it.
  function buyLinkList() {
    var outstanding = S.allItems.filter(function (it) {
      var k = st(it.id).st; return k !== 'done' && k !== 'arrived';
    });
    // Anything already emailed to Todd is off the list. He was asked once; a
    // second copy of the same link is how a show ends up with two of a thing.
    var open = outstanding.filter(function (it) { return !st(it.id).sent; });
    var items = [], missing = 0, total = 0, ids = [];
    open.forEach(function (it) {
      var s = st(it.id), ls = linksOf(s), q = qtyOf(it);
      if (!ls.length) { missing++; return; }
      total += (s.price || 0) * q;
      ids.push(it.id);
      items.push({ name: it.name, scene: it.scene, cat: CATS[it.cat] || it.cat, who: it.who || '',
                   vendor: s.src || '', links: ls, status: s.st || 'todo', qty: q,
                   price_cents: s.price || 0, line_cents: (s.price || 0) * q, by: s.by || '' });
    });
    var unlinked = open.filter(function (it) { return !linksOf(st(it.id)).length; })
      .map(function (it) {
        return { name: it.name, scene: it.scene, cat: CATS[it.cat] || it.cat,
                 vendor: st(it.id).src || '', qty: qtyOf(it) };
      });
    // Struck through in the email rather than dropped from it — a line Todd
    // can see and skip beats a line that quietly is not there, when the
    // previous email asking for it is still sitting in his inbox.
    var already = outstanding.filter(function (it) { return st(it.id).sent; })
      .map(function (it) {
        var s = st(it.id);
        return { name: it.name, scene: it.scene, cat: CATS[it.cat] || it.cat, who: it.who || '',
                 vendor: s.src || '', qty: qtyOf(it), line_cents: (s.price || 0) * qtyOf(it),
                 sent: s.sent, sentBy: s.sentBy || '' };
      });
    return { items: items, unlinked: unlinked, already: already,
             ids: ids, missing: missing, totalCents: total };
  }

  // Freeze everything that just went out, so the next email cannot carry it
  // again and nobody edits a price out from under an order in flight.
  function markSent(ids) {
    var now = new Date().toISOString();
    ids.forEach(function (id) {
      var s = item[id] || st(id);
      s.sent = now;
      s.sentBy = me || s.by || '';
      item[id] = s;
      pushItem(id);
    });
    if (ids.length) saveLocal();
  }

  function sendBuyList() {
    var note = $('buyNote'), btn = $('buySend');
    var d = D.days[cur];
    var list = buyLinkList();
    if (!list.items.length) { note.textContent = 'Nothing to send — no item has a link yet.'; return; }
    var n = list.items.reduce(function (a, x) { return a + x.links.length; }, 0);
    if (!window.confirm('Email ' + n + ' link' + (n === 1 ? '' : 's') + ' across ' +
        list.items.length + ' item' + (list.items.length === 1 ? '' : 's') + ' to ' + BUY_TO + '?')) return;
    btn.disabled = true; note.textContent = 'Sending…';
    fetch('/api/deh-report', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'buy', dayLabel: (d && d.date) || 'Today', by: me || 'staff', at: clock(Date.now()),
        items: list.items, unlinked: list.unlinked, already: list.already, missing: list.missing,
        totalCents: list.totalCents, budgetCents: BUDGET_TOTAL, spentCents: spentTotal()
      })
    }).then(function (res) { return res.json().catch(function () { return { ok: res.ok }; }); })
      .then(function (j) {
        btn.disabled = false;
        if (!j || !j.ok) throw new Error((j && j.error) || 'send failed');
        // Only after the mail is away. Marking first would lock items off a
        // send that never happened, and nothing would ever reach Todd.
        markSent(list.ids);
        renderBuy(); renderBudget();
        var note2 = $('buyNote');
        if (note2) {
          note2.textContent = 'Sent to ' + BUY_TO + ' — ' + n + ' link' + (n === 1 ? '' : 's') +
            ', ' + money(list.totalCents) + '. ' + list.ids.length +
            ' item' + (list.ids.length === 1 ? '' : 's') + ' locked; they will not go again.';
        }
      })
      .catch(function (e) {
        btn.disabled = false;
        note.innerHTML = 'Could not send &mdash; ' + esc(String(e.message || e)) +
          '. <a href="#" id="buyCopy2">Copy the list</a> and email it to ' + esc(BUY_TO) + '.';
        var c = $('buyCopy2');
        if (c) c.addEventListener('click', function (ev) {
          ev.preventDefault();
          copyText(buyListText(), note, BUY_TO);
        });
      });
  }
  function buyListText() {
    var open = S.allItems.filter(function (it) {
      var k = st(it.id).st; return k !== 'done' && k !== 'arrived';
    });
    var byVendor = {};
    open.forEach(function (it) {
      var v = (st(it.id).src || '').trim() || 'Not sourced yet';
      (byVendor[v] = byVendor[v] || []).push(it);
    });
    var L = ['DEAR EVAN HANSEN — still to buy', ''];
    Object.keys(byVendor).sort().forEach(function (v) {
      var sub = byVendor[v].reduce(function (a, it) { return a + lineCost(it); }, 0);
      L.push(v.toUpperCase() + '  (' + money(sub) + ')');
      byVendor[v].forEach(function (it) {
        var s = st(it.id), q = qtyOf(it);
        L.push('  ' + (s.sent ? '[SENT] ' : '- ') + it.name + (q > 1 ? ' x' + q : '') + '  ' +
               (s.price ? money(s.price * q) : 'no price') +
               '   [' + it.scene + ' / ' + (CATS[it.cat] || it.cat) + ']' +
               (s.sent ? '  ' + sentLabel(s) + ' — do not re-buy' : '') +
               linksOf(s).map(function (u) { return '\n      ' + u; }).join(''));
      });
      L.push('');
    });
    L.push('Total outstanding: ' + money(open.reduce(function (a, it) { return a + lineCost(it); }, 0)));
    return L.join('\n');
  }

  function renderBudget() {
    var rows = [];
    var byCat = { set: 0, prop: 0, costume: 0 };
    S.allItems.forEach(function (it) { byCat[it.cat] = (byCat[it.cat] || 0) + lineCost(it); });

    var stdCost = S.standing.reduce(function (a, it) { return a + lineCost(it); }, 0);
    rows.push({ n: 'Whole show', c: stdCost, id: 'ALL',
                d: S.standing.filter(function (i) { return st(i.id).st === 'done'; }).length, t: S.standing.length });
    S.scenes.forEach(function (s) {
      rows.push({ n: 'Act ' + s.act + ' Sc ' + s.sc, c: sceneCost(s), id: s.id, d: sceneDone(s), t: s.items.length });
    });

    var outstanding = S.allItems.filter(function (it) {
      var k = st(it.id).st; return k !== 'done' && k !== 'arrived';
    }).reduce(function (a, it) { return a + lineCost(it); }, 0);

    var spent = grandTotal();
    var left = BUDGET_TOTAL - spent;

    $('budget').innerHTML =
      '<div class="sc-summary">' +
        '<div class="ss-row big"><span>Spent so far</span><b>' + money(spent) + '</b></div>' +
        '<div class="ss-row"><span>Budget</span><b>' + money(BUDGET_TOTAL) + '</b></div>' +
        '<div class="ss-row"><span>' + (left < 0 ? 'Over by' : 'Left') + '</span>' +
          '<b class="' + (left < 0 ? 'over' : 'under') + '">' + money(Math.abs(left)) + '</b></div>' +
        '<div class="ss-row"><span>Still to arrive</span><b>' + money(outstanding) + '</b></div>' +
      '</div>' +
      '<h3>By department</h3>' +
      ['set', 'prop', 'costume'].map(function (c) {
        var used = byCat[c] || 0, cap = BUDGET[c] || 0;
        var pct = cap ? Math.min(100, Math.round(used / cap * 100)) : 0;
        var over = used > cap;
        return '<div class="dept' + (over ? ' over' : '') + '">' +
          '<div class="dept-h"><b>' + esc(CATS[c]) + '</b>' +
            '<span>' + money(used) + ' of ' + money(cap) + '</span></div>' +
          '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
          '<div class="dept-f">' + (over
            ? '<span class="over">Over by ' + money(used - cap) + '</span>'
            : '<span>' + money(cap - used) + ' left</span>') + '</div></div>';
      }).join('') +
      '<h3>By scene</h3>' +
      rows.map(function (r) {
        return '<div class="kv budrow" data-scene="' + esc(r.id) + '"><span class="kv-k">' + esc(r.n) + '</span>' +
          '<span class="kv-v">' + r.d + '/' + r.t + ' sourced</span>' +
          '<span class="kv-c">' + money(r.c) + '</span></div>';
      }).join('') +
      '<p class="ss-note">A scene shows $0 until someone enters a price. Enter unit price and quantity on each ' +
      'item and every total here fills in on its own.</p>';
  }

  function renderAll() { renderSchedule(); renderScenes(); renderBudget(); renderBuy(); renderStrike(); }

  // ---------- strike ----------
  // What has to happen after the last performance, and whose name is against
  // each line. Strike is the part of a production that gets planned last and
  // goes wrong most: people leave, things go home in the wrong bag, and the
  // borrowed furniture is the thing nobody remembers. A name against a line
  // is the whole point of this tab.
  var STRIKE_AREAS = [
    { k: 'set',       l: 'Set' },
    { k: 'lighting',  l: 'Lighting' },
    { k: 'sound',     l: 'Sound' },
    { k: 'projection', l: 'Projection' },
    { k: 'props',     l: 'Props' },
    { k: 'costume',   l: 'Costumes' },
    { k: 'hair',      l: 'Hair & Wigs' },
    { k: 'house',     l: 'Front of house' },
    { k: 'backstage', l: 'Backstage & dressing rooms' },
    { k: 'load',      l: 'Load-out & returns' }
  ];
  function areaLabel(k) {
    for (var i = 0; i < STRIKE_AREAS.length; i++) if (STRIKE_AREAS[i].k === k) return STRIKE_AREAS[i].l;
    return k;
  }

  // A starting list, not a fixed one — every line can be edited or deleted,
  // and the tab is just as usable emptied out. It exists because a blank page
  // at 10pm on closing night is how the borrowed furniture gets forgotten.
  var STRIKE_SEED = [
    ['set', 'Unbolt and stack decking, screws out and boxed'],
    ['set', 'Break down anything we are not keeping'],
    ['set', 'Return borrowed furniture — check it against the list of who lent what'],
    ['set', 'Sweep and mop the stage'],
    ['lighting', 'Let the lamps cool before anyone touches the grid'],
    ['lighting', 'Drop the specials, cap and coil every cable'],
    ['lighting', 'Gel out of the frames, labelled and boxed'],
    ['lighting', 'House plot back to rep'],
    ['lighting', 'Ladders and lift away, floor clear'],
    ['sound', 'Mics off, batteries out, packs back in the case'],
    ['sound', 'Every scrap of mic tape off the deck and off the actors'],
    ['sound', 'XLR coiled over-under and labelled'],
    ['sound', 'Monitors and stands to storage'],
    ['projection', 'Content off the machine'],
    ['projection', 'Projector, cabling and surfaces down'],
    ['props', 'Everything back to the props table for check-in'],
    ['props', 'Check every prop against the running list before anything leaves'],
    ['props', 'Borrowed props bagged with the owner’s name on the bag'],
    ['props', 'Consumables binned'],
    ['costume', 'Every costume on a hanger with the actor’s name — nothing goes home'],
    ['costume', 'Wash pile kept separate from dry-clean'],
    ['costume', 'Count the shoes'],
    ['costume', 'Rentals bagged with their paperwork'],
    ['hair', 'Wigs back on blocks'],
    ['hair', 'Brushes and combs washed, kits sealed'],
    ['hair', 'Bin every used applicator'],
    ['house', 'Programmes and signage down'],
    ['house', 'Lobby and concessions cleared and counted'],
    ['house', 'Lost property bagged and labelled'],
    ['backstage', 'Quick-change booths struck, glow tape up'],
    ['backstage', 'Every dressing room emptied and walked'],
    ['backstage', 'Bin bags out'],
    ['load', 'Van loaded in the order it unloads'],
    ['load', 'Collect every script and MTI material — none of it goes home with anyone'],
    ['load', 'Count the scripts against the list before we leave'],
    ['load', 'Final walk of the building with the venue rep']
  ];
  var STRIKE_SEED_KEY = '__seeded__';

  function strikeRows() {
    return strike.filter(function (t) { return t.task_id !== STRIKE_SEED_KEY; });
  }
  function strikeOf(area) {
    return strikeRows().filter(function (t) { return t.area === area; })
      .sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
  }
  function strikeAreas() {
    var keys = STRIKE_AREAS.map(function (x) { return x.k; });
    strikeRows().forEach(function (t) { if (keys.indexOf(t.area) < 0) keys.push(t.area); });
    return keys;
  }
  function seedStrike() {
    return STRIKE_SEED.map(function (row, i) {
      return { task_id: 'seed-' + i, area: row[0], body: row[1], who: '',
               done: false, done_by: '', sort: i };
    });
  }

  function renderStrike() {
    var dl = $('strikeWho');
    if (dl) {
      dl.innerHTML = people().filter(function (p) { return p.name; })
        .map(function (p) { return '<option value="' + esc(p.name) + '">'; }).join('');
    }
    var all = strikeRows();
    var done = all.filter(function (t) { return t.done; }).length;
    var pct = all.length ? Math.round(done / all.length * 100) : 0;
    var unassigned = all.filter(function (t) { return !(t.who || '').trim(); }).length;
    var mine = me ? all.filter(function (t) {
      return (t.who || '').trim().toLowerCase() === me.toLowerCase();
    }).length : 0;

    var head = '<div class="sc-summary">' +
      '<div class="ss-row"><span>Struck</span><b>' + done + ' of ' + all.length + '</b></div>' +
      '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="ss-row"><span>Nobody’s name on it</span><b class="' +
        (unassigned ? 'over' : 'under') + '">' + unassigned + '</b></div>' +
      (me ? '<div class="ss-row"><span>Yours, ' + esc(me) + '</span><b>' + mine + '</b></div>' : '') +
      '<p class="ss-note">Put a name against every line before the last show. On the night, tap the box ' +
      'as each one is finished — everyone sees the same list.</p></div>';

    var body = strikeAreas().map(function (k) {
      var list = strikeOf(k);
      var d = list.filter(function (t) { return t.done; }).length;
      return '<div class="stk' + (list.length && d === list.length ? ' full' : '') + '">' +
        '<div class="stk-h"><b>' + esc(areaLabel(k)) + '</b>' +
          '<span>' + d + '/' + list.length + '</span></div>' +
        (list.length ? list.map(strikeRow).join('')
                     : '<p class="stk-none">Nothing on this list yet.</p>') +
        '<div class="stk-add">' +
          '<input data-stknew="' + esc(k) + '" placeholder="Add a job" autocomplete="off">' +
          '<button class="btn stk-go" data-stkadd="' + esc(k) + '" type="button">Add</button>' +
        '</div></div>';
    }).join('');

    $('strike').innerHTML = head +
      '<div class="buy-acts"><button class="btn buy-copy" id="stkCopy" type="button">Copy the list</button>' +
      '<span class="buy-hint">Names save as you type. Anyone with the dashboard sees the same list.</span></div>' +
      body;
  }

  function strikeRow(t) {
    return '<div class="stk-i' + (t.done ? ' done' : '') + '" data-stk="' + esc(t.task_id) + '">' +
      '<button class="stk-tick" data-stktick="' + esc(t.task_id) + '" aria-pressed="' + (t.done ? 'true' : 'false') +
        '" aria-label="' + (t.done ? 'Mark not done' : 'Mark done') + '">' + (t.done ? '&#10003;' : '') + '</button>' +
      '<div class="stk-t"><span class="stk-b">' + esc(t.body) + '</span>' +
        (t.done && t.done_by ? '<span class="stk-by">struck by ' + esc(t.done_by) + '</span>' : '') + '</div>' +
      '<input class="stk-who" list="strikeWho" data-stkwho="' + esc(t.task_id) + '" value="' + esc(t.who || '') +
        '" placeholder="who" autocomplete="off" aria-label="Who is doing this">' +
      '<button class="stk-x" data-stkdel="' + esc(t.task_id) + '" aria-label="Remove this job">&times;</button>' +
    '</div>';
  }

  function strikeText() {
    var L = ['DEAR EVAN HANSEN — STRIKE', ''];
    strikeAreas().forEach(function (k) {
      var list = strikeOf(k);
      if (!list.length) return;
      L.push(areaLabel(k).toUpperCase());
      list.forEach(function (t) {
        L.push('  [' + (t.done ? 'x' : ' ') + '] ' + t.body +
               (t.who ? '   — ' + t.who : '   — UNASSIGNED'));
      });
      L.push('');
    });
    var all = strikeRows();
    L.push(all.filter(function (t) { return t.done; }).length + ' of ' + all.length + ' done.');
    return L.join('\n');
  }

  function saveStrike(t) {
    saveLocal();
    if (!remote) return;
    api('strike_set', { task_id: t.task_id, area: t.area, body: t.body, who: t.who || '',
                        done: !!t.done, done_by: t.done_by || '', sort: t.sort || 0 })
      .catch(function () { setSync('offline — saved on this phone'); });
  }
  function strikeById(id) {
    return strikeRows().filter(function (t) { return t.task_id === id; })[0];
  }

  // ---------- reference tabs ----------
  function renderRef() {
    $('refCrews').innerHTML = D.rhythm.map(function (r) {
      if (!r.v) return '<h3>' + esc(r.k) + '</h3>';
      return '<div class="kv"><span class="kv-k">' + esc(r.k) + '</span><span class="kv-v">' + esc(r.v) + '</span></div>';
    }).join('') + ACCESS.map(function (r) {
      if (!r.v) return '<h3>' + esc(r.k) + '</h3>';
      return '<div class="kv"><span class="kv-k">' + esc(r.k) + '</span><span class="kv-v">' + esc(r.v) + '</span></div>';
    }).join('');
  }

  // ---------- boot ----------
  function boot() {
    loadLocal();
    renderRef();
    renderAll();
    watchTopbar();

    document.body.classList.add('on-day');
    var today = new Date().toISOString().slice(0, 10);
    D.days.forEach(function (d, i) { if (d.iso === today) cur = i; });
    renderSchedule();

    $('dayChips').addEventListener('click', function (e) {
      var b = e.target.closest('.chip');
      if (!b) return;
      cur = +b.dataset.i; renderSchedule();
      loadDay(D.days[cur].iso, renderDay);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    $('day').addEventListener('click', function (e) {
      var d = D.days[cur];

      // attendance: tap the box to cycle the state
      var a = e.target.closest('[data-att]');
      if (a) {
        var pid = a.dataset.att, k = d.iso + '|' + pid;
        var curA = attOf(d.iso, pid);
        att[k] = { status: attNext(curA.status), note: curA.note || '', by: me || '' };
        saveLocal(); pushAttendance(d.iso, pid); renderDay();
        return;
      }
      if (e.target.id === 'atAdd') {
        var nm = ($('atNew').value || '').trim();
        if (!nm) return;
        var kind = $('atKind').value || 'cast';
        var id = kind + '-' + slug(nm) + '-' + (people().length + 1);
        var p = { person_id: id, name: nm, role: '', kind: kind, sort: 100 + people().length };
        roster.push(p); saveLocal(); pushRoster(p); renderDay();
        return;
      }
      var na = e.target.closest('[data-ntadd]');
      if (na) {
        var dept = na.dataset.ntadd;
        var ta = document.querySelector('[data-ntbody="' + dept.replace(/"/g, '') + '"]');
        var body = ta ? (ta.value || '').trim() : '';
        if (!body) { if (ta) ta.focus(); return; }
        addNote(d.iso, dept, body);
        saveLocal();
        // Repaint this department only — the stage manager may have half a
        // note typed into two others.
        refreshDeptBox(d.iso, dept);
        var again = document.querySelector('[data-ntbody="' + dept.replace(/"/g, '') + '"]');
        if (again) again.focus();
        return;
      }
      var dn = e.target.closest('[data-delnote]');
      if (dn) {
        var nid = dn.dataset.delnote;
        var gone = notes.filter(function (x) { return x.note_id === nid; })[0];
        notes = notes.filter(function (x) { return x.note_id !== nid; });
        saveLocal();
        if (remote) api('note_delete', { note_id: nid }).catch(function () {});
        if (gone) refreshDeptBox(d.iso, gone.dept); else renderDay();
        return;
      }
      if (e.target.id === 'repSend') { sendReport(d); return; }
      if (e.target.id === 'repView') {
        copyText(reportPlainText(buildReport(d)), $('repNote'));
        return;
      }

      var t = e.target.closest('[data-tick]');
      if (t) {
        var id2 = t.dataset.tick;
        if (done[id2]) clearDone(id2); else openWho(id2, t);
        return;
      }
      var blk = e.target.closest('.blk');
      if (blk) blk.classList.toggle('open');
    });

    // A box holding text nobody has pressed Add on gets marked, so an unsent
    // note is visible from the closed summary rather than only from inside.
    $('day').addEventListener('input', function (e) {
      if (!(e.target.dataset && e.target.dataset.ntbody)) return;
      var box = e.target.closest('[data-deptbox]');
      if (box) box.classList.toggle('pending', !!e.target.value.trim());
    });

    // attendance notes and roster names save as they are typed
    $('day').addEventListener('change', function (e) {
      var d = D.days[cur];
      var an = e.target.closest('[data-anote]');
      if (an) {
        var pid = an.dataset.anote, k = d.iso + '|' + pid;
        att[k] = { status: attOf(d.iso, pid).status, note: an.value.trim(), by: me || '' };
        saveLocal(); pushAttendance(d.iso, pid);
        return;
      }
      var pn = e.target.closest('[data-pname]');
      if (pn) {
        var id = pn.dataset.pname;
        roster.forEach(function (p) {
          if (p.person_id === id) { p.name = pn.value.trim(); saveLocal(); pushRoster(p); }
        });
      }
    });

    $('buy').addEventListener('click', function (e) {
      if (e.target.id === 'buySend') { sendBuyList(); return; }
      if (e.target.id === 'buyCopy') {
        copyText(buyListText(), null);
        e.target.textContent = 'Copied';
        setTimeout(function () { e.target.textContent = 'Copy the whole list'; }, 1800);
        return;
      }
      var oa = e.target.closest('[data-openall]');
      if (oa) {
        var v = oa.dataset.openall;
        S.allItems.forEach(function (it) {
          var s = st(it.id);
          if (s.st === 'done' || s.st === 'arrived' || s.sent) return;
          if (((s.src || '').trim() || 'Not sourced yet') !== v) return;
          linksOf(s).forEach(function (u) { window.open(u, '_blank', 'noopener'); });
        });
        return;
      }
      var bt = e.target.closest('[data-buytick]');
      if (bt) {
        var iid = bt.dataset.buytick, s2 = st(iid);
        s2.st = 'arrived'; s2.by = me || s2.by || '';
        item[iid] = s2; saveLocal(); pushItem(iid);
        renderBuy(); renderBudget(); renderScenes();
      }
    });

    // ---------- strike ----------
    $('strike').addEventListener('click', function (e) {
      if (e.target.id === 'stkCopy') {
        copyText(strikeText(), null, 'whoever needs it');
        e.target.textContent = 'Copied';
        setTimeout(function () { e.target.textContent = 'Copy the list'; }, 1800);
        return;
      }
      var tk = e.target.closest('[data-stktick]');
      if (tk) {
        var t = strikeById(tk.dataset.stktick);
        if (!t) return;
        t.done = !t.done;
        // Who struck it, not who is down to do it. On the night those differ
        // more often than not, and the person who actually did it is the one
        // worth having on the record.
        t.done_by = t.done ? (me || '') : '';
        saveStrike(t); renderStrike();
        return;
      }
      var dx = e.target.closest('[data-stkdel]');
      if (dx) {
        var id = dx.dataset.stkdel;
        strike = strike.filter(function (x) { return x.task_id !== id; });
        saveLocal();
        if (remote) api('strike_delete', { task_id: id }).catch(function () {});
        renderStrike();
        return;
      }
      var ad = e.target.closest('[data-stkadd]');
      if (ad) {
        var area = ad.dataset.stkadd;
        var box = document.querySelector('[data-stknew="' + area.replace(/"/g, '') + '"]');
        var body = box ? (box.value || '').trim() : '';
        if (!body) { if (box) box.focus(); return; }
        var next = { task_id: 'stk-' + Date.now() + '-' + Math.floor(Math.random() * 1e4),
                     area: area, body: body, who: '', done: false, done_by: '',
                     sort: strikeOf(area).length + 1000 };
        strike.push(next);
        saveStrike(next); renderStrike();
        var again = document.querySelector('[data-stknew="' + area.replace(/"/g, '') + '"]');
        if (again) again.focus();
        return;
      }
    });
    // A name saves as it is typed — nobody presses a button to claim a job.
    $('strike').addEventListener('change', function (e) {
      var w = e.target.closest('[data-stkwho]');
      if (!w) return;
      var t = strikeById(w.dataset.stkwho);
      if (!t) return;
      t.who = w.value.trim();
      saveStrike(t);
    });
    $('strike').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var n = e.target.closest('[data-stknew]');
      if (!n) return;
      e.preventDefault();
      var btn = document.querySelector('[data-stkadd="' + n.dataset.stknew.replace(/"/g, '') + '"]');
      if (btn) btn.click();
    });

    $('scenes').addEventListener('click', function (e) {
      var c = e.target.closest('.scenecard');
      if (c) renderSceneDetail(c.dataset.scene);
    });
    $('budget').addEventListener('click', function (e) {
      var r = e.target.closest('.budrow');
      if (!r) return;
      showView('scenes');
      renderSceneDetail(r.dataset.scene);
    });

    // sourcing edits — one delegated handler for every field on every item
    $('sceneDetail').addEventListener('click', function (e) {
      // Save the whole card. Fields already commit on blur, but on a phone that
      // is invisible — people want a button that says the row is stored.
      // Deliberately reopen something already emailed to Todd. Confirmed,
      // because the point of the lock is that it is not a stray tap, and it
      // puts the item back on the next list — which is usually what you want
      // after correcting a wrong price, and never what you want by accident.
      var ul = e.target.closest('[data-unlock]');
      if (ul) {
        var uid = ul.dataset.unlock;
        var us = item[uid] || st(uid);
        if (!window.confirm('This already went to ' + BUY_TO + ' on ' +
            (us.sent ? new Date(us.sent).toLocaleDateString() : 'an earlier day') +
            '. Unlocking puts it back on the next email — Todd could buy it twice. Continue?')) return;
        delete us.sent; delete us.sentBy;
        us.by = me || us.by || '';
        us.at = new Date().toISOString();
        item[uid] = us;
        saveLocal(); pushItem(uid);
        renderSceneDetail(openScene); renderBuy(); renderBudget();
        return;
      }

      var si = e.target.closest('[data-saveitem]');
      if (si) {
        var ibox = si.closest('[data-item]');
        var iid = ibox.dataset.item;
        if (isSent(iid)) return;   // the fields are disabled; belt and braces
        var cur2 = item[iid] || { st: 'todo', src: '', link: '', links: [], price: 0, qty: 0, by: '', at: '' };
        ibox.querySelectorAll('[data-f]').forEach(function (el) {
          var g = el.dataset.f;
          if (g === 'price') {
            var pv = parseFloat(el.value);
            cur2.price = isFinite(pv) && pv >= 0 ? Math.round(pv * 100) : 0;
          } else if (g === 'qty') {
            var qv = parseInt(el.value, 10);
            cur2.qty = isFinite(qv) && qv > 0 ? qv : 1;
          } else {
            cur2[g] = el.value;
          }
        });
        // A link typed but not added yet would otherwise be lost by the
        // re-render this save triggers. Take it along.
        var pending = ibox.querySelector('[data-nl]');
        if (pending && pending.value.trim()) {
          var pu = safeUrl(pending.value);
          if (!pu) {
            var lk = ibox.querySelector('.lk');
            if (lk) { lk.classList.add('bad'); setTimeout(function () { lk.classList.remove('bad'); }, 1600); }
            si.textContent = 'Check the link';
            setTimeout(function () { si.textContent = 'Save this item'; }, 1600);
            return;
          }
          setLinks(cur2, linksOf(cur2).concat([pu]));
          pending.value = '';
        }
        cur2.by = me || cur2.by || '';
        cur2.at = new Date().toISOString();
        item[iid] = cur2;
        saveLocal(); pushItem(iid);
        ibox.classList.add('just-saved');
        si.textContent = 'Saved \u2713';
        var lkbox = ibox.querySelector('.lks');
        if (lkbox) lkbox.outerHTML = linkBox(iid, itemLinks(iid));
        var costCell = ibox.querySelector('.it-cost');
        var itObj = S.allItems.filter(function (x) { return x.id === iid; })[0];
        if (costCell && itObj) costCell.textContent = money(lineCost(itObj));
        renderBudget(); renderBuy();
        setTimeout(function () {
          ibox.classList.remove('just-saved');
          si.textContent = 'Save this item';
        }, 1800);
        return;
      }

      // Add a link to the list. There is no "blur to commit" here on purpose:
      // with several links per item, a field that silently swallows what was
      // typed is worse than one that waits for the button.
      var sv = e.target.closest('[data-addlink]');
      if (sv) { addLinkFrom(sv.closest('[data-item]')); return; }

      var dl = e.target.closest('[data-dellink]');
      if (dl) {
        var lid = dl.dataset.lkitem, gone = dl.dataset.dellink;
        if (isSent(lid)) return;
        var s3 = item[lid] || st(lid);
        setLinks(s3, linksOf(s3).filter(function (u) { return u !== gone; }));
        s3.by = me || s3.by || '';
        s3.at = new Date().toISOString();
        item[lid] = s3;
        saveLocal(); pushItem(lid);
        var lbox = dl.closest('.lks');
        if (lbox) lbox.outerHTML = linkBox(lid, itemLinks(lid));
        renderBuy();
        return;
      }
      // straight to the neighbouring scene, no trip back through the list
      var go = e.target.closest('[data-goscene]');
      if (go) { renderSceneDetail(go.dataset.goscene); return; }

      if (e.target.closest('#scBack')) {
        $('v-scene1').classList.remove('on');
        $('v-scenes').classList.add('on');
        openScene = null;
        renderScenes();
        window.scrollTo({ top: 0 });
      }
    });
    // arrow keys walk the show on a laptop; ignored while typing in a field
    document.addEventListener('keydown', function (e) {
      if (!openScene || e.metaKey || e.ctrlKey || e.altKey) return;
      var t = e.target, tag = t && t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); stepScene(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); stepScene(-1); }
    });

    // Take whatever is in a card's "add a link" field and put it on the item.
    // Called by the Add button, by Enter, and by blurring the field, so there
    // is no way to type a link and have it quietly disappear.
    function addLinkFrom(box) {
      if (!box) return false;
      var input = box.querySelector('[data-nl]');
      if (!input) return false;
      var raw = input.value.trim();
      var lab = input.closest('.lk');
      if (!raw) return false;
      var url = safeUrl(raw);
      if (!url) {
        if (lab) {
          lab.classList.add('bad');
          setTimeout(function () { lab.classList.remove('bad'); }, 1600);
        }
        return false;
      }
      var id = box.dataset.item;
      if (isSent(id)) return false;
      var s = item[id] || st(id);
      var have = linksOf(s);
      if (have.indexOf(url) < 0) setLinks(s, have.concat([url]));
      s.by = me || s.by || '';
      s.at = new Date().toISOString();
      item[id] = s;
      input.value = '';
      saveLocal(); pushItem(id);
      var lbox = box.querySelector('.lks');
      if (lbox) lbox.outerHTML = linkBox(id, itemLinks(id));
      var again = box.querySelector('[data-nl]');
      if (again) again.focus();
      renderBuy();
      return true;
    }

    function onEdit(e) {
      var f = e.target.dataset && e.target.dataset.f;
      if (!f) return;
      var box = e.target.closest('[data-item]');
      if (!box) return;
      var id = box.dataset.item;
      if (isSent(id)) return;
      var s = item[id] || { st: 'todo', src: '', link: '', links: [], price: 0, qty: 0, by: '', at: '' };
      if (f === 'price') {
        var v = parseFloat(e.target.value);
        s.price = isFinite(v) && v >= 0 ? Math.round(v * 100) : 0;
      } else if (f === 'qty') {
        var q = parseInt(e.target.value, 10);
        s.qty = isFinite(q) && q > 0 ? q : 1;
      } else {
        s[f] = e.target.value;
      }
      // Tapping the status dropdown straight from a half-typed text field can
      // land the select's change ahead of the input's. Read every field on the
      // row before committing so nothing is lost in that race.
      if (f === 'st') {
        box.querySelectorAll('[data-f]').forEach(function (el) {
          var g = el.dataset.f;
          if (g === 'st') return;
          if (g === 'price') {
            var pv = parseFloat(el.value);
            s.price = isFinite(pv) && pv >= 0 ? Math.round(pv * 100) : 0;
          } else if (g === 'qty') {
            var qv = parseInt(el.value, 10);
            s.qty = isFinite(qv) && qv > 0 ? qv : 1;
          } else {
            s[g] = el.value;
          }
        });
      }
      s.by = me || s.by || '';
      s.at = new Date().toISOString();
      item[id] = s;
      saveLocal(); pushItem(id);
      // repaint totals without losing the field the user is typing in
      var active = document.activeElement;
      // Marking one thing done used to re-render the whole scene, which threw
      // the page back to the top — so working down a scene ticking items off
      // meant scrolling back to your place after every single one. Nothing
      // about a status change moves anything, so repaint the row and leave the
      // page exactly where it is.
      if (f === 'st') {
        box.className = 'it it-' + esc(s.st) + (s.sent ? ' sent' : '');
        renderBudget(); renderBuy();
        var sc0 = openScene === 'ALL'
          ? { items: S.standing }
          : S.scenes.filter(function (x) { return x.id === openScene; })[0];
        if (sc0) {
          var tot0 = $('sceneDetail').querySelector('.sc-total b');
          if (tot0) tot0.textContent = money(sc0.items.reduce(function (a, x) { return a + lineCost(x); }, 0));
        }
        var cell0 = box.querySelector('.it-cost');
        var it0 = S.allItems.filter(function (x) { return x.id === id; })[0];
        if (cell0 && it0) cell0.textContent = money(lineCost(it0));
        if (active && active.focus) active.focus();
        return;
      }
      var it = S.allItems.filter(function (x) { return x.id === id; })[0];
      if (it) {
        var cell = box.querySelector('.it-cost');
        if (cell) cell.textContent = money(lineCost(it));
      }
      var sc = openScene === 'ALL'
        ? { items: S.standing }
        : S.scenes.filter(function (x) { return x.id === openScene; })[0];
      if (sc) {
        var tot = $('sceneDetail').querySelector('.sc-total b');
        if (tot) tot.textContent = money(sc.items.reduce(function (a, x) { return a + lineCost(x); }, 0));
      }
      renderBudget();
      if (active && active.focus) active.focus();
    }
    $('sceneDetail').addEventListener('change', onEdit);
    $('sceneDetail').addEventListener('input', function (e) {
      if (e.target.dataset && (e.target.dataset.f === 'price' || e.target.dataset.f === 'qty')) onEdit(e);
    });
    // Enter adds the link too. Without this, pressing it inside a lone input
    // would submit nothing and look like the paste was rejected.
    $('sceneDetail').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      if (!(e.target.dataset && 'nl' in e.target.dataset)) return;
      e.preventDefault();
      addLinkFrom(e.target.closest('[data-item]'));
    });
    // And blurring a filled field commits it, so tapping straight from the
    // link box to Save does not drop what was pasted.
    $('sceneDetail').addEventListener('focusout', function (e) {
      if (!(e.target.dataset && 'nl' in e.target.dataset)) return;
      if (!e.target.value.trim()) return;
      var box = e.target.closest('[data-item]');
      // Let a tap on Add or Save run first — both handle the field themselves.
      setTimeout(function () {
        if (box && box.isConnected && box.querySelector('[data-nl]')) addLinkFrom(box);
      }, 180);
    });

    document.querySelectorAll('.navbtn').forEach(function (b) {
      b.addEventListener('click', function () { showView(b.dataset.v); });
    });

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') refresh(true);
    });
    window.addEventListener('online', function () { refresh(true); });
    window.addEventListener('focus', function () { refresh(); });

    connect().then(function () {
      // Three states, and the difference matters: nobody should think the
      // team is sharing when it is not.
      lastSync = Date.now();
      syncLine();
      renderAll();
      loadDay(D.days[cur].iso, renderDay);
      startPolling();
    });
  }

  function showView(v) {
    document.body.classList.toggle('on-day', v === 'day');
    document.querySelectorAll('.navbtn').forEach(function (x) { x.classList.toggle('sel', x.dataset.v === v); });
    document.querySelectorAll('.view').forEach(function (x) { x.classList.remove('on'); });
    $('v-' + v).classList.add('on');
    if (v === 'scenes') { openScene = null; renderScenes(); }
    if (v === 'budget') renderBudget();
    if (v === 'buy') renderBuy();
    if (v === 'strike') renderStrike();
    window.scrollTo({ top: 0 });
  }

  // ---------- gate ----------
  function openGate() {
    $('gate').classList.remove('show');
    $('app').style.display = '';
    boot();
  }
  if (localStorage.getItem(LS_GATE) === GATE_WORD) {
    openGate();
  } else {
    $('gateGo').addEventListener('click', function () {
      var v = $('gateWord').value.trim().toLowerCase();
      if (v === GATE_WORD) { localStorage.setItem(LS_GATE, GATE_WORD); openGate(); }
      else { $('gateErr').textContent = 'That is not it. Ask Tony.'; }
    });
    $('gateWord').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('gateGo').click(); });
  }
})();
