# What the original executable does (recovered with IDA / Hex-Rays)

Binary: `farm m.exe` (x86 PE, ~490 KB). Function names below are IDA's `sub_XXXXXX`.
`dt` in the original is `flt_482CB0` and is in **milliseconds**.

## Plants (`sub_41F2A0` update, `sub_41FAE0` init, `sub_41FB90` after harvest, `sub_41FCE0` fertilize)

All meters are 0..100 and advance once per second (level "tick" default 1000 ms).

* init: `health = start_health/100 * plant_starting_health` (level default **50**), dry = growth = fruit = 0.
* each tick
  * `dry += thirsty/100 * plant_thirst_growth` (level default **0.5**); ≥66 counts as *thirsty*.
  * growth phase: `growth += growth/100 * plant_growth(10) * (100-dry)/100`; at 100 the plant becomes mature.
  * fruit phase: `fruit += harvest/100 * plant_fruit_growth(10) * health/100`; at 100 the plant is **ready**
    (one fruit per cycle, not several).
  * fertilizer (only while in fruit phase): `health += shit_strength/100 * plant_fertilizer_strength(1)` per tick for
    `shit_time/100 * plant_fertilizer_time(10)` ticks. A weak fertilizer only works while `health < 60`.
  * if `dry == 100`: `health -= thirst_death/100 * health_reduction_when_thirsty(0.25)`, floor `plant_minimal_health` (0);
    `health == 0` while dry kills the plant.
* picking (`sub_41FB90`): ready/fruit reset; `complete_harvest` -> growth restarts from 0, otherwise it regrows fruit only;
  `health -= harvest_damage/100 * health_reduction_after_harvest(2)`.
* watering sets `dry = 0`.
* events behind scenario counters: thirsty = dry ≥ 66, `sick_plants` = health ≤ 10, `maxhealth_plant_X` = health 100.
* sprite stages: growth>10 → 1, >90 → 2, fruit>50 → 3, ready → 4 (`plant_growthN` once, then `plant_idleN`).

## Boxes
`sub_41A060(box, n)` adds `n` items if the box is not full. A plant gives **1** item and sets the box capacity to the plant's
`max_count_fruit`; houses, trees and beehives give **4** (a full box) and use capacity 4.

## Animal houses (`sub_41D510`, `sub_41D970`, `sub_41DAE0`)
* feeding needs a **full box** of the right fodder category; the box is consumed and food becomes 100.
* food drains `100/time_feed` % per second all the time; production advances `100/time_complete` % per second only while food > 0.
* a finished batch gives a full box (4 items) of the product.

## Trees (`sub_4223C0`, `sub_4227C0`)
Every tick `progress += harvest/100 * plant_fruit_growth(10)` (apple ≈ 34 s, plum 50 s, cherry 71 s, palm 133 s);
at 100 the tree is ready; picking gives a full box (4 items).

## Sprinkler (`sub_423D00`)
Every `sprinkle_frequency` ms (2000) it lowers `dry` of plants inside the ellipse (`sprinkle_radius`, in tiles) by
`sprinkle_strength` (3). It does not reset it.

## Beehive and bees (`CBeehive`, `CBeeAI` -> `sub_418E70` / `sub_404EF0`)
* Bees (`num_bees`, speed 100) fly to the nearest **ripe** flower: a plant whose `type_fruit` is `flower` (dahlia, sunflower,
  tulip) that has been ready for at least 4 ticks (`spoil` meter +25 per tick, needs 100). Without such flowers they idle.
* Each return trip adds `honey_per_bee` (1.5) percent to the honey bar; at 100 a box of 4 honey can be collected and the bar resets.

## Workers (`CWorker::sub_4256C0`, `CHarvestAI`, `CHelperAI`)
* Work counter starts at `work_time`, decremented once per second; at 0 the worker waits for payment (coin).
  A question mark means no target/path was found.
* `CHelperAI` (`sub_405110`): the helper carries a **weak fertilizer**. Target: plants that are not already being fertilised
  and have `health <= 60`, scored by `(health + 40) / 100 * distance`. It does **not** water.
* `CHarvestAI` (`sub_404960`, `sub_4052B0`, `sub_415100`): the harvester carries a box. With an empty box it picks the fruit
  type that is ripe in the largest quantity (among the types the level allows) and goes to the nearest ripe plant/tree of that
  type; with a partial box only that same type. Only a **full** box is delivered, to the nearest hangar that accepts the box's
  goods type. A half-filled box is dropped if nothing of its type exists any more.

