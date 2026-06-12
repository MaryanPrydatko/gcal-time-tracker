// Floating "this week" progress widget injected into calendar.google.com.
(async () => {
  const DEFAULTS = { icsUrls: [], tracked: [], widgetCollapsed: false };
  const WEEKS_BACK = 4;
  let settings = await chrome.storage.sync.get(DEFAULTS);
  let lastRows = [];

  const fmtH = (h) => (Math.round(h * 10) / 10).toString();

  const root = document.createElement('div');
  root.id = 'gtt-widget';
  document.documentElement.appendChild(root);

  const render = () => {
    root.textContent = '';
    if (!settings.icsUrls.length || !settings.tracked.length) {
      root.hidden = true;
      return;
    }
    root.hidden = false;

    if (settings.widgetCollapsed) {
      const pill = document.createElement('button');
      pill.className = 'gtt-pill';
      pill.title = 'GCal Time Tracker';
      const first = lastRows[0];
      pill.textContent = first
        ? `⏱ ${fmtH(first.hours)}${first.target ? `/${first.target}` : ''}h`
        : '⏱';
      pill.addEventListener('click', () => {
        settings.widgetCollapsed = false;
        chrome.storage.sync.set({ widgetCollapsed: false });
        render();
      });
      root.appendChild(pill);
      return;
    }

    const card = document.createElement('div');
    card.className = 'gtt-card';

    const head = document.createElement('div');
    head.className = 'gtt-head';
    const title = document.createElement('strong');
    title.textContent = 'This week';
    const collapse = document.createElement('button');
    collapse.className = 'gtt-collapse';
    collapse.textContent = '—';
    collapse.title = 'Collapse';
    collapse.addEventListener('click', () => {
      settings.widgetCollapsed = true;
      chrome.storage.sync.set({ widgetCollapsed: true });
      render();
    });
    head.append(title, collapse);
    card.appendChild(head);

    for (const row of lastRows) {
      const line = document.createElement('div');
      line.className = 'gtt-row';
      const label = document.createElement('span');
      label.className = 'gtt-name';
      label.textContent = row.name;
      const value = document.createElement('span');
      value.className = 'gtt-value';
      value.textContent = row.target ? `${fmtH(row.hours)} / ${row.target}h` : `${fmtH(row.hours)}h`;
      if (row.target && row.hours >= row.target) value.classList.add('gtt-hit');
      const bar = document.createElement('div');
      bar.className = 'gtt-bar';
      const fill = document.createElement('div');
      fill.className = 'gtt-fill';
      const pct = row.target ? Math.min(100, (row.hours / row.target) * 100) : 100;
      fill.style.width = `${pct}%`;
      if (row.target && row.hours >= row.target) fill.classList.add('gtt-hit');
      bar.appendChild(fill);
      line.append(label, value, bar);
      card.appendChild(line);
    }
    root.appendChild(card);
  };

  const refresh = async () => {
    if (!settings.icsUrls.length || !settings.tracked.length) {
      render();
      return;
    }
    try {
      const { from, to } = CalHours.range(WEEKS_BACK);
      const texts = await Promise.all(
        settings.icsUrls.map((u) => fetch(u).then((r) => r.text()))
      );
      const occurrences = texts.flatMap((t) => CalHours.expandICS(t, from, to));
      lastRows = settings.tracked.map(({ name, target }) => {
        const rows = CalHours.weeklyHours(occurrences, name, 0);
        return { name, target, hours: rows[rows.length - 1].hours };
      });
    } catch {
      lastRows = [];
    }
    render();
  };

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    let needsRefresh = false;
    for (const [k, v] of Object.entries(changes)) {
      if (k in settings) settings[k] = v.newValue;
      if (k === 'icsUrls' || k === 'tracked') needsRefresh = true;
    }
    needsRefresh ? refresh() : render();
  });

  refresh();
  setInterval(refresh, 30 * 60 * 1000);
})();
