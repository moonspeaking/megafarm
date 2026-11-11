#!/usr/bin/env node
// Тесты src/endsound.js (задача 37): чистая функция endSoundName(won, newTrophies)
// выбирает звук конца уровня, как orig. sub_42F2B0: поражение — defeat, победа
// с новым трофеем — add_trophy, победа без трофеев — next_level.
// Проверяет 6+ комбинаций и тип возвращаемого значения.
// Запуск: node tools/test_endsound.mjs (код возврата != 0 при ошибках).

import { endSoundName } from '../src/endsound.js';

let failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`ок: ${msg}`); return; }
  console.error(`ОШИБКА: ${msg}`);
  failed++;
}

// --- поражение: трофеи не важны
check(endSoundName(false, undefined) === 'defeat', 'поражение без трофеев → defeat');
check(endSoundName(false, ['trophy_level1']) === 'defeat', 'поражение с трофеем → defeat');
check(endSoundName(false, []) === 'defeat', 'поражение с пустым массивом → defeat');

// --- победа без трофеев
check(endSoundName(true, undefined) === 'next_level', 'победа, trophies undefined → next_level');
check(endSoundName(true, []) === 'next_level', 'победа, пустой массив → next_level');

// --- победа с новым трофеем
check(endSoundName(true, ['trophy_level1']) === 'add_trophy', 'победа с одним трофеем → add_trophy');
check(endSoundName(true, ['trophy_level1', 'trophy_level2']) === 'add_trophy',
  'победа с несколькими трофеями → add_trophy');

// --- результат всегда одно из трёх допустимых имён
const valid = new Set(['defeat', 'next_level', 'add_trophy']);
for (const won of [false, true]) {
  for (const trophies of [undefined, [], ['t1'], ['t1', 't2']]) {
    const name = endSoundName(won, trophies);
    check(valid.has(name), `комбинация (won=${won}, trophies=${JSON.stringify(trophies)}) → допустимое имя «${name}»`);
  }
}

if (failed) {
  console.error(`\nПРОВАЛЕНО: ${failed}`);
  process.exit(1);
}
console.log('\nВсе тесты endSoundName прошли.');
