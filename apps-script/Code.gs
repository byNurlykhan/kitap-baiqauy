/**
 * КІТАП ОҚУ БАЙҚАУЫ — сервер бөлігі (Google Apps Script, Web App)
 *
 * Орнату реті (толығырақ README.md ішінде):
 *   1. Google Sheets кестесін ашыңыз → Кеңейтімдер → Apps Script → осы кодты қойыңыз.
 *   2. setup() функциясын бір рет іске қосыңыз (парақтарды өзі жасайды).
 *   3. Жоба баптаулары → Script Properties → ADMIN_PASSWORD қосыңыз.
 *   4. Deploy → Web app (Execute as: Me, Who has access: Anyone).
 *
 * Құпия мәліметтер (құпиясөз, қол қою кілті) тек Script Properties ішінде сақталады.
 * ЕСКЕРТУ: тесттің ішкі бөлігі (сұрақ беру, ұпай есептеу) кейін бөлек қосылады.
 *          Questions және Results парақтары соған дайын тұр.
 */

/* ============================ ТҰРАҚТЫЛАР ============================ */

const SH = { P: 'Participants', B: 'Books', Q: 'Questions', PR: 'Progress', R: 'Results', S: 'Settings' };

const P_HEAD = ['ID', 'ЖСН', 'Аты-жөні', 'Аты', 'Жұмыс орны', 'Басқа жұмыс орны', 'Телефон', 'Тіркелген уақыты',
  'Кітапты ашты', 'Оқып бітірді', 'Тестті бастады', 'Тестті аяқтады', 'Ұпай (%)', 'Дұрыс жауап', 'Тест уақыты (сек)',
  'Соңғы белсенділік', 'Кітап ID'];
const PC = { pid: 0, iin: 1, fullName: 2, firstName: 3, workplace: 4, workplaceOther: 5, phone: 6, registeredAt: 7,
  bookOpenedAt: 8, readFinishedAt: 9, testStartedAt: 10, testFinishedAt: 11, score: 12, correct: 13, durationSec: 14,
  lastSeenAt: 15, bookId: 16 };

const B_HEAD = ['bookId', 'Атауы', 'Авторы', 'Сипаттама', 'Сілтеме (PDF немесе бет)', 'Мұқаба суреті (URL)', 'Мұқаба түсі', 'Белсенді', 'Реті'];
const Q_HEAD = ['qId', 'bookId', 'Сұрақ', 'A нұсқасы', 'B нұсқасы', 'C нұсқасы', 'D нұсқасы', 'Дұрыс жауап (A/B/C/D)', 'Белсенді'];
const PR_HEAD = ['Уақыты', 'Қатысушы ID', 'Оқиға коды', 'Оқиға', 'Кітап ID', 'Оқиға ID'];
const R_HEAD = ['attemptId', 'Қатысушы ID', 'bookId', 'Басталды', 'Аяқталу мерзімі', 'Аяқталды', 'Сұрақтар реті',
  'Жауаптар', 'Дұрыс', 'Барлығы', 'Ұпай (%)', 'Уақыт (сек)', 'Күйі'];
const S_HEAD = ['Кілт', 'Мәні', 'Түсініктеме'];

const OTHER = 'Басқа';
const EVENT_LABELS = {
  registered: 'Тіркелді',
  book_opened: 'Кітапты ашты (оқуды бастады)',
  read_finished: 'Оқып бітірдім деп белгіледі',
  test_started: 'Тестті бастады',
  test_finished: 'Тестті аяқтады'
};
const STATUS_LABELS = { registered: 'Тіркелген', reading: 'Оқып жатыр', read: 'Оқып бітірген', tested: 'Тест тапсырған' };

const DEFAULT_WORKPLACES = ['Басқару аппараты', 'Мұнай-газ өндіру басқармасы №1', 'Мұнай-газ өндіру басқармасы №2',
  'Мұнай-газ өндіру басқармасы №3', 'Жөндеу және қызмет көрсету цехы', 'Көлік цехы', 'Энергетика қызметі'];

/* [кілт, бастапқы мәні, түрі, түсініктеме, ең азы, ең көбі] */
const SETTINGS_DEF = [
  ['contestTitle', 'Кітап оқитын ұлт', 'str', 'Байқау атауы (сайтта және есепте көрінеді)', 0, 120],
  ['registrationOpen', true, 'bool', 'Тіркелу ашық па: TRUE — ашық, FALSE — жабық'],
  ['testOpen', false, 'bool', 'Тесттің басты ауыстырғышы: TRUE — ашық, FALSE — жабық'],
  ['testStart', '', 'date', 'Тест басталатын уақыт (міндетті емес). Мысалы: 2026-12-01 09:00'],
  ['testEnd', '', 'date', 'Тест аяқталатын уақыт (міндетті емес)'],
  ['readRequiredBeforeTest', true, 'bool', 'TRUE — «Оқып бітірдім» басылмай тест ашылмайды'],
  ['strictIin', true, 'bool', 'TRUE — ЖСН-нің туған күні мен бақылау саны тексеріледі. FALSE — тек 12 сан'],
  ['graceMinutes', 5, 'int', 'Тест жабылғаннан кейін басталған тестті аяқтауға берілетін қосымша минут', 0, 120],
  ['testDurationMin', 20, 'int', 'Тестке берілетін уақыт (минут)', 1, 180],
  ['questionCount', 10, 'int', 'Әр қатысушыға берілетін сұрақ саны', 1, 200],
  ['attempts', 1, 'int', 'Тест тапсыру мүмкіндігі (рет)', 1, 10],
  ['helpText', 'Сұрағыңыз болса, бөліміңіздегі ұйымдастырушыға хабарласыңыз.', 'str', 'Көмек карточкасындағы мәтін', 0, 300],
  ['workplaces', DEFAULT_WORKPLACES.join('\n'), 'list', 'Жұмыс орындары: әр жолда біреу. «Басқа» нұсқасы өзі қосылады']
];

const CACHE_KEYS = ['settings', 'config', 'rating'];

/* ============================ БІРІНШІ ІСКЕ ҚОСУ ============================ */

/** Барлық парақты жасайды. Бір рет қолмен іске қосыңыз. Қайта қоссаңыз, бар деректерге тимейді. */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Бұл скриптті Google Sheets ішінен ашыңыз: Кеңейтімдер → Apps Script.');
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SPREADSHEET_ID', ss.getId());
  if (!props.getProperty('TOKEN_SECRET')) props.setProperty('TOKEN_SECRET', Utilities.getUuid() + Utilities.getUuid());
  ss.setSpreadsheetTimeZone(Session.getScriptTimeZone());

  const dateFmt = 'dd.mm.yyyy hh:mm';

  const p = ensureSheet_(ss, SH.P, P_HEAD, [110, 130, 260, 120, 220, 180, 140, 140, 140, 140, 140, 140, 80, 90, 110, 140, 80]);
  p.getRange('B:B').setNumberFormat('@'); // ЖСН — мәтін, әйтпесе басындағы 0 жоғалады
  p.getRange('G:G').setNumberFormat('@'); // Телефон — мәтін
  p.getRange('H2:L').setNumberFormat(dateFmt);
  p.getRange('P2:P').setNumberFormat(dateFmt);

  const b = ensureSheet_(ss, SH.B, B_HEAD, [80, 220, 200, 380, 300, 240, 110, 90, 60]);
  if (b.getLastRow() < 2) {
    b.getRange(2, 1, 1, B_HEAD.length).setValues([[
      'b1', 'Қара сөздер', 'Абай Құнанбайұлы',
      'СЫНАҚ КІТАБЫ. Ұлы ақынның өмір, еңбек, білім және адамгершілік туралы қысқа ой-толғаулары.\nӘр сөзді бөлек оқуға болады.',
      'https://example.com/kitap.pdf', '', '#1B3A70', true, 1
    ]]);
  }

  ensureSheet_(ss, SH.Q, Q_HEAD, [70, 70, 420, 200, 200, 200, 200, 150, 90]);

  const pr = ensureSheet_(ss, SH.PR, PR_HEAD, [140, 120, 130, 260, 80, 170]);
  pr.getRange('A2:A').setNumberFormat(dateFmt);

  const r = ensureSheet_(ss, SH.R, R_HEAD, [150, 120, 70, 140, 140, 140, 200, 200, 70, 70, 80, 90, 90]);
  r.getRange('D2:F').setNumberFormat(dateFmt);

  const s = ensureSheet_(ss, SH.S, S_HEAD, [220, 320, 560]);
  s.getRange('B:B').setWrap(true).setVerticalAlignment('top');
  const have = {};
  if (s.getLastRow() > 1) {
    s.getRange(2, 1, s.getLastRow() - 1, 1).getValues().forEach(function (row) { have[String(row[0]).trim()] = true; });
  }
  const add = SETTINGS_DEF.filter(function (d) { return !have[d[0]]; }).map(function (d) { return [d[0], d[1], d[3]]; });
  if (add.length) s.getRange(s.getLastRow() + 1, 1, add.length, 3).setValues(add);

  // Google өзі жасаған бос парақты алып тастаймыз
  const ours = Object.keys(SH).map(function (k) { return SH[k]; });
  ss.getSheets().forEach(function (sh) {
    if (ours.indexOf(sh.getName()) < 0 && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });

  CacheService.getScriptCache().removeAll(CACHE_KEYS);
  Logger.log('Дайын. Енді: 1) Script Properties ішіне ADMIN_PASSWORD қосыңыз; 2) Deploy → New deployment → Web app.');
}

