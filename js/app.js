import { loadCollection, queueSave, flushSaves, cloudAvailable } from './storage.js';
import { t, setLang, getLang, detectLang, fmtDate, fmtDayLong, fmtWeekdayShort, fmtMonthYear } from './i18n.js';

const tg = window.Telegram?.WebApp;

// ===== state =====
const state = {
  tasks: [],
  notes: [],
  goals: [],
  tags: [],
  settings: { lang: 'auto', theme: 'auto', carryOver: true, pomoWork: 25, pomoBreak: 5 },
};
let view = 'today';
let curDate = isoToday();
let weekAnchor = isoToday();
let goalScope = 'month';
let goalPeriod = currentPeriod('month');
let noteQuery = '';
let pomo = null; // {taskId, title, mode:'work'|'break', endsAt, paused, remainMs}
let pomoTimer = null;

const TAG_COLORS = ['#5b7cfa', '#e5646e', '#4cbf8b', '#e8a952', '#9b6bfa', '#3fb6c9', '#e574b5', '#7a8699'];

// ===== date utils =====
function isoToday() { return toISO(new Date()); }
function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toISO(d);
}
function weekStart(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const shift = (d.getDay() + 6) % 7; // Monday first
  d.setDate(d.getDate() - shift);
  return toISO(d);
}
function currentPeriod(scope) {
  return scope === 'month' ? isoToday().slice(0, 7) : isoToday().slice(0, 4);
}
function shiftPeriod(period, n) {
  if (period.length === 4) return String(parseInt(period, 10) + n);
  const d = new Date(period + '-01T00:00:00');
  d.setMonth(d.getMonth() + n);
  return toISO(d).slice(0, 7);
}
function uid() { return crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2); }

// ===== persistence =====
const save = {
  tasks: () => queueSave('tasks', () => state.tasks),
  notes: () => queueSave('notes', () => state.notes),
  goals: () => queueSave('goals', () => state.goals),
  tags: () => queueSave('tags', () => state.tags),
  settings: () => queueSave('settings', () => state.settings),
};

// ===== recurring / task queries =====
function occursOn(task, dateStr) {
  if (!task.recur) return task.date === dateStr;
  if (!task.date || dateStr < task.date) return false;
  const d = new Date(dateStr + 'T00:00:00');
  const start = new Date(task.date + 'T00:00:00');
  if (task.recur.freq === 'daily') return true;
  if (task.recur.freq === 'weekly') return d.getDay() === start.getDay();
  if (task.recur.freq === 'monthly') return d.getDate() === start.getDate();
  return false;
}
function isDone(task, dateStr) {
  return task.recur ? !!(task.recurDone && task.recurDone[dateStr]) : !!task.done;
}
function tasksFor(dateStr) {
  const list = state.tasks.filter(tk => occursOn(tk, dateStr));
  return sortTasks(list, dateStr);
}
function sortTasks(list, dateStr) {
  return list.slice().sort((a, b) =>
    (isDone(a, dateStr) - isDone(b, dateStr)) || ((b.priority || 0) - (a.priority || 0)) || (a.createdAt - b.createdAt));
}
function toggleDone(task, dateStr) {
  if (task.recur) {
    task.recurDone = task.recurDone || {};
    if (task.recurDone[dateStr]) delete task.recurDone[dateStr];
    else task.recurDone[dateStr] = Date.now();
  } else {
    task.done = !task.done;
    task.doneAt = task.done ? dateStr : null;
  }
  if (isDone(task, dateStr)) haptic('success');
  save.tasks();
}
function carryOver() {
  if (!state.settings.carryOver) return;
  const today = isoToday();
  let moved = false;
  for (const tk of state.tasks) {
    if (!tk.recur && tk.date && tk.date < today && !tk.done) { tk.date = today; moved = true; }
  }
  if (moved) save.tasks();
}

// ===== stats =====
function completionsByDate() {
  const map = {};
  for (const tk of state.tasks) {
    if (tk.recur) {
      for (const d of Object.keys(tk.recurDone || {})) { (map[d] = map[d] || []).push(tk); }
    } else if (tk.done && tk.doneAt) {
      (map[tk.doneAt] = map[tk.doneAt] || []).push(tk);
    }
  }
  return map;
}
function streak(map) {
  let d = isoToday(), n = 0;
  if (!map[d]) d = addDays(d, -1); // today can still be in progress
  while (map[d] && map[d].length) { n++; d = addDays(d, -1); }
  return n;
}

// ===== haptics / popups =====
function haptic(type) {
  try {
    if (type === 'success') tg?.HapticFeedback?.notificationOccurred('success');
    else tg?.HapticFeedback?.impactOccurred('light');
  } catch { /* older clients */ }
}
function popup(msg) {
  try { tg?.showAlert ? tg.showAlert(msg) : alert(msg); } catch { alert(msg); }
}
// window.confirm is blocked inside some Telegram webviews — use showConfirm there.
function ask(msg, onYes) {
  try {
    if (tg?.showConfirm) { tg.showConfirm(msg, ok => { if (ok) onYes(); }); return; }
  } catch { /* fall through */ }
  if (confirm(msg)) onYes();
}