## Still open
Hero speed and animation timings, which crops a level allows the harvester to take (`level+9992`), exact bee wing/flight visuals,
prices and level time limits.

## Level completion, records and trophies (`sub_42F2B0`, map screen handler for "level finished")
* The finished level is marked completed. If the level took no longer than its `level_time` (seconds, the bar on the HUD)
  it is **gold**: the level's trophy `#(level-1)` is granted (`trophy_hint0..11`).
* When all 12 level trophies are owned, trophy `#12` (the cup) is granted as well.
* Records per level: best time = minimum (`sub_40D160`), best money = maximum (`sub_40D1B0`); both are shown in the
  map's info window (`--:--:--` / `---` until the level is finished).
* After the level: new trophy -> trophy room with an announcement; otherwise map with the next level selected;
  after level 12 the final comics (`comics12_pack`).
* Plot flags (`CGardenPlot`): +8988 completed, +8989 gold, +8990 comics_ready, +8991 comics seen. Progress is stored
  in `<profile>.sav` / `<profile>.tro`.
* Not verified: strict level unlocking (the port opens level n after level n-1 is finished); the "Load saved game?"
  question after Start.

## Textures
The `.jpg` files carry their alpha channel after the JPEG data (`NSOGLRender.dll` `sub_10002190`):
`[jpeg][w*h alpha bytes][u32 count][0x6666]`. `tools/extract_jpg_alpha.py` restores it.

## Comics (`interfaces/comics.txt`, `sub_42DAD0`, `sub_43CC10`, `sub_40F910`)
* 13 pages: page n belongs to level n, page 13 is the finale. The page texture's alpha shapes the frames (circles).
* First "Start" of a level whose comics was not seen: comics page n first (flag +8991 "seen"), then the level
  (`index | 0x80` = "start the level afterwards"). The camera button on the map replays the page of the selected level.
* Frame: flies from `start_point` (top-left) to `end_point` with `start_angle`, `start_size`, `start_alpha`.
  A frame's first balloon shows when it lands, every click shows the next one (one at a time), then the next frame.
* Balloon `pos` is the arrow tip; the 276 px box is 13 px away from it (`lu/ru/ld/rd` = where the arrow is).
  Text is white with a dark outline on a white box. Skip button -> everything shown, then the "continue" arrow.
* After level 12 with no new trophy the finale comics (page 13) is shown.
* Boot: loader screen (`loadscreen` + `loadbar`), then the Nevosoft splash (fade 0.8 s, hold 3 s).

## Что перенесено / что нет (порт)

(Обновлено после восьмого пакета задач, 2026-11-11. Подробности и умолчания — в `docs/open-questions.md`.)

### Игровая логика
- Перенесено: меню, карта, комиксы, прогресс/рекорды/трофеи, профили игроков, настройки, сохранение посреди уровня (включая ульи/пчёл), все 12 уровней, грядки/растения/животные/работники/пчёлы, магазин/постройка/продажа, вёрстка окон по интерфейсным скриптам.
- Перенесено (пакет 4): счётчики `worker_coin`/`worker_question` (задача 21), поля `none W H` и дробные позиции разбрызгателя (задача 22), клик по грядке/растению под ногами героини (задача 27).
- Не проверено по оригиналу (безопасные умолчания): события счётчиков работников, поведение клика по самой героине, двойное значение `thirst_death` у тыквы, зона разбрызгателя при дробной позиции.

### Звук
- Перенесено: все 67 звуков манифеста там, где они задействованы; музыка экранов (в exe захардкожена так же); клики по животным/улью (`name_sfx`, `bees_sfx`), посев (`sow`), удобрение (`fert_spreader`), продажа (`profit`), покупка/размещение (`pay_shop`, `house_place`, `tree_place`, `put_*`, `take_*` — пакет 4, задача 23).
- Закрыто: озвучка комиксов в этой версии оригинала не звучит (файлов нет, задача 25); `bee_wait` в оригинале отсутствует, `check_audio` больше не считает это ошибкой (задача 24); паки по экранам не различаются (задача 26).
- Перенесено: фон уровня по `level_env` (`updateAmbient` в `src/sim.js`, оригинал `sub_415420`): трава — `birds1..4` каждые 6–12 с, болото — `swamp1`, пустыня — `desert1` каждые 20–25 с, первый звук через ~1 с.
- Перенесено по дизассемблеру (2026-11-11, см. «Hero action sounds»): `watercan` (полив героиней), `waterpump` (заправка лейки у насоса), `transporter` (кран), `add_trophy` (конец уровня с новым трофеем; без трофея — `next_level`).
- Не перенесено: `go` (виртуальный метод базового интерфейса `sub_408940`, повод не найден), `maxplayers` (есть только в списке `@sample`, кодом не запрашивается).