function ensureSheet_(ss, name, head, widths) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, head.length).setValues([head]);
  sh.getRange(1, 1, 1, head.length).setFontWeight('bold').setBackground('#0B1E3E').setFontColor('#FFFFFF').setWrap(true).setVerticalAlignment('middle');
  sh.setFrozenRows(1);
  (widths || []).forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  return sh;
}

/**
 * Қатысушылардың БАРЛЫҚ дерегін өшіреді (Participants, Progress, Results).
 * Сынақтан кейін немесе байқау біткен соң қолмен іске қосыңыз. Кері қайтарылмайды!
 * Кітаптар, сұрақтар және баптаулар сақталады.
 */
function clearParticipantData() {
  const ss = ss_();
  [SH.P, SH.PR, SH.R].forEach(function (name) {
    const sh = ss.getSheetByName(name);
    if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  });
  CacheService.getScriptCache().removeAll(CACHE_KEYS);
  Logger.log('Қатысушылар дерегі өшірілді.');
}

/* ============================ КІРУ НҮКТЕЛЕРІ ============================ */

const PUBLIC_GET = { getConfig: true, getRating: true, ping: true };

function doGet(e) {
  const req = (e && e.parameter) || {};
  if (!PUBLIC_GET[req.action]) return json_({ ok: false, code: 'BAD_REQUEST', message: 'Белгісіз әрекет.' });
  return handle_(req);
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, code: 'BAD_REQUEST', message: 'Сұраныс қате жіберілді.' });
  }
  if (!req || typeof req !== 'object') return json_({ ok: false, code: 'BAD_REQUEST', message: 'Сұраныс қате жіберілді.' });
  return handle_(req);
}

function handle_(req) {
  const routes = {
    ping: function () { return { ok: true, time: Date.now() }; },
    getConfig: apiGetConfig_,
    getRating: apiGetRating_,
    register: apiRegister_,
    login: apiLogin_,
    me: apiMe_,
    logEvents: apiLogEvents_,
    adminLogin: apiAdminLogin_,
    adminLogout: admin_(apiAdminLogout_),
    adminData: admin_(apiAdminData_),
    adminSaveSettings: admin_(apiAdminSaveSettings_),
    adminSaveBooks: admin_(apiAdminSaveBooks_),
    adminExport: admin_(apiAdminExport_)
  };
  try {
    const fn = routes[String(req.action || '')];
    if (!fn) return json_({ ok: false, code: 'BAD_REQUEST', message: 'Белгісіз әрекет.' });
    return json_(fn(req));
  } catch (err) {
    if (err && err.appCode) return json_({ ok: false, code: err.appCode, message: err.message, field: err.field || '' });
    const msg = String((err && err.message) || err);
    if (/lock|timed? ?out|too many|simultaneous|Service invoked/i.test(msg)) {
      return json_({ ok: false, code: 'BUSY', message: 'Көп адам кіріп жатыр.' });
    }
    console.error(msg, err && err.stack);
    return json_({ ok: false, code: 'SERVER', message: 'Серверде қате шықты. Сәлден соң қайта байқаңыз.' });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function fail_(code, message, field) {
  const e = new Error(message);
  e.appCode = code;
  e.field = field || '';
  throw e;
}

/* ============================ КӨМЕКШІ ФУНКЦИЯЛАР ============================ */

let SS_CACHE = null;
function ss_() {
  if (SS_CACHE) return SS_CACHE;
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  SS_CACHE = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  return SS_CACHE;
}
function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) fail_('SETUP', 'Кесте дайын емес. Алдымен setup() функциясын іске қосыңыз.');
  return sh;
}

/** Жазу операцияларын кезекке қояды: бір уақытта тек бір жазу орындалады. */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) fail_('BUSY', 'Көп адам кіріп жатыр.');
  try { return fn(); } finally { lock.releaseLock(); }
}

/** Мәтінді тазалайды: басқару таңбаларын алып тастайды, ұзындығын шектейді. */
function clean_(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 200);
}
function cleanMultiline_(v, max) {
  return String(v == null ? '' : v).replace(/\r/g, '').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ').trim().slice(0, max || 1500);
}
/** Формулалық инъекциядан қорғау: = + - @ деп басталатын мәтін формула болып кетпеуі үшін алдына ' қойылады. */
function safe_(v) {
  if (typeof v !== 'string') return v;
  return /^[=+\-@\t]/.test(v) ? "'" + v : v;
}
function digits_(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }
function date_(v) { return (v instanceof Date && !isNaN(v.getTime())) ? v : null; }
function ms_(v) { const d = date_(v); return d ? d.getTime() : null; }
function num_(v) { return (v === '' || v == null || isNaN(Number(v))) ? null : Number(v); }

function parseDate_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})/.exec(s);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]);
  return null;
}

/** Бағаннан мәнді жылдам іздейді (4000 жолда да тез). Жол нөмірін немесе 0 қайтарады. */
function findRow_(sh, col, value) {
  const n = sh.getLastRow();
  if (n < 2 || !value) return 0;
  const cell = sh.getRange(2, col, n - 1, 1).createTextFinder(String(value)).matchEntireCell(true).findNext();
  return cell ? cell.getRow() : 0;
}

/** Парақта жол жетпесе, алдын ала қосады (жаңа парақта бар болғаны 1000 жол болады). */
function ensureRows_(sh, lastNeeded) {
  const max = sh.getMaxRows();
  if (lastNeeded > max) sh.insertRowsAfter(max, Math.max(lastNeeded - max, 500));
}

function sign_(pid) {
  const secret = PropertiesService.getScriptProperties().getProperty('TOKEN_SECRET');
  if (!secret) fail_('SETUP', 'Кесте дайын емес. Алдымен setup() функциясын іске қосыңыз.');
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(String(pid), secret));
}
function checkSig_(req) {
  const pid = String(req.pid || '');
  if (!/^P[a-f0-9]{12}$/.test(pid) || String(req.sig || '') !== sign_(pid)) {
    fail_('AUTH', 'Қайта кіру керек. ЖСН арқылы кіріңіз.');
  }
  return pid;
}

/* ============================ БАПТАУЛАР ============================ */

