// 共有シミュレーションの型定義。クライアント・サーバー両方から import される。
// three.js には依存しない純粋な TypeScript にしておくこと。

export type Team = 0 | 1;

export interface V3 {
  x: number; // コート長辺方向。ネットが x=0、チーム0 が x<0 側
  y: number; // 高さ
  z: number; // コート短辺方向 (-4.5 .. 4.5)
}

export type Role = 'S' | 'OH1' | 'MB1' | 'OP' | 'OH2' | 'MB2';

// 5-1 のローテーション順（スロット1から時計回り）
export const LINEUP: Role[] = ['S', 'OH1', 'MB1', 'OP', 'OH2', 'MB2'];

// トスの種類: オープン(レフト) / クイック / バック(ライト) / 二段(パイプ) / ツーアタック
export type AttackChoice = 'LEFT' | 'QUICK' | 'RIGHT' | 'PIPE' | 'TWO';
export type BlockZone = 'L' | 'M' | 'R';
export type Tactic = 'aggressive' | 'balanced' | 'defensive';

export type TossQuality = 'PERFECT' | 'GOOD' | 'OK' | 'POOR';

export type PlayerAct = 'jump' | 'dig' | 'lunge' | 'set' | 'spike' | 'serve' | null;

// 選手の能力値 (0..1)。Stats99 から導出されるシム内部値
export interface PlayerStats {
  attack: number;
  block: number;
  receive: number;
  serve: number;
  speed: number;
}

// 1〜99 の詳細ステータス（このゲームの核。コストとプレー精度の源泉）
export interface Stats99 {
  spike: number; // スパイクの成功率と威力
  power: number; // ブロックを弾き飛ばす力
  block: number; // 相手のスパイクを止める力
  receive: number; // 乱れたボールをセッターへ返す力
  jump: number; // 最高到達点
  agility: number; // 敏捷性・反応速度
  teamwork: number; // 連携（トス・レシーブの精度）
  decision: number; // 判断力（読み・予測）
}

export type PosKey = 'S' | 'OH' | 'MB' | 'OP';

export interface RosterEntry {
  name: string;
  num: number; // 背番号
  height: number; // 身長スケール (約 0.92..1.08)
  pos: PosKey;
  st: Stats99; // 詳細ステータス (1-99)
  rating: number; // ポジション別重み付けの総合値
  cost: number; // サラリーコスト
  skills: string[]; // 固有スキル（最大2）
  focus: string | null; // 特化型契約（例: レシーブ特化 → コスト割引）
  stats: PlayerStats; // シム用の導出値
  // ---- データアナリティクス ----
  form: number; // 調子の波 (0.85..1.15)。決定率/レシーブに実際に効く
  trend: [number, number, number]; // 過去3試合のパフォーマンス (0..1, スパークライン用)
  tendency: { L: number; C: number; R: number }; // 攻撃コースの分布（CPUは実際にこの傾向で打つ）
  signature: string | null; // シグネチャー・ムーブ（データ分析で抽出された癖）
}

// 試合中の個人スタッツ（アナリティクス・ダッシュボード用）
export interface MatchStats {
  atk: number; // スパイク試行
  kills: number; // スパイク決定
  blocks: number; // シャットブロック
  digs: number; // 成功レシーブ
  aces: number; // サービスエース
}

export interface PlayerSnap {
  team: Team;
  role: Role;
  slot: number; // 1..6
  pos: V3;
  human: boolean;
  act: PlayerAct; // 実行中のモーション
  actT: number; // モーション進行度 0..1
  name: string;
  num: number;
  height: number;
  stats: PlayerStats; // モーション個性の生成・UI 表示用
  mstats: MatchStats; // 試合中の個人成績
}

