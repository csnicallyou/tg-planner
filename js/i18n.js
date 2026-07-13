const dict = {
  ru: {
    today: 'Сегодня', week: 'Неделя', notes: 'Заметки', goals: 'Цели', stats: 'Статистика',
    settings: 'Настройки',
    add_task_ph: 'Новая задача…', inbox: 'Входящие (без даты)', no_tasks: 'Задач нет',
    all_done: 'Всё выполнено!', done_of: 'выполнено',
    task: 'Задача', new_task: 'Новая задача', title_ph: 'Название…',
    date: 'Дата', no_date: 'Без даты', priority: 'Приоритет',
    p_none: 'Нет', p_low: 'Низкий', p_med: 'Средний', p_high: 'Высокий',
    repeat: 'Повтор', r_none: 'Нет', r_daily: 'Ежедневно', r_weekly: 'Еженедельно', r_monthly: 'Ежемесячно',
    tags_lbl: 'Теги', subtasks: 'Подзадачи', add_subtask: 'Добавить подзадачу…',
    description: 'Описание', desc_ph: 'Детали…',
    save: 'Сохранить', delete: 'Удалить', cancel: 'Отмена', close: 'Закрыть',
    start_focus: '▶ Фокус', confirm_delete: 'Удалить безвозвратно?',
    note: 'Заметка', new_note: 'Новая заметка', notes_search: 'Поиск…',
    note_title_ph: 'Заголовок…', note_body_ph: 'Текст заметки…',
    pin: 'Закрепить', no_notes: 'Заметок пока нет',
    month: 'Месяц', year: 'Год', new_goal: 'Новая цель', goal: 'Цель',
    goal_title_ph: 'Чего хочешь достичь…', steps: 'Шаги', add_step: 'Добавить шаг…', no_goals: 'Целей пока нет',
    streak: 'Стрик', days_sfx: 'дн.', completed_today: 'Сегодня', completed_week: 'За неделю',
    completed_month: 'За месяц', total_done: 'Всего', last14: 'Последние 14 дней', by_tag: 'По тегам',
    language: 'Язык', theme: 'Тема', th_auto: 'Авто', th_light: 'Светлая', th_dark: 'Тёмная',
    carry_over: 'Переносить невыполненное на сегодня',
    pomodoro: 'Помодоро', work_min: 'Работа, мин', break_min: 'Перерыв, мин',
    manage_tags: 'Теги', new_tag_ph: 'Новый тег…',
    data: 'Данные', export_data: 'Экспорт', import_data: 'Импорт',
    export_hint: 'Скопируй и сохрани как бэкап:',
    import_hint: 'Вставь JSON бэкапа (заменит текущие данные):', apply: 'Применить',
    storage_lbl: 'Хранилище', storage_cloud: 'Telegram Cloud', storage_local: 'Локально (браузер)',
    focus_done: 'Фокус завершён! Перерыв?', break_done: 'Перерыв окончен!',
    week_of: 'Неделя', tasks_cnt: 'задач', import_bad: 'Некорректный JSON',
    imported: 'Данные импортированы', overdue: 'Просрочено',
  },
  en: {
    today: 'Today', week: 'Week', notes: 'Notes', goals: 'Goals', stats: 'Stats',
    settings: 'Settings',
    add_task_ph: 'New task…', inbox: 'Inbox (no date)', no_tasks: 'No tasks',
    all_done: 'All done!', done_of: 'done',
    task: 'Task', new_task: 'New task', title_ph: 'Title…',
    date: 'Date', no_date: 'No date', priority: 'Priority',
    p_none: 'None', p_low: 'Low', p_med: 'Medium', p_high: 'High',
    repeat: 'Repeat', r_none: 'None', r_daily: 'Daily', r_weekly: 'Weekly', r_monthly: 'Monthly',
    tags_lbl: 'Tags', subtasks: 'Subtasks', add_subtask: 'Add subtask…',
    description: 'Description', desc_ph: 'Details…',
    save: 'Save', delete: 'Delete', cancel: 'Cancel', close: 'Close',
    start_focus: '▶ Focus', confirm_delete: 'Delete permanently?',
    note: 'Note', new_note: 'New note', notes_search: 'Search…',
    note_title_ph: 'Title…', note_body_ph: 'Note text…',
    pin: 'Pin', no_notes: 'No notes yet',
    month: 'Month', year: 'Year', new_goal: 'New goal', goal: 'Goal',
    goal_title_ph: 'What do you want to achieve…', steps: 'Steps', add_step: 'Add step…', no_goals: 'No goals yet',
    streak: 'Streak', days_sfx: 'd', completed_today: 'Today', completed_week: 'This week',
    completed_month: 'This month', total_done: 'Total', last14: 'Last 14 days', by_tag: 'By tag',
    language: 'Language', theme: 'Theme', th_auto: 'Auto', th_light: 'Light', th_dark: 'Dark',
    carry_over: 'Carry unfinished tasks to today',
    pomodoro: 'Pomodoro', work_min: 'Work, min', break_min: 'Break, min',
    manage_tags: 'Tags', new_tag_ph: 'New tag…',
    data: 'Data', export_data: 'Export', import_data: 'Import',
    export_hint: 'Copy and keep as a backup:',
    import_hint: 'Paste backup JSON (replaces current data):', apply: 'Apply',
    storage_lbl: 'Storage', storage_cloud: 'Telegram Cloud', storage_local: 'Local (browser)',
    focus_done: 'Focus finished! Break time?', break_done: 'Break is over!',
    week_of: 'Week of', tasks_cnt: 'tasks', import_bad: 'Invalid JSON',
    imported: 'Data imported', overdue: 'Overdue',
  },
};

let lang = 'en';

export function setLang(l) { lang = dict[l] ? l : 'en'; }
export function getLang() { return lang; }
export function t(key) { return dict[lang][key] ?? dict.en[key] ?? key; }

export function detectLang() {
  const tgLang = window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
  const nav = navigator.language || '';
  return (tgLang || nav).toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

// date helpers, locale-aware
export function fmtDayLong(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return new Intl.DateTimeFormat(lang, { weekday: 'long' }).format(d);
}
export function fmtDate(dateStr, opts = { day: 'numeric', month: 'long' }) {
  const d = new Date(dateStr + 'T00:00:00');
  return new Intl.DateTimeFormat(lang, opts).format(d);
}
export function fmtWeekdayShort(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return new Intl.DateTimeFormat(lang, { weekday: 'short' }).format(d);
}
export function fmtMonthYear(ym) {
  const d = new Date(ym + '-01T00:00:00');
  return new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' }).format(d);
}