function coerce_(v, type, def) {
  if (type === 'bool') {
    if (v === '' || v == null) return !!def;
    return v === true || /^(true|1|иә|ия|yes)$/i.test(String(v).trim());
  }
  if (type === 'int') {
    const n = parseInt(v, 10);
    return isNaN(n) ? def : n;
  }
  if (type === 'date') {
    const d = parseDate_(v);
    return d ? d.getTime() : null;
  }
  if (type === 'list') {
    return String(v == null ? '' : v).split(/\r?\n/).map(function (x) { return x.trim(); })
      .filter(function (x) { return x && x !== OTHER; });
  }
  return String(v == null ? '' : v);
}

function getSettings_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('settings');
  if (hit) return JSON.parse(hit);
  const sh = sheet_(SH.S);
  const n = sh.getLastRow();
  const raw = {};
  if (n > 1) sh.getRange(2, 1, n - 1, 2).getValues().forEach(function (r) { if (r[0]) raw[String(r[0]).trim()] = r[1]; });
  const s = {};
  SETTINGS_DEF.forEach(function (d) {
    s[d[0]] = coerce_(Object.prototype.hasOwnProperty.call(raw, d[0]) ? raw[d[0]] : d[1], d[2], d[1]);
  });
  cache.put('settings', JSON.stringify(s), 60);
  return s;
}

/** Қолмен ауыстырғыш басым: ол өшірулі болса, кестеге қарамастан тест жабық. */
function isTestOpen_(s) {
  if (!s.testOpen) return false;
  const now = Date.now();
  if (s.testStart && now < s.testStart) return false;
  if (s.testEnd && now > s.testEnd) return false;
  return true;
}

function getBooks_(activeOnly) {
  const sh = sheet_(SH.B);
  const n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, B_HEAD.length).getValues()
    .filter(function (r) { return String(r[0]).trim(); })
    .map(function (r) {
      const color = String(r[6]).trim();
      return {
        bookId: String(r[0]).trim(), title: String(r[1]), author: String(r[2]), description: String(r[3]),
        url: String(r[4]).trim(), coverUrl: String(r[5]).trim(),
        coverColor: /^#[0-9a-f]{6}$/i.test(color) ? color : '#8A3B12',
        active: coerce_(r[7], 'bool', true), order: Number(r[8]) || 0
      };
    })
    .filter(function (b) { return !activeOnly || b.active; })
    .sort(function (a, b) { return a.order - b.order; });
}

/* ============================ ЖАЛПЫ (АШЫҚ) ӘРЕКЕТТЕР ============================ */

function apiGetConfig_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('config');
  if (hit) return { ok: true, config: JSON.parse(hit) };
  const s = getSettings_();
  const config = {
    title: s.contestTitle,
    registrationOpen: s.registrationOpen,
    testOpen: isTestOpen_(s),
    readRequiredBeforeTest: s.readRequiredBeforeTest,
    strictIin: s.strictIin,
    testDurationMin: s.testDurationMin,
    questionCount: s.questionCount,
    attempts: s.attempts,
    helpText: s.helpText,
    workplaces: s.workplaces,
    books: getBooks_(true).map(function (b) {
      return { bookId: b.bookId, title: b.title, author: b.author, description: b.description, url: b.url, coverUrl: b.coverUrl, coverColor: b.coverColor };
    })
  };
  cache.put('config', JSON.stringify(config), 120);
  return { ok: true, config: config };
}

function iinError_(iin, strict) {
  if (!iin) return 'ЖСН жазыңыз.';
  if (!/^\d+$/.test(iin)) return 'ЖСН тек сандардан тұруы керек.';
  if (iin.length !== 12) return 'ЖСН 12 саннан тұруы керек. Қазір ' + iin.length + ' сан енгізілді.';
  if (!strict) return '';
  const bad = 'ЖСН қате жазылған сияқты. Сандарды жеке куәлігіңізбен салыстырып, қайта жазыңыз.';
  const yy = +iin.slice(0, 2), mm = +iin.slice(2, 4), dd = +iin.slice(4, 6), c = +iin.charAt(6);
  if (c < 1 || c > 6) return bad;
  const year = (c <= 2 ? 1800 : c <= 4 ? 1900 : 2000) + yy;
  if (mm < 1 || mm > 12) return bad;
  if (dd < 1 || dd > new Date(year, mm, 0).getDate()) return bad;
  const d = iin.split('').map(Number);
  let s = 0, i;
  for (i = 0; i < 11; i++) s += d[i] * (i + 1);
  let k = s % 11;
  if (k === 10) {
    const w2 = [3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2];
    s = 0;
    for (i = 0; i < 11; i++) s += d[i] * w2[i];
    k = s % 11;
    if (k === 10) return bad;
  }
  return k === d[11] ? '' : bad;
}

function titleCase_(name) {
  return name.split(' ').map(function (w) {
    return w.split('-').map(function (p) { return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : p; }).join('-');
  }).join(' ');
}

function wpLabelRow_(r) {
  const wp = String(r[PC.workplace] || '');
  const other = String(r[PC.workplaceOther] || '');
  return wp === OTHER && other ? other : wp;
}

/** Қатысушыға қайтарылатын дерек. ЖСН мен телефон ЕШҚАШАН қайтарылмайды. */
function publicUser_(r) {
  const pid = String(r[PC.pid]);
  const score = num_(r[PC.score]);
  const finished = ms_(r[PC.testFinishedAt]);
  const u = {
    pid: pid, sig: sign_(pid),
    fullName: String(r[PC.fullName]), firstName: String(r[PC.firstName]), workplace: wpLabelRow_(r),
    registeredAt: ms_(r[PC.registeredAt]), bookOpenedAt: ms_(r[PC.bookOpenedAt]), readFinishedAt: ms_(r[PC.readFinishedAt]),
    testStartedAt: ms_(r[PC.testStartedAt]), testFinishedAt: finished,
    score: score, correct: num_(r[PC.correct]), durationSec: num_(r[PC.durationSec]),
    bookId: String(r[PC.bookId] || ''), rank: null
  };
  if (finished && score != null) u.rank = rankFor_(score, u.durationSec || 0);
  return u;
}

