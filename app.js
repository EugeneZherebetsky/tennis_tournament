(function () {
  'use strict';

  // Match formats. `play` is the time limit per match in minutes.
  var FORMATS = {
    11: { target: 11, play: 8, serve: 'двух', deuce: '10:10', ex: '11:9 или 13:11', word: 'очков' },
    21: { target: 21, play: 12, serve: 'пяти', deuce: '20:20', ex: '21:18 или 23:21', word: 'очка' }
  };
  var KEY = 'tt-tournament-v3', TKEY = 'tt-timer-v2';
  var MIN_PLAYERS = 2, MAX_PLAYERS = 24, MAX_TABLES = 12, MAX_MINUTES = 10080;
  var access = new URLSearchParams(location.search);
  var boardId = access.get('board'), joinCode = access.get('code');
  var readOnly = boardId !== null || joinCode !== null, sharing, mode = readOnly ? 'viewer' : 'choose';
  var viewCode, reportState, reportReturn, reportScroll;

  function $(id) { return document.getElementById(id); }

  // ---------- Storage ----------
  var storageOK = true;
  function load(k) {
    try { return JSON.parse(window.localStorage.getItem(k)); } catch (e) { storageOK = false; return null; }
  }
  function store(k, v) {
    try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { storageOK = false; }
  }

  function inRange(value, min, max) {
    return Number.isInteger(value) && value >= min && value <= max;
  }
  function blankScores(count) {
    return Array.from({ length: count }, function () { return ['', '']; });
  }
  function isScalar(v) { return typeof v === 'string' || typeof v === 'number'; }

  // Coerce whatever is in storage into a well-formed state; drop anything odd.
  function sanitize(raw) {
    raw = raw || {};
    var players = inRange(raw.players, MIN_PLAYERS, MAX_PLAYERS) ? raw.players : 5;
    var tables = inRange(raw.tables, 1, MAX_TABLES) ? raw.tables : 2;
    var target = raw.target === 21 || raw.target === '21' ? 21 : 11;
    var min = Tournament.minimumMinutes(Tournament.schedule(players, tables).length);
    var d = {
      players: players, tables: tables, target: target,
      minutes: inRange(raw.minutes, min, MAX_MINUTES) ? raw.minutes : null,
      names: Array.from({ length: players }, function (_, i) { return 'П' + (i + 1); }),
      scores: blankScores(players * (players - 1) / 2)
    };
    var i, j, k, v;
    if (Array.isArray(raw.names)) {
      for (i = 0; i < d.names.length; i++) if (isScalar(raw.names[i])) d.names[i] = String(raw.names[i]).slice(0, 40);
    }
    if (Array.isArray(raw.scores)) {
      for (j = 0; j < d.scores.length; j++) {
        if (!Array.isArray(raw.scores[j])) continue;
        for (k = 0; k < 2; k++) {
          v = raw.scores[j][k];
          if (isScalar(v) && /^\d{0,2}$/.test(String(v).trim())) d.scores[j][k] = String(v).trim();
        }
        if (raw.scores[j][2] === true) d.scores[j][2] = true;
      }
    }
    return d;
  }

  var saved = readOnly ? null : load(KEY);
  var data = sanitize(readOnly ? null : saved || load('tt-tournament-5-v2') || load('tt-tournament-5-v1'));
  var ROUNDS = Tournament.schedule(data.players, data.tables);
  var PAIRS = ROUNDS.flat();
  var PLAN = Tournament.timing(ROUNDS.length, fmt().play, data.minutes);
  function save() {
    if (mode === 'owner') { sharing.changed(); return; }
    if (mode !== 'local') return;
    store(KEY, data);
    localDraft.data = structuredClone(data);
    info();
  }
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
    if (s[2] === true) {
      res.note = 'по лимиту времени';
    } else if (hi > t && hi - lo > 2) {
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
    var N = data.players, M = PAIRS.length;
    var stat = [], results = [], done = 0, i, j, k, p, r, z, st, label, rank = 1, tie, d, values, tr,
      body = $('ranking'), leaders = [], reportRanking = [];
    for (i = 0; i < N; i++) stat.push({ i: i, g: 0, w: 0, l: 0, f: 0, a: 0, h: 0 });
    ROUNDS.forEach(function (round, i) {
      var rest = $('rest' + i);
      if (rest.hidden) return;
      var playing = new Set(round.flat());
      rest.textContent = 'Отдых: ' + data.names.map(function (_, player) {
        return playing.has(player) ? null : name(player);
      }).filter(Boolean).join(', ');
    });

    for (j = 0; j < M; j++) {
      p = PAIRS[j]; r = assess(data.scores[j]); results.push(r);
      for (k = 0; k < 2; k++) {
        label = $('p' + j + '-' + k);
        label.textContent = name(p[k]);
        label.className = 'player' + (r.ok && r.w === k ? ' win' : '');
        $('s' + j + '-' + k).textContent = data.scores[j][k] || '—';
      }
      st = $('state' + j);
      if (r.ok) {
        st.className = 'state' + (r.warn ? ' invalid' : r.note ? ' note' : '');
        st.textContent = 'Записано · ' + name(p[r.w]) + ' · ' + r.a + ':' + r.b + (r.note ? ' · ' + r.note : '');
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
      var edit = $('edit' + j);
      if (edit) edit.textContent = r.ok ? 'Изменить результат' : 'Внести результат';
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
      reportRanking.push(values.slice(0, 8));
      for (k = 0; k < values.length; k++) tr.appendChild(make('td', values[k]));
      body.appendChild(tr);
      if (cmp(stat[0], z) === 0) leaders.push(name(z.i));
    }
    $('progress').textContent = 'Сыграно ' + done + ' из ' + M + ' матчей. ' + (done === M ? 'Турнир завершён.' : 'Рейтинг предварительный.');
    $('result').textContent = done === M ? (leaders.length === 1 ? '🏆 Победитель: ' + leaders[0] : 'Первое место делят: ' + leaders.join(', ')) : '';
    reportState = { ranking: reportRanking, results: results };
    $('report-open').textContent = done === M ? 'Итоговый протокол / PDF' : 'Протокол матчей / PDF';
    updatePlayerOptions();
    renderPlayer();
  }

  // ---------- Format-dependent texts ----------
  function setLines(el, a, b) {
    while (el.firstChild) el.removeChild(el.firstChild);
    el.appendChild(document.createTextNode(a));
    el.appendChild(document.createElement('br'));
    el.appendChild(document.createTextNode(b));
  }

  function applyFormat() {
    var f = fmt(), end = PLAN.warm, total = PLAN.total / 60, r;
    var play = durationLabel(PLAN.games[PLAN.games.length - 1]);
    if (PLAN.games[0] !== PLAN.games[PLAN.games.length - 1]) play += '–' + durationLabel(PLAN.games[0]);
    var radios = document.querySelectorAll('input[name="target"]');
    for (r = 0; r < radios.length; r++) radios[r].checked = Number(radios[r].value) === f.target;
    $('mtotal').textContent = total;
    $('mplayers').textContent = data.players;
    $('mtables').textContent = data.tables;
    $('matchsummary').textContent = 'Матчей: ' + PAIRS.length + ' · Раундов: ' + ROUNDS.length + ' · Матчей на игрока: ' + (data.players - 1);
    for (r = 0; r < ROUNDS.length; r++) {
      var start = end;
      end += PLAN.games[r] + PLAN.change;
      $('rtime' + r).textContent = 'Раунд ' + (r + 1) + ' · ' + durationLabel(start) + '–' + durationLabel(end) + ' мин';
    }
    setLines($('tlmain'), durationLabel(PLAN.warm) + '–' + durationLabel(end) + ' мин', 'Раундов: ' + ROUNDS.length);
    setLines($('tlend'), durationLabel(end) + '–' + total + ' мин', 'Итоги');
    $('schedinfo').textContent = 'Время от начала турнира. Игра: ' + play + ' мин на раунд. Смена игроков и запись счёта: 2 мин.';
    $('scoreinfo').textContent = 'Матч до ' + f.target + ' ' + f.word + '.';
    $('rule2').textContent = 'Матч состоит из одной партии до ' + f.target + ' ' + f.word +
      '. Для обычной победы нужен перевес минимум в два очка (например, ' + f.ex + ').';
    $('rule3').textContent = 'Первую подачу определите жребием. Подача переходит после каждых ' + f.serve +
      ' розыгрышей, при ' + f.deuce + ' — после каждого. При подаче мяч подбрасывают с открытой ладони, и он должен отскочить сначала на своей, затем на чужой половине стола.';
    $('rule4').textContent = 'Лимит — ' + play + ' мин на матч. По сигналу таймера завершите текущий розыгрыш. ' +
      'Если партия не закончена, выигрывает тот, кто ведёт в счёте. При равенстве разыгрывается одно решающее очко по очереди подачи. ' +
      'Затем внесите итоговый счёт. Это специальное правило мини-турнира, а не стандартное правило настольного тенниса.';
    $('fmthint').textContent = 'Игра: ' + play + ' мин на матч. Турнир: ' + total + ' мин.';
  }

  // ---------- Timer ----------
  function durationLabel(seconds) {
    return Math.floor(seconds / 60) + (seconds % 60 ? ':' + two(seconds % 60) : '');
  }
  function phases() {
    var p = [{ r: -1, kind: 'warm', label: 'Разминка', seconds: PLAN.warm }], r;
    for (r = 0; r < ROUNDS.length; r++) {
      p.push({ r: r, kind: 'play', label: 'Раунд ' + (r + 1) + ' · игра', seconds: PLAN.games[r] });
      p.push({ r: r, kind: 'change', label: 'Раунд ' + (r + 1) + ' · ' + (r < ROUNDS.length - 1 ? 'смена и запись' : 'запись результатов'), seconds: PLAN.change });
    }
    p.push({ r: -1, kind: 'final', label: 'Итоги', seconds: PLAN.final });
    return p;
  }
  var P = phases();
  function dur(i) { return P[i].seconds * 1000; }
  function freshTimer() {
    return { i: 0, running: false, end: 0, left: dur(0), warned: -1, plan: [data.players, data.tables, PLAN.total].join('/') };
  }

  function loadTimer() {
    var t = load(TKEY), f = freshTimer();
    if (!t && !saved) {
      var legacy = load('tt-timer-v1');
      if (legacy && legacy.target === data.target) t = Object.assign({ plan: f.plan }, legacy);
    }
    return restoreTimer(t);
  }

  function restoreTimer(t) {
    var f = freshTimer();
    if (!t || t.plan !== f.plan) return f;
    var i = Number(t.i);
    if (!(i >= 0 && i < P.length && Math.floor(i) === i)) return f;
    f.i = i;
    f.warned = Number(t.warned) === i ? i : -1;
    if (t.running === true && isFinite(t.end)) { f.running = true; f.end = Number(t.end); }
    else f.left = Math.max(0, Math.min(dur(i), Number(t.left) || 0));
    return f;
  }
  var T = readOnly ? freshTimer() : loadTimer();
  var localDraft = readOnly ? null : structuredClone({ data: data, timer: T });
  function saveTimer() {
    if (mode === 'owner') { sharing.changed(); return; }
    if (mode === 'local') {
      store(TKEY, T);
      localDraft.timer = structuredClone(T);
    }
  }
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
        if (!T.running || mode === 'choose') { l.release().catch(function () {}); return; }
        lock = l;
        l.addEventListener('release', function () { if (lock === l) lock = null; });
      }).catch(function () { lockPending = false; });
    } else if (!want && lock) {
      var l = lock; lock = null; l.release().catch(function () {});
    }
  }

  function two(n) { return (n < 10 ? '0' : '') + n; }
  function clock(ms) { var s = Math.ceil(ms / 1000); return two(Math.floor(s / 60)) + ':' + two(s % 60); }

  var lastRound = -1, lastPhase;
  function renderTimer() {
    var ph = P[T.i], rem = remaining(), bar = $('timer'), btn = $('tstart'), cur;
    var next = P[T.i + 1];
    $('tphase').textContent = ph.label;
    $('tnext').textContent = next ? 'Далее: ' + next.label + ' (' + durationLabel(next.seconds) + ' мин)' : 'Последний этап';
    $('tclock').textContent = clock(rem);
    $('tprog').style.width = (100 * (1 - rem / dur(T.i))).toFixed(2) + '%';
    bar.className = 'timerbar' + (ph.kind === 'change' ? ' change' : '') +
      (T.running && ph.kind === 'play' && rem <= 60000 ? ' last' : '') + (finished() ? ' done' : '');
    btn.textContent = T.running ? 'Пауза' : finished() ? 'Завершено' : started() ? 'Продолжить' : 'Старт';
    btn.disabled = finished();
    if (!document.body.classList.contains('report-open')) {
      document.title = (T.running ? clock(rem) + ' · ' : '') + 'Мини-турнир по настольному теннису';
    }
    cur = started() ? ph.r : -1;
    if (cur !== lastRound) {
      if (lastRound >= 0) {
        var previous = $('round' + lastRound);
        previous.classList.remove('current');
        $('rounds').insertBefore(previous, $('round' + (lastRound + 1)));
      }
      if (cur >= 0) {
        var current = $('round' + cur);
        current.classList.add('current');
        $('rounds').prepend(current);
      }
    }
    lastRound = cur;
    var phase = T.i + '/' + finished();
    if (phase !== lastPhase) {
      $('jump-now').href = cur < 0 ? '#schedule' : '#round' + cur;
      renderPlayer();
      lastPhase = phase;
    }
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
      if (!moved && !readOnly) { signal('warn'); saveTimer(); }
    }
    if ((moved || ended) && !readOnly) { signal(ended ? 'end' : P[T.i].kind); saveTimer(); syncLock(); }
    renderTimer();
  }

  function goTo(i) {
    T.i = i; T.warned = -1;
    if (T.running) T.end = Date.now() + dur(i); else T.left = dur(i);
    saveTimer(); renderTimer();
  }

  function bindTimer() {
    $('tstart').addEventListener('click', function () {
      audio();
      var first = !started();
      if (T.running) { T.left = remaining(); T.running = false; }
      else if (!finished()) {
        T.end = Date.now() + T.left; T.running = true;
        if (first) { $('organizer').open = false; signal('warn'); }
      }
      saveTimer(); syncLock(); renderTimer();
    });
    $('tskip').addEventListener('click', function () {
      audio();
      $('timer-controls').open = false;
      if (T.i < P.length - 1) goTo(T.i + 1);
      else { T.running = false; T.left = 0; saveTimer(); syncLock(); renderTimer(); }
    });
    $('tprev').addEventListener('click', function () {
      audio();
      $('timer-controls').open = false;
      // Like a media player: first press restarts the stage, second goes back one.
      if (dur(T.i) - remaining() > 3000 || T.i === 0) goTo(T.i);
      else goTo(T.i - 1);
    });
    $('treset').addEventListener('click', function () {
      if (!started() || window.confirm('Сбросить таймер к началу турнира?')) {
        $('timer-controls').open = false;
        T = freshTimer(); saveTimer(); syncLock(); renderTimer();
      }
    });
    document.addEventListener('visibilitychange', function () {
      if (mode === 'choose') return;
      if (actx && document.visibilityState === 'visible') audio();
      tick();
      syncLock();
    });
    // Browsers only allow sound after a user gesture; unlock on the first tap anywhere.
    document.addEventListener('pointerdown', function unlock() { audio(); document.removeEventListener('pointerdown', unlock); });
    setInterval(function () { if (mode !== 'choose') tick(); }, 250);
  }

  // ---------- Status line & offline ----------
  var offlineReady = false;
  function info() {
    var t = mode === 'owner' ? 'Официальные данные турнира хранятся на сервере.'
      : storageOK ? 'Настройки, имена, результаты и таймер сохраняются в этом браузере.'
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
  // Reuse the static controls that also make up the no-JavaScript fallback.
  var nameTemplate = $('name0').parentElement.cloneNode(true);
  var roundTemplate = $('round0').cloneNode(false);
  var headTemplate = $('rtime0').parentElement.cloneNode(true);
  var matchTemplate = document.querySelector('.match').cloneNode(true);
  var playerKey = readOnly ? 'tt-view-player' : 'tt-my-player';
  var selectedPlayer = load(playerKey);

  function updatePlayerOptions() {
    var picker = $('my-player');
    if (!inRange(selectedPlayer, 0, data.players - 1)) selectedPlayer = null;
    while (picker.options.length > data.players + 1) picker.remove(picker.options.length - 1);
    var labels = data.names.map(function (_, i) { return name(i); });
    labels.forEach(function (label, i) {
      var option = picker.options[i + 1];
      if (!option) {
        option = document.createElement('option');
        option.value = i;
        picker.add(option);
      }
      option.textContent = labels.indexOf(label) === labels.lastIndexOf(label) ? label : label + ' · №' + (i + 1);
    });
    picker.value = selectedPlayer === null ? '' : String(selectedPlayer);
  }

  function fixtureLink(fixture) {
    var link = make('a', 'Раунд ' + (fixture.round + 1) + ' · Стол ' + fixture.table + ' · ' + name(fixture.opponent));
    link.href = '#match' + fixture.match;
    return link;
  }

  function renderPlayer() {
    var card = $('my-current'), list = $('my-fixtures');
    card.replaceChildren();
    list.replaceChildren();
    $('my-all').hidden = selectedPlayer === null;
    if (selectedPlayer === null) return;
    var matches = Tournament.matchesFor(ROUNDS, selectedPlayer);
    var ph = P[T.i], current = matches.find(function (match) { return match.round === ph.r; });
    var next = matches.find(function (match) { return match.round > ph.r && !assess(data.scores[match.match]).ok; });
    if (ph.kind === 'final' || finished()) card.append(make('strong', 'Игры завершены. Итоги в таблице.'));
    else if (current) card.append(make('strong', ph.kind === 'change' ? 'Завершённый раунд' : 'Сейчас'), fixtureLink(current));
    else if (ph.kind !== 'warm') card.append(make('strong', 'Сейчас вы отдыхаете.'));
    if (next && ph.kind !== 'final' && !finished()) card.append(make('strong', 'Следующий матч'), fixtureLink(next));

    matches.forEach(function (match) {
      var item = document.createElement('li');
      item.append(fixtureLink(match));
      var score = data.scores[match.match];
      if (assess(score).ok) item.append(make('span', ' · ' + score[0] + ':' + score[1]));
      list.append(item);
    });
  }

  function renderSchedule() {
    $('names').textContent = '';
    data.names.forEach(function (_, i) {
      var label = nameTemplate.cloneNode(true), input = label.querySelector('input');
      label.firstChild.nodeValue = 'Игрок ' + (i + 1);
      label.htmlFor = input.id = 'name' + i;
      $('names').appendChild(label);
      if (!readOnly) bindName(i);
    });
    var rounds = document.createDocumentFragment(), matchIndex = 0;
    ROUNDS.forEach(function (pairs, r) {
      var round = roundTemplate.cloneNode(false), head = headTemplate.cloneNode(true);
      var matches = document.createElement('div');
      round.id = 'round' + r;
      head.querySelector('b').id = 'rtime' + r;
      var rest = head.querySelector('.rest');
      rest.id = 'rest' + r;
      rest.hidden = pairs.length * 2 === data.players;
      matches.className = 'matches';
      pairs.forEach(function (_, table) {
        var match = matchTemplate.cloneNode(true);
        var j = matchIndex++;
        match.id = 'match' + j;
        match.querySelector('.tabletag').textContent = 'Стол ' + (table + 1);
        match.querySelector('.state').id = 'state' + j;
        match.querySelectorAll('.matchrow').forEach(function (row, k) {
          var label = make('span', ''), score = make('span', '');
          label.id = 'p' + j + '-' + k;
          score.id = 's' + j + '-' + k;
          score.className = 'score-value';
          row.replaceChildren(label, score);
        });
        if (!readOnly) {
          var edit = make('button', 'Внести результат');
          edit.id = 'edit' + j;
          edit.type = 'button';
          edit.className = 'match-edit';
          edit.setAttribute('aria-describedby', 'p' + j + '-0 p' + j + '-1');
          edit.addEventListener('click', function () { editScore(j, r, table + 1); });
          match.appendChild(edit);
        }
        matches.appendChild(match);
      });
      round.append(head, matches);
      rounds.appendChild(round);
    });
    $('rounds').replaceChildren(rounds);
    lastRound = -1;
    lastPhase = undefined;
  }

  function previewSetup() {
    var players = $('player-count').valueAsNumber, tables = $('table-count').valueAsNumber;
    if (!inRange(players, MIN_PLAYERS, MAX_PLAYERS) || !inRange(tables, 1, MAX_TABLES)) {
      $('setup-hint').textContent = 'Введите от 2 до 24 игроков и от 1 до 12 столов.';
      return null;
    }
    var rounds = Tournament.schedule(players, tables);
    var duration = $('tournament-minutes'), min = Tournament.minimumMinutes(rounds.length);
    var minutes = duration.value === '' && !duration.validity.badInput ? null : duration.valueAsNumber;
    duration.min = min;
    var automatic = Tournament.timing(rounds.length, fmt().play, null).total / 60;
    duration.placeholder = automatic + ' (авто)';
    $('setup-hint').textContent = 'Раундов: ' + rounds.length + ' · Минимум: ' + min + ' мин · Авто: ' + automatic + ' мин';
    return { rounds: rounds, players: players, tables: tables, minutes: minutes };
  }

  function bindSetup() {
    var form = $('setup');
    fillSetup();
    form.addEventListener('input', function () { $('setup-status').textContent = ''; previewSetup(); });
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var setup = previewSetup();
      if (!setup || !form.reportValidity()) return;
      var plan = Tournament.timing(setup.rounds.length, fmt().play, setup.minutes);
      var structureChanged = setup.players !== data.players || setup.tables !== data.tables;
      var resetTimer = structureChanged || plan.total !== PLAN.total;
      var removedResults = PAIRS.some(function (pair, j) {
        return pair[1] >= setup.players && data.scores[j].slice(0, 2).some(Boolean);
      });
      var warnings = [];
      if (removedResults) warnings.push('Счёт матчей удалённых игроков будет удалён.');
      if (resetTimer && started()) warnings.push('Таймер вернётся к началу турнира.');
      if (warnings.length && !window.confirm(warnings.join(' ') + ' Применить настройки?')) return;

      if (structureChanged) {
        var previousScores = new Map(PAIRS.map(function (pair, j) { return [pair.join('-'), data.scores[j]]; }));
        ROUNDS = setup.rounds;
        PAIRS = ROUNDS.flat();
        data.names = Array.from({ length: setup.players }, function (_, i) {
          return i < data.names.length ? data.names[i] : 'П' + (i + 1);
        });
        data.scores = PAIRS.map(function (pair) { return previousScores.get(pair.join('-')) || ['', '']; });
        data.players = setup.players;
        data.tables = setup.tables;
        renderSchedule();
      }
      data.minutes = setup.minutes;
      PLAN = plan;
      if (resetTimer) { P = phases(); T = freshTimer(); syncLock(); }
      applyFormat();
      update();
      save();
      saveTimer();
      renderTimer();
      $('setup-status').textContent = 'Настройки применены.';
    });
    previewSetup();
    $('setup-section').hidden = false;
  }

  function bindName(i) {
    var e = $('name' + i);
    e.value = data.names[i];
    e.addEventListener('input', function () { data.names[i] = e.value; update(); save(); });
  }

  function fillSetup() {
    $('player-count').value = data.players;
    $('table-count').value = data.tables;
    $('tournament-minutes').value = data.minutes === null ? '' : data.minutes;
    previewSetup();
  }
  var editedMatch;
  function editScore(j, round, table) {
    editedMatch = j;
    var pair = PAIRS[j], score = data.scores[j];
    $('score-context').textContent = 'Раунд ' + (round + 1) + ' · Стол ' + table + ' · До ' + data.target;
    $('score-name-a').textContent = name(pair[0]);
    $('score-name-b').textContent = name(pair[1]);
    $('score-a').value = score[0];
    $('score-b').value = score[1];
    $('score-timed').checked = score[2] === true;
    $('score-clear').hidden = !score.slice(0, 2).some(Boolean);
    $('score-error').textContent = '';
    $('score-dialog').showModal();
    $('score-a').select();
  }

  function bindScoreDialog() {
    var dialog = $('score-dialog');
    $('score-cancel').addEventListener('click', function () { dialog.close(); });
    $('score-clear').addEventListener('click', function () {
      if (!window.confirm('Удалить результат этого матча?')) return;
      data.scores[editedMatch] = ['', ''];
      dialog.close();
      update();
      save();
      $('score-announcement').textContent = 'Результат матча удалён.';
    });
    $('score-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var score = [$('score-a').value.trim(), $('score-b').value.trim()];
      var timed = $('score-timed').checked;
      var error = Tournament.checkScore(score, data.target, timed);
      if (error) {
        $('score-error').textContent = {
          empty: 'Введите очки обоих участников.',
          number: 'Введите целые числа от 0 до 99.',
          tie: 'При равном счёте разыграйте решающее очко.',
          time: 'Проверьте счёт. Если игра закончилась по сигналу, отметьте лимит времени.'
        }[error];
        return;
      }
      if (timed) score.push(true);
      data.scores[editedMatch] = score;
      dialog.close();
      update();
      save();
      $('score-announcement').textContent = $('state' + editedMatch).textContent;
    });
  }
  function bindFormat() {
    var radios = document.querySelectorAll('input[name="target"]'), r;
    function change(e) {
      var v = Number(e.target.value);
      if (v === data.target) return;
      if (data.minutes === null && started() && !window.confirm('Длительность матчей изменится, таймер будет сброшен. Продолжить?')) { applyFormat(); return; }
      data.target = v;
      if (data.minutes === null) {
        PLAN = Tournament.timing(ROUNDS.length, fmt().play, null);
        P = phases();
        T = freshTimer();
        syncLock();
      }
      applyFormat(); previewSetup(); update(); save(); saveTimer(); renderTimer();
    }
    for (r = 0; r < radios.length; r++) radios[r].addEventListener('change', change);
  }

  function showSharedBoard(text, available) {
    var status = $('view-status');
    $('viewer-banner').hidden = false;
    if (status.textContent !== text) status.textContent = text;
    showTournament(available);
  }

  function showTournament(available) {
    ['match-toolbar', 'my-matches', 'schedule', 'standings', 'rules-panel'].forEach(function (id) {
      $(id).hidden = !available;
    });
    $('matchsummary').hidden = !available;
    document.querySelector('header .metrics').hidden = !available;
  }

  function receiveSharedBoard(snapshot, code) {
    if (code) viewCode = code;
    var next = sanitize(snapshot.data);
    var rebuild = next.players !== data.players || next.tables !== data.tables || !$('match0');
    var settingsChanged = rebuild || data.target !== next.target || data.minutes !== next.minutes;
    data = next;
    if (rebuild) {
      ROUNDS = Tournament.schedule(data.players, data.tables);
      PAIRS = ROUNDS.flat();
      renderSchedule();
    }
    if (settingsChanged) {
      PLAN = Tournament.timing(ROUNDS.length, fmt().play, data.minutes);
      P = phases();
      applyFormat();
      if (!readOnly) fillSetup();
    }
    T = restoreTimer(snapshot.timer);
    if (!readOnly) {
      data.names.forEach(function (playerName, i) {
        if ($('name' + i).value !== playerName) $('name' + i).value = playerName;
      });
    }
    update();
    tick();
    if (!readOnly) syncLock();
  }

  function organizerMode(next) {
    mode = next;
    showTournament(mode !== 'choose');
    $('organizer').hidden = mode === 'choose';
    if (mode === 'choose') {
      if (lock) { var activeLock = lock; lock = null; activeLock.release().catch(function () {}); }
      $('timer-controls').open = false;
    }
    if (mode !== 'choose') $('organizer').open = mode === 'local';
    info();
  }

  function initialSnapshot(importDraft) {
    if (importDraft) return structuredClone(localDraft);
    var setup = sanitize(null);
    var plan = Tournament.timing(Tournament.schedule(setup.players, setup.tables).length, FORMATS[setup.target].play, setup.minutes);
    return { data: setup, timer: {
      i: 0, running: false, end: 0, left: plan.warm * 1000, warned: -1,
      plan: [setup.players, setup.tables, plan.total].join('/')
    } };
  }

  function reportRows(body, rows) {
    var content = document.createDocumentFragment();
    rows.forEach(function (values) {
      var row = document.createElement('tr');
      values.forEach(function (value) { row.appendChild(make('td', value)); });
      content.appendChild(row);
    });
    body.replaceChildren(content);
  }

  function openReport(event) {
    if (mode === 'owner' && !sharing.isSaved()) {
      $('report-notice').textContent = 'Дождитесь сохранения результатов на сервере и откройте протокол снова.';
      return;
    }
    $('report-notice').textContent = '';
    var matches = Tournament.reportMatches(ROUNDS, reportState.results, data.scores, data.names.map(function (_, i) { return name(i); }));
    var complete = matches.played === PAIRS.length;
    var code = mode === 'owner' ? $('session-code').textContent : (viewCode || joinCode || '');
    var stamp = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short' }).format(new Date());
    var label = complete ? 'Итоговый протокол' : 'Промежуточный протокол';
    $('report-title').textContent = label;
    $('report-meta').textContent = (code ? 'Код: ' + code.replace(/-/g, '').match(/.{1,4}/g).join('-') + ' · ' : '') +
      (mode === 'local' ? 'Локальный турнир · ' : '') + 'Сформирован: ' + stamp;
    $('report-summary').textContent = 'Игроков: ' + data.players + ' · Столов: ' + data.tables +
      ' · Игра до ' + data.target + ' ' + fmt().word + ' · Сыграно ' + matches.played + ' из ' + PAIRS.length;
    $('report-outcome').textContent = $('result').textContent.replace(/^🏆\s*/u, '');
    $('report-outcome').hidden = !complete;
    reportRows($('report-ranking'), reportState.ranking);
    reportRows($('report-matches'), matches.rows);
    reportReturn = event.currentTarget;
    reportScroll = window.scrollY;
    $('results-report').hidden = false;
    document.body.classList.add('report-open');
    document.title = label + (code ? ' — ' + code : '') + ' — Настольный теннис';
    $('report-title').focus();
    window.scrollTo(0, 0);
  }

  renderSchedule();
  $('my-player').addEventListener('change', function (event) {
    selectedPlayer = event.target.value === '' ? null : Number(event.target.value);
    store(playerKey, selectedPlayer);
    renderPlayer();
  });
  $('standings-detail').addEventListener('click', function () {
    var open = $('standings').classList.toggle('show-details');
    $('standings-detail').setAttribute('aria-expanded', open);
    $('standings-detail').textContent = open ? 'Кратко' : 'Подробности';
    $('standings-key').hidden = !open;
  });
  applyFormat();
  update();
  $('standings-detail').hidden = false;
  $('standings-key').hidden = true;
  $('standings').classList.add('player-standings');
  $('report-open').hidden = false;
  $('report-open').addEventListener('click', openReport);
  $('report-print').addEventListener('click', function () { window.print(); });
  $('report-close').addEventListener('click', function () {
    $('results-report').hidden = true;
    document.body.classList.remove('report-open');
    renderTimer();
    reportReturn.focus({ preventScroll: true });
    window.scrollTo(0, reportScroll);
  });
  $('timer').hidden = false;
  if (readOnly) {
    $('tstart').hidden = true;
    $('timer-controls').hidden = true;
    $('organizer').hidden = true;
    showSharedBoard('Загружаем общую таблицу…', false);
    SharedBoard.viewer(boardId, joinCode, receiveSharedBoard, showSharedBoard);
    setInterval(tick, 250);
  } else {
    bindSetup();
    bindFormat();
    bindScoreDialog();
    $('print').addEventListener('click', openReport);
    $('reset').addEventListener('click', function () {
      if (window.confirm('Удалить все результаты? Имена участников сохранятся.')) {
        data.scores = blankScores(PAIRS.length);
        update(); save();
      }
    });
    window.addEventListener('online', info);
    window.addEventListener('offline', info);
    info();
    $('actions').hidden = false;
    $('format').hidden = false;
    if (started()) $('organizer').open = false;
    bindTimer();
    if (window.isSecureContext && window.crypto && crypto.randomUUID) {
      sharing = SharedBoard.organizer({
        snapshot: function () { return { data: data, timer: T }; },
        initial: initialSnapshot, mode: organizerMode, receive: receiveSharedBoard,
        canRefresh: function () {
          return !$('score-dialog').open && !document.activeElement.closest('#setup, #names, #format');
        },
        load: load, store: store
      });
    } else {
      organizerMode('local');
    }
  }
  if (document.readyState === 'complete') registerSW(); else window.addEventListener('load', registerSW);
})();
