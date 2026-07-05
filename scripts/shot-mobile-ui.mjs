// スマホ横持ち（844x390）のホーム / 準備画面 / プレイ中HUDの最適化を目視確認
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://localhost:8787';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({
  viewport: { width: 844, height: 390 },
  hasTouch: true,
  isMobile: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
});
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('h1', { timeout: 20000 });
await page.screenshot({ path: 'scripts/shots/mob1-home.png' });
console.log('home OK');

await page.tap('#btn-solo');
await page.waitForSelector('#btn-kickoff', { timeout: 10000 });
await page.screenshot({ path: 'scripts/shots/mob2-prep.png' });
console.log('prep OK');

await page.tap('#btn-kickoff');
await page.waitForSelector('#sb', { timeout: 10000 });
await page.waitForTimeout(2200);
await page.screenshot({ path: 'scripts/shots/mob3-serve.png' });
console.log('serve OK');

// トスカードが出るまで進める（右ゾーン連打）
let got = false;
for (let i = 0; i < 150 && !got; i++) {
  if (await page.locator('.tcard').first().isVisible().catch(() => false)) { got = true; break; }
  await page.locator('#zone-r').tap({ timeout: 400 }).catch(() => {});
  await page.waitForTimeout(220);
}
if (got) {
  await page.screenshot({ path: 'scripts/shots/mob4-set.png' });
  console.log('set panel OK');
} else {
  console.log('note: set panel not captured this run');
}

// チュートリアル（❓ボタンから表示）
await page.tap('#btn-help');
await page.waitForSelector('#tut', { state: 'visible', timeout: 5000 });
await page.tap('#tut-next');
await page.waitForTimeout(200);
await page.screenshot({ path: 'scripts/shots/mob6-tutorial.png' });
await page.tap('#tut-close');
const tutClosed = !(await page.locator('#tut').isVisible());
console.log('tutorial open/close OK:', tutClosed);

await browser.close();
console.log('done');