// ===== theme / lang =====
function applyTheme() {
  const s = state.settings.theme;
  const scheme = s === 'auto'
    ? (tg?.colorScheme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))
    : s;
  document.documentElement.dataset.theme = scheme;
  const bg = scheme === 'dark' ? '#23262d' : '#e3e9f2';
  try { tg?.setHeaderColor?.(bg); tg?.setBackgroundColor?.(bg); } catch { /* older clients */ }
}
function applyLang() {
  setLang(state.settings.lang === 'auto' ? detectLang() : state.settings.lang);
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
}

// ===== dom helpers =====
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    el.append(c.nodeType ? c : document.createTextNode(c));
  }
  return el;
}
const $view = () => document.getElementById('view');

function icon(id) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ic');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#' + id);
  svg.append(use);
  return svg;
}

// ===== rendering =====
function render() {
  applyLang();
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.getElementById('view-title').textContent = t(view);
  const root = $view();
  root.innerHTML = '';
  if (view === 'today') renderToday(root);
  else if (view === 'week') renderWeek(root);
  else if (view === 'notes') renderNotes(root);
  else if (view === 'goals') renderGoals(root);
  else if (view === 'stats') renderStats(root);
}

// ---- today ----
function renderToday(root) {
  const today = isoToday();
  root.append(h('div', { class: 'datestrip' },
    h('button', { class: 'neo-btn', onclick: () => { curDate = addDays(curDate, -1); render(); } }, '‹'),
    h('div', { class: 'date-label' },
      h('div', { class: 'dl-main' }, fmtDate(curDate)),
      h('div', { class: 'dl-sub' }, fmtDayLong(curDate))),
    curDate !== today
      ? h('button', { class: 'chip-today', onclick: () => { curDate = today; render(); } }, t('today'))
      : null,
    h('button', { class: 'neo-btn', onclick: () => { curDate = addDays(curDate, 1); render(); } }, '›'),
  ));

  const list = tasksFor(curDate);
  const done = list.filter(tk => isDone(tk, curDate)).length;
  if (list.length) {
    const pct = Math.round(done / list.length * 100);
    root.append(h('div', { class: 'neo day-progress' },
      h('div', { class: 'dp-row' }, h('span', {}, `${done} / ${list.length} ${t('done_of')}`), h('span', {}, pct + '%')),
      h('div', { class: 'neo-inset progress' }, h('div', { class: 'fill', style: `width:${pct}%` })),
    ));
  }

  const input = h('input', { placeholder: t('add_task_ph'), enterkeyhint: 'done' });
  const addTask = () => {
    const title = input.value.trim();
    if (!title) return;
    state.tasks.push({ id: uid(), title, date: curDate, priority: 0, tags: [], subtasks: [], notes: '', recur: null, done: false, createdAt: Date.now() });
    input.value = '';
    save.tasks(); haptic(); render();
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') addTask(); });
  root.append(h('div', { class: 'quickadd' },
    h('div', { class: 'neo-inset qa-input' }, input),
    h('button', { class: 'neo-btn qa-btn', onclick: addTask }, '+')));

  const listEl = h('div', { class: 'task-list' });
  if (!list.length) {
    listEl.append(h('div', { class: 'empty' }, t('no_tasks'), h('span', { class: 'hint' }, t('no_tasks_hint'))));
  } else {
    list.forEach(tk => listEl.append(taskCard(tk, curDate)));
    if (done === list.length) listEl.append(h('div', { class: 'empty small' }, t('all_done')));
  }
  root.append(listEl);

  const inbox = sortTasks(state.tasks.filter(tk => !tk.date && !tk.recur), curDate);
  if (inbox.length) {
    root.append(h('div', { class: 'section-title' }, `${t('inbox')} · ${inbox.length}`));
    const inboxEl = h('div', { class: 'task-list' });
    inbox.forEach(tk => inboxEl.append(taskCard(tk, curDate)));
    root.append(inboxEl);
  }
}

function taskCard(task, dateStr) {
  const done = isDone(task, dateStr);
  const meta = [];
  if (task.priority) meta.push(h('span', { class: 'meta-chip' }, h('span', { class: `prio-dot prio-${task.priority}` }), t(['p_none', 'p_low', 'p_med', 'p_high'][task.priority])));
  if (task.recur) meta.push(h('span', { class: 'meta-chip' }, icon('i-repeat'), t('r_' + task.recur.freq)));
  for (const tagId of task.tags || []) {
    const tag = state.tags.find(x => x.id === tagId);
    if (tag) meta.push(h('span', { class: 'meta-chip tag-chip', style: `background:${tag.color}` }, tag.name));
  }
  if (task.subtasks?.length) {
    const sd = task.subtasks.filter(s => s.done).length;
    meta.push(h('span', { class: 'sub-progress' },
      h('span', { class: 'neo-inset progress' }, h('div', { class: 'fill', style: `width:${Math.round(sd / task.subtasks.length * 100)}%` })),
      `${sd}/${task.subtasks.length}`));
  }
  return h('div', { class: 'neo task-card' + (done ? ' done' : '') },
    h('button', {
      class: 'task-check' + (done ? ' checked' : ''),
      onclick: e => { e.stopPropagation(); toggleDone(task, dateStr); render(); },
    }, icon('i-check')),
    h('div', { class: 'task-body', onclick: () => taskEditor(task) },
      h('div', { class: 'task-title' }, task.title),
      meta.length ? h('div', { class: 'task-meta' }, meta) : null));
}

// ---- week ----
function renderWeek(root) {
  const start = weekStart(weekAnchor);
  root.append(h('div', { class: 'datestrip' },
    h('button', { class: 'neo-btn', onclick: () => { weekAnchor = addDays(start, -7); render(); } }, '‹'),
    h('div', { class: 'date-label' },
      h('div', { class: 'dl-main' }, `${t('week_of')} ${fmtDate(start, { day: 'numeric', month: 'short' })} – ${fmtDate(addDays(start, 6), { day: 'numeric', month: 'short' })}`)),
    h('button', { class: 'neo-btn', onclick: () => { weekAnchor = addDays(start, 7); render(); } }, '›'),
  ));
  const listEl = h('div', { class: 'week-list' });
  const today = isoToday();
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    const tasks = tasksFor(d);
    const done = tasks.filter(tk => isDone(tk, d)).length;
    const pct = tasks.length ? Math.round(done / tasks.length * 100) : 0;
    const preview = tasks.slice(0, 3).map(tk =>
      h('div', { class: isDone(tk, d) ? 'done' : '' }, '· ' + tk.title));
    listEl.append(h('div', {
      class: 'neo week-day' + (d === today ? ' today-row' : ''),
      onclick: () => { curDate = d; view = 'today'; render(); },
    },
      h('div', { class: 'wd-head' },
        h('span', { class: 'wd-name' }, fmtWeekdayShort(d), h('span', { class: 'wd-date' }, fmtDate(d, { day: 'numeric', month: 'short' }))),
        h('span', { class: 'wd-count' }, tasks.length ? `${done}/${tasks.length}` : '—')),
      h('div', { class: 'neo-inset progress' }, h('div', { class: 'fill', style: `width:${pct}%` })),
      preview.length ? h('div', { class: 'wd-preview' }, preview) : null));
  }
  root.append(listEl);
}

