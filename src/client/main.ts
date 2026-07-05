import * as THREE from 'three';
import { GameRenderer } from './render';
import { Hud } from './hud';
import { Sfx } from './sfx';
import { LocalTransport, Transport, WsTransport } from './net';
import { SLOT_POS, generateCandidates, generateRoster } from '../sim/sim';
import {
  AttackChoice,
  BlockZone,
  Prompt,
  RosterEntry,
  Snapshot,
  Tactic,
  Team,
} from '../sim/types';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const menu = document.getElementById('menu')!;
const menuStatus = document.getElementById('menu-status')!;

let transport: Transport | null = null;
let renderer: GameRenderer | null = null;
let hud: Hud | null = null;
const sfx = new Sfx();

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
let latestPrompt: Prompt = null; // 左画面スライド照準などの文脈判定に使う

// 左半分のコース操作は HUD のフローティング方向スティック（#zone-l）が担当する

// UI の手触り: すべてのボタン類にクリック音
document.addEventListener('pointerdown', (e) => {
  const t = e.target as HTMLElement;
  if (t.closest('button, .opt, .sysbtn, .aim-btn, .tactic-card, #btn-action, #btn-cam')) {
    sfx.play('ui');
  }
});

// ---------- リプレイディレクター（ハイライトのスロー再生 + VAR演出） ----------

const replayBuffer: { t: number; snap: Snapshot }[] = [];
let replay: {
  start: number;
  from: number;
  span: number;
  dur: number;
  angle: number; // リプレイカメラの種類（0:オービット 1:ネット際ロー 2:観客席俯瞰）
} | null = null;
let dirEventSeq = -1;
let freezeUntil = 0; // ヒットストップ（打撃の瞬間の静止）
let lastShown: Snapshot | null = null;

// 観客音響の状態（ラリー緊張度・連続得点チャント・アウェイ）
let rallyContacts = 0;
let crowdStreakTeam = -1;
let crowdStreak = 0;
let isAway = false;

// 打撃の重み: ゲームパッド振動 + スマホバイブ
function rumble(strength: number, durMs: number) {
  const gp = navigator.getGamepads?.()[0] as any;
  gp?.vibrationActuator
    ?.playEffect?.('dual-rumble', {
      duration: durMs,
      strongMagnitude: Math.min(1, strength),
      weakMagnitude: Math.min(1, strength * 0.6),
    })
    .catch(() => {});
  navigator.vibrate?.(Math.round(durMs * 0.6));
}

function bufferSnapshot(now: number, snap: Snapshot) {
  replayBuffer.push({ t: now, snap });
  while (replayBuffer.length > 0 && now - replayBuffer[0].t > 6000) replayBuffer.shift();
}

function snapAt(t: number): Snapshot | null {
  for (let i = replayBuffer.length - 1; i >= 0; i--) {
    if (replayBuffer[i].t <= t) return replayBuffer[i].snap;
  }
  return replayBuffer[0]?.snap ?? null;
}

