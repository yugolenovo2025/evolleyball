// 目視確認:
//  1) サーブのインパクト瞬間（手とボールの接触）
//  2) セット機会のタクティカル・ビュー（広角 + アタッカー番号マーカー）
//  3) 戦術リングメニュー
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://localhost:8787';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.click('#btn-solo');
await page.waitForSelector('#btn-kickoff', { timeout: 10000 });
await page.click('#btn-kickoff');
await page.waitForSelector('#sb', { timeout: 10000 });

// リングメニュー
await page.keyboard.down('q');
await page.waitForTimeout(300);
await page.screenshot({ path: 'scripts/shots/c0-ring.png' });
await page.keyboard.press('2'); // 攻撃指示: クイック
await page.keyboard.up('q');
console.log('ring menu OK');

// サーブ: インパクトの瞬間（離してから ~0.5s 後が接触）
await page.waitForFunction(
  () => document.getElementById('hud-panel')?.textContent?.includes('サーブ'),
  { timeout: 15000 },
);
await page.keyboard.down(' ');
await page.waitForTimeout(700);
await page.keyboard.up(' ');
await page.waitForTimeout(480); // トスアップ完了直後 = インパクト
await page.screenshot({ path: 'scripts/shots/c1-serve-impact.png' });
console.log('serve impact captured');

// トスプロンプト（タクティカル・ビュー）
let got = false;
for (let i = 0; i < 200 && !got; i++) {
  const txt = (await page.textContent('#hud-panel')) ?? '';
  if (txt.includes('トスを選べ')) { got = true; break; }
  if (txt.includes('サーブ')) {
    await page.keyboard.down(' ');
    await page.waitForTimeout(700);
    await page.keyboard.up(' ');
  }
  if (txt.includes('レシーブ')) await page.keyboard.press(' ');
  await page.waitForTimeout(200);
}
if (!got) { console.error('NG: セット機会なし'); process.exit(1); }
await page.waitForTimeout(500); // 広角へのズームを待つ
await page.screenshot({ path: 'scripts/shots/c2-tactical.png' });
console.log('tactical view captured');

// スパイクを打ってインパクト付近を撮る
await page.keyboard.press(' '); // トス
await page.waitForTimeout(150);
await page.keyboard.down(' '); // スパイク溜め
await page.waitForTimeout(500);
await page.keyboard.up(' ');
await page.waitForTimeout(320);
await page.screenshot({ path: 'scripts/shots/c3-spike-impact.png' });
console.log('spike moment captured');

await browser.close();
console.log('done');
