// スキル発動エフェクトの捕捉（AI観戦でスキルイベントを待ち受けてスクショ）
import { chromium } from 'playwright-core';
const BASE = process.env.BASE ?? 'http://localhost:8787';
const b = await chromium.launch({ channel: 'msedge', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto(BASE, { waitUntil: 'domcontentloaded' });
await p.click('#btn-watch');
await p.waitForSelector('#sb', { timeout: 10000 });
// skill-fx が show になる瞬間を待つ
let got = false;
const deadline = Date.now() + 120000;
while (Date.now() < deadline && !got) {
  const cls = await p.evaluate(() => document.getElementById('skill-fx')?.className || '');
  if (cls.includes('show')) {
    await p.waitForTimeout(180); // ネーム登場のピーク
    await p.screenshot({ path: 'scripts/shots/skill-fx.png' });
    const name = await p.evaluate(() => document.querySelector('#skill-fx .sk-name')?.textContent || '');
    console.log('skill captured:', name);
    got = true;
  }
  await p.waitForTimeout(60);
}
if (!got) console.log('note: スキル未発動（契約次第）');
await b.close();
console.log('done');
