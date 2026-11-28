(function () {
  'use strict';

  // Match formats. `play` is the time limit per match in minutes.
  var FORMATS = {
    11: { target: 11, play: 8, serve: I18n.t('двух'), deuce: '10:10', ex: I18n.t('11:9 или 13:11'), word: I18n.t('очков') },
    21: { target: 21, play: 12, serve: I18n.t('пяти'), deuce: '20:20', ex: I18n.t('21:18 или 23:21'), word: I18n.t('очка') }
  };
  var KEY = 'tt-tournament-v3', TKEY = 'tt-timer-v2';
  var MIN_PLAYERS = 2, MAX_PLAYERS = 24, MAX_TABLES = 12, MAX_MINUTES = 10080;
  var access = new URLSearchParams(location.search);
  var boardId = access.get('board'), joinCode = access.get('code');
  var readOnly = boardId !== null || joinCode !== null, sharing, mode = readOnly ? 'viewer' : 'choose';
  var viewCode, reportReturn, reportScroll, finalizedAt = null;
  var queueEntries = [], queueLayout, roundTimes = [], offsets = [], allRounds = false, archiveSource;

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
      title: typeof raw.title === 'string' ? raw.title.slice(0, 80) : '',
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
  function shownName(value, i) {
    var fallback = 'П' + (i + 1);
    var label = String(value || '').trim() || fallback;
    return I18n.lang === 'en' && label === fallback ? 'P' + (i + 1) : label;
  }

  function name(i) { return shownName(data.names[i], i); }

  // ---------- Score validation ----------
  function num(x) { x = String(x).trim(); return /^\d{1,2}$/.test(x) ? Number(x) : null; }

  function assess(s) {
    var t = fmt().target, a, b, hi, lo, res;
    if (String(s[0]).trim() === '' || String(s[1]).trim() === '') return { ok: false, empty: true };
    a = num(s[0]); b = num(s[1]);
    if (a === null || b === null) return { ok: false, msg: I18n.t('Введите целое число от 0 до 99.') };
    if (a === b) return { ok: false, msg: I18n.t('Ничьей быть не может — нужен победитель.') };
    hi = Math.max(a, b); lo = Math.min(a, b);
    res = { ok: true, a: a, b: b, w: a > b ? 0 : 1, note: '', warn: false };
    if (s[2] === true) {
      res.note = I18n.t('по лимиту времени');
    } else if (hi > t && hi - lo > 2) {
      res.warn = true;
      res.note = I18n.t('проверьте счёт: после ') + (t - 1) + ':' + (t - 1) + I18n.t(' игра идёт до перевеса в 2 очка.');
    } else if (!((hi === t && lo <= t - 2) || (hi > t && hi - lo === 2))) {
      res.note = I18n.t('нестандартный счёт — окончено по лимиту времени?');
    }
    return res;
  }

  // ---------- Standings ----------
  // Order: wins → head-to-head among players level on wins → point difference → points scored.
  function cmp(a, b) { return b.w - a.w || b.h - a.h || (b.f - b.a) - (a.f - a.a) || b.f - a.f; }

  function make(tag, txt) { var e = document.createElement(tag); e.textContent = txt; return e; }

  function rankMatches(players, pairs, results, playerName) {
    var stat = Array.from({ length: players }, function (_, i) { return { i: i, g: 0, w: 0, l: 0, f: 0, a: 0, h: 0 }; });
    var played = 0;
    results.forEach(function (result, i) {
      if (!result.ok) return;
      played++;
      pairs[i].forEach(function (player, side) {
        var row = stat[player], own = side === 0 ? result.a : result.b, other = side === 0 ? result.b : result.a;
        row.g++; row.f += own; row.a += other;
        if (own > other) row.w++; else row.l++;
      });
    });
    results.forEach(function (result, i) {
      var pair = pairs[i];
      if (result.ok && stat[pair[0]].w === stat[pair[1]].w) stat[pair[result.w]].h++;
    });
    stat.sort(function (a, b) { return cmp(a, b) || a.i - b.i; });
    var rank = 1, leaders = [];
    var rows = stat.map(function (row, i) {
      if (i && cmp(stat[i - 1], row) !== 0) rank = i + 1;
      var tie = (i > 0 && cmp(stat[i - 1], row) === 0) || (i < stat.length - 1 && cmp(row, stat[i + 1]) === 0);
      var delta = row.f - row.a;
      if (cmp(stat[0], row) === 0) leaders.push(playerName(row.i));
      return { rank: rank, cells: [played ? rank + (tie ? '=' : '') : '—', playerName(row.i),
        row.g, row.w, row.l, row.f, row.a, (delta > 0 ? '+' : '') + delta, row.w] };
    });
    return { played: played, leaders: leaders, rows: rows };
  }

  function paintRound(round, r) {
    var rest = round.querySelector('.rest');
    if (!rest.hidden) {
      var playing = new Set(ROUNDS[r].flat());
      rest.textContent = I18n.t('Отдых: ') + data.names.map(function (_, i) {
        return playing.has(i) ? null : name(i);
      }).filter(Boolean).join(', ');
    }
    round.querySelectorAll('[data-match]').forEach(function (match) {
      var j = Number(match.dataset.match), p = PAIRS[j], result = assess(data.scores[j]);
      p.forEach(function (player, side) {
        var label = $('p' + j + '-' + side);
        label.textContent = name(player);
        label.className = 'player' + (result.ok && result.w === side ? ' win' : '');
        $('s' + j + '-' + side).textContent = data.scores[j][side] || '—';
      });
      var status = $('state' + j);
      status.className = 'state' + (result.warn || (!result.ok && !result.empty) ? ' invalid' : result.note ? ' note' : '');
      status.textContent = result.ok
        ? I18n.t('Записано · ') + name(p[result.w]) + ' · ' + result.a + ':' + result.b + (result.note ? ' · ' + result.note : '')
        : result.empty ? I18n.t('Ожидает результата') : result.msg;
      var operation = queuedFor(j);
      if (operation) {
        status.className += operation.review ? ' invalid' : ' note';
        status.textContent += ' · ' + (operation.review ? I18n.t('Нужна проверка') : I18n.t('В очереди')) +
          ' (' + (operation.score[0] ? operation.score.slice(0, 2).join(':') : I18n.t('удаление')) + ')';
      }
      var edit = $('edit' + j);
      if (edit) {
        edit.hidden = Boolean(finalizedAt);
        edit.disabled = Boolean(operation && !operation.review);
        edit.textContent = operation?.review ? I18n.t('Проверить') : result.ok ? I18n.t('Изменить') : I18n.t('Ввести счёт');
      }
    });
  }

  function paintVisibleRounds() {
    $('rounds').querySelectorAll('.round').forEach(function (round) { paintRound(round, Number(round.dataset.round)); });
  }

  function resultText(leaders) {
    return leaders.length === 1 ? I18n.t('Победитель: ') + leaders[0] : I18n.t('Первое место делят: ') + leaders.join(', ');
  }

  function update() {
    $('tournament-heading').textContent = data.title || I18n.t('Настольный теннис');
    var results = data.scores.map(function (score) { return assess(score); });
    var ranking = rankMatches(data.players, PAIRS, results, name);
    var complete = ranking.played === PAIRS.length;
    paintVisibleRounds();
    var rows = document.createDocumentFragment();
    ranking.rows.forEach(function (entry) {
      var row = document.createElement('tr');
      if (complete && entry.rank === 1) row.className = 'winner';
      entry.cells.forEach(function (value) { row.appendChild(make('td', value)); });
      rows.appendChild(row);
    });
    $('ranking').replaceChildren(rows);
    $('progress').textContent = I18n.t('Сыграно ') + ranking.played + I18n.t(' из ') + PAIRS.length + I18n.t(' матчей. ') +
      (finalizedAt ? I18n.t('Турнир завершён.') : complete ? I18n.t('Все результаты внесены.') : I18n.t('Рейтинг предварительный.'));
    $('result').textContent = complete ? '🏆 ' + resultText(ranking.leaders) : '';
    if (ranking.rows.some(function (entry) { return String(entry.cells[0]).endsWith('='); })) {
      $('progress').textContent += I18n.t(' «=» — у игроков одинаковые показатели, место делится.');
    }
    $('report-open').textContent = finalizedAt || (mode === 'local' && complete) ? I18n.t('Итоговый протокол / PDF') : I18n.t('Протокол матчей / PDF');
    $('finalize-tournament').hidden = mode !== 'owner' || Boolean(finalizedAt);
    $('finalize-tournament').disabled = !complete || queueEntries.length > 0;
    $('reopen-tournament').hidden = mode !== 'owner' || !finalizedAt;
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
    $('matchsummary').textContent = I18n.t('Матчей: ') + PAIRS.length + I18n.t(' · Раундов: ') + ROUNDS.length + I18n.t(' · Матчей на игрока: ') + (data.players - 1);
    for (r = 0; r < ROUNDS.length; r++) {
      var start = end;
      end += PLAN.games[r] + PLAN.change;
      roundTimes[r] = I18n.t('Раунд ') + (r + 1) + ' · ' + durationLabel(start) + '–' + durationLabel(end) + I18n.t(' мин');
      if ($('rtime' + r)) $('rtime' + r).textContent = roundTimes[r];
    }
    setLines($('tlmain'), durationLabel(PLAN.warm) + '–' + durationLabel(end) + I18n.t(' мин'), I18n.t('Раундов: ') + ROUNDS.length);
    setLines($('tlend'), durationLabel(end) + '–' + total + I18n.t(' мин'), I18n.t('Итоги'));
    $('schedinfo').textContent = I18n.t('Время от начала турнира. Игра: ') + play + I18n.t(' мин на раунд. Смена игроков и запись счёта: 2 мин.');
    $('scoreinfo').textContent = I18n.t('Матч до ') + f.target + ' ' + f.word + '.';
    $('rule2').textContent = I18n.t('Матч состоит из одной партии до ') + f.target + ' ' + f.word +
      I18n.t('. Для обычной победы нужен перевес минимум в два очка (например, ') + f.ex + ').';
    $('rule3').textContent = I18n.t('Первую подачу определите жребием. Подача переходит после каждых ') + f.serve +
      I18n.t(' розыгрышей, при ') + f.deuce + I18n.t(' — после каждого. При подаче мяч подбрасывают с открытой ладони, и он должен отскочить сначала на своей, затем на чужой половине стола.');
    $('rule4').textContent = I18n.t('Лимит — ') + play + I18n.t(' мин на матч. По сигналу таймера завершите текущий розыгрыш. ') +
      I18n.t('Если партия не закончена, выигрывает тот, кто ведёт в счёте. При равенстве разыгрывается одно решающее очко по очереди подачи. ') +
      I18n.t('Затем внесите итоговый счёт. Это специальное правило мини-турнира, а не стандартное правило настольного тенниса.');
  }

  // ---------- Timer ----------
  function durationLabel(seconds) {
    return Math.floor(seconds / 60) + (seconds % 60 ? ':' + two(seconds % 60) : '');
  }
  function phases() {
    var p = [{ r: -1, kind: 'warm', label: I18n.t('Разминка'), seconds: PLAN.warm }], r;
    for (r = 0; r < ROUNDS.length; r++) {
      p.push({ r: r, kind: 'play', label: I18n.t('Раунд ') + (r + 1) + I18n.t(' · игра'), seconds: PLAN.games[r] });
      p.push({ r: r, kind: 'change', label: I18n.t('Раунд ') + (r + 1) + ' · ' + (r < ROUNDS.length - 1 ? I18n.t('смена и запись') : I18n.t('запись результатов')), seconds: PLAN.change });
    }
    p.push({ r: -1, kind: 'final', label: I18n.t('Итоги'), seconds: PLAN.final });
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
    if (mode === 'owner') { if (sharing.allowChange()) sharing.changed(); return; }
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
  function setText(node, value) {
    if (node.textContent !== value) node.textContent = value;
  }

  var lastRound = -1, lastPhase, lastBarWidth;
  function renderTimer() {
    var ph = P[T.i], rem = remaining(), bar = $('timer'), btn = $('tstart'), cur;
    var next = P[T.i + 1];
    setText($('tphase'), ph.label);
    setText($('tnext'), next ? I18n.t('Далее: ') + next.label + ' (' + durationLabel(next.seconds) + I18n.t(' мин)') : I18n.t('Последний этап'));
    setText($('tclock'), clock(rem));
    var width = (100 * (1 - rem / dur(T.i))).toFixed(2) + '%';
    if (lastBarWidth !== width) { $('tprog').style.width = width; lastBarWidth = width; }
    var style = 'timerbar' + (ph.kind === 'change' ? ' change' : '') +
      (T.running && ph.kind === 'play' && rem <= 60000 ? ' last' : '') + (finished() ? ' done' : '');
    if (bar.className !== style) bar.className = style;
    setText(btn, T.running ? I18n.t('Пауза') : finished() ? I18n.t('Завершено') : started() ? I18n.t('Продолжить') : I18n.t('Старт'));
    if (btn.disabled !== finished()) btn.disabled = finished();
    if (!document.body.classList.contains('report-open')) {
      var title = (T.running ? clock(rem) + ' · ' : '') + I18n.t('Мини-турнир по настольному теннису');
      if (document.title !== title) document.title = title;
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
    if (document.body.classList.contains('started') !== started()) document.body.classList.toggle('started', started());
    var eta = $('my-eta');
    if (eta) setText(eta, etaText(Number(eta.dataset.round)));
    var phase = T.i + '/' + finished();
    if (phase !== lastPhase) {
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

  function allowSettings() {
    var permitted = mode === 'local' || (mode === 'owner' && sharing.allowChange());
    if (!permitted) {
      $('session-status').textContent = I18n.t('Настройки и таймер доступны после синхронизации и до завершения турнира.');
    }
    return permitted;
  }

  function bindTimer() {
    $('tstart').addEventListener('click', function () {
      if (!allowSettings()) return;
      audio();
      var first = !started();
      if (T.running) { T.left = remaining(); T.running = false; }
      else if (!finished()) {
        T.end = Date.now() + T.left; T.running = true;
        if (first) { viewChosen = true; setView('play'); signal('warn'); }
      }
      saveTimer(); syncLock(); renderTimer();
    });
    $('tskip').addEventListener('click', function () {
      if (!allowSettings()) return;
      audio();
      $('timer-controls').open = false;
      if (T.i < P.length - 1) goTo(T.i + 1);
      else { T.running = false; T.left = 0; saveTimer(); syncLock(); renderTimer(); }
    });
    $('tprev').addEventListener('click', function () {
      if (!allowSettings()) return;
      audio();
      $('timer-controls').open = false;
      // Like a media player: first press restarts the stage, second goes back one.
      if (dur(T.i) - remaining() > 3000 || T.i === 0) goTo(T.i);
      else goTo(T.i - 1);
    });
    $('treset').addEventListener('click', function () {
      if (!allowSettings()) return;
      if (!started() || window.confirm(I18n.t('Сбросить таймер к началу турнира?'))) {
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
    setInterval(function () { if (mode !== 'choose' && !document.hidden) tick(); }, 1000);
  }

  // ---------- Status line & offline ----------
  var offlineReady = false;
  function info() {
    var t = mode === 'owner' ? I18n.t('Официальные данные турнира хранятся на сервере.')
      : storageOK ? I18n.t('Настройки, имена, результаты и таймер сохраняются в этом браузере.')
      : I18n.t('Автоподсчёт работает, но локальное сохранение недоступно. Не закрывайте страницу до окончания турнира.');
    if (offlineReady) t += I18n.t(' Страница доступна без интернета.');
    if (navigator.onLine === false) t += I18n.t(' Сейчас нет сети — работа офлайн.');
    $('saveinfo').textContent = t;
  }

  function registerSW() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    var accepting = false;
    navigator.serviceWorker.register('sw.js').then(function (registration) {
      function notice() {
        if (registration.waiting && navigator.serviceWorker.controller) $('app-update').hidden = false;
      }
      notice();
      registration.addEventListener('updatefound', function () {
        var worker = registration.installing;
        if (worker) worker.addEventListener('statechange', notice);
      });
      $('apply-update').addEventListener('click', function () {
        if ($('score-dialog').open || (sharing && !sharing.safeToReload())) {
          $('update-status').textContent = I18n.t('Дождитесь синхронизации перед обновлением.');
          return;
        }
        if (!registration.waiting) return;
        accepting = true;
        $('apply-update').disabled = true;
        $('update-status').textContent = I18n.t('Обновляем приложение…');
        registration.waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
      });
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (accepting) location.reload();
      });
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) registration.update().catch(function () {});
      });
      return navigator.serviceWorker.ready;
    }).then(function () { offlineReady = true; info(); }).catch(function () {});
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
    var link = make('a', I18n.t('Раунд ') + (fixture.round + 1) + I18n.t(' · Стол ') + fixture.table + ' · ' + name(fixture.opponent));
    link.href = '#match' + fixture.match;
    link.addEventListener('click', function () {
      if (!$('match' + fixture.match)) { allRounds = true; renderRounds(lastRound); paintVisibleRounds(); }
    });
    return link;
  }

  // Approximate time until a round starts, from the running timer.
  function etaText(round) {
    var index = 1 + 2 * round;
    if (!T.running || T.i >= index) return '';
    var seconds = remaining() / 1000;
    for (var k = T.i + 1; k < index; k++) seconds += P[k].seconds;
    return I18n.t('Начало примерно через ') + Math.max(1, Math.round(seconds / 60)) + I18n.t(' мин');
  }

  function renderPlayer() {
    var card = $('my-current'), list = $('my-fixtures');
    card.replaceChildren();
    list.replaceChildren();
    $('my-all').hidden = selectedPlayer === null;
    $('my-matches').classList.toggle('minimal', !readOnly && selectedPlayer === null);
    if (selectedPlayer === null) return;
    var matches = Tournament.matchesFor(ROUNDS, selectedPlayer);
    var ph = P[T.i], current = matches.find(function (match) { return match.round === ph.r; });
    var next = matches.find(function (match) { return match.round > ph.r && !assess(data.scores[match.match]).ok; });
    if (ph.kind === 'final' || finished()) card.append(make('strong', I18n.t('Игры завершены. Итоги в таблице.')));
    else if (current) card.append(make('strong', ph.kind === 'change' ? I18n.t('Завершённый раунд') : I18n.t('Сейчас')), fixtureLink(current));
    else if (ph.kind !== 'warm') card.append(make('strong', I18n.t('Сейчас вы отдыхаете.')));
    if (next && ph.kind !== 'final' && !finished()) {
      var eta = make('span', etaText(next.round));
      eta.id = 'my-eta';
      eta.className = 'eta';
      eta.dataset.round = next.round;
      card.append(make('strong', I18n.t('Следующий матч')), fixtureLink(next), eta);
    }

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
      label.firstChild.nodeValue = I18n.t('Игрок ') + (i + 1);
      label.htmlFor = input.id = 'name' + i;
      $('names').appendChild(label);
      if (!readOnly) bindName(i);
    });
    var first = 0;
    offsets = ROUNDS.map(function (pairs) {
      var start = first;
      first += pairs.length;
      return start;
    });
    allRounds = false;
    renderRounds(-1);
    lastRound = -1;
    lastPhase = undefined;
  }

  function queuedFor(match) {
    return queueEntries.find(function (item) { return item.layout === queueLayout && item.match === match; });
  }

  function showQueue(items, layout) {
    queueEntries = items;
    queueLayout = layout;
    var review = items.filter(function (item) { return item.review; });
    var list = $('queue-review-list');
    list.replaceChildren();
    review.forEach(function (item) {
      var li = make('li', item.label + ' · ' + (item.score[0] ? item.score.slice(0, 2).join(':') : I18n.t('удаление')) + ' ');
      var button = make('button', I18n.t('Отбросить правку'));
      button.type = 'button';
      button.addEventListener('click', function () { sharing.discard(item.id); });
      li.appendChild(button);
      list.appendChild(li);
    });
    $('queue-review').hidden = !review.length;
    $('queue-pending').textContent = items.length ? I18n.t('В очереди: ') + items.length : '';
    paintVisibleRounds();
    $('finalize-tournament').disabled = items.length > 0 || data.scores.some(function (score) { return !assess(score).ok; });
  }

  function renderRounds(current) {
    var indices = ROUNDS.map(function (_, i) { return i; });
    if (current >= 0) indices = [current].concat(indices.filter(function (i) { return i !== current; }));
    if (!allRounds && indices.length > 5) {
      var first = Math.max(0, current);
      indices = indices.filter(function (i) { return i >= first && i < first + 3; });
    }
    var rounds = document.createDocumentFragment();
    indices.forEach(function (r) {
      var pairs = ROUNDS[r], round = roundTemplate.cloneNode(false), head = headTemplate.cloneNode(true);
      var matches = document.createElement('div');
      round.id = 'round' + r;
      round.dataset.round = r;
      round.classList.toggle('current', r === current);
      head.querySelector('b').id = 'rtime' + r;
      head.querySelector('b').textContent = roundTimes[r] || I18n.t('Раунд ') + (r + 1);
      var rest = head.querySelector('.rest');
      rest.id = 'rest' + r;
      rest.hidden = pairs.length * 2 === data.players;
      matches.className = 'matches';
      pairs.forEach(function (_, table) {
        var match = matchTemplate.cloneNode(true), j = offsets[r] + table;
        match.id = 'match' + j;
        match.dataset.match = j;
        match.querySelector('.tabletag').textContent = I18n.t('Стол ') + (table + 1);
        match.querySelector('.state').id = 'state' + j;
        match.querySelectorAll('.matchrow').forEach(function (row, k) {
          var label = make('span', ''), score = make('span', '');
          label.id = 'p' + j + '-' + k;
          score.id = 's' + j + '-' + k;
          score.className = 'score-value';
          row.replaceChildren(label, score);
        });
        if (!readOnly) {
          var edit = make('button', I18n.t('Внести результат'));
          edit.id = 'edit' + j;
          edit.type = 'button';
          edit.className = 'match-edit';
          edit.setAttribute('aria-describedby', 'p' + j + '-0 p' + j + '-1');
          edit.addEventListener('click', function () { editScore(j, r, table + 1); });
          match.appendChild(edit);
          match.classList.add('tappable');
          // The whole card opens the score dialog; the button stays for keyboard users.
          match.addEventListener('click', function (event) {
            if (event.target.closest('button, a') || edit.hidden || edit.disabled) return;
            editScore(j, r, table + 1);
          });
        }
        matches.appendChild(match);
      });
      round.append(head, matches);
      rounds.appendChild(round);
    });
    $('rounds').replaceChildren(rounds);
    $('toggle-rounds').hidden = ROUNDS.length <= 5;
    $('toggle-rounds').textContent = allRounds ? I18n.t('Текущие раунды') : I18n.t('Все раунды');
    $('toggle-rounds').setAttribute('aria-expanded', String(allRounds));
  }

  function chosenTarget() {
    var checked = document.querySelector('input[name="target"]:checked');
    return checked && checked.value === '21' ? 21 : 11;
  }

  function previewSetup() {
    var players = $('player-count').valueAsNumber, tables = $('table-count').valueAsNumber;
    if (!inRange(players, MIN_PLAYERS, MAX_PLAYERS) || !inRange(tables, 1, MAX_TABLES)) {
      $('setup-hint').textContent = I18n.t('Введите от 2 до 24 игроков и от 1 до 12 столов.');
      return null;
    }
    var rounds = Tournament.schedule(players, tables);
    var duration = $('tournament-minutes'), min = Tournament.minimumMinutes(rounds.length);
    var minutes = duration.value === '' && !duration.validity.badInput ? null : duration.valueAsNumber;
    duration.min = min;
    var automatic = Tournament.timing(rounds.length, FORMATS[chosenTarget()].play, null).total / 60;
    duration.placeholder = automatic + I18n.t(' (авто)');
    $('setup-hint').textContent = I18n.t('Раундов: ') + rounds.length + I18n.t(' · Минимум: ') + min + I18n.t(' мин · Авто: ') + automatic + I18n.t(' мин');
    return { rounds: rounds, players: players, tables: tables, minutes: minutes };
  }

  function bindSetup() {
    var form = $('setup');
    fillSetup();
    form.addEventListener('input', function () { $('setup-status').textContent = ''; previewSetup(); });
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!allowSettings()) return;
      var setup = previewSetup();
      if (!setup || !form.reportValidity()) return;
      var target = chosenTarget();
      var plan = Tournament.timing(setup.rounds.length, FORMATS[target].play, setup.minutes);
      var structureChanged = setup.players !== data.players || setup.tables !== data.tables;
      var resetTimer = structureChanged || plan.total !== PLAN.total;
      var removedResults = PAIRS.some(function (pair, j) {
        return pair[1] >= setup.players && data.scores[j].slice(0, 2).some(Boolean);
      });
      var warnings = [];
      if (removedResults) warnings.push(I18n.t('Счёт матчей удалённых игроков будет удалён.'));
      if (resetTimer && started()) warnings.push(I18n.t('Таймер вернётся к началу турнира.'));
      if (warnings.length && !window.confirm(warnings.join(' ') + I18n.t(' Применить настройки?'))) return;

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
      data.target = target;
      data.minutes = setup.minutes;
      data.title = $('tournament-title').value.trim();
      PLAN = plan;
      if (resetTimer) { P = phases(); T = freshTimer(); syncLock(); }
      applyFormat();
      update();
      save();
      saveTimer();
      renderTimer();
      $('setup-status').textContent = I18n.t('Настройки применены.');
    });
    previewSetup();
    $('setup-section').hidden = false;
  }

  function bindName(i) {
    var e = $('name' + i);
    e.value = data.names[i];
    e.addEventListener('input', function () {
      if (!allowSettings()) { e.value = data.names[i]; return; }
      data.names[i] = e.value; update(); save();
    });
  }

  function fillSetup() {
    $('tournament-title').value = data.title;
    $('player-count').value = data.players;
    $('table-count').value = data.tables;
    $('tournament-minutes').value = data.minutes === null ? '' : data.minutes;
    previewSetup();
  }
  var editedMatch;
  function editScore(j, round, table) {
    editedMatch = j;
    var pair = PAIRS[j], operation = queuedFor(j), score = operation?.review ? operation.score : data.scores[j];
    $('score-context').textContent = I18n.t('Раунд ') + (round + 1) + I18n.t(' · Стол ') + table + I18n.t(' · До ') + data.target;
    $('score-name-a').textContent = name(pair[0]);
    $('score-name-b').textContent = name(pair[1]);
    $('quick-a').textContent = name(pair[0]) + ' · ' + data.target;
    $('quick-b').textContent = name(pair[1]) + ' · ' + data.target;
    $('score-a').value = score[0];
    $('score-b').value = score[1];
    $('score-timed').checked = score[2] === true;
    $('score-clear').hidden = !score.slice(0, 2).some(Boolean);
    $('score-error').textContent = operation?.review ? I18n.t('Сверьте результат с сервером и подтвердите свою правку.') : '';
    $('score-dialog').showModal();
    $('score-a').select();
  }

  function bindScoreDialog() {
    var dialog = $('score-dialog');
    $('score-cancel').addEventListener('click', function () { dialog.close(); });
    // One tap gives the winner the target score; the loser's score is typed next.
    [['quick-a', 'score-a', 'score-b'], ['quick-b', 'score-b', 'score-a']].forEach(function (ids) {
      $(ids[0]).addEventListener('click', function () {
        $(ids[1]).value = String(data.target);
        if (Number($(ids[2]).value) >= data.target) $(ids[2]).value = '';
        $(ids[2]).focus();
        $(ids[2]).select();
      });
    });
    $('score-clear').addEventListener('click', function () {
      if (!window.confirm(I18n.t('Удалить результат этого матча?'))) return;
      submitScore(['', ''], dialog);
    });
    $('score-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var score = [$('score-a').value.trim(), $('score-b').value.trim()];
      var timed = $('score-timed').checked;
      var error = Tournament.checkScore(score, data.target, timed);
      if (error) {
        $('score-error').textContent = {
          empty: I18n.t('Введите очки обоих участников.'),
          number: I18n.t('Введите целые числа от 0 до 99.'),
          tie: I18n.t('При равном счёте разыграйте решающее очко.'),
          time: I18n.t('Проверьте счёт. Если игра закончилась по сигналу, отметьте лимит времени.')
        }[error];
        return;
      }
      if (timed) score.push(true);
      submitScore(score, dialog);
    });
  }

  function submitScore(score, dialog) {
    if (mode === 'owner') {
      var pair = PAIRS[editedMatch];
      var error = sharing.score(editedMatch, score, name(pair[0]) + ' — ' + name(pair[1]));
      if (error) { $('score-error').textContent = error; return; }
      $('score-announcement').textContent = I18n.t('Результат добавлен в очередь.');
    } else {
      data.scores[editedMatch] = score;
      update();
      save();
      $('score-announcement').textContent = $('state' + editedMatch)?.textContent || '';
    }
    dialog.close();
  }
  function showSharedBoard(text, available) {
    var status = $('view-status');
    $('viewer-banner').hidden = false;
    if (status.textContent !== text) status.textContent = text;
    showTournament(available);
    $('archives-panel').hidden = !available;
  }

  // ---------- Tabs: game, standings, settings ----------
  var view = null, viewChosen = false;
  function setView(next) {
    if (readOnly && next === 'setup') next = 'play';
    var changed = view !== next;
    view = next;
    document.body.dataset.view = next;
    document.querySelectorAll('#tabbar [data-tab]').forEach(function (button) {
      if (button.dataset.tab === next) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (changed) window.scrollTo(0, 0);
  }
  function defaultView() { return !readOnly && !started() ? 'setup' : 'play'; }

  function showTournament(available) {
    ['match-toolbar', 'my-matches', 'schedule', 'standings', 'rules-panel'].forEach(function (id) {
      $(id).hidden = !available;
    });
    $('tabbar').hidden = !available;
    if (available) setView(view || defaultView());
    else { view = null; delete document.body.dataset.view; }
    $('matchsummary').hidden = !available;
    document.querySelector('header .metrics').hidden = !available;
  }

  function receiveSharedBoard(snapshot, code, endDate) {
    if (code) viewCode = code;
    var wasFinalized = finalizedAt;
    finalizedAt = endDate || null;
    var next = sanitize(snapshot.data);
    var rebuild = next.players !== data.players || next.tables !== data.tables;
    var settingsChanged = rebuild || data.target !== next.target || data.minutes !== next.minutes || data.title !== next.title;
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
      $('setup-section').hidden = Boolean(finalizedAt);
      $('names').closest('section').hidden = Boolean(finalizedAt);
      $('timer-controls').hidden = Boolean(finalizedAt);
      $('tstart').hidden = Boolean(finalizedAt);
      $('tskip').hidden = Boolean(finalizedAt);
      data.names.forEach(function (playerName, i) {
        if ($('name' + i).value !== playerName) $('name' + i).value = playerName;
      });
    }
    update();
    if (view && !viewChosen) setView(defaultView());
    if (endDate !== wasFinalized && $('archives-panel').open) loadArchives();
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
    if (mode === 'local') {
      $('setup-section').hidden = false;
      $('names').closest('section').hidden = false;
      $('timer-controls').hidden = false;
      $('tstart').hidden = false;
      $('tskip').hidden = false;
    }
    if (mode === 'choose') {
      var draft = localDraft && localDraft.data;
      var hasDraft = Boolean(draft && (draft.title || draft.scores.some(function (score) { return score[0] !== '' || score[1] !== ''; }) ||
        draft.names.some(function (playerName, i) { return playerName !== 'П' + (i + 1); })));
      $('import-draft-label').hidden = !hasDraft;
      if (!hasDraft) $('import-draft').checked = false;
    } else {
      view = null;
      viewChosen = false;
      showTournament(true);
    }
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

  var exportReport;
  function renderReport(event, source, code, archivedAt) {
    var tournament = sanitize(source), names = tournament.names.map(shownName);
    var rounds = Tournament.schedule(tournament.players, tournament.tables), pairs = rounds.flat();
    var results = tournament.scores.map(function (score) { return assess(score, tournament.target); });
    var ranking = rankMatches(tournament.players, pairs, results, function (i) { return names[i]; });
    var matches = Tournament.reportMatches(rounds, results, tournament.scores, names);
    matches.rows.forEach(function (row) { row[6] = I18n.t(row[6]); });
    var complete = Boolean(archivedAt) || (mode === 'local' && matches.played === pairs.length);
    var stamp = new Intl.DateTimeFormat(I18n.locale, { dateStyle: 'long', timeStyle: 'short' });
    var label = complete ? I18n.t('Итоговый протокол') : I18n.t('Промежуточный протокол');
    var time = archivedAt ? new Date(archivedAt * 1000) : new Date();
    $('report-title').textContent = tournament.title ? label + ' · ' + tournament.title : label;
    $('report-meta').textContent = (code ? I18n.t('Код: ') + code.replace(/-/g, '').match(/.{1,4}/g).join('-') + ' · ' : '') +
      (mode === 'local' ? I18n.t('Локальный турнир · ') : '') + (archivedAt ? I18n.t('Завершён: ') : I18n.t('Сформирован: ')) + stamp.format(time);
    $('report-summary').textContent = I18n.t('Игроков: ') + tournament.players + I18n.t(' · Столов: ') + tournament.tables +
      I18n.t(' · Игра до ') + tournament.target + ' ' + FORMATS[tournament.target].word + I18n.t(' · Сыграно ') + matches.played + I18n.t(' из ') + pairs.length;
    $('report-outcome').textContent = matches.played === pairs.length ? resultText(ranking.leaders) : '';
    $('report-outcome').hidden = matches.played !== pairs.length;
    var rows = ranking.rows.map(function (entry) { return entry.cells.slice(0, 8); });
    reportRows($('report-ranking'), rows);
    reportRows($('report-matches'), matches.rows);
    exportReport = { ranking: rows, matches: matches.rows, code: code, complete: complete };
    reportReturn = event.currentTarget;
    reportScroll = window.scrollY;
    $('results-report').hidden = false;
    document.body.classList.add('report-open');
    document.title = label + (code ? ' — ' + code : '') + I18n.t(' — Настольный теннис');
    $('report-title').focus();
    window.scrollTo(0, 0);
  }

  function openReport(event) {
    if (mode === 'owner' && !sharing.isSaved()) {
      $('report-notice').textContent = I18n.t('Дождитесь сохранения результатов на сервере и откройте протокол снова.');
      return;
    }
    $('report-notice').textContent = '';
    renderReport(event, data, mode === 'owner' ? $('session-code').textContent : (viewCode || joinCode || ''), finalizedAt);
  }

  function exportCsv() {
    if (!exportReport) return;
    var rows = [[exportReport.complete ? I18n.t('Итоговый протокол') : I18n.t('Промежуточный протокол')],
      [$('report-title').textContent], [$('report-meta').textContent], [$('report-summary').textContent]];
    [$('report-ranking'), $('report-matches')].forEach(function (body, i) {
      var table = body.closest('table');
      rows.push([], Array.from(table.tHead.rows[0].cells, function (cell) { return cell.textContent; }));
      rows.push.apply(rows, i === 0 ? exportReport.ranking : exportReport.matches);
    });
    var csv = rows.map(function (row) {
      return row.map(function (cell) {
        var value = String(cell);
        if (/^[\s]*[=+@-]/.test(value) && !/^[+-]?\d+$/.test(value)) value = "'" + value;
        return '"' + value.replace(/"/g, '""') + '"';
      }).join(',');
    }).join('\r\n');
    var link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
    link.download = 'tennis-' + (exportReport.code || 'local') + '-results.csv';
    link.click();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
  }

  async function loadArchives() {
    if (!archiveSource || !$('archives-panel').open) return;
    var list = $('archives-list'), status = $('archives-status');
    status.textContent = I18n.t('Загружаем протоколы…');
    list.replaceChildren();
    try {
      var result = await archiveSource.archives();
      status.textContent = result.archives.length ? '' : I18n.t('Сохранённых протоколов пока нет.');
      result.archives.forEach(function (archive) {
        var stamp = new Intl.DateTimeFormat(I18n.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(archive.finalizedAt * 1000));
        var item = document.createElement('li'), button = make('button', (archive.title ? archive.title + ' · ' : '') + stamp);
        button.type = 'button';
        button.addEventListener('click', async function () {
          var sourceButton = this;
          try {
            var record = await archiveSource.archive(archive.revision);
            renderReport({ currentTarget: sourceButton }, record.snapshot.data, record.code, record.finalizedAt);
          } catch { status.textContent = I18n.t('Не удалось открыть протокол.'); }
        });
        item.appendChild(button);
        list.appendChild(item);
      });
    } catch { status.textContent = I18n.t('Не удалось загрузить протоколы.'); }
  }

  renderSchedule();
  document.querySelectorAll('#tabbar [data-tab]').forEach(function (button) {
    button.addEventListener('click', function () {
      viewChosen = true;
      setView(button.dataset.tab);
      if (button.dataset.tab === 'play' && lastRound >= 0) {
        $('round' + lastRound).scrollIntoView({ block: 'start' });
      }
    });
  });
  // Shrink the timer bar once the page scrolls, to leave room for the schedule.
  var compact = false;
  window.addEventListener('scroll', function () {
    var next = window.scrollY > 60;
    if (next !== compact) { compact = next; $('match-toolbar').classList.toggle('compact', compact); }
  }, { passive: true });
  $('language-switch').addEventListener('click', function () {
    if ($('score-dialog').open || (sharing && !sharing.mayNavigate())) {
      $('language-status').textContent = I18n.t('Дождитесь сохранения перед сменой языка.');
      return;
    }
    I18n.switchLanguage();
  });
  $('my-player').addEventListener('change', function (event) {
    selectedPlayer = event.target.value === '' ? null : Number(event.target.value);
    store(playerKey, selectedPlayer);
    renderPlayer();
  });
  $('standings-detail').addEventListener('click', function () {
    var open = $('standings').classList.toggle('show-details');
    $('standings-detail').setAttribute('aria-expanded', open);
    $('standings-detail').textContent = open ? I18n.t('Кратко') : I18n.t('Подробности');
    $('standings-key').hidden = !open;
  });
  applyFormat();
  update();
  $('standings-detail').hidden = false;
  $('standings-key').hidden = true;
  $('standings').classList.add('player-standings');
  $('report-open').hidden = false;
  $('report-open').addEventListener('click', openReport);
  $('archives-panel').addEventListener('toggle', loadArchives);
  $('report-csv').addEventListener('click', exportCsv);
  $('toggle-rounds').addEventListener('click', function () { allRounds = !allRounds; renderRounds(lastRound); paintVisibleRounds(); });
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
    $('tskip').hidden = true;
    $('timer-controls').hidden = true;
    $('organizer').hidden = true;
    $('tab-setup').hidden = true;
    showSharedBoard(I18n.t('Загружаем общую таблицу…'), false);
    archiveSource = SharedBoard.viewer(boardId, joinCode, receiveSharedBoard, showSharedBoard);
    setInterval(function () { if (!document.hidden) tick(); }, 1000);
    document.addEventListener('visibilitychange', tick);
  } else {
    bindSetup();
    bindScoreDialog();
    $('print').addEventListener('click', openReport);
    $('reset').addEventListener('click', function () {
      if (allowSettings() && window.confirm(I18n.t('Удалить все результаты? Имена участников сохранятся.'))) {
        data.scores = blankScores(PAIRS.length);
        update(); save();
      }
    });
    window.addEventListener('online', info);
    window.addEventListener('offline', info);
    info();
    $('actions').hidden = false;
    $('format').hidden = false;
    bindTimer();
    if (window.isSecureContext && window.crypto && crypto.randomUUID) {
      sharing = SharedBoard.organizer({
        snapshot: function () { return { data: data, timer: T }; },
        initial: initialSnapshot, mode: organizerMode, receive: receiveSharedBoard, queue: showQueue,
        scores: function (scores) { data.scores = scores; update(); },
        canRefresh: function () {
          return !$('score-dialog').open && !document.activeElement.closest('#setup, #names, #format');
        },
        load: load, store: store
      });
      archiveSource = sharing;
    } else {
      organizerMode('local');
    }
  }
  if (document.readyState === 'complete') registerSW(); else window.addEventListener('load', registerSW);
})();
