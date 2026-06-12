// Shared pure logic: ICS text -> concrete occurrences -> hours per week.
// Classic script (no modules) so it can load in MV3 content scripts; exposes
// globalThis.CalHours. Requires vendor/ical.min.js (window.ICAL) loaded first.
(() => {
  // Monday 00:00 of the week containing d (local time).
  const weekStart = (d) => {
    const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    out.setDate(out.getDate() - ((out.getDay() + 6) % 7));
    return out;
  };

  // [from, to] window: weeksBack full weeks + current week + weeksForward.
  const range = (weeksBack, now = new Date(), weeksForward = 0) => {
    const cur = weekStart(now);
    const from = new Date(cur);
    from.setDate(from.getDate() - 7 * weeksBack);
    const to = new Date(cur);
    to.setDate(to.getDate() + 7 * (1 + weeksForward));
    return { from, to };
  };

  // Parse ICS text and expand events (incl. recurrence, EXDATE, moved
  // instances) into [{start: Date, end: Date, summary}] within [from, to].
  // All-day events are skipped — they aren't time blocks.
  const expandICS = (text, from, to) => {
    const comp = new ICAL.Component(ICAL.parse(text));
    const primaries = new Map();
    const exceptions = [];
    for (const ve of comp.getAllSubcomponents('vevent')) {
      const ev = new ICAL.Event(ve);
      if (ev.isRecurrenceException()) exceptions.push(ev);
      else primaries.set(ev.uid, ev);
    }
    for (const ex of exceptions) primaries.get(ex.uid)?.relateException(ex);

    const out = [];
    for (const ev of primaries.values()) {
      if (!ev.startDate || ev.startDate.isDate) continue;
      if (ev.isRecurring()) {
        const iter = ev.iterator();
        let next;
        let guard = 0;
        while ((next = iter.next()) && guard++ < 5000) {
          const occ = ev.getOccurrenceDetails(next);
          const start = occ.startDate.toJSDate();
          if (start > to) break;
          if (start < from) continue;
          out.push({
            start,
            end: occ.endDate.toJSDate(),
            summary: String(occ.item.summary || ev.summary || ''),
          });
        }
      } else {
        const start = ev.startDate.toJSDate();
        if (start >= from && start <= to) {
          out.push({ start, end: ev.endDate.toJSDate(), summary: String(ev.summary || '') });
        }
      }
    }
    return out;
  };

  // Sum matching occurrences into weekly buckets, oldest -> newest:
  // weeksBack past weeks, the current week, then weeksForward future weeks.
  // Case-insensitive substring match on the name.
  const weeklyHours = (occurrences, query, weeksBack, now = new Date(), weeksForward = 0) => {
    const cur = weekStart(now);
    const buckets = new Map();
    for (let i = -weeksBack; i <= weeksForward; i++) {
      const ws = new Date(cur);
      ws.setDate(ws.getDate() + 7 * i);
      buckets.set(ws.getTime(), 0);
    }
    const q = query.toLowerCase();
    for (const occ of occurrences) {
      if (!occ.summary.toLowerCase().includes(q)) continue;
      const ts = weekStart(occ.start).getTime();
      if (buckets.has(ts)) {
        buckets.set(ts, buckets.get(ts) + (occ.end - occ.start) / 3.6e6);
      }
    }
    return [...buckets.entries()].map(([weekTs, hours]) => ({ weekTs, hours }));
  };

  globalThis.CalHours = { weekStart, range, expandICS, weeklyHours };
})();
