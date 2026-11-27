(function () {
  'use strict';

  // ---------- Tournament structure ----------
  // Each round: [table1 A, table1 B, table2 A, table2 B, resting player]
  var ROUNDS = [[0, 1, 2, 3, 4], [0, 2, 1, 4, 3], [0, 3, 2, 4, 1], [0, 4, 1, 3, 2], [1, 2, 3, 4, 0]];
  var PAIRS = [];
  ROUNDS.forEach(function (r) { PAIRS.push([r[0], r[1]], [r[2], r[3]]); });
  var N = 5, M = PAIRS.length;

  // Match formats. `play` is the time limit per match in minutes.
  var FORMATS = {
    11: { target: 11, play: 8, serve: 'двух', deuce: '10:10', ex: '11:9 или 13:11', exScore: '11 и 8', word: 'очков' },
    21: { target: 21, play: 12, serve: 'пяти', deuce: '20:20', ex: '21:18 или 23:21', exScore: '21 и 17', word: 'очка' }
  };
  var WARM = 5, CHANGE = 2, FINAL = 5;

  var KEY = 'tt-tournament-5-v2', OLD_KEY = 'tt-tournament-5-v1', TKEY = 'tt-timer-v1';

  function $(id) { return document.getElementById(id); }

  // ---------- Storage ----------
  var storageOK = true;
  function load(k) {
    try { return JSON.parse(window.localStorage.getItem(k)); } catch (e) { storageOK = false; return null; }
  }
  function store(k, v) {
    try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { storageOK = false; }
  }

  function defaults() {
    var n = [], s = [], i;
    for (i = 0; i < N; i++) n.push('П' + (i + 1));
    for (i = 0; i < M; i++) s.push(['', '']);
    return { names: n, scores: s, target: 11 };
  }
  function isScalar(v) { return typeof v === 'string' || typeof v === 'number'; }

  // Coerce whatever is in storage into a well-formed state; drop anything odd.
  function sanitize(raw) {
    var d = defaults(), i, j, k, v;
    if (!raw || typeof raw !== 'object') return d;
    if (Array.isArray(raw.names)) {
      for (i = 0; i < N; i++) if (isScalar(raw.names[i])) d.names[i] = String(raw.names[i]).slice(0, 40);
    }
    if (Array.isArray(raw.scores)) {
      for (j = 0; j < M; j++) {
        if (!Array.isArray(raw.scores[j])) continue;
        for (k = 0; k < 2; k++) {
          v = raw.scores[j][k];
          if (isScalar(v) && /^\d{0,2}$/.test(String(v).trim())) d.scores[j][k] = String(v).trim();
        }
      }
    }
    if (raw.target === 21 || raw.target === '21') d.target = 21;
    return d;
  }

  var data = sanitize(load(KEY) || load(OLD_KEY));
  function save() { store(KEY, data); info(); }
  function fmt() { return FORMATS[data.target] || FORMATS[11]; }
  function name(i) { return String(data.names[i] || '').trim() || 'П' + (i + 1); }

  // ---------- Score validation ----------
  function num(x) { x = String(x).trim(); return /^\d{1,2}$/.test(x) ? Number(x) : null; }

  function assess(s) {
    var t = fmt().target, a, b, hi, lo, res;
    if (String(s[0]).trim() === '' || String(s[1]).trim() === '') return { ok: false, empty: true };
    a = num(s[0]); b = num(s[1]);
    if (a === null || b === null) return { ok: false, msg: 'Введите целое число от 0 до 99.' };
    if (a === b) return { ok: false, msg: 'Ничьей быть не может — нужен победитель.' };
    hi = Math.max(a, b); lo = Math.min(a, b);
    res = { ok: true, a: a, b: b, w: a > b ? 0 : 1, note: '', warn: false };
    if (hi > t && hi - lo > 2) {
      res.warn = true;
      res.note = 'проверьте счёт: после ' + (t - 1) + ':' + (t - 1) + ' игра идёт до перевеса в 2 очка.';
    } else if (!((hi === t && lo <= t - 2) || (hi > t && hi - lo === 2))) {
      res.note = 'нестандартный счёт — окончено по лимиту времени?';
    }
    return res;
  }

  // ---------- Standings ----------
  // Order: wins → head-to-head among players level on wins → point difference → points scored.
  function cmp(a, b) { return b.w - a.w || b.h - a.h || (b.f - b.a) - (a.f - a.a) || b.f - a.f; }

  function make(tag, txt) { var e = document.createElement(tag); e.textContent = txt; return e; }

  function update() {
    var stat = [], results = [], done = 0, i, j, k, p, r, z, st, label, rank = 1, tie, d, values, tr,
      body = $('ranking'), leaders = [];
    for (i = 0; i < N; i++) stat.push({ i: i, g: 0, w: 0, l: 0, f: 0, a: 0, h: 0 });
    for (i = 0; i < ROUNDS.length; i++) $('rest' + i).textContent = 'Отдых: ' + name(ROUNDS[i][4]);

    for (j = 0; j < M; j++) {
      p = PAIRS[j]; r = assess(data.scores[j]); results.push(r);
      for (k = 0; k < 2; k++) {
        label = $('p' + j + '-' + k);
        label.textContent = name(p[k]);
        label.className = 'player' + (r.ok && r.w === k ? ' win' : '');
        $('s' + j + '-' + k).setAttribute('aria-label', 'Очки: ' + name(p[k]));
      }
      st = $('state' + j);
      if (r.ok) {
        st.className = 'state' + (r.warn ? ' invalid' : r.note ? ' note' : '');
        st.textContent = 'Победа: ' + name(p[r.w]) + (r.note ? ' · ' + r.note : '');
        done++;
        for (k = 0; k < 2; k++) {
          z = stat[p[k]];
          var f = k === 0 ? r.a : r.b, o = k === 0 ? r.b : r.a;
          z.g++; z.f += f; z.a += o;
          if (f > o) z.w++; else z.l++;
        }
      } else {
        st.className = 'state' + (r.empty ? '' : ' invalid');
        st.textContent = r.empty ? 'Ожидает результата' : r.msg;
      }
    }

    // Head-to-head: a win counts only if both players finished level on wins.
    for (j = 0; j < M; j++) {
      r = results[j]; p = PAIRS[j];
      if (r.ok && stat[p[0]].w === stat[p[1]].w) stat[p[r.w]].h++;
    }

    stat.sort(function (a, b) { return cmp(a, b) || a.i - b.i; });
    while (body.firstChild) body.removeChild(body.firstChild);
    for (i = 0; i < N; i++) {
      z = stat[i];
      if (i && cmp(stat[i - 1], z) !== 0) rank = i + 1;
      tie = (i > 0 && cmp(stat[i - 1], z) === 0) || (i < N - 1 && cmp(z, stat[i + 1]) === 0);
      tr = document.createElement('tr');
      if (done === M && rank === 1) tr.className = 'winner';
      d = z.f - z.a;
      values = [done === 0 ? '—' : rank + (tie ? '=' : ''), name(z.i), z.g, z.w, z.l, z.f, z.a, (d > 0 ? '+' : '') + d, z.w];
      for (k = 0; k < values.length; k++) tr.appendChild(make('td', values[k]));
      body.appendChild(tr);
      if (cmp(stat[0], z) === 0) leaders.push(name(z.i));
    }
    $('progress').textContent = 'Сыграно ' + done + ' из ' + M + ' матчей. ' + (done === M ? 'Турнир завершён.' : 'Рейтинг предварительный.');
    $('result').textContent = done === M ? (leaders.length === 1 ? '🏆 Победитель: ' + leaders[0] : 'Первое место делят: ' + leaders.join(', ')) : '';
  }

  // ---------- Format-dependent texts ----------
  function setLines(el, a, b) {
    while (el.firstChild) el.removeChild(el.firstChild);
    el.appendChild(document.createTextNode(a));
    el.appendChild(document.createElement('br'));
    el.appendChild(document.createTextNode(b));
  }

  function applyFormat() {
    var f = fmt(), L = f.play + CHANGE, mainEnd = WARM + ROUNDS.length * L, total = mainEnd + FINAL, r;
    var radios = document.querySelectorAll('input[name="target"]');
    for (r = 0; r < radios.length; r++) radios[r].checked = Number(radios[r].value) === f.target;
    $('mtotal').textContent = total;
    setLines($('tlmain'), WARM + '–' + mainEnd + ' мин', ROUNDS.length + ' раундов по ' + L + ' минут');
    setLines($('tlend'), mainEnd + '–' + total, 'Итоги');
    for (r = 0; r < ROUNDS.length; r++) {
      $('rtime' + r).textContent = 'Раунд ' + (r + 1) + ' · ' + (WARM + r * L) + '–' + (WARM + (r + 1) * L) + ' мин';
    }
    $('schedinfo').textContent = 'Время отсчитывается от начала турнира. В каждом раунде — ' + f.play +
      ' минут игры и ' + CHANGE + ' минуты на смену участников.';
    $('scoreinfo').textContent = 'Имена участников берутся из списка выше. В поля рядом с именами внесите итоговые очки (например, ' + f.exScore + ').';
    $('rule2').textContent = 'Матч состоит из одной партии до ' + f.target + ' ' + f.word +
      '. Для обычной победы нужен перевес минимум в два очка (например, ' + f.ex + ').';
    $('rule3').textContent = 'Первую подачу определите жребием. Подача переходит после каждых ' + f.serve +
      ' розыгрышей, при ' + f.deuce + ' — после каждого. При подаче мяч подбрасывают с открытой ладони, и он должен отскочить сначала на своей, затем на чужой половине стола.';
    $('rule4').textContent = 'Лимит — ' + f.play + ' минут на матч. По сигналу таймера завершите текущий розыгрыш. ' +
      'Если партия не закончена, выигрывает тот, кто ведёт в счёте. При равенстве разыгрывается одно решающее очко по очереди подачи. ' +
      'Затем внесите итоговый счёт. Это специальное правило мини-турнира, а не стандартное правило настольного тенниса.';
    $('fmthint').textContent = 'До ' + f.target + ': ' + f.play + ' мин на матч, весь турнир — ' + total + ' мин.';
  }

  // ---------- Timer ----------
  function phases() {
    var f = fmt(), p = [{ r: -1, kind: 'warm', label: 'Разминка', min: WARM }], r;
    for (r = 0; r < ROUNDS.length; r++) {
      p.push({ r: r, kind: 'play', label: 'Раунд ' + (r + 1) + ' · игра', min: f.play });
      p.push({ r: r, kind: 'change', label: 'Раунд ' + (r + 1) + ' · ' + (r < ROUNDS.length - 1 ? 'смена и запись' : 'запись результатов'), min: CHANGE });
    }
    p.push({ r: -1, kind: 'final', label: 'Итоги', min: FINAL });
    return p;
  }
  var P = phases();
  function dur(i) { return P[i].min * 60000; }
  function freshTimer() { return { i: 0, running: false, end: 0, left: dur(0), warned: -1, target: data.target }; }

  function loadTimer() {
    var t = load(TKEY), f = freshTimer();
    if (!t || typeof t !== 'object' || t.target !== data.target) return f;
    var i = Number(t.i);
    if (!(i >= 0 && i < P.length && Math.floor(i) === i)) return f;
    f.i = i;
    f.warned = Number(t.warned) === i ? i : -1;
    if (t.running === true && isFinite(t.end)) { f.running = true; f.end = Number(t.end); }
    else f.left = Math.max(0, Math.min(dur(i), Number(t.left) || 0));
    return f;
  }
  var T = loadTimer();
  function saveTimer() { store(TKEY, T); }
  function remaining() { return T.running ? Math.max(0, T.end - Date.now()) : T.left; }
  function started() { return T.running || T.i > 0 || T.left < dur(0); }
  function finished() { return !T.running && T.i === P.length - 1 && T.left === 0; }

  // Sound (Web Audio, unlocked by the first tap) + vibration
  var actx = null;
  function audio() {
    if (!actx) {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      try { actx = new C(); } catch (e) { return null; }
    }
    if (actx.state === 'suspended' && actx.resume) actx.resume().catch(function () {});
    return actx;
  }
  var SIGNALS = {
    warn: { tones: [[880, 0.15], [880, 0.15]], vib: [150, 100, 150] },
    play: { tones: [[660, 0.18], [660, 0.18], [990, 0.5]], vib: [200, 100, 200, 100, 400] },
    change: { tones: [[990, 1.0]], vib: [800] },
    final: { tones: [[990, 0.4], [740, 0.4], [990, 0.9]], vib: [400, 150, 400] },
    end: { tones: [[990, 0.4], [740, 0.4], [990, 0.9]], vib: [400, 150, 400] }
  };
  function signal(kind) {
    var s = SIGNALS[kind] || SIGNALS.change, c = audio();
    if (navigator.vibrate) { try { navigator.vibrate(s.vib); } catch (e) {} }
    if (!c) return;
    var t = c.currentTime + 0.05;
    s.tones.forEach(function (x) {
      var o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = x[0];
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
      g.gain.setValueAtTime(0.5, t + x[1] - 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + x[1]);
      o.connect(g); g.connect(c.destination);
      o.start(t); o.stop(t + x[1] + 0.02);
      t += x[1] + 0.12;
    });
  }

  // Keep the screen on while the timer runs
  var lock = null, lockPending = false;
  function syncLock() {
    if (!('wakeLock' in navigator)) return;
    var want = T.running && document.visibilityState === 'visible';
    if (want && !lock && !lockPending) {
      lockPending = true;
      navigator.wakeLock.request('screen').then(function (l) {
        lockPending = false;
        if (!T.running) { l.release().catch(function () {}); return; }
        lock = l;
        l.addEventListener('release', function () { if (lock === l) lock = null; });
      }).catch(function () { lockPending = false; });
    } else if (!want && lock) {
      var l = lock; lock = null; l.release().catch(function () {});
    }
  }

  function two(n) { return (n < 10 ? '0' : '') + n; }
  function clock(ms) { var s = Math.ceil(ms / 1000); return two(Math.floor(s / 60)) + ':' + two(s % 60); }

  var lastRound = null;
  function renderTimer(scroll) {
    var ph = P[T.i], rem = remaining(), bar = $('timer'), btn = $('tstart'), r, cur;
    $('tphase').textContent = ph.label;
    $('tnext').textContent = T.i < P.length - 1 ? 'Далее: ' + P[T.i + 1].label + ' (' + P[T.i + 1].min + ' мин)' : 'Последний этап';
    $('tclock').textContent = clock(rem);
    $('tprog').style.width = (100 * (1 - rem / dur(T.i))).toFixed(2) + '%';
    bar.className = 'timerbar' + (ph.kind === 'change' ? ' change' : '') +
      (T.running && ph.kind === 'play' && rem <= 60000 ? ' last' : '') + (finished() ? ' done' : '');
    btn.textContent = T.running ? 'Пауза' : finished() ? 'Завершено' : started() ? 'Продолжить' : 'Старт';
    btn.disabled = finished();
    document.title = (T.running ? clock(rem) + ' · ' : '') + 'Мини-турнир по настольному теннису';
    cur = started() ? ph.r : -1;
    for (r = 0; r < ROUNDS.length; r++) $('round' + r).classList.toggle('current', r === cur);
    if (scroll && cur >= 0 && cur !== lastRound && ph.kind === 'play') {
      var a = document.activeElement;
      if (!a || a.tagName !== 'INPUT') $('round' + cur).scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    lastRound = cur;
  }

  function tick() {
    var now = Date.now(), moved = false, ended = false, rem;
    if (T.running) {
      while (now >= T.end) {
        if (T.i < P.length - 1) { T.i++; T.end += dur(T.i); T.warned = -1; moved = true; }
        else { T.running = false; T.left = 0; ended = true; break; }
      }
    }
    rem = remaining();
    if (T.running && P[T.i].kind === 'play' && rem <= 60000 && T.warned !== T.i) {
      T.warned = T.i;
      if (!moved) { signal('warn'); saveTimer(); }
    }
    if (moved || ended) { signal(ended ? 'end' : P[T.i].kind); saveTimer(); syncLock(); }
    renderTimer(moved);
  }

  function goTo(i) {
    T.i = i; T.warned = -1;
    if (T.running) T.end = Date.now() + dur(i); else T.left = dur(i);
    saveTimer(); renderTimer(true);
  }

  function bindTimer() {
    $('tstart').addEventListener('click', function () {
      audio();
      var first = !started();
      if (T.running) { T.left = remaining(); T.running = false; }
      else if (!finished()) { T.end = Date.now() + T.left; T.running = true; if (first) signal('warn'); }
      saveTimer(); syncLock(); renderTimer(true);
    });
    $('tskip').addEventListener('click', function () {
      audio();
      if (T.i < P.length - 1) goTo(T.i + 1);
      else { T.running = false; T.left = 0; saveTimer(); syncLock(); renderTimer(); }
    });
    $('tprev').addEventListener('click', function () {
      audio();
      // Like a media player: first press restarts the stage, second goes back one.
      if (dur(T.i) - remaining() > 3000 || T.i === 0) goTo(T.i);
      else goTo(T.i - 1);
    });
    $('treset').addEventListener('click', function () {
      if (!started() || window.confirm('Сбросить таймер к началу турнира?')) {
        T = freshTimer(); saveTimer(); syncLock(); renderTimer();
      }
    });
    document.addEventListener('visibilitychange', function () { if (actx && document.visibilityState === 'visible') audio(); tick(); syncLock(); });
    // Browsers only allow sound after a user gesture; unlock on the first tap anywhere.
    document.addEventListener('pointerdown', function unlock() { audio(); document.removeEventListener('pointerdown', unlock); });
    setInterval(tick, 250);
  }

  // ---------- Status line & offline ----------
  var offlineReady = false;
  function info() {
    var t = storageOK ? 'Автоподсчёт работает. Имена, результаты и таймер сохраняются в этом браузере.'
      : 'Автоподсчёт работает, но локальное сохранение недоступно. Не закрывайте страницу до окончания турнира.';
    if (offlineReady) t += ' Страница доступна без интернета.';
    if (navigator.onLine === false) t += ' Сейчас нет сети — работа офлайн.';
    $('saveinfo').textContent = t;
  }

  function registerSW() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    navigator.serviceWorker.register('sw.js').then(function () { return navigator.serviceWorker.ready; })
      .then(function () { offlineReady = true; info(); }).catch(function () {});
  }

  // ---------- Wiring ----------
  function bindName(i) {
    var e = $('name' + i);
    e.value = data.names[i];
    e.addEventListener('input', function () { data.names[i] = e.value; update(); save(); });
  }
  function bindScore(j, k) {
    var e = $('s' + j + '-' + k);
    e.value = data.scores[j][k];
    e.addEventListener('input', function () { data.scores[j][k] = e.value.trim(); update(); save(); });
  }
  function bindFormat() {
    var radios = document.querySelectorAll('input[name="target"]'), r;
    function change(e) {
      var v = Number(e.target.value);
      if (v === data.target) return;
      if (started() && !window.confirm('Длительность матчей изменится, таймер будет сброшен. Продолжить?')) { applyFormat(); return; }
      data.target = v; P = phases(); T = freshTimer(); saveTimer(); syncLock();
      applyFormat(); update(); save(); renderTimer();
    }
    for (r = 0; r < radios.length; r++) radios[r].addEventListener('change', change);
  }

  var i, j, k;
  for (i = 0; i < N; i++) bindName(i);
  for (j = 0; j < M; j++) for (k = 0; k < 2; k++) bindScore(j, k);
  bindFormat();
  $('print').addEventListener('click', function () { window.print(); });
  $('reset').addEventListener('click', function () {
    if (window.confirm('Удалить все результаты? Имена участников сохранятся.')) {
      data.scores = defaults().scores;
      for (var j = 0; j < M; j++) for (var k = 0; k < 2; k++) $('s' + j + '-' + k).value = '';
      update(); save();
    }
  });
  window.addEventListener('online', info);
  window.addEventListener('offline', info);

  applyFormat();
  update();
  info();
  $('actions').hidden = false;
  $('format').hidden = false;
  $('timer').hidden = false;
  bindTimer();
  tick();
  syncLock();
  if (document.readyState === 'complete') registerSW(); else window.addEventListener('load', registerSW);
})();
