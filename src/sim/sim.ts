import {
  AttackChoice,
  BlockZone,
  COURT_HALF_X,
  COURT_HALF_Z,
  Input,
  LINEUP,
  MatchStats,
  NET_HEIGHT,
  Phase,
  PlayerSnap,
  PlayerStats,
  Prompt,
  Role,
  RosterEntry,
  SimEvent,
  Snapshot,
  TARGET_SCORE,
  Tactic,
  Team,
  TossQuality,
  V3,
  clamp,
  dist2d,
  v3,
} from './types';
import {
  approachPos,
  basePos,
  mirror,
  servePos,
  serveTarget,
  setterSpot,
} from './formations';

interface PlayerState {
  team: Team;
  role: Role;
  slot: number;
  pos: V3;
  vel: { x: number; z: number }; // 慣性移動用の速度
  target: V3;
  human: boolean;
  actKind: 'jump' | 'dig' | 'lunge' | 'set' | 'spike' | 'serve' | null;
  actStart: number;
  actDur: number;
  roster: RosterEntry;
  mstats: MatchStats; // 試合中の個人成績
  stamina: number; // 現在の体力 0..1（消耗すると精度・速さが落ちる）
}

// ---- ロースター生成（将来の契約・育成機能はここを差し替える） ----

const SURNAMES = [
  '佐藤', '鈴木', '高橋', '田中', '伊藤', '渡辺', '山本', '中村', '小林', '加藤',
  '吉田', '山田', '松本', '井上', '木村', '林', '斎藤', '清水', '山口', '阿部',
  '森', '池田', '橋本', '石川', '前田', '藤田', '後藤', '岡田', '長谷川', '村上',
];

// ---- ステータス生成（1-99）とコスト算出。このゲームの核 ----

import type { PosKey, Stats99 } from './types';

// ポジション別のステータス傾向（中央値）。stamina: OH/OP高、Sやや低、L中〜高
const POS_PROFILE: Record<PosKey, Stats99> = {
  S: { spike: 34, power: 38, block: 42, receive: 58, jump: 50, agility: 66, teamwork: 74, decision: 72, stamina: 60 },
  OH: { spike: 70, power: 60, block: 52, receive: 64, jump: 70, agility: 62, teamwork: 56, decision: 54, stamina: 74 },
  MB: { spike: 58, power: 62, block: 76, receive: 38, jump: 74, agility: 64, teamwork: 50, decision: 56, stamina: 58 },
  OP: { spike: 78, power: 74, block: 56, receive: 42, jump: 70, agility: 54, teamwork: 46, decision: 52, stamina: 72 },
  L: { spike: 10, power: 20, block: 12, receive: 84, jump: 40, agility: 82, teamwork: 66, decision: 78, stamina: 78 },
};

// コスト/総合値の重み（各ポジションの鍵となる能力）
const POS_WEIGHTS: Record<PosKey, Partial<Record<keyof Stats99, number>>> = {
  S: { teamwork: 0.34, decision: 0.24, agility: 0.16, receive: 0.18, stamina: 0.08 }, // 司令塔: 連携が鍵
  OH: { spike: 0.3, jump: 0.24, agility: 0.14, receive: 0.2, stamina: 0.12 }, // 攻撃の柱: 高コスト枠
  MB: { block: 0.34, agility: 0.22, jump: 0.26, power: 0.12, stamina: 0.06 }, // 守備と撹乱: コスパ枠
  OP: { spike: 0.34, power: 0.28, jump: 0.22, decision: 0.08, stamina: 0.08 }, // 得点源: 最高コスト
  L: { receive: 0.42, agility: 0.28, decision: 0.2, stamina: 0.1 }, // 守備の要: 低コスト
};

// ポジション別スキルプール（効果実装済み。最大2つ／無い選手もいる）
const SKILL_POOL: Record<PosKey, string[]> = {
  OH: ['強打', 'フェイント', '空中姿勢調整', 'デッドエンド', '変幻自在'],
  OP: ['決定力', 'バックアタック', '強心臓', 'デッドエンド', '強打'],
  MB: ['囮の達人', '速攻', 'リードブロック', '鉄壁の守護'],
  S: ['クイックトス', 'フェイント', '完璧な導き', '戦術指示'],
  L: ['スーパーレシーブ', '守備範囲拡大', '先読み', '鉄壁の守護'],
};

const rnd99 = (mid: number, spread = 22) =>
  Math.max(1, Math.min(99, Math.round(mid + (Math.random() * 2 - 1) * spread)));

export function posRating(pos: PosKey, st: Stats99): number {
  const w = POS_WEIGHTS[pos];
  let sum = 0;
  for (const k of Object.keys(w) as (keyof Stats99)[]) sum += st[k] * (w[k] ?? 0);
  return Math.round(sum);
}

// Stats99 → シム内部の 0..1 値
function deriveSim(st: Stats99): PlayerStats {
  return {
    attack: (st.spike * 0.65 + st.power * 0.35) / 99,
    block: st.block / 99,
    receive: st.receive / 99,
    serve: (st.power * 0.4 + st.spike * 0.3 + st.decision * 0.3) / 99,
    speed: st.agility / 99,
  };
}

let candSeq = 0;

// 契約候補を1人生成する
export function genCandidate(pos: PosKey): RosterEntry {
  const prof = POS_PROFILE[pos];
  const st: Stats99 = {
    spike: rnd99(prof.spike),
    power: rnd99(prof.power),
    block: rnd99(prof.block),
    receive: rnd99(prof.receive),
    jump: rnd99(prof.jump),
    agility: rnd99(prof.agility),
    teamwork: rnd99(prof.teamwork),
    decision: rnd99(prof.decision),
    stamina: rnd99(prof.stamina),
  };
  // 特化型契約: 役割特化で総合は低いがコストが激安になる
  let focus: string | null = null;
  if ((pos === 'OH' || pos === 'MB') && Math.random() < 0.15) {
    focus = 'レシーブ特化';
    st.receive = Math.min(99, st.receive + 20);
    st.spike = Math.max(1, st.spike - 18);
  }
  const rating = posRating(pos, st);
  let cost = Math.max(4, Math.round(rating * 0.28 - 6 + Math.random() * 2));
  if (focus) cost = Math.max(3, Math.round(cost * 0.55));
  // スキル: 40%で1つ、18%でさらにもう1つ
  const skills: string[] = [];
  const pool = [...SKILL_POOL[pos]].sort(() => Math.random() - 0.5);
  if (Math.random() < 0.4) skills.push(pool[0]);
  if (skills.length && Math.random() < 0.45) skills.push(pool[1]);
  if (skills.length) cost += skills.length * 2; // スキル持ちは少し高い

  // ---- データアナリティクス ----
  // 攻撃コース傾向（この選手の「癖」。CPU は実際にこの分布で打つ）
  const raw = { L: 0.5 + Math.random(), C: 0.3 + Math.random(), R: 0.5 + Math.random() };
  if (pos === 'MB') raw.C += 1.4; // MB は中央（クイック）寄り
  if (pos === 'OP') raw.R += 1.2; // OP は右（バック）寄り
  const tsum = raw.L + raw.C + raw.R;
  const tendency = { L: raw.L / tsum, C: raw.C / tsum, R: raw.R / tsum };
  // 調子の波（0.85..1.15）と過去3試合トレンド
  const form = 0.85 + Math.random() * 0.3;
  const trend: [number, number, number] = [
    clamp(form - 0.3 + Math.random() * 0.4, 0.1, 1),
    clamp(form - 0.25 + Math.random() * 0.4, 0.1, 1),
    clamp(form - 0.15 + Math.random() * 0.35, 0.1, 1),
  ];
  // シグネチャー・ムーブ（データ分析で抽出された癖。能力値の突出から決める）
  let signature: string | null = null;
  if (st.agility >= 82) signature = '高速リアクション';
  else if (st.spike >= 85) signature = '爆発的パワー';
  else if (st.block >= 85) signature = '鉄壁ウォール';
  else if (st.teamwork >= 85) signature = '精密コンダクター';
  else if (st.jump >= 88) signature = '滞空マスター';

  return {
    name: SURNAMES[candSeq++ % SURNAMES.length],
    num: 1 + Math.floor(Math.random() * 30),
    height: 0.93 + (st.jump / 99) * 0.1 + (pos === 'MB' ? 0.04 : 0),
    pos,
    st,
    rating,
    cost,
    skills,
    focus,
    stats: deriveSim(st),
    form,
    trend,
    tendency,
    signature,
  };
}

// スロット順 (S, OH1, MB1, OP, OH2, MB2) の候補ポジション
export const SLOT_POS: PosKey[] = ['S', 'OH', 'MB', 'OP', 'OH', 'MB'];

export function generateCandidates(pos: PosKey, n: number): RosterEntry[] {
  return Array.from({ length: n }, () => genCandidate(pos));
}

// 予算内で6人を自動編成（CPU用/自動配置ボタン用）
export function generateRoster(budget = 150): RosterEntry[] {
  const names = [...SURNAMES].sort(() => Math.random() - 0.5);
  let team = SLOT_POS.map((pos) => genCandidate(pos));
  // 予算を超えていたら、最もコストの高い選手を安い候補に差し替えて収める
  let guard = 0;
  while (team.reduce((s, r) => s + r.cost, 0) > budget && guard++ < 40) {
    const iMax = team.reduce((mi, r, i) => (r.cost > team[mi].cost ? i : mi), 0);
    const alt = genCandidate(SLOT_POS[iMax]);
    if (alt.cost < team[iMax].cost) team[iMax] = alt;
  }
  // 名前の重複を回避
  team = team.map((r, i) => ({ ...r, name: names[i] }));
  return team;
}

// 予約モーション（トスが上がりきる直前にスパイカー/ブロッカーが跳ぶ等）
interface PendingAct {
  at: number;
  kind: 'attackJump' | 'blockJump' | 'celebrateJump';
  playerIdx?: number;
  defTeam?: Team;
  z?: number;
}

