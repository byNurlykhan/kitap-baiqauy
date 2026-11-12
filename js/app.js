/* Қатысушы беттерінің логикасы: тіркелу, кіру, кітап, тест, нәтиже, рейтинг */
(function () {
  'use strict';

  var LS = API.LS;
  var esc = UI.esc;
  var icon = Icons.svg;
  var OTHER = 'Басқа';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function fmtDate(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + ', ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function fmtDur(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m ? m + ' мин ' + s + ' с' : s + ' с';
  }

  var DEFAULT_CFG = {
    title: 'Кітап оқу байқауы', registrationOpen: true, testOpen: false,
    readRequiredBeforeTest: true, strictIin: true, testDurationMin: 20, questionCount: 10, attempts: 1,
    helpText: '', workplaces: [], books: []
  };

  /* ================= Тексеру (валидация) ================= */
  var Valid = {
    name: function (v) {
      v = String(v || '').replace(/\s+/g, ' ').trim();
      if (!v) return 'Аты-жөніңізді жазыңыз.';
      if (!/^[A-Za-zЀ-ӿ\s.'’ʼ-]+$/.test(v)) return 'Аты-жөнінде тек әріптер болуы керек. Сандарды өшіріңіз.';
      var words = v.split(' ').filter(function (w) { return w.replace(/[^A-Za-zЀ-ӿ]/g, '').length >= 2; });
      if (words.length < 2) return 'Тегіңізді де, атыңызды да жазыңыз. Мысалы: Серікұлы Нұрлан.';
      return '';
    },
    iin: function (v, strict) {
      v = String(v || '');
      if (!v) return 'ЖСН жазыңыз. Ол жеке куәлігіңізде тұр.';
      if (!/^\d+$/.test(v)) return 'ЖСН тек сандардан тұруы керек.';
      if (v.length !== 12) return 'ЖСН 12 саннан тұруы керек. Қазір ' + v.length + ' сан енгізілді.';
      if (!strict) return '';
      var bad = 'ЖСН қате жазылған сияқты. Сандарды жеке куәлігіңізбен салыстырып, қайта жазыңыз.';
      var yy = +v.slice(0, 2), mm = +v.slice(2, 4), dd = +v.slice(4, 6), c = +v.charAt(6);
      if (c < 1 || c > 6) return bad;
      var year = (c <= 2 ? 1800 : c <= 4 ? 1900 : 2000) + yy;
      if (mm < 1 || mm > 12) return bad;
      if (dd < 1 || dd > new Date(year, mm, 0).getDate()) return bad;
      var d = v.split('').map(Number), s = 0, i;
      for (i = 0; i < 11; i++) s += d[i] * (i + 1);
      var k = s % 11;
      if (k === 10) {
        var w2 = [3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2];
        s = 0;
        for (i = 0; i < 11; i++) s += d[i] * w2[i];
        k = s % 11;
        if (k === 10) return bad;
      }
      return k === d[11] ? '' : bad;
    },
    phoneDigits: function (value) {
      var raw = String(value || '');
      if (raw.indexOf('+7') === 0) raw = raw.slice(2);
      var d = raw.replace(/\D/g, '');
      if (d.length >= 11 && (d.charAt(0) === '8' || d.charAt(0) === '7')) d = d.slice(1);
      return d.slice(0, 10);
    },
    phoneFormat: function (d) {
      var s = '+7';
      if (!d) return s + ' ';
      s += ' (' + d.slice(0, 3);
      if (d.length >= 3) s += ')';
      if (d.length > 3) s += ' ' + d.slice(3, 6);
      if (d.length > 6) s += '-' + d.slice(6, 8);
      if (d.length > 8) s += '-' + d.slice(8, 10);
      return s;
    },
    phone: function (d) {
      if (!d) return 'Телефон нөміріңізді жазыңыз.';
      if (d.length !== 10) return 'Телефон нөмірі толық емес. +7 кейін 10 сан болуы керек. Қазір ' + d.length + ' сан.';
      return '';
    }
  };

  /* ================= Қатысушы және баптаулар ================= */
  var User = {
    get: function () { return LS.get('kb_user', null); },
    set: function (u) { LS.set('kb_user', u); },
    clear: function () { LS.del('kb_user'); LS.del('kb_me_at'); },
    /* Сервердегі дерекпен біріктіру. Телефонда белгіленіп, әлі жіберілмеген қадамдар сақталады. */
    merge: function (server) {
      if (!server) return User.get();
      var local = User.get() || {};
      var out = {};
      Object.keys(local).forEach(function (k) { out[k] = local[k]; });
      Object.keys(server).forEach(function (k) { out[k] = server[k]; });
      ['bookOpenedAt', 'readFinishedAt', 'bookId'].forEach(function (k) {
        if (!server[k] && local[k]) out[k] = local[k];
      });
      if (!out.sig) out.sig = local.sig;
      User.set(out);
      return out;
    }
  };

  var Config = {
    data: null,
    listeners: [],
    onChange: function (fn) { Config.listeners.push(fn); },
    load: async function (opts) {
      opts = opts || {};
      var cached = LS.get('kb_config');
      if (cached && cached.data) Config.data = cached.data;
      if (!Config.data) {
        // Бірінші рет: репозиторийдегі жеңіл data.json файлынан аламыз
        try {
          var res = await fetch('data.json', { cache: 'no-cache' });
          if (res.ok) Config.data = await res.json();
        } catch (e) { /* файл болмаса, серверден күтеміз */ }
      }
      var ttl = ((window.APP_CONFIG || {}).CONFIG_TTL_MIN || 3) * 60000;
      var age = cached ? Date.now() - (cached.savedAt || 0) : Infinity;
      if (opts.fresh || age > ttl || !Config.data) {
        var p = Config.refresh(!Config.data);
        if (!Config.data || opts.fresh) await p;
      }
      if (!Config.data) Config.data = DEFAULT_CFG;
      return Config.data;
    },
    refresh: async function (loud) {
      var r = await API.get('getConfig', {}, { silent: !loud, retries: loud ? 6 : 2 });
      if (r && r.ok && r.config) {
        Config.data = r.config;
        LS.set('kb_config', { data: r.config, savedAt: Date.now() });
        Config.listeners.forEach(function (fn) { try { fn(r.config); } catch (e) { /* елемейміз */ } });
      }
      return Config.data;
    }
  };

  var Rating = {
    get: async function (maxAge) {
      var c = LS.get('kb_rating');
      if (c && Date.now() - c.savedAt < (maxAge || 60000)) return c.data;
      var r = await API.get('getRating', {}, { silent: true, retries: 2 });
      if (r && r.ok) { LS.set('kb_rating', { data: r, savedAt: Date.now() }); return r; }
      return c ? c.data : null;
    }
  };

  async function refreshMe(force) {
    var u = User.get();
    if (!u) return null;
    if (!force && Date.now() - LS.get('kb_me_at', 0) < 60000) return u;
    var r = await API.call('me', { pid: u.pid, sig: u.sig }, { silent: true, retries: 1 });
    if (r && r.ok) { LS.set('kb_me_at', Date.now()); return User.merge(r.user); }
    if (r && r.code === 'AUTH') {
      // Қатысушы серверде табылмады (мысалы, сынақ деректері өшірілген)
      User.clear(); LS.del('kb_queue');
      location.replace('index.html');
    }
    return u;
  }

  function cfg() { return Config.data || DEFAULT_CFG; }

  function currentBook(u) {
    var books = cfg().books || [];
    var b = null;
    if (u && u.bookId) b = books.filter(function (x) { return x.bookId === u.bookId; })[0];
    return b || books[0] || { bookId: '', title: 'Кітап әлі қосылмаған', author: '', description: '', url: '', coverColor: '#8A3B12' };
  }

  /* ================= Ортақ бөліктер ================= */
  function shade(hex, amt) {
    var m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#3F1A08';
    var n = parseInt(m[1], 16);
    var ch = [n >> 16, (n >> 8) & 255, n & 255].map(function (v) {
      v = Math.round(v * (1 + amt));
      return Math.max(0, Math.min(255, v));
    });
    return '#' + ch.map(function (v) { return (v < 16 ? '0' : '') + v.toString(16); }).join('');
  }

  function coverHTML(b) {
    var c1 = /^#[0-9a-f]{6}$/i.test(b.coverColor || '') ? b.coverColor : '#8A3B12';
    var style = '--c1:' + c1 + ';--c2:' + shade(c1, -0.55);
    // Мұқаба: толық сілтеме (https://...) немесе сайттағы файл (img/covers/...)
    var img = (/^https?:\/\//i.test(b.coverUrl || '') || /^[A-Za-z0-9_\-\/]+\.(jpe?g|png|webp)$/i.test(b.coverUrl || ''))
      ? '<img src="' + esc(b.coverUrl) + '" alt="" loading="lazy" decoding="async" onerror="this.remove()">' : '';
    return '<div class="cover" style="' + style + '" aria-hidden="true">' +
      '<div class="cover-author">' + esc(b.author) + '</div>' +
      '<div><div class="cover-title">' + esc(b.title) + '</div></div>' +
      '<div class="cover-line"></div>' + img + '</div>';
  }

  /* Мұқабалар желпуіші: ортасында негізгі кітап, екі жағында қосымша мұқабалар.
     linkable=true болса, мұқабаны басқанда кітап беті ашылады. */
  var GHOSTS = [
    { title: '', author: '', coverColor: '#C9A84C' },
    { title: '', author: '', coverColor: '#3A68B4' }
  ];
  function fanHTML(books, linkable) {
    var fan = (books || []).slice(0, 3);
    var items;
    if (!fan.length) items = [{ g: GHOSTS[0] }, { g: { title: '', author: '', coverColor: '#1B3A70' } }, { g: GHOSTS[1] }];
    else if (fan.length === 1) items = [{ g: GHOSTS[0] }, { b: fan[0] }, { g: GHOSTS[1] }];
    else if (fan.length === 2) items = [{ b: fan[1] }, { b: fan[0] }, { g: GHOSTS[0] }];
    else items = [{ b: fan[1] }, { b: fan[0] }, { b: fan[2] }];
    return '<div class="fan">' + items.map(function (it, i) {
      var cls = 'fan-item fan-' + i;
      if (it.g) return '<div class="' + cls + ' fan-ghost" aria-hidden="true">' + coverHTML(it.g) + '</div>';
      if (!linkable) return '<div class="' + cls + '" aria-hidden="true">' + coverHTML(it.b) + '</div>';
      return '<a class="' + cls + '" href="book.html?id=' + encodeURIComponent(it.b.bookId) + '" aria-label="' + esc(it.b.title) + ' кітабын ашу">' + coverHTML(it.b) + '</a>';
    }).join('') + '</div>';
  }

  function stepsHTML(u) {
    var s = [
      { l: 'Тіркелу', done: true },
      { l: 'Кітап', done: !!u.readFinishedAt },
      { l: 'Тест', done: !!u.testFinishedAt }
    ];
    var cur = -1;
    s.forEach(function (x, i) { if (cur < 0 && !x.done) cur = i; });
    return '<ol class="steps reveal" aria-label="Байқау қадамдары">' + s.map(function (x, i) {
      var cls = x.done ? 'done' : (i === cur ? 'current' : '');
      return '<li class="' + cls + '"><span class="step-dot">' + (x.done ? icon('check') : (i + 1)) + '</span><span>' + x.l + '</span></li>';
    }).join('') + '</ol>';
  }

  function nextAction(u) {
    var b = currentBook(u);
    var bh = 'book.html' + (b.bookId ? '?id=' + encodeURIComponent(b.bookId) : '');
    if (u.testFinishedAt) return { href: 'result.html', icon: 'award', label: 'Нәтижемді көру', status: 'Сіз тестті тапсырдыңыз. Жарайсыз!', sicon: 'check' };
    if (u.readFinishedAt) {
      if (cfg().testOpen) return { href: 'test.html', icon: 'test', label: 'Тест тапсыру', status: 'Кітапты оқып бітірдіңіз. Енді тест тапсырыңыз.', sicon: 'check' };
      return { href: 'test.html', icon: 'clock', label: 'Тест туралы', status: 'Кітапты оқып бітірдіңіз. Тест әзірге жабық. Ашылған кезде хабарлаймыз.', sicon: 'clock' };
    }
    if (u.bookOpenedAt) return { href: bh, icon: 'book', label: 'Оқуды жалғастыру', status: 'Сіз кітапты оқып жатырсыз.', sicon: 'book' };
    return { href: bh, icon: 'book', label: 'Кітапты оқу', status: 'Келесі қадам: кітапты оқыңыз.', sicon: 'arrowright' };
  }

  var NAV = [
    { id: 'home', href: 'index.html', icon: 'home', label: 'Басты бет' },
    { id: 'book', href: 'book.html', icon: 'book', label: 'Кітап' },
    { id: 'test', href: 'test.html', icon: 'test', label: 'Тест' },
    { id: 'result', href: 'result.html', icon: 'award', label: 'Менің нәтижем' }
  ];
  var PAGE_TITLES = { home: 'Басты бет', book: 'Кітап', test: 'Тест', result: 'Менің нәтижем', rating: 'Үздіктер' };

  function initials(u) {
    var p = String(u.fullName || '').split(' ');
    return ((p[1] || p[0] || '?').charAt(0) + (p[1] ? p[0].charAt(0) : '')).toUpperCase();
  }

  function renderChrome() {
    var page = document.body.getAttribute('data-page');
    var u = User.get();
    var c = cfg();
    document.body.classList.toggle('guest', !u);
    document.title = (PAGE_TITLES[page] || '') + ' · ' + c.title;

    // Логотиптер қатары: «Кітап оқитын ұлт» және «ЕмбіМұнайГаз»
    var logos = '<a class="logos" href="index.html" aria-label="' + esc(c.title) + ' — басты бет">' +
      '<span class="logo-kitap"><img src="img/logo.jpg" alt="Кітап оқитын ұлт" width="1200" height="849"></span>' +
      '<span class="logo-sep" aria-hidden="true"></span>' +
      '<img class="logo-emg" src="img/emg.png" alt="ЕмбіМұнайГаз" width="1200" height="330"></a>';
    var bottom = $('#bottom-nav'), top = $('#topbar');

    function link(n) {
      return '<a href="' + n.href + '"' + (n.id === page ? ' class="active" aria-current="page"' : '') + '>' + icon(n.icon) + '<span>' + n.label + '</span></a>';
    }
    function textLink(n) {
      return '<a href="' + n.href + '"' + (n.id === page ? ' class="active" aria-current="page"' : '') + '>' + n.label + '</a>';
    }

    if (bottom) bottom.innerHTML = u ? NAV.map(link).join('') : '';
    if (top) {
      var html = '<div class="header-inner">' + logos;
      if (u) {
        html += '<nav class="top-nav" aria-label="Негізгі мәзір">' + NAV.concat([{ id: 'rating', href: 'rating.html', label: 'Үздіктер' }]).map(textLink).join('') + '</nav>' +
          '<div class="header-user"><span class="header-name">' + esc(u.firstName) + '</span><div class="avatar" aria-hidden="true">' + esc(initials(u)) + '</div>' +
          '<button type="button" class="header-logout" data-logout>' + icon('logout') + '<span>Шығу</span></button></div>';
      }
      top.innerHTML = html + '</div>';
    }
    renderExtras();
  }

  function renderExtras() {
    var el = $('#extras');
    if (!el) return;
    var u = User.get();
    var c = cfg();
    var html = '';
    if (u) {
      html += '<section class="card reveal"><h3>' + icon('trophy') + '<span>Үздік оқырмандар</span></h3><div id="mini-rank"><p class="muted">Жүктеліп жатыр…</p></div>' +
        '<a class="btn btn-secondary btn-sm mt" style="width:100%" href="rating.html">' + icon('list') + '<span>Толық тізім</span></a></section>';
    } else {
      html += '<section class="card reveal"><h3>' + icon('lock') + '<span>Деректеріңіз қорғалған</span></h3><p>ЖСН мен телефон нөміріңізді басқа қатысушылар көрмейді.</p></section>';
    }
    if (c.helpText) {
      html += '<section class="card card-soft reveal"><h3>' + icon('info') + '<span>Көмек керек пе?</span></h3><p>' + esc(c.helpText) + '</p></section>';
    }
    // Беттің ең төменгі жолы: логотиптер және жоба атауы
    html += '<div class="site-copy"><span class="site-copy-logos">' +
      '<span class="logo-kitap"><img src="img/logo.jpg" alt="Кітап оқитын ұлт" width="1200" height="849" loading="lazy"></span>' +
      '<span class="logo-sep" aria-hidden="true"></span>' +
      '<img class="logo-emg" src="img/emg.png" alt="ЕмбіМұнайГаз" width="1200" height="330" loading="lazy"></span>' +
      '<span>«' + esc(c.title) + '» кітап оқу байқауы · ' + new Date().getFullYear() + '</span></div>';
    el.innerHTML = html;
    if (u) {
      Rating.get(120000).then(function (r) {
        var box = $('#mini-rank');
        if (!box) return;
        if (!r || !r.top || !r.top.length) { box.innerHTML = '<p class="muted">Нәтижелер тест өткен соң шығады.</p>'; return; }
        box.innerHTML = '<ol class="mini-rank">' + r.top.slice(0, 5).map(function (x, i) {
          return '<li><span class="pos">' + (i + 1) + '</span><span class="nm">' + esc(x.name) + '</span><span class="sc">' + esc(x.score) + '</span></li>';
        }).join('') + '</ol>';
      });
    }
  }

  async function logout() {
    var yes = await UI.modal({
      icon: 'logout', tone: 'warn', title: 'Шығасыз ба?',
      text: 'Қайта кіру үшін ЖСН керек болады.',
      buttons: [
        { label: 'Жоқ, қаламын', value: false, icon: 'arrowleft' },
        { label: 'Иә, шығамын', value: true, kind: 'btn-ghost', icon: 'logout' }
      ]
    });
    if (!yes) return;
    try { await Promise.race([API.Queue.flush(), new Promise(function (r) { setTimeout(r, 4000); })]); } catch (e) { /* елемейміз */ }
    User.clear();
    location.href = 'index.html';
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-logout]') : null;
    if (t) logout();
  });

  /* ================= Басты бет ================= */
  function setFieldError(name, msg) {
    var f = $('[data-field="' + name + '"]');
    if (!f) return;
    var p = $('.error', f);
    f.classList.toggle('invalid', !!msg);
    if (p) p.innerHTML = msg ? icon('alert') + '<span>' + esc(msg) + '</span>' : '';
  }
  function showFormError(id, msg) {
    var el = $(id);
    if (!el) return;
    el.hidden = !msg;
    el.innerHTML = msg ? icon('alert') + '<span>' + esc(msg) + '</span>' : '';
  }

  function fillWorkplaces() {
    var sel = $('#f-wp');
    if (!sel) return;
    var cur = sel.value;
    var list = (cfg().workplaces || []).filter(function (w) { return w !== OTHER; });
    sel.innerHTML = '<option value="">— Тізімнен таңдаңыз —</option>' +
      list.map(function (w) { return '<option value="' + esc(w) + '">' + esc(w) + '</option>'; }).join('') +
      '<option value="' + OTHER + '">' + OTHER + '</option>';
    sel.value = cur;
  }

  function bindPhone(inp) {
    var prev = '';
    inp.addEventListener('focus', function () { if (!inp.value) inp.value = '+7 '; });
    inp.addEventListener('blur', function () { if (inp.value.trim() === '+7') inp.value = ''; });
    inp.addEventListener('input', function (e) {
      var d = Valid.phoneDigits(inp.value);
      // Жақша немесе сызықша өшірілсе, оның алдындағы санды да өшіреміз
      if (e.inputType === 'deleteContentBackward' && d === prev && d.length) d = d.slice(0, -1);
      prev = d;
      inp.value = Valid.phoneFormat(d);
    });
  }

  function bindIin(inp, counter) {
    inp.addEventListener('input', function () {
      var v = inp.value.replace(/\D/g, '').slice(0, 12);
      if (v !== inp.value) inp.value = v;
      if (counter) {
        counter.textContent = v.length + '/12';
        counter.classList.toggle('full', v.length === 12);
      }
    });
  }

  function showView(name) {
    ['welcome', 'register', 'login', 'home'].forEach(function (v) {
      var el = $('#view-' + v);
      if (el) el.hidden = v !== name;
    });
    window.scrollTo(0, 0);
  }

  function routeGuest() {
    var h = location.hash.replace('#', '');
    var c = cfg();
    $$('[data-bind="title"]').forEach(function (el) { el.textContent = c.title; });
    var closed = $('#reg-closed');
    if (closed) closed.hidden = c.registrationOpen !== false;
    $$('[data-go="register"]').forEach(function (b) { b.hidden = c.registrationOpen === false; });
    if (h === 'register' && c.registrationOpen !== false) showView('register');
    else if (h === 'login') showView('login');
    else showView('welcome');
  }

  /* «Жоба туралы» блогы index.html ішіндегі <template> үлгісінен алынады (мәтін бір жерде сақталады) */
  function decreeHTML() {
    var t = document.getElementById('decree-tpl');
    return t ? t.innerHTML : '';
  }

  function renderHome() {
    var u = User.get();
    if (!u) return;
    var c = cfg();
    var b = currentBook(u);
    var n = nextAction(u);
    var books = c.books || [];
    var html =
      '<header class="page-head reveal"><p class="eyebrow">' + esc(c.title) + '</p><h1>Сәлем, ' + esc(u.firstName) + '!</h1></header>' +
      stepsHTML(u) +
      '<section class="hero-book reveal">' + coverHTML(b) +
      '<div><p class="hero-label">Сіздің кітабыңыз</p><h2>' + esc(b.title) + '</h2><p class="hero-author">' + esc(b.author) + '</p></div>' +
      '<p class="hero-status">' + icon(n.sicon) + '<span>' + esc(n.status) + '</span></p>' +
      '<a class="btn btn-light btn-xl" href="' + n.href + '">' + icon(n.icon) + '<span>' + n.label + '</span></a>' +
      '</section>';
    if (books.length > 1) {
      html += '<h2 class="section-title reveal">Байқаудағы кітаптар</h2><div class="book-grid reveal">' + books.map(function (x) {
        return '<a class="book-tile" href="book.html?id=' + encodeURIComponent(x.bookId) + '">' + coverHTML(x) +
          '<p class="book-tile-title">' + esc(x.title) + '</p><p class="book-tile-author">' + esc(x.author) + '</p></a>';
      }).join('') + '</div>';
    }
    html += '<div class="reveal mt-lg">' + decreeHTML() + '</div>';
    $('#view-home').innerHTML = html;
    Icons.hydrate($('#view-home'));
    showView('home');
  }

  async function onLoggedIn(r) {
    User.set(r.user);
    LS.set('kb_me_at', Date.now());
    history.replaceState(null, '', location.pathname);
    renderChrome();
    renderHome();
    await UI.modal({
      icon: 'check', tone: 'ok',
      title: r.existing ? 'Сіз бұрын тіркелгенсіз, қош келдіңіз, ' + r.user.firstName + '!' : 'Сіз тіркелдіңіз, ' + r.user.firstName + '!',
      text: r.existing ? 'Тоқтаған жеріңізден жалғастыра беріңіз.' : 'Енді кітапты оқуға кірісіңіз.',
      buttons: [{ label: 'Жалғастыру', value: true, icon: 'arrowright' }]
    });
  }

  async function pageHome() {
    await Config.load();
    renderChrome();

    var slot = $('#decree-slot');
    if (slot) { slot.innerHTML = decreeHTML(); Icons.hydrate(slot); }
    var art = $('#hero-art');
    if (art) art.innerHTML = fanHTML(cfg().books, false);

    var regForm = $('#reg-form'), loginForm = $('#login-form');
    fillWorkplaces();
    bindIin($('#f-iin'), $('#iin-counter'));
    bindIin($('#l-iin'), $('#l-iin-counter'));
    bindPhone($('#f-phone'));

    $('#f-wp').addEventListener('change', function () {
      var other = this.value === OTHER;
      $('[data-field="workplaceOther"]').hidden = !other;
      setFieldError('workplace', '');
      if (other) $('#f-wp-other').focus();
    });
    $$('[data-go]').forEach(function (b) {
      b.addEventListener('click', function () {
        var to = b.getAttribute('data-go');
        location.hash = to === 'welcome' ? '' : to;
      });
    });
    // Қатесі түзетіле бастаған жолдың қызыл белгісін алып тастаймыз
    $$('.field .input, .field input[type="checkbox"]').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var f = inp.closest('.field');
        if (f) setFieldError(f.getAttribute('data-field'), '');
      });
    });

    regForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      showFormError('#reg-error', '');
      var c = cfg();
      var v = {
        fullName: $('#f-name').value.replace(/\s+/g, ' ').trim(),
        workplace: $('#f-wp').value,
        workplaceOther: $('#f-wp-other').value.replace(/\s+/g, ' ').trim(),
        iin: $('#f-iin').value,
        phone: Valid.phoneDigits($('#f-phone').value),
        consent: $('#f-consent').checked
      };
      var errs = {
        fullName: Valid.name(v.fullName),
        workplace: v.workplace ? '' : 'Жұмыс орныңызды тізімнен таңдаңыз.',
        workplaceOther: v.workplace === OTHER && v.workplaceOther.length < 2 ? 'Жұмыс орныңыздың атауын жазыңыз.' : '',
        iin: Valid.iin(v.iin, c.strictIin !== false),
        phone: Valid.phone(v.phone),
        consent: v.consent ? '' : 'Жалғастыру үшін осы белгіні қойыңыз.'
      };
      var first = null;
      Object.keys(errs).forEach(function (k) {
        setFieldError(k, errs[k]);
        if (errs[k] && !first) first = k;
      });
      if (first) {
        var f = $('[data-field="' + first + '"]');
        f.scrollIntoView({ behavior: 'smooth', block: 'center' });
        var inp = $('input, select', f);
        if (inp) inp.focus({ preventScroll: true });
        return;
      }
      var btn = $('button[type="submit"]', regForm);
      UI.setBusy(btn, true, 'Тіркеп жатырмыз…');
      var r = await API.call('register', v);
      UI.setBusy(btn, false);
      if (r && r.ok) return onLoggedIn(r);
      if (r && r.code === 'VALIDATION' && r.field) {
        setFieldError(r.field, r.message);
        var ff = $('[data-field="' + r.field + '"]');
        if (ff) ff.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      showFormError('#reg-error', API.errorText(r));
    });

    loginForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      showFormError('#login-error', '');
      var iin = $('#l-iin').value;
      var err = Valid.iin(iin, false);
      setFieldError('loginIin', err);
      if (err) { $('#l-iin').focus(); return; }
      var btn = $('button[type="submit"]', loginForm);
      UI.setBusy(btn, true, 'Тексеріп жатырмыз…');
      var r = await API.call('login', { iin: iin });
      UI.setBusy(btn, false);
      if (r && r.ok) { r.existing = true; return onLoggedIn(r); }
      if (r && r.code === 'NOT_FOUND') { setFieldError('loginIin', r.message); return; }
      showFormError('#login-error', API.errorText(r));
    });

    if (User.get()) {
      renderHome();
      refreshMe().then(function () { if (User.get()) { renderChrome(); renderHome(); } });
    } else {
      routeGuest();
    }
    window.addEventListener('hashchange', function () { if (!User.get()) routeGuest(); });
    Config.onChange(function () {
      renderChrome();
      if (User.get()) renderHome(); else { fillWorkplaces(); routeGuest(); if (art) art.innerHTML = fanHTML(cfg().books, false); }
    });
    API.Queue.onSync(function (su) { User.merge(su); });
  }

  /* ================= Кітап беті ================= */
  function pageBook() {
    var root = $('#page');

    function bookId() { return new URLSearchParams(location.search).get('id'); }
    function book() {
      var id = bookId();
      var list = cfg().books || [];
      return list.filter(function (b) { return b.bookId === id; })[0] || currentBook(User.get());
    }

    /* Жинақ көрінісі: мұқабалар желпуіш сияқты жайылып тұрады. Мұқабаны басқанда кітап беті ашылады. */
    function renderCollection() {
      var u = User.get();
      var books = cfg().books || [];
      var href = function (b) { return 'book.html?id=' + encodeURIComponent(b.bookId); };
      var status = u.readFinishedAt ? 'Оқып бітірдіңіз' : u.bookOpenedAt ? 'Оқып жатырсыз' : 'Әлі ашылмаған';

      root.innerHTML =
        '<div class="step-pill reveal"><b>2/3</b><span>Кітап</span></div>' +
        '<header class="page-head reveal"><h1>Кітаптар</h1><p class="lead">Мұқабаны басып, кітапты ашыңыз.</p></header>' +
        (books.length ? '<section class="collection reveal">' +
          '<div class="collection-meta"><span>' + icon('star') + 'Байқау кітабы</span><span>' + icon('book') + books.length + ' кітап</span></div>' +
          '<h2>' + esc(cfg().title) + '</h2><p class="collection-sub">' + esc(status) + '</p>' +
          fanHTML(books, true) +
          (books.length === 1
            ? '<a class="btn btn-primary btn-xl" href="' + href(books[0]) + '">' + icon('book') + '<span>Кітапты ашу</span></a>'
            : '<ul class="collection-list">' + books.map(function (b) {
                return '<li><a href="' + href(b) + '"><span class="cl-cover">' + coverHTML(b) + '</span><span><b>' + esc(b.title) + '</b><span>' + esc(b.author) + '</span></span>' + icon('arrowright') + '</a></li>';
              }).join('') + '</ul>') +
          '</section>'
        : '<section class="card state"><div class="state-icon tone-info">' + icon('book') + '</div><h2>Кітап әлі қосылмаған</h2><p>Сәл кейінірек кіріңіз.</p></section>');
    }

    function render() {
      if (!bookId()) { renderCollection(); return; }
      var u = User.get();
      var b = book();
      // EPUB кітап платформаның ішінде (read.html) ашылады, PDF немесе сілтеме — жаңа бетте
      var epub = /\.epub(\?|#|$)/i.test(b.url || '');
      var hasUrl = epub || /^https?:\/\//i.test(b.url || '');
      var href = epub ? 'read.html?id=' + encodeURIComponent(b.bookId) : esc(b.url);
      var target = epub ? '' : ' target="_blank" rel="noopener"';
      var openIcon = epub ? 'book' : 'external';
      var actions = '';
      if (u.readFinishedAt) {
        actions =
          '<div class="alert alert-ok">' + icon('check') + '<span>Жарайсыз! Сіз кітапты оқып бітірдіңіз.</span></div>' +
          '<a class="btn btn-primary btn-xl" href="test.html">' + icon('test') + '<span>Тестке өту</span></a>' +
          (hasUrl ? '<a class="btn btn-ghost" id="read-btn" href="' + href + '"' + target + '>' + icon(openIcon) + '<span>Кітапты қайта ашу</span></a>' : '');
      } else {
        actions =
          (hasUrl
            ? '<a class="btn btn-primary btn-xl" id="read-btn" href="' + href + '"' + target + '>' + icon(openIcon) + '<span>' + (u.bookOpenedAt ? 'Оқуды жалғастыру' : 'Кітапты оқу') + '</span></a>' +
              '<p class="muted">' + (epub ? 'Кітап осы сайттың ішінде ашылады. Тоқтаған жеріңіз сақталады.' : 'Кітап жаңа бетте ашылады. Оқып болған соң осы бетке оралыңыз.') + '</p>'
            : '<div class="alert alert-warn">' + icon('info') + '<span>Кітап әлі қосылмаған. Сәл кейінірек кіріңіз.</span></div>') +
          '<button type="button" class="btn btn-secondary" id="finish-btn">' + icon('check') + '<span>Оқып бітірдім</span></button>';
      }
      root.innerHTML =
        '<a class="back-link reveal" href="book.html">' + icon('arrowleft') + '<span>Барлық кітаптар</span></a>' +
        '<div><div class="step-pill reveal"><b>2/3</b><span>Кітап</span></div></div>' +
        '<section class="card book-detail reveal">' +
        '<div class="book-cover-wrap">' + coverHTML(b) + '</div>' +
        '<div><h1>' + esc(b.title) + '</h1><p class="book-author">' + esc(b.author) + '</p>' +
        (b.description ? '<p class="book-desc">' + esc(b.description) + '</p>' : '') +
        '<div class="actions">' + actions + '</div></div></section>';

      var read = $('#read-btn');
      if (read) read.addEventListener('click', function () {
        var cu = User.get();
        if (!cu.bookOpenedAt) {
          cu.bookOpenedAt = Date.now();
          cu.bookId = b.bookId;
          User.set(cu);
          API.Queue.push('book_opened', b.bookId);
          setTimeout(render, 400); // сілтеме ашылып үлгерсін
        }
      });
      var fin = $('#finish-btn');
      if (fin) fin.addEventListener('click', async function () {
        var yes = await UI.modal({
          icon: 'book', tone: 'accent',
          title: 'Шынымен оқып бітірдіңіз бе?',
          text: 'Растасаңыз, тестке өте аласыз.',
          buttons: [
            { label: 'Иә, оқып бітірдім', value: true, icon: 'check' },
            { label: 'Жоқ, әлі оқып жатырмын', value: false, kind: 'btn-ghost', icon: 'arrowleft' }
          ]
        });
        if (!yes) return;
        var cu = User.get();
        var now = Date.now();
        if (!cu.bookOpenedAt) cu.bookOpenedAt = now;
        cu.readFinishedAt = now;
        cu.bookId = b.bookId;
        User.set(cu);
        API.Queue.push('read_finished', b.bookId);
        render();
        UI.toast('Жарайсыз! Оқып бітіргеніңіз белгіленді.');
        window.scrollTo(0, 0);
      });
    }

    Config.load().then(function () {
      renderChrome();
      render();
      refreshMe().then(function () { if (User.get()) render(); });
    });
    Config.onChange(function () { renderChrome(); render(); });
    API.Queue.onSync(function (su) { User.merge(su); });
  }

  /* ================= Тест беті ================= */
  function pageTest() {
    var root = $('#page');
    var pill = '<div class="step-pill reveal"><b>3/3</b><span>Тест</span></div>';

    function state(tone, ic, title, text, btnHtml) {
      return pill + '<section class="card state reveal"><div class="state-icon tone-' + tone + '">' + icon(ic) + '</div><h1>' + title + '</h1><p>' + text + '</p>' + (btnHtml || '') + '</section>';
    }

    function render() {
      var u = User.get();
      var c = cfg();
      if (u.testFinishedAt) {
        root.innerHTML = state('ok', 'check', 'Сіз тестті тапсырдыңыз', 'Нәтижеңізді көре аласыз.',
          '<a class="btn btn-primary btn-xl" href="result.html">' + icon('award') + '<span>Нәтижемді көру</span></a>');
        return;
      }
      if (c.readRequiredBeforeTest !== false && !u.readFinishedAt) {
        root.innerHTML = state('info', 'lock', 'Алдымен кітапты оқыңыз', 'Тест кітапты оқып бітірген соң ашылады.',
          '<a class="btn btn-primary btn-xl" href="book.html">' + icon('book') + '<span>Кітапқа өту</span></a>');
        return;
      }
      if (!c.testOpen) {
        root.innerHTML = state('warn', 'clock', 'Тест әзірге жабық', 'Ашылған кезде хабарлаймыз.',
          '<a class="btn btn-secondary" href="index.html">' + icon('home') + '<span>Басты бетке</span></a>');
        return;
      }
      var once = (c.attempts || 1) <= 1 ? 'Тестті тек бір рет тапсыруға болады.' : 'Тестті ' + c.attempts + ' рет тапсыруға болады.';
      root.innerHTML = state('accent', 'test', 'Тестке дайынсыз ба?',
        'Тестте ' + esc(c.questionCount) + ' сұрақ бар. Берілетін уақыт: ' + esc(c.testDurationMin) + ' минут. ' + once,
        '<button type="button" class="btn btn-primary btn-xl" id="start-test">' + icon('play') + '<span>Тестті бастау</span></button>');
      $('#start-test').addEventListener('click', startTest);
    }

    /* ЕСКЕРТУ: тесттің ішкі бөлігі (сұрақтар, таймер, жауап жіберу) кейін бөлек жасалады.
       Сол кезде осы функция серверден сұрақтарды алып, тест экранын ашады. */
    function startTest() {
      UI.modal({
        icon: 'clock', tone: 'info',
        title: 'Тест жақында басталады',
        text: 'Сұрақтар дайындалып жатыр. Сәл кейінірек осы батырманы қайта басыңыз.',
        buttons: [{ label: 'Түсінікті', value: true, icon: 'check' }]
      });
    }

    root.innerHTML = pill + '<div class="skeleton"></div>';
    renderChrome();
    Config.load({ fresh: true }).then(function () {
      renderChrome();
      render();
      return refreshMe(true);
    }).then(function () { if (User.get()) render(); });
    Config.onChange(function () { renderChrome(); render(); });
    API.Queue.onSync(function (su) { User.merge(su); render(); });
  }

  /* ================= Менің нәтижем ================= */
  function cheer(score) {
    if (score >= 90) return 'Керемет нәтиже! Сіз нағыз кітапқұмарсыз!';
    if (score >= 70) return 'Өте жақсы! Жарайсыз!';
    if (score >= 50) return 'Жақсы нәтиже! Оқуды жалғастыра беріңіз!';
    return 'Қатысқаныңызға рақмет! Келесі жолы міндетті түрде жақсырақ болады!';
  }

  function pageResult() {
    var root = $('#page');

    function render() {
      var u = User.get();
      var n = nextAction(u);
      var top;
      if (u.testFinishedAt && u.score != null) {
        top = '<section class="score-card reveal"><p class="hero-label">Сіздің ұпайыңыз</p><p class="score-big">' + esc(u.score) + '</p>' +
          '<p class="score-cheer">' + cheer(+u.score) + '</p><div class="score-meta">' +
          '<div><b>' + (u.correct != null ? esc(u.correct) : '—') + '</b>дұрыс жауап</div>' +
          '<div><b>' + (u.rank ? esc(u.rank) + '-орын' : '—') + '</b>жалпы рейтингте</div></div></section>';
      } else {
        top = '<section class="card state reveal"><div class="state-icon tone-accent">' + icon('award') + '</div><h2>Тест әлі тапсырылмаған</h2><p>' + esc(n.status) + '</p>' +
          '<a class="btn btn-primary btn-xl" href="' + n.href + '">' + icon(n.icon) + '<span>' + n.label + '</span></a></section>';
      }
      var steps = [
        ['Тіркелдіңіз', u.registeredAt], ['Кітапты аштыңыз', u.bookOpenedAt],
        ['Кітапты оқып бітірдіңіз', u.readFinishedAt], ['Тест тапсырдыңыз', u.testFinishedAt]
      ];
      root.innerHTML =
        '<header class="page-head reveal"><h1>Менің нәтижем</h1><p class="lead">' + esc(u.fullName) + '</p></header>' + top +
        '<section class="card mt reveal"><h3>Менің қадамдарым</h3><ol class="timeline">' + steps.map(function (s) {
          return '<li class="' + (s[1] ? 'done' : '') + '"><span class="tl-dot">' + icon(s[1] ? 'check' : 'clock') + '</span><div><p class="tl-title">' + s[0] + '</p><p class="tl-date">' + (s[1] ? fmtDate(s[1]) : 'Әлі жоқ') + '</p></div></li>';
        }).join('') + '</ol></section>' +
        '<div class="stack mt reveal"><a class="btn btn-secondary" href="rating.html">' + icon('trophy') + '<span>Үздіктер тізімі</span></a>' +
        '<button type="button" class="btn btn-ghost" data-logout>' + icon('logout') + '<span>Шығу</span></button></div>';
    }

    Config.load().then(function () {
      renderChrome();
      render();
      refreshMe(true).then(function () { if (User.get()) render(); });
    });
    API.Queue.onSync(function (su) { User.merge(su); });
  }

  /* ================= Рейтинг ================= */
  function pageRating() {
    var root = $('#page');
    var head = '<header class="page-head reveal"><h1>Үздік оқырмандар</h1><p class="lead">Ең жоғары ұпай жинаған 50 қатысушы. Ұпай тең болса, тестті тезірек аяқтаған адам жоғары тұрады.</p></header>';
    root.innerHTML = head + '<div class="skeleton"></div>';

    Config.load().then(renderChrome);
    Rating.get(60000).then(function (r) {
      if (!r) {
        root.innerHTML = head + '<section class="card state"><div class="state-icon tone-warn">' + icon('alert') + '</div><h2>Тізім ашылмады</h2><p>Байланысты тексеріп, қайта байқаңыз.</p>' +
          '<button type="button" class="btn btn-primary" onclick="location.reload()">' + icon('refresh') + '<span>Қайта байқау</span></button></section>';
        return;
      }
      if (!r.top || !r.top.length) {
        root.innerHTML = head + '<section class="card state reveal"><div class="state-icon tone-accent">' + icon('trophy') + '</div><h2>Нәтижелер әлі жоқ</h2><p>Тест өткен соң үздіктер осы жерде шығады.</p>' +
          '<a class="btn btn-secondary" href="index.html">' + icon('home') + '<span>Басты бетке</span></a></section>';
        return;
      }
      root.innerHTML = head + '<ol class="rank-list">' + r.top.map(function (x, i) {
        return '<li class="rank-item' + (i < 3 ? ' top' + (i + 1) : '') + '"><span class="rank-pos">' + (i + 1) + '</span>' +
          '<div><p class="rank-name">' + esc(x.name) + '</p><p class="rank-wp">' + esc(x.workplace) + '</p></div>' +
          '<span class="rank-score">' + esc(x.score) + '</span></li>';
      }).join('') + '</ol>';
    });
  }

  /* ================= Іске қосу ================= */
  function init() {
    Icons.hydrate(document);
    var page = document.body.getAttribute('data-page');
    if (page !== 'home' && !User.get()) { location.replace('index.html'); return; }
    if (!API.configured()) {
      UI.banner('Сайт серверге қосылмаған. js/config.js файлына Apps Script сілтемесін қойыңыз.');
    }
    if (page === 'home') pageHome();
    else if (page === 'book') pageBook();
    else if (page === 'test') pageTest();
    else if (page === 'result') pageResult();
    else if (page === 'rating') pageRating();
    API.Queue.flush();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.KB = { Valid: Valid, fmtDate: fmtDate, fmtDur: fmtDur };
})();