function apiRegister_(req) {
  const s = getSettings_();
  const iin = digits_(req.iin).slice(0, 20);
  const iinErr = iinError_(iin, s.strictIin);
  if (iinErr) fail_('VALIDATION', iinErr, 'iin');

  const sh = sheet_(SH.P);
  // Бұрын тіркелген болса, жаңа жазба жасалмайды — сол адам кіргізіледі
  let row = findRow_(sh, PC.iin + 1, iin);
  if (row) return { ok: true, existing: true, user: publicUser_(sh.getRange(row, 1, 1, P_HEAD.length).getValues()[0]) };

  if (!s.registrationOpen) fail_('REG_CLOSED', 'Тіркелу қазір жабық.');

  let fullName = clean_(req.fullName, 100);
  if (!/^[A-Za-zЀ-ӿ\s.'’ʼ-]+$/.test(fullName)) fail_('VALIDATION', 'Аты-жөнінде тек әріптер болуы керек.', 'fullName');
  const words = fullName.split(' ').filter(function (w) { return w.replace(/[^A-Za-zЀ-ӿ]/g, '').length >= 2; });
  if (words.length < 2) fail_('VALIDATION', 'Тегіңізді де, атыңызды да жазыңыз.', 'fullName');
  fullName = titleCase_(fullName);
  const firstName = titleCase_(words[1]);

  let workplace = clean_(req.workplace, 100);
  let workplaceOther = '';
  if (workplace === OTHER) {
    workplaceOther = clean_(req.workplaceOther, 100);
    if (workplaceOther.length < 2) fail_('VALIDATION', 'Жұмыс орныңыздың атауын жазыңыз.', 'workplaceOther');
  } else if (s.workplaces.indexOf(workplace) < 0) {
    fail_('VALIDATION', 'Жұмыс орныңызды тізімнен таңдаңыз.', 'workplace');
  }

  let phone = digits_(req.phone);
  if (phone.length === 11 && (phone.charAt(0) === '7' || phone.charAt(0) === '8')) phone = phone.slice(1);
  if (phone.length !== 10) fail_('VALIDATION', 'Телефон нөмірі толық емес. +7 кейін 10 сан болуы керек.', 'phone');
  phone = '+7' + phone;

  if (req.consent !== true) fail_('VALIDATION', 'Жалғастыру үшін келісім белгісін қойыңыз.', 'consent');

  return withLock_(function () {
    row = findRow_(sh, PC.iin + 1, iin); // құлып ішінде қайта тексереміз (екі рет басылса да бір жазба)
    if (row) return { ok: true, existing: true, user: publicUser_(sh.getRange(row, 1, 1, P_HEAD.length).getValues()[0]) };
    const now = new Date();
    const pid = 'P' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
    // ЖСН мен телефон мәтін ретінде жазылады (алдындағы ' — мәтін белгісі, ұяшықта көрінбейді)
    const vals = [pid, "'" + iin, safe_(fullName), safe_(firstName), safe_(workplace), safe_(workplaceOther), "'" + phone,
      now, '', '', '', '', '', '', '', now, ''];
    const next = sh.getLastRow() + 1;
    ensureRows_(sh, next);
    sh.getRange(next, 1, 1, vals.length).setValues([vals]);
    appendProgress_([[now, pid, 'registered', EVENT_LABELS.registered, '', '']]);
    vals[PC.iin] = iin; vals[PC.phone] = phone;
    vals[PC.fullName] = fullName; vals[PC.firstName] = firstName; vals[PC.workplace] = workplace; vals[PC.workplaceOther] = workplaceOther;
    return { ok: true, existing: false, user: publicUser_(vals) };
  });
}

function apiLogin_(req) {
  const iin = digits_(req.iin).slice(0, 20);
  const err = iinError_(iin, false);
  if (err) fail_('VALIDATION', err, 'iin');
  const sh = sheet_(SH.P);
  const row = findRow_(sh, PC.iin + 1, iin);
  if (!row) fail_('NOT_FOUND', 'Бұл ЖСН бойынша тіркелу табылмады. Сандарды тексеріңіз немесе алдымен тіркеліңіз.');
  return { ok: true, user: publicUser_(sh.getRange(row, 1, 1, P_HEAD.length).getValues()[0]) };
}

function apiMe_(req) {
  const pid = checkSig_(req);
  const sh = sheet_(SH.P);
  const row = findRow_(sh, PC.pid + 1, pid);
  if (!row) fail_('AUTH', 'Қайта кіру керек. ЖСН арқылы кіріңіз.');
  return { ok: true, user: publicUser_(sh.getRange(row, 1, 1, P_HEAD.length).getValues()[0]) };
}

function appendProgress_(rows) {
  if (!rows.length) return;
  const sh = sheet_(SH.PR);
  const next = sh.getLastRow() + 1;
  ensureRows_(sh, next + rows.length - 1);
  sh.getRange(next, 1, rows.length, PR_HEAD.length).setValues(rows);
}

/** Оқиғаларды пакетпен жазады: кітапты ашты, оқып бітірді. Бір оқиға екі рет жазылмайды. */
function apiLogEvents_(req) {
  const pid = checkSig_(req);
  const events = Array.isArray(req.events) ? req.events.slice(0, 30) : [];
  if (!events.length) return { ok: true };
  const cache = CacheService.getScriptCache();
  const allowed = { book_opened: true, read_finished: true };

  return withLock_(function () {
    const sh = sheet_(SH.P);
    const row = findRow_(sh, PC.pid + 1, pid);
    if (!row) fail_('AUTH', 'Қайта кіру керек. ЖСН арқылы кіріңіз.');
    const v = sh.getRange(row, 1, 1, P_HEAD.length).getValues()[0];
    const now = Date.now();
    const rows = [];
    const seen = {};

    events.forEach(function (ev) {
      if (!ev || !allowed[ev.type]) return;
      const eid = String(ev.eid || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
      if (!eid || seen[eid] || cache.get('ev_' + eid)) return;
      seen[eid] = '1';
      // Телефон уақыты тек ақылға қонымды болса ғана алынады (байланыссыз жерде белгіленген оқиғалар үшін)
      const ts = Number(ev.ts);
      const when = new Date(ts && ts <= now + 60000 && ts > now - 7 * 86400000 ? Math.min(ts, now) : now);
      const bookId = safe_(clean_(ev.bookId, 20).replace(/[^A-Za-z0-9_-]/g, ''));
      if (ev.type === 'book_opened' && !v[PC.bookOpenedAt]) v[PC.bookOpenedAt] = when;
      if (ev.type === 'read_finished') {
        if (!v[PC.bookOpenedAt]) v[PC.bookOpenedAt] = when;
        if (!v[PC.readFinishedAt]) v[PC.readFinishedAt] = when;
      }
      if (bookId) v[PC.bookId] = bookId;
      rows.push([when, pid, ev.type, EVENT_LABELS[ev.type], bookId, eid]);
    });

    if (rows.length) {
      v[PC.lastSeenAt] = new Date();
      // Тек өзгерген бағандар жазылады: «Кітапты ашты» … «Кітап ID»
      sh.getRange(row, PC.bookOpenedAt + 1, 1, P_HEAD.length - PC.bookOpenedAt).setValues([v.slice(PC.bookOpenedAt)]);
      appendProgress_(rows);
      const mark = {};
      Object.keys(seen).forEach(function (k) { mark['ev_' + k] = '1'; });
      cache.putAll(mark, 21600);
    }
    return { ok: true, user: publicUser_(v) };
  });
}

/* ============================ РЕЙТИНГ ============================ */

function readParticipants_() {
  const sh = sheet_(SH.P);
  const n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, P_HEAD.length).getValues().filter(function (r) { return String(r[PC.pid]); });
}

/** Сұрыпталған нәтижелер. Ұпай тең болса, аз уақыт жұмсаған адам жоғары. 60 секунд кэште тұрады. */
function rankData_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('rating');
  if (hit) return JSON.parse(hit);
  const list = readParticipants_()
    .filter(function (r) { return date_(r[PC.testFinishedAt]) && num_(r[PC.score]) != null; })
    .map(function (r) { return { n: String(r[PC.fullName]), w: wpLabelRow_(r), s: Number(r[PC.score]), d: Number(r[PC.durationSec]) || 0 }; })
    .sort(function (a, b) { return b.s - a.s || a.d - b.d; });
  const data = {
    top: list.slice(0, 50).map(function (x) { return { name: x.n, workplace: x.w, score: x.s, durationSec: x.d }; }),
    sd: list.map(function (x) { return [x.s, x.d]; }),
    total: list.length
  };
  try { cache.put('rating', JSON.stringify(data), 60); } catch (e) { /* тым үлкен болса, кэшсіз жұмыс істейді */ }
  return data;
}

function rankFor_(score, dur) {
  const sd = rankData_().sd;
  let better = 0;
  for (let i = 0; i < sd.length; i++) {
    if (sd[i][0] > score || (sd[i][0] === score && sd[i][1] < dur)) better++;
  }
  return better + 1;
}

/** Рейтингте тек аты-жөні, жұмыс орны және ұпай шығады. */
function apiGetRating_() {
  const d = rankData_();
  return { ok: true, top: d.top, total: d.total };
}

/* ============================ ӘКІМШІ ============================ */

function apiAdminLogin_(req) {
  const cache = CacheService.getScriptCache();
  const pw = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!pw) fail_('SETUP', 'Құпиясөз орнатылмаған. Script Properties ішіне ADMIN_PASSWORD қосыңыз.');
  const fails = Number(cache.get('adm_fail') || 0);
  if (fails >= 10) fail_('LOCKED', 'Тым көп қате әрекет жасалды. 10 минуттан кейін қайта байқаңыз.');
  if (String(req.password || '') !== pw) {
    cache.put('adm_fail', String(fails + 1), 600);
    Utilities.sleep(700);
    fail_('WRONG', 'Құпиясөз қате. Қайта жазып көріңіз.');
  }
  const token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  cache.put('adm_' + token, '1', 14400); // 4 сағат
  return { ok: true, token: token, expiresInSec: 14400 };
}