type ContactPlan =
  | { kind: 'receive'; team: Team; playerIdx: number; serveQ: TossQuality; servePow: number }
  | { kind: 'dig'; team: Team; playerIdx: number }
  | { kind: 'set'; team: Team }
  | {
      kind: 'attack';
      team: Team;
      choice: AttackChoice;
      quality: TossQuality;
      attackerIdx: number;
    }
  | { kind: 'floor'; scorer: Team; msg: string; ev: SimEvent['kind'] }
  // シャットブロック: ブロッカーの手に当たる瞬間（このあと跳ね返りの軌道に移る）
  | { kind: 'blockTouch'; defTeam: Team; blockerIdx: number; land: V3 };

interface Flight {
  p0: V3;
  p1: V3;
  T: number;
  t: number;
  h: number; // 放物線の追加高さ
  plan: ContactPlan;
}

interface SetPromptState {
  team: Team;
  opensAt: number;
  arriveAt: number;
  windowScale: number;
  choice: AttackChoice;
  pressed: TossQuality | null;
}

const CHOICES: AttackChoice[] = ['LEFT', 'QUICK', 'RIGHT', 'PIPE', 'TWO', 'PARA'];

// 攻撃コースを守備側から見たブロックゾーンへ変換（PARA=平行はレフト方向）
const CHOICE_ZONE: Record<AttackChoice, BlockZone> = {
  LEFT: 'R',
  QUICK: 'M',
  RIGHT: 'L',
  PIPE: 'M',
  TWO: 'M',
  PARA: 'R',
};

const CHOICE_LABEL: Record<AttackChoice, string> = {
  LEFT: 'オープン',
  QUICK: 'クイック',
  RIGHT: 'バック',
  PIPE: '二段',
  TWO: 'ツーアタック',
  PARA: '平行',
};

const rnd = (lo = 0, hi = 1) => lo + Math.random() * (hi - lo);
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

function flightPos(f: Flight): V3 {
  const s = clamp(f.t / f.T, 0, 1);
  return v3(
    f.p0.x + (f.p1.x - f.p0.x) * s,
    f.p0.y + (f.p1.y - f.p0.y) * s + f.h * 4 * s * (1 - s),
    f.p0.z + (f.p1.z - f.p0.z) * s,
  );
}

export class VolleySim {
  players: PlayerState[] = [];
  cpu: [boolean, boolean];
  phase: Phase = 'preServe';
  time = 0;
  timer = 1.8;
  score: [number, number] = [0, 0];
  servingTeam: Team = 0;
  flight: Flight | null = null;
  ballPos: V3 = v3(0, 1, 0);
  ballVisible = false;
  centerMsg: string | null = 'サーブ準備';
  winner: Team | null = null;

  setPrompt: SetPromptState | null = null;
  blockPromptTeam: Team | null = null;
  blockCommit: [BlockZone | null, BlockZone | null] = [null, null];
  blockJumpAt: [number | null, number | null] = [null, null]; // ブロックのタイミング押し時刻
  serveWaiting = false;
  serveChargeStart: number | null = null; // サーブ長押し開始時刻
  serveAimZ = 0; // -1(自分から見て左)..1(右)
  // トスアップ中のサーブ（0.5秒後に頭上の打点で実際に打つ）
  servePending: {
    at: number;
    human: boolean;
    power: number;
    zone: number;
    quality: TossQuality;
  } | null = null;
  recvPrompt: {
    team: Team;
    arriveAt: number;
    total: number;
    pressed: TossQuality | null;
  } | null = null;
  spikeCtl: {
    team: Team;
    chargeStart: number | null;
    power: number | null; // 離して確定したパワー
    aimZ: number;
    arriveAt: number;
    total: number;
  } | null = null;

  attackCounts: [Record<AttackChoice, number>, Record<AttackChoice, number>] = [
    { LEFT: 0, QUICK: 0, RIGHT: 0, PIPE: 0, TWO: 0, PARA: 0 },
    { LEFT: 0, QUICK: 0, RIGHT: 0, PIPE: 0, TWO: 0, PARA: 0 },
  ];

  tactics: [Tactic, Tactic] = ['balanced', 'balanced'];
  homeTeam: Team = 0; // ホーム（応援＋スタミナ回復の隠しバフ）
  liberos: [RosterEntry | null, RosterEntry | null] = [null, null]; // 契約リベロ（守備強化）
  // 試合の長さ: basePts=25 or 15、bestOf=1/3/5
  basePts = 25;
  bestOf = 1;
  sets: [number, number] = [0, 0];
  setNo = 1;
  targetPts = 25;
  // リングメニューの攻撃指示（トスの初期選択）
  plan: [AttackChoice | null, AttackChoice | null] = [null, null];
  // 監督UI: スロット別の守備位置オーバーライド（コーチングボードのドラッグで設定）
  posAdj: [Record<number, { x: number; z: number }>, Record<number, { x: number; z: number }>] = [
    {},
    {},
  ];

  // VAR（ビデオ判定）: ライン際の際どい着弾で自動発動
  varCall: {
    pos: V3;
    inCall: boolean;
    conf: number;
    scorer: Team;
    revealAt: number;
  } | null = null;
  private pendingVarEv: { scorer: Team; msg: string; ev: SimEvent['kind'] } | null = null;

  events: SimEvent[] = [];
  private seq = 0;
  private pendingActs: PendingAct[] = [];

  constructor(cpu0: boolean, cpu1: boolean, rosters?: [RosterEntry[], RosterEntry[]]) {
    this.cpu = [cpu0, cpu1];
    const ros = rosters ?? [generateRoster(), generateRoster()];
    for (const team of [0, 1] as Team[]) {
      LINEUP.forEach((role, i) => {
        const slot = i + 1;
        const p = basePos(team, slot, 'base');
        this.players.push({
          team,
          role,
          slot,
          pos: { ...p },
          vel: { x: 0, z: 0 },
          target: { ...p },
          human: !this.cpu[team] && role === 'S',
          actKind: null,
          actStart: 0,
          actDur: 1,
          roster: ros[team][i],
          mstats: { atk: 0, kills: 0, blocks: 0, digs: 0, aces: 0 },
          stamina: 1,
        });
      });
    }
    this.enterPreServe();
  }

  setTactic(team: Team, t: Tactic) {
    this.tactics[team] = t;
  }

  setHome(team: Team) {
    this.homeTeam = team;
  }

  // 契約リベロを登録（守備の要: 後衛レシーブを強化する。コート上の7人目は描画せず機能面で反映）
  setLibero(team: Team, l: RosterEntry | null) {
    this.liberos[team] = l;
  }

  // チームの丸ごと入れ替え（マルチの試合準備で各プレイヤーが自分のチームを確定させる）
  setTeamRoster(team: Team, roster: RosterEntry[]) {
    const ps = this.teamPlayers(team);
    LINEUP.forEach((role, i) => {
      const p = ps.find((q) => q.role === role);
      if (p && roster[i]) {
        p.roster = roster[i];
        p.stamina = 1;
        p.mstats = { atk: 0, kills: 0, blocks: 0, digs: 0, aces: 0 };
      }
    });
    // 得点・セットをリセットして新編成で仕切り直し
    this.score = [0, 0];
    this.sets = [0, 0];
    this.setNo = 1;
    this.winner = null;
    this.pendingSetBreak = null;
    this.targetPts = this.computeTarget();
    this.enterPreServe();
  }

  // 「戦術指示」持ちセッターがコートにいると全体が微バフ
  private hasSkillBuff(team: Team, skill: string): boolean {
    return this.teamPlayers(team).some((p) => p.roster.skills.includes(skill));
  }

  // スキル/シグネチャーの効果量に「絶好調(form)」を掛ける
  private formAmp(p: PlayerState): number {
    return p.roster.form >= 1.08 ? 1.4 : p.roster.form <= 0.9 ? 0.7 : 1.0;
  }

  // 試合の長さを設定（basePts: 25 or 15 / bestOf: 1,3,5）
  setMatchLength(basePts: number, bestOf: number) {
    this.basePts = basePts === 15 ? 15 : 25;
    this.bestOf = bestOf === 5 ? 5 : bestOf === 3 ? 3 : 1;
    this.targetPts = this.computeTarget();
  }

  private setsToWin() {
    return Math.ceil(this.bestOf / 2);
  }

  // このセットの先取点。25点制の多セットは、両者あと1セットで勝ちの最終セットのみ15点
  private computeTarget(): number {
    if (this.basePts === 15) return 15;
    const need = this.setsToWin() - 1;
    if (this.bestOf > 1 && this.sets[0] === need && this.sets[1] === need) return 15;
    return 25;
  }

  setCpu(team: Team, isCpu: boolean) {
    this.cpu[team] = isCpu;
    for (const p of this.players) {
      if (p.team === team && p.role === 'S') p.human = !isCpu;
    }
  }

  private teamHasSkill(team: Team, skill: string, frontOnly = false): boolean {
    return this.teamPlayers(team).some(
      (p) => (!frontOnly || this.isFront(p.slot)) && p.roster.skills.includes(skill),
    );
  }

  // 動作ごとのスタミナ消耗量（ジャンプ/スパイクは重い）
  private static ACT_COST: Record<string, number> = {
    jump: 0.05,
    spike: 0.07,
    serve: 0.05,
    dig: 0.03,
    lunge: 0.06,
    set: 0.015,
  };

  private setAct(p: PlayerState, kind: NonNullable<PlayerState['actKind']>, dur: number) {
    p.actKind = kind;
    p.actStart = this.time;
    p.actDur = dur;
    // スタミナ消耗（スタミナ能力が高いほど消耗しにくい）
    const cost = (VolleySim.ACT_COST[kind] ?? 0.02) * (1.4 - (p.roster.st.stamina / 99) * 0.8);
    p.stamina = clamp(p.stamina - cost, 0.1, 1);
  }

  // 疲労時の能力係数（0..1）: スタミナが低いほど精度・威力が下がる。0.55が下限
  private fatigue(p: PlayerState): number {
    return 0.55 + p.stamina * 0.45;
  }

  private emit(kind: SimEvent['kind'], msg?: string, team?: Team) {
    this.events.push({ seq: this.seq++, kind, msg, team });
    if (this.events.length > 12) this.events.shift();
  }

