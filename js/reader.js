/* EPUB кітапты платформаның ішінде оқу.
   - Кітап файлы бір рет жүктеліп, телефонның жадында (Cache) сақталады: байланыс үзілсе де оқуға болады.
   - Оқыған жер және әріп өлшемі телефонда сақталады: келесі жолы сол беттен ашылады.
   - Кітапты ашу және «Оқып бітірдім» оқиғалары серверге кезекпен жіберіледі. */
(function () {
  'use strict';

  var LS = API.LS;
  var esc = UI.esc;
  // Кітап файлы өзгергенде нұсқаны көтереміз: телефондағы ескі көшірме жойылып, жаңасы жүктеледі
  var CACHE_NAME = 'kb-books-v2';
  try { caches.delete('kb-books-v1'); } catch (e) { /* елемейміз */ }
  var FONT_MIN = 90, FONT_MAX = 200, FONT_STEP = 10;

  function $(id) { return document.getElementById(id); }

  var user = LS.get('kb_user');
  if (!user) { location.replace('index.html'); return; }
  Icons.hydrate(document);

  var bookId = new URLSearchParams(location.search).get('id') || '';
  var state = { book: null, rendition: null, meta: null, atEnd: false, toc: [] };
  if (location.hostname === 'localhost') window.__kbReader = state; // тек жергілікті тексеру үшін

  /* ---------- Хабарламалар ---------- */
  function status(text, opts) {
    opts = opts || {};
    var box = $('r-status');
    box.hidden = false;
    box.className = 'reader-status' + (opts.error ? ' is-error' : '');
    box.innerHTML = (opts.error ? Icons.svg('alert') : '<span class="spin" aria-hidden="true"></span>') +
      '<p>' + esc(text) + '</p>' + (opts.html || '');
  }
  function hideStatus() { $('r-status').hidden = true; }

  /* ---------- Кітап мәліметі ---------- */
  async function findBook() {
    var cfg = (LS.get('kb_config') || {}).data;
    var list = cfg && cfg.books;
    if (!list) {
      try { list = (await (await fetch('data.json', { cache: 'no-cache' })).json()).books; } catch (e) { list = []; }
    }
    var b = (list || []).filter(function (x) { return x.bookId === bookId; })[0];
    if (!b && API.configured()) {
      var r = await API.get('getConfig', {}, { silent: true, retries: 2 });
      if (r && r.ok) {
        LS.set('kb_config', { data: r.config, savedAt: Date.now() });
        b = (r.config.books || []).filter(function (x) { return x.bookId === bookId; })[0];
      }
    }
    return b || null;
  }

  function isEpub(url) { return /\.epub(\?|#|$)/i.test(url || ''); }

  /* ---------- Файлды жүктеу (жадта болса, сол жерден) ---------- */
  async function loadFile(url) {
    var abs = new URL(url, location.href).href;
    var cache = null;
    try { cache = await caches.open(CACHE_NAME); } catch (e) { cache = null; }
    if (cache) {
      var hit = await cache.match(abs);
      if (hit) return hit.arrayBuffer();
    }
    var lastErr;
    for (var attempt = 0; attempt < 4; attempt++) {
      try {
        var res = await fetch(abs, { cache: 'no-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var total = Number(res.headers.get('Content-Length')) || 0;
        var buf;
        if (res.body && res.body.getReader && total) {
          var reader = res.body.getReader(), got = 0, chunks = [];
          while (true) {
            var step = await reader.read();
            if (step.done) break;
            chunks.push(step.value); got += step.value.length;
            status('Кітап жүктеліп жатыр… ' + Math.min(99, Math.round(got / total * 100)) + '%');
          }
          var all = new Uint8Array(got), pos = 0;
          chunks.forEach(function (c) { all.set(c, pos); pos += c.length; });
          buf = all.buffer;
        } else {
          buf = await res.arrayBuffer();
        }
        if (cache) { try { await cache.put(abs, new Response(buf.slice(0), { headers: { 'Content-Type': 'application/epub+zip' } })); } catch (e) { /* жад толы */ } }
        return buf;
      } catch (e) {
        lastErr = e;
        status('Байланыс әлсіз, қайта байқап жатырмыз…');
        await new Promise(function (r) { setTimeout(r, 1500 * Math.pow(2, attempt)); });
      }
    }
    throw lastErr || new Error('load failed');
  }

  /* ---------- Оқу барысы ---------- */
  function keyPos() { return 'kb_pos_' + bookId; }
  function keyLoc() { return 'kb_loc_' + bookId; }
  function fontSize() { return Math.max(FONT_MIN, Math.min(FONT_MAX, LS.get('kb_font', 110))); }

  function markOpened() {
    var u = LS.get('kb_user');
    if (!u || u.bookOpenedAt) return;
    u.bookOpenedAt = Date.now();
    u.bookId = bookId;
    LS.set('kb_user', u);
    API.Queue.push('book_opened', bookId);
  }

  function updateProgress(loc) {
    var pct = 0;
    var b = state.book;
    if (b && b.locations && b.locations.length() && loc && loc.start) {
      pct = Math.round(b.locations.percentageFromCfi(loc.start.cfi) * 100);
    }
    if (loc && loc.atEnd) pct = 100;
    var ready = b && b.locations && b.locations.length();
    $('r-bar').style.width = pct + '%';
    $('r-mini').style.width = pct + '%';
    // Пайыз беттер картасы дайын болғанда ғана көрсетіледі (үлкен кітапта бірнеше секунд)
    $('r-pct').textContent = ready || (loc && loc.atEnd) ? pct + '%' : '…';
    state.atEnd = !!(loc && loc.atEnd) || pct >= 98;
    var u = LS.get('kb_user') || {};
    $('r-finish').hidden = !state.atEnd || !!u.readFinishedAt;
    $('r-prev').disabled = !!(loc && loc.atStart);
    $('r-next').disabled = !!(loc && loc.atEnd);
  }

  function chapterTitle(href) {
    if (!href) return '';
    var base = href.split('#')[0];
    var hit = '';
    (function walk(items) {
      (items || []).forEach(function (it) {
        if (!hit && it.href && it.href.split('#')[0].split('/').pop() === base.split('/').pop()) hit = (it.label || '').trim();
        walk(it.subitems);
      });
    })(state.toc);
    return hit;
  }

  /* ---------- Оқып бітірдім ---------- */
  async function finish() {
    var yes = await UI.modal({
      icon: 'book', tone: 'accent', title: 'Шынымен оқып бітірдіңіз бе?', text: 'Растасаңыз, тестке өте аласыз.',
      buttons: [
        { label: 'Иә, оқып бітірдім', value: true, icon: 'check' },
        { label: 'Жоқ, әлі оқып жатырмын', value: false, kind: 'btn-ghost', icon: 'arrowleft' }
      ]
    });
    if (!yes) return;
    var u = LS.get('kb_user');
    var now = Date.now();
    if (!u.bookOpenedAt) u.bookOpenedAt = now;
    u.readFinishedAt = now;
    u.bookId = bookId;
    LS.set('kb_user', u);
    API.Queue.push('read_finished', bookId);
    $('r-finish').hidden = true;
    var go = await UI.modal({
      icon: 'check', tone: 'ok', title: 'Жарайсыз!', text: 'Кітапты оқып бітіргеніңіз белгіленді.',
      buttons: [
        { label: 'Тестке өту', value: 'test', icon: 'test' },
        { label: 'Оқуды жалғастыру', value: 'stay', kind: 'btn-ghost', icon: 'book' }
      ]
    });
    if (go === 'test') location.href = 'test.html';
  }

  /* ---------- Ашу ---------- */
  async function open() {
    status('Кітап жүктеліп жатыр…');
    var meta = await findBook();
    state.meta = meta;
    $('r-back').href = 'book.html' + (bookId ? '?id=' + encodeURIComponent(bookId) : '');
    if (!meta) {
      status('Кітап табылмады.', { error: true, html: '<a class="btn btn-primary" href="book.html">' + Icons.svg('book') + '<span>Кітаптар тізіміне</span></a>' });
      return;
    }
    $('r-title').textContent = meta.title;
    document.title = meta.title + ' · Оқу';
    if (!isEpub(meta.url)) {
      status('Бұл кітап жаңа бетте ашылады.', {
        error: true,
        html: /^https?:\/\//i.test(meta.url || '') ? '<a class="btn btn-primary" href="' + esc(meta.url) + '" target="_blank" rel="noopener">' + Icons.svg('external') + '<span>Кітапты ашу</span></a>' : ''
      });
      return;
    }
    if (typeof ePub === 'undefined' || typeof JSZip === 'undefined') {
      status('Оқу құралы жүктелмеді. Интернетті тексеріп, бетті жаңартыңыз.', {
        error: true, html: '<button type="button" class="btn btn-primary" onclick="location.reload()">' + Icons.svg('refresh') + '<span>Қайта байқау</span></button>'
      });
      return;
    }

    var buf;
    try { buf = await loadFile(meta.url); } catch (e) {
      status('Кітап жүктелмеді. Байланысты тексеріп, қайта байқаңыз.', {
        error: true, html: '<button type="button" class="btn btn-primary" onclick="location.reload()">' + Icons.svg('refresh') + '<span>Қайта байқау</span></button>'
      });
      return;
    }

    status('Кітап ашылып жатыр…');
    var book = ePub(buf);
    state.book = book;
    var rendition = book.renderTo('r-viewer', {
      width: '100%', height: '100%', flow: 'paginated', spread: 'none', allowScriptedContent: false
    });
    state.rendition = rendition;

    rendition.themes.default({
      'html, body': { 'background': '#FFFFFF !important' },
      'body': {
        'font-family': "'Inter', sans-serif !important",
        'color': '#0B1E3E !important',
        'line-height': '1.65 !important',
        'padding': '0 6px !important'
      },
      'p, li, div, span': { 'font-family': "'Inter', sans-serif !important", 'line-height': '1.65 !important' },
      'img': { 'max-width': '100% !important', 'height': 'auto !important' },
      'a': { 'color': '#1A3566 !important' }
    });
    rendition.themes.fontSize(fontSize() + '%');

    // Әр бетке Inter қарпін қосамыз және саусақпен сырғытуды қосамыз
    rendition.hooks.content.register(function (contents) {
      var doc = contents.document;
      var link = doc.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap';
      doc.head.appendChild(link);
      bindDrag(doc);
      protect(doc);
      doc.addEventListener('keydown', onKey);
    });

    // Беттің сол жағын басса — артқа, оң жағын басса — алға
    rendition.on('click', function (e) {
      if (Date.now() - lastDragAt < 400) return; // саусақпен аударғаннан кейінгі басуды елемейміз
      var sel = e.view && e.view.getSelection && e.view.getSelection();
      if (sel && String(sel).length) return;
      var w = e.view ? e.view.innerWidth : window.innerWidth;
      var x = e.clientX % w;
      if (x < w * 0.3) turn(-1);
      else if (x > w * 0.7) turn(1);
    });

    var shown = false;
    function onShown() {
      if (shown) return;
      shown = true;
      hideStatus();
      markOpened();
      setTimeout(startFocusMode, 500);
    }
    rendition.on('rendered', onShown);
    rendition.on('relocated', function (loc) {
      onShown();
      // Оқиғадағы орын кейде ескі болады (артқа аударғанда) — нақты орынды беттің күйінен аламыз
      var cur = null;
      try { cur = rendition.currentLocation(); } catch (e) { cur = null; }
      if (!cur || !cur.start || !cur.start.cfi) cur = loc;
      state.loc = cur;
      LS.set(keyPos(), cur.start.cfi);
      $('r-chapter').textContent = chapterTitle(cur.start.href);
      updateProgress(cur);
    });

    // Сақталған орыннан ашамыз. epub.js кейде уәдесін (promise) аяқтамай қалады,
    // сондықтан бет шыққанын жоғарыдағы оқиғалар арқылы білеміз.
    var saved = LS.get(keyPos());
    rendition.display(saved || undefined).catch(function () {
      LS.del(keyPos());
      return rendition.display();
    });
    setTimeout(function () {
      if (shown) return;
      LS.del(keyPos());
      rendition.display().then(onShown, onShown);
    }, 12000);

    book.loaded.navigation.then(function (nav) { state.toc = nav.toc || []; }).catch(function () {});

    // Пайыз есептеу үшін беттер картасы (бір рет жасалып, сақталады)
    book.ready.then(function () {
      var saved = LS.get(keyLoc());
      if (saved) { try { book.locations.load(saved); } catch (e) { saved = null; } }
      if (saved) return;
      return book.locations.generate(1200).then(function () {
        try { LS.set(keyLoc(), book.locations.save()); } catch (e) { /* жад толы */ }
      });
    }).then(function () {
      var cur = rendition.currentLocation();
      if (cur && cur.start) updateProgress(cur);
    }).catch(function () {});
  }

  /* ==========================================================
     Парақ аудару: «Артқа» / «Алға» батырмалары, беттің шетін басу,
     саусақпен солға немесе оңға сырғыту. Бет анимациясыз бірден ауысады.
     ========================================================== */
  var turning = false;
  var lastDragAt = 0;

  // epub.js кейде уәдесін аяқтамайды — сондықтан ең көбі 1.5 секунд күтеміз
  function settle(p) {
    return Promise.race([Promise.resolve(p).catch(function () {}), new Promise(function (r) { setTimeout(r, 1500); })]);
  }
  function call(dir) {
    var r = state.rendition;
    try { return dir > 0 ? r.next() : r.prev(); } catch (e) { return null; }
  }

  /* epub.js «relocated» оқиғасы кейде шықпай қалады (әсіресе артқа аударғанда).
     Сондықтан әр аударудан кейін оқыған орынды беттің нақты күйінен өзіміз есептеп сақтаймыз. */
  function syncLocation() {
    var r = state.rendition;
    if (!r) return;
    var loc;
    try { loc = r.currentLocation(); } catch (e) { loc = null; }
    if (!loc || !loc.start || !loc.start.cfi) return;
    state.loc = loc;
    LS.set(keyPos(), loc.start.cfi);
    $('r-chapter').textContent = chapterTitle(loc.start.href);
    updateProgress(loc);
  }
  var syncTimers = [];
  function syncSoon() {
    syncTimers.forEach(clearTimeout);
    syncLocation();
    syncTimers = [setTimeout(syncLocation, 350), setTimeout(syncLocation, 900)];
  }

  function canGo(dir) {
    var loc = state.loc;
    if (!loc) return true;
    return dir > 0 ? !loc.atEnd : !loc.atStart;
  }

  async function turn(dir) {
    if (!state.rendition || turning || !canGo(dir)) return;
    turning = true;
    await settle(call(dir));
    syncSoon();
    setTimeout(function () { turning = false; }, 150);
  }

  /* Саусақпен сырғыту: солға — алға, оңға — артқа.
     Көлденең сырғытқанда браузердің өз қимылы бөгеледі, сондықтан сырғыту үзілмейді. */
  function bindDrag(doc) {
    try { doc.documentElement.style.touchAction = 'pan-y pinch-zoom'; } catch (e) { /* елемейміз */ }
    var d = null;
    doc.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { d = null; return; }
      d = { x: e.touches[0].clientX, y: e.touches[0].clientY, horiz: false };
    }, { passive: true });
    doc.addEventListener('touchmove', function (e) {
      if (!d || e.touches.length !== 1) return;
      var dx = e.touches[0].clientX - d.x, dy = e.touches[0].clientY - d.y;
      if (!d.horiz && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) d.horiz = true;
      if (d.horiz && e.cancelable) e.preventDefault();
    }, { passive: false });
    doc.addEventListener('touchend', function (e) {
      if (!d) return;
      var t = e.changedTouches && e.changedTouches[0];
      var dx = t ? t.clientX - d.x : 0;
      var horiz = d.horiz;
      d = null;
      if (horiz && Math.abs(dx) > 40) { lastDragAt = Date.now(); turn(dx < 0 ? 1 : -1); }
    }, { passive: true });
    doc.addEventListener('touchcancel', function () { d = null; }, { passive: true });
  }

  /* ==========================================================
     Тек кітап: таза режим және толық экран
     - Таза режим: жоғарғы және төменгі жолақтар жасырылады, беттің ортасын басса қайта шығады.
     - Толық экран: браузердің мекенжай және вкладкалар жолағы жасырылады (Android, компьютер).
       iPhone Safari беттің толық экранына рұқсат бермейді — онда «Басты экранға қосу» көмектеседі.
     ========================================================== */
  var root = document.documentElement;
  var fsSupported = !!(root.requestFullscreen || root.webkitRequestFullscreen) &&
    (document.fullscreenEnabled !== false && document.webkitFullscreenEnabled !== false);
  function isFullscreen() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function enterFullscreen() {
    try {
      var p = root.requestFullscreen ? root.requestFullscreen({ navigationUI: 'hide' }) : root.webkitRequestFullscreen();
      if (p && p.catch) p.catch(function () { /* браузер рұқсат бермеді */ });
    } catch (e) { /* елемейміз */ }
  }
  function exitFullscreen() {
    try {
      var p = document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen();
      if (p && p.catch) p.catch(function () {});
    } catch (e) { /* елемейміз */ }
  }
  function syncFullButton() {
    var b = $('r-full');
    if (!fsSupported) { b.hidden = true; return; }
    b.hidden = false;
    var on = isFullscreen();
    b.innerHTML = Icons.svg(on ? 'minimize' : 'maximize');
    b.setAttribute('aria-label', on ? 'Толық экраннан шығу' : 'Толық экранда оқу');
  }
  document.addEventListener('fullscreenchange', syncFullButton);
  document.addEventListener('webkitfullscreenchange', syncFullButton);

  async function startFocusMode() {
    syncFullButton();
    // Бір рет қана ұсынамыз: толық экранға тек адамның өз басуымен кіруге болады
    var asked = false;
    try { asked = sessionStorage.getItem('kb_fs_asked') === '1'; sessionStorage.setItem('kb_fs_asked', '1'); } catch (e) { /* елемейміз */ }
    if (fsSupported && !isFullscreen() && !asked) {
      var go = await UI.modal({
        icon: 'maximize', tone: 'accent', title: 'Кітапты толық экранда оқисыз ба?',
        text: 'Браузердің жоғарғы жолағы жасырылады, экранда тек кітап пен батырмалар қалады.',
        buttons: [
          { label: 'Толық экранда оқу', value: true, icon: 'maximize' },
          { label: 'Жоқ, осылай оқимын', value: false, kind: 'btn-ghost', icon: 'book' }
        ]
      });
      if (go) enterFullscreen();
    }
  }

  /* Саусақпен (немесе тінтуірмен) тартып аудару. Оқиғалар кітап мәтінінің ішінен келеді. */
  /* ==========================================================
     Кітапты көшіруден қорғау
     Веб-сайт телефонның өз скриншотын толық бөгей алмайды. Сондықтан:
     - мәтінді белгілеу, көшіру, ұзақ басып мәзір ашу, сүйреп алу, басып шығару және сақтау бөгеледі;
     - басқа қосымшаға өткенде немесе скриншот пернесі (PrintScreen) басылғанда кітап бұлдырланады.
     ========================================================== */
  var shieldTimer;
  function shield(on, ms) {
    clearTimeout(shieldTimer);
    document.body.classList.toggle('shielded', !!on);
    if (on && ms) shieldTimer = setTimeout(function () { document.body.classList.remove('shielded'); }, ms);
  }

  function blockEvent(e) { e.preventDefault(); return false; }
  function guardKeys(e) {
    var k = (e.key || '').toLowerCase();
    if (k === 'printscreen') {
      shield(true, 2000);
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          var w = navigator.clipboard.writeText('');
          if (w && w.catch) w.catch(function () { /* бет белсенді болмаса, браузер рұқсат бермейді */ });
        }
      } catch (err) { /* елемейміз */ }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (k === 'c' || k === 'x' || k === 'a' || k === 's' || k === 'p' || k === 'u')) {
      e.preventDefault();
    }
  }

  function protect(doc) {
    try {
      var st = doc.createElement('style');
      st.textContent = 'html,body,*{-webkit-user-select:none!important;user-select:none!important;-webkit-touch-callout:none!important}' +
        'img,svg,image{pointer-events:none!important;-webkit-user-drag:none!important}';
      doc.head.appendChild(st);
    } catch (e) { /* елемейміз */ }
    ['copy', 'cut', 'contextmenu', 'selectstart', 'dragstart'].forEach(function (t) { doc.addEventListener(t, blockEvent); });
    doc.addEventListener('keydown', guardKeys);
    doc.addEventListener('keyup', guardKeys);
  }

  // Негізгі беттің өзі де қорғалады
  ['copy', 'cut', 'contextmenu', 'selectstart', 'dragstart'].forEach(function (t) { document.addEventListener(t, blockEvent); });
  document.addEventListener('keydown', guardKeys);
  document.addEventListener('keyup', guardKeys);
  // Басқа қосымшаға өткенде (телефонның «соңғы қосымшалар» экранында) кітап көрінбейді
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) shield(true); else setTimeout(function () { shield(false); }, 250);
  });
  window.addEventListener('pagehide', function () { shield(true); });
  window.addEventListener('pageshow', function () { shield(false); }); // «Артқа» арқылы қайта ашылғанда
  window.addEventListener('beforeprint', function () { shield(true); });
  window.addEventListener('afterprint', function () { shield(false); });

  function onKey(e) {
    if (e.key === 'ArrowRight' || e.key === 'PageDown') turn(1);
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') turn(-1);
  }

  function setFont(delta) {
    var size = Math.max(FONT_MIN, Math.min(FONT_MAX, fontSize() + delta));
    LS.set('kb_font', size);
    if (state.rendition) state.rendition.themes.fontSize(size + '%');
    $('r-smaller').disabled = size <= FONT_MIN;
    $('r-bigger').disabled = size >= FONT_MAX;
  }

  $('r-prev').addEventListener('click', function () { turn(-1); });
  $('r-next').addEventListener('click', function () { turn(1); });
  $('r-smaller').addEventListener('click', function () { setFont(-FONT_STEP); });
  $('r-bigger').addEventListener('click', function () { setFont(FONT_STEP); });
  $('r-finish').addEventListener('click', finish);
  $('r-full').addEventListener('click', function () { if (isFullscreen()) exitFullscreen(); else enterFullscreen(); });
  document.addEventListener('keydown', onKey);
  setFont(0);

  open().catch(function () {
    status('Кітапты ашу мүмкін болмады. Бетті жаңартып көріңіз.', {
      error: true, html: '<button type="button" class="btn btn-primary" onclick="location.reload()">' + Icons.svg('refresh') + '<span>Қайта байқау</span></button>'
    });
  });
  API.Queue.flush();
})();
