var SharedBoard = (function () {
  'use strict';
  var endpoint = '/api/boards';
  var ownerKey = 'tt-board-owner-v1';
  var validId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  var validCode = /^[0-9A-HJKMNP-TV-Z]{12}$/;
  var validKey = /^[0-9a-f]{64}$/;

  function $(id) { return document.getElementById(id); }
  function normalize(value) {
    return value.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  }
  function display(code) { return code.match(/.{4}/g).join('-'); }

  function playerUrl(code) {
    var url = new URL(location.pathname, location.origin);
    url.searchParams.set('code', code);
    return url.href;
  }

  async function request(method, id, body, owner) {
    var headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (owner) {
      headers.Authorization = 'Bearer ' + owner.key;
      if (owner.revision) headers['If-Match'] = '"' + owner.revision + '"';
    }
    var res = await fetch(endpoint + (id ? '/' + id : ''), {
      method: method, body: body ? JSON.stringify(body) : undefined,
      headers: headers, cache: 'no-store', signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw Object.assign(new Error('Tournament request failed'), { status: res.status });
    return res.status === 204 ? null : res.json();
  }

  function rememberRecent(result) {
    if (!result.code) return;
    try {
      var key = 'tt-recent-tournaments';
      var previous = JSON.parse(localStorage.getItem(key) || '[]');
      if (!Array.isArray(previous)) previous = [];
      var title = result.snapshot.data.title || result.code;
      localStorage.setItem(key, JSON.stringify([{ code: result.code, title: title }].concat(
        previous.filter(function (entry) { return entry && entry.code !== result.code; })
      ).slice(0, 10)));
    } catch { /* Recent links are optional. */ }
  }

  function renderRecent() {
    var previous;
    try { previous = JSON.parse(localStorage.getItem('tt-recent-tournaments') || '[]'); } catch { return; }
    if (!Array.isArray(previous)) return;
    var list = $('recent-list');
    list.replaceChildren();
    previous.forEach(function (entry) {
      if (!entry || !validCode.test(entry.code)) return;
      var item = document.createElement('li'), link = document.createElement('a');
      link.href = playerUrl(entry.code);
      link.textContent = (entry.title === entry.code ? '' : entry.title + ' · ') + display(entry.code);
      item.appendChild(link);
      list.appendChild(item);
    });
    $('recent-tournaments').hidden = !list.children.length;
  }

  function intervalFor(result) {
    var timer = result.snapshot.timer;
    return !result.finalizedAt && timer.running && timer.i % 2 === 1 ? 8000 : 24000;
  }

  function viewer(id, code, receive, status) {
    var locator = code === null ? id : normalize(code);
    if (!(code === null ? validId : validCode).test(locator)) {
      status(I18n.t('Проверьте код или ссылку турнира.'), false);
      return;
    }
    var revision, initialized = false, running = false, closed = false, timer, delay = 8000;
    async function refresh() {
      if (running || closed) return;
      clearTimeout(timer);
      if (document.visibilityState !== 'hidden') {
        running = true;
        try {
          var result = await request('GET', locator + (revision ? '?since=' + revision : ''));
          if (result) {
            if (result.revision !== revision) receive(result.snapshot, result.code, result.finalizedAt);
            revision = result.revision;
            if (!initialized) rememberRecent(result);
            initialized = true;
            delay = intervalFor(result);
          }
          status(I18n.t('Режим игрока · Результаты обновляются автоматически'), true);
        } catch (error) {
          if (error.status === 404) {
            closed = true;
            status(I18n.t('Турнир не найден. Проверьте код или уточните его у организатора.'), false);
            return;
          }
          status(initialized ? I18n.t('Связь прервана. Показаны последние полученные результаты.') : I18n.t('Турнир пока недоступен. Повторяем подключение.'), initialized);
        } finally {
          running = false;
        }
      }
      timer = setTimeout(refresh, delay);
    }
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    refresh();
    return {
      archives: function () { return request('GET', locator + '/archives'); },
      archive: function (revision) { return request('GET', locator + '/archives?revision=' + revision); }
    };
  }

  function organizer(options) {
    var owner = null;
    var remembered = options.load(ownerKey);
    var recoverable = remembered && validId.test(remembered.id) && validKey.test(remembered.key) ? remembered : null;
    var draftAttempt, busy = false, dirty = false, pending, retry, entering = false, closing = false;
    var queue, connected = false, lastConfirmed, queueBusy = false;
    var mode = 'choose', resumeOnReconnect = true;
    var playerCode = $('join-code'), organizerKey = $('join-key');
    var sessionStatus = $('session-status'), accessStatus = $('access-status'), shareStatus = $('share-status');

    function setStatus(text) {
      if (sessionStatus.textContent !== text) sessionStatus.textContent = text;
    }

    function show(modeName) {
      mode = modeName;
      $('tournament-access').hidden = mode !== 'choose';
      $('tournament-session').hidden = mode === 'choose';
      $('server-session').hidden = mode !== 'owner';
      $('sharing').hidden = mode !== 'owner';
      $('resume-tournament').hidden = !recoverable;
      $('archives-panel').hidden = mode !== 'owner';
      options.mode(mode);
      if (mode === 'choose') renderRecent();
    }

    function keySaved() { return owner && options.load('tt-key-saved:' + owner.id) === owner.key.slice(0, 8); }
    function showKeyCard() {
      $('key-card').hidden = !owner || keySaved();
      $('key-card-value').value = owner ? owner.key : '';
      $('key-card-share').hidden = !navigator.share;
      $('key-card-status').textContent = '';
    }

    function remember() {
      // Cache the credential so the browser can sign in again. Scores are read from the server.
      options.store(ownerKey, owner ? { id: owner.id, key: owner.key } : null);
    }

    function records() {
      try { return queue ? queue.list() : []; } catch { return []; }
    }

    function showQueue() { options.queue(records(), owner && owner.layout); }

    function canonical(result, offline) {
      connected = !offline;
      owner.revision = result.revision;
      owner.layout = result.layout || 1;
      owner.versions = result.matchVersions || {};
      lastConfirmed = result;
      if (!offline) options.store('tt-board-cache:' + owner.id, result);
      options.receive(result.snapshot, result.code, result.finalizedAt);
      showQueue();
    }

    function activate(result, credential, offline) {
      owner = { id: result.id, code: result.code, revision: result.revision, key: credential.key };
      try { queue = MatchQueue.open(window.localStorage, owner.id); } catch { queue = null; }
      recoverable = owner;
      remember();
      $('session-code').textContent = display(result.code);
      $('share-link').value = playerUrl(result.code);
      $('join-qr').hidden = true;
      $('organizer-key').value = owner.key;
      $('organizer-key').type = 'password';
      $('key-reveal').textContent = I18n.t('Показать ключ');
      $('key-reveal').setAttribute('aria-pressed', 'false');
      playerCode.value = '';
      organizerKey.value = '';
      draftAttempt = null;
      show('owner');
      showKeyCard();
      canonical(result, offline);
      rememberRecent(result);
      setStatus(offline ? I18n.t('Офлайн. Новые результаты будут сохранены в очереди.') : I18n.t('Турнир загружен с сервера.'));
      queueNext(0);
    }

    function forget() {
      clearTimeout(retry);
      owner = recoverable = draftAttempt = pending = queue = lastConfirmed = null;
      connected = false;
      dirty = false;
      remember();
      showKeyCard();
      $('organizer-key').value = '';
      $('share-link').value = '';
      shareStatus.textContent = '';
      show('choose');
    }

    function schedule(delay) {
      clearTimeout(retry);
      if (owner && !closing) retry = setTimeout(sync, delay);
    }

    function queueNext(delay) {
      if (owner && records().some(function (item) { return !item.review; })) schedule(delay);
    }

    function markReview(operation) {
      operation.review = true;
      queue.put(operation);
      showQueue();
    }

    function queueScore(match, score, label) {
      if (!owner || !queue || lastConfirmed?.finalizedAt || dirty || pending || (busy && !queueBusy)) {
        return I18n.t('Сначала дождитесь сохранения настроек турнира.');
      }
      var existing = records().filter(function (item) { return item.match === match && item.layout === owner.layout; });
      if (existing.some(function (item) { return !item.review; })) return I18n.t('Этот результат уже ждёт отправки.');
      try {
        queue.put({
          id: crypto.randomUUID(), match: match, score: score, label: label, layout: owner.layout,
          version: owner.versions[match] || 0, queued: Date.now()
        });
        existing.forEach(function (item) { queue.remove(item); });
      } catch {
        return I18n.t('Браузер не смог сохранить результат в очередь. Проверьте настройки хранения.');
      }
      showQueue();
      if (!busy) queueNext(0);
      return null;
    }

    function discard(operationId) {
      var operation = records().find(function (item) { return item.id === operationId && item.review; });
      if (!operation) return;
      queue.remove(operation);
      showQueue();
    }

    async function pushScore(operation) {
      queueBusy = true;
      try {
        await request('PATCH', owner.id, operation, owner);
        var result = await request('GET', owner.id, null, owner);
        queue.remove(operation);
        if (dirty && owner.layout === result.layout) {
          owner.revision = result.revision;
          owner.versions = result.matchVersions || {};
          lastConfirmed = result;
          options.store('tt-board-cache:' + owner.id, result);
          options.scores(result.snapshot.data.scores);
          showQueue();
        } else {
          if (dirty) dirty = false;
          canonical(result);
        }
        setStatus(I18n.t('Сохранено на сервере.'));
      } catch (error) {
        if (error.status === 409 || error.status === 423 || error.status === 400) {
          markReview(operation);
          await refreshCanonical().catch(function () {});
          setStatus(I18n.t('Результат требует проверки.'));
        } else if (error.status === 404) {
          setStatus(I18n.t('Сервер не принял результат. Проверьте ключ организатора; очередь сохранена.'));
          markReview(operation);
        } else {
          connected = false;
          setStatus(I18n.t('Офлайн или нет связи. Результат сохранён в очереди.'));
        }
      } finally {
        queueBusy = false;
      }
    }

    async function refreshCanonical() {
      if (owner) canonical(await request('GET', owner.id, null, owner));
    }

    function changed() {
      if (!owner || mode !== 'owner') return;
      dirty = true;
      setStatus(I18n.t('Сохраняем на сервере…'));
      if (!busy) schedule(150);
    }

    async function sync() {
      if (!owner || busy || closing) return;
      if (!dirty && !pending) {
        var operation = records().find(function (item) { return !item.review; });
        if (!operation) return;
        busy = true;
        try { await pushScore(operation); }
        finally {
          busy = false;
          if (dirty) schedule(0);
          else queueNext(connected ? 0 : 8000);
        }
        return;
      }
      if (!pending) {
        pending = { owner: { ...owner }, snapshot: structuredClone(options.snapshot()) };
        dirty = false;
      }
      busy = true;
      try {
        var result = await request('PUT', owner.id, pending.snapshot, pending.owner);
        owner.revision = result.revision;
        if (!dirty) await refreshCanonical();
        pending = null;
        setStatus(I18n.t('Сохранено на сервере.'));
      } catch (error) {
        if (error.status === 404) {
          forget();
          accessStatus.textContent = I18n.t('Этот турнир больше не доступен.');
        } else if (error.status === 412 || error.status === 423) {
          try {
            var latest = await request('GET', owner.id, null, owner);
            pending = null;
            dirty = false;
            canonical(latest);
            setStatus(I18n.t('Турнир изменён на другом устройстве. Загружена версия сервера. Повторите свою правку.'));
          } catch {
            setStatus(I18n.t('Не удалось получить новую версию турнира. Повторим подключение.'));
          }
        } else {
          setStatus(I18n.t('Изменения ещё не на сервере. Оставьте страницу открытой: повторим отправку.'));
        }
      } finally {
        busy = false;
        if (pending || dirty) schedule(pending ? 8000 : 150);
        else queueNext(0);
      }
    }

    async function refreshOwner() {
      var session = owner;
      if (!session || busy || dirty || pending || closing || document.visibilityState === 'hidden' || !options.canRefresh()) return;
      try {
        var current = await request('GET', session.id + '?since=' + session.revision, null, session);
        if (owner !== session || busy || dirty || pending || closing || !options.canRefresh()) return;
        connected = true;
        if (current && current.revision !== owner.revision) {
          canonical(current);
          setStatus(I18n.t('Загружены изменения с другого устройства.'));
        }
      } catch (error) {
        connected = false;
        if (owner === session && !busy && !pending && !dirty && error.status === 404) {
          forget();
          accessStatus.textContent = I18n.t('Этот турнир больше не доступен.');
        }
      }
    }

    async function tryResume() {
      if (!recoverable || entering || mode !== 'choose') return;
      entering = true;
      accessStatus.textContent = I18n.t('Загружаем турнир с сервера…');
      try {
        activate(await request('GET', recoverable.id, null, recoverable), recoverable);
        options.store('tt-rotation:' + recoverable.id, null);
      } catch (error) {
        if (error.status === 404 || error.status === 403) {
          var replacement = options.load('tt-rotation:' + recoverable.id);
          if (replacement && replacement.id === recoverable.id && validKey.test(replacement.key)) {
            try {
              var result = await request('GET', replacement.id, null, replacement);
              options.store('tt-rotation:' + replacement.id, null);
              activate(result, replacement);
              return;
            } catch (retryError) {
              if (retryError.status !== 404 && retryError.status !== 403) {
                accessStatus.textContent = I18n.t('Не удалось подтвердить новый ключ. Повторите подключение.');
                return;
              }
            }
          }
          forget();
          accessStatus.textContent = I18n.t('Предыдущий турнир недоступен. Введите код другого турнира.');
        } else {
          var cached = options.load('tt-board-cache:' + recoverable.id);
          if (cached && cached.code) activate(cached, recoverable, true);
          else accessStatus.textContent = I18n.t('Нет связи с сервером. Повторите вход по коду или откройте локальный черновик.');
        }
      } finally {
        entering = false;
      }
    }

    $('join-tournament').addEventListener('submit', async function (event) {
      event.preventDefault();
      if (entering) return;
      var code = normalize(playerCode.value);
      var manage = event.submitter && event.submitter.value === 'manage';
      var key = organizerKey.value.trim().toLowerCase();
      if (!validCode.test(code)) { accessStatus.textContent = I18n.t('Введите код из 12 символов.'); playerCode.focus(); return; }
      if (manage && !validKey.test(key)) { accessStatus.textContent = I18n.t('Введите полный ключ организатора.'); organizerKey.focus(); return; }
      entering = true;
      accessStatus.textContent = I18n.t('Открываем турнир…');
      try {
        var result = await request('GET', code, null, manage ? { key: key } : null);
        if (manage) activate(result, { key: key });
        else location.assign(playerUrl(code));
      } catch (error) {
        accessStatus.textContent = error.status === 403 ? I18n.t('Ключ организатора не подходит к этому турниру.')
          : error.status === 404 ? I18n.t('Турнир не найден. Проверьте код.') : I18n.t('Не удалось связаться с сервером. Попробуйте ещё раз.');
      } finally {
        entering = false;
      }
    });

    $('create-tournament').addEventListener('click', async function () {
      if (entering) return;
      entering = true;
      accessStatus.textContent = I18n.t('Создаём турнир на сервере…');
      if (!draftAttempt) {
        var key = Array.from(crypto.getRandomValues(new Uint8Array(32)), function (byte) {
          return byte.toString(16).padStart(2, '0');
        }).join('');
        draftAttempt = { id: crypto.randomUUID(), key: key, snapshot: options.initial($('import-draft').checked) };
        if (!recoverable) options.store(ownerKey, { id: draftAttempt.id, key: key });
      }
      try {
        var created = await request('POST', '', { id: draftAttempt.id, snapshot: draftAttempt.snapshot }, draftAttempt);
        created = await request('GET', draftAttempt.id, null, draftAttempt);
        activate(created, draftAttempt);
        setStatus(I18n.t('Турнир создан. Сохраните ключ организатора и сообщите игрокам код.'));
      } catch {
        accessStatus.textContent = I18n.t('Не удалось подтвердить создание турнира. Нажмите кнопку ещё раз.');
      } finally {
        entering = false;
      }
    });

    $('local-tournament').addEventListener('click', function () {
      if (entering) return;
      show('local');
      options.receive(options.initial(true));
      setStatus(I18n.t('Локальный черновик · Хранится только в этом браузере'));
    });

    $('leave-session').addEventListener('click', function () {
      if (busy || dirty || pending) { setStatus(I18n.t('Дождитесь сохранения перед выходом.')); return; }
      resumeOnReconnect = false;
      if (owner) {
        owner = null;
        $('organizer-key').value = '';
      }
      showKeyCard();
      show('choose');
      accessStatus.textContent = '';
    });
    $('resume-tournament').addEventListener('click', tryResume);

    async function copy(value, input, message, status) {
      status = status || shareStatus;
      try {
        await navigator.clipboard.writeText(value);
        status.textContent = message;
      } catch {
        if (input) {
          if (input.id === 'organizer-key' && input.type === 'password') $('key-reveal').click();
          input.select();
        }
        status.textContent = input ? I18n.t('Скопируйте выделенный текст.') : I18n.t('Скопируйте код вверху страницы.');
      }
    }

    $('key-card-copy').addEventListener('click', function () {
      if (owner) copy(owner.key, $('key-card-value'), I18n.t('Ключ скопирован.'), $('key-card-status'));
    });
    $('key-card-share').addEventListener('click', function () {
      if (!owner) return;
      navigator.share({
        title: I18n.t('Ключ организатора'),
        text: I18n.t('Код турнира: ') + display(owner.code) + '\n' + I18n.t('Ключ организатора: ') + owner.key
      }).catch(function () {});
    });
    $('key-card-done').addEventListener('click', function () {
      if (!owner) return;
      options.store('tt-key-saved:' + owner.id, owner.key.slice(0, 8));
      showKeyCard();
    });

    $('share-code-copy').addEventListener('click', function () {
      if (owner) copy(display(owner.code), null, I18n.t('Код скопирован.'));
    });
    $('share-copy').addEventListener('click', function () {
      if (owner) copy($('share-link').value, $('share-link'), I18n.t('Ссылка скопирована.'));
    });
    $('key-copy').addEventListener('click', function () {
      if (owner) copy(owner.key, $('organizer-key'), I18n.t('Ключ скопирован.'));
    });
    $('key-reveal').addEventListener('click', function (event) {
      var reveal = $('organizer-key').type === 'password';
      $('organizer-key').type = reveal ? 'text' : 'password';
      event.target.setAttribute('aria-pressed', reveal);
      event.target.textContent = reveal ? I18n.t('Скрыть ключ') : I18n.t('Показать ключ');
    });
    $('key-rotate').addEventListener('click', async function () {
      if (!owner || busy || closing || !window.confirm(I18n.t('Заменить ключ организатора? Старый ключ перестанет работать.'))) return;
      var replacement = Array.from(crypto.getRandomValues(new Uint8Array(32)), function (byte) {
        return byte.toString(16).padStart(2, '0');
      }).join('');
      var current = owner;
      var newCredential = { id: owner.id, key: replacement };
      options.store('tt-rotation:' + owner.id, newCredential);
      closing = true;
      try {
        await request('POST', owner.id + '/key', { key: replacement }, owner);
        current.key = replacement;
        remember();
        $('organizer-key').value = replacement;
        options.store('tt-rotation:' + owner.id, null);
        showKeyCard();
        shareStatus.textContent = I18n.t('Ключ заменён. Сохраните новый ключ.');
      } catch {
        shareStatus.textContent = I18n.t('Замена не подтверждена. Обновите страницу для проверки ключа.');
      } finally {
        closing = false;
        if (dirty || pending) schedule(0);
        else queueNext(0);
      }
    });
    $('show-join-qr').addEventListener('click', async function () {
      if (!owner) return;
      try {
        var generator = (await import('./vendor/qrcode.js')).default;
        var qr = generator(0, 'M');
        qr.addData(playerUrl(owner.code));
        qr.make();
        var canvas = $('join-qr'), count = qr.getModuleCount(), scale = 6;
        canvas.width = canvas.height = (count + 8) * scale;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#000';
        for (var row = 0; row < count; row++) {
          for (var col = 0; col < count; col++) {
            if (qr.isDark(row, col)) ctx.fillRect((col + 4) * scale, (row + 4) * scale, scale, scale);
          }
        }
        canvas.hidden = false;
      } catch {
        shareStatus.textContent = I18n.t('Не удалось показать QR-код. Используйте код турнира или ссылку.');
      }
    });

    async function changeFinal(event) {
      if (!owner || closing || busy || dirty || pending || records().length) {
        setStatus(I18n.t('Сначала синхронизируйте или проверьте все результаты.'));
        return;
      }
      var reopening = event.currentTarget.id === 'reopen-tournament';
      var prompt = reopening ? I18n.t('Открыть турнир для исправлений? Сохранённый протокол останется в архиве.')
        : I18n.t('Завершить турнир и сохранить итоговый протокол? Результаты будут закрыты для изменений.');
      if (!window.confirm(prompt)) return;
      busy = true;
      try {
        await request('POST', owner.id + (reopening ? '/reopen' : '/finalize'), null, owner);
        await refreshCanonical();
        setStatus(reopening ? I18n.t('Турнир открыт для исправлений.') : I18n.t('Турнир завершён. Итоговый протокол сохранён.'));
      } catch {
        await refreshCanonical().catch(function () {});
        setStatus(I18n.t('Действие не подтверждено. Проверьте результаты и попробуйте ещё раз.'));
      } finally {
        busy = false;
      }
    }
    $('finalize-tournament').addEventListener('click', changeFinal);
    $('reopen-tournament').addEventListener('click', changeFinal);
    $('share-stop').addEventListener('click', async function () {
      if (!owner || closing || busy || !window.confirm(I18n.t('Удалить этот турнир с сервера? Результаты и код перестанут быть доступны.'))) return;
      closing = true;
      clearTimeout(retry);
      try {
        await request('DELETE', owner.id, null, owner);
        forget();
        accessStatus.textContent = I18n.t('Турнир удалён с сервера.');
      } catch {
        shareStatus.textContent = I18n.t('Не удалось удалить турнир. Попробуйте ещё раз.');
      } finally {
        closing = false;
        if (pending || dirty) schedule(1000);
      }
    });

    window.addEventListener('online', function () {
      if (mode === 'owner') { if (pending || dirty || records().length) schedule(0); else refreshOwner(); }
      else if (resumeOnReconnect) tryResume();
    });
    window.addEventListener('beforeunload', function (event) {
      if (owner && ((busy && !queueBusy) || pending || dirty)) { event.preventDefault(); event.returnValue = ''; }
    });
    window.addEventListener('storage', function (event) {
      if (queue && queue.matches(event.key)) { showQueue(); if (!busy) queueNext(150); }
    });
    setInterval(function () {
      if (lastConfirmed && intervalFor(lastConfirmed) > 8000 && Math.floor(Date.now() / 8000) % 3 !== 0) return;
      refreshOwner();
    }, 8000);
    show('choose');
    tryResume();
    return {
      changed: changed,
      score: queueScore, discard: discard,
      allowChange: function () { return Boolean(owner && connected && !lastConfirmed?.finalizedAt && !records().length); },
      archives: function () { return request('GET', owner.code + '/archives'); },
      archive: function (revision) { return request('GET', owner.code + '/archives?revision=' + revision); },
      isSaved: function () { return Boolean(owner && !busy && !dirty && !pending && !closing && !records().length); },
      mayNavigate: function () { return (!busy || queueBusy) && !dirty && !pending && !entering; },
      safeToReload: function () { return !busy && !dirty && !pending && !entering && !records().length; }
    };
  }

  return { viewer: viewer, organizer: organizer };
})();