  private teamPlayers(team: Team) {
    return this.players.filter((p) => p.team === team);
  }
  private setterOf(team: Team) {
    return this.players.find((p) => p.team === team && p.role === 'S')!;
  }
  private serverOf(team: Team) {
    return this.players.find((p) => p.team === team && p.slot === 1)!;
  }
  private isFront(slot: number) {
    return slot >= 2 && slot <= 4;
  }

  // 攻撃選択 → 実行する選手
  private attackerFor(team: Team, choice: AttackChoice): PlayerState {
    const ps = this.teamPlayers(team);
    const front = (r: Role[]) =>
      ps.find((p) => r.includes(p.role) && this.isFront(p.slot));
    const back = (r: Role[]) =>
      ps.find((p) => r.includes(p.role) && !this.isFront(p.slot));
    switch (choice) {
      case 'LEFT':
        return front(['OH1', 'OH2']) ?? back(['OH1', 'OH2'])!;
      case 'QUICK':
        return front(['MB1', 'MB2']) ?? back(['MB1', 'MB2'])!;
      case 'RIGHT':
        return ps.find((p) => p.role === 'OP')!;
      case 'PIPE':
        return back(['OH1', 'OH2']) ?? front(['OH1', 'OH2'])!;
      case 'TWO':
        return this.setterOf(team); // ツーアタックはセッター自身
      case 'PARA':
        return front(['OH1', 'OH2']) ?? back(['OH1', 'OH2'])!; // 平行はレフトへ低く速く
    }
  }

  // ---------- フェーズ遷移 ----------

  private enterPreServe() {
    this.phase = 'preServe';
    this.timer = 1.3;
    this.flight = null;
    this.ballVisible = true;
    this.setPrompt = null;
    this.blockPromptTeam = null;
    this.blockCommit = [null, null];
    this.serveWaiting = false;
    this.serveChargeStart = null;
    this.serveAimZ = 0;
    this.servePending = null;
    this.recvPrompt = null;
    this.spikeCtl = null;
    this.blockJumpAt = [null, null];
    this.centerMsg = null;
    this.pendingActs = [];
    this.varCall = null;
    this.pendingVarEv = null;
    for (const p of this.players) p.actKind = null;

    for (const p of this.players) {
      const receiving = p.team !== this.servingTeam;
      let t: V3;
      if (!receiving && p.slot === 1) {
        t = servePos(p.team);
      } else {
        t = basePos(p.team, p.slot, receiving ? 'receive' : 'base');
        // 監督UIの位置調整を反映
        const ov = this.posAdj[p.team][p.slot];
        if (ov) t = this.clampOwnHalf(p.team, ov.x, ov.z);
      }
      p.target = { ...t };
    }
    const sv = this.serverOf(this.servingTeam);
    this.ballPos = v3(sv.target.x, 1.2, sv.target.z);
  }

  private enterServe() {
    this.phase = 'serve';
    this.serveWaiting = true;
    this.serveChargeStart = null;
    this.servePending = null;
    // 人間は笛から8秒以内に打たないと8秒ルール違反（自動では打たない）
    this.timer = this.cpu[this.servingTeam] ? rnd(0.6, 1.2) : 8.0;
    const sv = this.serverOf(this.servingTeam);
    this.ballPos = v3(sv.pos.x, 1.2, sv.pos.z);
    this.emit('whistle');
  }

  // サーブ開始: トスアップのモーションに入り、0.5秒後に頭上で打つ
  private beginServe(human: boolean, power: number, zone: number, quality: TossQuality) {
    this.serveWaiting = false;
    this.serveChargeStart = null;
    const server = this.serverOf(this.servingTeam);
    this.setAct(server, 'serve', 0.7);
    this.servePending = { at: this.time + 0.5, human, power, zone, quality };
  }

  // ネットを跨ぐ軌道が網を貫通しないよう、通過点の高さを保証する（h を持ち上げる）
  private netClearH(p0: V3, p1: V3, h: number, margin = 0.18): number {
    if (p0.x * p1.x >= 0) return h; // ネットを跨がない
    const s = p0.x / (p0.x - p1.x); // x=0 を通過する媒介変数
    const lin = p0.y + (p1.y - p0.y) * s;
    const denom = 4 * s * (1 - s);
    if (denom < 1e-4) return h;
    const hMin = (NET_HEIGHT + margin - lin) / denom;
    return Math.max(h, hMin);
  }

  // 誰も触らずボールが落ちる（無入力プレーの帰結）
  private dropBall(faultTeam: Team, msg: string) {
    this.setPrompt = null;
    this.recvPrompt = null;
    this.spikeCtl = null;
    this.blockPromptTeam = null;
    const p = this.ballPos;
    this.flight = {
      p0: { ...p },
      p1: v3(
        clamp(p.x + rnd(-0.3, 0.3), -8.8, 8.8),
        0,
        clamp(p.z + rnd(-0.3, 0.3), -4.3, 4.3),
      ),
      T: 0.35,
      t: 0,
      h: 0.05,
      plan: { kind: 'floor', scorer: (1 - faultTeam) as Team, msg, ev: 'fault' },
    };
  }

  // ライン際の着弾なら VAR（ビデオ判定）を発動する
  private maybeVar(scorer: Team) {
    const p = this.ballPos;
    if (Math.abs(p.x) < 0.6) return; // ネット際は対象外
    const dx = COURT_HALF_X - Math.abs(p.x);
    const dz = COURT_HALF_Z - Math.abs(p.z);
    const closeness = Math.min(Math.abs(dx), Math.abs(dz));
    if (closeness > 0.35) return;
    this.varCall = {
      pos: { ...p },
      inCall: dx >= 0 && dz >= 0,
      conf: Math.round(86 + rnd(0, 13)),
      scorer,
      revealAt: this.time + 3.6,
    };
    this.emit('var', 'VIDEO CHECK — ライン判定');
  }

  private startPoint(scorer: Team, msg: string, ev: SimEvent['kind']) {
    this.phase = 'point';
    this.flight = null;
    this.setPrompt = null;
    this.blockPromptTeam = null;

    if (this.varCall) {
      // VAR 中: 判定リザルトまで得点表示・歓声はお預け
      this.timer = 6.2;
      this.centerMsg = 'ビデオ判定中…';
      this.pendingVarEv = { scorer, msg, ev };
    } else {
      // ハイライト（スパイク決定/エース/ブロック）はスローリプレイが流れるので長めに
      const highlight = ev === 'point' || ev === 'ace' || ev === 'block';
      this.timer = highlight ? 4.6 : 1.8;
      this.centerMsg = msg;
      this.emit(ev, msg, scorer);
      if (highlight) this.celebrate(scorer);
    }

    this.score[scorer]++;
    if (scorer !== this.servingTeam) {
      // サイドアウト: サーブ権移動とローテーション
      this.servingTeam = scorer;
      for (const p of this.teamPlayers(scorer)) {
        p.slot = p.slot === 1 ? 6 : p.slot - 1;
      }
    }
    const [a, b] = this.score;
    const lead = Math.abs(a - b);
    if ((a >= this.targetPts || b >= this.targetPts) && lead >= 2) {
      // このセットの決着
      const setWinner: Team = a > b ? 0 : 1;
      this.sets[setWinner]++;
      // マッチポイントの VAR は簡略化（結果を即時確定）
      this.varCall = null;
      this.pendingVarEv = null;

      if (this.sets[setWinner] >= this.setsToWin()) {
        // 試合終了
        this.winner = setWinner;
        this.phase = 'matchOver';
        this.centerMsg =
          (this.winner === 0 ? 'BLUE' : 'RED') +
          ` チームの勝利！ ${this.sets[0]}-${this.sets[1]} (Rで再戦)`;
        this.emit('matchOver', this.centerMsg, this.winner);
      } else {
        // 次のセットへ
        this.pendingSetBreak = setWinner;
        this.timer = Math.max(this.timer, 3.2);
        this.centerMsg = `第${this.setNo}セット ${setWinner === 0 ? 'BLUE' : 'RED'} 取得！ ${this.sets[0]}-${this.sets[1]}`;
      }
    }
  }

  private pendingSetBreak: Team | null = null;

  // 次のセットを開始（スコアリセット、サーブ権は前セットの敗者、先取点を再計算）
  private startNextSet() {
    const winner = this.pendingSetBreak!;
    this.pendingSetBreak = null;
    this.setNo++;
    this.score = [0, 0];
    this.servingTeam = (1 - winner) as Team; // 前セットを取られた側がサーブ
    this.targetPts = this.computeTarget();
    this.enterPreServe();
  }

  // 得点チームの歓喜パフォーマンスと、失点チームの落胆
  private celebrate(scorer: Team) {
    const winners = this.teamPlayers(scorer);
    for (let i = 0; i < 3; i++) {
      const p = pick(winners);
      this.pendingActs.push({
        at: this.time + 0.3 + i * 0.22,
        kind: 'celebrateJump',
        playerIdx: this.players.indexOf(p),
      });
    }
    const losers = this.teamPlayers((1 - scorer) as Team);
    for (let i = 0; i < 2; i++) {
      this.setAct(pick(losers), 'dig', 1.1); // うなだれる
    }
  }

  // ---------- サーブ ----------

  private serveChargePower(): number {
    if (this.serveChargeStart === null) return 0;
    return clamp((this.time - this.serveChargeStart) / 1.1, 0, 1);
  }

  // 受け手側が人間ならレシーブのタイミングプロンプトを開く
  private openReceivePrompt(team: Team, T: number) {
    this.recvPrompt = this.cpu[team]
      ? null
      : { team, arriveAt: this.time + T, total: T, pressed: null };
  }

