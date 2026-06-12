// source '' = not chosen yet: page-reading by default, unless the user had
// already configured feed URLs before this option existed.
const DEFAULTS = { icsUrls: [], tracked: [], widgetCollapsed: false, source: '' };
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

const agoText = (ts) => {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

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
    chip.title = typeof item === 'string' ? item : item.name;
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
  const configured = state.source === 'dom' || state.icsUrls.length > 0;
  $('setup').hidden = configured;
  $('statsSection').hidden = !configured;
  $('trackedSection').hidden = !configured;
  $('calendarsSection').hidden = !configured || state.source === 'dom';
  $('domSection').hidden = !configured || state.source !== 'dom';

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
    const over = target && current.hours > target ? current.hours - target : 0;
    const under = target && current.hours < target ? target - current.hours : 0;

    const card = document.createElement('div');
    card.className = 'card';

    const top = document.createElement('div');
    top.className = 'card-top';
    const title = document.createElement('strong');
    title.textContent = name;
    const value = document.createElement('span');
    value.className = 'value';
    const delta = over ? ` · +${fmtH(over)}h over` : under ? ` · −${fmtH(under)}h` : '';
    value.textContent = target
      ? `${fmtH(current.hours)} / ${target}h this week${delta}`
      : `${fmtH(current.hours)}h this week`;
    if (target && current.hours >= target) value.classList.add('hit');
    if (over) value.classList.add('over');
    if (under) value.classList.add('under');
    top.append(title, value);
    card.appendChild(top);

    const barWrap = document.createElement('div');
    barWrap.className = 'bar';
    const fill = document.createElement('div');
    fill.className = 'fill';
    const pct = target ? Math.min(100, (current.hours / target) * 100) : (current.hours / max) * 100;
    fill.style.width = `${pct}%`;
    if (target && current.hours >= target) fill.classList.add('hit');
    if (over) fill.classList.add('over');
    if (under) fill.classList.add('under');
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
  if (state.source === 'dom') {
    if (!state.tracked.length) {
      $('status').textContent = 'Add an event name to track';
      return;
    }
    const { gttDomWeeks = {}, gttDomWeeksAt = 0 } = await chrome.storage.local.get([
      'gttDomWeeks',
      'gttDomWeeksAt',
    ]);
    const occurrences = Object.values(gttDomWeeks)
      .flat()
      .map((o) => ({ start: new Date(o.s), end: new Date(o.e), summary: o.m }));
    renderStats(occurrences);
    $('status').textContent = gttDomWeeksAt
      ? `Google data updated ${agoText(gttDomWeeksAt)}`
      : 'Open calendar.google.com (week view) or hit "Refresh from Google"';
    return;
  }
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
    chrome.storage.local.set({
      lastStats: { occ: occurrences.map((o) => ({ s: +o.start, e: +o.end, m: o.summary })) },
    });
    $('status').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch (e) {
    const msg = String(e.message || e);
    $('status').textContent = /404/.test(msg)
      ? 'Google returned 404 — you likely copied the Public address. Remove it (×) and use "Secret address in iCal format" (contains /private-…/)'
      : `Couldn't load calendar (${msg}) — check the URL`;
  }
};

const addUrl = async (raw, inputEl) => {
  // Google copies sometimes come as webcal:// and with stray whitespace.
  const url = raw.trim().replace(/^webcal:\/\//i, 'https://');
  if (!/^https:\/\/.+\.ics(\?.*)?$/i.test(url)) {
    $('status').textContent = 'That doesn\'t look like an .ics address — copy "Secret address in iCal format"';
    return;
  }
  if (url.includes('/public/')) {
    $('status').textContent =
      'That\'s the PUBLIC address (404 unless the calendar is public). Copy "Secret address in iCal format" — it contains /private-…/';
    return;
  }
  if (state.icsUrls.includes(url)) return;
  await save({ icsUrls: [...state.icsUrls, url] });
  inputEl.value = '';
  refresh();
};

$('urlForm').addEventListener('submit', (e) => {
  e.preventDefault();
  addUrl($('urlInput').value, $('urlInput'));
});

$('moreUrlForm').addEventListener('submit', (e) => {
  e.preventDefault();
  addUrl($('moreUrlInput').value, $('moreUrlInput'));
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

$('domModeBtn').addEventListener('click', async () => {
  await save({ source: 'dom' });
  refresh();
});

$('icsModeBtn').addEventListener('click', async () => {
  await save({ source: 'ics' });
  refresh();
});

const refreshFromGoogle = () => {
  $('status').textContent = 'Refreshing from Google Calendar…';
  // Background worker opens a hidden GCal tab, lets the scanner run, closes it.
  chrome.runtime.sendMessage?.({ type: 'gtt-refresh-gcal' })?.catch?.(() => {});
};

$('refreshGcal').addEventListener('click', refreshFromGoogle);

// Re-render live when the background refresh (or any GCal tab) lands.
chrome.storage.onChanged?.addListener?.((changes, area) => {
  if (area === 'local' && changes.gttDomWeeks) refresh();
});

const init = async () => {
  state = await chrome.storage.sync.get(DEFAULTS);
  if (!state.source) state.source = state.icsUrls.length ? 'ics' : 'dom';
  $('version').textContent = `v${chrome.runtime.getManifest().version}`;
  render();
  refresh(); // intentionally not awaited — paint first
  // Page mode: kick off a background Google refresh when data is stale.
  if (state.source === 'dom' && state.tracked.length) {
    const { gttDomWeeksAt = 0 } = await chrome.storage.local.get('gttDomWeeksAt');
    if (Date.now() - gttDomWeeksAt > 15 * 60 * 1000) refreshFromGoogle();
  }
  // Feed mode: show cached stats while the fresh fetch is in flight.
  if (state.source === 'ics' && state.tracked.length) {
    const { lastStats } = await chrome.storage.local.get('lastStats');
    if (lastStats?.occ && !$('cards').children.length) {
      renderStats(lastStats.occ.map((o) => ({ start: new Date(o.s), end: new Date(o.e), summary: o.m })));
    }
  }
};

init();
