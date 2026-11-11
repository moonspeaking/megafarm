// Запасные тексты порта, которых нет в языковых паках оригинала (задача 30).
// rus — те же строки, что раньше были запасными в коде; eng — перевод порта;
// прочие языки берут eng. Если ключ появится в пиках, db.t вернёт значение пика
// (эти строки остаются только запасными).
export const EXTRA = {
  rus: {
    // menu.js: пункты интерфейса порта
    language: 'Язык',
    windowed: 'В окне',
    player: 'Фермер',
    to_menu: 'В главное меню',
    exit_web: 'Закройте вкладку браузера, чтобы выйти.',
    save_and_exit: 'Сохранить и выйти',
    new_profile: 'Новый игрок',
    delete_profile: 'Удалить игрока',
    question_delete_profile: 'Удалить игрока «%s»? Его прогресс и сохранение будут стёрты.',
    // запасное имя уровня без ключа levelN_name в паках
    level_name_fallback: 'Уровень %d',
    // ui.js: кнопка лопаты в инвентаре
    ref_time: 'Эталонное время',
    your_time: 'Ваше время',
    spade_dig: 'Лопата: копать одним кликом (нажмите ещё раз, чтобы вернуться к обычному режиму)',
    // sim.js: уведомления
    notify_plant_died: 'Растение погибло!',
    notify_worker_pay: 'Работник ждёт оплаты!',
    notify_can_empty: 'Лейка пуста! Наполните её у колонки.',
    notify_need_box: 'Возьмите ящик, чтобы собрать урожай!',
    notify_box_empty: 'Ящик пуст!',
    notify_hangar_not_accept: 'Этот ангар не принимает такой товар!',
    notify_need_can: 'Возьмите лейку!',
  },
  eng: {
    language: 'Language',
    windowed: 'Windowed',
    player: 'Farmer',
    to_menu: 'Main menu',
    exit_web: 'Close the browser tab to quit.',
    save_and_exit: 'Save and exit',
    new_profile: 'New Player',
    delete_profile: 'Delete Player',
    question_delete_profile: 'Delete player "%s"? Their progress and saves will be erased.',
    level_name_fallback: 'Level %d',
    ref_time: 'Target time',
    your_time: 'Your time',
    spade_dig: 'Shovel: dig with one click (press again to return to the normal mode)',
    notify_plant_died: 'The plant has died!',
    notify_worker_pay: 'A worker is waiting to be paid!',
    notify_can_empty: 'The watering can is empty! Fill it at the well.',
    notify_need_box: 'Take a crate to collect the harvest!',
    notify_box_empty: 'The crate is empty!',
    notify_hangar_not_accept: 'This storage building does not accept this kind of goods!',
    notify_need_can: 'Take the watering can!',
  },
};

// Текущий язык запасных текстов; sim.js не знает о настройках, поэтому
// menu.js выставляет его при старте и при смене языка.
let lang = 'rus';

export function setExtraLang(code) { lang = EXTRA[code] ? code : 'eng'; }

/** Запасной текст порта по текущему языку (прочие языки — eng). */
export function extraT(key, fallback) {
  const table = EXTRA[lang] || EXTRA.eng;
  const v = table[key];
  return v !== undefined ? v : (fallback !== undefined ? fallback : key);
}