/** Әкімшілік әрекеттер токенсіз орындалмайды. */
function admin_(fn) {
  return function (req) {
    const token = String(req.token || '');
    if (!/^[a-f0-9-]{40,80}$/.test(token) || !CacheService.getScriptCache().get('adm_' + token)) {
      fail_('AUTH', 'Кіру мерзімі бітті. Қайта кіріңіз.');
    }
    return fn(req);
  };
}

function apiAdminLogout_(req) {
  CacheService.getScriptCache().remove('adm_' + String(req.token));
  return { ok: true };
}

function loadParticipants_() {
  return readParticipants_().map(function (r) {
    const o = {
      pid: String(r[PC.pid]), iin: String(r[PC.iin]), fullName: String(r[PC.fullName]),
      workplace: String(r[PC.workplace] || ''), workplaceOther: String(r[PC.workplaceOther] || ''), phone: String(r[PC.phone]),
      registeredAt: date_(r[PC.registeredAt]), bookOpenedAt: date_(r[PC.bookOpenedAt]), readFinishedAt: date_(r[PC.readFinishedAt]),
      testStartedAt: date_(r[PC.testStartedAt]), testFinishedAt: date_(r[PC.testFinishedAt]),
      score: num_(r[PC.score]), correct: num_(r[PC.correct]), durationSec: num_(r[PC.durationSec]), bookId: String(r[PC.bookId] || '')
    };
    o.wpLabel = o.workplace === OTHER && o.workplaceOther ? OTHER + ': ' + o.workplaceOther : (o.workplace || '—');
    o.status = o.testFinishedAt ? 'tested' : o.readFinishedAt ? 'read' : o.bookOpenedAt ? 'reading' : 'registered';
    return o;
  });
}

function apiAdminData_() {
  const s = getSettings_();
  const t = function (d) { return d ? d.getTime() : null; };
  return {
    ok: true,
    generatedAt: Date.now(),
    settings: s,
    workplaces: s.workplaces,
    effectiveTestOpen: isTestOpen_(s),
    books: getBooks_(false),
    participants: loadParticipants_().map(function (p) {
      return [p.pid, p.iin, p.fullName, p.workplace, p.workplaceOther, p.phone, t(p.registeredAt), t(p.bookOpenedAt),
        t(p.readFinishedAt), t(p.testStartedAt), t(p.testFinishedAt), p.score, p.correct, p.durationSec, p.bookId];
    })
  };
}

function apiAdminSaveSettings_(req) {
  const patch = req.settings;
  if (!patch || typeof patch !== 'object') fail_('BAD_REQUEST', 'Баптаулар жіберілмеді.');
  const out = {};
  SETTINGS_DEF.forEach(function (d) {
    const key = d[0], type = d[2];
    if (!Object.prototype.hasOwnProperty.call(patch, key)) return;
    const v = patch[key];
    if (type === 'bool') out[key] = v === true;
    else if (type === 'int') {
      const n = parseInt(v, 10);
      if (isNaN(n) || n < d[4] || n > d[5]) fail_('VALIDATION', '«' + d[3] + '» мәні ' + d[4] + ' мен ' + d[5] + ' аралығында болуы керек.');
      out[key] = n;
    } else if (type === 'date') {
      out[key] = parseDate_(v) || '';
    } else if (type === 'list') {
      const seen = {};
      const list = (Array.isArray(v) ? v : String(v).split(/\r?\n/)).map(function (x) { return clean_(x, 100); })
        .filter(function (x) { if (!x || x === OTHER || seen[x]) return false; seen[x] = true; return true; }).slice(0, 300);
      if (!list.length) fail_('VALIDATION', 'Кемінде бір жұмыс орнын жазыңыз.');
      out[key] = safe_(list.join('\n'));
    } else {
      out[key] = safe_(cleanMultiline_(v, d[5] || 300));
    }
  });
  if (out.testStart && out.testEnd && out.testEnd <= out.testStart) fail_('VALIDATION', 'Тесттің аяқталу уақыты басталу уақытынан кейін болуы керек.');

  withLock_(function () {
    const sh = sheet_(SH.S);
    const n = sh.getLastRow();
    const rows = n > 1 ? sh.getRange(2, 1, n - 1, 2).getValues() : [];
    const index = {};
    rows.forEach(function (r, i) { index[String(r[0]).trim()] = i; });
    const extra = [];
    Object.keys(out).forEach(function (k) {
      if (index[k] != null) rows[index[k]][1] = out[k];
      else extra.push([k, out[k]]);
    });
    // Мәндер бір рет, бүтін бағанмен жазылады. Бар мәтіндер де формуладан қорғалады.
    if (rows.length) sh.getRange(2, 2, rows.length, 1).setValues(rows.map(function (r) { return [safe_(r[1])]; }));
    if (extra.length) sh.getRange(sh.getLastRow() + 1, 1, extra.length, 2).setValues(extra);
    CacheService.getScriptCache().removeAll(CACHE_KEYS);
  });

  const s = getSettings_();
  return { ok: true, settings: s, workplaces: s.workplaces, effectiveTestOpen: isTestOpen_(s) };
}

function apiAdminSaveBooks_(req) {
  const list = Array.isArray(req.books) ? req.books.slice(0, 50) : null;
  if (!list) fail_('BAD_REQUEST', 'Кітаптар жіберілмеді.');
  const ids = {};
  const rows = list.map(function (b, i) {
    const n = i + 1;
    const id = clean_(b.bookId, 20);
    if (!/^[A-Za-z0-9_-]{1,20}$/.test(id)) fail_('VALIDATION', n + '-кітап: код тек латын әріптері мен сандардан тұруы керек.');
    if (ids[id]) fail_('VALIDATION', n + '-кітап: «' + id + '» коды қайталанып тұр.');
    ids[id] = true;
    const title = clean_(b.title, 200);
    if (!title) fail_('VALIDATION', n + '-кітап: атауын жазыңыз.');
    const url = clean_(b.url, 500);
    if (url && !/^https?:\/\/\S+$/i.test(url)) fail_('VALIDATION', n + '-кітап: сілтеме https:// деп басталуы керек.');
    const cover = clean_(b.coverUrl, 500);
    if (cover && !/^https?:\/\/\S+$/i.test(cover)) fail_('VALIDATION', n + '-кітап: мұқаба сілтемесі https:// деп басталуы керек.');
    const color = /^#[0-9a-f]{6}$/i.test(String(b.coverColor || '')) ? String(b.coverColor) : '#8A3B12';
    const order = Math.max(1, Math.min(999, parseInt(b.order, 10) || n));
    return [id, safe_(title), safe_(clean_(b.author, 200)), safe_(cleanMultiline_(b.description, 1500)), url, cover, color, b.active !== false, order];
  });

  withLock_(function () {
    const sh = sheet_(SH.B);
    const n = sh.getLastRow();
    if (n > 1) sh.getRange(2, 1, n - 1, B_HEAD.length).clearContent();
    if (rows.length) sh.getRange(2, 1, rows.length, B_HEAD.length).setValues(rows);
    CacheService.getScriptCache().removeAll(CACHE_KEYS);
  });
  return { ok: true, books: getBooks_(false) };
}

/* ============================ EXCEL ЕСЕБІ ============================ */

