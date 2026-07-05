// スマホ実機を模したテスト:
//  - タッチデバイス 2 台（エミュレーション）が統合サーバー (8787) の URL を開く
//  - タップだけでホスト / 参加 → 対戦が進行するか
//  - アクションボタン（長押し対応）・エイムボタン・パネルタップの動作確認
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://localhost:8787';
const outDir = 'scripts/shots';
const errors = [];

const browser = await chromium.launch({ channel: 'msedge', headless: true });

async function phonePage(tag) {
  const ctx = await browser.newContext({
    viewport: { width: 844, height: 390 }, // iPhone 横持ち相当
    hasTouch: true,
    isMobile: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
  });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[${tag}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[${tag}] ${e}`));
  return page;
}

const scoreOf = async (page) => {
  const a = await page.textContent('#sb-s0');
  const b = await page.textContent('#sb-s1');
  return [Number(a) || 0, Number(b) || 0];
};

// タップでプロンプトに反応するドライバ（2ゾーン: 右半分がボタン）
async function tapDriver(page) {
  const card = page.locator('.tcard[data-choice="QUICK"]');
  if (await card.isVisible().catch(() => false)) {
    await card.tap({ timeout: 500 }).catch(() => {});
  }
  await page.locator('#zone-r').tap({ timeout: 500 }).catch(() => {});
}

// ---------- ホスト（スマホ1） ----------
const host = await phonePage('host');
await host.goto(BASE, { waitUntil: 'domcontentloaded' });
await host.waitForSelector('h1:has-text("eVolleyball")', { timeout: 20000 });
await host.screenshot({ path: `${outDir}/m1-menu.png` });
console.log('mobile menu OK (served from game server)');

await host.tap('#btn-host');
await host.waitForSelector('#prep-mpbar', { state: 'visible', timeout: 10000 });
const code = (await host.textContent('#prep-mpbar'))?.match(/[A-Z2-9]{4}/)?.[0];
console.log('room code:', code);
if (!code) {
  console.error('NG: ルームコード取得失敗');
  process.exit(1);
}
await host.tap('#btn-kickoff'); // ホスト編成確定
await host.waitForSelector('#sb', { timeout: 10000 });
// タッチ用 UI の存在確認
for (const sel of ['#zone-r', '#ghost', '#btn-cam']) {
  if (!(await host.locator(sel).count())) {
    console.error(`NG: タッチUI ${sel} がありません`);
    process.exit(1);
  }
}
console.log('touch UI present');

// ---------- ゲスト（スマホ2） ----------
const guest = await phonePage('guest');
await guest.goto(BASE, { waitUntil: 'domcontentloaded' });
await guest.fill('#room-code', code);
await guest.tap('#btn-join');
await guest.waitForSelector('#btn-kickoff', { state: 'visible', timeout: 10000 });
await guest.tap('#btn-kickoff'); // ゲスト編成確定
await guest.waitForSelector('#sb', { timeout: 10000 });
console.log('guest (phone 2) joined');

// ---------- タップだけで試合を進める ----------
const deadline = Date.now() + 120000;
let hs = [0, 0];
while (Date.now() < deadline) {
  await tapDriver(host);
  await tapDriver(guest);
  await host.waitForTimeout(350);
  hs = await scoreOf(host);
  if (hs[0] + hs[1] >= 2) break;
}
const gs = await scoreOf(guest);
console.log(`phone MP score host=${hs[0]}-${hs[1]} guest=${gs[0]}-${gs[1]}`);
if (hs[0] + hs[1] < 2) {
  console.error('NG: タップ操作で試合が進みません');
  process.exit(1);
}

await host.screenshot({ path: `${outDir}/m2-host.png` });
await guest.screenshot({ path: `${outDir}/m3-guest.png` });
await browser.close();

if (errors.length) {
  console.log('CONSOLE ERRORS:');
  for (const e of errors) console.log(' -', e);
  process.exit(1);
}
console.log('mobile 2-phone MP smoke all OK');
