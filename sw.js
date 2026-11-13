/* Service worker: сайтты телефонның басты экранына қосуға мүмкіндік береді және
   байланыс үзілгенде соңғы ашылған беттерді жадтан көрсетеді.
   Әрқашан алдымен желіден алады (жаңа нұсқа бірден көрінеді), желі жоқ болса ғана жадтан береді.
   Кітап файлдары (.epub) мұнда сақталмайды — оларды оқу беті өзі сақтайды. */
var CACHE = 'kb-shell-v2';

self.addEventListener('install', function () { self.skipWaiting(); });

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('kb-shell-') === 0 && k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // сервер (Apps Script) және қаріптер — тікелей
  if (/\.epub$/i.test(url.pathname)) return;
  // Беттер, скрипттер, стильдер мен деректер: браузер кэшіне сенбей, серверден тексереміз
  // (GitHub Pages 10 минут кэштейді — сондықтан жаңартулар кешігіп көрінетін).
  var fresh = req.mode === 'navigate' || /\.(html|js|css|json)$/i.test(url.pathname) || /\/$/.test(url.pathname);
  e.respondWith(
    (fresh ? fetch(req, { cache: 'no-cache' }) : fetch(req)).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(function (hit) {
        return hit || (req.mode === 'navigate' ? caches.match('index.html') : undefined) || Response.error();
      });
    })
  );
});