// 各チームの人間プレイヤーに提示する入力プロンプト（eFootball 型: ゲージ＋タイミング）
export type Prompt =
  | { mode: 'serve'; charging: boolean; power: number; aimZ: number }
  | { mode: 'receive'; arriveIn: number; total: number; pressed: TossQuality | null }
  | {
      mode: 'set';
      choice: AttackChoice;
      arriveIn: number; // ボールがセッターに届くまでの秒数
      total: number; // フライト全体の秒数
      windowScale: number; // パス精度による判定窓の倍率 (小さいほどシビア)
      pressed: TossQuality | null;
      // 各トス選択に対応するアタッカー（タクティカル・ビューのマーカー表示用）
      options: { choice: AttackChoice; idx: number }[];
    }
  | {
      mode: 'spike';
      charging: boolean;
      power: number; // 溜め中/確定後のパワー 0..1
      locked: boolean; // 離してパワー確定済みか
      aimZ: number; // -1(左)..1(右) コース
      arriveIn: number;
      total: number;
    }
  | { mode: 'block'; committed: BlockZone | null; jumped: boolean }
  | null;

export interface SimEvent {
  seq: number;
  kind:
    | 'whistle'
    | 'serve'
    | 'contact'
    | 'spike'
    | 'point'
    | 'block'
    | 'ace'
    | 'fault'
    | 'toss'
    | 'var'
    | 'matchOver';
  msg?: string;
  team?: Team;
}

export type Phase = 'preServe' | 'serve' | 'rally' | 'point' | 'matchOver';

export interface Snapshot {
  t: number;
  phase: Phase;
  players: PlayerSnap[];
  ball: { pos: V3; visible: boolean };
  // ボールが次に到達する地点。forTeam はそこで触るチーム（床落下なら null）
  ballTarget: { pos: V3; forTeam: Team | null } | null;
  // 現在の飛行パラメータ（軌道予測線の描画用）
  ballFlight: { p0: V3; p1: V3; T: number; t: number; h: number } | null;
  score: [number, number];
  sets: [number, number]; // 取得セット数
  setNo: number; // 現在のセット番号 (1始まり)
  targetPts: number; // このセットの先取点 (25 or 15)
  servingTeam: Team;
  rotations: [number[], number[]]; // 各チームのスロット順ロール index（HUD 用）
  prompts: [Prompt, Prompt];
  // 各チームの「今カーソルが乗っている（操作対象の）」選手 index。カメラ追従とカーソル表示用
  cursor: [number | null, number | null];
  // リングメニューで指示中の攻撃プラン（トス初期選択）
  plan: [AttackChoice | null, AttackChoice | null];
  events: SimEvent[]; // 直近イベント（seq で重複排除）
  winner: Team | null;
  centerMsg: string | null;
  // VAR（ビデオ判定）進行中の状態。remain はリザルト公開までの秒数
  varCall: {
    pos: V3;
    inCall: boolean;
    conf: number; // 判定確度 %
    scorer: Team;
    remain: number;
  } | null;
}

export type Input =
  | { type: 'actionDown' } // アクションボタン押下（文脈で チャージ開始/タイミング押し）
  | { type: 'actionUp' } // アクションボタン離し（チャージ確定）
  | { type: 'aim'; dz: number } // サーブ/スパイクのコース調整（キー: 増分）
  | { type: 'aimSet'; z: number } // アナログスティックの倒し具合による絶対指定
  // フリック派生スパイク（上=ふわりフェイント / 下=コントロール / 左右=コース強打）
  | { type: 'spikePreset'; power: number; aimZ?: number }
  | { type: 'setChoice'; choice: AttackChoice }
  | { type: 'blockCommit'; zone: BlockZone }
  | { type: 'plan'; choice: AttackChoice } // リングメニューの攻撃指示（トスの初期選択）
  | { type: 'posAdjust'; slot: number; x: number; z: number } // 監督UI: 守備位置の微調整
  | { type: 'posReset' } // 監督UI: 位置調整をリセット
  | { type: 'rematch' };

// ---- コート定数 ----
export const COURT_HALF_X = 9;
export const COURT_HALF_Z = 4.5;
export const NET_HEIGHT = 2.43;
export const TARGET_SCORE = 25;

export const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });
export const dist2d = (a: V3, b: V3) =>
  Math.hypot(a.x - b.x, a.z - b.z);
export const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
