const DEFAULTS = { icsUrls: [], tracked: [], widgetCollapsed: false };
const WEEKS_BACK = 4;

let state = { ...DEFAULTS };
const $ = (id) => document.getElementById(id);

const save = async (patch) => {
  Object.assign(state, patch);
  await chrome.storage.sync.set(patch);
  render();
};

const maskUrl = (url) => {
  try {
    const tail = url.split('/ical/')[1] || url;
    return `…${tail.slice(0, 18)}…`;
  } catch {
    return url.slice(0, 24);
  }
};

const fmtH = (h) => (Math.round(h * 10) / 10).toString();

const weekLabel = (ts) => {
  const start = new Date(ts);
  const end = new Date(ts);
  end.setDate(end.getDate() + 6);
  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(start)} – ${fmt(end)}`;
};

const renderChips = (el, items, label, onRemove) => {
  el.textContent = '';
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = label;
    el.appendChild(empty);
    return;
  }
  items.forEach((item, i) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const text = document.createElement('span');
    text.textContent = typeof item === 'string' ? maskUrl(item) : `${item.name}${item.target ? ` · ${item.target}h` : ''}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.addEventListener('click', () => onRemove(i));
    chip.append(text, remove);
    el.appendChild(chip);
  });
};

const render = () => {
  const configured = state.icsUrls.length > 0;
  $('setup').hidden = configured;
  $('statsSection').hidden = !configured;
  $('trackedSection').hidden = !configured;
  $('calendarsSection').hidden = !configured;

  renderChips($('trackedChips'), state.tracked, 'Nothing tracked yet — add an event name below', (i) =>
    save({ tracked: state.tracked.filter((_, j) => j !== i) })
  );
  renderChips($('urlChips'), state.icsUrls, '', (i) =>
    save({ icsUrls: state.icsUrls.filter((_, j) => j !== i) })
  );
};

const renderStats = (occurrences) => {
  const cards = $('cards');
  cards.textContent = '';
  if (!state.tracked.length) return;

  for (const { name, target } of state.tracked) {
    const rows = CalHours.weeklyHours(occurrences, name, WEEKS_BACK);
    const current = rows[rows.length - 1];
    const past = rows.slice(0, -1);
    const avg = past.reduce((s, r) => s + r.hours, 0) / Math.max(past.length, 1);
    const max = Math.max(...rows.map((r) => r.hours), target || 0, 1);

    const card = document.createElement('div');
    card.className = 'card';

    const top = document.createElement('div');
    top.className = 'card-top';
    const title = document.createElement('strong');
    title.textContent = name;
    const value = document.createElement('span');
    value.className = 'value';
    value.textContent = target
      ? `${fmtH(current.hours)} / ${target}h this week`
      : `${fmtH(current.hours)}h this week`;
    if (target && current.hours >= target) value.classList.add('hit');
    top.append(title, value);
    card.appendChild(top);

    const barWrap = document.createElement('div');
    barWrap.className = 'bar';
    const fill = document.createElement('div');
    fill.className = 'fill';
    const pct = target ? Math.min(100, (current.hours / target) * 100) : (current.hours / max) * 100;
    fill.style.width = `${pct}%`;
    if (target && current.hours >= target) fill.classList.add('hit');
    barWrap.appendChild(fill);
    card.appendChild(barWrap);

    const history = document.createElement('div');
    history.className = 'history';
    for (const row of past) {
      const item = document.createElement('span');
      item.title = weekLabel(row.weekTs);
      item.textContent = `${fmtH(row.hours)}h`;
      history.appendChild(item);
    }
    const avgEl = document.createElement('span');
    avgEl.className = 'avg';
    avgEl.textContent = `avg ${fmtH(avg)}h`;
    history.appendChild(avgEl);
    card.appendChild(history);

    cards.appendChild(card);
  }
};

const refresh = async () => {
  if (!state.icsUrls.length || !state.tracked.length) {
    $('status').textContent = state.icsUrls.length ? 'Add an event name to track' : '';
    return;
  }
  $('status').textContent = 'Loading calendar…';
  const { from, to } = CalHours.range(WEEKS_BACK);
  try {
    const texts = await Promise.all(
      state.icsUrls.map((u) => fetch(u).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      }))
    );
    const occurrences = texts.flatMap((t) => CalHours.expandICS(t, from, to));
    renderStats(occurrences);
    $('status').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch (e) {
    $('status').textContent = `Couldn't load calendar (${e.message}) — check the URL`;
  }
};

$('urlForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = $('urlInput').value.trim();
  if (!url.startsWith('https://')) return;
  await save({ icsUrls: [...state.icsUrls, url] });
  $('urlInput').value = '';
  refresh();
});

$('moreUrlForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = $('moreUrlInput').value.trim();
  if (!url.startsWith('https://') || state.icsUrls.includes(url)) return;
  await save({ icsUrls: [...state.icsUrls, url] });
  $('moreUrlInput').value = '';
  refresh();
});

$('trackedForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('nameInput').value.trim().toLowerCase();
  const target = Number($('targetInput').value) || 0;
  if (!name || state.tracked.some((t) => t.name === name)) return;
  await save({ tracked: [...state.tracked, { name, target }] });
  $('nameInput').value = '';
  $('targetInput').value = '';
  refresh();
});

const init = async () => {
  state = await chrome.storage.sync.get(DEFAULTS);
  $('version').textContent = `v${chrome.runtime.getManifest().version}`;
  render();
  refresh();
};

init();
