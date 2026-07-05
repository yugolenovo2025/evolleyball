// 目視確認用スクリーンショット（eFootball 型 UI）:
//  - 追従カメラ + レーダー + スコアボード
//  - チャージサーブ（ゲージ）
//  - トス選択 → スパイクのコース/パワー入力
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://localhost:8787';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.click('#btn-solo');
await page.waitForSelector('#sb', { timeout: 10000 });

// サーブプロンプトを待つ → 溜め中のゲージを撮る
await page.waitForFunction(
  () => document.getElementById('hud-panel')?.textContent?.includes('サーブ'),
  { timeout: 15000 },
);
await page.keyboard.press('ArrowLeft');
await page.keyboard.down(' ');
await page.waitForTimeout(650);
await page.screenshot({ path: 'scripts/shots/e1-serve-charge.png' });
await page.keyboard.up(' ');

// トスプロンプト（トスを選べ）を待つ
let gotSet = false;
for (let i = 0; i < 200 && !gotSet; i++) {
  const txt = await page.textContent('#hud-panel');
  if (txt?.includes('トスを選べ')) {
    gotSet = true;
    break;
  }
  if (txt?.includes('サーブ')) {
    await page.keyboard.down(' ');
    await page.waitForTimeout(700);
    await page.keyboard.up(' ');
  }
  if (txt?.includes('レシーブ')) {
    await page.keyboard.press(' ');
  }
  await page.waitForTimeout(200);
}
if (!gotSet) {
  console.error('NG: トスプロンプトが出ませんでした');
  process.exit(1);
}
await page.keyboard.press('1'); // レフト
await page.screenshot({ path: 'scripts/shots/e2-set.png' });
await page.waitForTimeout(600);
await page.keyboard.press(' ');

// スパイクプロンプトを待って溜め + コース
await page
  .waitForFunction(
    () => document.getElementById('hud-panel')?.textContent?.includes('スパイク'),
    { timeout: 5000 },
  )
  .catch(() => {});
await page.keyboard.down(' ');
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(350);
await page.screenshot({ path: 'scripts/shots/e3-spike.png' });
await page.keyboard.up(' ');
await page.waitForTimeout(1500);
await page.screenshot({ path: 'scripts/shots/e4-after.png' });

await browser.close();
console.log('visual shots done');