### Локализация
- Перенесено: 12 языковых паков, переключение языка в настройках, запасные русские тексты для отсутствующих ключей rus,
  цепочка запасных языков в `t()` (задача 39): выбранный язык → `eng` → `rus` → переданный `fallback` → сырой ключ.
  Пак `eng`/`rus` подгружается лениво только когда нужен (при языке rus/eng лишних запросов нет), смена языка сбрасывает кэш;
  пустые значения в цепочке пропускаются. Проверка: `tools/test_texts_fallback.mjs`, аудит `tools/check_i18n.mjs` помечает
  недостающие в паке ключи как «покрыто цепочкой».
- Не перенесено (и не нужно): ключи, отсутствующие во всех паках, — показываются запасным текстом или сырым ключом
  (`l66_*` уровня 0, имена объектов, text_key-пустышки скриптов; перечень — `docs/open-questions.md`).

### Графика
- Перенесено: все текстуры манифеста, извлечённая альфа 29 jpg (комиксы, декор, кромки грядок, обзорные) и ещё 30 jpg
  (задача 31: грядки `beds_dry/wet`, 24 тайла полей, HUD-панели `upbar`/`downbar`, кнопки магазина `item_shop_menu`/`shop_item`),
  GUI-окна (3×3-slice), частицы, анимации растений/героини/работников, зона разбрызгателя, бейджи лейки/пакета/ящика.
- Не перенесено: маска `mask_upbar` — портом не используется, извлечение не требуется
  (отчёт — `docs/jpg-alpha-report.md`).

## Shop tabs (`menuhost_scripts.txt` shop_form, `sub_4178C0`, `sub_417580`)
* `shop_form`/`shop_menu` is a horizontal `simple_popup` with a static `item_list` of six `tab_button`s:
  `inventory_form`, `buildings_form`, `seeds_form`, `sprouts_form` ("Plants"), `trees_form`, `workers_form`.
  No code in the exe hides a tab: all six are always shown.
* Each category has its own popup form (`<cat>_form`/`<cat>_menu`, 800x64, items `speed_button`); only `inventory_form`
  is alive at start, the others are shown when their tab is selected.
* `add to shop` (`sub_4178C0`) puts the item into the menu named after its `type_goods`, sets its price text and
  `<name>_shop_hint`; when `dword_483FD0+9972 > 1` it also shows `notify_add_shop_<name>` above the tab bar.
  `delete shop` (`sub_417580`) removes the item (and its hint) from that menu.

## Bottom panel layout (`menuhost_scripts.txt`, `CPopupMenu` `sub_4391A0`/`sub_439500`/`sub_439100`, `CTextElement` `sub_4331E0`)
Coordinates of forms/children: origin = centre of the parent, y up (verified: upmenu_form pos y=268, timebar (-167, 9)).
Verified on a screenshot of the original (2x scale, English tabs): every number below agrees to within 1 px.
* **Panel**: `popup_window` 800x64 at y=-268 (centre y=568); its `center` bitmap is 800x78 with texcoord (0, 0.39)-(1, 1)
  of `downbar` (rows 50..127) and is centred, so the lowest 7 rows fall off the screen: the visible panel is
  y = 529..600 (71 px), the gold line lies at texture row 56.
* **Items** (`inventory_menu` and the other five): `CPopupMenu` 800x100 at (0, -3) -> centre y=571; `speed_button` 58x58,
  margin 0, centred in a row (`x0 = (m+w0)/2 - total/2`), so the boxes occupy y = 542..600 (flush with the screen edge)
  and a row of 10 starts at x=110. The item `image` fills the whole button (58x58, texture scaled), `price` text is
  17 px below the centre (y = 588). More than 13 items overflow: items whose centre is past the right edge get
  disabled (`sub_439100`: `enabled = popupRight > item.x`).
