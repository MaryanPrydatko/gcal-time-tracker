// Renders the extension icon to PNG at all manifest sizes: a white calendar
// card with progress bars (the product in one glance) on a blue gradient.
// Designed at 128px and scaled, so every size stays proportional.
// Run: node test/gen-icons.mjs
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
  #wrap { width: 128px; height: 128px; }
  #icon {
    width: 128px; height: 128px; border-radius: 30px;
    background: linear-gradient(160deg, #6aa9ff 0%, #2f7af0 45%, #1450bd 100%);
    position: relative; overflow: hidden;
    transform-origin: top left;
  }
  #icon::before {
    content: ""; position: absolute; inset: 0;
    background: radial-gradient(120% 80% at 20% 0%, rgba(255,255,255,0.25), transparent 55%);
  }
  .ring {
    position: absolute; top: 16px; width: 10px; height: 22px;
    background: #fff; border-radius: 5px;
    box-shadow: 0 2px 4px rgba(10, 40, 100, 0.35);
  }
  .ring.l { left: 38px; }
  .ring.r { left: 80px; }
  .card {
    position: absolute; left: 22px; top: 28px; width: 84px; height: 74px;
    background: #fff; border-radius: 18px;
    box-shadow: 0 6px 14px rgba(10, 40, 100, 0.35);
  }
  .track {
    position: absolute; left: 14px; right: 14px; height: 14px;
    background: #e4e7eb; border-radius: 999px;
  }
  .t1 { top: 18px; }
  .t2 { top: 42px; }
  .fill { height: 100%; border-radius: 999px; }
  .f1 { width: 78%; background: #34a853; }
  .f2 { width: 45%; background: #fbbc04; }
</style>
<div id="wrap">
  <div id="icon">
    <span class="ring l"></span><span class="ring r"></span>
    <div class="card">
      <div class="track t1"><div class="fill f1"></div></div>
      <div class="track t2"><div class="fill f2"></div></div>
    </div>
  </div>
</div>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html);

for (const size of [16, 32, 48, 128]) {
  await page.evaluate((s) => {
    document.getElementById('wrap').style.width = `${s}px`;
    document.getElementById('wrap').style.height = `${s}px`;
    document.getElementById('icon').style.transform = `scale(${s / 128})`;
  }, size);
  await page.locator('#wrap').screenshot({
    path: path.join(iconsDir, `icon${size}.png`),
    omitBackground: true,
  });
  console.log(`icons/icon${size}.png`);
}

await browser.close();
