import { AttackChoice, Team, V3, v3 } from './types';

// すべてチーム0（x<0 側、+x を向く）の座標で定義し、チーム1 は mirror() で反転する。
// チーム0 の選手から見て（+x を向いて）右手方向が +z。
// つまり「レフト（ポジション4）」は z=-3 側、「ライト（ポジション2）」は z=+3 側。

export function mirror(p: V3, team: Team): V3 {
  return team === 0 ? p : v3(-p.x, p.y, -p.z);
}

// スロット別ベースポジション（ディフェンス時）
const BASE: Record<number, V3> = {
  1: v3(-6.5, 0, 3.0), // 後衛ライト
  2: v3(-2.5, 0, 3.0), // 前衛ライト
  3: v3(-2.5, 0, 0.0), // 前衛センター
  4: v3(-2.5, 0, -3.0), // 前衛レフト
  5: v3(-6.5, 0, -3.0), // 後衛レフト
  6: v3(-6.5, 0, 0.0), // 後衛センター
};

// サーブレシーブ時（W字気味）
const RECEIVE: Record<number, V3> = {
  1: v3(-6.8, 0, 2.6),
  2: v3(-3.5, 0, 3.2),
  3: v3(-3.2, 0, 0.0),
  4: v3(-3.5, 0, -3.2),
  5: v3(-6.8, 0, -2.6),
  6: v3(-7.4, 0, 0.0),
};

export function basePos(team: Team, slot: number, phase: 'base' | 'receive'): V3 {
  const t = phase === 'receive' ? RECEIVE[slot] : BASE[slot];
  return mirror(t, team);
}

// サーバーの立ち位置（エンドライン後方、自分から見て右寄り）
export function servePos(team: Team): V3 {
  return mirror(v3(-9.6, 0, 2.0), team);
}

// セッターの定位置（ネット右寄りに侵入）
export function setterSpot(team: Team): V3 {
  return mirror(v3(-1.3, 0, 1.2), team);
}

// 攻撃選択ごとの助走・打点ポイント（レフトは自分から見て左＝-z）
const APPROACH: Record<AttackChoice, V3> = {
  LEFT: v3(-1.9, 0, -3.3),
  QUICK: v3(-1.3, 0, -0.5),
  RIGHT: v3(-1.9, 0, 3.3),
  PIPE: v3(-4.2, 0, -0.9),
  TWO: v3(-1.1, 0, 1.0), // ツーアタックはセッター位置付近（実際は performSet 側で上書き）
};

export function approachPos(team: Team, choice: AttackChoice): V3 {
  return mirror(APPROACH[choice], team);
}

// サーブターゲットゾーン (1..6) → 相手コートの着弾目標
// 受け手チームの標準ゾーン番号（1=後衛ライト, 6=後衛センター, 5=後衛レフト,
// 2=前衛ライト, 3=前衛センター, 4=前衛レフト）
const SERVE_ZONE: Record<number, V3> = {
  1: v3(-7.5, 0, 3.0),
  2: v3(-2.5, 0, 3.0),
  3: v3(-2.5, 0, 0.0),
  4: v3(-2.5, 0, -3.0),
  5: v3(-7.5, 0, -3.0),
  6: v3(-7.5, 0, 0.0),
};

export function serveTarget(receivingTeam: Team, zone: number): V3 {
  return mirror(SERVE_ZONE[zone] ?? SERVE_ZONE[6], receivingTeam);
}
