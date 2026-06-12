// Offline smoke test for the hours engine, popup, and calendar widget.
// The sample ICS is generated relative to today, so expectations are stable:
//   - weekly recurring "Work" Mon+Wed 09:00-13:00 (8h/week)
//   - last week: Monday cancelled (EXDATE), Wednesday moved to Thursday 2h
//   - current week: one-off "Work: deep focus" Wed 14:00-16:00 (+2h)
//   - "Gym" Tue 07:00-08:00 current week (must not match "work")
//   - all-day "Work conference" (must be ignored)
// Expected "work" hours per week: [8, 8, 8, 2, 10]
// Run: node test/run-fixture.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const check = (ok, name) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failures++;
};

// --- build sample ICS relative to today ---------------------------------
const weekStart = (d) => {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7));
  return out;
};
const at = (base, days, hours) => {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  d.setHours(hours, 0, 0, 0);
  return d;
};
const fmt = (d) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}` +
  `T${String(d.getHours()).padStart(2, '0')}0000`;
const fmtDate = (d) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

const cur = weekStart(new Date());
const dtstart = at(cur, -56, 9); // recurring start: Monday 8 weeks back, 09:00
const exMon = at(cur, -7, 9); // last week's Monday: cancelled
const movedFrom = at(cur, -5, 9); // last week's Wednesday: original start
const movedToStart = at(cur, -4, 10); // moved to Thursday 10:00
const movedToEnd = at(cur, -4, 12); // ...2h instead of 4h
const oneOffStart = at(cur, 2, 14); // current week Wednesday 14:00
const oneOffEnd = at(cur, 2, 16);
const gymStart = at(cur, 1, 7);
const gymEnd = at(cur, 1, 8);
const allDay = at(cur, 3, 0);

const ics = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//gtt test//EN',
  'BEGIN:VEVENT',
  'UID:work-recurring@test',
  `DTSTART:${fmt(dtstart)}`,
  `DTEND:${fmt(at(dtstart, 0, 13))}`,
  'RRULE:FREQ=WEEKLY;BYDAY=MO,WE',
  `EXDATE:${fmt(exMon)}`,
  'SUMMARY:Work',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:work-recurring@test',
  `RECURRENCE-ID:${fmt(movedFrom)}`,
  `DTSTART:${fmt(movedToStart)}`,
  `DTEND:${fmt(movedToEnd)}`,
  'SUMMARY:Work',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:work-oneoff@test',
  `DTSTART:${fmt(oneOffStart)}`,
  `DTEND:${fmt(oneOffEnd)}`,
  'SUMMARY:Work: deep focus',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:gym@test',
  `DTSTART:${fmt(gymStart)}`,
  `DTEND:${fmt(gymEnd)}`,
  'SUMMARY:Gym',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:conf@test',
  `DTSTART;VALUE=DATE:${fmtDate(allDay)}`,
  `DTEND;VALUE=DATE:${fmtDate(at(allDay, 1, 0))}`,
  'SUMMARY:Work conference',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

// --- 1. hours engine ------------------------------------------------------
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('about:blank');
await page.addScriptTag({ path: path.join(root, 'vendor', 'ical.min.js') });
await page.addScriptTag({ path: path.join(root, 'lib', 'hours.js') });

const sums = await page.evaluate((icsText) => {
  const { from, to } = CalHours.range(4);
  const occ = CalHours.expandICS(icsText, from, to);
  const hours = (q) => CalHours.weeklyHours(occ, q, 4).map((r) => Math.round(r.hours * 10) / 10);
  return { work: hours('work'), gym: hours('gym'), conf: hours('conference') };
}, ics);

check(JSON.stringify(sums.work) === '[8,8,8,2,10]', `work weeks = [8,8,8,2,10] (got ${JSON.stringify(sums.work)})`);
check(JSON.stringify(sums.gym) === '[0,0,0,0,1]', `gym weeks = [0,0,0,0,1] (got ${JSON.stringify(sums.gym)})`);
check(sums.conf.every((h) => h === 0), 'all-day events ignored');

// --- 2. popup render ------------------------------------------------------
const stub = (icsText) => `
  window.chrome = {
    storage: {
      sync: {
        get: async (d) => ({ ...d, icsUrls: ['https://example.test/cal.ics'],
          tracked: [{ name: 'work', target: 30 }, { name: 'gym', target: 0.5 }] }),
        set: async () => {},
      },
      local: { get: async () => ({}), set: async () => {} },
      onChanged: { addListener: () => {} },
    },
    runtime: { getManifest: () => ({ version: '1.0.0' }) },
  };
  window.fetch = async () => ({ ok: true, text: async () => ${JSON.stringify(icsText)} });
