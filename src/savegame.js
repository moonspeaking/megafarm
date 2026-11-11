// Сохранение игры посреди уровня: один сейв на игрока (как <profile>.sav
// в оригинале), хранится в localStorage.

const PREFIX = 'megafarm.save.v1';

/** Имя localStorage-ключа сохранений игрока: профиль из настроек или явное имя. */
export function playerKey(settings, name) {
  return PREFIX + '.' + (name || settings.get('player') || 'default');
}

/** Записать снимок мира; возвращает true при успехе. */
export function saveGame(world, player) {
  try {
    localStorage.setItem(player, JSON.stringify({ version: 1, level: world.levelNum, world: world.serialize() }));
    return true;
  } catch (e) { return false; }
}

/** Прочитать сохранение игрока: { version, level, world } или null. */
export function loadSave(player) {
  try {
    const raw = localStorage.getItem(player);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}

export function clearSave(player) {
  try { localStorage.removeItem(player); } catch (e) { /* ignore */ }
}

/**
 * Автосохранение при закрытии вкладки: сохранять только посреди идущего
 * уровня (не в меню, после победы/поражения он завершён) и не затирать
 * существующий сейв другого уровня. state = { inLevel, over, paused?, level }.
 */
export function shouldAutosave(state, existingSave) {
  if (!state || !state.inLevel || state.over) return false;
  if (existingSave && existingSave.level !== state.level) return false;
  return true;
}