// ---- notes ----
function renderNotes(root) {
  const input = h('input', { placeholder: t('notes_search'), value: noteQuery });
  input.addEventListener('input', () => { noteQuery = input.value; renderNotesList(listWrap); });
  root.append(h('div', { class: 'quickadd' },
    h('div', { class: 'neo-inset searchbar', style: 'margin-bottom:0;flex:1' }, icon('i-search'), input),
    h('button', { class: 'neo-btn qa-btn', onclick: () => noteEditor(null) }, '+')));
  const listWrap = h('div', { class: 'notes-grid' });
  renderNotesList(listWrap);
  root.append(listWrap);
}
function renderNotesList(wrap) {
  wrap.innerHTML = '';
  const q = noteQuery.trim().toLowerCase();
  let notes = state.notes.filter(n => !q || n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q));
  notes = notes.sort((a, b) => (b.pinned - a.pinned) || (b.updatedAt - a.updatedAt));
  if (!notes.length) {
    wrap.append(h('div', { class: 'empty' }, t('no_notes'), h('span', { class: 'hint' }, t('no_notes_hint'))));
    return;
  }
  for (const n of notes) {
    wrap.append(h('div', { class: 'neo note-card', onclick: () => noteEditor(n) },
      h('div', { class: 'note-head' },
        n.pinned ? icon('i-pin') : null,
        h('div', { class: 'note-title' }, n.title || '…')),
      n.body ? h('div', { class: 'note-snippet' }, n.body) : null,
      h('div', { class: 'note-date' }, new Date(n.updatedAt).toLocaleDateString(getLang()))));
  }
}

