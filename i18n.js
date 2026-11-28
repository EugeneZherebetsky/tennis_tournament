var I18n = (function () {
  'use strict';
  var lang = new URLSearchParams(location.search).get('lang');
  if (lang !== 'en' && lang !== 'ru') {
    try { lang = localStorage.getItem('tt-language'); } catch { /* Default below. */ }
  }
  lang = lang === 'en' ? 'en' : 'ru';
  document.documentElement.lang = lang;
  try { localStorage.setItem('tt-language', lang); } catch { /* The current URL still works. */ }

  var pairs = `двух|two
пяти|five
11:9 или 13:11|11:9 or 13:11
21:18 или 23:21|21:18 or 23:21
очков|points
очка|points
Введите целое число от 0 до 99.|Enter a whole number from 0 to 99.
Ничьей быть не может — нужен победитель.|Enter a result with a winner.
по лимиту времени|time limit
По лимиту времени|Time limit
проверьте счёт: после|check the score: after
игра идёт до перевеса в 2 очка.|play continues until one player leads by two points.
нестандартный счёт — окончено по лимиту времени?|unusual score. Did the match end at the time limit?
Отдых:|Resting:
Записано ·|Saved ·
Ожидает результата|Awaiting result
Нужна проверка|Needs review
В очереди|Pending
В очереди:|Pending:
удаление|removal
Проверить результат|Review result
Изменить результат|Edit result
Внести результат|Enter result
Победитель:|Winner:
Первое место делят:|Tied for first:
Настольный теннис|Table tennis
Сыграно|Played
из|of
матчей.|matches.
Турнир завершён.|Tournament finalized.
Все результаты внесены.|All results entered.
Рейтинг предварительный.|Standings are provisional.
Итоговый протокол / PDF|Final report / PDF
Протокол матчей / PDF|Match report / PDF
Матчей:|Matches:
· Раундов:|· Rounds:
· Матчей на игрока:|· Matches per player:
Раунд|Round
мин|min
Раундов:|Rounds:
Итоги|Results
Время от начала турнира. Игра:|Times are measured from the start. Play:
мин на раунд. Смена игроков и запись счёта: 2 мин.|min per round. Changeover and score entry: 2 min.
Матч до|Play to
Матч состоит из одной партии до|Each match consists of one game to
. Для обычной победы нужен перевес минимум в два очка (например,|. A standard win requires a lead of at least two points (for example,
Первую подачу определите жребием. Подача переходит после каждых|Draw lots to decide who serves first. Service switches every
розыгрышей, при|points. At
— после каждого. При подаче мяч подбрасывают с открытой ладони, и он должен отскочить сначала на своей, затем на чужой половине стола.|it switches after every point. Toss the ball from an open palm; it must bounce first on your side, then on your opponent’s side.
Лимит —|Time limit:
мин на матч. По сигналу таймера завершите текущий розыгрыш.|min per match. Finish the current rally when the timer sounds.
Если партия не закончена, выигрывает тот, кто ведёт в счёте. При равенстве разыгрывается одно решающее очко по очереди подачи.|If time runs out, the leading player wins. If the score is tied, play one deciding point in the normal service order.
Затем внесите итоговый счёт. Это специальное правило мини-турнира, а не стандартное правило настольного тенниса.|Then enter the final score. This time-limit rule is specific to this tournament.
Игра:|Play:
мин на матч. Турнир:|min per match. Tournament:
мин.|min.
Разминка|Warm-up
· игра|· play
смена и запись|changeover and scores
запись результатов|record results
Далее:|Next:
мин)|min)
Последний этап|Final phase
Пауза|Pause
Завершено|Finished
Продолжить|Resume
Старт|Start
Мини-турнир по настольному теннису|Table tennis tournament
Настройки и таймер доступны после синхронизации и до завершения турнира.|Settings and timer controls are available once scores sync and while the tournament is open.
Сбросить таймер к началу турнира?|Reset the timer to the start of the tournament?
Официальные данные турнира хранятся на сервере.|Official tournament data is stored on the server.
Настройки, имена, результаты и таймер сохраняются в этом браузере.|Settings, names, scores, and the timer are stored in this browser.
Автоподсчёт работает, но локальное сохранение недоступно. Не закрывайте страницу до окончания турнира.|Scoring works, but local storage is unavailable. Keep this page open for the tournament.
Страница доступна без интернета.|The page is available offline.
Сейчас нет сети — работа офлайн.|No connection. Working offline.
· Стол|· Table
Игры завершены. Итоги в таблице.|Matches are over. See the standings for results.
Завершённый раунд|Completed round
Сейчас|Now
Сейчас вы отдыхаете.|You are resting this round.
Следующий матч|Next match
Игрок|Player
Отбросить правку|Discard edit
Стол|Table
Текущие раунды|Current rounds
Все раунды|All rounds
Введите от 2 до 24 игроков и от 1 до 12 столов.|Enter 2–24 players and 1–12 tables.
(авто)|(auto)
· Минимум:|· Minimum:
мин · Авто:|min · Auto:
Счёт матчей удалённых игроков будет удалён.|Results involving removed players will be removed.
Таймер вернётся к началу турнира.|The timer will return to the beginning.
Применить настройки?|Apply these settings?
Настройки применены.|Settings applied.
· До|· Play to
Сверьте результат с сервером и подтвердите свою правку.|Compare this score with the server result, then confirm your correction.
Удалить результат этого матча?|Remove the result of this match?
Введите очки обоих участников.|Enter both players’ scores.
Введите целые числа от 0 до 99.|Enter whole numbers from 0 to 99.
При равном счёте разыграйте решающее очко.|Play a deciding point if the score is tied.
Проверьте счёт. Если игра закончилась по сигналу, отметьте лимит времени.|Check the score. If the timer ended the game, select the time-limit option.
Результат добавлен в очередь.|Result added to the queue.
Длительность матчей изменится, таймер будет сброшен. Продолжить?|The match length will change and the timer will reset. Continue?
Итоговый протокол|Final report
Промежуточный протокол|Provisional report
Код:|Code:
Локальный турнир ·|Local tournament ·
Завершён:|Finalized:
Сформирован:|Generated:
Игроков:|Players:
· Столов:|· Tables:
· Игра до|· Play to
· Сыграно|· Played
— Настольный теннис|— Table tennis
Дождитесь сохранения результатов на сервере и откройте протокол снова.|Wait for results to sync to the server, then open the report again.
Загружаем протоколы…|Loading archived reports…
Сохранённых протоколов пока нет.|No archived reports yet.
Не удалось открыть протокол.|Could not open the report.
Не удалось загрузить протоколы.|Could not load the archived reports.
Кратко|Summary
Подробности|Details
Загружаем общую таблицу…|Loading shared standings…
Удалить все результаты? Имена участников сохранятся.|Clear all scores? Player names will be kept.
Проверьте код или ссылку турнира.|Check the tournament code or link.
Режим игрока · Результаты обновляются автоматически|Player view · Results update automatically
Турнир не найден. Проверьте код или уточните его у организатора.|Tournament not found. Check the code with the organizer.
Связь прервана. Показаны последние полученные результаты.|Connection lost. Showing the last received results.
Турнир пока недоступен. Повторяем подключение.|Tournament unavailable. Retrying…
Показать ключ|Show key
Офлайн. Новые результаты будут сохранены в очереди.|Offline. New results will be kept in the queue.
Турнир загружен с сервера.|Tournament loaded from the server.
Сначала дождитесь сохранения настроек турнира.|Wait for the tournament settings to finish saving.
Этот результат уже ждёт отправки.|This result is already queued.
Браузер не смог сохранить результат в очередь. Проверьте настройки хранения.|The browser could not save this result to the queue. Check local storage.
Сохранено на сервере.|Saved to the server.
Результат требует проверки.|The result needs review.
Сервер не принял результат. Проверьте ключ организатора; очередь сохранена.|The server rejected the result. Check the organizer key. Your queue is safe.
Офлайн или нет связи. Результат сохранён в очереди.|No connection. The result is saved in the queue.
Сохраняем на сервере…|Saving to the server…
Этот турнир больше не доступен.|This tournament is no longer available.
Турнир изменён на другом устройстве. Загружена версия сервера. Повторите свою правку.|Another device changed the tournament. The server version has been loaded. Reapply your change.
Не удалось получить новую версию турнира. Повторим подключение.|Could not fetch the latest tournament. Retrying…
Изменения ещё не на сервере. Оставьте страницу открытой: повторим отправку.|Changes have not reached the server. Keep this page open while we retry.
Загружены изменения с другого устройства.|Changes from another device were loaded.
Загружаем турнир с сервера…|Loading tournament from the server…
Не удалось подтвердить новый ключ. Повторите подключение.|Could not confirm the new key. Reconnect to check it.
Предыдущий турнир недоступен. Введите код другого турнира.|The previous tournament is unavailable. Enter another code.
Нет связи с сервером. Повторите вход по коду или откройте локальный черновик.|Could not reach the server. Try the code again or open a local draft.
Введите код из 12 символов.|Enter a 12-character code.
Введите полный ключ организатора.|Enter the full organizer key.
Открываем турнир…|Opening tournament…
Ключ организатора не подходит к этому турниру.|This organizer key does not match the tournament.
Турнир не найден. Проверьте код.|Tournament not found. Check the code.
Не удалось связаться с сервером. Попробуйте ещё раз.|Could not reach the server. Try again.
Создаём турнир на сервере…|Creating tournament on the server…
Турнир создан. Сообщите игрокам код, а ключ организатора сохраните в настройках.|Tournament created. Share the player code and save your organizer key from settings.
Не удалось подтвердить создание турнира. Нажмите кнопку ещё раз.|Could not confirm creation. Press the button again to retry.
Локальный черновик · Хранится только в этом браузере|Local draft · Stored in this browser
Дождитесь сохранения перед выходом.|Wait for changes to save before leaving.
Скопируйте выделенный текст.|Copy the selected text.
Скопируйте код вверху страницы.|Copy the code at the top of the page.
Код скопирован.|Code copied.
Ссылка скопирована.|Link copied.
Ключ скопирован.|Key copied.
Скрыть ключ|Hide key
Заменить ключ организатора? Старый ключ перестанет работать.|Replace the organizer key? The old key will stop working.
Ключ заменён. Сохраните новый ключ.|Key replaced. Keep the new key safe.
Замена не подтверждена. Обновите страницу для проверки ключа.|Key replacement could not be confirmed. Reload the page to check the key.
Не удалось показать QR-код. Используйте код турнира или ссылку.|Could not show the QR code. Use the tournament code or link.
Сначала синхронизируйте или проверьте все результаты.|Sync or review all results first.
Открыть турнир для исправлений? Сохранённый протокол останется в архиве.|Reopen the tournament for corrections? The saved report will remain in the archive.
Завершить турнир и сохранить итоговый протокол? Результаты будут закрыты для изменений.|Finalize the tournament and save the final report? Results will be locked.
Турнир открыт для исправлений.|Tournament reopened for corrections.
Турнир завершён. Итоговый протокол сохранён.|Tournament finalized. The final report was archived.
Действие не подтверждено. Проверьте результаты и попробуйте ещё раз.|The action could not be confirmed. Check results and try again.
Удалить этот турнир с сервера? Результаты и код перестанут быть доступны.|Remove this tournament from the server? Its results and code will stop working.
Турнир удалён с сервера.|Tournament removed from the server.
Не удалось удалить турнир. Попробуйте ещё раз.|Could not remove the tournament. Try again.
Круговой турнир · каждый с каждым|Round robin · everyone plays everyone
10 матчей · 5 раундов · по 4 матча на участника|10 matches · 5 rounds · 4 matches per player
Игроки|Players
Столы|Tables
Минуты|Minutes
Доступно обновление приложения.|An app update is available.
Обновить приложение|Update app
Открыть турнир|Open a tournament
По коду доступны расписание, таймер и результаты.|Use a code to open the schedule, timer, and results.
Код турнира|Tournament code
Открыть как игрок|Open as a player
Вход для организатора|Organizer sign-in
Ключ организатора|Organizer key
Войти как организатор|Sign in as organizer
Новый турнир|New tournament
Перенести локальные настройки и результаты|Import local settings and scores
Создать турнир на сервере|Create an online tournament
Недавние турниры|Recent tournaments
Продолжить управление|Resume organizing
Открыть локальный черновик|Open a local draft
Код для игроков|Player code
К списку действий|Back to tournaments
Далее: Раунд 1 · игра|Next: Round 1 · play
Мои матчи|My matches
Таблица|Standings
Открыть другой турнир|Open another tournament
Я играю как|I am playing as
Выберите себя|Select your name
Все мои матчи|All my matches
Настройки, участники и публикация|Settings, players, and sharing
Настройки турнира|Tournament settings
Название турнира|Tournament title
Длительность турнира, мин|Tournament duration, min
Оставьте время пустым для авторасчёта. В длительность входят разминка, смена игроков и подведение итогов.|Leave blank for automatic timing. The duration includes warm-up, changeovers, and results.
Применить настройки|Apply settings
1. Участники|1. Players
11 очков|11 points
21 очка|21 points
Автоподсчёт не запущен. Если это сообщение остаётся, откройте страницу в браузере с поддержкой JavaScript, а не в предпросмотре файла. Таблицы ниже доступны для просмотра и ручного заполнения, если просмотрщик разрешает ввод.|Automatic scoring needs JavaScript. Open the page in a browser to use it, or fill in the tables by hand.
Распечатать / PDF|Print / PDF
Сбросить счёт|Clear all scores
Общая таблица|Share the tournament
Игроки открывают турнир по коду или ссылке и видят обновления. Ключ организатора позволяет управлять турниром с другого устройства.|Players use the code or link to view live updates. Use the organizer key to manage the tournament from another device.
Копировать код|Copy code
Копировать ссылку|Copy link
Показать QR-код|Show QR code
Ссылка для игроков|Player link
Сохраните ключ в безопасном месте. Любой, кто знает код турнира и этот ключ, может менять результаты.|Keep the key safe. Anyone with the tournament code and organizer key can edit results.
Ключ для входа с другого устройства|Key for signing in from another device
Копировать ключ|Copy key
Заменить ключ|Replace key
Удалить турнир с сервера|Delete tournament from server
2. Расписание и счёт|2. Schedule and scores
5–55 мин|5–55 min
5 раундов по 10 минут|5 rounds of 10 minutes
Время отсчитывается от начала турнира. В каждом раунде — 8 минут игры и 2 минуты на смену участников.|Times start at the beginning of the tournament. Each round includes 8 minutes of play and 2 minutes for changeover.
Стол / матч|Table / match
Отдых|Rest
Победитель|Winner
П1–П5 — номера участников. При работающем автоподсчёте введённые выше имена заменят обозначения. В поля рядом с именами внесите итоговые очки (например, 11 и 8).|P1–P5 are player numbers. The names above replace them when automatic scoring is available. Enter final scores next to each name.
Результаты требуют проверки|Results need review
3. Турнирная таблица|3. Standings
Завершить турнир|Finalize tournament
Открыть для исправлений|Reopen for corrections
Сохранённые протоколы|Archived reports
Место|Rank
И|P
В|W
П|L
Победы|Wins
О+|PF
О−|PA
Б|Pts
Ручная таблица: внесите итоги самостоятельно, если автоматический подсчёт недоступен.|Fill in the standings manually if automatic scoring is unavailable.
Легенда таблицы|Standings key
И — сыгранные матчи; В — победы; П — поражения; О+ — набранные очки; О− — пропущенные очки; Δ — разница очков (О+ минус О−); Б — турнирные баллы (1 за победу, 0 за поражение). Порядок мест: баллы → личные встречи среди равных → Δ → О+. «=» у места означает равенство показателей.|P: played. W: wins. L: losses. PF: points for. PA: points against. Δ: point difference. Pts: one point per win. Ties are broken by head-to-head results, point difference, then points scored. An equals sign marks a tie.
Правила турнира|Tournament rules
Каждый играет с каждым один раз. Никто не выбывает. Свободные в этом раунде игроки указаны в расписании.|Everyone plays everyone once. Nobody is eliminated. The schedule shows who rests each round.
Матч состоит из одной партии до 11 очков. Для обычной победы нужен перевес минимум в два очка (например, 11:9 или 13:11).|Each match is one game to 11. A standard win requires a two-point lead, such as 11:9 or 13:11.
Первую подачу определите жребием. Подача меняется через каждые два розыгрыша, при 10:10 — после каждого. При подаче мяч подбрасывают с открытой ладони и он должен отскочить сначала на своей, затем на чужой половине стола.|Draw for first serve. Service alternates every two points, or after every point at 10:10. Toss from an open palm and bounce on each side of the table.
Лимит — 8 минут на матч. По сигналу завершите текущий розыгрыш. Если партия не закончена, выигрывает тот, кто ведёт в счёте. При равенстве разыгрывается одно решающее очко по очереди подачи. Затем внесите итоговый счёт. Это специальное правило мини-турнира, а не стандартное правило настольного тенниса.|The match limit is 8 minutes. Finish the current rally at the signal. The leader wins, or play one deciding point if tied. Record the final score. This time-limit rule is specific to this tournament.
Таймер подаёт сигнал за минуту до конца игры и по её окончании. После игры в каждом раунде — две минуты на запись результатов и смену игроков.|The timer signals one minute before the end, then again at the end. Each round allows two minutes to record scores and change players.
За победу начисляется 1 турнирный балл, за поражение — 0. Места определяются по баллам. При равенстве баллов — по результатам личных встреч между равными участниками, затем по общей разнице очков, затем по общим набранным очкам. Если все показатели равны, место делится; если нужен единственный победитель, участники могут разыграть дополнительное решающее очко в оставшееся время.|A win earns one tournament point. Ties are broken by head-to-head results, point difference, then points scored. Players share a place if still tied. If one winner is needed, they can play a deciding point in the remaining time.
Последние 5 минут — проверка результатов и объявление победителя. Финальный матч не предусмотрен: победитель определяется по итогам кругового турнира.|Use the last five minutes to check results and announce the winner. The round-robin standings determine the winner.
Вернуться к турниру|Back to tournament
Печать / PDF|Print / PDF
Скачать CSV|Download CSV
Настольный теннис · Круговой турнир|Table tennis · Round robin
Турнирная таблица|Tournament standings
Игры|Played
Поражения|Losses
Результаты матчей|Match results
Счёт|Score
Примечание|Note
О+ — набранные очки, О− — пропущенные, Δ — разница очков. Матчи указаны в порядке раундов.|PF: points for. PA: points against. Δ: point difference. Matches are listed by round.
Результат матча|Match result
Игра закончилась по лимиту времени|The time limit ended the match
Записать результат|Save result
Отмена|Cancel
Удалить результат|Remove result
Круговой мини-турнир по настольному теннису с выбором числа игроков, столов и времени. Расписание, таймер раундов и автоматическая турнирная таблица.|Round-robin table tennis with configurable players, tables, and duration, a round timer, and automatic standings.
Теннис|Table tennis
Состояние турнира|Tournament status
Таймер турнира|Tournament timer
Управление этапами|Timer controls
Предыдущий этап|Previous phase
Следующий этап|Next phase
Сбросить таймер|Reset timer
Турнир|Tournament
QR-код для входа игрока|Player QR code
Итоговая турнирная таблица|Final standings
Результаты всех матчей|Results of all matches
Дождитесь синхронизации перед обновлением.|Wait for scores to sync before updating.
Обновляем приложение…|Updating the app…
Дождитесь сохранения перед сменой языка.|Wait for changes to save before switching languages.
Участники|Players
Расписание и счёт|Schedule and scores
Игра|Game
Настройки|Settings
Разделы турнира|Tournament sections
Проверить|Review
Изменить|Edit
Ввести счёт|Enter score
Поделиться|Share
Я сохранил ключ|I saved the key
Сохраните ключ организатора|Save your organizer key
Без ключа нельзя управлять турниром с другого устройства или после очистки браузера. Любой, у кого есть код и ключ, может менять результаты.|Without this key you cannot manage the tournament from another device or after clearing the browser. Anyone with the code and the key can change results.
Код турнира:|Tournament code:
Ключ организатора:|Organizer key:
Турнир создан. Сохраните ключ организатора и сообщите игрокам код.|Tournament created. Save your organizer key and share the player code.
Создать турнир|Create tournament
Игроки откроют его по коду, ссылке или QR-коду.|Players open it with the code, link, or QR code.
Перенести данные из локального черновика|Import data from the local draft
Играть без интернета|Play offline
Турнир хранится только на этом устройстве, без кода для игроков.|Saved only on this device, without a player code.
«=» — у игроков одинаковые показатели, место делится.|"=" means the players have identical records and share the place.
Начало примерно через|Starts in about
APP_LANG|Language
Раунд 1|Round 1`;
  var english = new Map(pairs.split('\n').map(function (line) { return line.split('|'); }));

  function text(value) {
    if (lang !== 'en' || typeof value !== 'string' || !/[А-Яа-яЁё]/.test(value)) return value;
    var key = value.trim();
    var candidate = english.get(key);
    if (!candidate) {
      candidate = key.replace(/Раунд (\d+)/g, 'Round $1').replace(/Стол (\d+)/g, 'Table $1')
        .replace(/Игрок (\d+)/g, 'Player $1').replace(/П(\d+)/g, 'P$1')
        .replace(/^Отдых:/, 'Resting:').replace(/^Очки /, 'Score: ').replace(/ мин$/, ' min');
    }
    return value.replace(key, function () { return candidate; });
  }

  if (lang === 'en') {
    document.title = text(document.title);
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) node.nodeValue = text(node.nodeValue);
    document.querySelectorAll('[aria-label],[title],[placeholder],meta[content]').forEach(function (element) {
      ['aria-label', 'title', 'placeholder', 'content'].forEach(function (attribute) {
        if (element.hasAttribute(attribute)) element.setAttribute(attribute, text(element.getAttribute(attribute)));
      });
    });
  }

  var button = document.getElementById('language-switch');
  button.textContent = lang === 'en' ? 'RU' : 'EN';
  button.setAttribute('aria-label', lang === 'en' ? 'Switch to Russian' : 'Переключить на английский');
  button.hidden = false;
  return {
    lang: lang, locale: lang === 'en' ? 'en-GB' : 'ru-RU', t: text,
    switchLanguage: function () {
      var next = new URL(location.href);
      next.searchParams.set('lang', lang === 'en' ? 'ru' : 'en');
      location.assign(next.href);
    }
  };
})();
