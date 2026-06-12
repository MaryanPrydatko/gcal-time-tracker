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
          tracked: [{ name: 'work', target: 30 }, { name: 'gym', target: 0 }] }),
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
check(workValue === '10 / 30h this week', `popup work card shows progress vs target (got "${workValue}")`);
const gymValue = await popup.locator('.card .value').nth(1).innerText();
check(gymValue === '1h this week', `popup gym card shows plain hours (got "${gymValue}")`);
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
check(widgetWork === '10 / 30h', `widget shows work progress (got "${widgetWork}")`);
await widget.locator('.gtt-collapse').click();
check((await widget.locator('.gtt-pill').count()) === 1, 'widget collapses to pill');
await widget.locator('.gtt-pill').click();
check((await widget.locator('.gtt-card').count()) === 1, 'pill expands back to card');

check(errors.length === 0, `no page errors${errors.length ? ` (${errors[0]})` : ''}`);

await browser.close();
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