* **Which item goes to which tab**: by `type_goods` = the menu name (`seeds`, `sprouts`, `buildings`, `trees`, `workers`,
  `inventory`); `plants` (placed plants) and `personal` (hero, waterboy) have no menu and are not sold. Button picture =
  plain `<item name>.tga` (`sub_439500`), never the environment variant (`grass_house_chicken` is the big sprite).
* **Tabs** (`shop_form`/`shop_menu`): popup 800x32 at y=-220 (centre y=520, so tabs span y = 504..536), `margin 32`.
  `tab_button` is a `checkbox` of height 32 whose width = **text width** (`CTextElement autosize true`:
  parent width = sum of glyph advances * font_size, `sub_429FA0`); `caption` is `font_size 12` at 4 px below the centre.
  Glyph advance table: `fonts/<font>.dat` = u16 texW, u16 texH, u16 cell, u16 0, then 65536 {u16 adv, u16 code};
  `table[code] = adv * 2 / (texW / cell)`; font per language: chn/jap/kor have their own, the rest use `uni`
  (`config_scripts.txt`). Example (English): SUPPLIES 73, BUILDINGS 87, SEEDS 49, PLANTS 61, TREES 48, WORKERS 79 px.
* The tab bitmaps: centre piece stretched over the body width, 16 px caps *outside* the body (`pos -16`), so tabs of
  stride `w + 32` touch each other. Unchecked 32 high; checked 64 high, shifted 13 px down (y = 501..565): it is 3 px taller
  than the others at the top and its lower half blends into the panel. Click area stays the 32 px checkbox.
* The row is laid out as the popup code says: total = sum(w) + 5*32, the first body starts at `-total/2 + margin/2`
  from the centre. All six tabs fit for all 12 languages; a tab that did not fit would be disabled.
* Port: `src/fontmetrics.js` (`layoutPopup`, `textWidth`), `buildTabs` in `src/ui.js`, `tools/test_popup.mjs`.
  Our caption uses a web font, so it is stretched horizontally (`scaleX`) to the width the bitmap font would have.
  There are no tool slots (the spade and the held item are visible on the hero).

## Plant animation (`sub_41F2A0` plant update, `CAnimationEl` `sub_432210`/`sub_432B50`, `CSpriteElement` `sub_4329E0`)
* Stage (`+9576`) only moves one step up per game tick: 0->1 growth>10, 1->2 growth>90, 2->3 fruit progress>50,
  3->4 ready. Every step sends `plant_growth<N>`; a harvest with `complete_harvest` resets the stage to 0 else to 3.
* Animation request `plant_idle<stage>` is sent on every update. `CSpriteElement::setAnimation` (`sub_4329E0`)
  ignores a request while the current animation is still playing, so `plant_growth<N>` plays once and then
  `plant_idle<N>` restarts itself every time it ends (= a loop with its own clock per plant).
* `CAnimationEl`: frame time = 1000/`frame_per_second` ms; at the last frame it stays "finished" (no loop of its own;
  property `random` would replay it every 8 s).
* **Sheet geometry**: a frame is exactly as large as the sprite element (`size`, e.g. pumpkin 62x49), columns =
  `floor(texW / frameW)`, and the texture rectangle of frame i is `x = col*fw + 1 .. (col+1)*fw`,
  `y = row*fh + 1 .. (row+1)*fh` (1 px inset left/top). Sheets are 1024 wide (16 columns of 62 px for the pumpkin).

## Particles (`particle_scripts.txt`, spawn `sub_409B00`, update `CParticle` `sub_408DE0`)
* Spawn: `sub_409B00(x, y, count, template, owner)`; every value is `base + random(-scatter, scatter)`.
  Position = (x, y) + a point at radius `pos_scatter` in a random direction; direction random when `start_dir` is
  absent, speed = `start_speed` + scatter; size/size_speed/angle/angle_speed likewise; colour channels = `color` +
  `color_scatter` clamped to 0..255; colour speeds = `color_speed` + `color_speed_scatter` (r, g, b, a).
  `texture_num` is a cell of the 8x8 particle sheet (`texture_num % 8`, `/ 8`); `blending` = additive.
