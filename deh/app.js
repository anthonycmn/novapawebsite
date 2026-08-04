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
  var C = window.NOVAREG || {};
  var LS_DONE = 'deh.done.v1', LS_ITEM = 'deh.items.v1', LS_ME = 'deh.me.v1', LS_GATE = 'deh.gate.v1';
  var LS_ROSTER = 'deh.roster.v1', LS_ATT = 'deh.att.v1', LS_NOTE = 'deh.notes.v1', LS_REP = 'deh.rep.v1';
  var GATE_WORD = 'orchard';   // curtain, not a lock — change here and tell staff

  // Who can sign a block off. Anyone not listed picks "Someone else" and types.
  var STAFF = ['Danielle', 'Shelby', 'Ryyana', 'Colton', 'Tony', 'Stage Manager'];

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
  // each design head. Keys match db/deh-progress.sql and deh-report.mjs.
  var DEPTS = [
    { k: 'general', l: 'General' }, { k: 'stage', l: 'Stage' }, { k: 'music', l: 'Music' },
    { k: 'costume', l: 'Costume / H&M' }, { k: 'tech', l: 'Set / LX / Sound' },
    { k: 'props', l: 'Props' }, { k: 'safety', l: 'Safety' }
  ];
  function deptLabel(k) {
    for (var i = 0; i < DEPTS.length; i++) if (DEPTS[i].k === k) return DEPTS[i].l;
    return k;
  }

  var done = {}, item = {};
  // roster: [{person_id,name,role,kind,sort}]  att: { 'iso|person_id': {status,note,by} }
  // notes: [{note_id,day,dept,body,author,created_at}]  reports: { iso: {at,by} }
  var roster = [], att = {}, notes = [], reports = {};
  var loadedDays = {};   // iso -> true, so a day's attendance/notes fetch once
  var me = localStorage.getItem(LS_ME) || '';
  var sb = null, remote = false;

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

  function $(id) { return document.getElementById(id); }
  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function clock(ts) {
    var d = new Date(ts), h = d.getHours(), m = d.getMinutes();
    return ((h % 12) || 12) + ':' + (m < 10 ? '0' : '') + m + (h < 12 ? 'am' : 'pm');
  }
  function money(c) {
    if (!c) return '$0';
    return '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
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
    if (!roster.length) roster = seedRoster();
  }
  function saveLocal() {
    try {
      localStorage.setItem(LS_DONE, JSON.stringify(done));
      localStorage.setItem(LS_ITEM, JSON.stringify(item));
      localStorage.setItem(LS_ROSTER, JSON.stringify(roster));
      localStorage.setItem(LS_ATT, JSON.stringify(att));
      localStorage.setItem(LS_NOTE, JSON.stringify(notes));
      localStorage.setItem(LS_REP, JSON.stringify(reports));
    } catch (e) {}
  }

  // Until the cast list lands, attendance still has to work. Seed the creative
  // team plus one row per principal role from the scene breakdown; names get
  // corrected in the dashboard as students are cast.
  function seedRoster() {
    var out = [
      { person_id: 'staff-danielle', name: 'Danielle Sirinsky', role: 'Director / Choreographer', kind: 'staff', sort: 1 },
      { person_id: 'staff-shelby', name: 'Shelby Milgram', role: 'Vocal Director', kind: 'staff', sort: 2 },
      { person_id: 'staff-ryyana', name: 'Ryyana Cunningham', role: 'Assistant Director', kind: 'staff', sort: 3 },
      { person_id: 'staff-colton', name: 'Colton Sorensen', role: 'Technical Director', kind: 'staff', sort: 4 },
      { person_id: 'staff-tony', name: 'Tony Cimino-Johnson', role: 'Intimacy / Study track', kind: 'staff', sort: 5 }
    ];
    (S && S.cast ? S.cast : []).forEach(function (r, i) {
      if (r === 'Company') return;
      out.push({ person_id: 'role-' + r.toLowerCase(), name: '', role: r, kind: 'cast', sort: 10 + i });
    });
    return out;
  }
  function slug(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  }
  function personName(p) { return p.name || (p.role ? '(' + p.role + ' — unnamed)' : '(unnamed)'); }
  function attOf(iso, pid) { return att[iso + '|' + pid] || { status: 'present', note: '' }; }
  function connect() {
    if (!window.supabase || !C.SUPABASE_URL) return Promise.resolve();
    try { sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY); } catch (e) { return Promise.resolve(); }
    return Promise.all([
      sb.rpc('deh_progress_list').then(function (r) {
        if (r.error || !r.data) return null;
        remote = true;
        (r.data || []).forEach(function (x) {
          if (x.done) done[x.block_id] = { by: x.done_by || '', at: x.done_at ? +new Date(x.done_at) : Date.now() };
          else delete done[x.block_id];
        });
      }).catch(function () {}),
      sb.rpc('deh_items_list').then(function (r) {
        if (r.error || !r.data) return null;
        (r.data || []).forEach(function (x) {
          item[x.item_id] = { st: x.status || 'todo', src: x.vendor || '', link: x.link || '',
                              price: x.price_cents || 0, qty: x.qty || 1, by: x.updated_by || '' };
        });
      }).catch(function () {}),
      sb.rpc('deh_roster_list').then(function (r) {
        if (r.error || !r.data || !r.data.length) return null;
        roster = r.data.map(function (x) {
          return { person_id: x.person_id, name: x.name || '', role: x.role || '',
                   kind: x.kind || 'cast', sort: x.sort == null ? 100 : x.sort };
        });
      }).catch(function () {}),
      sb.rpc('deh_reports_list').then(function (r) {
        if (r.error || !r.data) return null;
        (r.data || []).forEach(function (x) {
          reports[x.day] = { at: x.sent_at, by: x.sent_by || '' };
        });
      }).catch(function () {})
    ]).then(function () { saveLocal(); });
  }

  // Attendance and notes are per-day, so they load when a day is opened rather
  // than all at once. Cached after the first fetch.
  function loadDay(iso, then) {
    if (!remote || loadedDays[iso]) { if (then) then(); return; }
    loadedDays[iso] = true;
    Promise.all([
      sb.rpc('deh_attendance_list', { p_day: iso }).then(function (r) {
        if (r.error || !r.data) return;
        (r.data || []).forEach(function (x) {
          att[iso + '|' + x.person_id] = { status: x.status || 'present', note: x.note || '', by: x.updated_by || '' };
        });
      }).catch(function () {}),
      sb.rpc('deh_notes_list', { p_day: iso }).then(function (r) {
        if (r.error || !r.data) return;
        notes = notes.filter(function (n) { return n.day !== iso; })
          .concat((r.data || []).map(function (x) {
            return { note_id: x.note_id, day: iso, dept: x.dept || 'general',
                     body: x.body || '', author: x.author || '', created_at: x.created_at };
          }));
      }).catch(function () {})
    ]).then(function () { saveLocal(); if (then) then(); });
  }
  function pushAttendance(iso, pid) {
    if (!remote) return;
    var a = attOf(iso, pid);
    sb.rpc('deh_attendance_set', { p_day: iso, p_person_id: pid, p_status: a.status,
                                   p_note: a.note || '', p_by: me || '' })
      .catch(function () { setSync('offline — saved on this phone'); });
  }
  function pushNote(n) {
    if (!remote) return;
    sb.rpc('deh_note_add', { p_note_id: n.note_id, p_day: n.day, p_dept: n.dept,
                             p_body: n.body, p_author: n.author || '' })
      .catch(function () { setSync('offline — saved on this phone'); });
  }
  function pushRoster(p) {
    if (!remote) return;
    sb.rpc('deh_roster_set', { p_person_id: p.person_id, p_name: p.name || '', p_role: p.role || '',
                               p_kind: p.kind || 'cast', p_sort: p.sort || 100, p_active: true })
      .catch(function () {});
  }
  function pushBlock(id, isDone, by) {
    if (!remote) return;
    sb.rpc('deh_progress_set', { p_block_id: id, p_done: isDone, p_by: by || '' })
      .catch(function () { setSync('offline — saved on this phone'); });
  }
  function pushItem(id) {
    if (!remote) return;
    var s = item[id] || {};
    sb.rpc('deh_item_set', { p_item_id: id, p_status: s.st || 'todo', p_vendor: s.src || '',
                             p_link: s.link || '', p_price_cents: s.price || 0, p_qty: s.qty || 1,
                             p_by: s.by || me || '' })
      .catch(function () { setSync('offline — saved on this phone'); });
  }
  function setSync(msg) { $('syncNote').textContent = msg; }

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
    roster.forEach(function (p) {
      var k = iso + '|' + p.person_id;
      if (att[k]) { c.taken++; c[att[k].status] = (c[att[k].status] || 0) + 1; }
      else c.present++;
    });
    return c;
  }
  function attendancePanel(d) {
    var iso = d.iso, c = attCounts(iso);
    var inRoom = roster.length - c.absent - c.excused;
    var groups = [['cast', 'Company'], ['crew', 'Crew'], ['staff', 'Creative team']];
    var body = groups.map(function (g) {
      var people = roster.filter(function (p) { return (p.kind || 'cast') === g[0]; })
        .sort(function (x, y) { return (x.sort || 100) - (y.sort || 100); });
      if (!people.length) return '';
      return '<div class="at-grp">' + esc(g[1]) + '</div>' + people.map(function (p) {
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
      '<summary>Attendance <b>' + inRoom + '/' + roster.length + ' in</b>' +
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
  function notesOf(iso) { return notes.filter(function (n) { return n.day === iso; }); }
  function notesPanel(d) {
    var mine = notesOf(d.iso);
    var list = mine.length ? mine.map(function (n) {
      return '<div class="nt"><div class="nt-h"><span class="nt-d">' + esc(deptLabel(n.dept)) + '</span>' +
        (n.author ? '<span class="nt-a">' + esc(n.author) + '</span>' : '') +
        '<button class="nt-x" data-delnote="' + esc(n.note_id) + '" aria-label="Delete note">&times;</button></div>' +
        '<div class="nt-b">' + esc(n.body) + '</div></div>';
    }).join('') : '<p class="nt-none">No notes yet. Anything the report should carry goes here.</p>';
    return '<div class="notes"><h3>Notes for ' + esc(d.date) + '</h3>' + list +
      '<div class="nt-new">' +
      '<select id="ntDept">' + DEPTS.map(function (x) {
        return '<option value="' + x.k + '">' + esc(x.l) + '</option>';
      }).join('') + '</select>' +
      '<textarea id="ntBody" rows="2" placeholder="What happened, what is needed, what to watch"></textarea>' +
      '<button class="btn" id="ntAdd" type="button">Add note</button></div></div>';
  }

  // ---------- end-of-day report ----------
  function reportBar(d) {
    var r = reports[d.iso];
    return '<div class="rep">' +
      (r ? '<div class="rep-sent">Sent to cj@novapa.org' +
            (r.by ? ' by <b>' + esc(r.by) + '</b>' : '') +
            (r.at ? ' &middot; ' + esc(clock(+new Date(r.at))) : '') + '</div>' : '') +
      '<button class="rep-go" id="repSend" type="button">' +
        (r ? 'Send again' : 'Send rehearsal report') + '</button>' +
      '<button class="rep-pv" id="repView" type="button">Preview</button>' +
      '<div class="rep-note" id="repNote"></div></div>';
  }

  function buildReport(d) {
    var t = tasksOf(d), n = doneCount(d);
    var completed = t.filter(function (b) { return done[b.id]; })
      .map(function (b) { return { t: b.t, a: b.a, by: (done[b.id] || {}).by || '' }; });
    var attendance = roster.map(function (p) {
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
      notes: notesOf(d.iso).map(function (x) { return { dept: x.dept, body: x.body, author: x.author || '' }; }),
      completed: completed
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
    L.push('', 'COMPLETED TODAY');
    if (!r.completed.length) L.push('  Nothing checked off.');
    r.completed.forEach(function (b) { L.push('  ' + b.t + '  ' + b.a + (b.by ? ' — ' + b.by : '')); });
    return L.join('\n');
  }
  function sendReport(d) {
    var note = $('repNote'), btn = $('repSend');
    if (!me) { note.textContent = 'Pick your name on any block first, so the report says who filed it.'; return; }
    var r = buildReport(d);
    btn.disabled = true; note.textContent = 'Sending…';
    fetch('/api/deh-report', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(r)
    }).then(function (res) { return res.json().catch(function () { return { ok: res.ok }; }); })
      .then(function (j) {
        btn.disabled = false;
        if (!j || !j.ok) throw new Error((j && j.error) || 'send failed');
        reports[d.iso] = { at: new Date().toISOString(), by: me };
        saveLocal();
        if (remote) {
          sb.rpc('deh_report_log', { p_day: d.iso, p_by: me, p_to: 'cj@novapa.org',
                                     p_summary: { done: r.blocksDone, of: r.blocksTotal } })
            .catch(function () {});
        }
        renderDay();
      })
      .catch(function (e) {
        btn.disabled = false;
        note.innerHTML = 'Could not send &mdash; ' + esc(String(e.message || e)) +
          '. <a href="#" id="repCopy">Copy the report</a> and email it to cj@novapa.org.';
        var c = $('repCopy');
        if (c) c.addEventListener('click', function (ev) {
          ev.preventDefault();
          copyText(reportPlainText(buildReport(d)), note);
        });
      });
  }
  function copyText(txt, noteEl) {
    function done() { if (noteEl) noteEl.textContent = 'Copied. Paste it into an email to cj@novapa.org.'; }
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
    return item[id] || { st: 'todo', src: '', link: '', price: 0, qty: 0, by: '' };
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

  function itemRow(it) {
    var s = st(it.id);
    var q = qtyOf(it);
    var link = safeUrl(s.link);
    return '<div class="it it-' + esc(s.st) + '" data-item="' + esc(it.id) + '">' +
      '<div class="it-h">' +
        '<span class="it-cat it-' + esc(it.cat) + '">' + esc(CATS[it.cat] || it.cat) + '</span>' +
        (it.who ? '<span class="it-who">' + esc(it.who) + '</span>' : '') +
        '<span class="pv pv-' + esc(it.src) + '">' + esc(it.src) + '</span>' +
        '<span class="it-cost">' + money(lineCost(it)) + '</span>' +
      '</div>' +
      '<div class="it-n">' + esc(it.name) + '</div>' +
      (it.note ? '<div class="it-note">' + esc(it.note) + '</div>' : '') +
      '<div class="it-ctl">' +
        '<label>Status<select data-f="st">' + STATES.map(function (x) {
          return '<option value="' + x.k + '"' + (s.st === x.k ? ' selected' : '') + '>' + x.l + '</option>';
        }).join('') + '</select></label>' +
        '<label>Where from<input list="vendorList" data-f="src" value="' + esc(s.src) + '" placeholder="Amazon, in stock, build&hellip;"></label>' +
        '<label>Link<input data-f="link" type="url" inputmode="url" value="' + esc(s.link) + '" placeholder="https://&hellip;"></label>' +
        '<label>Unit price<input data-f="price" type="number" inputmode="decimal" min="0" step="0.01" value="' +
          (s.price ? (s.price / 100).toFixed(2) : '') + '" placeholder="0.00"></label>' +
        '<label>Qty<input data-f="qty" type="number" inputmode="numeric" min="1" step="1" value="' + q + '"></label>' +
      '</div>' +
      (link ? '<a class="it-link" href="' + esc(link) + '" target="_blank" rel="noopener">Open the source &rarr;</a>' : '') +
      (s.by ? '<div class="it-by">Last touched by <b>' + esc(s.by) + '</b></div>' : '') +
    '</div>';
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

    $('sceneDetail').innerHTML =
      '<button class="back" id="scBack">&larr; All scenes</button>' +
      '<div class="eyebrow">' + esc(s.when) + '</div>' +
      '<h1>' + esc(title) + '</h1>' +
      '<p class="sub">' + esc(s.loc) + '</p>' +
      (s.songs && s.songs !== '(none)' ? '<div class="sc-song">' + esc(s.songs) + '</div>' : '') +
      (s.cast && s.cast.length ? '<div class="sc-cast"><span class="mk">Who is in it</span><div>' +
        s.cast.map(function (c) { return '<span class="castpill">' + esc(c) + '</span>'; }).join('') + '</div></div>' : '') +
      (s.tech ? '<div class="gap"><b>Watch</b>' + esc(s.tech) + '</div>' : '') +
      '<div class="sc-total"><span>Scene total</span><b>' + money(cost) + '</b></div>' +
      groups;
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
      var links = list.map(function (it) { return safeUrl(st(it.id).link); }).filter(Boolean);
      return '<div class="ven">' +
        '<div class="ven-h"><b>' + esc(v) + '</b><span>' + list.length + ' item' +
          (list.length === 1 ? '' : 's') + ' &middot; ' + money(sub) + '</span></div>' +
        list.map(function (it) {
          var s = st(it.id), q = qtyOf(it), href = safeUrl(s.link);
          return '<div class="ven-i">' +
            '<button class="ven-tick" data-buytick="' + esc(it.id) + '" ' +
              'aria-label="Mark ' + esc(it.name) + ' arrived">&#10003;</button>' +
            '<div class="ven-t">' + (href
              ? '<a href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(it.name) + '</a>'
              : esc(it.name)) +
              '<span class="ven-s">' + esc(it.scene) + ' &middot; ' + esc(CATS[it.cat] || it.cat) +
              (q > 1 ? ' &middot; &times;' + q : '') + '</span></div>' +
            '<span class="ven-c">' + (s.price ? money(s.price * q) : '<i>no price</i>') + '</span></div>';
        }).join('') +
        (links.length ? '<button class="ven-open" data-openall="' + esc(v) + '" type="button">Open ' +
          links.length + ' link' + (links.length === 1 ? '' : 's') + '</button>' : '') +
        '</div>';
    }).join('');

    $('buy').innerHTML = head +
      '<div class="buy-acts"><button class="btn" id="buyCopy" type="button">Copy the whole list</button>' +
      '<span class="buy-hint">Tick an item when it arrives.</span></div>' + body;
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
        L.push('  - ' + it.name + (q > 1 ? ' x' + q : '') + '  ' +
               (s.price ? money(s.price * q) : 'no price') +
               '   [' + it.scene + ' / ' + (CATS[it.cat] || it.cat) + ']' +
               (safeUrl(s.link) ? '\n      ' + s.link : ''));
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

  function renderAll() { renderSchedule(); renderScenes(); renderBudget(); renderBuy(); }

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
        var id = kind + '-' + slug(nm) + '-' + (roster.length + 1);
        var p = { person_id: id, name: nm, role: '', kind: kind, sort: 100 + roster.length };
        roster.push(p); saveLocal(); pushRoster(p); renderDay();
        return;
      }
      if (e.target.id === 'ntAdd') {
        var body = ($('ntBody').value || '').trim();
        if (!body) return;
        var n = { note_id: d.iso + '|' + Date.now() + '|' + Math.floor(Math.random() * 1e4),
                  day: d.iso, dept: $('ntDept').value || 'general', body: body,
                  author: me || '', created_at: new Date().toISOString() };
        notes.push(n); saveLocal(); pushNote(n); renderDay();
        return;
      }
      var dn = e.target.closest('[data-delnote]');
      if (dn) {
        var nid = dn.dataset.delnote;
        notes = notes.filter(function (x) { return x.note_id !== nid; });
        saveLocal();
        if (remote) sb.rpc('deh_note_delete', { p_note_id: nid }).catch(function () {});
        renderDay();
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
          if (s.st === 'done' || s.st === 'arrived') return;
          if (((s.src || '').trim() || 'Not sourced yet') !== v) return;
          var u = safeUrl(s.link);
          if (u) window.open(u, '_blank', 'noopener');
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
      if (e.target.id === 'scBack') {
        $('v-scene1').classList.remove('on');
        $('v-scenes').classList.add('on');
        openScene = null;
        renderScenes();
        window.scrollTo({ top: 0 });
      }
    });
    function onEdit(e) {
      var f = e.target.dataset && e.target.dataset.f;
      if (!f) return;
      var box = e.target.closest('[data-item]');
      if (!box) return;
      var id = box.dataset.item;
      var s = item[id] || { st: 'todo', src: '', link: '', price: 0, qty: 0, by: '' };
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
      item[id] = s;
      saveLocal(); pushItem(id);
      // repaint totals without losing the field the user is typing in
      var active = document.activeElement;
      if (f === 'st') { renderSceneDetail(openScene); renderBudget(); return; }
      var it = S.allItems.filter(function (x) { return x.id === id; })[0];
      if (it) {
        var cell = box.querySelector('.it-cost');
        if (cell) cell.textContent = money(lineCost(it));
      }
      // Show or drop the source link as soon as it is entered, in place —
      // a full re-render here would steal the caret mid-edit.
      if (f === 'link') {
        var url = safeUrl(s.link);
        var a2 = box.querySelector('.it-link');
        if (url && !a2) {
          a2 = document.createElement('a');
          a2.className = 'it-link'; a2.target = '_blank'; a2.rel = 'noopener';
          a2.textContent = 'Open the source \u2192';
          box.appendChild(a2);
        }
        if (a2) {
          if (url) a2.setAttribute('href', url);
          else a2.remove();
        }
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

    document.querySelectorAll('.navbtn').forEach(function (b) {
      b.addEventListener('click', function () { showView(b.dataset.v); });
    });

    connect().then(function () {
      setSync(remote ? 'Shared with the whole team' : 'Saved on this phone');
      renderAll();
      loadDay(D.days[cur].iso, renderDay);
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
