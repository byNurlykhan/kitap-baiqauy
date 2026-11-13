/* Әкімші панелі: дашборд, ауыстырғыштар, қатысушылар, кітаптар, баптаулар, QR, Excel есебі.
   Барлық әрекет серверде токен арқылы тексеріледі. Құпиясөз бұл файлда жоқ. */
(function () {
  'use strict';

  var esc = UI.esc;
  var icon = Icons.svg;
  var OTHER = 'Басқа';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtDate(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function num(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }
  function store(key, val) {
    try {
      if (val === undefined) return sessionStorage.getItem(key);
      if (val === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, val);
    } catch (e) { /* елемейміз */ }
    return null;
  }

  var STATUS = { registered: 'Тіркелген', reading: 'Оқып жатыр', read: 'Оқып бітірген', tested: 'Тест тапсырған' };
  var TABS = [
    { id: 'dash', icon: 'chart', label: 'Басты бет' },
    { id: 'people', icon: 'users', label: 'Қатысушылар' },
    { id: 'books', icon: 'book', label: 'Кітаптар' },
    { id: 'wp', icon: 'building', label: 'Жұмыс орындары' },
    { id: 'settings', icon: 'settings', label: 'Баптаулар' },
    { id: 'qr', icon: 'qr', label: 'QR-код' },
    { id: 'report', icon: 'file', label: 'Excel есебі' }
  ];

  var S = { token: store('kb_admin') || null, data: null, tab: 'dash', filter: { q: '', wp: '', st: '' }, limit: 100, pdf: null };

  /* ================= Сервер ================= */
  async function call(action, payload, opts) {
    payload = payload || {};
    payload.token = S.token;
    var r = await API.call(action, payload, opts);
    if (r && r.ok === false && r.code === 'AUTH') {
      S.token = null;
      store('kb_admin', null);
      showLogin('Кіру мерзімі бітті. Құпиясөзді қайта жазыңыз.');
    }
    return r;
  }

  function normalize(d) {
    d.P = (d.participants || []).map(function (a) {
      var p = {
        pid: a[0], iin: a[1], name: a[2], wp: a[3] || '—', wpOther: a[4], phone: a[5],
        reg: a[6], opened: a[7], read: a[8], tStart: a[9], tEnd: a[10],
        score: a[11], correct: a[12], dur: a[13], bookId: a[14]
      };
      p.wpLabel = p.wp === OTHER && p.wpOther ? OTHER + ': ' + p.wpOther : p.wp;
      p.status = p.tEnd ? 'tested' : p.read ? 'read' : p.opened ? 'reading' : 'registered';
      p.search = (p.name + ' ' + p.iin).toLowerCase();
      return p;
    });
    delete d.participants;
    return d;
  }

  async function loadData(quiet) {
    if (!quiet) $('#tab').innerHTML = '<div class="skeleton"></div>';
    var r = await call('adminData', {}, { timeout: 60000, retries: 3 });
    if (!r || !r.ok) {
      if (r && r.code !== 'AUTH') $('#tab').innerHTML = '<div class="alert alert-err">' + icon('alert') + '<span>' + esc(API.errorText(r)) + '</span></div>';
      return false;
    }
    S.data = normalize(r);
    render();
    return true;
  }

  /* ================= Кіру ================= */
  function showLogin(msg) {
    $('#admin-view').hidden = true;
    $('#login-view').hidden = false;
    setErr('password', msg || '');
    setTimeout(function () { $('#a-pass').focus(); }, 50);
  }
  function setErr(name, msg) {
    var f = $('[data-field="' + name + '"]');
    if (!f) return;
    f.classList.toggle('invalid', !!msg);
    $('.error', f).innerHTML = msg ? icon('alert') + '<span>' + esc(msg) + '</span>' : '';
  }

  $('#login-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var pw = $('#a-pass').value;
    if (!pw) { setErr('password', 'Құпиясөзді жазыңыз.'); return; }
    var btn = $('button[type="submit"]', this);
    UI.setBusy(btn, true, 'Тексеріп жатырмыз…');
    var r = await API.call('adminLogin', { password: pw }, { retries: 2 });
    UI.setBusy(btn, false);
    if (r && r.ok) {
      S.token = r.token;
      store('kb_admin', r.token);
      $('#a-pass').value = '';
      setErr('password', '');
      $('#login-view').hidden = true;
      $('#admin-view').hidden = false;
      loadData();
    } else {
      setErr('password', API.errorText(r));
    }
  });

  async function logout() {
    await call('adminLogout', {}, { retries: 0, silent: true });
    S.token = null;
    store('kb_admin', null);
    S.data = null;
    showLogin('');
  }

  /* ================= Қаңқа ================= */
  function render() {
    var title = S.data.settings.contestTitle || 'Байқау';
    document.title = 'Әкімші панелі · ' + title;
    $('#admin-side').innerHTML =
      '<div class="side-inner"><div class="brand"><span class="brand-mark">' + icon('book') + '</span><span>' + esc(title) + '</span></div>' +
      '<nav class="side-nav" aria-label="Бөлімдер">' + TABS.map(function (t) {
        return '<a href="#' + t.id + '" data-tab="' + t.id + '"' + (t.id === S.tab ? ' class="active"' : '') + '>' + icon(t.icon) + '<span>' + t.label + '</span></a>';
      }).join('') + '</nav>' +
      '<div class="side-foot side-nav"><button type="button" data-act="refresh">' + icon('refresh') + '<span>Деректерді жаңарту</span></button>' +
      '<button type="button" data-act="logout">' + icon('logout') + '<span>Шығу</span></button></div></div>';
    $('#admin-tabs').innerHTML = TABS.map(function (t) {
      return '<button type="button" class="chip' + (t.id === S.tab ? ' active' : '') + '" data-tab="' + t.id + '">' + icon(t.icon) + '<span>' + t.label + '</span></button>';
    }).join('') + '<button type="button" class="chip" data-act="refresh">' + icon('refresh') + '<span>Жаңарту</span></button>' +
      '<button type="button" class="chip" data-act="logout">' + icon('logout') + '<span>Шығу</span></button>';
    renderStrip();
    renderTab();
  }

  function renderStrip() {
    var s = S.data.settings;
    function card(key, label, on, onText, offText, note) {
      return '<div class="toggle-card ' + (on ? 'on' : 'off') + '">' +
        '<button type="button" class="switch" role="switch" aria-checked="' + (on ? 'true' : 'false') + '" aria-label="' + label + '" data-toggle="' + key + '"></button>' +
        '<div><p class="toggle-label">' + label + '</p><p class="toggle-state">' + (on ? onText : offText) + '</p>' +
        (note ? '<p class="toggle-note">' + note + '</p>' : '') + '</div></div>';
    }
    var note = '';
    if (s.testOpen && !S.data.effectiveTestOpen) note = 'Ауыстырғыш қосулы, бірақ кестедегі уақыт бойынша тест қазір жабық.';
    $('#control-strip').innerHTML =
      card('testOpen', 'Тест', !!s.testOpen, 'ТЕСТ АШЫҚ', 'ТЕСТ ЖАБЫҚ', note) +
      card('registrationOpen', 'Тіркелу', !!s.registrationOpen, 'ТІРКЕЛУ АШЫҚ', 'ТІРКЕЛУ ЖАБЫҚ', '');
  }

  async function toggle(key, btn) {
    var cur = !!S.data.settings[key];
    var text;
    if (key === 'testOpen') {
      text = cur
        ? ['Тестті жабасыз ба?', 'Жаңа тест басталмайды. Басталып қойған тестті аяқтауға қосымша уақыт беріледі.', 'Иә, жабамын']
        : ['Тестті ашасыз ба?', 'Қатысушылар тестті бастай алады.', 'Иә, ашамын'];
    } else {
      text = cur
        ? ['Тіркелуді жабасыз ба?', 'Жаңа адамдар тіркеле алмайды. Бұрын тіркелгендер кіре береді.', 'Иә, жабамын']
        : ['Тіркелуді ашасыз ба?', 'Жаңа адамдар тіркеле алады.', 'Иә, ашамын'];
    }
    var yes = await UI.modal({
      icon: 'alert', tone: 'warn', title: text[0], text: text[1],
      buttons: [{ label: text[2], value: true, icon: 'check' }, { label: 'Жоқ, қалдырамын', value: false, kind: 'btn-ghost', icon: 'x' }]
    });
    if (!yes) return;
    var patch = {};
    patch[key] = !cur;
    btn.disabled = true;
    var ok = await saveSettings(patch);
    btn.disabled = false;
    if (ok) UI.toast('Сақталды. Өзгеріс қатысушыларға 2–3 минут ішінде жетеді.');
  }

  async function saveSettings(patch) {
    var r = await call('adminSaveSettings', { settings: patch });
    if (r && r.ok) {
      S.data.settings = r.settings;
      S.data.workplaces = r.workplaces;
      S.data.effectiveTestOpen = r.effectiveTestOpen;
      renderStrip();
      return true;
    }
    if (r && r.code !== 'AUTH') UI.toast(API.errorText(r), 'err');
    return false;
  }

  function renderTab() {
    var fn = { dash: tabDash, people: tabPeople, books: tabBooks, wp: tabWp, settings: tabSettings, qr: tabQr, report: tabReport }[S.tab] || tabDash;
    fn($('#tab'));
  }

  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    var t = e.target.closest('[data-tab]');
    if (t) {
      e.preventDefault();
      S.tab = t.getAttribute('data-tab');
      render();
      window.scrollTo(0, 0);
      return;
    }
    var a = e.target.closest('[data-act]');
    if (a) {
      var act = a.getAttribute('data-act');
      if (act === 'logout') logout();
      if (act === 'refresh') loadData().then(function (ok) { if (ok) UI.toast('Деректер жаңартылды.'); });
      return;
    }
    var tg = e.target.closest('[data-toggle]');
    if (tg) toggle(tg.getAttribute('data-toggle'), tg);
  });

  /* ================= Басты бет (дашборд) ================= */
  function stats() {
    var P = S.data.P;
    var st = { total: P.length, opened: 0, read: 0, tested: 0, avg: null, daily: [], wps: [] };
    var sum = 0, n = 0, days = {}, wp = {};
    P.forEach(function (p) {
      if (p.opened || p.read) st.opened++;
      if (p.read) st.read++;
      if (p.tEnd) { st.tested++; if (p.score != null) { sum += +p.score; n++; } }
      if (p.reg) {
        var d = new Date(p.reg);
        var k = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
        days[k] = (days[k] || 0) + 1;
      }
      var w = wp[p.wp] || (wp[p.wp] = { name: p.wp, reg: 0, read: 0, tested: 0 });
      w.reg++; if (p.read) w.read++; if (p.tEnd) w.tested++;
    });
    if (n) st.avg = Math.round(sum / n * 10) / 10;
    var keys = Object.keys(days).sort();
    if (keys.length) {
      var a = keys[0].split('-'), b = keys[keys.length - 1].split('-');
      var cur = new Date(+a[0], +a[1] - 1, +a[2], 12), end = new Date(+b[0], +b[1] - 1, +b[2], 12);
      while (cur <= end && st.daily.length < 400) {
        var k2 = cur.getFullYear() + '-' + pad(cur.getMonth() + 1) + '-' + pad(cur.getDate());
        st.daily.push({ label: pad(cur.getDate()) + '.' + pad(cur.getMonth() + 1), value: days[k2] || 0 });
        cur.setDate(cur.getDate() + 1);
      }
    }
    st.wps = Object.keys(wp).map(function (k) { return wp[k]; }).sort(function (x, y) { return y.reg - x.reg; });
    return st;
  }

  function barsSVG(items) {
    var W = 720, H = 250, L = 40, R = 10, T = 24, B = 34;
    var max = Math.max.apply(null, items.map(function (i) { return i.value; }).concat([1]));
    var step = (W - L - R) / items.length;
    var bw = Math.max(3, Math.min(46, step * 0.7));
    var every = Math.ceil(items.length / 10);
    var out = '<svg class="chart-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Күн бойынша тіркелу графигі">';
    [0, 0.5, 1].forEach(function (f) {
      var y = T + (H - T - B) * (1 - f);
      out += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" stroke="#D9DEE8" stroke-width="1"/>' +
        '<text x="' + (L - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + Math.round(max * f) + '</text>';
    });
    items.forEach(function (it, i) {
      var h = (H - T - B) * it.value / max;
      var x = L + step * i + (step - bw) / 2, y = H - B - h;
      out += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(h, 0).toFixed(1) + '" rx="4" fill="#0B1E3E"><title>' + it.label + ': ' + it.value + '</title></rect>';
      if (items.length <= 16 && it.value) out += '<text class="val" x="' + (x + bw / 2).toFixed(1) + '" y="' + (y - 6).toFixed(1) + '" text-anchor="middle">' + it.value + '</text>';
      if (i % every === 0) out += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 12) + '" text-anchor="middle">' + it.label + '</text>';
    });
    return out + '</svg>';
  }

  function tabDash(root) {
    var st = stats();
    function kpi(val, label, sub) {
      return '<div class="kpi"><p class="kpi-value">' + val + '</p><p class="kpi-label">' + label + '</p>' + (sub ? '<p class="kpi-sub">' + sub + '</p>' : '') + '</div>';
    }
    function frow(label, val) {
      var p = pct(val, st.total);
      return '<div class="funnel-row"><div class="funnel-head"><span>' + label + '</span><b>' + num(val) + ' · ' + p + '%</b></div><div class="bar"><span style="width:' + p + '%"></span></div></div>';
    }
    var maxWp = st.wps.length ? st.wps[0].reg : 1;
    root.innerHTML =
      '<div class="head-row"><h1>Басты бет</h1><p class="muted">Жаңартылған уақыты: ' + fmtDate(S.data.generatedAt) + '</p></div>' +
      '<div class="kpis">' +
      kpi(num(st.total), 'Тіркелгендер', '') +
      kpi(num(st.opened), 'Кітапты ашқандар', pct(st.opened, st.total) + '%') +
      kpi(num(st.read), 'Оқып біткендер', pct(st.read, st.total) + '%') +
      kpi(num(st.tested), 'Тест тапсырғандар', pct(st.tested, st.total) + '%') +
      kpi(st.avg == null ? '—' : st.avg, 'Орташа ұпай', st.avg == null ? 'тест әлі өткен жоқ' : '100 ұпайдан') +
      '</div>' +
      '<div class="panel-grid">' +
      '<section class="card"><h3>Воронка</h3>' + frow('Тіркелді', st.total) + frow('Оқуды бастады', st.opened) + frow('Оқып бітірді', st.read) + frow('Тест тапсырды', st.tested) + '</section>' +
      '<section class="card"><h3>Күн бойынша тіркелу</h3>' + (st.daily.length ? barsSVG(st.daily) : '<p class="muted">Әлі ешкім тіркелмеген.</p>') + '</section>' +
      '</div>' +
      '<section class="card mt"><h3>Жұмыс орны бойынша</h3>' + (st.wps.length
        ? '<div class="table-wrap" style="box-shadow:none"><table class="data"><thead><tr><th>Жұмыс орны</th><th>Тіркелді</th><th>Оқып бітірді</th><th>Тест тапсырды</th><th style="width:30%">Үлесі</th></tr></thead><tbody>' +
          st.wps.map(function (w) {
            return '<tr><td>' + esc(w.name) + '</td><td class="num">' + w.reg + '</td><td class="num">' + w.read + '</td><td class="num">' + w.tested + '</td><td><div class="bar thin"><span style="width:' + pct(w.reg, maxWp) + '%"></span></div></td></tr>';
          }).join('') + '</tbody></table></div>'
        : '<p class="muted">Дерек әлі жоқ.</p>') + '</section>';
  }

  /* ================= Қатысушылар ================= */
  function tabPeople(root) {
    var wps = {};
    S.data.P.forEach(function (p) { wps[p.wp] = 1; });
    root.innerHTML =
      '<div class="head-row"><h1>Қатысушылар</h1></div>' +
      '<div class="filters">' +
      '<input class="input" id="p-q" type="search" placeholder="Аты немесе ЖСН бойынша іздеу" value="' + esc(S.filter.q) + '" aria-label="Іздеу">' +
      '<select class="input select" id="p-wp" aria-label="Жұмыс орны"><option value="">Барлық жұмыс орны</option>' + Object.keys(wps).sort().map(function (w) {
        return '<option value="' + esc(w) + '"' + (w === S.filter.wp ? ' selected' : '') + '>' + esc(w) + '</option>';
      }).join('') + '</select>' +
      '<select class="input select" id="p-st" aria-label="Күйі"><option value="">Барлық күй</option>' + Object.keys(STATUS).map(function (k) {
        return '<option value="' + k + '"' + (k === S.filter.st ? ' selected' : '') + '>' + STATUS[k] + '</option>';
      }).join('') + '</select></div>' +
      '<div id="p-list"></div>';

    var timer;
    function upd() {
      S.filter.q = $('#p-q').value.trim();
      S.filter.wp = $('#p-wp').value;
      S.filter.st = $('#p-st').value;
      S.limit = 100;
      list();
    }
    $('#p-q').addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(upd, 200); });
    $('#p-wp').addEventListener('change', upd);
    $('#p-st').addEventListener('change', upd);

    function list() {
      var q = S.filter.q.toLowerCase();
      var rows = S.data.P.filter(function (p) {
        return (!q || p.search.indexOf(q) >= 0) && (!S.filter.wp || p.wp === S.filter.wp) && (!S.filter.st || p.status === S.filter.st);
      });
      var shown = rows.slice(0, S.limit);
      var box = $('#p-list');
      box.innerHTML = '<p class="muted" style="margin-bottom:10px">Табылды: <b>' + num(rows.length) + '</b></p>' +
        (rows.length ? '<div class="table-wrap"><table class="data"><thead><tr><th>№</th><th>Аты-жөні</th><th>Жұмыс орны</th><th>ЖСН</th><th>Телефон</th><th>Тіркелген уақыты</th><th>Күйі</th><th>Ұпай</th></tr></thead><tbody>' +
          shown.map(function (p, i) {
            return '<tr><td class="num">' + (i + 1) + '</td><td><b>' + esc(p.name) + '</b></td><td>' + esc(p.wpLabel) + '</td><td class="num">' + esc(p.iin) + '</td><td class="num">' + esc(p.phone) + '</td><td class="num">' + fmtDate(p.reg) + '</td><td><span class="badge st-' + p.status + '">' + STATUS[p.status] + '</span></td><td class="num">' + (p.score == null ? '—' : esc(p.score)) + '</td></tr>';
          }).join('') + '</tbody></table></div>' : '<div class="alert alert-info">' + icon('info') + '<span>Ешкім табылмады. Іздеу сөзін немесе сүзгіні өзгертіңіз.</span></div>') +
        (rows.length > shown.length ? '<button type="button" class="btn btn-secondary mt" id="p-more">' + icon('plus') + '<span>Тағы 100 адамды көрсету</span></button>' : '');
      var more = $('#p-more');
      if (more) more.addEventListener('click', function () { S.limit += 100; list(); });
    }
    list();
  }

  /* ================= Кітаптар ================= */
  function tabBooks(root) {
    var books = JSON.parse(JSON.stringify(S.data.books || []));

    function field(i, key, label, val, type, extra) {
      var id = 'b-' + i + '-' + key;
      var inp = type === 'textarea'
        ? '<textarea class="input" id="' + id + '" data-i="' + i + '" data-k="' + key + '" maxlength="1500">' + esc(val) + '</textarea>'
        : '<input class="input" id="' + id + '" data-i="' + i + '" data-k="' + key + '" type="' + (type || 'text') + '" value="' + esc(val) + '" ' + (extra || '') + '>';
      return '<div class="field"><label for="' + id + '">' + label + '</label>' + inp + '</div>';
    }

    function draw() {
      root.innerHTML =
        '<div class="head-row"><h1>Кітаптар</h1></div>' +
        '<div class="alert alert-info" style="margin-bottom:18px">' + icon('info') + '<span>Тест сұрақтары кейін қосылады. Қазір тек кітап мәліметін өзгертуге болады.</span></div>' +
        books.map(function (b, i) {
          return '<section class="card book-edit"><div class="head-row"><h3>Кітап ' + (i + 1) + '</h3>' +
            '<button type="button" class="btn btn-ghost btn-sm" data-del="' + i + '">' + icon('trash') + '<span>Өшіру</span></button></div>' +
            '<div class="grid-2">' + field(i, 'title', 'Атауы', b.title, 'text', 'maxlength="200"') + field(i, 'author', 'Авторы', b.author, 'text', 'maxlength="200"') + '</div>' +
            field(i, 'description', 'Қысқа сипаттама', b.description, 'textarea') +
            field(i, 'url', 'Кітап файлы немесе сілтемесі (EPUB сайт ішінде ашылады)', b.url, 'text', 'placeholder="books/kitap.epub немесе https://..." autocapitalize="off" spellcheck="false"') +
            '<div class="grid-2">' + field(i, 'coverUrl', 'Мұқаба суреті (міндетті емес)', b.coverUrl, 'text', 'placeholder="img/covers/kitap.jpg" autocapitalize="off" spellcheck="false"') +
            field(i, 'coverColor', 'Мұқаба түсі', b.coverColor || '#8A3B12', 'color') + '</div>' +
            '<div class="grid-2">' + field(i, 'bookId', 'Кітап коды (латын әріптері мен сандар)', b.bookId, 'text', 'maxlength="20"') +
            field(i, 'order', 'Реті', b.order || (i + 1), 'number', 'min="1" max="999" inputmode="numeric"') + '</div>' +
            '<label class="check"><input type="checkbox" data-i="' + i + '" data-k="active"' + (b.active !== false ? ' checked' : '') + '><span class="box">' + icon('check') + '</span><span>Қатысушыларға көрсету</span></label>' +
            '</section>';
        }).join('') +
        '<div class="btn-row">' +
        '<button type="button" class="btn btn-secondary btn-sm" id="b-add">' + icon('plus') + '<span>Кітап қосу</span></button>' +
        '<button type="button" class="btn btn-primary btn-sm" id="b-save">' + icon('save') + '<span>Сақтау</span></button>' +
        '<button type="button" class="btn btn-ghost btn-sm" id="b-json">' + icon('download') + '<span>data.json жүктеу</span></button></div>' +
        '<p class="muted mt">«data.json жүктеу» міндетті емес. Ол файлды репозиторийге салсаңыз, сайт бірінші ашылғанда тезірек жүктеледі.</p>';

      $$('[data-k]', root).forEach(function (el) {
        el.addEventListener('input', function () {
          var b = books[+el.getAttribute('data-i')], k = el.getAttribute('data-k');
          b[k] = el.type === 'checkbox' ? el.checked : el.value;
        });
      });
      $$('[data-del]', root).forEach(function (el) {
        el.addEventListener('click', async function () {
          var yes = await UI.modal({ icon: 'trash', tone: 'err', title: 'Кітапты өшіресіз бе?', text: 'Өзгеріс «Сақтау» басылғаннан кейін күшіне енеді.', buttons: [{ label: 'Иә, өшіремін', value: true, kind: 'btn-danger', icon: 'trash' }, { label: 'Жоқ', value: false, kind: 'btn-ghost', icon: 'x' }] });
          if (yes) { books.splice(+el.getAttribute('data-del'), 1); draw(); }
        });
      });
      $('#b-add').addEventListener('click', function () {
        books.push({ bookId: 'b' + (books.length + 1), title: '', author: '', description: '', url: '', coverUrl: '', coverColor: '#8A3B12', active: true, order: books.length + 1 });
        draw();
      });
      $('#b-save').addEventListener('click', async function () {
        UI.setBusy(this, true, 'Сақтап жатырмыз…');
        var r = await call('adminSaveBooks', { books: books });
        UI.setBusy(this, false);
        if (r && r.ok) { S.data.books = r.books; books = JSON.parse(JSON.stringify(r.books)); draw(); UI.toast('Кітаптар сақталды.'); }
        else if (r && r.code !== 'AUTH') UI.toast(API.errorText(r), 'err');
      });
      $('#b-json').addEventListener('click', downloadDataJson);
    }
    draw();
  }

  function downloadDataJson() {
    var s = S.data.settings;
    var obj = {
      title: s.contestTitle, registrationOpen: !!s.registrationOpen, testOpen: false,
      readRequiredBeforeTest: !!s.readRequiredBeforeTest, strictIin: !!s.strictIin,
      testDurationMin: s.testDurationMin, questionCount: s.questionCount, attempts: s.attempts,
      helpText: s.helpText, workplaces: S.data.workplaces,
      books: (S.data.books || []).filter(function (b) { return b.active !== false; }).map(function (b) {
        return { bookId: b.bookId, title: b.title, author: b.author, description: b.description, url: b.url, coverUrl: b.coverUrl, coverColor: b.coverColor };
      })
    };
    saveBlob(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }), 'data.json');
  }

  /* ================= Жұмыс орындары ================= */
  function tabWp(root) {
    root.innerHTML =
      '<div class="head-row"><h1>Жұмыс орындары</h1></div>' +
      '<section class="card"><div class="field"><label for="wp-text">Тізім</label><p class="hint">Әр жолға бір жұмыс орнын жазыңыз. «Басқа» нұсқасы тізімнің соңына өзі қосылады.</p>' +
      '<textarea class="input" id="wp-text" style="min-height:320px">' + esc((S.data.workplaces || []).join('\n')) + '</textarea></div>' +
      '<button type="button" class="btn btn-primary btn-sm" id="wp-save">' + icon('save') + '<span>Сақтау</span></button></section>';
    $('#wp-save').addEventListener('click', async function () {
      var list = $('#wp-text').value.split(/\r?\n/).map(function (x) { return x.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
      if (!list.length) { UI.toast('Кемінде бір жұмыс орнын жазыңыз.', 'err'); return; }
      UI.setBusy(this, true, 'Сақтап жатырмыз…');
      var ok = await saveSettings({ workplaces: list });
      UI.setBusy(this, false);
      if (ok) { tabWp(root); UI.toast('Тізім сақталды.'); }
    });
  }

  /* ================= Баптаулар ================= */
  function toLocalInput(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function tabSettings(root) {
    var s = S.data.settings;
    function chk(key, label) {
      return '<div class="field"><label class="check"><input type="checkbox" id="s-' + key + '"' + (s[key] ? ' checked' : '') + '><span class="box">' + icon('check') + '</span><span>' + label + '</span></label></div>';
    }
    function numf(key, label, min, max) {
      return '<div class="field"><label for="s-' + key + '">' + label + '</label><input class="input" id="s-' + key + '" type="number" inputmode="numeric" min="' + min + '" max="' + max + '" value="' + esc(s[key]) + '"></div>';
    }
    root.innerHTML =
      '<div class="head-row"><h1>Баптаулар</h1></div>' +
      '<section class="card"><h3>Жалпы</h3>' +
      '<div class="field"><label for="s-contestTitle">Байқау атауы</label><input class="input" id="s-contestTitle" maxlength="120" value="' + esc(s.contestTitle) + '"></div>' +
      '<div class="field"><label for="s-helpText">Көмек мәтіні</label><p class="hint">Қатысушы сұрағы болса, кімге хабарласатынын жазыңыз.</p><textarea class="input" id="s-helpText" maxlength="300">' + esc(s.helpText) + '</textarea></div>' +
      chk('strictIin', 'ЖСН-ді қатаң тексеру (туған күні мен бақылау саны). Өшірілсе, тек 12 сан тексеріледі') +
      '</section>' +
      '<section class="card mt"><h3>Тест</h3><p class="muted" style="margin-bottom:16px">Тест бөлімі кейін қосылады. Бұл баптаулар сол кезде қолданылады.</p>' +
      chk('readRequiredBeforeTest', '«Оқып бітірдім» басылмай тест ашылмайды') +
      '<div class="grid-2">' + numf('questionCount', 'Сұрақ саны', 1, 200) + numf('testDurationMin', 'Тест уақыты (минут)', 1, 180) +
      numf('attempts', 'Тапсыру мүмкіндігі (рет)', 1, 10) + numf('graceMinutes', 'Жабылғаннан кейінгі қосымша уақыт (минут)', 0, 120) + '</div>' +
      '<div class="grid-2">' +
      '<div class="field"><label for="s-testStart">Басталу уақыты (міндетті емес)</label><input class="input" id="s-testStart" type="datetime-local" value="' + toLocalInput(s.testStart) + '"></div>' +
      '<div class="field"><label for="s-testEnd">Аяқталу уақыты (міндетті емес)</label><input class="input" id="s-testEnd" type="datetime-local" value="' + toLocalInput(s.testEnd) + '"></div></div>' +
      '<p class="muted">Жоғарыдағы «Тест» ауыстырғышы басым: ол өшірулі болса, кестеге қарамастан тест жабық.</p></section>' +
      '<button type="button" class="btn btn-primary btn-sm mt" id="s-save">' + icon('save') + '<span>Сақтау</span></button>';

    $('#s-save').addEventListener('click', async function () {
      var patch = {
        contestTitle: $('#s-contestTitle').value.trim(),
        helpText: $('#s-helpText').value.trim(),
        strictIin: $('#s-strictIin').checked,
        readRequiredBeforeTest: $('#s-readRequiredBeforeTest').checked,
        questionCount: +$('#s-questionCount').value,
        testDurationMin: +$('#s-testDurationMin').value,
        attempts: +$('#s-attempts').value,
        graceMinutes: +$('#s-graceMinutes').value,
        testStart: $('#s-testStart').value,
        testEnd: $('#s-testEnd').value
      };
      if (!patch.contestTitle) { UI.toast('Байқау атауын жазыңыз.', 'err'); return; }
      UI.setBusy(this, true, 'Сақтап жатырмыз…');
      var ok = await saveSettings(patch);
      UI.setBusy(this, false);
      if (ok) { render(); UI.toast('Баптаулар сақталды.'); }
    });
  }

  /* ================= QR-код ================= */
  function siteUrl() { return location.href.replace(/admin\.html.*$/, '').replace(/[?#].*$/, ''); }

  function tabQr(root) {
    root.innerHTML =
      '<div class="head-row"><h1>QR-код</h1></div>' +
      '<div class="qr-layout"><section class="card">' +
      '<div class="field"><label for="qr-url">Сайт сілтемесі</label><p class="hint">Қатысушылар осы сілтемеге кіреді.</p><input class="input" id="qr-url" type="url" value="' + esc(siteUrl()) + '"></div>' +
      '<div class="stack">' +
      '<button type="button" class="btn btn-primary btn-sm" style="width:100%" id="qr-make">' + icon('qr') + '<span>QR-кодты жаңарту</span></button>' +
      '<button type="button" class="btn btn-secondary btn-sm" style="width:100%" id="qr-png">' + icon('download') + '<span>PNG ретінде жүктеу</span></button>' +
      '<button type="button" class="btn btn-secondary btn-sm" style="width:100%" id="qr-poster">' + icon('printer') + '<span>Плакатты ашу және басып шығару</span></button></div>' +
      '</section><div class="qr-box" id="qr-box"></div></div>';

    function make() {
      var box = $('#qr-box');
      var url = $('#qr-url').value.trim();
      box.innerHTML = '';
      if (typeof QRCode === 'undefined') { box.innerHTML = '<p class="muted">QR кітапханасы жүктелмеді. Интернетті тексеріп, бетті жаңартыңыз.</p>'; return false; }
      if (!/^https?:\/\//i.test(url)) { box.innerHTML = '<p class="muted">Сілтеме https:// деп басталуы керек.</p>'; return false; }
      new QRCode(box, { text: url, width: 640, height: 640, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
      return true;
    }
    $('#qr-make').addEventListener('click', make);
    $('#qr-png').addEventListener('click', function () {
      if (!make()) return;
      var src = $('#qr-box canvas');
      if (!src) return;
      var m = 48, c = document.createElement('canvas');
      c.width = src.width + m * 2; c.height = src.height + m * 2;
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(src, m, m);
      c.toBlob(function (blob) { saveBlob(blob, 'qr-kod.png'); }, 'image/png');
    });
    $('#qr-poster').addEventListener('click', function () {
      var url = $('#qr-url').value.trim();
      // v= — браузер ескі (кэштегі) плакатты ашып қоймауы үшін
      window.open('poster.html?v=' + Date.now().toString(36) + '&u=' + encodeURIComponent(url) + '&t=' + encodeURIComponent(S.data.settings.contestTitle || ''), '_blank', 'noopener');
    });
    make();
  }

  /* ================= Excel есебі ================= */
  function saveBlob(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  function b64Blob(b64, type) {
    var bin = atob(b64), len = bin.length, arr = new Uint8Array(len);
    for (var i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: type });
  }

  function tabReport(root) {
    root.innerHTML =
      '<div class="head-row"><h1>Excel есебі</h1></div>' +
      '<section class="card"><p>Есепте 5 парақ бар: Қорытынды, Қатысушылар, Оқу барысы, Тест нәтижелері, Жұмыс орындары бойынша.</p>' +
      '<p class="muted" style="margin-top:8px">Дайындауға 1 минутқа дейін уақыт кетуі мүмкін. Бетті жаппаңыз.</p>' +
      '<div class="btn-row mt"><button type="button" class="btn btn-primary" style="width:auto" id="r-xlsx">' + icon('download') + '<span>Excel есебін жүктеу</span></button>' +
      '<button type="button" class="btn btn-secondary" style="width:auto" id="r-pdf"' + (S.pdf ? '' : ' hidden') + '>' + icon('file') + '<span>Қорытынды бетті PDF ретінде жүктеу</span></button></div>' +
      '<div class="alert alert-warn mt">' + icon('lock') + '<span>Есепте ЖСН мен телефон нөмірлері бар. Файлды тек жауапты адамдарға беріңіз.</span></div></section>';

    $('#r-xlsx').addEventListener('click', async function () {
      UI.setBusy(this, true, 'Есеп дайындалып жатыр…');
      var r = await call('adminExport', {}, { timeout: 300000, retries: 1 });
      UI.setBusy(this, false);
      if (r && r.ok) {
        saveBlob(b64Blob(r.xlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), r.filename);
        S.pdf = r.pdf ? { data: r.pdf, name: r.pdfName } : null;
        $('#r-pdf').hidden = !S.pdf;
        UI.toast('Есеп жүктелді.');
      } else if (r && r.code !== 'AUTH') {
        UI.toast(API.errorText(r), 'err');
      }
    });
    $('#r-pdf').addEventListener('click', function () {
      if (S.pdf) saveBlob(b64Blob(S.pdf.data, 'application/pdf'), S.pdf.name);
    });
  }

  /* ================= Іске қосу ================= */
  Icons.hydrate(document);
  if (!API.configured()) UI.banner('js/config.js файлына Apps Script сілтемесі қойылмаған.');
  if (S.token) {
    $('#admin-view').hidden = false;
    loadData();
  } else {
    showLogin('');
  }
})();
