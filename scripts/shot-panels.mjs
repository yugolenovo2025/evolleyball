// 操作パネルが「実際に見えている」ことをピクセルまで確認する:
//  サーブパネル → トスパネル（選択肢ボタン）→ スパイクパネル
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://localhost:8787';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.click('#btn-solo');
await page.waitForSelector('#btn-kickoff', { timeout: 10000 });
await page.click('#btn-kickoff');
await page.waitForSelector('#sb', { timeout: 10000 });

// サーブパネル可視 & 溜め表示
await page.waitForFunction(
  () => {
    const el = document.querySelector('#hud-panel .panel');
    return el && getComputedStyle(el).opacity === '1';
  },
  { timeout: 15000 },
);
await page.keyboard.down(' ');
await page.waitForTimeout(600);
await page.screenshot({ path: 'scripts/shots/p1-serve.png' });
await page.keyboard.up(' ');
console.log('serve panel visible OK');

// トスパネル（選択肢）を待つ
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
if (!got) { console.error('NG: トスパネルが出ません'); process.exit(1); }
await page.waitForTimeout(250); // 出現アニメーション完了を待ってから判定
const setOpacity = await page.evaluate(
  () => getComputedStyle(document.querySelector('#hud-panel .panel')).opacity,
);
if (setOpacity !== '1') { console.error(`NG: トスパネルが透明 (opacity=${setOpacity})`); process.exit(1); }
await page.keyboard.press('5'); // ツーアタック選択も確認
await page.screenshot({ path: 'scripts/shots/p2-set.png' });
console.log('set panel visible OK (opacity=1)');

await browser.close();
console.log('panel visibility all OK');
