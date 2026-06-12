// Floating "this week" progress widget injected into calendar.google.com.
// Two data sources: secret iCal feed ("ics") or reading the rendered
// calendar grid ("dom") for Workspace accounts whose admin hides the feed.
(async () => {
  // source '' = not chosen yet: page-reading by default, unless the user
  // had already configured feed URLs before this option existed.
  const DEFAULTS = { icsUrls: [], tracked: [], widgetCollapsed: false, source: '' };
  let settings = await chrome.storage.sync.get(DEFAULTS);
  if (!settings.source) settings.source = settings.icsUrls.length ? 'ics' : 'dom';
  let lastRows = [];
  let domEventsRead = 0;
  let viewWeekTs = null; // week shown in the widget (dom mode follows the view)

  const fmtH = (h) => (Math.round(h * 10) / 10).toString();

  const root = document.createElement('div');
  root.id = 'gtt-widget';
  document.documentElement.appendChild(root);

  const computeRows = (occurrences, refDate = new Date()) =>
    settings.tracked.map(({ name, target }) => {
      const rows = CalHours.weeklyHours(occurrences, name, 0, refDate);
      return { name, target, hours: rows[rows.length - 1].hours };
    });

  const render = () => {
    root.textContent = '';
    const configured =
      settings.tracked.length && (settings.source === 'dom' || settings.icsUrls.length);
    if (!configured) {
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
    const curTs = CalHours.weekStart(new Date()).getTime();
    const shownTs = viewWeekTs ?? curTs;
    title.textContent =
      shownTs === curTs
        ? 'This week'
        : `Week of ${new Date(shownTs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
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
      const over = row.target && row.hours > row.target ? row.hours - row.target : 0;
      const under = row.target && row.hours < row.target ? row.target - row.hours : 0;
      const delta = over ? ` · +${fmtH(over)}h` : under ? ` · −${fmtH(under)}h` : '';
      const value = document.createElement('span');
      value.className = 'gtt-value';
      value.textContent = row.target ? `${fmtH(row.hours)} / ${row.target}h${delta}` : `${fmtH(row.hours)}h`;
      if (row.target && row.hours >= row.target) value.classList.add('gtt-hit');
      if (over) value.classList.add('gtt-over');
      if (under) value.classList.add('gtt-under');
      const bar = document.createElement('div');
      bar.className = 'gtt-bar';
      const fill = document.createElement('div');
      fill.className = 'gtt-fill';
      const pct = row.target ? Math.min(100, (row.hours / row.target) * 100) : 100;
      fill.style.width = `${pct}%`;
      if (row.target && row.hours >= row.target) fill.classList.add('gtt-hit');
      if (over) fill.classList.add('gtt-over');
      if (under) fill.classList.add('gtt-under');
      bar.appendChild(fill);
      line.append(label, value, bar);
      card.appendChild(line);
    }

    if (settings.source === 'dom') {
      const note = document.createElement('div');
      note.className = 'gtt-note';
      note.textContent = `page mode · ${domEventsRead} events read in view`;
      card.appendChild(note);
    }
    root.appendChild(card);
  };

  const refreshIcs = async () => {
    if (!settings.icsUrls.length || !settings.tracked.length) {
      render();
      return;
    }
    try {
      const { from, to } = CalHours.range(4);
      const texts = await Promise.all(
        settings.icsUrls.map((u) => fetch(u).then((r) => r.text()))
      );
      const occurrences = texts.flatMap((t) => CalHours.expandICS(t, from, to));
      lastRows = computeRows(occurrences);
      viewWeekTs = null; // feed mode always shows the current week
    } catch {
      // Keep the last good rows — transient fetch failures shouldn't blank the widget.
    }
    render();
  };

  const hydrate = (o) => ({ start: new Date(o.s), end: new Date(o.e), summary: o.m });

  // In-memory mirror of storage.local.gttDomWeeks — loaded once, written
  // through only when a week's data actually changes. Keeps every scan
  // synchronous after startup.
  let domWeeks = null;
  let renderSig = '';

  const refreshDom = async () => {
    if (!domWeeks) {
      ({ gttDomWeeks: domWeeks = {} } = await chrome.storage.local.get('gttDomWeeks'));
    }
    const occurrences = CalDom.scan();
    domEventsRead = occurrences.length;

    // Persist what's visible per week — history accumulates as you browse.
    const byWeek = new Map();
    for (const occ of occurrences) {
      const ts = CalHours.weekStart(occ.start).getTime();
      if (!byWeek.has(ts)) byWeek.set(ts, []);
      byWeek.get(ts).push({ s: +occ.start, e: +occ.end, m: occ.summary });
    }
    let dirty = false;
    for (const [ts, arr] of byWeek) {
      if (JSON.stringify(domWeeks[ts]) !== JSON.stringify(arr)) {
        domWeeks[ts] = arr;
        dirty = true;
      }
    }
    if (dirty) chrome.storage.local.set({ gttDomWeeks: domWeeks });

    // Follow the week the user is looking at — going back a week shows that
    // week's totals (and stores them for the popup history).
    const viewDate = CalDom.visibleWeekDate();
    viewWeekTs = CalHours.weekStart(viewDate || new Date()).getTime();
    lastRows = computeRows((domWeeks[viewWeekTs] || []).map(hydrate), new Date(viewWeekTs));

    // Skip DOM churn when nothing visible changed.
    const sig = JSON.stringify([viewWeekTs, lastRows, domEventsRead, settings.widgetCollapsed]);
    if (sig !== renderSig) {
      renderSig = sig;
      render();
    }
  };

  const refresh = () => (settings.source === 'dom' ? refreshDom() : refreshIcs());

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    let needsRefresh = false;
    for (const [k, v] of Object.entries(changes)) {
      if (k in settings) settings[k] = v.newValue;
      if (k === 'icsUrls' || k === 'tracked' || k === 'source') needsRefresh = true;
    }
    needsRefresh ? refresh() : render();
  });

  // The calendar grid re-renders constantly; debounce DOM scans.
  let debounce;
  const observer = new MutationObserver(() => {
    if (settings.source !== 'dom') return;
    clearTimeout(debounce);
    debounce = setTimeout(refreshDom, 150);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  refresh();
  // The grid often isn't rendered yet at document_idle — retry shortly.
  setTimeout(refresh, 1000);
  setTimeout(refresh, 3000);
  setInterval(refresh, 30 * 60 * 1000);
})();
