// Renders the extension icon (Google-blue rounded square + calendar/clock
// glyph) to PNG at all manifest sizes. Run: node test/gen-icons.mjs
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = path.join(root, 'icons');
mkdirSync(iconsDir, { recursive: true });

const html = `<!doctype html><meta charset="utf-8">
<style>
  body { margin: 0; background: transparent; }
  #icon {
    width: 128px; height: 128px; border-radius: 24%;
    background: linear-gradient(135deg, #4285f4, #1a56c4);
    display: flex; align-items: center; justify-content: center;
  }
  svg { width: 62%; height: 62%; }
</style>
<div id="icon">
  <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"
       stroke-linecap="round" stroke-linejoin="round">
    <rect x="2" y="4" width="15" height="17" rx="2"/>
    <line x1="6" y1="2" x2="6" y2="6"/>
    <line x1="13" y1="2" x2="13" y2="6"/>
    <line x1="2" y1="9" x2="17" y2="9"/>
    <circle cx="17.5" cy="17.5" r="4.5" fill="#1a56c4"/>
    <polyline points="17.5 15.5 17.5 17.5 19 18.5"/>
  </svg>
</div>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html);

for (const size of [16, 32, 48, 128]) {
  await page.evaluate((s) => {
    const el = document.getElementById('icon');
    el.style.width = `${s}px`;
    el.style.height = `${s}px`;
  }, size);
  await page.locator('#icon').screenshot({
    path: path.join(iconsDir, `icon${size}.png`),
    omitBackground: true,
  });
  console.log(`icons/icon${size}.png`);
}

await browser.close();
