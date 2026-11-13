/* Ортақ интерфейс бөліктері: белгішелер, терезелер, хабарламалар.
   Қатысушы беттері де, әкімші панелі де осы файлды қолданады. */
(function () {
  'use strict';

  var PATHS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9v12h14V9"/><path d="M10 21v-6h4v6"/>',
    book: '<path d="M4 19.5V5a2 2 0 0 1 2-2h13v14H6a2 2 0 0 0-2 2.5 2 2 0 0 0 2 1.5h13"/><path d="M8.5 7.5H15"/>',
    test: '<rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 2.5h6v3H9z"/><path d="m9 13.5 2 2 4-4"/>',
    award: '<circle cx="12" cy="9" r="6"/><path d="m8.6 13.8-1.6 8.2 5-3 5 3-1.6-8.2"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4.5M16 6h3a3 3 0 0 1-3 4.5"/><path d="M12 13v4M8 21h8M9.5 17h5"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    arrowright: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    arrowleft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    userplus: '<circle cx="10" cy="8" r="4"/><path d="M3 21a7 7 0 0 1 14 0"/><path d="M19 8v6M16 11h6"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>',
    login: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M3 12h11M10 8l4 4-4 4"/>',
    logout: '<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="M21 12H10M17 8l4 4-4 4"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.9-3M4 13a8 8 0 0 0 14.9 3"/><path d="M4 4v4h4M20 20v-4h-4"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 20h14"/>',
    qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM21 14v.01M14 21h.01M17.5 21H21v-3.5"/>',
    settings: '<path d="M4 6h8M16 6h4M4 12h3M11 12h9M4 18h10M18 18h2"/><circle cx="14" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
    chart: '<path d="M3 21h18"/><rect x="5" y="11" width="3" height="7"/><rect x="10.5" y="6" width="3" height="12"/><rect x="16" y="13" width="3" height="5"/>',
    alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    'chevron-up': '<path d="m6 15 6-6 6 6"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    printer: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    building: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2M10 21v-3h4v3"/>',
    phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
    id: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16a3 3 0 0 1 6 0M14 10h4M14 14h3"/>',
    play: '<path d="M7 4v16l13-8z"/>',
    save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h8M8 21v-7h8v7"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
    star: '<path d="m12 3 2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4l-5.3 3 1.2-6L3.4 9.3l6-.7z"/>',
    file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 13h6M9 17h6"/>',
    maximize: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    minimize: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
    share: '<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 12v8h14v-8"/>'
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function svg(name, cls) {
    var p = PATHS[name] || PATHS.info;
    return '<svg class="ic ' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + p + '</svg>';
  }

  /* HTML ішіндегі <i data-icon="book"></i> белгілерін SVG-ге ауыстырады */
  function hydrate(root) {
    var list = (root || document).querySelectorAll('i[data-icon]');
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      el.outerHTML = svg(el.getAttribute('data-icon'), el.className);
    }
  }

  /* Үлкен батырмалы сұрау терезесі. Promise қайтарады: басылған батырманың value мәні */
  function modal(opts) {
    return new Promise(function (resolve) {
      var wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML =
        '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">' +
        (opts.icon ? '<div class="modal-icon tone-' + (opts.tone || 'accent') + '">' + svg(opts.icon) + '</div>' : '') +
        '<h2 id="modal-title">' + esc(opts.title) + '</h2>' +
        (opts.text ? '<p>' + esc(opts.text) + '</p>' : '') +
        '<div class="modal-actions"></div></div>';
      var actions = wrap.querySelector('.modal-actions');
      var done = false;

      function close(value) {
        if (done) return;
        done = true;
        document.removeEventListener('keydown', onKey);
        wrap.classList.add('closing');
        setTimeout(function () { wrap.remove(); }, 180);
        resolve(value);
      }
      function onKey(e) { if (e.key === 'Escape') close(null); }

      (opts.buttons || [{ label: 'Түсінікті', value: true, icon: 'check' }]).forEach(function (b) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn ' + (b.kind || 'btn-primary');
        btn.innerHTML = (b.icon ? svg(b.icon) : '') + '<span>' + esc(b.label) + '</span>';
        btn.addEventListener('click', function () { close(b.value); });
        actions.appendChild(btn);
      });

      wrap.addEventListener('click', function (e) { if (e.target === wrap) close(null); });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(wrap);
      setTimeout(function () {
        var first = actions.querySelector('button');
        if (first) first.focus();
      }, 60);
    });
  }

  function toast(text, tone) {
    var box = document.getElementById('toast-box');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toast-box';
      box.className = 'toast-box';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    var t = document.createElement('div');
    t.className = 'toast tone-' + (tone || 'ok');
    t.innerHTML = svg(tone === 'err' ? 'alert' : 'check') + '<span>' + esc(text) + '</span>';
    box.appendChild(t);
    setTimeout(function () { t.classList.add('hide'); }, 3600);
    setTimeout(function () { t.remove(); }, 4000);
  }

  /* Беттің жоғарғы жағындағы байланыс хабарламасы */
  function banner(text) {
    var el = document.getElementById('net-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'net-banner';
      el.className = 'net-banner';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.innerHTML = '<span class="spin" aria-hidden="true"></span><span>' + esc(text) + '</span>';
    el.classList.add('show');
  }
  function hideBanner() {
    var el = document.getElementById('net-banner');
    if (el) el.classList.remove('show');
  }

  /* Батырманы «күту» күйіне ауыстырады */
  function setBusy(btn, busy, text) {
    if (!btn) return;
    if (busy) {
      if (btn.getAttribute('data-html') == null) btn.setAttribute('data-html', btn.innerHTML);
      btn.disabled = true;
      btn.innerHTML = '<span class="spin" aria-hidden="true"></span><span>' + esc(text || 'Күте тұрыңыз…') + '</span>';
    } else {
      btn.disabled = false;
      var html = btn.getAttribute('data-html');
      if (html != null) { btn.innerHTML = html; btn.removeAttribute('data-html'); }
    }
  }

  window.Icons = { svg: svg, hydrate: hydrate };
  window.UI = { esc: esc, modal: modal, toast: toast, banner: banner, hideBanner: hideBanner, setBusy: setBusy };
})();
