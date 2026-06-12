// Generates README screenshots for the popup and the calendar widget using
// the same dynamically-dated sample calendar as the fixture test.
// Run: node test/gen-shots.mjs
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shotsDir = path.join(root, 'screenshots');
mkdirSync(shotsDir, { recursive: true });

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

const cur = weekStart(new Date());
const ics = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//gtt shots//EN',
  'BEGIN:VEVENT',
  'UID:work@shots',
  `DTSTART:${fmt(at(cur, -56, 9))}`,
  `DTEND:${fmt(at(cur, -56, 13))}`,
  'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH',
  'SUMMARY:Work',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:gym@shots',
  `DTSTART:${fmt(at(cur, -56, 7))}`,
  `DTEND:${fmt(at(cur, -56, 8))}`,
  'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR',
  'SUMMARY:Gym',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const stub = `
  window.chrome = {
    storage: {
      sync: {
        get: async (d) => ({ ...d, icsUrls: ['https://calendar.google.com/calendar/ical/demo/private-abc/basic.ics'],
          tracked: [{ name: 'work', target: 30 }, { name: 'gym', target: 3 }] }),
        set: async () => {},
      },
      onChanged: { addListener: () => {} },
    },
    runtime: { getManifest: () => ({ version: '1.0.0' }) },
  };
  window.fetch = async () => ({ ok: true, text: async () => ${JSON.stringify(ics)} });
`;

const browser = await chromium.launch();

const popup = await browser.newPage({ viewport: { width: 340, height: 640 }, deviceScaleFactor: 2 });
await popup.addInitScript(stub);
await popup.goto(`file://${path.join(root, 'popup.html')}`);
await popup.waitForTimeout(500);
await popup.locator('body').screenshot({ path: path.join(shotsDir, 'popup.png') });
console.log('screenshots/popup.png');

const widget = await browser.newPage({ viewport: { width: 420, height: 260 }, deviceScaleFactor: 2 });
await widget.addInitScript(stub);
await widget.goto('about:blank');
await widget.evaluate(() => {
  document.body.style.background = '#131314'; // GCal dark backdrop
  document.body.style.margin = '0';
});
await widget.addStyleTag({ path: path.join(root, 'content.css') });
await widget.addScriptTag({ path: path.join(root, 'vendor', 'ical.min.js') });
await widget.addScriptTag({ path: path.join(root, 'lib', 'hours.js') });
await widget.addScriptTag({ path: path.join(root, 'content.js') });
await widget.waitForTimeout(500);
await widget.screenshot({ path: path.join(shotsDir, 'widget.png') });
console.log('screenshots/widget.png');

await browser.close();
