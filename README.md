# Farm Craft — браузерный порт

Порт игры Farm Craft (оригинал под Windows) на чистый JavaScript: ES-модули, без сборки и без npm.
Логический холст 800x600; меню, HUD и комиксы — DOM поверх канваса. Размеры/позиции окон и вёрстка
берутся из скриптов оригинала (`assets/scripts/interfaces/*.txt`), текстуры и скрипты оригинала только читаются.

## Запуск

    python3 tools/serve.py

Затем открыть http://localhost:8123/. Порт задать первым аргументом (`python3 tools/serve.py 9000`).
Сервер иногда падает — просто перезапустить. Отладочный объект в консоли: `window.__game`
(доступен ~5 с после загрузки из-за заставки).

## Структура

- `index.html`, `styles.css` — страница и стили (окна в стиле оригинала — border-image из GUI-текстур).
- `src/` — код игры:
  - `src/assets.js` — загрузка манифеста и текстур;
  - `src/audio.js` — звуки и музыка;
  - `src/comics.js` — комиксы;
  - `src/data.js` — загрузка и индексация всех скриптов игры;
  - `src/dsl.js` — парсер скриптового DSL оригинала (`@node`, `#prop`);
  - `src/endsound.js` — выбор звука конца уровня (поражение / победа / новый трофей), как в оригинале;
  - `src/goals.js` — строки целей текущего задания для верхней панели (условия `set task`, как в оригинале task1..4);
  - `src/geometry.js` — чистая геометрия без зависимостей (клетки зоны разбрызгивателя и т.п.);
  - `src/i18n_extra.js` — запасные тексты порта, которых нет в языковых паках оригинала (rus/eng);
  - `src/main.js` — загрузка, заставка, связка всего;
  - `src/menu.js` — меню, карта, трофеи, профили, настройки (DOM);
  - `src/progress.js` — прогресс, рекорды, трофеи (localStorage);
  - `src/render.js` — отрисовка уровня;
  - `src/savegame.js` — сохранение посреди уровня (сейв на игрока в localStorage);
  - `src/settings.js` — настройки в localStorage;
  - `src/sim_bees.js` — логика пчёл и ульев (вынесена из sim.js);
  - `src/sim.js` — симуляция уровня (мир, растения, животные, работники, пчёлы);
  - `src/ui.js` — HUD.
- `assets/` — ресурсы оригинала (`manifest.json`, текстуры, звуки, скрипты в UTF-8); не менять.
- `docs/` — знания и документация:
  - `docs/original-notes.md` — что восстановлено об оригинале (читать первым);
  - `docs/open-questions.md` — вопросы об оригинале и умолчания порта;
  - `docs/manual-checks.md` — ручные сценарии проверки;
  - `docs/opencode-tasks.md` — список задач.
- `tools/` — инструменты (см. ниже).

## Инструменты (`tools/`)

| Файл | Назначение |
| --- | --- |
| `serve.py` | простой статический HTTP-сервер без кэша для разработки (порт 8123) |
| `prepare_assets.py` | конвертирует ресурсы оригинала (TGA/JPEG → PNG, звук, скрипты UTF-16 → UTF-8), пишет `assets/manifest.json` |
| `extract_jpg_alpha.py` | восстанавливает-настоящий альфа-канал из .jpg-оригинала (поверх prepare_assets.py) |
| `extract_decor.py` | режет atlas `decor.jpg` на спрайты декора + `assets/decor.json` |
| `extract_bed_edges.py` | извлекает травяные кромки грядок (фон) из текстур |
| `extract_gui_window.py` | собирает рамку окна (3×3-slice) и кнопки из GUI-текстур |
| `find_jpg_alpha.py` | ищет .jpg со встроенным альфа-хвостом оригинала (read-only) |
| `analyze_jpg_alpha.py` | read-only анализ альфа-хвостов внутри .jpg-текстур (классификация; `assets/` не меняет); отчёт — `docs/jpg-alpha-report.md` |
| `gen_levels_doc.mjs` | генерирует `docs/levels.md` — справочник уровней 1..12 по скриптам оригинала (детерминированный вывод) |
| `bench_sim.mjs` | замер скорости симуляции: все 12 уровней, 1200 вызовов `update(0.1)` (ср./p95/макс. мс) + `serialize()`; код возврата всегда 0 |
| `ida/` | скрипты IDA/idalib: дизасм/декомпиляция, строки и кросс-ссылки оригинального exe (не менять) |

## Тесты

Нодные тесты без браузера (код возврата ≠ 0 при ошибках):

    node tools/test_savegame.mjs    # сохранение/загрузка посреди уровня (+ улей и пчёлы)
    node tools/test_popup.mjs       # раскладка нижней панели (вкладки магазина) по данным оригинала
    node tools/test_progress.mjs    # прогресс/рекорды/трофеи/комиксы
    node tools/test_profiles.mjs    # профили игроков
    node tools/test_settings.mjs    # настройки (localStorage)
    node tools/test_dsl.mjs         # парсер DSL на всех скриптах игры + unit-проверки
    node tools/test_texts_fallback.mjs  # цепочка запасных языков t(): язык → eng → rus → fallback → ключ
    node tools/test_sim_rules.mjs   # правила симуляции по скриптам уровня 1
    node tools/test_endsound.mjs    # выбор звука конца уровня (defeat / next_level / add_trophy)
    node tools/test_queue.mjs       # очередь целей героини (галочки), порядок, сброс кликом по героине
    node tools/test_goals.mjs       # строки целей задания («Вскопать 1/4», «Тыква - посеять 0/4»)
    node tools/test_geometry.mjs    # клетки зоны разбрызгивателя (совпадение с полным перебором)
    node tools/test_savegame_all.mjs  # сохранение/загрузка с симуляцией ввода на всех уровнях 1..12
    node tools/smoke_levels.mjs     # прогон всех 12 уровней (600 игровых секунд)

Аудиты (печатают таблицы; пропажи в rus/eng / значения, запрошенные кодом, дают код возврата ≠ 0):

    node tools/check_i18n.mjs       # локализация: ключи кода и скриптов vs 12 языковых паков (недостающие в паке покрывает цепочка t())
    node tools/check_audio.mjs      # звуки/музыка: скрипты и src vs assets/manifest.json
    node tools/check_levels.mjs     # валидатор скриптов уровней (объекты, тексты, счётчики, текстуры)
    node tools/check_modules.mjs    # статическая проверка модулей src/ (импорты/экспорты/циклы)
    node tools/check_dom.mjs        # согласованность HTML/CSS/JS: id из src vs index.html, классы vs styles.css, url()
    node tools/check_manifest.mjs   # манифест: записи → файлы на диске, литералы текстур src, неиспользуемые записи (информационно)

Результаты аудитов — в `docs/open-questions.md`. Всё, что требует браузера, — не проверено
автоматикой; сценарии ручной проверки в `docs/manual-checks.md`.

## Документация

Знания об оригинале и статус порта: `docs/original-notes.md` (в конце — «Что перенесено / что нет»).
Справочник уровней: `docs/levels.md` (генерируется `tools/gen_levels_doc.mjs`, не редактировать вручную).
Отчёт об альфа-каналах .jpg-текстур оригинала: `docs/jpg-alpha-report.md`.