const RC = {
  accent: '#0B1E3E', accentSoft: '#EEF1F7', accentMid: '#C9A84C', ink: '#0B1E3E', muted: '#4A5670',
  line: '#D9DEE8', head: '#0B1E3E', zebra: '#F6F8FB', white: '#FFFFFF'
};
const RFONT = 'Inter';
const RDATE = 'dd.mm.yyyy hh:mm';

/**
 * Есепті жеке кестеде құрады (формуласыз, есептелген мәндермен және нативті графиктермен),
 * оны .xlsx және PDF ретінде экспорттайды, сосын уақытша кестені себетке жібереді.
 */
function apiAdminExport_() {
  const tz = Session.getScriptTimeZone();
  const now = new Date();
  const s = getSettings_();
  const P = loadParticipants_();
  const st = computeStats_(P, tz);
  const books = {};
  getBooks_(false).forEach(function (b) { books[b.bookId] = b.title; });
  const stamp = Utilities.formatDate(now, tz, 'yyyy-MM-dd_HH-mm');
  const ss = SpreadsheetApp.create('Байқау есебі ' + stamp);

  try {
    ss.setSpreadsheetTimeZone(tz);
    const sum = ss.getSheets()[0].setName('Қорытынды');
    writeParticipantsSheet_(ss.insertSheet('Қатысушылар', 1), P);
    writeReadingSheet_(ss.insertSheet('Оқу барысы', 2), P, books);
    writeResultsSheet_(ss.insertSheet('Тест нәтижелері', 3), st.ranked);
    writeWorkplaceSheet_(ss.insertSheet('Жұмыс орындары бойынша', 4), st);
    writeSummarySheet_(sum, st, s.contestTitle, now, tz);
    ss.setActiveSheet(sum);
    SpreadsheetApp.flush();

    const id = ss.getId();
    const xlsx = exportBlob_(id, 'format=xlsx');
    if (!xlsx) fail_('EXPORT', 'Excel файлын жасау сәтсіз болды. Бір минуттан кейін қайта байқаңыз.');
    // Қорытынды бет: A4 альбомдық, ені бетке сыйдырылған
    const pdf = exportBlob_(id, 'format=pdf&gid=' + sum.getSheetId() +
      '&size=A4&portrait=false&fitw=true&gridlines=false&printtitle=false&sheetnames=false&pagenumbers=false' +
      '&fzr=false&horizontal_alignment=CENTER&top_margin=0.4&bottom_margin=0.4&left_margin=0.4&right_margin=0.4');
    return {
      ok: true,
      filename: 'Baiqau-esebi_' + stamp + '.xlsx',
      xlsx: Utilities.base64Encode(xlsx.getBytes()),
      pdfName: 'Baiqau-qorytyndy_' + stamp + '.pdf',
      pdf: pdf ? Utilities.base64Encode(pdf.getBytes()) : ''
    };
  } finally {
    try { DriveApp.getFileById(ss.getId()).setTrashed(true); } catch (e) { console.error('Уақытша файл өшірілмеді: ' + e); }
  }
}

function exportBlob_(id, query) {
  const url = 'https://docs.google.com/spreadsheets/d/' + id + '/export?' + query;
  for (let i = 0; i < 3; i++) {
    const res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (res.getResponseCode() === 200) return res.getBlob();
    Utilities.sleep(2000 * (i + 1));
  }
  return null;
}

function computeStats_(P, tz) {
  const st = { total: P.length, opened: 0, finished: 0, tested: 0, avg: null, share70: null, daily: [], byWp: [], hist: [], ranked: [] };
  const days = {}, wp = {};
  const buckets = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  let sum = 0, over70 = 0;

  P.forEach(function (p) {
    const started = !!(p.bookOpenedAt || p.readFinishedAt);
    const tested = !!(p.testFinishedAt && p.score != null);
    if (started) st.opened++;
    if (p.readFinishedAt) st.finished++;
    if (tested) {
      st.tested++; sum += p.score;
      if (p.score >= 70) over70++;
      buckets[Math.max(0, Math.min(9, Math.floor(p.score / 10)))]++;
      st.ranked.push(p);
    }
    if (p.registeredAt) {
      const k = Utilities.formatDate(p.registeredAt, tz, 'yyyy-MM-dd');
      days[k] = (days[k] || 0) + 1;
    }
    const name = p.workplace || '—';
    const w = wp[name] || (wp[name] = { name: name, reg: 0, opened: 0, finished: 0, tested: 0, scoreSum: 0 });
    w.reg++;
    if (started) w.opened++;
    if (p.readFinishedAt) w.finished++;
    if (tested) { w.tested++; w.scoreSum += p.score; }
  });

  if (st.tested) {
    st.avg = Math.round(sum / st.tested * 10) / 10;
    st.share70 = over70 / st.tested;
  }
  st.ranked.sort(function (a, b) { return b.score - a.score || (a.durationSec || 0) - (b.durationSec || 0); });

  const keys = Object.keys(days).sort();
  if (keys.length) {
    const a = keys[0].split('-'), b = keys[keys.length - 1].split('-');
    const cur = new Date(+a[0], +a[1] - 1, +a[2], 12), end = new Date(+b[0], +b[1] - 1, +b[2], 12);
    while (cur <= end && st.daily.length < 366) {
      const k = Utilities.formatDate(cur, tz, 'yyyy-MM-dd');
      st.daily.push([Utilities.formatDate(cur, tz, 'dd.MM'), days[k] || 0]);
      cur.setDate(cur.getDate() + 1);
    }
  }
  st.byWp = Object.keys(wp).map(function (k) { return wp[k]; }).sort(function (x, y) { return y.reg - x.reg; });
  st.hist = buckets.map(function (n, i) { return [(i * 10) + '–' + (i === 9 ? 100 : i * 10 + 9), n]; });
  return st;
}

function durText_(msDiff) {
  if (msDiff == null || msDiff < 0) return '';
  const min = Math.round(msDiff / 60000);
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  if (d) return d + ' күн ' + h + ' сағ';
  if (h) return h + ' сағ ' + m + ' мин';
  return m + ' мин';
}
function secText_(sec) {
  if (sec == null) return '';
  sec = Math.round(sec);
  return Math.floor(sec / 60) + ' мин ' + (sec % 60 < 10 ? '0' : '') + (sec % 60) + ' с';
}

/** Кесте жазады: тақырып жолы қою, жолдар кезектесіп боялған, жиектері бар. */
function writeTable_(sh, row, col, header, rows, opts) {
  opts = opts || {};
  const n = rows.length;
  ensureRows_(sh, row + n + 2);
  (opts.textCols || []).forEach(function (c) {
    sh.getRange(row + 1, col + c, Math.max(n, 1), 1).setNumberFormat('@');
  });
  const all = [header].concat(rows).map(function (r) {
    return r.map(function (v) { return v == null ? '' : safe_(v); });
  });
  const rng = sh.getRange(row, col, all.length, header.length);
  rng.setValues(all).setFontFamily(RFONT).setFontSize(10).setFontColor(RC.ink).setVerticalAlignment('middle');
  sh.getRange(row, col, 1, header.length).setBackground(RC.head).setFontColor(RC.white).setFontWeight('bold').setWrap(true);
  if (n) {
    sh.getRange(row + 1, col, n, header.length).setBackgrounds(rows.map(function (r, i) {
      return header.map(function () { return i % 2 ? RC.zebra : RC.white; });
    }));
  }
  rng.setBorder(true, true, true, true, null, true, RC.line, SpreadsheetApp.BorderStyle.SOLID);
  (opts.formats || []).forEach(function (f) {
    if (n) sh.getRange(row + 1, col + f[0], n, 1).setNumberFormat(f[1]);
  });
  return rng;
}

