// 新モーション/モデルの目視確認:
//  - サーブのトスアップ〜スイング（頭上打点）
//  - スパイクの引き腕〜振り抜き（観戦モードで捕捉）
//  - 新しい選手モデル（肘・背番号・接地影）
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://localhost:8787';
const browser = await chromium.launch({ channel: 'msedge', headless: true });

// 1) ソロ: サーブのトスアップ中を捉える
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.click('#btn-solo');
await page.waitForSelector('#btn-kickoff', { timeout: 10000 });
await page.click('#btn-kickoff');
await page.waitForSelector('#sb', { timeout: 10000 });
await page.waitForFunction(
  () => document.getElementById('hud-panel')?.textContent?.includes('サーブ'),
  { timeout: 15000 },
);
await page.keyboard.down(' ');
await page.waitForTimeout(700);
await page.keyboard.up(' ');
await page.waitForTimeout(330); // トスアップ中（ボールが頭上へ上がる途中）
await page.screenshot({ path: 'scripts/shots/mo1-serve-toss.png' });
console.log('serve toss captured');
await page.close();

// 2) 観戦モード: スパイクスイングの瞬間を狙う（トスイベント後 ~0.9s）
const w = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await w.goto(BASE, { waitUntil: 'domcontentloaded' });
await w.click('#btn-watch');
await w.waitForSelector('#sb', { timeout: 10000 });
// 監督視点にして全体を見る
await w.keyboard.press('c');
await w.waitForTimeout(4000);
await w.screenshot({ path: 'scripts/shots/mo2-players.png' });
// スパイク瞬間: トーストなど無関係に一定間隔で連写して選ぶ代わりに、数枚撮る
for (let i = 0; i < 3; i++) {
  await w.waitForTimeout(2600);
  await w.screenshot({ path: `scripts/shots/mo3-rally-${i}.png` });
}
console.log('watch shots captured');
await browser.close();
console.log('done');
