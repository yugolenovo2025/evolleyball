// ブロックジャンプ（押した瞬間に跳ぶ）と新体型の目視確認
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://localhost:8787';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.click('#btn-solo');
await page.waitForSelector('#btn-kickoff', { timeout: 10000 });
await page.click('#btn-kickoff');
await page.waitForSelector('#sb', { timeout: 10000 });

// 新体型（監督視点）
await page.keyboard.press('c');
await page.waitForTimeout(2200);
await page.screenshot({ path: 'scripts/shots/b0-style.png' });
await page.keyboard.press('c');

// サーブを打ってラリーへ → 相手セット（ブロックプロンプト）を待つ
let gotBlock = false;
for (let i = 0; i < 300 && !gotBlock; i++) {
  const txt = (await page.textContent('#hud-panel')) ?? '';
  if (txt.includes('ブロック')) { gotBlock = true; break; }
  if (txt.includes('サーブ')) {
    await page.keyboard.down(' ');
    await page.waitForTimeout(700);
    await page.keyboard.up(' ');
  } else if (txt.includes('レシーブ') || txt.includes('トスを選べ')) {
    await page.keyboard.press(' ');
  }
  await page.waitForTimeout(180);
}
if (!gotBlock) { console.error('NG: ブロック機会が来ませんでした'); process.exit(1); }

// 相手が打つあたりでジャンプ入力 → 直後に自チームブロッカーが跳んでいるはず
await page.waitForTimeout(700);
await page.keyboard.press(' ');
await page.waitForTimeout(200); // ジャンプ上昇中
await page.screenshot({ path: 'scripts/shots/b1-blockjump.png' });
console.log('block jump captured');

await browser.close();
console.log('done');
