import * as THREE from 'three';
import {
  COURT_HALF_Z,
  NET_HEIGHT,
  PlayerSnap,
  Snapshot,
  Team,
} from '../sim/types';

const TEAM_JERSEY: Record<Team, number> = { 0: 0x2d6cdf, 1: 0xd94040 };
const TEAM_TRIM: Record<Team, number> = { 0: 0x1a3f85, 1: 0x8a2020 };
const SKIN_TONES = [0xe8c39e, 0xd9a877, 0xc98f5e, 0xf0d0b0];
const HAIR_COLORS = [0x2b2118, 0x120e0a, 0x4a3320, 0x3a3a3e, 0x6b4a26];

function courtTexture(): THREE.CanvasTexture {
  const w = 1024;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  // 周辺フロア（明るい木目調）
  g.fillStyle = '#e7c98f';
  g.fillRect(0, 0, w, h);
  const sx = w / 24;
  const sy = h / 15;
  const cx = (x: number) => (x + 12) * sx;
  const cy = (z: number) => (z + 7.5) * sy;
  // 木目の縞
  g.globalAlpha = 0.12;
  for (let i = 0; i < w; i += 6) {
    g.fillStyle = i % 12 === 0 ? '#c9a25f' : '#f0dca8';
    g.fillRect(i, 0, 3, h);
  }
  g.globalAlpha = 1;
  // コート本体（鮮やかなブルー）とフロントゾーン（オレンジ）
  g.fillStyle = '#2f7bd6';
  g.fillRect(cx(-9), cy(-4.5), 18 * sx, 9 * sy);
  g.fillStyle = '#e07a3a';
  g.fillRect(cx(-3), cy(-4.5), 6 * sx, 9 * sy);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 6;
  g.strokeRect(cx(-9), cy(-4.5), 18 * sx, 9 * sy);
  const line = (x1: number, z1: number, x2: number, z2: number) => {
    g.beginPath();
    g.moveTo(cx(x1), cy(z1));
    g.lineTo(cx(x2), cy(z2));
    g.stroke();
  };
  line(0, -4.5, 0, 4.5);
  line(-3, -4.5, -3, 4.5);
  line(3, -4.5, 3, 4.5);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// ミカサ風の黄×青ボールテクスチャ
function ballTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffd23e';
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#1560d4';
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.ellipse(32 + i * 64, i % 2 === 0 ? 34 : 94, 40, 18, 0.35, 0, Math.PI * 2);
    g.fill();
  }
  const bt = new THREE.CanvasTexture(c);
  bt.colorSpace = THREE.SRGBColorSpace;
  return bt;
}

// 名前 + 背番号/ロールの2段ラベル
function makeLabel(name: string, sub: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.textAlign = 'center';
  g.strokeStyle = 'rgba(0,0,0,0.75)';
  g.lineWidth = 7;
  g.font = 'bold 44px sans-serif';
  g.fillStyle = color;
  g.strokeText(name, 128, 48);
  g.fillText(name, 128, 48);
  g.font = 'bold 26px sans-serif';
  g.fillStyle = '#c8d6e4';
  g.lineWidth = 5;
  g.strokeText(sub, 128, 92);
  g.fillText(sub, 128, 92);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
  const s = new THREE.Sprite(mat);
  s.scale.set(1.1, 0.55, 1);
  return s;
}

// ボール用の発光ハロー（選手やネット越しでも視認できる）
function makeHalo(): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,220,80,0.9)');
  grad.addColorStop(0.5, 'rgba(255,200,60,0.35)');
  grad.addColorStop(1, 'rgba(255,200,60,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const mat = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(c),
    transparent: true,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const s = new THREE.Sprite(mat);
  s.scale.set(0.6, 0.6, 1);
  return s;
}

// 関節ポーズ（毎フレーム目標値を計算し、現在値をブレンドして滑らかに遷移させる）
interface Pose {
  yOff: number;
  lean: number; // 前傾(+)/反り(-)
  twist: number; // 体のひねり
  armLZ: number; // 肩の開き（Z回転）
  armRZ: number;
  armLX: number; // 肩の前後振り（X回転）
  armRX: number;
  elbL: number; // 肘の曲げ
  elbR: number;
  legL: number;
  legR: number;
  kneeL: number; // 膝の曲げ
  kneeR: number;
}

// 選手ごとのモーション個性（能力値 + 名前のシードから決定的に生成）
interface MotionStyle {
  cadence: number; // 走りのピッチ
  bounce: number; // 走りの上下動
  armAmp: number; // 腕振りの大きさ
  crouch: number; // 踏み切りのしゃがみ込みの深さ
  windup: number; // スパイクの引き腕の大きさ
  snapExtra: number; // スイングの鋭さ（ブレンド速度に加算）
  guard: number; // 左腕ガードの上げ方の個性
}

function motionStyle(p: PlayerSnap): MotionStyle {
  let h = (p.num * 37) >>> 0;
  for (const ch of p.name) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  const r = () => {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    return (h >>> 8) / 16777216;
  };
  return {
    cadence: 6.0 + p.stats.speed * 3.4 + r() * 1.4,
    bounce: 0.015 + r() * 0.03,
    armAmp: 0.3 + p.stats.speed * 0.25 + r() * 0.3,
    crouch: 0.1 + p.stats.attack * 0.1 + r() * 0.07,
    windup: 0.65 + p.stats.attack * 0.55 + r() * 0.45,
    snapExtra: p.stats.attack * 0.25 + r() * 0.15,
    guard: r(),
  };
}

const POSE_REST: Pose = {
  yOff: 0, lean: 0, twist: 0,
  armLZ: 0.12, armRZ: -0.12, armLX: 0, armRX: 0,
  elbL: 0.25, elbR: 0.25, legL: 0, legR: 0, kneeL: 0.06, kneeR: 0.06,
};

interface PlayerParts {
  group: THREE.Group; // 位置 + 向き
  body: THREE.Group; // ポーズ用（ジャンプの上下・前傾・ひねり）
  lSh: THREE.Group; // 肩
  rSh: THREE.Group;
  lElb: THREE.Group; // 肘
  rElb: THREE.Group;
  rHand: THREE.Mesh; // スイングトレイル用
  lLeg: THREE.Group;
  rLeg: THREE.Group;
  lKnee: THREE.Group;
  rKnee: THREE.Group;
  shadow: THREE.Mesh;
  label: THREE.Sprite; // 名前タグ（ボール関与選手のみ表示）
  walk: number;
  lastX: number;
  lastZ: number;
  pose: Pose;
  style: MotionStyle;
}

// 背番号テクスチャ（ユニフォームの胸/背中に貼る）
function numberTexture(num: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.font = '900 64px "Segoe UI", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.fillText(String(num), 48, 52);
  return new THREE.CanvasTexture(c);
}