`;

const popup = await browser.newPage();
popup.on('pageerror', (e) => errors.push(String(e)));
await popup.addInitScript(stub(ics));
await popup.goto(`file://${path.join(root, 'popup.html')}`);
await popup.waitForTimeout(400);

check((await popup.locator('.card').count()) === 2, 'popup renders a card per tracked event');
const workValue = await popup.locator('.card .value').first().innerText();
check(workValue === '10 / 30h this week · −20h', `popup work card shows progress vs target (got "${workValue}")`);
const gymValue = await popup.locator('.card .value').nth(1).innerText();
check(
  gymValue === '1 / 0.5h this week · +0.5h over',
  `popup shows overage explicitly (got "${gymValue}")`
);
const avg = await popup.locator('.card .avg').first().innerText();
check(avg === 'avg 6.5h', `popup shows past-weeks average (got "${avg}")`);
check(!(await popup.locator('#setup').isVisible()), 'setup section hidden once configured');

// --- 2b. popup guides the user when the URL 404s (public-address mistake) --
const popup404 = await browser.newPage();
await popup404.addInitScript(`
  window.chrome = {
    storage: {
      sync: {
        get: async (d) => ({ ...d,
          icsUrls: ['https://calendar.google.com/calendar/ical/x%40y/public/basic.ics'],
          tracked: [{ name: 'work', target: 0 }] }),
        set: async () => {},
      },
      local: { get: async () => ({}), set: async () => {} },
      onChanged: { addListener: () => {} },
    },
    runtime: { getManifest: () => ({ version: '1.0.0' }) },
  };
  window.fetch = async () => ({ ok: false, status: 404, text: async () => '' });
`);
await popup404.goto(`file://${path.join(root, 'popup.html')}`);
await popup404.waitForTimeout(400);
const status404 = await popup404.locator('#status').innerText();
check(status404.includes('Secret address'), `404 shows secret-address hint (got "${status404}")`);

// --- 3. calendar widget ---------------------------------------------------
const widget = await browser.newPage();
widget.on('pageerror', (e) => errors.push(String(e)));
await widget.addInitScript(stub(ics));
await widget.goto('about:blank');
await widget.addStyleTag({ path: path.join(root, 'content.css') });
await widget.addScriptTag({ path: path.join(root, 'vendor', 'ical.min.js') });
await widget.addScriptTag({ path: path.join(root, 'lib', 'hours.js') });
await widget.addScriptTag({ path: path.join(root, 'content.js') });
await widget.waitForTimeout(400);

check((await widget.locator('#gtt-widget .gtt-row').count()) === 2, 'widget renders a row per tracked event');
const widgetWork = await widget.locator('.gtt-value').first().innerText();
check(widgetWork === '10 / 30h · −20h', `widget shows work progress (got "${widgetWork}")`);
await widget.locator('.gtt-collapse').click();
check((await widget.locator('.gtt-pill').count()) === 1, 'widget collapses to pill');
await widget.locator('.gtt-pill').click();
check((await widget.locator('.gtt-card').count()) === 1, 'pill expands back to card');

