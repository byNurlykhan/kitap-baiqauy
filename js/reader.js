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
    // Кітаптың соңында «Оқып бітірдім» батырмасы көрінуі үшін жолақтарды шығарамыз
    if (state.atEnd && !u.readFinishedAt && document.body.classList.contains('immersive')) setImmersive(false);
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
      else setImmersive(!document.body.classList.contains('immersive')); // ортасын басса — батырмалар шығады/жасырылады
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
      state.loc = loc;
      onShown();
      LS.set(keyPos(), loc.start.cfi);
      $('r-chapter').textContent = chapterTitle(loc.start.href);
      updateProgress(loc);
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
     Парақ аудару (кәдімгі кітап сияқты)
     Алға: бет оң жақ шетінен көтеріліп, сол жақтағы түптемеге қарай аударылады.
     Артқа: алдыңғы бет сол жақтан қайта жабылып келеді.
     Саусақпен тартқанда бет саусақтың соңынан ереді; жартысына жетпей жіберсе — орнына оралады.
     ========================================================== */
  var turning = false;
  var lastDragAt = 0;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function sheetEl() { return $('r-page'); }
  function backEl() { return $('r-back-sheet'); }

  // Бет: 0° — жатыр, -90° — тік тұр (көрінбейді). Көлеңке бұрышқа қарай қоюланады.
  function pageAngle(a) {
    var s = sheetEl();
    s.style.transform = a ? 'rotateY(' + a + 'deg)' : '';
    s.querySelector('.page-shade').style.opacity = String(Math.min(0.6, Math.abs(a) / 90 * 0.6));
  }
  // Беттің арқа жағы: -90° — тік, -180° — сол жаққа жатып, жасырынады.
  function backAngle(a) {
    var b = backEl();
    if (a <= -179.5) { b.style.display = 'none'; return; }
    b.style.display = 'block';
    b.style.transform = 'rotateY(' + a + 'deg)';
    b.style.setProperty('--shade', String(Math.max(0, (a + 180) / 90) * 0.35));
  }

  function tween(from, to, ms, fn) {
    return new Promise(function (res) {
      var t0 = 0;
      function step(t) {
        if (!t0) t0 = t;
        var k = Math.min(1, (t - t0) / ms);
        var e = 1 - Math.pow(1 - k, 3);
        fn(from + (to - from) * e);
        if (k < 1) requestAnimationFrame(step); else res();
      }
      requestAnimationFrame(step);
    });
  }

  // epub.js кейде уәдесін аяқтамайды — сондықтан ең көбі 1.5 секунд күтеміз
  function settle(p) {
    return Promise.race([Promise.resolve(p).catch(function () {}), new Promise(function (r) { setTimeout(r, 1500); })]);
  }
  function call(dir) {
    var r = state.rendition;
    try { return dir > 0 ? r.next() : r.prev(); } catch (e) { return null; }
  }
  function canGo(dir) {
    var loc = state.loc;
    if (!loc) return true;
    return dir > 0 ? !loc.atEnd : !loc.atStart;
  }

  async function bounce(dir) {
    if (dir > 0) { await tween(0, -14, 140, pageAngle); await tween(-14, 0, 200, pageAngle); }
  }

  async function goNext(from) {
    var r = state.rendition;
    if (!r || turning) return;
    if (!canGo(1)) { turning = true; await bounce(1); turning = false; return; }
    turning = true;
    if (reduceMotion) { await settle(call(1)); turning = false; return; }
    await tween(from || 0, -90, 230, pageAngle);       // бет көтеріледі
    await settle(call(1));                               // мәтін келесі бетке ауысады
    pageAngle(0);
    backAngle(-90);
    await tween(-90, -180, 260, backAngle);              // арқа жағы сол жаққа жатады
    backAngle(-180);
    turning = false;
  }

  async function goPrev(from) {
    var r = state.rendition;
    if (!r || turning || !canGo(-1)) return;
    turning = true;
    if (reduceMotion) { await settle(call(-1)); turning = false; return; }
    await tween(from == null ? -180 : from, -90, 230, backAngle); // бет сол жақтан көтеріледі
    backAngle(-180);
    pageAngle(-90);
    await settle(call(-1));
    await tween(-90, 0, 260, pageAngle);                 // алдыңғы бет орнына жатады
    pageAngle(0);
    turning = false;
  }

  function turn(dir) { if (dir > 0) goNext(); else goPrev(); }

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

  // Жолақтар мәтіннің үстінен сырғиды, сондықтан мәтінді қайта орналастыру керек емес
  function setImmersive(on) {
    document.body.classList.toggle('immersive', !!on);
  }

  async function startFocusMode() {
    syncFullButton();
    // Бір рет қана ұсынамыз: толық экранға тек адамның өз басуымен кіруге болады
    var asked = false;
    try { asked = sessionStorage.getItem('kb_fs_asked') === '1'; sessionStorage.setItem('kb_fs_asked', '1'); } catch (e) { /* елемейміз */ }
    if (fsSupported && !isFullscreen() && !asked) {
      var go = await UI.modal({
        icon: 'maximize', tone: 'accent', title: 'Кітапты толық экранда оқисыз ба?',
        text: 'Экранда тек кітап қалады. Батырмаларды көру үшін беттің ортасын басыңыз.',
        buttons: [
          { label: 'Толық экранда оқу', value: true, icon: 'maximize' },
          { label: 'Жоқ, осылай оқимын', value: false, kind: 'btn-ghost', icon: 'book' }
        ]
      });
      if (go) enterFullscreen();
    } else if (!LS.get('kb_imm_hint')) {
      UI.toast('Батырмаларды көру үшін беттің ортасын басыңыз.');
    }
    LS.set('kb_imm_hint', 1);
    setImmersive(true);
  }

  /* Саусақпен (немесе тінтуірмен) тартып аудару. Оқиғалар кітап мәтінінің ішінен келеді. */
  function bindDrag(doc) {
    try { doc.documentElement.style.touchAction = 'pan-y pinch-zoom'; } catch (e) { /* елемейміз */ }
    var d = null;
    function width() { return sheetEl().offsetWidth || window.innerWidth; }

    doc.addEventListener('pointerdown', function (e) {
      if (turning || (e.pointerType === 'mouse' && e.button !== 0)) return;
      d = { x: e.clientX, y: e.clientY, dir: 0, a: 0, w: width() };
    });
    doc.addEventListener('pointermove', function (e) {
      if (!d || turning) return;
      var dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!d.dir) {
        if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
        d.dir = dx < 0 ? 1 : -1;
        if (!canGo(d.dir) || reduceMotion) { d.dir = 0; d.blocked = true; return; }
      }
      if (d.dir > 0) { d.a = Math.max(-88, Math.min(0, dx / d.w * 150)); pageAngle(d.a); }
      else { d.a = -180 + Math.max(0, Math.min(88, dx / d.w * 150)); backAngle(d.a); }
    });
    function end(e, cancelled) {
      if (!d) return;
      var cur = d; d = null;
      if (cur.dir || cur.blocked) lastDragAt = Date.now();
      if (cur.blocked) { var bx = e && e.clientX != null ? e.clientX - cur.x : 0; if (bx < -40) bounce(1); return; }
      if (cur.dir > 0) {
        if (!cancelled && cur.a < -28) goNext(cur.a);
        else { turning = true; tween(cur.a, 0, 200, pageAngle).then(function () { turning = false; }); }
      } else if (cur.dir < 0) {
        if (!cancelled && cur.a > -152) goPrev(cur.a);
        else { turning = true; tween(cur.a, -180, 200, backAngle).then(function () { backAngle(-180); turning = false; }); }
      }
    }
    doc.addEventListener('pointerup', function (e) { end(e, false); });
    doc.addEventListener('pointercancel', function (e) { end(e, true); });
  }

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
