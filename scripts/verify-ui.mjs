// UI スモーク:
//  1) メニュー表示 → ソロ開始 → 3D コート描画
//  2) 実プレイ: サーブ/トスを打ち続けて得点が動くこと
//  3) マルチプレイ: ホスト + 参加の 2 ブラウザで同一試合が同期されること
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://localhost:5173';
const outDir = process.argv[2] ?? 'scripts/shots';
const errors = [];

const browser = await chromium.launch({ channel: 'msedge', headless: true });

function watch(page, tag) {
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[${tag}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[${tag}] ${e}`));
}

const scoreOf = async (page) => {
  const a = await page.textContent('#sb-s0');
  const b = await page.textContent('#sb-s1');
  return [Number(a) || 0, Number(b) || 0];
};

// サーブは長押し→離す、その他はタイミング押しの簡易ドライバ
async function keyDriver(page) {
  const txt = (await page.textContent('#hud-panel')) ?? '';
  if (txt.includes('サーブ')) {
    await page.keyboard.down(' ');
    await page.waitForTimeout(650);
    await page.keyboard.up(' ');
  } else {
    await page.keyboard.press('2');
    await page.keyboard.press(' ');
    await page.keyboard.press('k');
  }
}

// ---------- 1+2) ソロプレイ ----------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(page, 'solo');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('h1:has-text("eVolleyball")', { timeout: 20000 });
  await page.screenshot({ path: `${outDir}/1-menu.png` });
  console.log('menu OK');

  await page.click('#btn-solo'); // → 試合準備画面
  await page.waitForSelector('#btn-kickoff', { timeout: 10000 });
  await page.click('#btn-kickoff');
  await page.waitForSelector('#sb', { timeout: 10000 });
  await page.screenshot({ path: `${outDir}/2-solo.png` });

  const deadline = Date.now() + 90000;
  let score = [0, 0];
  while (Date.now() < deadline) {
    await keyDriver(page);
    await page.waitForTimeout(300);
    score = await scoreOf(page);
    if (score[0] + score[1] >= 3) break;
  }
  console.log(`solo score progressed: ${score[0]}-${score[1]}`);
  if (score[0] + score[1] < 3) {
    console.error('NG: ソロプレイで得点が進みません');
    process.exit(1);
  }
  await page.screenshot({ path: `${outDir}/3-solo-rally.png` });
  await page.close();
}

// ---------- 3) マルチプレイ ----------
{
  const host = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const guest = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(host, 'host');
  watch(guest, 'guest');

  await host.goto(BASE, { waitUntil: 'domcontentloaded' });
  await host.click('#btn-host');
  await host.waitForSelector('#hud-room', { state: 'visible', timeout: 10000 });
  const roomText = await host.textContent('#hud-room');
  const code = roomText?.match(/[A-Z2-9]{4}/)?.[0];
  console.log('host room:', roomText);
  if (!code) {
    console.error('NG: ルームコードが取得できません');
    process.exit(1);
  }

  await guest.goto(BASE, { waitUntil: 'domcontentloaded' });
  await guest.fill('#room-code', code);
  await guest.click('#btn-join');
  await guest.waitForSelector('#sb', { timeout: 10000 });
  console.log('guest joined OK');

  await host.waitForFunction(
    () => document.getElementById('hud-room')?.textContent?.includes('参加'),
    { timeout: 5000 },
  );
  console.log('host notified of guest join');

  const deadline = Date.now() + 90000;
  let hs = [0, 0];
  while (Date.now() < deadline) {
    for (const p of [host, guest]) await keyDriver(p);
    await host.waitForTimeout(300);
    hs = await scoreOf(host);
    if (hs[0] + hs[1] >= 2) break;
  }
  const gs = await scoreOf(guest);
  console.log(`MP score host=${hs[0]}-${hs[1]} guest=${gs[0]}-${gs[1]}`);
  if (hs[0] + hs[1] < 2) {
    console.error('NG: マルチプレイで得点が進みません');
    process.exit(1);
  }
  if (Math.abs(hs[0] + hs[1] - (gs[0] + gs[1])) > 1) {
    console.error('NG: ホストとゲストのスコアがずれています');
    process.exit(1);
  }
  await host.screenshot({ path: `${outDir}/4-mp-host.png` });
  await guest.screenshot({ path: `${outDir}/5-mp-guest.png` });
  await host.close();
  await guest.close();
}

await browser.close();

if (errors.length) {
  console.log('CONSOLE ERRORS:');
  for (const e of errors) console.log(' -', e);
  process.exit(1);
}
console.log('UI/MP smoke all OK');