// ---- goals ----
function renderGoals(root) {
  const seg = h('div', { class: 'neo-inset seg' },
    h('button', { class: goalScope === 'month' ? 'active' : '', onclick: () => { goalScope = 'month'; goalPeriod = currentPeriod('month'); render(); } }, t('month')),
    h('button', { class: goalScope === 'year' ? 'active' : '', onclick: () => { goalScope = 'year'; goalPeriod = currentPeriod('year'); render(); } }, t('year')));
  root.append(seg);
  root.append(h('div', { class: 'datestrip' },
    h('button', { class: 'neo-btn', onclick: () => { goalPeriod = shiftPeriod(goalPeriod, -1); render(); } }, '‹'),
    h('div', { class: 'date-label' }, h('div', { class: 'dl-main' }, goalScope === 'month' ? fmtMonthYear(goalPeriod) : goalPeriod)),
    h('button', { class: 'neo-btn', onclick: () => { goalPeriod = shiftPeriod(goalPeriod, 1); render(); } }, '›')));

  const goals = state.goals.filter(g => g.scope === goalScope && g.period === goalPeriod);
  if (!goals.length) root.append(h('div', { class: 'empty' }, t('no_goals'), h('span', { class: 'hint' }, t('no_goals_hint'))));
  for (const g of goals) {
    const doneSteps = g.steps.filter(s => s.done).length;
    const pct = g.steps.length ? Math.round(doneSteps / g.steps.length * 100) : (g.done ? 100 : 0);
    const stepsEl = h('div', { class: 'goal-steps' });
    for (const s of g.steps) {
      stepsEl.append(h('div', { class: 'goal-step' + (s.done ? ' done' : '') },
        h('button', {
          class: 'task-check' + (s.done ? ' checked' : ''),
          onclick: () => { s.done = !s.done; if (s.done) haptic('success'); save.goals(); render(); },
        }, icon('i-check')),
        h('span', {}, s.title)));
    }
    root.append(h('div', { class: 'neo goal-card' },
      h('div', { class: 'goal-head', onclick: () => goalEditor(g) },
        h('div', { class: 'goal-title' }, g.title),
        h('span', { class: 'goal-pct' }, pct + '%')),
      g.steps.length ? stepsEl : null,
      h('div', { class: 'neo-inset progress' }, h('div', { class: 'fill', style: `width:${pct}%` }))));
  }
  root.append(h('button', {
    class: 'neo-btn accent', style: 'width:100%;padding:13px;margin-top:14px;border-radius:14px;font-weight:700',
    onclick: () => goalEditor(null),
  }, '+ ' + t('new_goal')));
}

// ---- stats ----
function renderStats(root) {
  const map = completionsByDate();
  const today = isoToday();
  const ws = weekStart(today);
  const count = pred => Object.entries(map).filter(([d]) => pred(d)).reduce((n, [, arr]) => n + arr.length, 0);
  const totals = {
    today: (map[today] || []).length,
    week: count(d => d >= ws && d <= today),
    month: count(d => d.slice(0, 7) === today.slice(0, 7)),
    all: count(() => true),
  };
  root.append(h('div', { class: 'stat-grid' },
    h('div', { class: 'neo stat-card streak' }, h('div', { class: 'st-num' }, '🔥 ' + streak(map)), h('div', { class: 'st-lbl' }, t('streak') + ', ' + t('days_sfx'))),
    h('div', { class: 'neo stat-card' }, h('div', { class: 'st-num' }, totals.today), h('div', { class: 'st-lbl' }, t('completed_today'))),
    h('div', { class: 'neo stat-card' }, h('div', { class: 'st-num' }, totals.week), h('div', { class: 'st-lbl' }, t('completed_week'))),
    h('div', { class: 'neo stat-card' }, h('div', { class: 'st-num' }, totals.month), h('div', { class: 'st-lbl' }, t('completed_month')))));

  // 14-day chart
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const max = Math.max(1, ...days.map(d => (map[d] || []).length));
  root.append(h('div', { class: 'section-title' }, t('last14')));
  root.append(h('div', { class: 'neo chart' },
    h('div', { class: 'chart-bars' }, days.map(d => {
      const v = (map[d] || []).length;
      return h('div', { class: 'chart-col' },
        h('div', { class: 'chart-bar-wrap' }, h('div', { class: 'chart-bar', style: `height:${Math.round(v / max * 100)}%` })),
        h('span', { class: 'chart-lbl' }, d.slice(8)));
    }))));

  // by tag
  const tagCount = {};
  for (const arr of Object.values(map)) for (const tk of arr) for (const tagId of tk.tags || []) tagCount[tagId] = (tagCount[tagId] || 0) + 1;
  const rows = Object.entries(tagCount)
    .map(([id, n]) => ({ tag: state.tags.find(x => x.id === id), n }))
    .filter(r => r.tag).sort((a, b) => b.n - a.n).slice(0, 6);
  if (rows.length) {
    const maxN = rows[0].n;
    root.append(h('div', { class: 'section-title' }, t('by_tag')));
    const box = h('div', { class: 'neo', style: 'padding:8px 14px' });
    for (const r of rows) {
      box.append(h('div', { class: 'tagstat-row' },
        h('span', { class: 'tagstat-name' }, h('span', { class: 'prio-dot', style: `background:${r.tag.color}` }), r.tag.name),
        h('div', { class: 'neo-inset progress' }, h('div', { class: 'fill', style: `width:${Math.round(r.n / maxN * 100)}%;background:${r.tag.color}` })),
        h('span', { class: 'small muted' }, r.n)));
    }
    root.append(box);
  }
}

