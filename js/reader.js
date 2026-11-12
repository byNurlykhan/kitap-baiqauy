/* EPUB кітапты платформаның ішінде оқу.
   - Кітап файлы бір рет жүктеліп, телефонның жадында (Cache) сақталады: байланыс үзілсе де оқуға болады.
   - Оқыған жер және әріп өлшемі телефонда сақталады: келесі жолы сол беттен ашылады.
   - Кітапты ашу және «Оқып бітірдім» оқиғалары серверге кезекпен жіберіледі. */
(function () {
  'use strict';

  var LS = API.LS;
  var esc = UI.esc;
  var CACHE_NAME = 'kb-books-v1';
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
      var sx = 0, sy = 0;
      doc.addEventListener('touchstart', function (e) { sx = e.changedTouches[0].clientX; sy = e.changedTouches[0].clientY; }, { passive: true });
      doc.addEventListener('touchend', function (e) {
        var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) turn(dx < 0 ? 1 : -1);
      }, { passive: true });
      doc.addEventListener('keydown', onKey);
    });

    // Беттің сол жағын басса — артқа, оң жағын басса — алға
    rendition.on('click', function (e) {
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
    }
    rendition.on('rendered', onShown);
    rendition.on('relocated', function (loc) {
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

  /* Парақтау: алдыңғы ауысу аяқталмай тұрып келесі басу елеусіз қалады (epub.js қатесін болдырмау үшін) */
  var turning = false;
  function turn(dir) {
    var r = state.rendition;
    if (!r || turning) return;
    turning = true;
    var p;
    try { p = dir > 0 ? r.next() : r.prev(); } catch (e) { p = null; }
    Promise.resolve(p).catch(function () {}).then(function () {
      setTimeout(function () { turning = false; }, 120);
    });
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
  document.addEventListener('keydown', onKey);
  setFont(0);

  open().catch(function () {
    status('Кітапты ашу мүмкін болмады. Бетті жаңартып көріңіз.', {
      error: true, html: '<button type="button" class="btn btn-primary" onclick="location.reload()">' + Icons.svg('refresh') + '<span>Қайта байқау</span></button>'
    });
  });
  API.Queue.flush();
})();
