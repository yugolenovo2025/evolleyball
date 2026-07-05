// eVolleyball 新機能の目視確認:
//  - 新メニュー / 試合準備画面（戦術 + 編成）
//  - 打点マーカー・慣性移動を含む試合画面
//  - AI 観戦で VAR 発動を待ち受けてスクリーンショット
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://localhost:8787';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('h1:has-text("eVolleyball")', { timeout: 20000 });
await page.screenshot({ path: 'scripts/shots/ev1-menu.png' });
console.log('menu OK (eVolleyball)');

// 準備画面
await page.click('#btn-solo');
await page.waitForSelector('#roster-list .roster-row', { timeout: 10000 });
await page.click('[data-tactic="aggressive"]');
await page.screenshot({ path: 'scripts/shots/ev2-prep.png' });
console.log('prep screen OK');

await page.click('#btn-kickoff');
await page.waitForSelector('#sb', { timeout: 10000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: 'scripts/shots/ev3-game.png' });
console.log('game start OK');
await page.close();

// AI 観戦デモで VAR かリプレイの発動を待つ
const watch = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await watch.goto(BASE, { waitUntil: 'domcontentloaded' });
await watch.click('#btn-watch');
await watch.waitForSelector('#sb', { timeout: 10000 });

let gotVar = false;
let gotReplay = false;
const deadline = Date.now() + 240000;
while (Date.now() < deadline && (!gotVar || !gotReplay)) {
  if (!gotVar) {
    const v = await watch.locator('#var-overlay').isVisible().catch(() => false);
    if (v) {
      await watch.waitForTimeout(1200); // カウントダウン中を捉える
      await watch.screenshot({ path: 'scripts/shots/ev4-var.png' });
      console.log('VAR captured');
      gotVar = true;
    }
  }
  if (!gotReplay) {
    const r = await watch.locator('#replay-banner').isVisible().catch(() => false);
    if (r) {
      await watch.screenshot({ path: 'scripts/shots/ev5-replay.png' });
      console.log('replay captured');
      gotReplay = true;
    }
  }
  await watch.waitForTimeout(120);
}
if (!gotVar) console.log('note: VAR は今回の試合では発動せず（確率イベント）');
if (!gotReplay) console.log('note: リプレイ未捕捉');

await browser.close();
console.log('done');
