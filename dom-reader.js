// Page-reading mode: extracts events straight from the Google Calendar grid
// (week/day view). Used when the Workspace admin hides the secret iCal
// address. Exposes globalThis.CalDom.
(() => {
  const MONTHS = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6,
    august: 7, september: 8, october: 9, november: 10, december: 11,
  };

  // Google encodes dates as (year-1970)<<9 | month<<5 | day (month 1-based).
  const decodeDatekey = (raw) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    const year = 1970 + (n >> 9);
    const month = (n >> 5) & 15;
    const day = n & 31;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return new Date(year, month - 1, day);
  };

  const parseToken = (token, impliedPeriod) => {
    const m = token.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (!m) return null;
    let h = Number(m[1]);
    const min = Number(m[2] || 0);
    const period = (m[3] || impliedPeriod || '').toLowerCase();
    if (period === 'pm' && h < 12) h += 12;
    if (period === 'am' && h === 12) h = 0;
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  };

  // "10:00 – 13:30", "10 – 11am", "11:30am – 1pm" -> minutes since midnight.
  const parseRange = (text) => {
    const m = (text || '').match(
      /(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:–|—|-|to)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i
    );
    if (!m) return null;
    const endPeriod = (m[2].match(/am|pm/i) || [''])[0];
    const end = parseToken(m[2]);
    let start = parseToken(m[1], endPeriod);
    if (start == null || end == null) return null;
    // "11 – 1pm": start inherits pm but 23:00>13:00 — flip start to am.
    if (start > end && endPeriod) {
      const flipped = parseToken(m[1], endPeriod.toLowerCase() === 'pm' ? 'am' : 'pm');
      if (flipped != null && flipped < end) start = flipped;
    }
    if (start == null || end <= start) return null; // overnight chips: skip
    return { startMin: start, endMin: end };
  };

  // Day of a chip: nearest ancestor with data-datekey; fallback to the
  // document title ("Week of June 8, 2026") + column geometry.
  const chipDate = (chip) => {
    const keyed = chip.closest('[data-datekey]');
    if (keyed) {
      const d = decodeDatekey(keyed.getAttribute('data-datekey'));
      if (d) return d;
    }
    const t = document.title.match(/Week of (\w+) (\d{1,2}), (\d{4})/i);
    if (t && MONTHS[t[1].toLowerCase()] != null) {
      const weekStart = new Date(Number(t[3]), MONTHS[t[1].toLowerCase()], Number(t[2]));
      const grid = chip.closest('[role="grid"]');
      if (!grid) return null;
      const gr = grid.getBoundingClientRect();
      const cr = chip.getBoundingClientRect();
      if (gr.width <= 0) return null;
      const idx = Math.min(6, Math.max(0, Math.floor(((cr.left + cr.width / 2 - gr.left) / gr.width) * 7)));
      const d = new Date(weekStart);
      d.setDate(d.getDate() + idx);
      return d;
    }
    return null;
  };

  const chipTitle = (chip, label) => {
    const lines = (chip.innerText || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const title = lines.find((l) => !parseRange(l) && !/^\d{1,2}(:\d{2})?\s*(am|pm)?$/i.test(l));
    if (title) return title;
    return (label.split(',')[0] || '').trim();
  };

  // Read all parseable timed events from the current view.
  const scan = () => {
    const out = [];
    const seen = new Set();
    for (const chip of document.querySelectorAll('[data-eventid]')) {
      const label =
        chip.querySelector('.XuJrye')?.textContent ||
        chip.getAttribute('aria-label') ||
        chip.innerText ||
        '';
      const range = parseRange(label);
      if (!range) continue; // all-day / multi-day / unparsable -> skip
      const date = chipDate(chip);
      if (!date) continue;
      const dedupe = `${chip.getAttribute('data-eventid')}|${+date}|${range.startMin}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      const start = new Date(date);
      start.setMinutes(range.startMin);
      const end = new Date(date);
      end.setMinutes(range.endMin);
      out.push({ start, end, summary: chipTitle(chip, label) });
    }
    return out;
  };

  globalThis.CalDom = { scan, parseRange, decodeDatekey };
})();
