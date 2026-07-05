// フローティング方向スティックの目視確認（サーブ中に左ゾーンをドラッグ）
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://localhost:8787';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({
  viewport: { width: 844, height: 390 },
  hasTouch: true,
  isMobile: true,
});
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.tap('#btn-solo');
await page.waitForSelector('#btn-kickoff', { timeout: 10000 });
await page.tap('#btn-kickoff');
await page.waitForSelector('#sb', { timeout: 10000 });

// サーブプロンプト（zone-l が有効化されスティック案内が出る）
await page.waitForSelector('#stick-hint', { state: 'visible', timeout: 15000 });
await page.screenshot({ path: 'scripts/shots/st1-hint.png' });
console.log('stick hint visible OK');

// 左ゾーンをドラッグ → スティック出現 & コース変更
const zl = await page.locator('#zone-l').boundingBox();
const sx = zl.x + zl.width * 0.5;
const sy = zl.y + zl.height * 0.55;
await page.touchscreen.tap(sx, sy); // pointerdown ~ up quick — need drag: use mouse fallback? touchscreen has no drag; use CDP-free approach with page.mouse on touch context
await page.mouse.move(sx, sy);
await page.mouse.down();
await page.mouse.move(sx + 45, sy, { steps: 5 });
await page.waitForTimeout(150);
await page.screenshot({ path: 'scripts/shots/st2-stick.png' });
await page.mouse.up();
console.log('stick drag captured');

await browser.close();
console.log('done');