// --- 4. page-reading (DOM) mode -------------------------------------------
const datekey = (d) =>
  ((d.getFullYear() - 1970) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
const mon = cur; // this week's Monday
const tue = at(cur, 1, 0);

const gridHtml = `
  <div role="grid">
    <div data-datekey="${datekey(mon)}">
      <div data-eventid="e1" role="button">
        <div>work</div><div>10:00 – 13:30</div>
        <div class="XuJrye">10:00 to 13:30, work, Maryan Prydatko</div>
      </div>
      <div data-eventid="e4" role="button">
        <div>Office</div>
        <div class="XuJrye">Office, All day</div>
      </div>
    </div>
    <div data-datekey="${datekey(tue)}">
      <div data-eventid="e2" role="button">
        <div>work</div><div>15:00 – 18:15</div>
        <div class="XuJrye">15:00 to 18:15, work, Maryan Prydatko</div>
      </div>
      <div data-eventid="e3" role="button">
        <div>Gym</div><div>7:00 – 8:00</div>
        <div class="XuJrye">7:00 to 8:00, Gym, Maryan Prydatko</div>
      </div>
    </div>
  </div>`;

const dom = await browser.newPage();
dom.on('pageerror', (e) => errors.push(String(e)));
await dom.addInitScript(`
  const localStore = {};
  window.chrome = {
    storage: {
      sync: {
        get: async (d) => ({ ...d, source: 'dom',
          tracked: [{ name: 'work', target: 20 }] }),
        set: async () => {},
      },
      local: {
        get: async (k) => (typeof k === 'string' ? { [k]: localStore[k] } : { ...k, ...localStore }),
        set: async (o) => Object.assign(localStore, o),
      },
      onChanged: { addListener: () => {} },
    },
    runtime: { getManifest: () => ({ version: '1.0.0' }) },
  };
`);
await dom.goto('about:blank');
await dom.setContent(`<body>${gridHtml}</body>`);
await dom.addStyleTag({ path: path.join(root, 'content.css') });
await dom.addScriptTag({ path: path.join(root, 'vendor', 'ical.min.js') });
await dom.addScriptTag({ path: path.join(root, 'lib', 'hours.js') });
await dom.addScriptTag({ path: path.join(root, 'dom-reader.js') });

const parse = await dom.evaluate(() => ({
  h24: CalDom.parseRange('10:00 – 13:30'),
  h12: CalDom.parseRange('11:30am – 1pm'),
  inherit: CalDom.parseRange('10 – 11am'),
  flip: CalDom.parseRange('11 – 1pm'),
  bad: CalDom.parseRange('All day'),
}));
check(parse.h24 && parse.h24.endMin - parse.h24.startMin === 210, '24h range parses (3.5h)');
check(parse.h12 && parse.h12.endMin - parse.h12.startMin === 90, '12h range parses (1.5h)');
check(parse.inherit && parse.inherit.endMin - parse.inherit.startMin === 60, 'am/pm inherited from end token');
check(parse.flip && parse.flip.endMin - parse.flip.startMin === 120, '"11 – 1pm" flips start to am');
check(parse.bad === null, 'all-day text rejected');

const scanned = await dom.evaluate(() => CalDom.scan().map((o) => ({
  summary: o.summary,
  hours: (o.end - o.start) / 3.6e6,
  day: o.start.getDay(),
})));
check(scanned.length === 3, `scan finds 3 timed events (got ${scanned.length})`);
check(
  scanned.filter((o) => o.summary === 'work').reduce((s, o) => s + o.hours, 0) === 6.75,
  'scanned work hours = 6.75'
);

await dom.addScriptTag({ path: path.join(root, 'content.js') });
await dom.waitForTimeout(400);
const domWidgetWork = await dom.locator('.gtt-value').first().innerText();
check(domWidgetWork === '6.8 / 20h · −13.3h', `dom-mode widget shows work progress (got "${domWidgetWork}")`);
const domNote = await dom.locator('.gtt-note').innerText();
check(/page mode · 3 events read/.test(domNote), `dom-mode widget shows read counter (got "${domNote}")`);

// --- 4b. widget follows the viewed week (going back a week) ----------------
const prevMon = at(cur, -7, 0);
const prevTue = at(cur, -6, 0);
const prevGrid = `
  <div role="grid">
    <div data-datekey="${datekey(prevMon)}">
      <div data-eventid="p1" role="button">
        <div>work</div><div>9:00 – 17:00</div>
        <div class="XuJrye">9:00 to 17:00, work, Maryan Prydatko</div>
      </div>
    </div>
    <div data-datekey="${datekey(prevTue)}"></div>
  </div>`;

const prev = await browser.newPage();
prev.on('pageerror', (e) => errors.push(String(e)));
await prev.addInitScript(`
  const localStore = {};
  window.chrome = {
    storage: {
      sync: {
        get: async (d) => ({ ...d, source: 'dom', tracked: [{ name: 'work', target: 5 }] }),
        set: async () => {},
      },
      local: {
        get: async (k) => (typeof k === 'string' ? { [k]: localStore[k] } : { ...k, ...localStore }),
        set: async (o) => Object.assign(localStore, o),
      },
      onChanged: { addListener: () => {} },
    },
    runtime: { getManifest: () => ({ version: '1.0.0' }) },
  };
`);
await prev.goto('about:blank');
await prev.setContent(`<body>${prevGrid}</body>`);
await prev.addStyleTag({ path: path.join(root, 'content.css') });
await prev.addScriptTag({ path: path.join(root, 'vendor', 'ical.min.js') });
await prev.addScriptTag({ path: path.join(root, 'lib', 'hours.js') });
await prev.addScriptTag({ path: path.join(root, 'dom-reader.js') });
await prev.addScriptTag({ path: path.join(root, 'content.js') });
await prev.waitForTimeout(400);
const prevTitle = await prev.locator('.gtt-head strong').innerText();
check(/^Week of /.test(prevTitle), `widget titled by viewed week (got "${prevTitle}")`);
const prevValue = await prev.locator('.gtt-value').first().innerText();
check(
  prevValue === '8 / 5h · +3h',
  `widget shows viewed week's hours with overage (got "${prevValue}")`
);

// --- 4c. fresh install defaults to page-reading mode -----------------------
const fresh = await browser.newPage();
fresh.on('pageerror', (e) => errors.push(String(e)));
await fresh.addInitScript(`
  window.chrome = {
    storage: {
      sync: { get: async (d) => ({ ...d }), set: async () => {} },
      local: { get: async () => ({}), set: async () => {} },
      onChanged: { addListener: () => {} },
    },
    runtime: { getManifest: () => ({ version: '1.0.0' }) },
  };
`);
await fresh.goto(`file://${path.join(root, 'popup.html')}`);
await fresh.waitForTimeout(300);
check(!(await fresh.locator('#setup').isVisible()), 'fresh install skips URL setup (page mode default)');
check(await fresh.locator('#domSection').isVisible(), 'fresh install shows page-mode source section');

// --- 5. popup in page-reading mode -----------------------------------------
const popupDom = await browser.newPage();
popupDom.on('pageerror', (e) => errors.push(String(e)));
const seedWeeks = {};
seedWeeks[+cur] = [
  { s: +at(cur, 0, 10), e: +at(cur, 0, 13.5 * 1), m: 'work' },
];
await popupDom.addInitScript(`
  const localStore = { gttDomWeeks: ${JSON.stringify({
    [+cur]: [{ s: +at(cur, 0, 10), e: +at(cur, 0, 14), m: 'work' }],
    [+at(cur, -7, 0)]: [{ s: +at(cur, -7, 9), e: +at(cur, -7, 17), m: 'work' }],
  })} };
  window.chrome = {
    storage: {
      sync: {
        get: async (d) => ({ ...d, source: 'dom', tracked: [{ name: 'work', target: 20 }] }),
        set: async () => {},
      },
      local: {
        get: async (k) => (typeof k === 'string' ? { [k]: localStore[k] } : { ...k, ...localStore }),
        set: async (o) => Object.assign(localStore, o),
      },
      onChanged: { addListener: () => {} },
    },
    runtime: { getManifest: () => ({ version: '1.0.0' }) },
  };
`);
await popupDom.goto(`file://${path.join(root, 'popup.html')}`);
await popupDom.waitForTimeout(400);
check((await popupDom.locator('.card').count()) === 1, 'dom-mode popup renders tracked card');
const popupDomValue = await popupDom.locator('.card .value').first().innerText();
check(popupDomValue === '4 / 20h this week · −16h', `dom-mode popup current week from store (got "${popupDomValue}")`);
check(!(await popupDom.locator('#calendarsSection').isVisible()), 'calendars section hidden in dom mode');
check(await popupDom.locator('#domSection').isVisible(), 'source section visible in dom mode');
check(await popupDom.locator('#refreshGcal').isVisible(), 'refresh-from-Google button available in dom mode');

// --- 6. widget on Notion Calendar (renders from shared GCal data) ----------
const notion = await browser.newPage();
notion.on('pageerror', (e) => errors.push(String(e)));
await notion.route('**/*', (r) => r.fulfill({ contentType: 'text/html', body: '<body></body>' }));
await notion.addInitScript(`
  const localStore = {
    gttDomWeeks: ${JSON.stringify({ [+cur]: [{ s: +at(cur, 0, 10), e: +at(cur, 0, 14), m: 'work' }] })},
    gttDomWeeksAt: 1,
  };
  window.chrome = {
    storage: {
      sync: {
        get: async (d) => ({ ...d, source: 'dom', tracked: [{ name: 'work', target: 20 }] }),
        set: async () => {},
      },
      local: {
        get: async (k) => {
          if (typeof k === 'string') return { [k]: localStore[k] };
          if (Array.isArray(k)) return Object.fromEntries(k.map((key) => [key, localStore[key]]));
          return { ...k, ...localStore };
        },
        set: async (o) => Object.assign(localStore, o),
      },
      onChanged: { addListener: () => {} },
    },
    runtime: { getManifest: () => ({ version: '1.0.0' }) },
  };
`);
await notion.goto('https://calendar.notion.so/');
await notion.addStyleTag({ path: path.join(root, 'content.css') });
await notion.addScriptTag({ path: path.join(root, 'vendor', 'ical.min.js') });
await notion.addScriptTag({ path: path.join(root, 'lib', 'hours.js') });
await notion.addScriptTag({ path: path.join(root, 'dom-reader.js') });
await notion.addScriptTag({ path: path.join(root, 'content.js') });
await notion.waitForTimeout(400);
const notionValue = await notion.locator('.gtt-value').first().innerText();
check(notionValue === '4 / 20h · −16h', `notion widget shows GCal-fed hours (got "${notionValue}")`);
const notionNote = await notion.locator('.gtt-note').innerText();
check(/from Google Calendar/.test(notionNote), `notion widget labels its data source (got "${notionNote}")`);
check((await notion.locator('.gtt-debug').count()) === 1, 'notion widget offers page-info copy helper');

check(errors.length === 0, `no page errors${errors.length ? ` (${errors[0]})` : ''}`);

await browser.close();
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
