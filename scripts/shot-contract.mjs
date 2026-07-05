// 選手契約画面（サラリーキャップ）の目視確認
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://localhost:8787';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.click('#btn-solo');
await page.waitForSelector('#court-cards .pcard', { timeout: 10000 });
await page.screenshot({ path: 'scripts/shots/ct1-contract.png' });
console.log('contract screen OK');

// 候補ピッカーを開く（OPカード）
await page.click('.pcard[data-slot="3"]');
await page.waitForSelector('#picker-list .cand', { timeout: 5000 });
await page.screenshot({ path: 'scripts/shots/ct2-picker.png' });
console.log('picker OK');
// 一番高い候補に変更してキャップバーの変化を見る
await page.click('#picker-list .cand:first-child');
await page.waitForTimeout(300);

// 高予算に切り替え
await page.click('.budget-pick[data-budget="190"]');
await page.waitForTimeout(300);
await page.screenshot({ path: 'scripts/shots/ct3-budget-high.png' });

// 試合へ（予算内なら開始できる）
const disabled = await page.locator('#btn-kickoff').isDisabled();
console.log('kickoff disabled?', disabled);
if (!disabled) {
  await page.click('#btn-kickoff');
  await page.waitForSelector('#sb', { timeout: 10000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'scripts/shots/ct4-ingame.png' });
  console.log('game started with contracted roster');
}
await browser.close();
console.log('done');