// VAR/リプレイの演出を毎フレーム適用。戻り値は描画に使うスナップショット
function directScene(now: number, live: Snapshot, myTeam: Team): Snapshot {
  if (!renderer || !hud) return live;

  // 新規イベント検出（ハイライトのスローリプレイ / ヒットストップ）
  for (const ev of live.events) {
    if (ev.seq <= dirEventSeq) continue;
    dirEventSeq = ev.seq;
    if (!live.varCall && (ev.kind === 'ace' || ev.kind === 'block' || ev.kind === 'point')) {
      // 直前2.3秒分を約4.3秒かけてスロー再生
      replay = {
        start: now,
        from: now - 2400,
        span: 2300,
        dur: 4300,
        angle: Math.floor(Math.random() * 3),
      };
    }
    // 打撃の瞬間の極めて短い静止（重みの演出）
    if (ev.kind === 'spike' || ev.kind === 'block') freezeUntil = now + 85;
    else if (ev.kind === 'serve') freezeUntil = now + 55;

    // 観客音響: ラリーが続くほどざわめきが高まる / 連続得点でチャント / アナウンス
    if (ev.kind === 'serve' || ev.kind === 'whistle') rallyContacts = 0;
    if (ev.kind === 'contact' || ev.kind === 'spike') rallyContacts++;
    if (
      (ev.kind === 'point' || ev.kind === 'ace' || ev.kind === 'block' || ev.kind === 'fault') &&
      ev.team !== undefined
    ) {
      if (ev.team === crowdStreakTeam) crowdStreak++;
      else {
        crowdStreakTeam = ev.team;
        crowdStreak = 1;
      }
      const nm = ev.team === 0 ? 'ブルー' : 'レッド';
      if (ev.kind === 'ace') sfx.announce(`サービスエース！ ${nm}チーム！`);
      else if (ev.kind === 'block') sfx.announce(`ブロックポイント、${nm}チーム！`);
      else if (ev.kind === 'point' && (crowdStreak >= 3 || live.score[ev.team] >= 23))
        sfx.announce(`${nm}チーム、得点！`);
      if (isAway && ev.team !== myTeam) sfx.boo(); // アウェイの洗礼
    }
  }

  // ヒットストップ中は直前のフレームを保持
  if (now < freezeUntil && lastShown) return lastShown;

  // --- VAR: 地面スレスレのクローズアップ + ズームイン ---
  const vc = live.varCall;
  if (vc) {
    replay = null;
    hud.showReplayBanner(false);
    renderer.hideLabels = true; // VAR 中も名前タグを消して判定に集中させる
    hud.showVar(vc, myTeam);
    const p = vc.pos;
    const toCenter = new THREE.Vector3(-p.x, 0, -p.z).normalize();
    const dist = 1.6 + Math.min(1.2, vc.remain * 0.35); // 徐々にズームイン
    renderer.overrideCam = {
      pos: new THREE.Vector3(p.x - toCenter.x * dist, 0.42, p.z - toCenter.z * dist),
      look: new THREE.Vector3(p.x, 0.06, p.z),
    };
    renderer.setImpact(
      p,
      vc.remain > 0.05 ? 0xffffff : vc.inCall ? 0x4dff7a : 0xff5d4d,
    );
    return live;
  }
  hud.showVar(null, myTeam);

  // --- ハイライトのスローモーションリプレイ（アングルは毎回変わる） ---
  if (replay) {
    const el = now - replay.start;
    if (el < replay.dur && live.phase === 'point') {
      const t = replay.from + (el / replay.dur) * replay.span;
      const past = snapAt(t);
      if (past) {
        hud.showReplayBanner(true);
        renderer.hideLabels = true; // リプレイ中は名前タグを消す
        const b = past.ball.pos;
        if (replay.angle === 1) {
          // ネット際・地面すれすれのローアングル
          renderer.overrideCam = {
            pos: new THREE.Vector3(b.x * 0.3, 0.7, b.z > 0 ? -5.4 : 5.4),
            look: new THREE.Vector3(b.x, Math.max(1.2, b.y * 0.8), b.z),
          };
        } else if (replay.angle === 2) {
          // 観客席からの俯瞰
          renderer.overrideCam = {
            pos: new THREE.Vector3(b.x + 7, 6.5, 9),
            look: new THREE.Vector3(b.x, 1.2, b.z),
          };
        } else {
          // ボールを中心にゆっくり回るオービット
          const a = el * 0.0006 + (myTeam === 0 ? Math.PI : 0);
          renderer.overrideCam = {
            pos: new THREE.Vector3(b.x + Math.cos(a) * 4.6, 2.4, b.z + Math.sin(a) * 4.6),
            look: new THREE.Vector3(b.x, Math.max(0.8, b.y * 0.7), b.z),
          };
        }
        return past;
      }
    }
    replay = null;
  }

  hud.showReplayBanner(false);
  renderer.hideLabels = false;
  renderer.overrideCam = null;
  renderer.setImpact(null);
  return live;
}

function directAndRemember(now: number, live: Snapshot, myTeam: Team): Snapshot {
  const shown = directScene(now, live, myTeam);
  lastShown = shown;
  return shown;
}

let manualPause = false;
let tutorialPause = false;

function applyPause() {
  if (transport instanceof LocalTransport) {
    transport.paused = manualPause || tutorialPause;
  }
}

function togglePause() {
  if (transport instanceof LocalTransport) {
    manualPause = !manualPause;
    applyPause();
    hud?.showPause(manualPause);
  }
}

