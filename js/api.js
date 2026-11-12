/* Сервермен (Apps Script) байланыс.
   - Сұраныс сәтсіз болса, өзі бірнеше рет қайталайды (күту уақыты әр жолы екі есе өседі).
   - Сервер бос болмаса, 10 секундтан кейін қайталайды.
   - Оқиғалар (кітапты ашты, оқып бітірді) телефонда кезекке тұрады, байланыс үзілсе жоғалмайды. */
(function () {
  'use strict';

  var LS = {
    get: function (key, def) {
      try {
        var v = localStorage.getItem(key);
        return v == null ? (def === undefined ? null : def) : JSON.parse(v);
      } catch (e) { return def === undefined ? null : def; }
    },
    set: function (key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* жад толы */ } },
    del: function (key) { try { localStorage.removeItem(key); } catch (e) { /* елемейміз */ } }
  };

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function apiUrl() { return (window.APP_CONFIG || {}).API_URL || ''; }
  function configured() { return /^https:\/\/script\.google(usercontent)?\.com\//.test(apiUrl()); }

  /* Бір сұраныс. Әрқашан {ok:..., code:...} түріндегі нысан қайтарады, қате лақтырмайды. */
  async function once(method, payload, timeoutMs) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeoutMs);
    try {
      var res;
      if (method === 'GET') {
        var q = Object.keys(payload).map(function (k) {
          return encodeURIComponent(k) + '=' + encodeURIComponent(payload[k]);
        }).join('&');
        res = await fetch(apiUrl() + '?' + q, { signal: ctrl ? ctrl.signal : undefined });
      } else {
        // text/plain жіберіледі: сонда браузер алдын ала тексеру сұранысын (preflight) жасамайды
        res = await fetch(apiUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload),
          signal: ctrl ? ctrl.signal : undefined
        });
      }
      if (res.status === 429 || res.status === 503) return { ok: false, code: 'BUSY' };
      var text = await res.text();
      try {
        var data = JSON.parse(text);
        if (data && typeof data === 'object') return data;
        return { ok: false, code: 'NETWORK' };
      } catch (e) {
        // Сервер жүктемеден асқанда JSON орнына қате беті келеді
        return { ok: false, code: 'BUSY' };
      }
    } catch (e) {
      return { ok: false, code: 'NETWORK' };
    } finally {
      clearTimeout(timer);
    }
  }

  /* Қайталауы бар сұраныс.
     opts: method ('POST'|'GET'), retries (қайталау саны), silent (хабарлама көрсетпеу), timeout (мс) */
  async function call(action, data, opts) {
    opts = opts || {};
    if (!configured()) {
      return { ok: false, code: 'NOT_CONFIGURED', message: 'Сайт әлі толық бапталмаған. Ұйымдастырушыға хабарласыңыз.' };
    }
    var payload = { action: action };
    Object.keys(data || {}).forEach(function (k) { payload[k] = data[k]; });
    var max = opts.retries == null ? 6 : opts.retries;
    var attempt = 0;

    while (true) {
      var r = await once(opts.method || 'POST', payload, opts.timeout || 30000);
      var retryable = r && r.ok === false && (r.code === 'NETWORK' || r.code === 'BUSY');
      if (!retryable) { if (!opts.silent) UI.hideBanner(); return r; }
      attempt++;
      if (attempt > max) { if (!opts.silent) UI.hideBanner(); return r; }

      var wait;
      if (r.code === 'BUSY') {
        wait = 10000;
        if (!opts.silent) UI.banner('Көп адам кіріп жатыр, 10 секундтан кейін қайта байқаймыз');
      } else {
        // 1, 2, 4, 8, 16, 30 секунд және кездейсоқ ауытқу
        wait = Math.min(30000, 1000 * Math.pow(2, attempt - 1)) * (0.75 + Math.random() * 0.5);
        if (!opts.silent) UI.banner('Байланыс әлсіз, қайта байқап жатырмыз');
      }
      await sleep(wait);
    }
  }

  function get(action, data, opts) {
    opts = opts || {};
    opts.method = 'GET';
    return call(action, data, opts);
  }

  /* Қатеге арналған қарапайым мәтін */
  function errorText(r) {
    if (!r) return 'Қате шықты. Қайта байқаңыз.';
    if (r.code === 'NETWORK') return 'Байланыс жоқ. Интернетті тексеріп, батырманы қайта басыңыз.';
    if (r.code === 'BUSY') return 'Қазір көп адам кіріп жатыр. Бір минуттан кейін қайта басыңыз.';
    return r.message || 'Қате шықты. Қайта байқаңыз.';
  }

  /* ----- Оқиғалар кезегі ----- */
  var flushing = false;
  var listeners = [];

  var Queue = {
    push: function (type, bookId) {
      var q = LS.get('kb_queue', []);
      q.push({ eid: uid(), type: type, bookId: bookId || '', ts: Date.now() });
      LS.set('kb_queue', q);
      return Queue.flush();
    },
    size: function () { return LS.get('kb_queue', []).length; },
    onSync: function (fn) { listeners.push(fn); },
    flush: async function () {
      if (flushing) return;
      var user = LS.get('kb_user');
      var q = LS.get('kb_queue', []);
      if (!user || !user.pid || !q.length || !configured()) return;
      flushing = true;
      try {
        var batch = q.slice(0, 20);
        var r = await call('logEvents', { pid: user.pid, sig: user.sig, events: batch }, { silent: true, retries: 5 });
        if (r && r.ok) {
          var sent = {};
          batch.forEach(function (e) { sent[e.eid] = true; });
          LS.set('kb_queue', LS.get('kb_queue', []).filter(function (e) { return !sent[e.eid]; }));
          listeners.forEach(function (fn) { try { fn(r.user); } catch (e) { /* елемейміз */ } });
        } else if (r && r.code === 'AUTH') {
          LS.del('kb_queue');
        }
      } finally {
        flushing = false;
      }
      if (LS.get('kb_queue', []).length && navigator.onLine !== false) setTimeout(Queue.flush, 1500);
    }
  };

  window.addEventListener('online', function () { Queue.flush(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) Queue.flush(); });

  window.API = {
    call: call, get: get, errorText: errorText, configured: configured,
    LS: LS, Queue: Queue, uid: uid
  };
})();