* Update (times in ms, y up): `pos += vel*dt; vel += gravity*dt; size += size_speed*dt` (dies at 0),
  `angle += angle_speed*dt`; r/g/b move by their speed and **bounce** at 0/255; alpha dies at 0.
* A ripe plant (`sub_41F2A0`) plays `ready_plant.ogg` and spawns `fruit_ready` x50 at (x, y + 32): white/yellow
  twinkling stars (cell 33), size 32 shrinking by 0.07/ms, gravity 0.0005/ms^2.

## Beds (`CSquare`, vtable 0x463754, draw `sub_420E40`, init `sub_4213F0`)
* Every dug cell is a `CSquare`; it is drawn **72x72** (the 64 px cell x 1.125, so neighbours overlap by 4 px) with a
  random variant 0..3 chosen once: frame `variant` of `beds_dry` / `beds_wet` (256x64 = four 64 px frames).
* Draw order: top / left / right grass strips, dry bed, wet bed, fertilizer overlay, bottom grass strip.
  Strips exist on the sides without a dug neighbour (flags `+9564` top, `+9565` left, `+9566` right, `+9567` bottom).
  `<env>_bed_ud` (128x256, rows of 32): top uses row `variant`, bottom row `variant+4`, 96x32 centred on x, centres at
  top-12 (above) / bottom+0; `<env>_bed_lr` (256x128, columns of 32): left uses column `variant`, right `variant+4`, 32x96,
  centred at left-10 / right+10; UVs are inset by 0.0039 (1 px).
* Wet overlay alpha = `(100 - plant.dry) * 2.55`; a bed **without a plant is fully wet** (brown), the dry (yellow)
  texture only shows under a thirsty plant.
* Fertilizer overlay `fertilizer_on_bad1|2` (random 1..2) over the whole square, alpha = ticks left / total ticks.

## Field border (`CGameField`, vtable 0x46153c, draw `sub_412220`, init `sub_412FD0`)
* The field is `gridW*64 x gridH*64`; the outer **128 px (2 cells)** are a decorative border, level content starts at
  cell 2 (level scripts use coords >= 2). Inner rect = `(W-256) x (H-256)`.
* Draw order: centre tile (512 px, repeated, scaled by `(H+128)/H` vertically, starting 64 px above the field);
  `down_center`, `up_center` (128 px high, u = 0..W/512 across the inner width), `left_center`, `right_center`
  (128 px wide, v = 0..H/512 across the inner height); corners `left_up`, `right_up`, `left_down`, `right_down`
  (128x128) in the corners; finally the decor layer (`decor`).
* Decor (`sub_411E60` count, `sub_412BE0` filling): `int(gridW*gridH/33)` quads of 64x64, each centred at a
  uniformly random point of the whole field (the border included), sprite = cell of the 8x8 `decor` sheet:
  grass `rand(18)` (0..17), desert `24 + rand(13)`, swamp `40 + rand(10)`; drawn as part of the field, i.e. under beds,
  plants and objects, with no check against objects or the hero.
* Textures are `<env>_*` jpgs with embedded alpha (see Textures); the border shows a wooden fence (grass) /
  bone-like fence (swamp).

## Sprinkler zone (`CWaterSprinkler` `sub_4239C0`, update `sub_423D00`)
* `sprinkle_radius` (cells, e.g. 4.5, 2.5) is an ellipse: every 64 px cell with `(dx/rx)^2 + (dy/ry)^2 <= 1` is watered
  (strength per `sprinkle_frequency` ms). The zone is drawn as one `wcircle` tile (64x64, blue, translucent) per such cell.
* It is drawn while the sprinkler has no parent (it is being carried after the purchase: centred on the cell under the
  cursor) or while its hover flag (+8729) is set (mouse over a placed one). Port: `drawSprinklerZone` in `src/render.js`.
* A placed sprinkler **spins all the time**: `sub_423D00` requests `water_sprinkler_work` (32 frames, 24 fps) on every update and
  `CSpriteElement::setAnimation` lets a running animation finish, so it restarts by itself; `water_sprinkler_stop` is only the
  initial animation. The carried one is drawn the same way on the cell under the cursor (`drawSprinklerGhost`).

