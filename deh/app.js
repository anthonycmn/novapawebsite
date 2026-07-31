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
  var GATE_WORD = 'orchard';   // curtain, not a lock — change here and tell staff

  // Who can sign a block off. Anyone not listed picks "Someone else" and types.
  var STAFF = ['Danielle', 'Shelby', 'Ryanna', 'Colton', 'Tony', 'Stage Manager'];

  var done = {}, item = {};
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
  }
  function saveLocal() {
    try {
      localStorage.setItem(LS_DONE, JSON.stringify(done));
      localStorage.setItem(LS_ITEM, JSON.stringify(item));
    } catch (e) {}
  }
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
      }).catch(function () {})
    ]).then(function () { saveLocal(); });
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

    var staff = [['Danielle', cov.danielle], ['Shelby', cov.shelby], ['Ryanna', cov.ryanna],
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

    $('day').innerHTML = head + coverage + blocks;
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

  function renderAll() { renderSchedule(); renderScenes(); renderBudget(); }

  // ---------- reference tabs ----------
  function renderRef() {
    $('refCrews').innerHTML = D.rhythm.map(function (r) {
      if (!r.v) return '<h3>' + esc(r.k) + '</h3>';
      return '<div class="kv"><span class="kv-k">' + esc(r.k) + '</span><span class="kv-v">' + esc(r.v) + '</span></div>';
    }).join('') +
      '<h3>Still to confirm</h3>' +
      D.flags.map(function (f) {
        return '<div class="flag"><div class="flag-h"><span class="flag-t">' + esc(f.type) + '</span>' +
          esc(f.issue) + '</div>' +
          '<div class="sc-l need"><span>Next</span>' + esc(f.need) + '</div></div>';
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
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    $('day').addEventListener('click', function (e) {
      var t = e.target.closest('[data-tick]');
      if (t) {
        var id = t.dataset.tick;
        if (done[id]) clearDone(id); else openWho(id, t);
        return;
      }
      var blk = e.target.closest('.blk');
      if (blk) blk.classList.toggle('open');
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
    });
  }

  function showView(v) {
    document.body.classList.toggle('on-day', v === 'day');
    document.querySelectorAll('.navbtn').forEach(function (x) { x.classList.toggle('sel', x.dataset.v === v); });
    document.querySelectorAll('.view').forEach(function (x) { x.classList.remove('on'); });
    $('v-' + v).classList.add('on');
    if (v === 'scenes') { openScene = null; renderScenes(); }
    if (v === 'budget') renderBudget();
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
