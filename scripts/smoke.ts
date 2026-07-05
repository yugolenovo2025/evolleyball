// ヘッドレス動作確認: AI vs AI で 1 セット完走できるか、
// および人間入力パス（チャージサーブ/レシーブ/トス/スパイク/ブロック）が通るかを検証する。
import { VolleySim } from '../src/sim/sim';

function run(label: string, sim: VolleySim, driver?: (sim: VolleySim) => void): void {
  const dt = 1 / 60;
  let steps = 0;
  const maxSteps = 60 * 60 * 30; // 実時間30分ぶんで打ち切り
  const eventCounts: Record<string, number> = {};
  let seen = -1;

  while (sim.phase !== 'matchOver' && steps < maxSteps) {
    sim.step(dt);
    driver?.(sim);
    for (const ev of sim.events) {
      if (ev.seq > seen) {
        seen = ev.seq;
        eventCounts[ev.kind] = (eventCounts[ev.kind] ?? 0) + 1;
      }
    }
    steps++;
  }

  const snap = sim.snapshot();
  console.log(`--- ${label} ---`);
  console.log(`phase=${snap.phase} score=${snap.score[0]}-${snap.score[1]} winner=${snap.winner}`);
  console.log(`events:`, eventCounts);
  if (sim.phase !== 'matchOver') {
    console.error(`NG: ${label} が ${maxSteps} ステップ以内に終了しませんでした`);
    process.exit(1);
  }
  if (Math.max(...snap.score) < 25) {
    console.error(`NG: スコアが 25 に達していません`);
    process.exit(1);
  }
  console.log(`OK\n`);
}

// 1) AI vs AI
run('AI vs AI', new VolleySim(true, true));

// 2) チーム0 を疑似人間として操作（毎フレーム、プロンプトに反応する単純ドライバ）
{
  const sim = new VolleySim(false, true);
  run('疑似人間 vs AI', sim, (s) => {
    const snap = s.snapshot();
    const p = snap.prompts[0];
    if (!p) return;
    switch (p.mode) {
      case 'serve': {
        if (!p.charging) {
          s.input(0, { type: 'aim', dz: Math.random() * 0.4 - 0.2 });
          s.input(0, { type: 'actionDown' });
        } else if (p.power >= 0.72) {
          s.input(0, { type: 'actionUp' });
        }
        return;
      }
      case 'receive': {
        if (!p.pressed && p.arriveIn < 0.05) s.input(0, { type: 'actionDown' });
        return;
      }
      case 'set': {
        if (!p.pressed) {
          const choices = ['LEFT', 'QUICK', 'RIGHT', 'PIPE', 'TWO'] as const;
          s.input(0, { type: 'setChoice', choice: choices[Math.floor(Math.random() * 5)] });
          if (p.arriveIn < 0.05) s.input(0, { type: 'actionDown' });
        }
        return;
      }
      case 'spike': {
        if (!p.charging && !p.locked && p.arriveIn > 0.25) {
          s.input(0, { type: 'aim', dz: Math.random() * 0.5 - 0.25 });
          s.input(0, { type: 'actionDown' });
        } else if (p.charging && p.power > 0.6) {
          s.input(0, { type: 'actionUp' });
        }
        return;
      }
      case 'block': {
        if (!p.committed && Math.random() < 0.05) {
          const zones = ['L', 'M', 'R'] as const;
          s.input(0, { type: 'blockCommit', zone: zones[Math.floor(Math.random() * 3)] });
        }
        if (!p.jumped && Math.random() < 0.03) s.input(0, { type: 'actionDown' });
        return;
      }
    }
  });
}

// 3) 完全放置テスト: 人間チームが何も入力しなければ自動プレーは一切発生せず、
//    8秒ルール違反やノータッチで負け続けて試合が終わること
{
  const sim = new VolleySim(false, true);
  const dt = 1 / 60;
  let steps = 0;
  while (sim.phase !== 'matchOver' && steps < 60 * 60 * 30) {
    sim.step(dt);
    steps++;
  }
  const snap = sim.snapshot();
  console.log(`--- 放置テスト --- score=${snap.score[0]}-${snap.score[1]} winner=${snap.winner}`);
  if (sim.phase !== 'matchOver' || snap.winner !== 1) {
    console.error('NG: 無入力でも試合が進んでしまっている（自動プレーが残存）');
    process.exit(1);
  }
  console.log('OK: 無入力では一切プレーされず敗北する\n');
}

// 4) セット制テスト: 3セットマッチ(25点、最終セット15点)が正しく決着するか
{
  const sim = new VolleySim(true, true);
  sim.setMatchLength(25, 3);
  const dt = 1 / 60;
  let steps = 0;
  let sawDecider15 = false;
  while (sim.phase !== 'matchOver' && steps < 60 * 60 * 90) {
    sim.step(dt);
    const s = sim.snapshot();
    if (s.sets[0] === 1 && s.sets[1] === 1 && s.targetPts === 15) sawDecider15 = true;
    steps++;
  }
  const snap = sim.snapshot();
  console.log(
    `--- 3セットマッチ --- sets=${snap.sets[0]}-${snap.sets[1]} winner=${snap.winner} 最終15点=${sawDecider15}`,
  );
  const wsets = snap.sets[snap.winner!];
  if (sim.phase !== 'matchOver' || wsets !== 2) {
    console.error('NG: 3セットマッチが2セット先取で終わっていない');
    process.exit(1);
  }
  console.log('OK: 3セットマッチが正しく決着\n');
}

console.log('スモークテスト全件 OK');
