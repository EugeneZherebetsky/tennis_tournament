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
      if (method === 'PUT') headers['If-Match'] = '"' + owner.revision + '"';
    }
    var res = await fetch(endpoint + (id ? '/' + id : ''), {
      method: method, body: body ? JSON.stringify(body) : undefined,
      headers: headers, cache: 'no-store', signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw Object.assign(new Error('Tournament request failed'), { status: res.status });
    return res.status === 204 ? null : res.json();
  }

  function viewer(id, code, receive, status) {
    var locator = code === null ? id : normalize(code);
    if (!(code === null ? validId : validCode).test(locator)) {
      status('Проверьте код или ссылку турнира.', false);
      return;
    }
    var revision, initialized = false, running = false, closed = false, timer;
    async function refresh() {
      if (running || closed) return;
      clearTimeout(timer);
      if (document.visibilityState !== 'hidden') {
        running = true;
        try {
          var result = await request('GET', locator);
          if (result.revision !== revision) receive(result.snapshot, result.code);
          revision = result.revision;
          initialized = true;
          status('Режим игрока · Результаты обновляются автоматически', true);
        } catch (error) {
          if (error.status === 404) {
            closed = true;
            status('Турнир не найден. Проверьте код или уточните его у организатора.', false);
            return;
          }
          status(initialized ? 'Связь прервана. Показаны последние полученные результаты.' : 'Турнир пока недоступен. Повторяем подключение.', initialized);
        } finally {
          running = false;
        }
      }
      timer = setTimeout(refresh, 8000);
    }
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    refresh();
  }

  function organizer(options) {
    var owner = null;
    var remembered = options.load(ownerKey);
    var recoverable = remembered && validId.test(remembered.id) && validKey.test(remembered.key) ? remembered : null;
    var draftAttempt, busy = false, dirty = false, pending, retry, entering = false, closing = false;
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
      options.mode(mode);
    }

    function remember() {
      // Cache the credential so the browser can sign in again. Scores are read from the server.
      options.store(ownerKey, owner ? { id: owner.id, key: owner.key } : null);
    }

    function activate(result, credential) {
      owner = { id: result.id, code: result.code, revision: result.revision, key: credential.key };
      recoverable = owner;
      remember();
      $('session-code').textContent = display(result.code);
      $('share-link').value = playerUrl(result.code);
      $('organizer-key').value = owner.key;
      $('organizer-key').type = 'password';
      $('key-reveal').textContent = 'Показать ключ';
      $('key-reveal').setAttribute('aria-pressed', 'false');
      playerCode.value = '';
      organizerKey.value = '';
      draftAttempt = null;
      show('owner');
      options.receive(result.snapshot);
      setStatus('Турнир загружен с сервера.');
    }

    function forget() {
      clearTimeout(retry);
      owner = recoverable = draftAttempt = pending = null;
      dirty = false;
      remember();
      $('organizer-key').value = '';
      $('share-link').value = '';
      shareStatus.textContent = '';
      show('choose');
    }

    function schedule(delay) {
      clearTimeout(retry);
      if (owner && !closing) retry = setTimeout(sync, delay);
    }

    function changed() {
      if (!owner || mode !== 'owner') return;
      dirty = true;
      setStatus('Сохраняем на сервере…');
      if (!busy) schedule(150);
    }

    async function sync() {
      if (!owner || busy || closing || (!dirty && !pending)) return;
      if (!pending) {
        pending = { owner: { ...owner }, snapshot: structuredClone(options.snapshot()) };
        dirty = false;
      }
      busy = true;
      try {
        var result = await request('PUT', owner.id, pending.snapshot, pending.owner);
        owner.revision = result.revision;
        pending = null;
        setStatus('Сохранено на сервере.');
      } catch (error) {
        if (error.status === 404) {
          forget();
          accessStatus.textContent = 'Этот турнир больше не доступен.';
        } else if (error.status === 412) {
          try {
            var latest = await request('GET', owner.id, null, owner);
            owner.revision = latest.revision;
            pending = null;
            dirty = false;
            options.receive(latest.snapshot);
            setStatus('Турнир изменён на другом устройстве. Загружена версия сервера. Повторите свою правку.');
          } catch {
            setStatus('Не удалось получить новую версию турнира. Повторим подключение.');
          }
        } else {
          setStatus('Изменения ещё не на сервере. Оставьте страницу открытой: повторим отправку.');
        }
      } finally {
        busy = false;
        if (pending || dirty) schedule(pending ? 8000 : 150);
      }
    }

    async function refreshOwner() {
      var session = owner;
      if (!session || busy || dirty || pending || closing || document.visibilityState === 'hidden' || !options.canRefresh()) return;
      try {
        var current = await request('GET', session.id, null, session);
        if (owner !== session || busy || dirty || pending || closing || !options.canRefresh()) return;
        if (current.revision !== owner.revision) {
          owner.revision = current.revision;
          options.receive(current.snapshot);
          setStatus('Загружены изменения с другого устройства.');
        }
      } catch (error) {
        if (owner === session && !busy && !pending && !dirty && error.status === 404) {
          forget();
          accessStatus.textContent = 'Этот турнир больше не доступен.';
        }
      }
    }

    async function tryResume() {
      if (!recoverable || entering || mode !== 'choose') return;
      entering = true;
      accessStatus.textContent = 'Загружаем турнир с сервера…';
      try {
        activate(await request('GET', recoverable.id, null, recoverable), recoverable);
      } catch (error) {
        if (error.status === 404 || error.status === 403) {
          forget();
          accessStatus.textContent = 'Предыдущий турнир недоступен. Введите код другого турнира.';
        } else {
          accessStatus.textContent = 'Нет связи с сервером. Повторите вход по коду или откройте локальный черновик.';
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
      if (!validCode.test(code)) { accessStatus.textContent = 'Введите код из 12 символов.'; playerCode.focus(); return; }
      if (manage && !validKey.test(key)) { accessStatus.textContent = 'Введите полный ключ организатора.'; organizerKey.focus(); return; }
      entering = true;
      accessStatus.textContent = 'Открываем турнир…';
      try {
        var result = await request('GET', code, null, manage ? { key: key } : null);
        if (manage) activate(result, { key: key });
        else location.assign(playerUrl(code));
      } catch (error) {
        accessStatus.textContent = error.status === 403 ? 'Ключ организатора не подходит к этому турниру.'
          : error.status === 404 ? 'Турнир не найден. Проверьте код.' : 'Не удалось связаться с сервером. Попробуйте ещё раз.';
      } finally {
        entering = false;
      }
    });

    $('create-tournament').addEventListener('click', async function () {
      if (entering) return;
      entering = true;
      accessStatus.textContent = 'Создаём турнир на сервере…';
      if (!draftAttempt) {
        var key = Array.from(crypto.getRandomValues(new Uint8Array(32)), function (byte) {
          return byte.toString(16).padStart(2, '0');
        }).join('');
        draftAttempt = { id: crypto.randomUUID(), key: key, snapshot: options.initial($('import-draft').checked) };
        if (!recoverable) options.store(ownerKey, { id: draftAttempt.id, key: key });
      }
      try {
        var created = await request('POST', '', { id: draftAttempt.id, snapshot: draftAttempt.snapshot }, draftAttempt);
        if (created.revision === 1) created.snapshot = draftAttempt.snapshot;
        else created = await request('GET', draftAttempt.id, null, draftAttempt);
        activate(created, draftAttempt);
        $('organizer').open = true;
        setStatus('Турнир создан. Сообщите игрокам код, а ключ организатора сохраните в настройках.');
      } catch {
        accessStatus.textContent = 'Не удалось подтвердить создание турнира. Нажмите кнопку ещё раз.';
      } finally {
        entering = false;
      }
    });

    $('local-tournament').addEventListener('click', function () {
      if (entering) return;
      show('local');
      options.receive(options.initial(true));
      setStatus('Локальный черновик · Хранится только в этом браузере');
    });

    $('leave-session').addEventListener('click', function () {
      if (busy || dirty || pending) { setStatus('Дождитесь сохранения перед выходом.'); return; }
      resumeOnReconnect = false;
      if (owner) {
        owner = null;
        $('organizer-key').value = '';
      }
      show('choose');
      accessStatus.textContent = '';
    });
    $('resume-tournament').addEventListener('click', tryResume);

    async function copy(value, input, message) {
      try {
        await navigator.clipboard.writeText(value);
        shareStatus.textContent = message;
      } catch {
        if (input) {
          if (input.id === 'organizer-key' && input.type === 'password') $('key-reveal').click();
          input.select();
        }
        shareStatus.textContent = input ? 'Скопируйте выделенный текст.' : 'Скопируйте код вверху страницы.';
      }
    }

    $('share-code-copy').addEventListener('click', function () {
      if (owner) copy(display(owner.code), null, 'Код скопирован.');
    });
    $('share-copy').addEventListener('click', function () {
      if (owner) copy($('share-link').value, $('share-link'), 'Ссылка скопирована.');
    });
    $('key-copy').addEventListener('click', function () {
      if (owner) copy(owner.key, $('organizer-key'), 'Ключ скопирован.');
    });
    $('key-reveal').addEventListener('click', function (event) {
      var reveal = $('organizer-key').type === 'password';
      $('organizer-key').type = reveal ? 'text' : 'password';
      event.target.setAttribute('aria-pressed', reveal);
      event.target.textContent = reveal ? 'Скрыть ключ' : 'Показать ключ';
    });
    $('share-stop').addEventListener('click', async function () {
      if (!owner || closing || busy || !window.confirm('Удалить этот турнир с сервера? Результаты и код перестанут быть доступны.')) return;
      closing = true;
      clearTimeout(retry);
      try {
        await request('DELETE', owner.id, null, owner);
        forget();
        accessStatus.textContent = 'Турнир удалён с сервера.';
      } catch {
        shareStatus.textContent = 'Не удалось удалить турнир. Попробуйте ещё раз.';
      } finally {
        closing = false;
        if (pending || dirty) schedule(1000);
      }
    });

    window.addEventListener('online', function () {
      if (mode === 'owner') { if (pending || dirty) schedule(0); else refreshOwner(); }
      else if (resumeOnReconnect) tryResume();
    });
    window.addEventListener('beforeunload', function (event) {
      if (owner && (busy || pending || dirty)) { event.preventDefault(); event.returnValue = ''; }
    });
    setInterval(refreshOwner, 8000);
    show('choose');
    tryResume();
    return {
      changed: changed,
      isSaved: function () { return Boolean(owner && !busy && !dirty && !pending && !closing); }
    };
  }

  return { viewer: viewer, organizer: organizer };
})();
