// 選手モデルのクローズアップ（サーブ時の追従カメラは選手を後方から捉える）
import { chromium } from 'playwright-core';
const BASE = process.env.BASE ?? 'http://localhost:8787';
const b = await chromium.launch({ channel: 'msedge', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto(BASE, { waitUntil: 'domcontentloaded' });
await p.click('#btn-solo');
await p.waitForSelector('#btn-kickoff', { timeout: 10000 });
await p.click('#btn-kickoff');
await p.waitForSelector('#sb', { timeout: 10000 });
// サーブ待ち（追従カメラがサーバーを後方からアップで捉える）
await p.waitForTimeout(2500);
await p.screenshot({ path: 'scripts/shots/cu1-serve.png' });
// 長押しでトスアップ→打点（選手が跳ぶ）
await p.keyboard.down(' ');
await p.waitForTimeout(500);
await p.screenshot({ path: 'scripts/shots/cu2-charge.png' });
await p.keyboard.up(' ');
console.log('closeups captured');
await b.close();