// ===== modals =====
function openModal(title, ...content) {
  const root = document.getElementById('modal-root');
  const close = () => { backdrop.remove(); };
  const backdrop = h('div', { class: 'modal-backdrop', onclick: e => { if (e.target === backdrop) close(); } },
    h('div', { class: 'modal-sheet' },
      h('div', { class: 'modal-title' }, title, h('button', { class: 'neo-btn modal-close', onclick: close }, '✕')),
      ...content));
  root.innerHTML = '';
  root.append(backdrop);
  return close;
}

function field(labelText, inputEl, cls = '') {
  return h('div', { class: 'field ' + cls },
    h('div', { class: 'field-label' }, labelText),
    h('div', { class: 'neo-inset field-input' }, inputEl));
}

// ---- task editor ----
function taskEditor(task) {
  const isNew = !task;
  const tk = task || { id: uid(), title: '', date: curDate, priority: 0, tags: [], subtasks: [], notes: '', recur: null, done: false, createdAt: Date.now() };
  const draft = JSON.parse(JSON.stringify(tk));

  const titleIn = h('input', { placeholder: t('title_ph'), value: draft.title });
  const dateIn = h('input', { type: 'date', value: draft.date || '' });
  const prioChips = h('div', { class: 'chips' }, [0, 1, 2, 3].map(p =>
    h('button', {
      class: 'chip' + (draft.priority === p ? ' sel' : ''),
      onclick: e => { draft.priority = p; [...e.target.parentNode.children].forEach((c, i) => c.classList.toggle('sel', i === p)); },
    }, t(['p_none', 'p_low', 'p_med', 'p_high'][p]))));
  const recurSel = h('select', {},
    ['none', 'daily', 'weekly', 'monthly'].map(f => {
      const o = h('option', { value: f }, t(f === 'none' ? 'r_none' : 'r_' + f));
      if ((draft.recur?.freq || 'none') === f) o.selected = true;
      return o;
    }));
  const tagChips = h('div', { class: 'chips' }, state.tags.map(tag => {
    const sel = draft.tags.includes(tag.id);
    return h('button', {
      class: 'chip' + (sel ? ' tag-sel' : ''),
      style: sel ? `background:${tag.color}` : '',
      onclick: e => {
        const i = draft.tags.indexOf(tag.id);
        if (i >= 0) { draft.tags.splice(i, 1); e.target.classList.remove('tag-sel'); e.target.style.background = ''; }
        else { draft.tags.push(tag.id); e.target.classList.add('tag-sel'); e.target.style.background = tag.color; }
      },
    }, tag.name);
  }));
  const descIn = h('textarea', { rows: 3, placeholder: t('desc_ph') });
  descIn.value = draft.notes || '';

  const subList = h('div', { class: 'sub-edit-list' });
  const renderSubs = () => {
    subList.innerHTML = '';
    draft.subtasks.forEach((s, i) => {
      const inp = h('input', { value: s.title });
      inp.addEventListener('input', () => { s.title = inp.value; });
      subList.append(h('div', { class: 'sub-edit-row' },
        h('button', {
          class: 'task-check' + (s.done ? ' checked' : ''),
          onclick: e => { s.done = !s.done; e.target.classList.toggle('checked', s.done); },
        }, icon('i-check')),
        h('div', { class: 'neo-inset field-input' }, inp),
        h('button', { class: 'neo-btn sub-del', onclick: () => { draft.subtasks.splice(i, 1); renderSubs(); } }, '✕')));
    });
    const addIn = h('input', { placeholder: t('add_subtask'), enterkeyhint: 'done' });
    addIn.addEventListener('keydown', e => {
      if (e.key === 'Enter' && addIn.value.trim()) {
        draft.subtasks.push({ id: uid(), title: addIn.value.trim(), done: false });
        renderSubs();
        subList.querySelector('.sub-edit-row:last-of-type input')?.focus?.();
      }
    });
    subList.append(h('div', { class: 'sub-edit-row' }, h('div', { class: 'neo-inset field-input' }, addIn)));
  };
  renderSubs();

  const actions = h('div', { class: 'modal-actions' });
  if (!isNew) {
    actions.append(h('button', {
      class: 'neo-btn btn-danger', onclick: () => ask(t('confirm_delete'), () => {
        state.tasks = state.tasks.filter(x => x.id !== tk.id);
        save.tasks(); close(); render();
      }),
    }, t('delete')));
    actions.append(h('button', { class: 'neo-btn accent', style: 'flex:0 0 auto;padding:13px 16px', onclick: () => { startPomo(tk); close(); } }, t('start_focus')));
  }
  actions.append(h('button', {
    class: 'neo-btn accent', onclick: () => {
      draft.title = titleIn.value.trim();
      if (!draft.title) return;
      draft.date = dateIn.value || null;
      draft.notes = descIn.value;
      const freq = recurSel.value;
      draft.recur = freq === 'none' ? null : { freq };
      if (draft.recur && !draft.date) draft.date = isoToday();
      Object.assign(tk, draft);
      if (isNew) state.tasks.push(tk);
      save.tasks(); close(); render();
    },
  }, t('save')));

  const close = openModal(isNew ? t('new_task') : t('task'),
    field(t('task'), titleIn),
    h('div', { class: 'field-row' },
      field(t('date'), dateIn),
      field(t('repeat'), recurSel)),
    h('div', { class: 'field' }, h('div', { class: 'field-label' }, t('priority')), prioChips),
    state.tags.length ? h('div', { class: 'field' }, h('div', { class: 'field-label' }, t('tags_lbl')), tagChips) : null,
    h('div', { class: 'field' }, h('div', { class: 'field-label' }, t('subtasks')), subList),
    field(t('description'), descIn),
    actions);
}