  // 人間のチャージサーブ発射: パワーで深さと威力、aimZ でコース（トスアップ後に呼ばれる）
  private launchServeHuman(power: number) {
    const server = this.serverOf(this.servingTeam);
    const recvTeam = (1 - this.servingTeam) as Team;

    // スイートスポットは 0.75 付近
    const d = Math.abs(power - 0.75);
    const quality: TossQuality =
      d < 0.07 ? 'PERFECT' : d < 0.16 ? 'GOOD' : d < 0.3 ? 'OK' : 'POOR';
    // 強打しすぎはフォルトのリスク
    const faultP =
      Math.max(0, power - 0.85) * 2.2 * (1.3 - server.roster.stats.serve * 0.7);
    const serveHitY = 2.29 * server.roster.height + 0.28; // 頭上の打点（小ジャンプ込み）
    if (Math.random() < faultP) {
      const p0 = v3(server.pos.x, serveHitY, server.pos.z);
      const dir = this.servingTeam === 0 ? 1 : -1;
      const p1 = v3(dir * rnd(9.5, 11), 0, server.pos.z + rnd(-2, 2));
      this.flight = {
        p0, p1, T: 0.9, t: 0, h: this.netClearH(p0, p1, 0.5),
        plan: { kind: 'floor', scorer: recvTeam, msg: 'サーブアウト…', ev: 'fault' },
      };
      this.phase = 'rally';
      this.emit('serve');
      return;
    }

    const sideDir = this.servingTeam === 0 ? 1 : -1; // 自分から見て右 = +z (team0)
    const depth = 2.8 + clamp(power, 0.15, 1) * 5.1; // 相手コートの深さ
    const landX = (this.servingTeam === 0 ? 1 : -1) * depth;
    const landZ = clamp(sideDir * this.serveAimZ * 3.4 + rnd(-0.7, 0.7), -4.2, 4.2);
    const land = v3(landX, 0.55, landZ);

    const cands = this.teamPlayers(recvTeam).filter((p) => p.role !== 'S');
    let best = cands[0];
    for (const c of cands) if (dist2d(c.pos, land) < dist2d(best.pos, land)) best = c;
    const idx = this.players.indexOf(best);

    const T = 1.2 - power * 0.25;
    const p0h = v3(server.pos.x, serveHitY, server.pos.z);
    this.flight = {
      p0: p0h, // 頭上の打点から
      p1: land,
      T,
      t: 0,
      h: this.netClearH(p0h, land, 1.8 - power * 1.0), // ネット貫通防止の弾道補正
      plan: {
        kind: 'receive',
        team: recvTeam,
        playerIdx: idx,
        serveQ: quality,
        servePow: clamp(power * 0.55 + server.roster.stats.serve * 0.5, 0, 1),
      },
    };
    this.phase = 'rally';
    this.centerMsg = null;
    this.emit('serve');
    best.target = v3(land.x, 0, land.z);
    this.openReceivePrompt(recvTeam, T);
  }

  private launchServeCpu(zone: number, quality: TossQuality) {
    const server = this.serverOf(this.servingTeam);
    const recvTeam = (1 - this.servingTeam) as Team;

    // サーブ力が高いほどフォルトしにくい
    const faultBase = { PERFECT: 0.01, GOOD: 0.03, OK: 0.06, POOR: 0.18 }[quality];
    const faultP = faultBase * (1.4 - server.roster.stats.serve * 0.8);
    const serveHitY = 2.29 * server.roster.height + 0.28;
    if (Math.random() < faultP) {
      // その場でネット/アウトのフォルト
      const p0 = v3(server.pos.x, serveHitY, server.pos.z);
      const dir = this.servingTeam === 0 ? 1 : -1;
      const p1 = v3(dir * -0.3, 0, server.pos.z + rnd(-1, 1));
      this.flight = {
        p0,
        p1,
        T: 0.9,
        t: 0,
        h: 0.6,
        plan: { kind: 'floor', scorer: recvTeam, msg: 'サーブミス…', ev: 'fault' },
      };
      this.phase = 'rally';
      this.emit('serve');
      return;
    }

    const tgt = serveTarget(recvTeam, zone);
    const land = v3(tgt.x + rnd(-1, 1), 0.55, clamp(tgt.z + rnd(-1, 1), -4, 4));
    // 最も近い選手がレシーブ（セッター以外を優先）
    const cands = this.teamPlayers(recvTeam).filter((p) => p.role !== 'S');
    let best = cands[0];
    for (const c of cands) if (dist2d(c.pos, land) < dist2d(best.pos, land)) best = c;
    const idx = this.players.indexOf(best);

    const p0c = v3(server.pos.x, serveHitY, server.pos.z);
    this.flight = {
      p0: p0c,
      p1: land,
      T: 1.15,
      t: 0,
      h: this.netClearH(p0c, land, quality === 'PERFECT' ? 0.9 : 1.6), // 貫通防止
      plan: {
        kind: 'receive',
        team: recvTeam,
        playerIdx: idx,
        serveQ: quality,
        servePow: server.roster.stats.serve,
      },
    };
    this.phase = 'rally';
    this.centerMsg = null;
    this.emit('serve');
    best.target = v3(land.x, 0, land.z);
    this.openReceivePrompt(recvTeam, 1.15);
  }

  // ---------- コンタクト解決 ----------

  private resolveContact(plan: ContactPlan) {
    switch (plan.kind) {
      case 'floor': {
        this.ballVisible = true;
        this.maybeVar(plan.scorer);
        this.startPoint(plan.scorer, plan.msg, plan.ev);
        return;
      }
      case 'receive': {
        // 人間チームはタイミング入力が無ければ触れない（ノータッチで落球）
        if (
          !this.cpu[plan.team] &&
          this.recvPrompt &&
          this.recvPrompt.team === plan.team &&
          this.recvPrompt.pressed === null
        ) {
          this.dropBall(plan.team, 'ノータッチ！レシーブできず…');
          return;
        }
        const receiver = this.players[plan.playerIdx];
        // タイミング品質は consumeRecvTiming で消費される前に控えておく（モーション分岐用）
        const pressedQ =
          this.recvPrompt && this.recvPrompt.team === plan.team
            ? this.recvPrompt.pressed
            : undefined;
        // サーブの質 × サーブ力 vs レシーブ力 + プレイヤーのタイミング入力
        const servePressure =
          { PERFECT: 0.45, GOOD: 0.3, OK: 0.16, POOR: 0.06 }[plan.serveQ] *
          (0.6 + plan.servePow * 0.8);
        // レシーブ力 + 連携(乱れたボールを返す精度) + スキル + リベロ補正 - 疲労
        const lib = this.liberos[plan.team];
        const libBoost = lib && !this.isFront(receiver.slot) ? Math.max(0, (lib.st.receive - 70) / 99) * 0.25 : 0;
        const recvBonus =
          (receiver.roster.stats.receive - 0.5) * 0.3 +
          ((receiver.roster.st.teamwork - 50) / 99) * 0.08 +
          (receiver.roster.form - 1.0) * 0.35 + // 調子の波
          (receiver.roster.skills.includes('スーパーレシーブ') ? 0.08 : 0) +
          libBoost - // 契約リベロが後衛守備を底上げ
          (1 - this.fatigue(receiver)) * 0.12; // 疲労で精度低下
        const q = clamp(
          0.88 - servePressure + recvBonus + this.consumeRecvTiming(plan.team) - rnd(0, 0.3),
          0.02,
          1,
        );
        if (q < 0.14) {
          // サービスエース
          this.serverOf(this.servingTeam).mstats.aces++;
          const p = this.players[plan.playerIdx];
          const land = v3(
            clamp(p.pos.x + rnd(-1.5, 1.5), -8.5, 8.5),
            0,
            clamp(p.pos.z + rnd(-1.5, 1.5), -4.2, 4.2),
          );
          this.flight = {
            p0: { ...this.ballPos },
            p1: land,
            T: 0.35,
            t: 0,
            h: 0.1,
            plan: {
              kind: 'floor',
              scorer: this.servingTeam,
              msg: 'サービスエース！',
              ev: 'ace',
            },
          };
          return;
        }
        this.emit('contact', undefined, plan.team);
        this.players[plan.playerIdx].mstats.digs++;
        // 遅れた/早すぎた入力は「腕を伸ばして何とか届く」ランジで拾う
        if (pressedQ === 'POOR' || pressedQ === 'OK') {
          this.setAct(this.players[plan.playerIdx], 'lunge', 0.6);
          if (pressedQ === 'POOR') this.emit('toss', 'ギリギリ届いた！');
        } else {
          this.setAct(this.players[plan.playerIdx], 'dig', 0.5);
        }
        this.passToSetter(plan.team, q);
        return;
      }
      case 'dig': {
        // ディグ（スパイクレシーブ）は未入力でも味方がカバーして繋がる
        // （ブロック→ディグの連続操作の負荷軽減。品質ペナルティのみ受ける）
        this.emit('contact', undefined, plan.team);
        {
          const pressedQ =
            this.recvPrompt && this.recvPrompt.team === plan.team
              ? this.recvPrompt.pressed
              : undefined;
          if (pressedQ === 'POOR' || pressedQ === 'OK') {
            this.setAct(this.players[plan.playerIdx], 'lunge', 0.6);
            if (pressedQ === 'POOR') this.emit('toss', 'ギリギリ届いた！');
          } else {
            this.setAct(this.players[plan.playerIdx], 'dig', 0.5);
          }
        }
        {
          let dq = clamp(rnd(0.35, 0.85) + this.consumeRecvTiming(plan.team), 0.02, 1);
          // 鉄壁の守護: 守備範囲のボールを確実にセッターへ
          if (this.teamHasSkill(plan.team, '鉄壁の守護')) dq = Math.max(dq, 0.55);
          this.passToSetter(plan.team, dq);
        }
        return;
      }
      case 'set': {
        this.performSet(plan.team);
        return;
      }
      case 'attack': {
        this.performAttack(plan);
        return;
      }
      case 'blockTouch': {
        // ブロッカーの手に当たった: 接触音を鳴らして攻撃側コートへ跳ね返す
        this.players[plan.blockerIdx].mstats.blocks++;
        this.emit('block');
        this.flight = {
          p0: { ...this.ballPos },
          p1: plan.land,
          T: 0.5,
          t: 0,
          h: 0.9,
          plan: {
            kind: 'floor',
            scorer: plan.defTeam,
            msg: 'シャットブロック！',
            ev: 'block',
          },
        };
        return;
      }
    }
  }