## Buying, placing and selling sounds (`sub_416670` placement click, `sub_41AC00` sale)
* **Every purchase except a patent** (items, buildings, trees, sprinklers, workers) is attached to the cursor; the player
  picks a cell and clicks - the hero does not walk there. Only then the price is taken, `pay_shop.ogg` plays, then the sound of
  the type (`house_place` houses/hangars, `tree_place`, `put_sprinkler`, `put_box`, `put_bag` seeds/fertilizer, `put_watercan`)
  and 50 `object_bought` particles appear on the object. Seeds, cans, boxes and fertilizer lie on the ground afterwards and the
  hero picks them up by a click. A second click on the same shop button (or the right mouse button) cancels the selection at no
  cost; a patent is an order paid at the click. Port: `pending`, `placePending` in `src/sim.js`, ghost in `src/render.js`.
* Selling goods in a hangar plays `profit.ogg`; `pay.ogg` is only for paying a worker.

## Movement of the hero and the workers (`CMover` `sub_403C00`, `sub_402A40`, `sub_401A30`, `sub_401D00`)
* **No grid path-finding.** A click adds a waypoint (`sub_402A40`, queue of up to 256, 20 bytes each) at the target point itself
  (for an object: its dock/target point); it must lie inside the field rectangle, otherwise `notify_you_cant_gowhere`.
* Speed: script `speed` (300) * 0.00105 = 0.315 px/ms = 315 px/s **horizontally and half of it vertically**: the heading is the
  normalised vector to the target, the step is `(nx * S, ny * S / 2) * dt`. When `|step| >= distance` the actor snaps to the
  waypoint and the next one starts. Workers use the very same code (the vtable slots are shared).
* **Obstacles**: the actor is an ellipse (`base_radius` 2x2); a step is blocked when it overlaps the base ellipse
  (`base_center`/`base_radius`) of a solid object, test `((dx)/(r1x+r2x))^2 + ((dy)/(r1y+r2y))^2 <= 1` (`sub_4014F0`). Then the heading is
  rotated in 5 degree steps to one side (side chosen at the first contact, kept for 2 frames after) until it is free, so the actor
  slides round the object; inside the dock zone of the object it walks to, the base ellipse does not block.
* **Facing for animations**: every 100 ms `index = floor(angle / 45 + 0.5) % 8` of the heading with y UP: 0 right, 1 up-right,
  2 up (back view), 3 up-left, 4 left, 5 down-left, 6 down (front view), 7 down-right; `hero_walk<i>`, `hero_carry_*<i>`, `<worker>_walk<i>`.
  (Our earlier mapping was rotated by a quarter turn.)
* Idle animations: `hero_idle1` with a 1/10 chance of `hero_idle2`; holding a can/seed/box uses `hero_idle_<item>`.
* Port: `moveActor`, `solidObstacles`, `walkToPoint`, `dirIndex` in `src/sim.js`; A* (`findPath`) and the per-frame `unstickHero` are gone.

## Hero action sounds (`sub_4031F0`, hero state switch; `sub_416670`, `sub_42F2B0`)
* The hero's state machine plays the sound when the state starts: take (2: `take_box`/`take_watercan`/`take_bag` by item type),
  put (3/4: `put_box`/`put_watercan`/`put_bag`), 5 `dig`, 6 `sow`, 7 `watercan.ogg`, 8 harvest (`harvest_plant/tree/beehive`,
  animal by house type), 10 `fertilizer` (helper) / `fert_spreader`, 11 `waterpump.ogg`, 12/13 `put_box`, 14 feed_<animal>,
  15 `killplant`, 17 `pay`. States 7 and 11 are inferred as «water a plant» and «fill the can at the pump» (the only two water
  states; no direct caller found). `watering_sfx` is NOT a hero sound: it is the sprinkler's `name_sfx`.
* The crane (`sub_416670`, two branches: pick up / pay for the move) plays `transporter.ogg`; the destructor plays `killplant.ogg`.
* Level end (`sub_42F2B0`): a new trophy -> `add_trophy.ogg` and the trophy room; otherwise `next_level.ogg` (map or finale comics).
* `go.ogg`: only in the base interface virtual method `sub_408940` (stores a target interface name and dispatches message 4/10);
  trigger not identified. `maxplayers.ogg` is listed in `@sample` but never requested by code.