function startGame(t: Transport) {
  transport = t;
  menu.style.display = 'none';
  canvas.style.display = 'block';
  renderer = new GameRenderer(canvas);
  renderer.setMyTeam(t.myTeam);
  hud = new Hud(isTouch, t instanceof LocalTransport);
  // アウェイ戦（マルチの参加側）: ブーイング + UIの微かな揺れでプレッシャーを演出
  isAway = t instanceof WsTransport && t.myTeam === 1;
  if (isAway) hud.root.classList.add('away');
  hud.onSfx = (k) => {
    sfx.play(k);
    if (k === 'spike') renderer?.shake(0.1);
    if (k === 'point' || k === 'block' || k === 'ace') renderer?.shake(0.22);
    // 打撃の瞬間にインパクト閃光 + 振動（重みの演出）
    if (k === 'spike' || k === 'serve' || k === 'block') renderer?.impactFlash();
    if (k === 'spike') rumble(0.9, 90);
    else if (k === 'block') rumble(1.0, 110);
    else if (k === 'serve') rumble(0.6, 60);
    else if (k === 'point' || k === 'ace') rumble(0.4, 130);
  };
  hud.onInput = (i) => transport?.send(i);
  hud.onToggleCam = () => renderer?.toggleCam();
  hud.onPause = togglePause;
  hud.onMenu = () => {
    transport?.close();
    location.reload();
  };
  // チュートリアルを読んでいる間は試合を止める（ソロのみ。マルチは相手がいるため不可）
  hud.onTutorial = (open) => {
    tutorialPause = open;
    applyPause();
  };
  if (t instanceof LocalTransport) hud.showTutorialIfFirst(); // 初回のみ自動表示（ソロ限定）

  let last = performance.now();
  const loop = (now: number) => {
    const dt = (now - last) / 1000;
    last = now;
    if (!transport || !renderer || !hud) return;

    pollGamepad();
    transport.tick(dt);
    const snap = transport.latestSnapshot();
    if (snap) {
      latestPrompt = snap.prompts[transport.myTeam];
      bufferSnapshot(now, snap);
      // 観客音響の状態更新（緊張度 / ホーム手拍子 / チャント / VAR静寂）
      const home = !isAway;
      sfx.updateCrowd({
        tension: Math.min(1, rallyContacts / 7),
        clap:
          home &&
          (snap.phase === 'preServe' || snap.phase === 'serve') &&
          snap.servingTeam === transport.myTeam,
        chant:
          crowdStreakTeam === transport.myTeam && crowdStreak >= 3 && snap.phase !== 'matchOver',
        quiet: !!snap.varCall,
      });
      const shown = directAndRemember(now, snap, transport.myTeam);
      renderer.render(shown, transport instanceof LocalTransport ? 1 : 0.35);
      hud.updateBallArrow(renderer.ballScreenInfo());
      hud.update(snap, transport.myTeam);
      // 試合終了 → アナリティクス・ダッシュボード（ソロのみ、少し余韻をおいて）
      if (snap.phase === 'matchOver' && !dashShown && transport instanceof LocalTransport) {
        dashShown = true;
        setTimeout(() => showDashboard(snap, transport!.myTeam), 2600);
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// ---------- ゲームパッド（アナログスティック対応） ----------
// 右スティックX: スパイク/サーブのコース・ブロックの手の出し方（倒し具合の絶対指定）
// A(×)ボタン: アクション / 十字キー: トス選択・ブロックゾーン / RB: 戦術リング

let gpPrevButtons: boolean[] = [];
let gpAimActive = false;

function pollGamepad() {
  const gp = navigator.getGamepads?.()[0];
  if (!gp || !transport) return;
  const pressed = (i: number) => gp.buttons[i]?.pressed ?? false;
  const edge = (i: number) => pressed(i) && !gpPrevButtons[i];

  // 右スティック（axes[2]）: アナログの絶対コース指定
  const rx = gp.axes[2] ?? 0;
  if (Math.abs(rx) > 0.18) {
    transport.send({ type: 'aimSet', z: rx });
    gpAimActive = true;
  } else if (gpAimActive) {
    gpAimActive = false;
  }

  if (edge(0)) transport.send({ type: 'actionDown' }); // A / ×
  if (!pressed(0) && gpPrevButtons[0]) transport.send({ type: 'actionUp' });

  // 十字キー
  if (edge(14)) {
    transport.send({ type: 'setChoice', choice: 'LEFT' });
    transport.send({ type: 'blockCommit', zone: 'L' });
  }
  if (edge(15)) {
    transport.send({ type: 'setChoice', choice: 'RIGHT' });
    transport.send({ type: 'blockCommit', zone: 'R' });
  }
  if (edge(12)) transport.send({ type: 'setChoice', choice: 'QUICK' });
  if (edge(13)) {
    transport.send({ type: 'setChoice', choice: 'PIPE' });
    transport.send({ type: 'blockCommit', zone: 'M' });
  }
  if (edge(5)) hud?.toggleRing(); // RB で戦術リング

  gpPrevButtons = gp.buttons.map((b) => b.pressed);
}

// ---------- キーボード操作 ----------

const CHOICE_BY_KEY: Record<string, AttackChoice> = {
  '1': 'LEFT',
  '2': 'QUICK',
  '3': 'RIGHT',
  '4': 'PIPE',
  '5': 'TWO',
};
const BLOCK_BY_KEY: Record<string, BlockZone> = { j: 'L', k: 'M', l: 'R' };

document.addEventListener('keydown', (e) => {
  if (!transport) return;
  const k = e.key.toLowerCase();

  if (k === ' ') {
    e.preventDefault();
    if (!e.repeat) transport.send({ type: 'actionDown' });
  } else if (k === 'arrowleft' || k === 'arrowright') {
    e.preventDefault();
    const dir = k === 'arrowleft' ? -1 : 1;
    // 文脈で sim 側が振り分ける: コース調整 / トス先 / ブロック
    transport.send({ type: 'aim', dz: dir * 0.12 });
    if (!e.repeat) {
      transport.send({ type: 'setChoice', choice: dir < 0 ? 'LEFT' : 'RIGHT' });
      transport.send({ type: 'blockCommit', zone: dir < 0 ? 'L' : 'R' });
    }
  } else if (k === 'arrowup' || k === 'arrowdown') {
    e.preventDefault();
    if (!e.repeat) {
      transport.send({ type: 'setChoice', choice: k === 'arrowup' ? 'QUICK' : 'PIPE' });
      if (k === 'arrowdown') transport.send({ type: 'blockCommit', zone: 'M' });
    }
  } else if (CHOICE_BY_KEY[k]) {
    // 戦術リング表示中は攻撃指示（プリセット）として送る
    if (hud?.ringOpen) {
      transport.send({ type: 'plan', choice: CHOICE_BY_KEY[k] });
      hud.toggleRing(false);
    } else {
      transport.send({ type: 'setChoice', choice: CHOICE_BY_KEY[k] });
    }
  } else if (k === 'q') {
    if (!e.repeat) hud?.toggleRing(true);
  } else if (k === 'v') {
    if (!e.repeat) hud?.toggleCoach();
  } else if (BLOCK_BY_KEY[k]) {
    transport.send({ type: 'blockCommit', zone: BLOCK_BY_KEY[k] });
  } else if (k === 'r') {
    transport.send({ type: 'rematch' });
  } else if (k === 'c') {
    renderer?.toggleCam();
  } else if (k === 'h') {
    hud?.openTutorial(0);
  } else if (k === 'p') {
    togglePause();
  }
});

document.addEventListener('keyup', (e) => {
  if (!transport) return;
  if (e.key === ' ') {
    e.preventDefault();
    transport.send({ type: 'actionUp' });
  } else if (e.key.toLowerCase() === 'q') {
    hud?.toggleRing(false);
  }
});

// ---------- メニュー ----------

function wsUrl(): string {
  const addr = (document.getElementById('server-addr') as HTMLInputElement).value.trim();
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  if (addr) return `${proto}://${addr}`;
  if (location.port === '5173') return `${proto}://${location.hostname}:8787`;
  return `${proto}://${location.host}`;
}

// ---------- 選手契約 & チーム編成（サラリーキャップ制） ----------

let prepTactic: Tactic = 'balanced';
let budget = 120;
let matchPts = 25; // 25 or 15
let matchSets = 1; // 1, 3, 5
let candidates: RosterEntry[][] = []; // スロット別の契約候補（LINEUP順: S,OH,MB,OP,OH,MB）
let picked: number[] = [0, 0, 0, 0, 0, 0];
let oppRoster: RosterEntry[] = [];
let myRoster: RosterEntry[] = []; // ダッシュボードでの平均比較用（試合前の契約データ）
let dashShown = false;

// コート上のカード配置（上=ネット側が前衛）
const CARD_POS: { top: number; left: number }[] = [
  { top: 56, left: 70 }, // S(後衛右)
  { top: 8, left: 6 }, // OH1(前衛左)
  { top: 8, left: 38 }, // MB1(前衛中)
  { top: 8, left: 70 }, // OP(前衛右)
  { top: 56, left: 6 }, // OH2(後衛左)
  { top: 56, left: 38 }, // MB2(後衛中)
];
const KEY_STATS: Record<string, (keyof RosterEntry['st'])[]> = {
  S: ['teamwork', 'decision', 'agility'],
  OH: ['spike', 'jump', 'receive'],
  MB: ['block', 'agility', 'jump'],
  OP: ['spike', 'power', 'jump'],
};
const ST_LABEL: Record<string, string> = {
  spike: 'スパイク', power: 'パワー', block: 'ブロック', receive: 'レシーブ',
  jump: 'ジャンプ', agility: '敏捷', teamwork: '連携', decision: '判断',
};

const myTeamOf = () => picked.map((ci, s) => candidates[s][ci]);
const totalCost = () => myTeamOf().reduce((sum, r) => sum + r.cost, 0);
const teamPower = () => myTeamOf().reduce((sum, r) => sum + r.rating, 0);

// 予算内で総合値最大を狙う自動配置（最高評価から始め、コスパの悪い順に格下げ）
function autoAssign() {
  picked = candidates.map((list) => list.reduce((bi, r, i) => (r.rating > list[bi].rating ? i : bi), 0));
  let guard = 0;
  while (totalCost() > budget && guard++ < 60) {
    let best = -1;
    let bestScore = -Infinity;
    let bestAlt = 0;
    for (let s = 0; s < 6; s++) {
      const cur = candidates[s][picked[s]];
      for (let i = 0; i < candidates[s].length; i++) {
        const alt = candidates[s][i];
        if (alt.cost >= cur.cost) continue;
        const score = (cur.cost - alt.cost) * 3 - (cur.rating - alt.rating); // 安く・弱くなりすぎない
        if (score > bestScore) {
          bestScore = score;
          best = s;
          bestAlt = i;
        }
      }
    }
    if (best < 0) break;
    picked[best] = bestAlt;
  }
}

function refreshPrep() {
  const total = totalCost();
  const fill = document.getElementById('capbar-fill')!;
  const pct = Math.min(100, (total / budget) * 100);
  fill.style.width = `${pct}%`;
  fill.className = total > budget ? 'over' : total > budget * 0.85 ? 'warn' : '';
  document.getElementById('cap-text')!.textContent = `${total} / ${budget}`;
  document.getElementById('team-power')!.textContent = String(teamPower());
  const kick = document.getElementById('btn-kickoff') as HTMLButtonElement;
  kick.disabled = total > budget;
  kick.textContent = total > budget ? '予算オーバー' : '試合へ ›';

  // コート上のカード
  const court = document.getElementById('court-cards')!;
  court.innerHTML = myTeamOf()
    .map((r, s) => {
      const p = CARD_POS[s];
      const skillDots = r.skills.map((sk) => `<i title="${sk}">★</i>`).join('');
      return `
      <div class="pcard ${r.rating >= 78 ? 'elite' : ''}" data-slot="${s}"
           style="top:${p.top}%;left:${p.left}%">
        <div class="pc-row"><b class="pc-pos p-${r.pos}">${r.pos}</b><b class="pc-rate">${r.rating}</b></div>
        <div class="pc-name">${r.name}</div>
        <div class="pc-row2"><span class="pc-cost">C${r.cost}</span>${skillDots}${r.focus ? '<em>特</em>' : ''}</div>
      </div>`;
    })
    .join('');

  // 相手のコスト配分（データ・スカウティング: 編成コンセプトのチラ見せ）
  const grp: Record<string, number> = { S: 0, OH: 0, MB: 0, OP: 0 };
  for (const r of oppRoster) grp[r.pos] += r.cost;
  const gmax = Math.max(...Object.values(grp), 1);
  document.getElementById('opp-graph')!.innerHTML = (['OP', 'OH', 'MB', 'S'] as const)
    .map(
      (k) => `<div class="og-row"><span>${k}</span>
        <div class="og-bar"><div style="width:${((grp[k] / gmax) * 100).toFixed(0)}%"></div></div>
        <b>${grp[k]}</b></div>`,
    )
    .join('');

  // マッチアップ相性: 自分の最強ブロッカー vs 相手エース（最高スパイク）の統計的サジェスト
  const myBlocker = myTeamOf().reduce((b, r) => (r.st.block > b.st.block ? r : b));
  const oppAce = oppRoster.reduce((a, r) => (r.st.spike > a.st.spike ? r : a));
  const stopPct = Math.round(
    clampNum(28 + (myBlocker.st.block - oppAce.st.spike) * 0.55 + myBlocker.st.jump * 0.12, 8, 92),
  );
  document.getElementById('matchup')!.innerHTML = `
    <div class="mu-line"><b>${myBlocker.name}</b>(壁${myBlocker.st.block}) なら</div>
    <div class="mu-line">相手エース <b>${oppAce.name}</b>(攻${oppAce.st.spike}) の</div>
    <div class="mu-line">スパイクを <b class="mu-pct">${stopPct}%</b> 止められる</div>`;
}

function clampNum(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

// 試合後のアナリティクス・ダッシュボード（MVP + 個人スタッツ）
function showDashboard(snap: Snapshot, myTeam: Team) {
  const mine = snap.players.filter((p) => p.team === myTeam);
  // 貢献度スコア = 決定*3 + ブロック*3 + ディグ + エース*2
  const contrib = (p: (typeof mine)[number]) =>
    p.mstats.kills * 3 + p.mstats.blocks * 3 + p.mstats.digs + p.mstats.aces * 2;
  const mvp = mine.reduce((a, b) => (contrib(b) > contrib(a) ? b : a));
  const won = snap.winner === myTeam;

  // MVP の理由: 決定率が「契約時データ(推定平均)」よりどれだけ高かったか
  const killRate = mvp.mstats.atk > 0 ? mvp.mstats.kills / mvp.mstats.atk : 0;
  const baseRate = mvp.stats.attack * 0.6; // 能力からの期待決定率
  const diff = Math.round((killRate - baseRate) * 100);
  let reason: string;
  if (mvp.mstats.blocks >= 3) reason = `ブロックを ${mvp.mstats.blocks} 本決め、守備で流れを作りました`;
  else if (mvp.mstats.aces >= 2) reason = `サービスエースを ${mvp.mstats.aces} 本奪いました`;
  else if (mvp.mstats.atk >= 4)
    reason = `スパイク決定率が期待値より ${diff >= 0 ? '+' : ''}${diff}% 高い働きでした`;
  else reason = `レシーブ ${mvp.mstats.digs} 本でラリーを支えました`;

  document.getElementById('dash-title')!.textContent = won
    ? `WIN ${snap.sets[myTeam]}-${snap.sets[1 - myTeam]} — 本日のデータ・インサイト`
    : `LOSE ${snap.sets[myTeam]}-${snap.sets[1 - myTeam]} — 本日のデータ・インサイト`;
  document.getElementById('dash-mvp')!.innerHTML = `
    <div class="mvp-badge">MVP</div>
    <div class="mvp-name">${mvp.name} <span>#${mvp.num} ${mvp.role}</span></div>
    <div class="mvp-reason">${reason}</div>`;

  const rows = [...mine]
    .sort((a, b) => contrib(b) - contrib(a))
    .map((p) => {
      const kr = p.mstats.atk > 0 ? Math.round((p.mstats.kills / p.mstats.atk) * 100) : 0;
      return `<tr class="${p === mvp ? 'mvp' : ''}">
        <td class="dn">${p.role} ${p.name}</td>
        <td>${p.mstats.kills}/${p.mstats.atk}<em>(${kr}%)</em></td>
        <td>${p.mstats.blocks}</td>
        <td>${p.mstats.digs}</td>
        <td>${p.mstats.aces}</td></tr>`;
    })
    .join('');
  document.getElementById('dash-table')!.innerHTML = `
    <table><thead><tr><th>選手</th><th>決定/試行</th><th>ブロック</th><th>レシーブ</th><th>エース</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
  document.getElementById('dash')!.style.display = 'flex';
}

function openPicker(slot: number) {
  const pos = SLOT_POS[slot];
  document.getElementById('picker-title')!.textContent =
    `${pos} の契約候補 — 鍵となる能力: ${KEY_STATS[pos].map((k) => ST_LABEL[k]).join(' / ')}`;
  document.getElementById('picker-list')!.innerHTML = candidates[slot]
    .map((r, i) => {
      const stats = KEY_STATS[pos]
        .map((k) => `<span class="ps"><em>${ST_LABEL[k]}</em><b>${r.st[k]}</b></span>`)
        .join('');
      const skills = r.skills.map((sk) => `<span class="sk">★${sk}</span>`).join('');
      // 調子の波（スパークライン）
      const spark = r.trend
        .map((v, ti) => {
          const h = 4 + v * 18;
          return `<i style="height:${h}px" class="${ti === 2 && v > 0.7 ? 'hot' : ''}"></i>`;
        })
        .join('');
      const formTag =
        r.form >= 1.08
          ? '<span class="form up">絶好調</span>'
          : r.form <= 0.9
            ? '<span class="form dn">不調</span>'
            : '';
      // 攻撃傾向ヒートマップ（L/C/R）
      const heat = (['L', 'C', 'R'] as const)
        .map(
          (k) =>
            `<i style="opacity:${(0.2 + r.tendency[k] * 0.8).toFixed(2)}" title="${k}"></i>`,
        )
        .join('');
      const sig = r.signature ? `<span class="sig">◈ ${r.signature}</span>` : '';
      return `
      <div class="cand ${picked[slot] === i ? 'sel' : ''}" data-i="${i}">
        <div class="cand-l"><b class="pc-rate">${r.rating}</b><span class="pc-cost">C${r.cost}</span></div>
        <div class="cand-m">
          <div class="cand-name">${r.name} ${r.focus ? `<em class="focus">${r.focus}</em>` : ''} ${formTag}</div>
          <div class="cand-stats">${stats}</div>
          <div class="cand-skills">${sig}${skills}${!sig && !skills ? '<span class="nosk">スキルなし</span>' : ''}</div>
        </div>
        <div class="cand-r">
          <div class="ana-lbl">調子</div><div class="spark">${spark}</div>
          <div class="ana-lbl">攻撃傾向</div><div class="heat">${heat}</div>
        </div>
      </div>`;
    })
    .join('');
  const pk = document.getElementById('picker')!;
  pk.style.display = 'flex';
  pk.dataset.slot = String(slot);
}

function showPrep() {
  menu.style.display = 'none';
  document.getElementById('prep')!.style.display = 'flex';
  candidates = SLOT_POS.map((pos) => generateCandidates(pos, 5));
  oppRoster = generateRoster(budget);
  autoAssign();
  refreshPrep();
}

document.getElementById('tactic-row')!.addEventListener('pointerdown', (e) => {
  const card = (e.target as HTMLElement).closest<HTMLElement>('.tactic-card');
  if (!card) return;
  document.querySelectorAll('.tactic-card').forEach((c) => c.classList.remove('sel'));
  card.classList.add('sel');
  prepTactic = (card.dataset.tactic as Tactic) ?? 'balanced';
});

document.getElementById('len-row')!.addEventListener('pointerdown', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('.len-pick');
  if (!b) return;
  if (b.dataset.pts) {
    document.querySelectorAll('.len-pick[data-pts]').forEach((c) => c.classList.remove('sel'));
    b.classList.add('sel');
    matchPts = Number(b.dataset.pts);
  } else if (b.dataset.sets) {
    document.querySelectorAll('.len-pick[data-sets]').forEach((c) => c.classList.remove('sel'));
    b.classList.add('sel');
    matchSets = Number(b.dataset.sets);
  }
});

document.getElementById('budget-row')!.addEventListener('pointerdown', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('.budget-pick');
  if (!b) return;
  document.querySelectorAll('.budget-pick').forEach((c) => c.classList.remove('sel'));
  b.classList.add('sel');
  budget = Number(b.dataset.budget ?? 120);
  oppRoster = generateRoster(budget); // 相手も同予算で再編成
  autoAssign();
  refreshPrep();
});

document.getElementById('court-cards')!.addEventListener('pointerdown', (e) => {
  const card = (e.target as HTMLElement).closest<HTMLElement>('.pcard');
  if (card) openPicker(Number(card.dataset.slot));
});
document.getElementById('picker-list')!.addEventListener('pointerdown', (e) => {
  const c = (e.target as HTMLElement).closest<HTMLElement>('.cand');
  if (!c) return;
  const slot = Number(document.getElementById('picker')!.dataset.slot ?? 0);
  picked[slot] = Number(c.dataset.i ?? 0);
  document.getElementById('picker')!.style.display = 'none';
  refreshPrep();
});
document.getElementById('picker-close')!.addEventListener('pointerdown', () => {
  document.getElementById('picker')!.style.display = 'none';
});
document.getElementById('btn-auto')!.addEventListener('pointerdown', () => {
  autoAssign();
  refreshPrep();
});
document.getElementById('btn-back')!.addEventListener('pointerdown', () => {
  document.getElementById('prep')!.style.display = 'none';
  menu.style.display = 'flex';
});

document.getElementById('btn-kickoff')!.addEventListener('click', () => {
  if (totalCost() > budget) return; // 予算オーバーは出撃不可
  document.getElementById('prep')!.style.display = 'none';
  myRoster = myTeamOf();
  startGame(
    new LocalTransport(false, true, 0, [myRoster, oppRoster], prepTactic, {
      basePts: matchPts,
      bestOf: matchSets,
    }),
  );
});

document.getElementById('dash-close')!.addEventListener('pointerdown', () => location.reload());

document.getElementById('btn-solo')!.addEventListener('click', showPrep);

// スプラッシュ → タップでメニューへ（音声はユーザー操作で有効化される）
{
  const splash = document.getElementById('splash')!;
  const dismiss = () => {
    if (splash.classList.contains('hide')) return;
    splash.classList.add('hide');
    menu.style.display = 'flex';
    sfx.play('ui');
    setTimeout(() => (splash.style.display = 'none'), 500);
  };
  splash.addEventListener('pointerdown', dismiss);
  // 自動テスト（Playwright）ではスプラッシュを即スキップ
  if (navigator.webdriver) {
    splash.style.display = 'none';
    menu.style.display = 'flex';
  }
}

document.getElementById('btn-watch')!.addEventListener('click', () => {
  startGame(new LocalTransport(true, true, 0));
});

document.getElementById('btn-host')!.addEventListener('click', () => {
  menuStatus.textContent = '接続中...';
  const t = new WsTransport(wsUrl(), 'host');
  t.onError = (m) => (menuStatus.textContent = m);
  t.onReady = (_team: Team, code: string) => {
    startGame(t);
    hud?.setRoomInfo(`ルームコード: ${code} — 友達の参加待ち（AIが代行中）`);
    t.onStatus = (m) => hud?.setRoomInfo(`ルーム ${code}: ${m}`);
  };
});

document.getElementById('btn-join')!.addEventListener('click', () => {
  const code = (document.getElementById('room-code') as HTMLInputElement).value
    .trim()
    .toUpperCase();
  if (!code) {
    menuStatus.textContent = 'ルームコードを入力してください';
    return;
  }
  menuStatus.textContent = '接続中...';
  const t = new WsTransport(wsUrl(), 'join', code);
  t.onError = (m) => (menuStatus.textContent = m);
  t.onReady = (_team: Team, c: string) => {
    startGame(t);
    hud?.setRoomInfo(`ルーム ${c} に参加中（あなたは RED）`);
    t.onStatus = (m) => hud?.setRoomInfo(`ルーム ${c}: ${m}`);
  };
});
