import { chromium } from 'playwright-core';
const BASE = process.env.BASE ?? 'http://localhost:8787';
const b = await chromium.launch({ channel: 'msedge', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
p.on('pageerror', e => errs.push(String(e)));
p.on('console', m => { if (m.type() === 'error') errs.push('console:' + m.text()); });
await p.goto(BASE, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(400);
await p.click('#btn-solo');
await p.waitForTimeout(500);
await p.click('#btn-auto');   // 自動配置
await p.waitForTimeout(400);
await p.click('#btn-kickoff'); // 試合へ
await p.waitForSelector('#sb', { timeout: 12000 });
await p.waitForTimeout(1500);
await p.screenshot({ path: 'scripts/shots/now-play.png' });

// ラリーを少し進めてネット/選手/名前タグを撮る
for (let i = 0; i < 300; i++) {
  const txt = await p.textContent('#hud-panel').catch(() => '');
  if (txt?.includes('サーブ')) { await p.keyboard.down(' '); await p.waitForTimeout(700); await p.keyboard.up(' '); }
  else if (txt?.includes('トスを選べ')) { await p.keyboard.press('1'); await p.waitForTimeout(400); await p.keyboard.press(' '); }
  else if (txt?.includes('スパイク')) { await p.keyboard.down(' '); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(300); await p.keyboard.up(' '); }
  else if (txt?.includes('レシーブ')) { await p.keyboard.press(' '); }
  await p.waitForTimeout(120);
  if (i === 60) await p.screenshot({ path: 'scripts/shots/now-rally.png' });
}
await p.screenshot({ path: 'scripts/shots/now-end.png' });
console.log('ERRS:', errs.slice(0, 5).join(' | ') || 'none');
await b.close();
console.log('done');
