var SharedBoard = (function () {
  'use strict';
  var endpoint = '/api/boards';
  var ownerKey = 'tt-board-owner-v1';
  var validId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  function $(id) { return document.getElementById(id); }

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
    if (!res.ok) throw Object.assign(new Error('Board request failed'), { status: res.status });
    return res.status === 204 ? null : res.json();
  }

  function viewer(id, receive, status) {
    if (!validId.test(id)) { status('Ссылка на таблицу недействительна.', false); return; }
    var revision, initialized = false;
    async function refresh() {
      if (document.visibilityState !== 'hidden') {
        try {
          var result = await request('GET', id);
          if (result.revision !== revision) receive(result.snapshot);
          revision = result.revision;
          initialized = true;
          status('Только просмотр · Обновляется автоматически', true);
        } catch (error) {
          if (error.status === 404) {
            status('Публикация этой таблицы завершена или ссылка устарела.', false);
            return;
          }
          status(initialized ? 'Связь прервана. Показаны последние полученные результаты.' : 'Таблица пока недоступна. Повторяем подключение.', initialized);
        }
      }
      setTimeout(refresh, 10000);
    }
    refresh();
  }

  function organizer(snapshot, load, store) {
    var publish = $('share-publish'), copy = $('share-copy'), stop = $('share-stop'), link = $('share-link');
    var owner = load(ownerKey), timer, busy, pending, dirty = false, stopping = false, blocked = false;
    if (!owner || !validId.test(owner.id) || !/^[0-9a-f]{64}$/.test(owner.key)) owner = null;
    function status(text) { if ($('share-status').textContent !== text) $('share-status').textContent = text; }
    function render() {
      var published = Boolean(owner && owner.revision);
      if (published) {
        var url = new URL(location.pathname, location.origin);
        url.searchParams.set('board', owner.id);
        link.value = url.href;
      }
      publish.hidden = published;
      publish.disabled = Boolean(owner);
      copy.hidden = !published;
      stop.hidden = !owner;
      $('share-link-label').hidden = !published;
    }

    function schedule(delay) {
      clearTimeout(timer);
      if (owner && !stopping && !blocked) timer = setTimeout(flush, delay);
    }

    function changed() {
      if (!owner || stopping || blocked) return;
      dirty = true;
      if (!busy) schedule(450);
    }

    function flush() {
      if (!owner || busy || stopping || blocked || (!dirty && !pending)) return;
      if (!pending) {
        pending = { owner: { ...owner }, snapshot: snapshot() };
        dirty = false;
      }
      var writing = pending.owner.revision > 0;
      status(writing ? 'Обновляем общую таблицу…' : 'Публикуем таблицу…');
      busy = (writing
        ? request('PUT', owner.id, pending.snapshot, pending.owner)
        : request('POST', '', { id: owner.id, snapshot: pending.snapshot }, pending.owner))
        .then(function (result) {
          owner.revision = result.revision;
          store(ownerKey, owner);
          pending = null;
          render();
          status('Таблица опубликована. Ссылка доступна 7 дней после последнего обновления.');
        }).catch(function (error) {
          if (error.status === 404 && writing) {
            owner = null;
            store(ownerKey, null);
            pending = null;
            render();
            status('Публикация завершена. Можно создать новую ссылку.');
          } else if (error.status === 412) {
            blocked = true;
            status('Таблица обновилась в другой вкладке. Обновите эту страницу перед продолжением.');
          } else {
            status('Связь с общей таблицей прервана. Изменения сохранены здесь, повторим отправку.');
          }
        }).finally(function () {
          busy = null;
          if (pending || dirty) schedule(pending ? 8000 : 450);
        });
    }

    publish.addEventListener('click', function () {
      if (owner) return;
      var key = Array.from(crypto.getRandomValues(new Uint8Array(32)), function (value) {
        return value.toString(16).padStart(2, '0');
      }).join('');
      owner = { id: crypto.randomUUID(), key: key, revision: 0 };
      store(ownerKey, owner);
      render();
      changed();
    });
    copy.addEventListener('click', async function () {
      try {
        await navigator.clipboard.writeText(link.value);
        status('Ссылка скопирована.');
      } catch {
        link.focus();
        link.select();
        status('Скопируйте выделенную ссылку.');
      }
    });
    stop.addEventListener('click', async function () {
      if (!owner || stopping || !window.confirm('Закрыть доступ по ссылке для игроков?')) return;
      stopping = true;
      stop.disabled = true;
      clearTimeout(timer);
      if (busy) await busy;
      try {
        if (owner) await request('DELETE', owner.id, null, owner);
      } catch (error) {
        if (error.status !== 404) {
          stopping = false;
          stop.disabled = false;
          status('Не удалось остановить публикацию. Проверьте подключение и попробуйте ещё раз.');
          if (pending || dirty) schedule(8000);
          return;
        }
      }
      owner = null;
      pending = null;
      dirty = blocked = stopping = false;
      stop.disabled = false;
      store(ownerKey, null);
      render();
      status('Публикация остановлена.');
    });

    window.addEventListener('online', changed);
    window.addEventListener('storage', function (event) {
      if (event.key !== ownerKey) return;
      // Only the active scorekeeper tab may publish revisions.
      blocked = true;
      clearTimeout(timer);
      status('Публикация изменилась в другой вкладке. Обновите эту страницу.');
    });
    render();
    request('GET').then(function () {
      $('sharing').hidden = false;
      if (owner) changed();
    }).catch(function () {
      if (owner) {
        $('sharing').hidden = false;
        status('Нет связи с общей таблицей. Изменения пока остаются в этом браузере.');
        changed();
      }
    });
    return { changed: changed };
  }

  return { viewer: viewer, organizer: organizer };
})();