  // ラリー中の基本配置へ移動（前衛は役割位置にスイッチ: OH=レフト, MB=中央, OP/S=ライト）
  private clampOwnHalf(team: Team, x: number, z: number): V3 {
    const minX = team === 0 ? -8.7 : 0.4;
    const maxX = team === 0 ? -0.4 : 8.7;
    return v3(clamp(x, minX, maxX), 0, clamp(z, -4.3, 4.3));
  }

  private applyRallyPositions(team: Team) {
    for (const p of this.teamPlayers(team)) {
      if (this.isFront(p.slot)) {
        let z: number;
        if (p.role === 'OH1' || p.role === 'OH2') z = -3.0;
        else if (p.role === 'MB1' || p.role === 'MB2') z = 0.0;
        else z = 3.0; // OP / S はライト側
        p.target = mirror(v3(-2.5, 0, z), team);
        if (p.role === 'S') p.target = setterSpot(team);
      } else {
        p.target = basePos(team, p.slot, 'base');
        // 監督UIの守備位置調整（後衛のみ、セッターは除く）
        const ov = this.posAdj[team][p.slot];
        if (ov && p.role !== 'S') p.target = this.clampOwnHalf(team, ov.x, ov.z);
        if (p.role === 'S') p.target = setterSpot(team);
      }
    }
  }

  // レシーブのタイミング入力を消費して品質ボーナスに変換
  private consumeRecvTiming(team: Team): number {
    if (this.cpu[team]) return 0;
    const pr = this.recvPrompt;
    this.recvPrompt = null;
    const pressed = pr && pr.team === team ? pr.pressed : null;
    if (pressed === 'PERFECT') {
      this.emit('toss', 'ナイスレシーブ!');
      return 0.22;
    }
    if (pressed === 'GOOD') return 0.12;
    if (pressed === 'OK') return 0.02;
    if (pressed === 'POOR') return -0.08;
    return -0.15; // 未入力
  }

  // レシーブ/ディグ後、セッターへボールを運びトス入力を開く
  private passToSetter(team: Team, passQ: number) {
    this.applyRallyPositions(team);
    this.applyRallyPositions((1 - team) as Team);
    const setter = this.setterOf(team);
    const off = (1 - passQ) * 2.2;
    const base = setterSpot(team);
    // 接触高さはセッターの身長に合わせる（手とボールの一致）
    const p1 = v3(
      clamp(base.x + rnd(-off, off), team === 0 ? -8.5 : 0.5, team === 0 ? -0.5 : 8.5),
      2.02 * setter.roster.height, // 額の上（肘を曲げた両手の位置）
      clamp(base.z + rnd(-off, off), -4.2, 4.2),
    );
    const T = 1.45;
    this.flight = {
      p0: { ...this.ballPos },
      p1,
      T,
      t: 0,
      h: 3.2,
      plan: { kind: 'set', team },
    };
    setter.target = v3(p1.x, 0, p1.z);

    // トス入力プロンプト（人間チームのみ）と、相手のブロックコミット窓
    // 判定窓はパス精度 × セッターの連携(トス精度)。「完璧な導き」は常に広い窓
    let ws = (0.55 + 0.75 * passQ) * (0.88 + (setter.roster.st.teamwork / 99) * 0.27);
    if (setter.roster.skills.includes('完璧な導き')) ws = Math.max(ws, 1.05);
    this.setPrompt = {
      team,
      opensAt: this.time,
      arriveAt: this.time + T,
      windowScale: ws,
      choice: this.plan[team] ?? 'LEFT',
      pressed: null,
    };
    const defTeam = (1 - team) as Team;
    this.blockCommit[defTeam] = null;
    this.blockJumpAt[defTeam] = null;
    this.blockPromptTeam = this.cpu[defTeam] ? null : defTeam;
    if (this.cpu[defTeam]) this.cpuBlockCommit(defTeam, team);
  }

  private cpuBlockCommit(defTeam: Team, atkTeam: Team) {
    const r = Math.random();
    // 攻撃的な戦術ほどコミットブロックを多用する
    const noCommitP =
      this.tactics[defTeam] === 'aggressive' ? 0.15 : this.tactics[defTeam] === 'defensive' ? 0.45 : 0.3;
    if (r < noCommitP) return; // リードブロック（コミットなし）
    if (r < noCommitP + 0.2) {
      this.blockCommit[defTeam] = pick(['L', 'M', 'R'] as BlockZone[]);
      return;
    }
    // 相手の攻撃傾向を読む
    const counts = this.attackCounts[atkTeam];
    let bestC: AttackChoice = 'LEFT';
    for (const c of CHOICES) if (counts[c] > counts[bestC]) bestC = c;
    this.blockCommit[defTeam] = CHOICE_ZONE[bestC];
  }

  private performSet(team: Team) {
    const sp = this.setPrompt;
    let choice: AttackChoice;
    let quality: TossQuality;

    if (this.cpu[team] || !sp) {
      // 前衛アタッカーの「癖」（tendency）を集計して攻撃コースを選ぶ＝ヒートマップ通りに動く
      const front = this.teamPlayers(team).filter((p) => this.isFront(p.slot));
      const agg = { L: 0.1, C: 0.1, R: 0.1 };
      for (const p of front) {
        agg.L += p.roster.tendency.L;
        agg.C += p.roster.tendency.C;
        agg.R += p.roster.tendency.R;
      }
      const weights: [AttackChoice, number][] = [
        ['LEFT', agg.L * 0.55], ['PARA', agg.L * 0.25], ['PIPE', agg.L * 0.2],
        ['QUICK', agg.C],
        ['RIGHT', agg.R * 0.8], ['TWO', 0.12],
      ];
      const wsum = weights.reduce((s, [, w]) => s + w, 0);
      let r = Math.random() * wsum;
      choice = 'LEFT';
      for (const [c, wt] of weights) {
        if (r < wt) { choice = c; break; }
        r -= wt;
      }
      const qr = Math.random();
      quality = qr < 0.3 ? 'PERFECT' : qr < 0.7 ? 'GOOD' : qr < 0.9 ? 'OK' : 'POOR';
    } else {
      // 人間チームはトス入力が無ければボールを落とす（自動では上げない）
      if (sp.pressed === null) {
        this.setPrompt = null;
        this.dropBall(team, 'トスを上げられず落球…');
        return;
      }
      choice = sp.choice;
      quality = sp.pressed;
      // セッターがボール到達点から離れすぎていると1段階劣化
      const setter = this.setterOf(team);
      if (this.flight && dist2d(setter.pos, this.flight.p1) > 1.3) {
        const order: TossQuality[] = ['PERFECT', 'GOOD', 'OK', 'POOR'];
        quality = order[Math.min(order.indexOf(quality) + 1, 3)];
      }
    }
    this.setPrompt = null;
    this.attackCounts[team][choice]++;
    this.setAct(this.setterOf(team), 'set', 0.45);

    if (choice === 'TWO') {
      // ツーアタック: セッターが2本目をそのまま相手コートへ流し込む奇襲
      const setter = this.setterOf(team);
      this.setAct(setter, 'jump', 0.5);
      const ax = clamp(this.ballPos.x, team === 0 ? -1.6 : 0.6, team === 0 ? -0.6 : 1.6);
      this.flight = {
        p0: { ...this.ballPos },
        p1: v3(ax, 2.29 * setter.roster.height + 0.25, this.ballPos.z),
        T: 0.22,
        t: 0,
        h: 0.25,
        plan: { kind: 'attack', team, choice, quality, attackerIdx: this.players.indexOf(setter) },
      };
      this.emit('toss', CHOICE_LABEL[choice], team);
      this.spikeCtl = null; // 奇襲なので溜め入力はなし
      return;
    }

    const attacker = this.attackerFor(team, choice);
    const idx = this.players.indexOf(attacker);
    const ap = approachPos(team, choice);
    attacker.target = { ...ap };

    const quickish = choice === 'QUICK';
    const para = choice === 'PARA';
    // 平行は速く低い（タイミングはシビアだがブロックが付きにくい）
    const T = quickish ? 0.62 : para ? 0.7 : 1.05;
    // 打点 = 頭上リーチ2.29×身長 + ジャンプ力由来の跳躍(0.5〜0.84)。ジャンプ99の選手は高く打つ
    const hitY = Math.min(
      3.42,
      2.29 * attacker.roster.height + 0.5 + (attacker.roster.st.jump / 99) * 0.34,
    );
    this.flight = {
      p0: { ...this.ballPos },
      p1: v3(ap.x, hitY, ap.z),
      T,
      t: 0,
      h: quickish ? 0.7 : para ? 0.9 : 2.4,
      plan: { kind: 'attack', team, choice, quality, attackerIdx: idx },
    };
    this.emit('toss', CHOICE_LABEL[choice], team);

    // 攻撃側が人間なら、スパイクのチャージ＆コース入力を開く
    this.spikeCtl = this.cpu[team]
      ? null
      : { team, chargeStart: null, power: null, aimZ: 0, arriveAt: this.time + T, total: T };

    // トス到達直前にスパイカーが踏み切る。ブロッカーの自動ジャンプは CPU チームのみ
    // （人間チームは「ジャンプ入力を押した瞬間」に跳ぶ = 視覚と判定の一致）
    this.pendingActs.push({
      at: this.time + Math.max(0.05, T - 0.3),
      kind: 'attackJump',
      playerIdx: idx,
    });
    if (this.cpu[(1 - team) as Team]) {
      this.pendingActs.push({
        at: this.time + Math.max(0.1, T - 0.15),
        kind: 'blockJump',
        defTeam: (1 - team) as Team,
        z: ap.z,
      });
    }
  }

