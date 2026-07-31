/* Dear Evan Hansen staff rehearsal dashboard.
   Built from DEH_Rehearsal_Schedule_Aug3-14_2026_v2.xlsx. The schedule data is
   generated into deh/data.js — do not hand-edit that file, re-run the build.

   Check-offs sync through Supabase when db/deh-progress.sql has been run;
   until then everything still works and lives in localStorage on the phone
   that tapped it. Either way the UI is identical, so nobody has to know which
   mode they are in. */
(function () {
  var D = window.DEH;
  var C = window.NOVAREG || {};
  var LS_DONE = 'deh.done.v1', LS_ME = 'deh.me.v1', LS_GATE = 'deh.gate.v1';
  var GATE_WORD = 'orchard';   // curtain, not a lock — change here and tell staff

  var done = {};               // id -> { by, at }
  var me = localStorage.getItem(LS_ME) || '';
  var sb = null, remote = false;

  var TRACKS = {
    'STAGE': 'stage', 'STAGE (CLOSED)': 'stage', 'STAGE+MUSIC': 'stage',
    'SPACING': 'stage', 'RUN': 'stage', 'REVIEW': 'stage', 'WORK': 'stage',
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

  function $(id) { return document.getElementById(id); }
  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function clock(ts) {
    var d = new Date(ts);
    var h = d.getHours(), m = d.getMinutes();
    return ((h % 12) || 12) + ':' + (m < 10 ? '0' : '') + m + (h < 12 ? 'am' : 'pm');
  }

  // ---------- storage ----------
  function loadLocal() {
    try { done = JSON.parse(localStorage.getItem(LS_DONE) || '{}'); } catch (e) { done = {}; }
  }
  function saveLocal() {
    try { localStorage.setItem(LS_DONE, JSON.stringify(done)); } catch (e) {}
  }
  function connect() {
    if (!window.supabase || !C.SUPABASE_URL) return Promise.resolve();
    try { sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY); } catch (e) { return Promise.resolve(); }
    return sb.rpc('deh_progress_list').then(function (res) {
      if (res.error || !res.data) return;             // table not created yet
      remote = true;
      (res.data || []).forEach(function (r) {
        if (r.done) done[r.block_id] = { by: r.done_by || '', at: r.done_at ? +new Date(r.done_at) : Date.now() };
        else delete done[r.block_id];
      });
      saveLocal();
    }).catch(function () {});
  }
  function push(id, isDone, by) {
    if (!remote) return;
    sb.rpc('deh_progress_set', { p_block_id: id, p_done: isDone, p_by: by || '' })
      .catch(function () { setSync('offline — saved on this phone'); });
  }
  function setSync(msg) { $('syncNote').textContent = msg; }

  // ---------- progress ----------
  function tasksOf(day) { return day.blocks.filter(isTask); }
  function doneCount(day) { return tasksOf(day).filter(function (b) { return done[b.id]; }).length; }
  function allTasks() { return D.days.reduce(function (a, d) { return a.concat(tasksOf(d)); }, []); }

  function renderTopProgress() {
    var all = allTasks(), n = all.filter(function (b) { return done[b.id]; }).length;
    var pct = all.length ? Math.round(n / all.length * 100) : 0;
    $('showFill').style.width = pct + '%';
    $('showPct').textContent = pct + '%';
    $('showCount').textContent = n + ' of ' + all.length + ' blocks complete';
    // days fully done, for the one-line status
    var fin = D.days.filter(function (d) { return tasksOf(d).length && doneCount(d) === tasksOf(d).length; }).length;
    $('showDays').textContent = fin + ' of ' + D.days.length + ' days finished';
  }

  // ---------- day chips ----------
  var cur = 0;
  function renderChips() {
    $('dayChips').innerHTML = D.days.map(function (d, i) {
      var t = tasksOf(d).length, n = doneCount(d);
      var pct = t ? Math.round(n / t * 100) : 0;
      return '<button class="chip' + (i === cur ? ' sel' : '') + (pct === 100 ? ' full' : '') + '" data-i="' + i + '">' +
        '<span class="chip-d">' + esc(d.date) + '</span>' +
        '<span class="chip-p">' + pct + '%</span></button>';
    }).join('');
    var sel = $('dayChips').querySelector('.chip.sel');
    if (sel) sel.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  // ---------- one day ----------
  function renderDay() {
    var d = D.days[cur], t = tasksOf(d).length, n = doneCount(d);
    var pct = t ? Math.round(n / t * 100) : 0;
    var cov = D.coverage[d.date] || {};

    var head =
      '<div class="dayhead">' +
        '<div class="dayhead-top"><h2>' + esc(d.date) + '<span class="daycode">' + esc(d.code) + '</span></h2>' +
        '<span class="daypct">' + n + '/' + t + '</span></div>' +
        '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
      '</div>';

    var staff = [['Danielle', cov.danielle], ['Shelby', cov.shelby], ['Ryanna', cov.ryanna],
                 ['Colton', cov.colton], ['Tony', cov.tony]]
      .filter(function (p) { return p[1]; })
      .map(function (p) {
        var out = /out of town/i.test(p[1]);
        return '<span class="who' + (out ? ' out' : '') + '"><b>' + esc(p[0]) + '</b> ' + esc(p[1]) + '</span>';
      }).join('');
    var gap = cov.gap ? '<div class="gap"><b>Watch today</b>' + esc(cov.gap) + '</div>' : '';
    var coverage = '<details class="cov"><summary>Who is in today</summary>' +
      '<div class="whos">' + staff + '</div>' + gap + '</details>';

    var blocks = d.blocks.map(function (b) {
      if (!isTask(b)) {
        return '<div class="rest"><span>' + esc(b.t) + '</span><span>' + esc(b.a) + '</span></div>';
      }
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
          '" aria-label="' + (st ? 'Mark not done' : 'Mark done') + '">' + (st ? '&#10003;' : '') + '</button>' +
        '<div class="blk-bd">' +
          '<div class="blk-top"><span class="time">' + esc(b.t) + '</span>' +
            '<span class="tag">' + esc(b.k) + '</span></div>' +
          '<div class="act">' + esc(b.a) + '</div>' +
          '<div class="meta">' + meta + '</div>' +
          (st ? '<div class="stamp">Done by <b>' + esc(st.by || 'staff') + '</b>' +
                (st.at ? ' &middot; ' + esc(clock(st.at)) : '') + '</div>' : '') +
        '</div></div>';
    }).join('');

    $('day').innerHTML = head + coverage + blocks;
  }

  function render() { renderTopProgress(); renderChips(); renderDay(); }

  // ---------- reference tabs ----------
  function renderRef() {
    $('refScenes').innerHTML = D.scenes.map(function (s) {
      return '<div class="sc"><div class="sc-h"><b>Act ' + esc(s.act) + ' Sc ' + esc(s.sc) + '</b>' +
        '<span class="sc-when">' + esc(s.when) + '</span></div>' +
        (s.songs && s.songs !== '(none)' ? '<div class="sc-song">' + esc(s.songs) + '</div>' : '') +
        '<div class="sc-l"><span>Where</span>' + esc(s.loc) + '</div>' +
        '<div class="sc-l"><span>Who</span>' + esc(s.chars) + '</div>' +
        '<div class="sc-l tech"><span>Watch</span>' + esc(s.tech) + '</div></div>';
    }).join('');

    $('refCrews').innerHTML = D.rhythm.map(function (r) {
      if (!r.v) return '<h3>' + esc(r.k) + '</h3>';
      return '<div class="kv"><span class="kv-k">' + esc(r.k) + '</span><span class="kv-v">' + esc(r.v) + '</span></div>';
    }).join('');

    $('refFlags').innerHTML = D.flags.map(function (f) {
      return '<div class="flag"><div class="flag-h"><span class="flag-t">' + esc(f.type) + '</span>' + esc(f.issue) + '</div>' +
        '<div class="sc-l"><span>Handled</span>' + esc(f.did) + '</div>' +
        (f.need && f.need !== 'None.' ? '<div class="sc-l need"><span>You</span>' + esc(f.need) + '</div>' : '') +
        '</div>';
    }).join('');
  }

  // ---------- name ----------
  function setMe(v) {
    me = (v || '').trim().slice(0, 40);
    localStorage.setItem(LS_ME, me);
    $('meName').value = me;
  }

  // ---------- events ----------
  function toggle(id) {
    if (!me) { $('meName').focus(); setSync('Add your name first so check-offs are signed.'); return; }
    if (done[id]) { delete done[id]; push(id, false, me); }
    else { done[id] = { by: me, at: Date.now() }; push(id, true, me); }
    saveLocal(); render();
  }

  function boot() {
    loadLocal();
    setMe(me);
    renderRef();
    render();

    // land on today when the camp is running, otherwise day 1
    var today = new Date().toISOString().slice(0, 10);
    D.days.forEach(function (d, i) { if (d.iso === today) cur = i; });
    render();

    $('dayChips').addEventListener('click', function (e) {
      var b = e.target.closest('.chip');
      if (!b) return;
      cur = +b.dataset.i; render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    $('day').addEventListener('click', function (e) {
      var t = e.target.closest('[data-tick]');
      if (t) { toggle(t.dataset.tick); return; }
      var blk = e.target.closest('.blk');
      if (blk) blk.classList.toggle('open');
    });
    $('meName').addEventListener('change', function () { setMe(this.value); setSync(''); });
    $('meName').addEventListener('blur', function () { setMe(this.value); });

    document.querySelectorAll('.navbtn').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('.navbtn').forEach(function (x) { x.classList.remove('sel'); });
        document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('on'); });
        b.classList.add('sel');
        $('v-' + b.dataset.v).classList.add('on');
        window.scrollTo({ top: 0 });
      });
    });

    connect().then(function () {
      setSync(remote ? 'Shared with the whole team' : 'Saved on this phone');
      render();
    });
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