// ---- note editor ----
function noteEditor(note) {
  const isNew = !note;
  const n = note || { id: uid(), title: '', body: '', pinned: false, createdAt: Date.now(), updatedAt: Date.now() };
  const titleIn = h('input', { placeholder: t('note_title_ph'), value: n.title });
  const bodyIn = h('textarea', { rows: 8, placeholder: t('note_body_ph') });
  bodyIn.value = n.body;
  let pinned = n.pinned;
  const pinBtn = h('button', {
    class: 'chip' + (pinned ? ' sel' : ''),
    onclick: e => { pinned = !pinned; e.target.classList.toggle('sel', pinned); },
  }, t('pin'));

  const actions = h('div', { class: 'modal-actions' });
  if (!isNew) actions.append(h('button', {
    class: 'neo-btn btn-danger', onclick: () => ask(t('confirm_delete'), () => {
      state.notes = state.notes.filter(x => x.id !== n.id);
      save.notes(); close(); render();
    }),
  }, t('delete')));
  actions.append(h('button', {
    class: 'neo-btn accent', onclick: () => {
      n.title = titleIn.value.trim();
      n.body = bodyIn.value;
      if (!n.title && !n.body) { close(); return; }
      n.pinned = pinned;
      n.updatedAt = Date.now();
      if (isNew) state.notes.push(n);
      save.notes(); close(); render();
    },
  }, t('save')));

  const close = openModal(isNew ? t('new_note') : t('note'),
    field(t('note'), titleIn),
    h('div', { class: 'field' }, h('div', { class: 'neo-inset field-input' }, bodyIn)),
    h('div', { class: 'chips', style: 'margin-bottom:4px' }, pinBtn),
    actions);
}

// ---- goal editor ----
function goalEditor(goal) {
  const isNew = !goal;
  const g = goal || { id: uid(), title: '', scope: goalScope, period: goalPeriod, steps: [], done: false, createdAt: Date.now() };
  const draft = JSON.parse(JSON.stringify(g));
  const titleIn = h('input', { placeholder: t('goal_title_ph'), value: draft.title });

  const stepList = h('div', { class: 'sub-edit-list' });
  const renderSteps = () => {
    stepList.innerHTML = '';
    draft.steps.forEach((s, i) => {
      const inp = h('input', { value: s.title });
      inp.addEventListener('input', () => { s.title = inp.value; });
      stepList.append(h('div', { class: 'sub-edit-row' },
        h('div', { class: 'neo-inset field-input' }, inp),
        h('button', { class: 'neo-btn sub-del', onclick: () => { draft.steps.splice(i, 1); renderSteps(); } }, '✕')));
    });
    const addIn = h('input', { placeholder: t('add_step'), enterkeyhint: 'done' });
    addIn.addEventListener('keydown', e => {
      if (e.key === 'Enter' && addIn.value.trim()) {
        draft.steps.push({ id: uid(), title: addIn.value.trim(), done: false });
        renderSteps();
      }
    });
    stepList.append(h('div', { class: 'sub-edit-row' }, h('div', { class: 'neo-inset field-input' }, addIn)));
  };
  renderSteps();

  const actions = h('div', { class: 'modal-actions' });
  if (!isNew) actions.append(h('button', {
    class: 'neo-btn btn-danger', onclick: () => ask(t('confirm_delete'), () => {
      state.goals = state.goals.filter(x => x.id !== g.id);
      save.goals(); close(); render();
    }),
  }, t('delete')));
  actions.append(h('button', {
    class: 'neo-btn accent', onclick: () => {
      draft.title = titleIn.value.trim();
      if (!draft.title) return;
      Object.assign(g, draft);
      if (isNew) state.goals.push(g);
      save.goals(); close(); render();
    },
  }, t('save')));

  const close = openModal(isNew ? t('new_goal') : t('goal'),
    field(t('goal'), titleIn),
    h('div', { class: 'field' }, h('div', { class: 'field-label' }, t('steps')), stepList),
    actions);
}

