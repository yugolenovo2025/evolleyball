import { chromium } from 'playwright-core';
const BASE = process.env.BASE ?? 'http://localhost:8787';
const b = await chromium.launch({ channel: 'msedge', headless: true });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
await p.goto(BASE, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(400);
await p.click('#btn-solo'); await p.waitForTimeout(400);
await p.click('#btn-auto'); await p.waitForTimeout(300);
await p.click('#btn-kickoff');
await p.waitForSelector('#sb', { timeout: 12000 });
await p.waitForTimeout(1200);
// スキルバナーを表示させて接写（控えめ版の確認）
await p.evaluate(() => {
  const fx = document.getElementById('skill-fx');
  fx.querySelector('.sk-name').textContent = 'ライトニングスパイク';
  fx.className = 'show mine';
  void fx.offsetWidth;
  fx.classList.add('play');
});
await p.waitForTimeout(180);
await p.screenshot({ path: 'scripts/shots/check-skill.png' });
await b.close();
console.log('done');