function finishSheet_(sh, widths, rowCount, colCount) {
  widths.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setFrozenRows(1);
  sh.setRowHeight(1, 38);
  if (rowCount > 0) sh.getRange(1, 1, rowCount + 1, colCount).createFilter();
}

function emptyNote_(sh, row, cols, text) {
  sh.getRange(row, 1, 1, cols).merge().setValue(text).setFontFamily(RFONT).setFontColor(RC.muted)
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.setRowHeight(row, 44);
}

function writeParticipantsSheet_(sh, P) {
  const header = ['№', 'Аты-жөні', 'Жұмыс орны', 'ЖСН', 'Телефон', 'Тіркелген күні', 'Күйі', 'Кітапты ашты', 'Оқып бітірді', 'Тест тапсырды', 'Ұпай (%)'];
  const rows = P.map(function (p, i) {
    return [i + 1, p.fullName, p.wpLabel, p.iin, p.phone, p.registeredAt || '', STATUS_LABELS[p.status],
      p.bookOpenedAt || '', p.readFinishedAt || '', p.testFinishedAt || '', p.score == null ? '' : p.score];
  });
  writeTable_(sh, 1, 1, header, rows, { textCols: [3, 4], formats: [[5, RDATE], [7, RDATE], [8, RDATE], [9, RDATE]] });
  finishSheet_(sh, [50, 270, 230, 130, 140, 140, 150, 140, 140, 140, 90], rows.length, header.length);
  if (!rows.length) { emptyNote_(sh, 2, header.length, 'Әлі ешкім тіркелмеген'); return; }

  // Күй бағаны түспен боялады (шартты пішімдеу)
  const rng = sh.getRange(2, 7, rows.length, 1);
  const colors = { registered: ['#ECE7E1', '#453E38'], reading: ['#E4EEFB', '#1D4F91'], read: ['#FFF3D1', '#7A5200'], tested: ['#E1F4E8', '#11703A'] };
  sh.setConditionalFormatRules(Object.keys(colors).map(function (k) {
    return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(STATUS_LABELS[k])
      .setBackground(colors[k][0]).setFontColor(colors[k][1]).setBold(true).setRanges([rng]).build();
  }));
}

function writeReadingSheet_(sh, P, books) {
  const header = ['Аты-жөні', 'Жұмыс орны', 'Кітап', 'Оқуды бастады', 'Оқып бітірді', 'Оқуға кеткен уақыт', 'Күйі'];
  const rows = P.filter(function (p) { return p.bookOpenedAt || p.readFinishedAt; })
    .sort(function (a, b) { return (a.bookOpenedAt || a.readFinishedAt) - (b.bookOpenedAt || b.readFinishedAt); })
    .map(function (p) {
      const dur = p.bookOpenedAt && p.readFinishedAt ? durText_(p.readFinishedAt.getTime() - p.bookOpenedAt.getTime()) : '';
      return [p.fullName, p.wpLabel, books[p.bookId] || p.bookId || '', p.bookOpenedAt || '', p.readFinishedAt || '', dur,
        p.readFinishedAt ? 'Оқып бітірді' : 'Оқып жатыр'];
    });
  writeTable_(sh, 1, 1, header, rows, { formats: [[3, RDATE], [4, RDATE]] });
  finishSheet_(sh, [270, 230, 220, 150, 150, 170, 140], rows.length, header.length);
  if (!rows.length) { emptyNote_(sh, 2, header.length, 'Әлі ешкім оқуды бастаған жоқ'); return; }
  const rng = sh.getRange(2, 7, rows.length, 1);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Оқып бітірді').setBackground('#E1F4E8').setFontColor('#11703A').setBold(true).setRanges([rng]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Оқып жатыр').setBackground('#E4EEFB').setFontColor('#1D4F91').setBold(true).setRanges([rng]).build()
  ]);
}

function writeResultsSheet_(sh, ranked) {
  const header = ['Орны', 'Аты-жөні', 'Жұмыс орны', 'Ұпай (%)', 'Дұрыс жауап', 'Жұмсалған уақыт', 'Тапсырған уақыты'];
  const rows = ranked.map(function (p, i) {
    return [i + 1, p.fullName, p.wpLabel, p.score, p.correct == null ? '' : p.correct, secText_(p.durationSec), p.testFinishedAt || ''];
  });
  writeTable_(sh, 1, 1, header, rows, { formats: [[6, RDATE]] });
  finishSheet_(sh, [70, 270, 230, 100, 110, 150, 150], rows.length, header.length);
  if (!rows.length) { emptyNote_(sh, 2, header.length, 'Тест нәтижелері әлі жоқ'); return; }
  sh.getRange(2, 1, rows.length, 1).setHorizontalAlignment('center').setFontWeight('bold');
  sh.setConditionalFormatRules([gradientRule_(sh.getRange(2, 4, rows.length, 1), '0', '100')]);
}

function gradientRule_(range, min, max) {
  return SpreadsheetApp.newConditionalFormatRule()
    .setGradientMinpointWithValue(RC.white, SpreadsheetApp.InterpolationType.NUMBER, min)
    .setGradientMaxpointWithValue(RC.accentMid, SpreadsheetApp.InterpolationType.NUMBER, max)
    .setRanges([range]).build();
}