  private performAttack(
    plan: Extract<ContactPlan, { kind: 'attack' }>,
  ) {
    const { team, choice, quality } = plan;
    const defTeam = (1 - team) as Team;
    // ブロックの手の向きは自動アシスト: 精度は前衛の判断力に依存し、
    // 攻撃側に「囮の達人」の前衛MBがいると読みが 0.15 遅れる（=精度低下）
    if (!this.cpu[defTeam] && this.blockCommit[defTeam] === null) {
      const readers = this.teamPlayers(defTeam).filter((p) => this.isFront(p.slot));
      const bestDec = readers.reduce((m, p) => Math.max(m, p.roster.st.decision), 40);
      let acc = 0.4 + (bestDec / 99) * 0.45;
      if (this.teamHasSkill(team, '囮の達人', true)) acc -= 0.15;
      // 先読み: コースを事前に察知して自動照準の精度が上がる
      if (this.teamHasSkill(defTeam, '先読み')) acc += 0.18;
      this.blockCommit[defTeam] =
        Math.random() < acc ? CHOICE_ZONE[choice] : pick(['L', 'M', 'R'] as BlockZone[]);
    }
    const commit = this.blockCommit[defTeam];
    this.blockPromptTeam = null;

    // 人間チーム: スパイクの入力（チャージ）が一度も無ければ見送りで落球
    const ctl0 = this.spikeCtl && this.spikeCtl.team === team ? this.spikeCtl : null;
    if (!this.cpu[team] && ctl0 && ctl0.power === null && ctl0.chargeStart === null) {
      this.blockJumpAt[defTeam] = null;
      this.dropBall(team, 'スパイク見送り…');
      return;
    }

    const attacker = this.players[plan.attackerIdx];
    // 守備側前衛のブロック力平均
    const defFront = this.teamPlayers(defTeam).filter((p) => this.isFront(p.slot));
    const defBlock =
      defFront.reduce((s, p) => s + p.roster.stats.block, 0) / Math.max(1, defFront.length);

    let kill: number;
    let blocked: number;
    let err: number;
    if (choice === 'TWO') {
      // ツーアタック: ブロックが張って(コミットして)いるほど刺さる奇襲
      kill = 0.3 + (attacker.roster.stats.attack - 0.5) * 0.2 + (commit !== null ? 0.3 : 0);
      blocked = 0.05;
      err = 0.05;
      kill += { PERFECT: 0.08, GOOD: 0.04, OK: 0, POOR: -0.08 }[quality];
    } else {
      kill = 0.42 + (attacker.roster.stats.attack - 0.5) * 0.35;
      blocked = 0.11 + (defBlock - 0.5) * 0.22;
      err = 0.07;
      const qmod = { PERFECT: 0.3, GOOD: 0.14, OK: 0, POOR: -0.2 }[quality];
      kill += qmod;
      if (quality === 'POOR') err += 0.1;
      if (quality === 'POOR' && choice === 'QUICK') kill -= 0.12; // 合わないクイック
      // パワー: ブロックを弾き飛ばす / 守備側の跳躍: 壁の高さ
      blocked -= ((attacker.roster.st.power - 55) / 99) * 0.12;
      const defJump =
        defFront.reduce((s, p) => s + p.roster.st.jump, 0) / Math.max(1, defFront.length);
      blocked += ((defJump - 62) / 99) * 0.1;
      // スキル（絶好調 form で効果増幅）
      const amp = this.formAmp(attacker);
      const sk = attacker.roster.skills;
      if (sk.includes('強打') || sk.includes('決定力')) kill += 0.06 * amp;
      if (choice === 'QUICK' && sk.includes('速攻')) kill += 0.08 * amp;
      if (choice === 'PARA' && sk.includes('速攻')) kill += 0.05 * amp;
      if ((choice === 'PIPE' || choice === 'RIGHT') && sk.includes('バックアタック'))
        kill += 0.1 * amp; // OP のバックアタック
      if (sk.includes('空中姿勢調整')) err -= 0.05 * amp; // 空中で体勢を立て直しミスを減らす
      // 強心臓: 終盤・ビハインドで真価
      if (sk.includes('強心臓') && (this.score[team] >= this.targetPts - 5 || this.score[team] < this.score[defTeam]))
        kill += 0.08 * amp;
      // シグネチャー・ムーブ（データの癖をプレーに反映）
      const sig = attacker.roster.signature;
      if (sig === '爆発的パワー') kill += 0.05 * amp;
      if (sig === '滞空マスター' && (choice === 'LEFT' || choice === 'RIGHT')) kill += 0.05 * amp;
      // 平行トス: ブロックが付きにくいが精度がシビア（POORでさらに崩れる）
      if (choice === 'PARA') {
        blocked -= 0.06;
        if (quality === 'POOR') err += 0.06;
      }
      // 戦術指示（セッター）: 味方全体の決定力を微上げ
      if (this.hasSkillBuff(team, '戦術指示')) kill += 0.03;
    }
    // スタミナ疲労: 決定率が落ち、ミスが増える
    const fat = this.fatigue(attacker);
    kill *= 0.7 + fat * 0.3;
    err += (1 - fat) * 0.12;

    // 人間アタッカー: チャージパワーとコース入力
    const ctl = this.spikeCtl && this.spikeCtl.team === team ? this.spikeCtl : null;
    let power = 0.55;
    let aim = 0;
    if (ctl) {
      power =
        ctl.power ??
        (ctl.chargeStart !== null
          ? clamp((this.time - ctl.chargeStart) / 0.9, 0, 1)
          : 0.5);
      aim = ctl.aimZ;
      kill += (power - 0.55) * 0.4;
      err += Math.max(0, power - 0.82) * 0.6; // 強打しすぎはミス
      if (power < 0.3) {
        kill -= 0.12; // 弱すぎは拾われる
        if (attacker.roster.skills.includes('フェイント')) kill += 0.1; // 軟打の名手
      }
    }
    this.spikeCtl = null;

    if (commit && choice !== 'TWO') {
      if (commit === CHOICE_ZONE[choice]) {
        blocked += 0.2;
        kill -= 0.16;
        if (Math.abs(aim) > 0.6) kill += 0.09; // 読まれてもコースで抜く
        // デッドエンド: ブロックが揃っているほど威力が上がる
        if (attacker.roster.skills.includes('デッドエンド')) {
          kill += 0.15;
          blocked -= 0.08;
        }
        // 変幻自在: 読まれても打点でコースを変えてブロックを外す
        if (attacker.roster.skills.includes('変幻自在')) {
          kill += 0.12;
          blocked -= 0.06;
        }
      } else {
        blocked -= 0.07;
        kill += 0.11;
      }
    }
    // 守備側ブロッカーのスキル/シグネチャー
    const blockAmp = defFront.length ? Math.max(...defFront.map((p) => this.formAmp(p))) : 1;
    if (this.teamHasSkill(defTeam, '鉄壁ウォール', true)) blocked += 0.06 * blockAmp;
    if (defFront.some((p) => p.roster.signature === '鉄壁ウォール')) blocked += 0.05 * blockAmp;
    if (defFront.some((p) => p.roster.signature === '高速リアクション')) blocked += 0.05 * blockAmp;
    // 戦術補正
    const atkTac = this.tactics[team];
    if (atkTac === 'aggressive') { kill += 0.05; err += 0.04; }
    if (atkTac === 'defensive') { kill -= 0.02; err -= 0.03; }
    const defTac = this.tactics[defTeam];
    if (defTac === 'defensive') kill -= 0.05; // 拾われやすい
    if (defTac === 'aggressive') blocked += 0.04;
    // 守備範囲拡大（リベロ）: 守備側がボールを拾いやすくなりラリーが続く
    if (this.teamHasSkill(defTeam, '守備範囲拡大')) kill -= 0.05;
    // リベロ契約: 後衛守備の総合力が上がり、スパイクを拾われやすくする
    if (this.liberos[defTeam]) kill -= Math.max(0, (this.liberos[defTeam]!.st.receive - 70) / 99) * 0.08;
    // 守備側人間のブロック: 跳んでいなければ壁は存在しない（見た目と判定の一致）
    if (!this.cpu[defTeam]) {
      const bp = this.blockJumpAt[defTeam];
      if (bp === null) {
        blocked = 0.02; // ジャンプ未入力ならシャットはほぼ起きない
      } else {
        const dj = Math.abs(this.time - bp);
        // リードブロック持ちの前衛がいるとタイミング窓が広がる
        const w1 = this.teamHasSkill(defTeam, 'リードブロック', true) ? 0.22 : 0.15;
        if (dj < w1) blocked += 0.22;
        else if (dj < w1 + 0.15) blocked += 0.1;
        else blocked -= 0.05; // 跳び遅れ
      }
    }
    this.blockJumpAt[defTeam] = null;

    // 調子の波（form）: 絶好調ほど決定率が上がる
    kill += (attacker.roster.form - 1.0) * 0.5;

    kill = clamp(kill, 0.05, 0.88);
    blocked = clamp(blocked, 0.02, 0.65);
    err = clamp(err, 0.02, 0.45);

    const dir = team === 0 ? 1 : -1; // 攻撃が向かう x 方向
    const p0 = { ...this.ballPos };
    const r = Math.random();
    this.emit('spike', undefined, team);
    attacker.mstats.atk++;

    if (r < kill) {
      attacker.mstats.kills++;
      // コース入力があればその方向へ、なければクロス気味にランダム
      const sideDir = team === 0 ? 1 : -1;
      const landZ =
        Math.abs(aim) > 0.05
          ? clamp(sideDir * aim * 3.6 + rnd(-0.9, 0.9), -4.2, 4.2)
          : clamp(-Math.sign(p0.z || rnd(-1, 1)) * rnd(0, 3.8) + rnd(-1.5, 1.5), -4.2, 4.2);
      const land = v3(dir * rnd(2.5, 8.3), 0, landZ);
      this.flight = {
        p0, p1: land, T: 0.5, t: 0, h: this.netClearH(p0, land, 0.15, 0.05),
        plan: { kind: 'floor', scorer: team, msg: 'スパイク決定！', ev: 'point' },
      };
    } else if (r < kill + blocked) {
      // シャットブロック: まずブロッカーの手（ネット上の実座標）に当ててから跳ね返す
      const defFronts = this.teamPlayers(defTeam).filter((p) => this.isFront(p.slot));
      let blocker = defFronts[0] ?? this.teamPlayers(defTeam)[0];
      for (const b of defFronts) {
        if (Math.abs(b.pos.z - p0.z) < Math.abs(blocker.pos.z - p0.z)) blocker = b;
      }
      const blockerIdx = this.players.indexOf(blocker);
      const touch = v3(
        dir * 0.12, // ネットのわずかに攻撃側（手を突き出した位置）
        2.29 * blocker.roster.height + 0.45,
        clamp(blocker.pos.z, -4, 4),
      );
      const land = v3(dir * -rnd(0.5, 3), 0, clamp(touch.z + rnd(-1.2, 1.2), -4, 4));
      this.flight = {
        p0,
        p1: touch,
        T: 0.09,
        t: 0,
        h: 0,
        plan: { kind: 'blockTouch', defTeam, blockerIdx, land },
      };
    } else if (r < kill + blocked + err) {
      const out = Math.random() < 0.5;
      const land = out
        ? v3(dir * rnd(9.3, 11), 0, rnd(-6, 6))
        : v3(dir * -0.2, 0, clamp(p0.z + rnd(-1, 1), -4, 4));
      this.flight = {
        p0, p1: land, T: 0.6, t: 0, h: out ? this.netClearH(p0, land, 0.4, 0.05) : 0.1,
        plan: {
          kind: 'floor', scorer: defTeam,
          msg: out ? 'アウト…' : 'ネットにかかった…', ev: 'fault',
        },
      };
    } else {
      // ディグで拾われてラリー継続
      const backs = this.teamPlayers(defTeam).filter(
        (p) => !this.isFront(p.slot) && p.role !== 'S',
      );
      const digger = pick(backs.length ? backs : this.teamPlayers(defTeam));
      const idx = this.players.indexOf(digger);
      const digP1 = v3(digger.pos.x, 0.55, digger.pos.z);
      // ディグは 0.7 秒に緩和（ブロック直後でも見てから反応できる速度）
      this.flight = {
        p0,
        p1: digP1,
        T: 0.7, t: 0, h: this.netClearH(p0, digP1, 0.25, 0.05),
        plan: { kind: 'dig', team: defTeam, playerIdx: idx },
      };
      this.openReceivePrompt(defTeam, 0.7);
    }
  }