## Sound packs (`soundhost_scripts.txt`, `sub_408C50`) and level ambient (`sub_415420`, задача 26)
* Each interface script (`loader/intro/menu/gamemap/gameplay/comics/credits/trophyroom.txt`) declares
  `#string sound_pack "…"`. The parser (`sub_408C50`, a property vtable slot) stores the string in a script
  object field (+4376); **no read of that field exists in the exe** (no `[reg+1118h]` anywhere) — the sound
  pack name is parsed and effectively ignored.
* `soundhost_scripts.txt` defines a single pack `@main_pack`: `@music` and `@url` are empty, `@sample`
  holds every effect (including `birds1..4.ogg`, `swamp1.ogg`, `desert1.ogg`), `@stream` holds the six
  music files (`music_menu/comics/map/trophy/mix/credits.ogg`). So the per-screen pack names
  (menu_pack, gamemap_pack, …) do not exist and the sound content does not differ between screens.
* Per-screen music is **hardcoded** in the exe screen handlers: menu → `music_menu.ogg` (`sub_43ED40`),
  map → `music_map.ogg` (`sub_43C550`), gameplay → `music_mix.ogg` (`sub_43D020`), comics →
  `music_comics.ogg` (`sub_43C2C0`), credits → `music_credits.ogg` (`sub_43C45F`), trophy room →
  `music_trophy.ogg` (`sub_440510`). Loader/intro have no music. This is what the port already does.
* **Level ambient** (`sub_415420`, gameplay host update; the check runs once per accumulated second):
  by the level's `level_env` (`this+9798`):
  * `grass`: every 6–12 s (`flt_483FD8 = -(6000*rand + 6000)` ms) plays `birds<rand()%4 + 1>.ogg`
    (birds1..4, random pick), volume 1.0, no loop;
  * `swamp`: every 20–25 s (`-(5000*rand + 20000)`) plays `swamp1.ogg`;
  * `desert`: every 20–25 s plays `desert1.ogg`.
  Playback `sub_429240` is the BASS channel call (volume 1.0, pan 0, 44100). The first sound plays ~1 s
  after the level starts. Not tied to `sound_pack` in any way. Port: `updateAmbient` in `src/sim.js` (timer is not saved; `tools/test_sim_rules.mjs`).

## Hero animations that depend on the can (`sub_41C140`, `sub_41BF80`)
* Small orange can (`watercan`): `hero_take_watercan2`, `hero_put_watercan2`, `hero_water2`, `hero_idle_watercan`, `hero_carry_watercan<i>`.
  Big blue can (`big_watercan`): `hero_take_watercan1`, `hero_put_watercan1`, `hero_water1`, `hero_idle_big_watercan`,
  `hero_carry_big_watercan<i>`. Using one set for both made the can change colour while it was taken/put.
* **Water in the can / seeds in a packet** (`CWatercan` `sub_423280`, packet `sub_420870`): while the object's highlight flag
  (+8729) is set - the hero sets it every frame for the item he carries, the mouse sets it for a lying one - it draws a
  32x32 icon at (-16, +48) from its position and the text ` x<count>` (white, size 12) at (+16, +48). The can uses the
  blue drop (icons.tga cell 27), a packet its `seed_icon_num`. A carried item sits 100 px above the hero's feet.
  Port: `drawCountBadge`, `drawObjectBadge` in `src/render.js`. `sub_405C50(x, y, w, h, cell, n, cols, gap, filled, total)` draws `n` icons
  in rows of `cols`, centred on (x, y) from the object's position (y up); the first `filled/total*n` are normal, the rest are
  tinted 0xA0808080. So the can/packet badge is the icon centred at (-16, +48) and the text centred at (+16, +48).
* **Fruit box** (`CBox` `sub_419B20`, hero `sub_41B470`): highlighted (carried, or under the mouse) it draws 4 icons of its fruit
  (32 px, row centred at +48, `count` bright, rest dim); carried: 100 px above the feet. Besides that the contents are a pile
  of fruit: frame `PILE_BASE[iconNum % 25] + (count == 4 ? 8 : 0) + slot` (cells < 256 of icons.tga, >= 256 of icons_ex.tga), on
  the hero at the offset `PILE_OFF[slot]` from his feet, slot = `(14 - dir) % 8` while walking and 0 standing; on a box lying on
  the ground slot 2 at (+2, +14). Port: `drawFruitRow`, `drawPile`, `drawBoxContents`.