// ローポリ人型選手を組み立てる（肘・首・背番号・接地影つき）
function buildPlayer(p: PlayerSnap, idx: number): PlayerParts {
  const jersey = new THREE.MeshStandardMaterial({ color: TEAM_JERSEY[p.team], roughness: 0.7 });
  const trim = new THREE.MeshStandardMaterial({ color: TEAM_TRIM[p.team], roughness: 0.7 });
  const skin = new THREE.MeshStandardMaterial({
    color: SKIN_TONES[idx % SKIN_TONES.length],
    roughness: 0.6,
  });
  const hair = new THREE.MeshStandardMaterial({
    color: HAIR_COLORS[(idx * 7 + p.team * 3) % HAIR_COLORS.length],
    roughness: 0.9,
  });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.8 });

  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  // 脚: 股関節グループ → 太もも → 膝グループ → ふくらはぎ + ソックス + シューズ
  // （スラッとした長脚。腰高 0.74）
  const mkLeg = (side: number) => {
    const hip = new THREE.Group();
    hip.position.set(0.13 * side, 0.74, 0);
    // 太もも（男性的に太め、カプセルで滑らかに）
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.082, 0.34, 6, 20), skin);
    thigh.position.y = -0.2;
    thigh.scale.set(1, 1, 0.92);
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.y = -0.42;
    hip.add(knee);
    const kneeCap = new THREE.Mesh(new THREE.SphereGeometry(0.062, 16, 12), skin);
    knee.add(kneeCap);
    // ふくらはぎ（筋肉のふくらみ）
    const calf = new THREE.Mesh(new THREE.CapsuleGeometry(0.058, 0.2, 6, 20), skin);
    calf.position.y = -0.14;
    calf.scale.set(1, 1, 0.9);
    knee.add(calf);
    const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.046, 0.12, 16), white);
    sock.position.y = -0.29;
    knee.add(sock);
    // シューズ（丸みのある靴）
    const shoe = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.14, 5, 14), white);
    shoe.rotation.z = Math.PI / 2;
    shoe.position.set(0, -0.35, 0.06);
    shoe.scale.set(1, 1, 1.35);
    knee.add(shoe);
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.04, 0.26), trim);
    sole.position.set(0, -0.39, 0.06);
    knee.add(sole);
    body.add(hip);
    return { hip, knee };
  };
  const ll = mkLeg(-1);
  const rl = mkLeg(1);

  // 短パン（腰回り、男性的に）
  const shorts = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.19, 0.26, 20), trim);
  shorts.position.y = 0.85;
  shorts.scale.set(1.08, 1, 0.82);
  body.add(shorts);
  // 腰と太ももの分け目
  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 0.2), jersey);
  seam.position.y = 0.78;
  body.add(seam);

  // 胴体（男性的な逆三角形: 胸板が広く腰が締まる）
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.21, 0.42, 10, 24), jersey);
  torso.position.y = 1.18;
  torso.scale.set(1.12, 1, 0.66);
  body.add(torso);
  // 胸板（左右の大胸筋）
  for (const side of [-1, 1]) {
    const pec = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), jersey);
    pec.position.set(0.08 * side, 1.3, 0.1);
    pec.scale.set(1, 0.8, 0.6);
    body.add(pec);
  }
  // 広い肩（僧帽筋〜三角筋）
  for (const side of [-1, 1]) {
    const pad = new THREE.Mesh(new THREE.SphereGeometry(0.095, 18, 14), jersey);
    pad.position.set(0.29 * side, 1.44, 0);
    pad.scale.set(1.1, 0.9, 1);
    body.add(pad);
  }
  const trap = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), jersey);
  trap.position.set(0, 1.46, 0);
  trap.scale.set(1.5, 0.5, 0.7);
  body.add(trap);

  // 背番号（胸 + 背中）
  const numTex = numberTexture(p.num);
  for (const [z, ry, s] of [
    [0.15, 0, 0.16],
    [-0.15, Math.PI, 0.2],
  ] as const) {
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(s, s),
      new THREE.MeshBasicMaterial({ map: numTex, transparent: true }),
    );
    plane.position.set(0, 1.26, z);
    plane.rotation.y = ry;
    body.add(plane);
  }

  // 腕: 肩グループ → 上腕 → 肘グループ → 前腕 + 手
  // リーチは 0.36+0.36+手 = 約0.78。肩(1.28)+リーチ = 2.06 が頭上到達点で、
  // シム側の打点計算 (2.06×身長+ジャンプ) と一致し、手とボールが必ず接触する
  // 腕: 長いリーチ（上腕0.42 + 前腕0.40 + 手）。肩 1.40 + リーチ ≈ 2.29 が頭上到達点で、
  // シム側の全接触点計算(2.29×身長)と一致し、手とボールが必ず触れて見える
  const mkArm = (side: number) => {
    const sh = new THREE.Group();
    sh.position.set(0.3 * side, 1.4, 0);
    // 上腕（半袖ユニフォームの袖 + 力こぶ）
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.052, 0.14, 16), jersey);
    sleeve.position.y = -0.07;
    sh.add(sleeve);
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.28, 5, 16), skin);
    upper.position.y = -0.22;
    sh.add(upper);
    const elb = new THREE.Group();
    elb.position.y = -0.42;
    sh.add(elb);
    // 前腕（手首に向かって細く）
    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.042, 0.28, 5, 16), skin);
    fore.position.y = -0.2;
    elb.add(fore);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.052, 14, 12), skin);
    hand.position.y = -0.42;
    hand.scale.set(1, 1.25, 0.7); // 手のひららしい平たさ
    elb.add(hand);
    body.add(sh);
    return { sh, elb, hand };
  };
  const la = mkArm(-1);
  const ra = mkArm(1);

  // 首（男性的に太め） + 頭 + 髪 + 顔（目・眉）。全員男性選手。
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.076, 0.11, 16), skin);
  neck.position.y = 1.55;
  body.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 32, 24), skin);
  head.position.y = 1.69;
  head.scale.set(0.96, 1.05, 1); // やや面長の男性頭部
  body.add(head);
  // あご（男性的な輪郭）
  const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.12, 20, 16), skin);
  jaw.position.set(0, 1.63, 0.02);
  jaw.scale.set(0.92, 0.7, 0.95);
  body.add(jaw);

  // 男性の短髪バリエーション（背番号で決定的に: 0=角刈り 1=ソフトモヒカン 2=七三/坊主寄り）
  const style = p.num % 3;
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.158, 32, 20, 0, Math.PI * 2, 0, Math.PI * (style === 2 ? 0.42 : 0.52)),
    hair,
  );
  cap.position.y = 1.71;
  cap.rotation.x = -0.1;
  body.add(cap);
  if (style === 0) {
    // 角刈り: 生え際を四角く
    const front = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 0.16), hair);
    front.position.set(0, 1.76, 0.06);
    body.add(front);
  } else if (style === 1) {
    // ソフトモヒカン: 中央に立ち上げ
    const crest = new THREE.Mesh(new THREE.CapsuleGeometry(0.028, 0.1, 4, 8), hair);
    crest.position.set(0, 1.83, 0.02);
    body.add(crest);
  }
  // もみあげ
  for (const side of [-1, 1]) {
    const sb = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.04), hair);
    sb.position.set(0.13 * side, 1.66, 0.04);
    body.add(sb);
  }

  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x241a12 });
  for (const side of [-1, 1]) {
    // 白目 + 黒目で立体感
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 10), eyeMat);
    eye.position.set(0.055 * side, 1.7, 0.138);
    body.add(eye);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.016, 0.016), hair);
    brow.position.set(0.055 * side, 1.742, 0.14);
    brow.rotation.z = -0.14 * side;
    body.add(brow);
  }
  // 鼻（男性的な立体感）
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.05, 8), skin);
  nose.position.set(0, 1.675, 0.15);
  nose.rotation.x = Math.PI / 2;
  body.add(nose);

  // 接地影（ジャンプ中は縮む）
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.34, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32 }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.012;
  group.add(shadow);

  // 名前・背番号ラベル
  const roleShort =
    p.role === 'S' ? 'S' : p.role.startsWith('OH') ? 'OH' : p.role === 'OP' ? 'OP' : 'MB';
  const label = makeLabel(p.name, `${roleShort} #${p.num}`, p.human ? '#ffe34d' : '#ffffff');
  label.position.y = 2.1 * p.height + 0.12;
  group.add(label);

  // 身長差（体格のみスケール、ラベルは据え置き）
  body.scale.setScalar(p.height);

  // 全パーツが動的シャドウを落とす（スプライトのラベルは除外）
  body.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
  });
  // 偽の接地影は薄く（実シャドウの補助として最小限）
  (shadow.material as THREE.MeshBasicMaterial).opacity = 0.14;

  // ネット方向を向く
  group.rotation.y = p.team === 0 ? Math.PI / 2 : -Math.PI / 2;

  return {
    group,
    body,
    lSh: la.sh,
    rSh: ra.sh,
    lElb: la.elb,
    rElb: ra.elb,
    rHand: ra.hand,
    lLeg: ll.hip,
    rLeg: rl.hip,
    lKnee: ll.knee,
    rKnee: rl.knee,
    shadow,
    label,
    walk: 0,
    lastX: p.pos.x,
    lastZ: p.pos.z,
    pose: { ...POSE_REST },
    style: motionStyle(p),
  };
}