  // ---------- 入力 ----------

  private timingQuality(delta: number, scale = 1): TossQuality {
    const err = Math.abs(delta) / scale;
    return err < 0.075 ? 'PERFECT' : err < 0.17 ? 'GOOD' : err < 0.3 ? 'OK' : 'POOR';
  }

  input(team: Team, inp: Input) {
    switch (inp.type) {
      case 'actionDown': {
        // 文脈で解釈: サーブ溜め / レシーブ・トスのタイミング押し / スパイク溜め / ブロックジャンプ
        if (
          this.phase === 'serve' &&
          team === this.servingTeam &&
          this.serveWaiting &&
          !this.cpu[team]
        ) {
          if (this.serveChargeStart === null) this.serveChargeStart = this.time;
          return;
        }
        if (this.recvPrompt && this.recvPrompt.team === team && !this.recvPrompt.pressed) {
          this.recvPrompt.pressed = this.timingQuality(this.time - this.recvPrompt.arriveAt);
          return;
        }
        const sp = this.setPrompt;
        if (sp && sp.team === team && !sp.pressed) {
          sp.pressed = this.timingQuality(this.time - sp.arriveAt, sp.windowScale);
          if (sp.pressed === 'PERFECT') this.emit('toss', 'PERFECT!');
          return;
        }
        if (
          this.spikeCtl &&
          this.spikeCtl.team === team &&
          this.spikeCtl.power === null &&
          this.spikeCtl.chargeStart === null
        ) {
          this.spikeCtl.chargeStart = this.time;
          return;
        }
        if (this.blockPromptTeam === team && this.blockJumpAt[team] === null) {
          this.blockJumpAt[team] = this.time;
          // 押した瞬間に前衛ブロッカーが跳ぶ（視覚と判定の一致）
          const zTarget =
            this.flight && this.flight.plan.kind === 'attack'
              ? this.flight.p1.z
              : this.ballPos.z;
          for (const p of this.teamPlayers(team)) {
            if (this.isFront(p.slot) && Math.abs(p.pos.z - zTarget) < 2.6) {
              this.setAct(p, 'jump', 0.6);
              p.target = v3(p.team === 0 ? -0.7 : 0.7, 0, clamp(zTarget, -4, 4));
            }
          }
          return;
        }
        return;
      }
      case 'actionUp': {
        if (
          this.serveChargeStart !== null &&
          this.phase === 'serve' &&
          team === this.servingTeam &&
          this.serveWaiting
        ) {
          this.beginServe(true, this.serveChargePower(), 0, 'OK');
          return;
        }
        if (
          this.spikeCtl &&
          this.spikeCtl.team === team &&
          this.spikeCtl.chargeStart !== null &&
          this.spikeCtl.power === null
        ) {
          this.spikeCtl.power = clamp((this.time - this.spikeCtl.chargeStart) / 0.9, 0, 1);
        }
        return;
      }
      case 'aim': {
        const dz = clamp(inp.dz, -0.5, 0.5);
        if (this.phase === 'serve' && team === this.servingTeam && this.serveWaiting) {
          this.serveAimZ = clamp(this.serveAimZ + dz, -1, 1);
        } else if (this.spikeCtl && this.spikeCtl.team === team) {
          this.spikeCtl.aimZ = clamp(this.spikeCtl.aimZ + dz, -1, 1);
        }
        return;
      }
      case 'aimSet': {
        // アナログスティック: 倒し具合そのままの絶対指定
        const z = clamp(inp.z, -1, 1);
        if (this.phase === 'serve' && team === this.servingTeam && this.serveWaiting) {
          this.serveAimZ = z;
        } else if (this.spikeCtl && this.spikeCtl.team === team) {
          this.spikeCtl.aimZ = z;
        } else if (this.blockPromptTeam === team) {
          // ブロックの手の出し方もスティックで（打たれる直前まで変更可）
          this.blockCommit[team] = z < -0.33 ? 'L' : z > 0.33 ? 'R' : 'M';
        }
        return;
      }
      case 'spikePreset': {
        // フリック派生: パワーとコースを即時確定してスイングする
        if (this.spikeCtl && this.spikeCtl.team === team && this.spikeCtl.power === null) {
          this.spikeCtl.power = clamp(inp.power, 0, 1);
          if (inp.aimZ !== undefined) this.spikeCtl.aimZ = clamp(inp.aimZ, -1, 1);
        }
        return;
      }
      case 'plan': {
        this.plan[team] = inp.choice;
        this.emit('toss', `攻撃指示: ${CHOICE_LABEL[inp.choice]}`);
        return;
      }
      case 'posAdjust': {
        const slot = Math.round(inp.slot);
        if (slot >= 1 && slot <= 6) {
          const c = this.clampOwnHalf(team, inp.x, inp.z);
          this.posAdj[team][slot] = { x: c.x, z: c.z };
        }
        return;
      }
      case 'posReset': {
        this.posAdj[team] = {};
        return;
      }
      case 'setChoice': {
        if (this.setPrompt && this.setPrompt.team === team && !this.setPrompt.pressed) {
          this.setPrompt.choice = inp.choice;
        }
        return;
      }
      case 'blockCommit': {
        // 打たれる直前まで張り直せる（アナログ的な柔軟性）
        if (this.blockPromptTeam === team) {
          this.blockCommit[team] = inp.zone;
        }
        return;
      }
      case 'rematch': {
        if (this.phase === 'matchOver') {
          this.score = [0, 0];
          this.sets = [0, 0];
          this.setNo = 1;
          this.targetPts = this.computeTarget();
          this.winner = null;
          this.pendingSetBreak = null;
          for (const p of this.players) p.mstats = { atk: 0, kills: 0, blocks: 0, digs: 0, aces: 0 };
          this.servingTeam = Math.random() < 0.5 ? 0 : 1;
          this.enterPreServe();
        }
        return;
      }
    }
  }

  // ---------- メインループ ----------