function writeWorkplaceSheet_(sh, st) {
  const header = ['Жұмыс орны', 'Тіркелгендер', 'Оқуды бастағандар', 'Оқып біткендер', 'Тест тапсырғандар',
    'Оқып біткендер, %', 'Тест тапсырғандар, %', 'Орташа ұпай', 'Тіркелгендер (көрнекі)'];
  const maxReg = st.byWp.length ? st.byWp[0].reg : 1;
  const bar = function (v) { return new Array(Math.max(1, Math.round(v / maxReg * 30)) + 1).join('█'); };
  const rows = st.byWp.map(function (w) {
    return [w.name, w.reg, w.opened, w.finished, w.tested, w.reg ? w.finished / w.reg : 0, w.reg ? w.tested / w.reg : 0,
      w.tested ? Math.round(w.scoreSum / w.tested * 10) / 10 : '', bar(w.reg)];
  });
  writeTable_(sh, 1, 1, header, rows, { formats: [[1, '#,##0'], [2, '#,##0'], [3, '#,##0'], [4, '#,##0'], [5, '0%'], [6, '0%'], [7, '0.0']] });
  finishSheet_(sh, [280, 120, 140, 130, 140, 140, 150, 120, 300], rows.length, header.length);
  if (!rows.length) { emptyNote_(sh, 2, header.length, 'Дерек әлі жоқ'); return; }

  const n = rows.length;
  sh.getRange(2, 9, n, 1).setFontColor(RC.accent).setFontSize(9);
  // Дерек жолақтарының орнына: түс градиенті (.xlsx-те сақталады) және █ жолақтары
  sh.setConditionalFormatRules([
    gradientRule_(sh.getRange(2, 6, n, 1), '0', '1'),
    gradientRule_(sh.getRange(2, 7, n, 1), '0', '1'),
    gradientRule_(sh.getRange(2, 8, n, 1), '0', '100')
  ]);
  const total = sh.getRange(n + 2, 1, 1, header.length);
  total.setValues([['Барлығы', st.total, st.opened, st.finished, st.tested,
    st.total ? st.finished / st.total : 0, st.total ? st.tested / st.total : 0, st.avg == null ? '' : st.avg, '']]);
  total.setFontFamily(RFONT).setFontSize(10).setFontWeight('bold').setBackground(RC.accentSoft)
    .setBorder(true, true, true, true, null, null, RC.line, SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(n + 2, 6, 1, 2).setNumberFormat('0%');
  sh.getRange(n + 2, 2, 1, 4).setNumberFormat('#,##0');
}

function writeSummarySheet_(sh, st, title, now, tz) {
  sh.setHiddenGridlines(true);
  [24, 210, 110, 110, 24, 95, 95, 95, 95, 95, 95, 95, 95].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.getRange(1, 1, 220, 13).setFontFamily(RFONT).setFontColor(RC.ink).setVerticalAlignment('middle');

  sh.setRowHeight(1, 14);
  sh.setRowHeight(2, 44);
  sh.getRange('B2').setValue(safe_(String(title))).setFontSize(22).setFontWeight('bold');
  sh.getRange('B3').setValue('Қорытынды есеп · ' + Utilities.formatDate(now, tz, 'dd.MM.yyyy HH:mm')).setFontSize(11).setFontColor(RC.muted);
  sh.setRowHeight(4, 10);
  sh.getRange('B4:M4').setBorder(null, null, true, null, null, null, RC.accent, SpreadsheetApp.BorderStyle.SOLID_THICK);
  sh.setRowHeight(5, 14);

  // KPI карточкалары
  const share = function (n) { return 'тіркелгендердің ' + (st.total ? Math.round(n / st.total * 100) : 0) + '%'; };
  const kpis = [
    ['Тіркелгендер', st.total, '#,##0', 'барлық қатысушы'],
    ['Оқуды бастағандар', st.opened, '#,##0', share(st.opened)],
    ['Оқып біткендер', st.finished, '#,##0', share(st.finished)],
    ['Тест тапсырғандар', st.tested, '#,##0', share(st.tested)],
    ['Орташа ұпай', st.avg == null ? '—' : st.avg, '0.0', '100 ұпайдан'],
    ['70%-дан жоғары алғандар', st.share70 == null ? '—' : st.share70, '0%', 'тест тапсырғандар ішінде']
  ];
  const spans = [[2, 1], [3, 2], [6, 2], [8, 2], [10, 2], [12, 2]];
  sh.setRowHeight(6, 30); sh.setRowHeight(7, 50); sh.setRowHeight(8, 28);
  kpis.forEach(function (k, i) {
    const c = spans[i][0], w = spans[i][1];
    if (w > 1) [6, 7, 8].forEach(function (r) { sh.getRange(r, c, 1, w).merge(); });
    sh.getRange(6, c, 3, w).setBackground(RC.accentSoft).setHorizontalAlignment('center')
      .setBorder(true, true, true, true, null, null, RC.white, SpreadsheetApp.BorderStyle.SOLID_THICK);
    sh.getRange(6, c).setValue(k[0]).setFontSize(10).setFontWeight('bold').setFontColor(RC.muted).setWrap(true);
    const v = sh.getRange(7, c).setValue(k[1]).setFontSize(26).setFontWeight('bold').setFontColor(RC.accent);
    if (typeof k[1] === 'number') v.setNumberFormat(k[2]);
    sh.getRange(8, c).setValue(k[3]).setFontSize(9).setFontColor(RC.muted);
  });

  let r = 10;
  const pct = function (n) { return st.total ? n / st.total : 0; };
  r = chartSection_(sh, r, 'Воронка', ['Кезең', 'Саны', 'Үлесі'],
    [['Тіркелді', st.total, pct(st.total)], ['Оқуды бастады', st.opened, pct(st.opened)],
      ['Оқып бітірді', st.finished, pct(st.finished)], ['Тест тапсырды', st.tested, pct(st.tested)]],
    Charts.ChartType.BAR, 'Қатысушылар воронкасы', { formats: [[1, '#,##0'], [2, '0%']], hasData: st.total > 0 });

  r = chartSection_(sh, r, 'Күн бойынша тіркелу', ['Күні', 'Тіркелді'], st.daily,
    Charts.ChartType.COLUMN, 'Күн бойынша тіркелгендер саны', { textCols: [0], hasData: st.daily.length > 0 });

  r = chartSection_(sh, r, 'Жұмыс орны бойынша бөлініс', ['Жұмыс орны', 'Тіркелді', 'Оқып бітірді'],
    st.byWp.slice(0, 12).map(function (w) { return [w.name, w.reg, w.finished]; }),
    Charts.ChartType.COLUMN, 'Жұмыс орны бойынша (ең көп тіркелген 12)',
    { chartCols: 3, colors: [RC.accent, RC.accentMid], legend: 'bottom', hasData: st.byWp.length > 0 });

  r = chartSection_(sh, r, 'Ұпай бөлінісі', ['Ұпай аралығы', 'Адам саны'], st.hist,
    Charts.ChartType.COLUMN, 'Ұпай бойынша қатысушылар саны', { textCols: [0], hasData: st.tested > 0, emptyText: 'Тест әлі өткізілген жоқ' });

  // Үздік 10
  sectionTitle_(sh, r, 'Үздік 10 қатысушы');
  r++;
  const top = st.ranked.slice(0, 10);
  if (!top.length) {
    sh.getRange(r, 2).setValue('Тест әлі өткізілген жоқ').setFontColor(RC.muted);
    return;
  }
  const hdr = sh.getRange(r, 2, 1, 6);
  sh.getRange(r, 3, 1, 2).merge();
  sh.getRange(r, 2).setValue('Аты-жөні'); sh.getRange(r, 3).setValue('Жұмыс орны');
  sh.getRange(r, 6).setValue('Ұпай (%)'); sh.getRange(r, 7).setValue('Уақыт');
  hdr.setBackground(RC.head).setFontColor(RC.white).setFontWeight('bold').setFontSize(10);
  top.forEach(function (p, i) {
    const y = r + 1 + i;
    sh.getRange(y, 3, 1, 2).merge();
    sh.getRange(y, 2).setValue(safe_((i + 1) + '. ' + p.fullName));
    sh.getRange(y, 3).setValue(safe_(p.wpLabel));
    sh.getRange(y, 6).setValue(p.score).setFontWeight('bold').setFontColor(RC.accent);
    sh.getRange(y, 7).setValue(secText_(p.durationSec));
    sh.getRange(y, 2, 1, 6).setFontSize(10).setBackground(i % 2 ? RC.zebra : RC.white)
      .setBorder(null, null, true, null, null, null, RC.line, SpreadsheetApp.BorderStyle.SOLID);
  });
}

function sectionTitle_(sh, r, title) {
  sh.setRowHeight(r, 32);
  sh.getRange(r, 2).setValue(title).setFontSize(14).setFontWeight('bold').setFontColor(RC.ink);
  sh.getRange(r, 2, 1, 12).setBorder(null, null, true, null, null, null, RC.line, SpreadsheetApp.BorderStyle.SOLID);
}

/** Тақырып + сол жақта шағын кесте + оң жақта сол кестеден салынған нативті график. Келесі бос жолды қайтарады. */
function chartSection_(sh, r, title, header, rows, type, chartTitle, opts) {
  opts = opts || {};
  sectionTitle_(sh, r, title);
  const t = r + 1;
  if (!opts.hasData || !rows.length) {
    sh.getRange(t, 2).setValue(opts.emptyText || 'Дерек әлі жоқ').setFontColor(RC.muted);
    return t + 2;
  }
  writeTable_(sh, t, 2, header, rows, { textCols: opts.textCols, formats: opts.formats });
  const height = 290;
  const chart = sh.newChart().setChartType(type)
    .addRange(sh.getRange(t, 2, rows.length + 1, opts.chartCols || 2))
    .setNumHeaders(1)
    .setPosition(t, 6, 6, 4)
    .setOption('title', chartTitle)
    .setOption('titleTextStyle', { fontName: RFONT, fontSize: 13, bold: true, color: RC.ink })
    .setOption('fontName', RFONT)
    .setOption('colors', opts.colors || [RC.accent])
    .setOption('legend', { position: opts.legend || 'none', textStyle: { fontName: RFONT, fontSize: 10, color: RC.ink } })
    .setOption('backgroundColor', RC.white)
    .setOption('width', 740)
    .setOption('height', height)
    .build();
  sh.insertChart(chart);
  return t + Math.max(rows.length + 1, Math.ceil(height / 21) + 1) + 2;
}