// ネットの網目テクスチャ
function netTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 256, 64);
  g.strokeStyle = 'rgba(240,240,245,0.9)';
  g.lineWidth = 1.6;
  for (let x = 0; x <= 256; x += 8) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 64);
    g.stroke();
  }
  for (let y = 0; y <= 64; y += 8) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(256, y);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 1);
  return tex;
}

// ネット上帯の大会ロゴ
function bandTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f5f5f5';
  g.fillRect(0, 0, 1024, 32);
  g.font = '900 22px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#16283c';
  for (let i = 0; i < 3; i++) g.fillText('eVolleyball CUP', 180 + i * 340, 17);
  return new THREE.CanvasTexture(c);
}

// LED 広告看板のテクスチャ
function adTexture(text: string, fg: string, bg: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 48;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 48);
  g.font = '900 30px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = fg;
  g.fillText(text, 128, 26);
  g.fillText(text, 384, 26);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

function makeRing(color: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(0.24, 0.36, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.015;
  return m;
}

export class GameRenderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  players: PlayerParts[] = [];
  ball: THREE.Mesh;
  ballShadow: THREE.Mesh;
  targetRing: THREE.Mesh;
  trajLine: THREE.Line;
  cursorCone: THREE.Mesh;
  hitMarker: THREE.Group; // 打点（ボールを捉える高さ）の立体マーカー
  private hitSphere: THREE.Mesh;
  private hitLine: THREE.Line;
  impactRing: THREE.Mesh; // VAR 用の着弾ハイライト
  shakeT = 0;
  clockT = 0;

  camMode: 'follow' | 'bench' = 'follow';
  // VAR/リプレイ用のシネマティックカメラ（設定中は通常カメラを無効化）
  overrideCam: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
  private camPos = new THREE.Vector3(-12, 4, 0);
  private lookPos = new THREE.Vector3(0, 1, 0);
  private tacticalT = 0; // セット機会の広角タクティカル・ビュー (0..1)
  private optSprites: THREE.Sprite[] = [];
  private trailPts: THREE.Vector3[] = [];
  private trailFresh = false;
  private trailLine!: THREE.Line;
  private flashSpr!: THREE.Sprite;
  private flashT = 0;
  private adTextures: THREE.CanvasTexture[] = [];
  hideLabels = false; // リプレイ/VAR 中は名前タグを全て隠す
  myTeam: Team = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    // 明るくクリーンな見た目: ACES トーンマップ + sRGB + 柔らかい動的シャドウ
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.05, 200);

    // 明るい体育館: 空色→白のグラデ背景 + 淡いフォグ
    this.scene.background = this.skyGradient();
    this.scene.fog = new THREE.Fog(0xdfeaf5, 46, 95);

    // 天井の自然光（半球光）+ 主光源（影を落とす）+ 反対側からのフィル光
    this.scene.add(new THREE.HemisphereLight(0xf2f8ff, 0x9aa6b0, 1.25));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.9);
    sun.position.set(7, 20, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 60;
    const sc = sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -14;
    sc.right = 14;
    sc.top = 12;
    sc.bottom = -12;
    sun.shadow.bias = -0.0004;
    sun.shadow.radius = 4;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xcfe0ff, 0.5);
    fill.position.set(-8, 10, -6);
    this.scene.add(fill);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 15),
      new THREE.MeshStandardMaterial({ map: courtTexture(), roughness: 0.72, metalness: 0.04 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    this.buildStadium();

    // ネット（網目テクスチャ）
    const netMat = new THREE.MeshStandardMaterial({
      map: netTexture(),
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      alphaTest: 0.05,
    });
    const netPlane = new THREE.Mesh(new THREE.PlaneGeometry(COURT_HALF_Z * 2 + 1, 1), netMat);
    netPlane.rotation.y = Math.PI / 2;
    netPlane.position.set(0, NET_HEIGHT - 0.5, 0);
    this.scene.add(netPlane);
    // 上帯（大会名入り）
    const band = new THREE.Mesh(
      new THREE.PlaneGeometry(COURT_HALF_Z * 2 + 1, 0.1),
      new THREE.MeshStandardMaterial({ map: bandTexture(), side: THREE.DoubleSide }),
    );
    band.rotation.y = Math.PI / 2;
    band.position.set(0, NET_HEIGHT, 0);
    this.scene.add(band);
    for (const z of [-COURT_HALF_Z - 0.55, COURT_HALF_Z + 0.55]) {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 2.6, 12),
        new THREE.MeshStandardMaterial({ color: 0x888888 }),
      );
      pole.position.set(0, 1.3, z);
      this.scene.add(pole);
      // 支柱の安全パッド
      const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.16, 1.9, 12),
        new THREE.MeshStandardMaterial({ color: 0x2456b0, roughness: 0.9 }),
      );
      pad.position.set(0, 0.95, z);
      this.scene.add(pad);
    }

    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.108, 32, 24),
      new THREE.MeshStandardMaterial({
        map: ballTexture(),
        roughness: 0.35,
        metalness: 0.02,
        emissive: 0x332200,
        emissiveIntensity: 0.18,
      }),
    );
    this.ball.castShadow = true;
    this.ball.add(makeHalo());
    this.scene.add(this.ball);

    // 軌道予測線
    const trajGeo = new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 20 }, () => new THREE.Vector3()),
    );
    this.trajLine = new THREE.Line(
      trajGeo,
      new THREE.LineBasicMaterial({ color: 0xffd034, transparent: true, opacity: 0.5 }),
    );
    this.trajLine.visible = false;
    this.scene.add(this.trajLine);

    // 操作対象カーソル（eFootball 実写と同じシアンの▼）
    this.cursorCone = new THREE.Mesh(
      new THREE.ConeGeometry(0.16, 0.3, 4),
      new THREE.MeshBasicMaterial({ color: 0x37e6cf }),
    );
    this.cursorCone.rotation.x = Math.PI; // 頂点を下に
    this.cursorCone.visible = false;
    this.scene.add(this.cursorCone);
    this.ballShadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.14, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }),
    );
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.ballShadow);

    this.targetRing = makeRing(0xffd034);
    this.targetRing.visible = false;
    this.scene.add(this.targetRing);

    // 打点マーカー: 空中の接触点（発光球 + 細リング）と地面への垂直ガイド線
    this.hitMarker = new THREE.Group();
    this.hitSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xff8c3a, transparent: true, opacity: 0.9 }),
    );
    this.hitMarker.add(this.hitSphere);
    const hitRing = new THREE.Mesh(
      new THREE.RingGeometry(0.16, 0.2, 24),
      new THREE.MeshBasicMaterial({
        color: 0xff8c3a,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
      }),
    );
    hitRing.rotation.x = -Math.PI / 2;
    this.hitMarker.add(hitRing);
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, -1, 0),
    ]);
    this.hitLine = new THREE.Line(
      lineGeo,
      new THREE.LineDashedMaterial({
        color: 0xff8c3a,
        transparent: true,
        opacity: 0.6,
        dashSize: 0.12,
        gapSize: 0.08,
      }),
    );
    this.hitMarker.add(this.hitLine);
    this.hitMarker.visible = false;
    this.scene.add(this.hitMarker);

    this.impactRing = makeRing(0xffffff);
    this.impactRing.visible = false;
    this.scene.add(this.impactRing);

    // タクティカル・ビュー用: 各トス選択のアタッカー頭上に出す番号マーカー (1-6)
    for (let i = 1; i <= 6; i++) {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 64;
      const g = c.getContext('2d')!;
      g.fillStyle = 'rgba(20, 90, 140, 0.9)';
      g.beginPath();
      g.arc(32, 32, 26, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#4dc3ff';
      g.lineWidth = 4;
      g.stroke();
      g.font = '900 34px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#fff';
      g.fillText(String(i), 32, 34);
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }),
      );
      sp.scale.set(0.42, 0.42, 1);
      sp.visible = false;
      this.scene.add(sp);
      this.optSprites.push(sp);
    }

    // スイングトレイル（振り抜きの軌跡）
    this.trailLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(
        Array.from({ length: 10 }, () => new THREE.Vector3()),
      ),
      new THREE.LineBasicMaterial({
        color: 0xfff0a8,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthTest: false,
      }),
    );
    this.trailLine.visible = false;
    this.scene.add(this.trailLine);

    // インパクトの閃光
    this.flashSpr = makeHalo();
    this.flashSpr.scale.set(1, 1, 1);
    this.flashSpr.visible = false;
    this.scene.add(this.flashSpr);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  // 打撃インパクトの閃光を出す（位置省略時はボール位置）
  impactFlash(pos?: THREE.Vector3) {
    this.flashT = 1;
    this.flashSpr.position.copy(pos ?? this.ball.position);
  }

  // 明るい体育館の空色→白グラデ背景
  private skyGradient(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = 8;
    c.height = 256;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#3a6ea5'); // 上: 濃いめの青
    grad.addColorStop(0.45, '#7fa8d0');
    grad.addColorStop(1, '#eaf1f8'); // 下: 明るい白
    g.fillStyle = grad;
    g.fillRect(0, 0, 8, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // スタジアム環境: 観客席・群衆・LED広告・照明コーン・センターロゴ
  private buildStadium() {
    // 観客スタンド（両サイドの段々）
    const standMat = new THREE.MeshStandardMaterial({ color: 0x141c29, roughness: 0.95 });
    for (const side of [-1, 1]) {
      for (let row = 0; row < 6; row++) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(34, 0.9, 1.7), standMat);
        step.position.set(0, row * 0.9 + 0.45, side * (8.6 + row * 1.7));
        this.scene.add(step);
      }
      // 手すり壁
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(34, 1.0, 0.15),
        new THREE.MeshStandardMaterial({ color: 0x1d2c42, roughness: 0.8 }),
      );
      wall.position.set(0, 0.5, side * 7.7);
      this.scene.add(wall);
    }
    // 群衆（インスタンス化した低ポリ観客）
    const crowdGeo = new THREE.BoxGeometry(0.24, 0.34, 0.2);
    const crowdMat = new THREE.MeshLambertMaterial();
    const COUNT = 2200;
    const crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, COUNT);
    const m = new THREE.Matrix4();
    const palette = [0x3a4d6b, 0x6b3a3a, 0x4d6b3a, 0x6b5f3a, 0x4a3a6b, 0x9aa4b5, 0x2d6cdf, 0xd94040];
    for (let i = 0; i < COUNT; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const row = Math.floor(Math.random() * 6);
      const x = (Math.random() - 0.5) * 32;
      m.setPosition(x, row * 0.9 + 1.05 + Math.random() * 0.06, side * (8.6 + row * 1.7));
      crowd.setMatrixAt(i, m);
      crowd.setColorAt(i, new THREE.Color(palette[Math.floor(Math.random() * palette.length)]));
    }
    crowd.instanceMatrix.needsUpdate = true;
    this.scene.add(crowd);

    // スタンド最上段の青い帯（eFootball の上層スタンドのブランドバンド）
    for (const side of [-1, 1]) {
      const bandTex = adTexture('eVolleyball', '#9fc0ff', '#14329e');
      this.adTextures.push(bandTex);
      const blueBand = new THREE.Mesh(
        new THREE.BoxGeometry(34, 0.9, 0.14),
        new THREE.MeshBasicMaterial({ map: bandTex }),
      );
      blueBand.position.set(0, 6.1, side * 17.6);
      this.scene.add(blueBand);
    }

    // LED 広告看板（eFootball の PLAY CRAZY 風マゼンタ基調。スクロールで光る）
    const ads: [string, string, string][] = [
      ['eVolleyball', '#ffffff', '#e5006d'],
      ['PLAY HOT!', '#ffe94d', '#c4005c'],
      ['SMASH!!', '#ffffff', '#e5006d'],
      ['VAR READY', '#4dc3ff', '#141b30'],
    ];
    let ai = 0;
    for (const side of [-1, 1]) {
      for (const x of [-8, 0, 8]) {
        const tex = adTexture(...ads[ai % ads.length]);
        ai++;
        this.adTextures.push(tex);
        const board = new THREE.Mesh(
          new THREE.BoxGeometry(7.6, 0.7, 0.12),
          new THREE.MeshBasicMaterial({ map: tex }),
        );
        board.position.set(x, 0.36, side * 6.9);
        this.scene.add(board);
      }
    }

    // 照明コーン（ナイトゲームの光の筋）と光源グロー
    for (const [lx, lz] of [[-7, -5], [7, -5], [-7, 5], [7, 5]] as const) {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(5.5, 13, 24, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xbfd8ff,
          transparent: true,
          opacity: 0.05,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      cone.position.set(lx * 0.5, 6.5, lz * 0.5);
      this.scene.add(cone);
      const glow = makeHalo();
      glow.position.set(lx, 13.2, lz);
      glow.scale.set(3.2, 3.2, 1);
      this.scene.add(glow);
    }

    // センターコートのロゴ
    const logoC = document.createElement('canvas');
    logoC.width = 256;
    logoC.height = 256;
    const lg = logoC.getContext('2d')!;
    lg.strokeStyle = 'rgba(255,255,255,0.5)';
    lg.lineWidth = 6;
    lg.beginPath();
    lg.arc(128, 128, 100, 0, Math.PI * 2);
    lg.stroke();
    lg.font = '900 84px sans-serif';
    lg.textAlign = 'center';
    lg.textBaseline = 'middle';
    lg.fillStyle = 'rgba(255,255,255,0.45)';
    lg.fillText('eV', 128, 134);
    const logo = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 3.4),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(logoC),
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
    );
    logo.rotation.x = -Math.PI / 2;
    logo.rotation.z = Math.PI / 2;
    logo.position.y = 0.013;
    this.scene.add(logo);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setMyTeam(team: Team) {
    this.myTeam = team;
    this.camPos.set(team === 0 ? -12 : 12, 4, 0);
  }

  toggleCam() {
    this.camMode = this.camMode === 'follow' ? 'bench' : 'follow';
  }

  private ensurePlayers(snaps: PlayerSnap[]) {
    if (this.players.length === snaps.length) return;
    for (const pm of this.players) this.scene.remove(pm.group);
    this.players = snaps.map((p, i) => {
      const parts = buildPlayer(p, i);
      parts.group.position.set(p.pos.x, 0, p.pos.z);
      this.scene.add(parts.group);
      return parts;
    });
  }

  shake(amount: number) {
    this.shakeT = Math.max(this.shakeT, amount);
  }

  // VAR の着弾ハイライト。color=null で非表示
  setImpact(pos: { x: number; z: number } | null, color = 0xffffff) {
    if (!pos) {
      this.impactRing.visible = false;
      return;
    }
    this.impactRing.visible = true;
    this.impactRing.position.set(pos.x, 0.02, pos.z);
    (this.impactRing.material as THREE.MeshBasicMaterial).color.setHex(color);
    const pulse = 1 + 0.25 * Math.sin(this.clockT * 9);
    this.impactRing.scale.set(pulse, pulse, 1);
  }

  // ボールが画面外のとき用: NDC 座標と画面外フラグ
  ballScreenInfo(): { off: boolean; x: number; y: number } {
    const v = this.ball.position.clone().project(this.camera);
    let { x, y } = v;
    const behind = v.z > 1;
    if (behind) {
      x = -x;
      y = -y;
    }
    const off = behind || Math.abs(x) > 1 || Math.abs(y) > 1 || !this.ball.visible;
    return { off, x: Math.max(-0.92, Math.min(0.92, x)), y: Math.max(-0.85, Math.min(0.85, y)) };
  }

  // モーション適用。目標ポーズを計算し、現在ポーズをブレンドして滑らかに遷移させる。
  // 走り/踏み切り/スパイクの腕振りには選手ごとの MotionStyle で個性が付く。
  private animatePlayer(pm: PlayerParts, snap: PlayerSnap, ballWorld: THREE.Vector3) {
    const dx = pm.group.position.x - pm.lastX;
    const dz = pm.group.position.z - pm.lastZ;
    const moved = Math.hypot(dx, dz);
    pm.lastX = pm.group.position.x;
    pm.lastZ = pm.group.position.z;
    const st = pm.style;
    pm.walk += moved * st.cadence;

    const tp: Pose = { ...POSE_REST };
    let blend = 0.2; // 通常のなめらかさ

    if (snap.act === 'spike') {
      // 現実のスパイク: ①最終歩の踏み込み(腕を後ろへ引いて沈む) ②空中で膝をたたみ
      // 弓なりに引き腕 ③頂点で一気に振り抜くインパクト ④体を横切るフォロースルー
      // ⑤着地で膝が沈むリコイル。 接触は actT≈0.44（ジャンプ頂点と一致）。
      const t = snap.actT;
      if (t < 0.28) {
        const c = Math.sin((t / 0.28) * Math.PI);
        tp.yOff = -st.crouch * 1.6 * c;
        tp.lean = 0.4 * c;
        tp.armLX = 1.0 * c;
        tp.armRX = 1.0 * c;
        tp.elbL = 0.4;
        tp.elbR = 0.4;
        tp.legL = 0.4 * c;
        tp.legR = -0.2 * c;
        tp.kneeL = 1.25 * c;
        tp.kneeR = 1.25 * c;
      } else {
        // ジャンプ頂点(0.72)がインパクト時刻 t=0.44 に来るように上昇/滞空を分ける
        tp.yOff =
          t < 0.44
            ? Math.sin((Math.PI / 2) * ((t - 0.28) / 0.16)) * 0.72
            : Math.cos((Math.PI / 2) * ((t - 0.44) / 0.56)) * 0.72;
        if (t < 0.44) {
          // 引き腕: 膝をたたみ、左腕でボールを指し、体を弓なりにひねる
          tp.armLZ = 1.4 + st.guard * 0.6;
          tp.armLX = -1.9; // 左腕はボールへポイント
          tp.elbL = 0.15;
          tp.armRX = st.windup * 1.15; // 右腕を大きく後ろへコック
          tp.armRZ = -0.6;
          tp.elbR = 1.7;
          tp.twist = -0.6;
          tp.lean = -0.26; // 深い弓なり
          tp.kneeL = 0.95; // 空中タック
          tp.kneeR = 0.95;
          tp.legL = -0.25;
          tp.legR = -0.25;
        } else if (t < 0.58) {
          const p = (t - 0.44) / 0.14;
          blend = 0.45 + st.snapExtra; // 振り抜きは鋭く
          tp.armRX = st.windup * 1.15 - (st.windup * 1.15 + 2.2) * p;
          tp.armRZ = -0.6 + 1.2 * p; // 体を横切るフォロースルーへ
          tp.elbR = 1.7 - 1.5 * p;
          tp.armLZ = 1.4 - 0.9 * p;
          tp.armLX = -1.9 + 1.6 * p;
          tp.elbL = 0.3;
          tp.twist = -0.6 + 1.0 * p;
          tp.lean = -0.26 + 0.62 * p; // 腹筋で畳み込む
          tp.kneeL = 0.5;
          tp.kneeR = 0.5;
        } else if (t < 0.85) {
          tp.armRX = -2.2;
          tp.armRZ = 0.6; // 振り抜いた腕が体を横切る
          tp.elbR = 0.2;
          tp.armLZ = 0.5;
          tp.twist = 0.4;
          tp.lean = 0.36;
          tp.kneeL = 0.35;
          tp.kneeR = 0.35;
        } else {
          // 着地リコイル: 膝で衝撃を受ける
          const c = Math.sin(((t - 0.85) / 0.15) * Math.PI);
          tp.lean = 0.3;
          tp.kneeL = 0.9 * c + 0.2;
          tp.kneeR = 0.9 * c + 0.2;
          tp.yOff = -0.08 * c;
          tp.armRX = -1.2;
        }
      }
    } else if (snap.act === 'serve') {
      // サーブ: 左手トスアップ → 深い弓なりで右腕コック → 頭上で叩き込む（actT≈0.71 接触）
      const t = snap.actT;
      if (t < 0.5) {
        tp.armLX = -2.7 * Math.min(1, t / 0.35); // 左手を高く残してトス
        tp.elbL = 0.1;
        tp.armRX = st.windup * 1.1 * Math.min(1, t / 0.4);
        tp.armRZ = -0.55;
        tp.elbR = 1.6;
        tp.lean = -0.2 * Math.min(1, t / 0.4); // 反り
        tp.twist = -0.25 * Math.min(1, t / 0.4);
        if (t > 0.35) {
          const c = (t - 0.35) / 0.15;
          tp.yOff = -0.12 * c; // 沈み込み
          tp.kneeL = 0.9 * c;
          tp.kneeR = 0.9 * c;
        }
      } else if (t < 0.72) {
        const p = (t - 0.5) / 0.22;
        blend = 0.45 + st.snapExtra;
        tp.armRX = st.windup * 1.1 - (st.windup * 1.1 + 2.1) * p;
        tp.armRZ = -0.55 + 0.9 * p;
        tp.elbR = 1.6 - 1.4 * p;
        tp.armLX = -2.7 + 2.2 * p;
        tp.yOff = Math.sin(((t - 0.5) / 0.5) * Math.PI) * 0.3;
        tp.lean = -0.2 + 0.55 * p; // 反りから叩き込みへ
        tp.twist = -0.25 + 0.5 * p;
        tp.kneeL = 0.45;
        tp.kneeR = 0.45;
      } else if (t < 0.88) {
        tp.armRX = -2.1;
        tp.armRZ = 0.35;
        tp.elbR = 0.25;
        tp.lean = 0.35;
        tp.twist = 0.25;
        tp.yOff = Math.max(0, Math.sin(((t - 0.5) / 0.5) * Math.PI) * 0.3);
        tp.kneeL = 0.4;
        tp.kneeR = 0.4;
      } else {
        // 着地リコイル
        const c = Math.sin(((t - 0.88) / 0.12) * Math.PI);
        tp.kneeL = 0.85 * c + 0.15;
        tp.kneeR = 0.85 * c + 0.15;
        tp.yOff = -0.07 * c;
        tp.lean = 0.25;
        tp.armRX = -1.0;
      }
    } else if (snap.act === 'jump') {
      // ブロック/歓喜: 踏み込み → 両腕を頭上に伸ばす
      const t = snap.actT;
      if (t < 0.2) {
        const c = Math.sin((t / 0.2) * Math.PI);
        tp.yOff = -st.crouch * 1.2 * c;
        tp.lean = 0.3 * c;
        tp.armLX = 0.8 * c;
        tp.armRX = 0.8 * c;
        tp.elbL = 0.6;
        tp.elbR = 0.6;
        tp.kneeL = 1.15 * c;
        tp.kneeR = 1.15 * c;
      } else if (t < 0.88) {
        const jt = (t - 0.2) / 0.8;
        tp.yOff = Math.sin(Math.PI * jt) * 0.62;
        tp.armLZ = 2.95;
        tp.armRZ = -2.95;
        tp.elbL = 0.05;
        tp.elbR = 0.05;
        tp.kneeL = 0.4; // 空中で軽くタック
        tp.kneeR = 0.4;
        blend = 0.3;
      } else {
        const c = Math.sin(((t - 0.88) / 0.12) * Math.PI);
        tp.kneeL = 0.8 * c + 0.15;
        tp.kneeR = 0.8 * c + 0.15;
        tp.yOff = -0.06 * c;
        tp.armLZ = 1.2;
        tp.armRZ = -1.2;
      }
    } else if (snap.act === 'set') {
      // オーバーヘッドトス: 額の上に構えて肘を伸ばして押し出す
      const t = Math.sin(Math.PI * snap.actT);
      tp.armLZ = 2.95;
      tp.armRZ = -2.95;
      tp.armLX = -0.25 * t;
      tp.armRX = -0.25 * t;
      tp.elbL = 1.1 - 0.9 * t; // 押し出しで肘が伸びる
      tp.elbR = 1.1 - 0.9 * t;
      tp.yOff = 0.08 * t;
      tp.lean = -0.1 * t;
      blend = 0.32;
    } else if (snap.act === 'lunge') {
      // ギリギリの飛びつき: 深く踏み込んで片腕を目一杯伸ばす（届いた！の演出）
      const t = Math.sin(Math.PI * Math.min(1, snap.actT * 1.15));
      tp.yOff = -0.34 * t;
      tp.lean = 0.85 * t;
      tp.twist = -0.3 * t;
      tp.armRX = -1.5 * t; // 右腕を前方へ全力で伸ばす
      tp.armRZ = -0.15;
      tp.elbR = 0.02;
      tp.armLX = 0.5 * t; // 左腕はバランス取り
      tp.armLZ = 0.9;
      tp.legL = 0.9 * t; // 大きく踏み込む
      tp.legR = -0.5 * t;
      tp.kneeL = 1.45 * t; // 前脚の膝を深く曲げる
      tp.kneeR = 0.35 * t;
      blend = 0.4;
    } else if (snap.act === 'dig') {
      // レシーブ: 低く沈んで両腕を前で組む（肘は伸ばす）
      const t = Math.sin(Math.PI * snap.actT);
      tp.yOff = -0.24 * t;
      tp.lean = 0.55 * t;
      tp.armLX = -1.15 * t;
      tp.armRX = -1.15 * t;
      tp.armLZ = 0.45;
      tp.armRZ = -0.45;
      tp.elbL = 0.05;
      tp.elbR = 0.05;
      tp.legL = 0.5 * t;
      tp.legR = -0.3 * t;
      tp.kneeL = 1.05 * t;
      tp.kneeR = 0.85 * t;
      blend = 0.34;
    } else if (moved > 0.002) {
      // 走り: ピッチ・腕振り・上下動・膝の畳み方に個性
      const s = Math.sin(pm.walk);
      tp.legL = s * 0.6;
      tp.legR = -s * 0.6;
      tp.kneeL = 0.3 + Math.max(0, s) * 0.9; // 前へ振る脚は膝を畳む
      tp.kneeR = 0.3 + Math.max(0, -s) * 0.9;
      tp.armLX = -s * st.armAmp;
      tp.armRX = s * st.armAmp;
      tp.elbL = 0.95; // 走りは肘を畳む
      tp.elbR = 0.95;
      tp.lean = 0.12 + Math.min(0.1, moved * 2);
      tp.yOff = Math.abs(Math.cos(pm.walk)) * st.bounce;
    } else {
      tp.yOff = Math.sin(this.clockT * 1.7 + pm.lastZ) * 0.012; // アイドル呼吸
    }

    // ポーズブレンド（すべての遷移がなめらかに）
    const po = pm.pose;
    const k = Math.min(1, blend);
    po.yOff += (tp.yOff - po.yOff) * k;
    po.lean += (tp.lean - po.lean) * k;
    po.twist += (tp.twist - po.twist) * k;
    po.armLZ += (tp.armLZ - po.armLZ) * k;
    po.armRZ += (tp.armRZ - po.armRZ) * k;
    po.armLX += (tp.armLX - po.armLX) * k;
    po.armRX += (tp.armRX - po.armRX) * k;
    po.elbL += (tp.elbL - po.elbL) * k;
    po.elbR += (tp.elbR - po.elbR) * k;
    po.legL += (tp.legL - po.legL) * k;
    po.legR += (tp.legR - po.legR) * k;
    po.kneeL += (tp.kneeL - po.kneeL) * k;
    po.kneeR += (tp.kneeR - po.kneeR) * k;

    pm.body.position.y = po.yOff;
    pm.body.rotation.x = po.lean;
    pm.body.rotation.y = po.twist;
    pm.lSh.rotation.z = po.armLZ;
    pm.rSh.rotation.z = po.armRZ;
    pm.lSh.rotation.x = po.armLX;
    pm.rSh.rotation.x = po.armRX;
    pm.lElb.rotation.x = -po.elbL;
    pm.rElb.rotation.x = -po.elbR;
    pm.lLeg.rotation.x = po.legL;
    pm.rLeg.rotation.x = po.legR;
    pm.lKnee.rotation.x = -po.kneeL;
    pm.rKnee.rotation.x = -po.kneeR;

    // インパクトIK: スパイク/サーブの接触ウィンドウでは、右腕をボールの実座標へ向けて
    // 「絶対に手がボールに当たって見える」ことを保証する
    const inSpikeWin = snap.act === 'spike' && snap.actT > 0.36 && snap.actT < 0.56;
    const inServeWin = snap.act === 'serve' && snap.actT > 0.58 && snap.actT < 0.78;
    if (inSpikeWin || inServeWin) {
      pm.body.updateWorldMatrix(true, false);
      const local = pm.body.worldToLocal(ballWorld.clone());
      const dy = local.y - 1.4; // 右肩の局所位置
      const dz = local.z;
      const len = Math.hypot(dy, dz);
      if (len > 0.05) {
        const theta = Math.atan2(dz / len, -dy / len);
        pm.rSh.rotation.x += (theta - pm.rSh.rotation.x) * 0.65;
        pm.rElb.rotation.x *= 0.3; // 肘を伸ばして最大リーチ
      }
    }
    // ブロックIK: 跳んでいる間、ボールが近ければ両腕をボールへ向けて壁を作る
    if (snap.act === 'jump' && snap.actT > 0.22 && snap.actT < 0.8) {
      const d2 = ballWorld.distanceTo(pm.group.position);
      if (d2 < 2.6) {
        pm.body.updateWorldMatrix(true, false);
        const local = pm.body.worldToLocal(ballWorld.clone());
        const dy = local.y - 1.4;
        const dz = local.z;
        const len = Math.hypot(dy, dz);
        if (len > 0.05) {
          const theta = Math.atan2(dz / len, -dy / len);
          pm.rSh.rotation.x += (theta - pm.rSh.rotation.x) * 0.45;
          pm.lSh.rotation.x += (theta - pm.lSh.rotation.x) * 0.45;
          pm.lElb.rotation.x *= 0.4;
          pm.rElb.rotation.x *= 0.4;
        }
      }
    }

    // スイングトレイル: 振り抜き中の右手の軌跡を収集
    if (
      (snap.act === 'spike' && snap.actT > 0.38 && snap.actT < 0.64) ||
      (snap.act === 'serve' && snap.actT > 0.52 && snap.actT < 0.85)
    ) {
      const hp = new THREE.Vector3();
      pm.rHand.getWorldPosition(hp);
      this.trailPts.push(hp);
      if (this.trailPts.length > 10) this.trailPts.shift();
      this.trailFresh = true;
    }

    // 接地影: ジャンプ中は小さく薄く
    const sh = Math.max(0.4, 1 - Math.max(0, po.yOff) * 0.75);
    pm.shadow.scale.set(sh, sh, 1);
    (pm.shadow.material as THREE.MeshBasicMaterial).opacity = 0.32 * sh;
  }

  render(snap: Snapshot, lerp: number) {
    this.ensurePlayers(snap.players);
    this.clockT += 0.016;

    // 名前タグは「今ボールに関与している選手（両チームのカーソル対象）」のみ表示。
    // 全員常時表示だと密集時に文字が重なって判読不能になるため。
    const involved = new Set<number>();
    if (snap.cursor[0] !== null) involved.add(snap.cursor[0]);
    if (snap.cursor[1] !== null) involved.add(snap.cursor[1]);
    snap.players.forEach((p, i) => {
      const pm = this.players[i];
      pm.group.position.x += (p.pos.x - pm.group.position.x) * lerp;
      pm.group.position.z += (p.pos.z - pm.group.position.z) * lerp;
      pm.label.visible = !this.hideLabels && involved.has(i);
      this.animatePlayer(pm, p, this.ball.position);
    });

    // セット機会: 広角タクティカル・ビュー + アタッカー番号マーカー
    const myPrompt = snap.prompts[this.myTeam];
    const tactical = myPrompt?.mode === 'set';
    this.tacticalT += ((tactical ? 1 : 0) - this.tacticalT) * 0.09;
    const fov = 62 + this.tacticalT * 13;
    if (Math.abs(fov - this.camera.fov) > 0.05) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    if (tactical && myPrompt.mode === 'set') {
      myPrompt.options.forEach((opt, i) => {
        const sp = this.optSprites[i];
        const pl = this.players[opt.idx];
        const ps = snap.players[opt.idx];
        if (!sp || !pl || !ps) return;
        sp.visible = true;
        sp.position.set(
          pl.group.position.x,
          2.52 * ps.height + Math.sin(this.clockT * 5 + i) * 0.05,
          pl.group.position.z,
        );
      });
    } else {
      for (const sp of this.optSprites) sp.visible = false;
    }

    this.ball.visible = snap.ball.visible;
    this.ball.position.lerp(
      new THREE.Vector3(snap.ball.pos.x, Math.max(snap.ball.pos.y, 0.11), snap.ball.pos.z),
      Math.min(1, lerp * 2),
    );
    this.ball.rotation.x += 0.12;
    this.ball.rotation.z += 0.07;
    this.ballShadow.visible = snap.ball.visible;
    this.ballShadow.position.set(this.ball.position.x, 0.011, this.ball.position.z);

    // 落下点 / 到達点マーカー: 自チームが触る番なら緑、相手・床なら黄
    if (snap.ballTarget) {
      this.targetRing.visible = true;
      this.targetRing.position.set(snap.ballTarget.pos.x, 0.015, snap.ballTarget.pos.z);
      const mine = snap.ballTarget.forTeam === this.myTeam;
      (this.targetRing.material as THREE.MeshBasicMaterial).color.setHex(
        mine ? 0x4dff7a : 0xffd034,
      );
      const pulse = 1 + 0.18 * Math.sin(this.clockT * 7);
      this.targetRing.scale.set(pulse, pulse, 1);
    } else {
      this.targetRing.visible = false;
    }

    // 打点マーカー: 到達点が空中（スパイクやトスの接触点）なら立体表示
    if (snap.ballFlight && snap.ballFlight.p1.y > 1.2) {
      const p1 = snap.ballFlight.p1;
      this.hitMarker.visible = true;
      this.hitMarker.position.set(p1.x, p1.y, p1.z);
      this.hitLine.scale.y = p1.y; // 地面までのガイド線
      this.hitLine.computeLineDistances();
      const pulse = 1 + 0.12 * Math.sin(this.clockT * 8);
      this.hitSphere.scale.setScalar(pulse);
    } else {
      this.hitMarker.visible = false;
    }

    // 軌道予測線（現在位置から到達点まで）
    if (snap.ballFlight && snap.ball.visible) {
      const f = snap.ballFlight;
      const pts = this.trajLine.geometry.attributes.position;
      const s0 = Math.min(1, f.t / f.T);
      for (let i = 0; i < pts.count; i++) {
        const s = s0 + ((1 - s0) * i) / (pts.count - 1);
        pts.setXYZ(
          i,
          f.p0.x + (f.p1.x - f.p0.x) * s,
          f.p0.y + (f.p1.y - f.p0.y) * s + f.h * 4 * s * (1 - s),
          f.p0.z + (f.p1.z - f.p0.z) * s,
        );
      }
      pts.needsUpdate = true;
      this.trajLine.visible = true;
    } else {
      this.trajLine.visible = false;
    }

    // 操作対象カーソル（▼）とカメラ追従
    const cIdx = snap.cursor[this.myTeam];
    const anchor =
      cIdx !== null && this.players[cIdx]
        ? this.players[cIdx].group.position
        : this.ball.position;
    if (cIdx !== null && this.players[cIdx]) {
      const cp = snap.players[cIdx];
      this.cursorCone.visible = true;
      this.cursorCone.position.set(
        this.players[cIdx].group.position.x,
        2.22 * cp.height + 0.35 + Math.sin(this.clockT * 5) * 0.06,
        this.players[cIdx].group.position.z,
      );
      this.cursorCone.rotation.y = this.clockT * 1.5;
    } else {
      this.cursorCone.visible = false;
    }

    if (this.overrideCam) {
      // VAR / リプレイのシネマティックカメラ
      this.camera.position.lerp(this.overrideCam.pos, 0.18);
      this.lookPos.lerp(this.overrideCam.look, 0.22);
      this.camera.lookAt(this.lookPos);
    } else if (this.camMode === 'follow') {
      // eFootball 風: 操作選手の後方上空から、ボールとネット方向を捉える
      // タクティカル・ビュー中はさらに引いて高く（攻撃陣全体を見せる）
      const netDir = this.myTeam === 0 ? 1 : -1;
      const desired = new THREE.Vector3(
        anchor.x - netDir * (5.8 + this.tacticalT * 2.6),
        3.6 + this.tacticalT * 1.9,
        anchor.z * (0.8 - this.tacticalT * 0.35),
      );
      this.camPos.lerp(desired, 0.07);
      this.camera.position.copy(this.camPos);

      const b = this.ball.position;
      const lookDesired = new THREE.Vector3(
        b.x * 0.55 + (anchor.x + netDir * 3.5) * 0.45,
        Math.min(3.2, Math.max(0.6, b.y * 0.5 + 1.0)),
        b.z * 0.55 + anchor.z * 0.45,
      );
      this.lookPos.lerp(lookDesired, 0.1);
      this.camera.lookAt(this.lookPos);
    } else {
      const side = this.myTeam === 0 ? -1 : 1;
      this.camera.position.set(side * 13, 9, 10);
      this.camera.lookAt(0, 1, 0);
    }
    this.players.forEach((pm) => (pm.group.visible = true));

    // LED 広告のスクロール
    for (const tex of this.adTextures) tex.offset.x -= 0.0016;

    // スイングトレイルの更新（新規点が無ければ減衰して消える）
    if (!this.trailFresh && this.trailPts.length > 0) this.trailPts.splice(0, 2);
    this.trailFresh = false;
    if (this.trailPts.length >= 2) {
      const attr = this.trailLine.geometry.attributes.position;
      for (let i = 0; i < attr.count; i++) {
        const p = this.trailPts[Math.min(i, this.trailPts.length - 1)];
        attr.setXYZ(i, p.x, p.y, p.z);
      }
      attr.needsUpdate = true;
      this.trailLine.visible = true;
    } else {
      this.trailLine.visible = false;
    }

    // インパクト閃光
    if (this.flashT > 0.02) {
      this.flashSpr.visible = true;
      const s = 0.5 + (1 - this.flashT) * 1.7;
      this.flashSpr.scale.set(s, s, 1);
      (this.flashSpr.material as THREE.SpriteMaterial).opacity = this.flashT;
      this.flashT -= 0.09;
    } else {
      this.flashSpr.visible = false;
    }

    // カメラシェイク
    if (this.shakeT > 0.002) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeT;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeT;
      this.shakeT *= 0.86;
    }

    this.renderer.render(this.scene, this.camera);
  }
}