// ---- settings ----
function settingsModal() {
  const s = state.settings;
  const mkToggle = (val, onchange) => {
    const el = h('button', { class: 'toggle' + (val ? ' on' : '') }, h('span', { class: 'knob' }));
    el.addEventListener('click', () => { const on = !el.classList.contains('on'); el.classList.toggle('on', on); onchange(on); });
    return el;
  };
  const mkSeg = (opts, cur, onchange) => h('div', { class: 'neo-inset seg', style: 'margin-bottom:0' },
    opts.map(([v, lbl]) => h('button', {
      class: cur === v ? 'active' : '',
      onclick: e => { [...e.target.parentNode.children].forEach(c => c.classList.remove('active')); e.target.classList.add('active'); onchange(v); },
    }, lbl)));

  const langSeg = mkSeg([['auto', t('th_auto')], ['ru', 'RU'], ['en', 'EN']], s.lang, v => { s.lang = v; save.settings(); refresh(); });
  const themeSeg = mkSeg([['auto', t('th_auto')], ['light', t('th_light')], ['dark', t('th_dark')]], s.theme, v => { s.theme = v; save.settings(); applyTheme(); });
  const refresh = () => { close(); render(); settingsModal(); };

  const workIn = h('input', { type: 'number', min: 1, max: 120, value: s.pomoWork });
  workIn.addEventListener('change', () => { s.pomoWork = Math.max(1, parseInt(workIn.value, 10) || 25); save.settings(); });
  const breakIn = h('input', { type: 'number', min: 1, max: 60, value: s.pomoBreak });
  breakIn.addEventListener('change', () => { s.pomoBreak = Math.max(1, parseInt(breakIn.value, 10) || 5); save.settings(); });

  // tags manager
  const tagBox = h('div', {});
  const renderTags = () => {
    tagBox.innerHTML = '';
    state.tags.forEach((tag, i) => {
      const nameIn = h('input', { value: tag.name });
      nameIn.addEventListener('change', () => { tag.name = nameIn.value.trim() || tag.name; save.tags(); });
      tagBox.append(h('div', { class: 'tagman-row' },
        h('button', {
          class: 'tagman-dot', style: `background:${tag.color}`,
          onclick: () => { tag.color = TAG_COLORS[(TAG_COLORS.indexOf(tag.color) + 1) % TAG_COLORS.length]; save.tags(); renderTags(); },
        }),
        h('div', { class: 'neo-inset field-input tagman-name', style: 'padding:8px 12px' }, nameIn),
        h('button', {
          class: 'neo-btn sub-del', onclick: () => {
            state.tags.splice(i, 1);
            state.tasks.forEach(tk => { tk.tags = (tk.tags || []).filter(id => id !== tag.id); });
            save.tags(); save.tasks(); renderTags();
          },
        }, '✕')));
    });
    const addIn = h('input', { placeholder: t('new_tag_ph'), enterkeyhint: 'done' });
    addIn.addEventListener('keydown', e => {
      if (e.key === 'Enter' && addIn.value.trim()) {
        state.tags.push({ id: uid(), name: addIn.value.trim(), color: TAG_COLORS[state.tags.length % TAG_COLORS.length] });
        save.tags(); renderTags();
      }
    });
    tagBox.append(h('div', { class: 'tagman-row' }, h('div', { class: 'neo-inset field-input', style: 'flex:1;padding:8px 12px' }, addIn)));
  };
  renderTags();

  // export / import
  const dataBox = h('div', {},
    h('div', { class: 'modal-actions', style: 'margin-top:6px' },
      h('button', { class: 'neo-btn', onclick: showExport }, t('export_data')),
      h('button', { class: 'neo-btn', onclick: showImport }, t('import_data'))));
  function showExport() {
    const payload = JSON.stringify({ tasks: state.tasks, notes: state.notes, goals: state.goals, tags: state.tags, settings: state.settings });
    const ta = h('textarea', { class: 'export-area', readonly: true });
    ta.value = payload;
    openModal(t('export_data'), h('div', { class: 'small muted', style: 'margin-bottom:10px' }, t('export_hint')),
      h('div', { class: 'neo-inset field-input' }, ta));
    ta.focus(); ta.select();
  }
  function showImport() {
    const ta = h('textarea', { class: 'export-area' });
    const c2 = openModal(t('import_data'),
      h('div', { class: 'small muted', style: 'margin-bottom:10px' }, t('import_hint')),
      h('div', { class: 'neo-inset field-input' }, ta),
      h('div', { class: 'modal-actions' }, h('button', {
        class: 'neo-btn accent', onclick: () => {
          try {
            const data = JSON.parse(ta.value);
            state.tasks = data.tasks || [];
            state.notes = data.notes || [];
            state.goals = data.goals || [];
            state.tags = data.tags || [];
            Object.assign(state.settings, data.settings || {});
            Object.values(save).forEach(fn => fn());
            c2(); applyTheme(); render(); popup(t('imported'));
          } catch { popup(t('import_bad')); }
        },
      }, t('apply'))));
  }

  const close = openModal(t('settings'),
    h('div', { class: 'set-row' }, h('span', { class: 'set-lbl' }, t('language')), langSeg),
    h('div', { class: 'set-row' }, h('span', { class: 'set-lbl' }, t('theme')), themeSeg),
    h('div', { class: 'set-row' },
      h('span', { class: 'set-lbl' }, t('carry_over')),
      mkToggle(s.carryOver, v => { s.carryOver = v; save.settings(); })),
    h('div', { class: 'section-title' }, t('pomodoro')),
    h('div', { class: 'set-row' },
      h('span', { class: 'set-lbl' }, t('work_min')),
      h('div', { class: 'neo-inset num-input' }, workIn)),
    h('div', { class: 'set-row' },
      h('span', { class: 'set-lbl' }, t('break_min')),
      h('div', { class: 'neo-inset num-input' }, breakIn)),
    h('div', { class: 'section-title' }, t('manage_tags')),
    tagBox,
    h('div', { class: 'section-title' }, t('data')),
    h('div', { class: 'set-row small muted' },
      h('span', {}, t('storage_lbl')),
      h('span', {}, cloudAvailable ? t('storage_cloud') : t('storage_local'))),
    dataBox);
}

