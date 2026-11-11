// Имя звука конца уровня (задача 37).
// orig. sub_42F2B0: уровень с новым трофеем — add_trophy.ogg, обычная победа —
// next_level.ogg, поражение — defeat.ogg.

/**
 * @param {boolean} won — уровень пройден
 * @param {string[]|undefined} [newTrophies] — полученные трофеи
 * @returns {'defeat'|'next_level'|'add_trophy'}
 */
export function endSoundName(won, newTrophies) {
  if (!won) return 'defeat';
  return Array.isArray(newTrophies) && newTrophies.length ? 'add_trophy' : 'next_level';
}
