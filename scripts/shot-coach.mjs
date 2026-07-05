// コーチングボード（監督UI）の目視確認 + ドラッグで守備位置調整が効くか
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://localhost:8787';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.click('#btn-solo');
await page.waitForSelector('#btn-kickoff', { timeout: 10000 });
await page.click('#btn-kickoff');
await page.waitForSelector('#sb', { timeout: 10000 });
await page.waitForTimeout(1500);

await page.keyboard.press('v');
await page.waitForSelector('#coach', { state: 'visible', timeout: 5000 });
await page.waitForTimeout(400);

// 自分のドット（mine クラス）をドラッグ
const dot = page.locator('.coach-dot.mine').first();
const box = await dot.boundingBox();
if (box) {
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 60, box.y - 40, { steps: 6 });
  await page.mouse.up();
  console.log('dot dragged');
}
await page.screenshot({ path: 'scripts/shots/coach1.png' });
console.log('coach board captured');

await browser.close();
console.log('done');