// ===== pomodoro =====
function startPomo(task) {
  pomo = { taskId: task.id, title: task.title, mode: 'work', endsAt: Date.now() + state.settings.pomoWork * 60000, paused: false, remainMs: 0 };
  runPomoTimer();
  renderPomoBar();
}
function runPomoTimer() {
  clearInterval(pomoTimer);
  pomoTimer = setInterval(() => {
    if (!pomo || pomo.paused) return;
    if (Date.now() >= pomo.endsAt) {
      haptic('success');
      if (pomo.mode === 'work') {
        popup(t('focus_done'));
        pomo.mode = 'break';
        pomo.endsAt = Date.now() + state.settings.pomoBreak * 60000;
      } else {
        popup(t('break_done'));
        stopPomo();
        return;
      }
    }
    renderPomoBar();
  }, 1000);
}
function stopPomo() {
  pomo = null;
  clearInterval(pomoTimer);
  renderPomoBar();
}
function renderPomoBar() {
  const bar = document.getElementById('pomobar');
  if (!pomo) { bar.classList.add('hidden'); return; }
  const ms = pomo.paused ? pomo.remainMs : Math.max(0, pomo.endsAt - Date.now());
  const mm = String(Math.floor(ms / 60000)).padStart(2, '0');
  const ss = String(Math.floor(ms % 60000 / 1000)).padStart(2, '0');
  bar.classList.remove('hidden');
  bar.classList.toggle('break', pomo.mode === 'break');
  bar.innerHTML = '';
  bar.append(
    h('span', { class: 'pb-dot' }),
    h('span', { class: 'pb-time' }, `${mm}:${ss}`),
    h('span', { class: 'pb-task' }, pomo.title),
    h('button', {
      class: 'neo-btn', onclick: () => {
        if (pomo.paused) { pomo.endsAt = Date.now() + pomo.remainMs; pomo.paused = false; }
        else { pomo.remainMs = Math.max(0, pomo.endsAt - Date.now()); pomo.paused = true; }
        renderPomoBar();
      },
    }, pomo.paused ? '▶' : '⏸'),
    h('button', { class: 'neo-btn', onclick: stopPomo }, '⏹'));
}

// ===== boot =====
// UI comes up immediately; data hydrates asynchronously. A hung storage
// backend must never leave the app dead (seen on Telegram iOS).
function boot() {
  window.addEventListener('error', e => console.error('uncaught:', e.message));
  window.addEventListener('unhandledrejection', e => console.error('unhandled:', e.reason));
  try { tg?.ready(); tg?.expand(); } catch { /* browser dev mode */ }

  applyTheme();
  tg?.onEvent?.('themeChanged', applyTheme);

  document.querySelectorAll('.nav-btn').forEach(b =>
    b.addEventListener('click', () => { view = b.dataset.view; haptic(); render(); }));
  document.getElementById('btn-settings').addEventListener('click', settingsModal);
  document.getElementById('btn-theme').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme;
    state.settings.theme = cur === 'dark' ? 'light' : 'dark';
    save.settings(); applyTheme();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushSaves(); });

  render();
  hydrate().catch(e => console.error('hydrate failed', e));
}

async function hydrate() {
  const [tasks, notes, goals, tags, settings] = await Promise.all([
    loadCollection('tasks', []),
    loadCollection('notes', []),
    loadCollection('goals', []),
    loadCollection('tags', null),
    loadCollection('settings', null),
  ]);
  state.tasks = tasks;
  state.notes = notes;
  state.goals = goals;
  state.tags = tags || [
    { id: uid(), name: detectLang() === 'ru' ? 'Работа' : 'Work', color: TAG_COLORS[0] },
    { id: uid(), name: detectLang() === 'ru' ? 'Личное' : 'Personal', color: TAG_COLORS[2] },
  ];
  if (settings) Object.assign(state.settings, settings);
  if (!tags) save.tags();

  applyTheme();
  carryOver();
  render();
}

boot();