  step(dt: number) {
    this.time += dt;

    // 予約モーションの発火
    for (let i = this.pendingActs.length - 1; i >= 0; i--) {
      const pa = this.pendingActs[i];
      if (this.time < pa.at) continue;
      this.pendingActs.splice(i, 1);
      if (pa.kind === 'attackJump' && pa.playerIdx !== undefined) {
        // 助走→踏み込み→スイングの一連モーション（接触は actT≈0.44 付近）
        this.setAct(this.players[pa.playerIdx], 'spike', 0.68);
      } else if (pa.kind === 'celebrateJump' && pa.playerIdx !== undefined) {
        this.setAct(this.players[pa.playerIdx], 'jump', 0.65);
      } else if (pa.kind === 'blockJump' && pa.defTeam !== undefined) {
        for (const p of this.teamPlayers(pa.defTeam)) {
          if (this.isFront(p.slot) && Math.abs(p.pos.z - (pa.z ?? 0)) < 2.6) {
            this.setAct(p, 'jump', 0.6);
            // ブロッカーはネット際へ寄る
            p.target = v3(p.team === 0 ? -0.7 : 0.7, 0, clamp(pa.z ?? 0, -4, 4));
          }
        }
      }
    }

    // 選手は全員自動で移動する。速さは能力値で差がつき、加速のなましで慣性・重量感を出す
    for (const p of this.players) {
      // スタミナ: 疲れると最高速が落ちる。ホームチームは回復が速い（隠しバフ）
      const maxSpeed = (4.2 + p.roster.stats.speed * 2.0) * this.fatigue(p);
      const dx = p.target.x - p.pos.x;
      const dz = p.target.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      let tvx = 0;
      let tvz = 0;
      if (d > 0.04) {
        const s = Math.min(maxSpeed, d * 6); // 到着間際は減速
        tvx = (dx / d) * s;
        tvz = (dz / d) * s;
      }
      const k = Math.min(1, 9 * dt); // 立ち上がり/切り返しの慣性
      p.vel.x += (tvx - p.vel.x) * k;
      p.vel.z += (tvz - p.vel.z) * k;
      p.pos.x += p.vel.x * dt;
      p.pos.z += p.vel.z * dt;
      // スタミナ回復（移動中は遅く、待機中は速い。ホーム＋スタミナ能力で加速）
      const moving = d > 0.3;
      const homeBonus = p.team === this.homeTeam ? 1.25 : 1.0;
      const recover = (moving ? 0.012 : 0.05) * (0.7 + (p.roster.st.stamina / 99) * 0.6) * homeBonus;
      p.stamina = clamp(p.stamina + recover * dt, 0, 1);
    }

    switch (this.phase) {
      case 'preServe': {
        this.timer -= dt;
        const sv = this.serverOf(this.servingTeam);
        this.ballPos = v3(sv.pos.x, 1.2, sv.pos.z);
        if (this.timer <= 0) this.enterServe();
        return;
      }
      case 'serve': {
        const sv = this.serverOf(this.servingTeam);
        if (this.servePending) {
          // トスアップ: ボールが手から頭上の打点へ上がる
          const prog = clamp(1 - (this.servePending.at - this.time) / 0.5, 0, 1);
          const hitY = 2.29 * sv.roster.height + 0.28;
          this.ballPos = v3(sv.pos.x, 1.2 + prog * (hitY - 1.2), sv.pos.z);
          if (this.time >= this.servePending.at) {
            const p = this.servePending;
            this.servePending = null;
            if (p.human) this.launchServeHuman(p.power);
            else this.launchServeCpu(p.zone, p.quality);
          }
          return;
        }
        this.timer -= dt;
        this.ballPos = v3(sv.pos.x, 1.2, sv.pos.z);
        if (this.timer <= 0) {
          if (this.cpu[this.servingTeam]) {
            const qr = Math.random();
            const q: TossQuality =
              qr < 0.25 ? 'PERFECT' : qr < 0.65 ? 'GOOD' : qr < 0.9 ? 'OK' : 'POOR';
            this.beginServe(false, 0, Math.ceil(rnd(0, 6)), q);
          } else {
            // 人間は自動では打たない: 8秒ルール違反で相手に1点
            this.startPoint((1 - this.servingTeam) as Team, '8秒ルール違反…', 'fault');
          }
        }
        return;
      }
      case 'rally': {
        if (!this.flight) return;
        this.flight.t += dt;
        this.ballPos = flightPos(this.flight);
        if (this.flight.t >= this.flight.T) {
          const plan = this.flight.plan;
          this.ballPos = { ...this.flight.p1 };
          this.flight = null;
          this.resolveContact(plan);
        }
        return;
      }
      case 'point': {
        this.timer -= dt;
        // VAR のリザルト公開（ここまで得点演出はお預け）
        if (this.varCall && this.pendingVarEv && this.time >= this.varCall.revealAt) {
          const pv = this.pendingVarEv;
          this.pendingVarEv = null;
          this.centerMsg = (this.varCall.inCall ? 'IN！ ' : 'OUT！ ') + pv.msg;
          this.emit(pv.ev, this.centerMsg, pv.scorer);
          this.celebrate(pv.scorer);
        }
        if (this.timer <= 0) {
          if (this.pendingSetBreak !== null) this.startNextSet();
          else this.enterPreServe();
        }
        return;
      }
      case 'matchOver':
        return;
    }
  }

  // ---------- スナップショット ----------

  // 各チームの「カーソルが乗っている」選手（カメラ追従・操作対象表示用）
  private cursorFor(team: Team): number | null {
    if (this.phase === 'preServe' || this.phase === 'serve') {
      return team === this.servingTeam
        ? this.players.indexOf(this.serverOf(team))
        : this.players.indexOf(this.setterOf(team));
    }
    const f = this.flight;
    if (!f) return this.players.indexOf(this.setterOf(team));
    const plan = f.plan;
    if ((plan.kind === 'receive' || plan.kind === 'dig') && plan.team === team) {
      return plan.playerIdx;
    }
    if (plan.kind === 'set' && plan.team === team) {
      return this.players.indexOf(this.setterOf(team));
    }
    if (plan.kind === 'attack') {
      if (plan.team === team) return plan.attackerIdx;
      // 守備側: 落下点に最も近い前衛ブロッカー
      let best: number | null = null;
      let bd = 1e9;
      this.players.forEach((p, i) => {
        if (p.team !== team || !this.isFront(p.slot)) return;
        const d = Math.abs(p.pos.z - f.p1.z);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      return best;
    }
    if (plan.kind === 'set' && plan.team !== team) {
      // 相手セット中はセンターブロッカーに構えさせる
      const mb = this.teamPlayers(team).find(
        (p) => this.isFront(p.slot) && (p.role === 'MB1' || p.role === 'MB2'),
      );
      return mb ? this.players.indexOf(mb) : null;
    }
    return this.players.indexOf(this.setterOf(team));
  }

  snapshot(): Snapshot {
    const prompts: [Prompt, Prompt] = [null, null];
    for (const team of [0, 1] as Team[]) {
      if (this.cpu[team]) continue;
      if (this.phase === 'serve' && team === this.servingTeam && this.serveWaiting) {
        prompts[team] = {
          mode: 'serve',
          charging: this.serveChargeStart !== null,
          power: this.serveChargePower(),
          aimZ: this.serveAimZ,
        };
      } else if (this.recvPrompt && this.recvPrompt.team === team) {
        prompts[team] = {
          mode: 'receive',
          arriveIn: Math.max(0, this.recvPrompt.arriveAt - this.time),
          total: this.recvPrompt.total,
          pressed: this.recvPrompt.pressed,
        };
      } else if (this.setPrompt && this.setPrompt.team === team) {
        prompts[team] = {
          mode: 'set',
          choice: this.setPrompt.choice,
          arriveIn: Math.max(0, this.setPrompt.arriveAt - this.time),
          total: this.setPrompt.arriveAt - this.setPrompt.opensAt,
          windowScale: this.setPrompt.windowScale,
          pressed: this.setPrompt.pressed,
          // タクティカル・ビュー用: 各トス選択のアタッカー
          options: CHOICES.map((c) => ({
            choice: c,
            idx: this.players.indexOf(this.attackerFor(team, c)),
          })),
        };
      } else if (this.spikeCtl && this.spikeCtl.team === team) {
        const c = this.spikeCtl;
        prompts[team] = {
          mode: 'spike',
          charging: c.chargeStart !== null && c.power === null,
          power:
            c.power ??
            (c.chargeStart !== null ? clamp((this.time - c.chargeStart) / 0.9, 0, 1) : 0),
          locked: c.power !== null,
          aimZ: c.aimZ,
          arriveIn: Math.max(0, c.arriveAt - this.time),
          total: c.total,
        };
      } else if (this.blockPromptTeam === team) {
        prompts[team] = {
          mode: 'block',
          committed: this.blockCommit[team],
          jumped: this.blockJumpAt[team] !== null,
        };
      }
    }

    const cursor: [number | null, number | null] = [
      this.cpu[0] ? null : this.cursorFor(0),
      this.cpu[1] ? null : this.cursorFor(1),
    ];

    const rotations: [number[], number[]] = [[], []];
    for (const team of [0, 1] as Team[]) {
      for (let slot = 1; slot <= 6; slot++) {
        const p = this.players.find((q) => q.team === team && q.slot === slot)!;
        rotations[team].push(LINEUP.indexOf(p.role));
      }
    }

    // ボールの次の到達点（落下点マーカー用）
    let ballTarget: Snapshot['ballTarget'] = null;
    if (this.flight) {
      const plan = this.flight.plan;
      const forTeam =
        plan.kind === 'receive' || plan.kind === 'dig' || plan.kind === 'set' || plan.kind === 'attack'
          ? plan.team
          : null;
      ballTarget = { pos: { ...this.flight.p1 }, forTeam };
    } else if (this.phase === 'serve' && this.serveWaiting && !this.cpu[this.servingTeam]) {
      // サーブの狙い先プレビュー（チャージ量=深さ、aim=コース）
      const st = this.servingTeam;
      const pw = this.serveChargeStart !== null ? this.serveChargePower() : 0.6;
      const depth = 2.8 + clamp(pw, 0.15, 1) * 5.1;
      const sideDir = st === 0 ? 1 : -1;
      ballTarget = {
        pos: v3(
          (st === 0 ? 1 : -1) * depth,
          0,
          clamp(sideDir * this.serveAimZ * 3.4, -4.2, 4.2),
        ),
        forTeam: st,
      };
    }

    return {
      t: this.time,
      phase: this.phase,
      players: this.players.map((p): PlayerSnap => {
        const el = this.time - p.actStart;
        const active = p.actKind && el >= 0 && el < p.actDur;
        return {
          team: p.team,
          role: p.role,
          slot: p.slot,
          pos: { ...p.pos },
          human: p.human,
          act: active ? p.actKind : null,
          actT: active ? el / p.actDur : 0,
          name: p.roster.name,
          num: p.roster.num,
          height: p.roster.height,
          stats: { ...p.roster.stats },
          mstats: { ...p.mstats },
          stamina: p.stamina,
          signature: p.roster.signature,
        };
      }),
      ball: { pos: { ...this.ballPos }, visible: this.ballVisible },
      ballTarget,
      ballFlight: this.flight
        ? {
            p0: { ...this.flight.p0 },
            p1: { ...this.flight.p1 },
            T: this.flight.T,
            t: this.flight.t,
            h: this.flight.h,
          }
        : null,
      score: [...this.score] as [number, number],
      sets: [...this.sets] as [number, number],
      setNo: this.setNo,
      targetPts: this.targetPts,
      servingTeam: this.servingTeam,
      rotations,
      prompts,
      cursor,
      plan: [...this.plan] as [AttackChoice | null, AttackChoice | null],
      events: [...this.events],
      winner: this.winner,
      centerMsg: this.centerMsg,
      varCall: this.varCall
        ? {
            pos: { ...this.varCall.pos },
            inCall: this.varCall.inCall,
            conf: this.varCall.conf,
            scorer: this.varCall.scorer,
            remain: Math.max(0, this.varCall.revealAt - this.time),
          }
        : null,
    };
  }
}
