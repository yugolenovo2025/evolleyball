import { AttackChoice, BlockZone, Input, Prompt, Snapshot, Team } from '../sim/types';

const CHOICE_KEYS: { key: string; choice: AttackChoice; label: string }[] = [
  { key: '1', choice: 'LEFT', label: 'オープン' },
  { key: '2', choice: 'QUICK', label: 'クイック' },
  { key: '3', choice: 'RIGHT', label: 'バック' },
  { key: '4', choice: 'PIPE', label: '二段' },
  { key: '5', choice: 'TWO', label: 'ツー' },
];

export class Hud {
  root: HTMLElement;
  private centerEl: HTMLElement;
  private panelEl: HTMLElement;
  private helpEl: HTMLElement;
  private toastEl: HTMLElement;
  private radarCtx: CanvasRenderingContext2D;
  private lastEventSeq = -1;
  private toastTimer: number | undefined;

  onSfx: ((kind: string) => void) | null = null;
  onInput: ((input: Input) => void) | null = null;
  onToggleCam: (() => void) | null = null;
  onPause: (() => void) | null = null;
  onMenu: (() => void) | null = null;
  private matchOver = false;
  private streakTeam: Team | null = null;
  private streakCount = 0;

  private isTouch: boolean;
  private ak: string; // アクションボタンの呼称（SPACE / タップ）

  constructor(touch: boolean, allowPause: boolean) {
    this.isTouch = touch;
    this.ak = touch ? 'タップ' : 'SPACE';
    this.root = document.createElement('div');
    this.root.id = 'hud';
    if (touch) this.root.classList.add('touch');
    this.root.innerHTML = `
      <div id="sb">
        <span id="sb-serve">🏐</span>
        <span class="chip t0">BLU</span><span class="setbox" id="sb-set0">0</span><span class="scorebox" id="sb-s0">0</span><span class="scorebox" id="sb-s1">0</span><span class="setbox" id="sb-set1">0</span><span class="chip t1">RED</span>
        <span class="chip set" id="sb-setno">SET 1</span>
      </div>
      <div id="hud-streak"></div>
      <div id="hud-center"></div>
      <div id="hud-toast"></div>
      <div id="hud-panel"></div>
      <div id="ball-arrow">➤</div>
      <div id="bl-cluster">
        <div id="hud-plan"></div>
        <div id="cursor-name"></div>
        <div id="gauge"><div id="gauge-fill"></div></div>
        <canvas id="radar" width="220" height="128"></canvas>
      </div>
      <div id="hints"></div>
      <div id="hud-help">${touch ? '' : 'C:カメラ | P:ポーズ | H:操作説明'}</div>
      <div id="hud-room"></div>
      <div id="hud-sys">
        <div class="sysbtn" id="btn-help"><i>❓</i><span>ヘルプ</span></div>
        <div class="sysbtn" id="btn-coach"><i>📋</i><span>指示</span></div>
        <div class="sysbtn" id="btn-ring"><i>♟</i><span>戦術</span></div>
        ${allowPause ? '<div class="sysbtn" id="btn-pause"><i>⏸</i><span>ポーズ</span></div>' : ''}
        <div class="sysbtn" id="btn-quit"><i>🏠</i><span>メニュー</span></div>
      </div>
      <div id="coach">
        <div class="coach-head">コーチングボード — 自チームのドットをドラッグして守備位置を微調整
          <div id="coach-close">✕</div>
        </div>
        <div id="coach-court">
          <div class="coach-net"></div>
          <div class="coach-line al1"></div>
          <div class="coach-line al2"></div>
        </div>
        <div class="coach-foot">
          <button id="coach-reset">位置をリセット</button>
          <span>V で閉じる（試合は進行中）</span>
        </div>
      </div>
      <div id="ring">
        <div class="ring-center">攻撃指示<br><small>Q長押し / 1-5</small></div>
        <div class="ring-item ri0" data-plan="LEFT"><b>1</b>オープン</div>
        <div class="ring-item ri1" data-plan="QUICK"><b>2</b>クイック</div>
        <div class="ring-item ri2" data-plan="RIGHT"><b>3</b>バック</div>
        <div class="ring-item ri3" data-plan="PIPE"><b>4</b>二段</div>
        <div class="ring-item ri4" data-plan="TWO"><b>5</b>ツー</div>
      </div>
      <div id="coachmark"></div>
      <div id="tut">
        <div class="tut-card">
          <h3 id="tut-title"></h3>
          <div id="tut-body"></div>
          <div class="tut-nav">
            <button id="tut-prev">← 前へ</button>
            <span id="tut-step"></span>
            <button id="tut-next">次へ →</button>
          </div>
          <button id="tut-close">閉じてプレイ</button>
        </div>
      </div>
      <div id="pause-overlay">
        <h2>一時停止中</h2>
        <button id="btn-resume">再開する</button>
        <button id="btn-quit2">メニューに戻る</button>
      </div>
      <div id="var-overlay">
        <div class="var-head">📺 VIDEO CHECK — ライン判定</div>
        <div class="var-body">
          <div class="var-conf">判定確度 <b id="var-conf">--%</b></div>
          <div class="var-count" id="var-count">3</div>
        </div>
        <div class="var-result" id="var-result"></div>
      </div>
      <div id="replay-banner">● REPLAY</div>
      ${touch ? `
        <div id="zone-l"></div>
        <div id="zone-r"></div>
        <div id="ghost">
          <div class="g-time"></div>
          <div class="g-hold"></div>
          <div class="g-core"><b id="g-label"></b></div>
        </div>
        <div id="tosscards"></div>
        <div id="stick">
          <div id="stick-base"><span>◀</span><span>▶</span></div>
          <div id="stick-knob"></div>
        </div>
        <div id="stick-hint"><span>◀</span><i></i><span>▶</span><b>コース</b></div>
        <div id="btn-cam">視点</div>
      ` : ''}
    `;
    document.body.appendChild(this.root);
    this.centerEl = document.getElementById('hud-center')!;
    this.panelEl = document.getElementById('hud-panel')!;
    this.helpEl = document.getElementById('hud-help')!;
    this.toastEl = document.getElementById('hud-toast')!;
    this.radarCtx = (document.getElementById('radar') as HTMLCanvasElement).getContext('2d')!;

    // パネル内ボタンのタップ/クリック
    this.panelEl.addEventListener('pointerdown', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>(
        '[data-choice],[data-block],[data-action]',
      );
      if (!el || !this.onInput) return;
      e.preventDefault();
      if (el.dataset.choice) {
        this.onInput({ type: 'setChoice', choice: el.dataset.choice as AttackChoice });
      } else if (el.dataset.block) {
        this.onInput({ type: 'blockCommit', zone: el.dataset.block as BlockZone });
      } else if (el.dataset.action === 'rematch') {
        this.onInput({ type: 'rematch' });
      }
    });

    // コーチングボード（監督UI）。✕ボタンと背景タップでも閉じられる（スマホ対応）
    document.getElementById('btn-coach')!.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.toggleCoach();
    });
    document.getElementById('coach-close')!.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.toggleCoach(false);
    });
    document.getElementById('coach')!.addEventListener('pointerdown', (e) => {
      if (e.target === e.currentTarget) this.toggleCoach(false);
    });
    document.getElementById('coach-reset')!.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.onInput?.({ type: 'posReset' });
    });
    const court = document.getElementById('coach-court')!;
    for (let i = 0; i < 12; i++) {
      const dot = document.createElement('div');
      dot.className = 'coach-dot';
      dot.dataset.idx = String(i);
      court.appendChild(dot);
      this.coachDots.push(dot);
      dot.addEventListener('pointerdown', (e) => {
        if (dot.dataset.mine !== '1') return;
        e.preventDefault();
        dot.setPointerCapture(e.pointerId);
        this.coachDrag = i;
      });
      const up = () => {
        if (this.coachDrag === i) this.coachDrag = null;
      };
      dot.addEventListener('pointerup', up);
      dot.addEventListener('pointercancel', up);
      dot.addEventListener('pointermove', (e) => {
        if (this.coachDrag !== i) return;
        const r = court.getBoundingClientRect();
        const wx = ((e.clientX - r.left) / r.width) * 20 - 10;
        const wz = ((e.clientY - r.top) / r.height) * 10 - 5;
        dot.style.left = `${((wx + 10) / 20) * 100}%`;
        dot.style.top = `${((wz + 5) / 10) * 100}%`;
        const slot = Number(dot.dataset.slot ?? 0);
        if (slot >= 1) this.onInput?.({ type: 'posAdjust', slot, x: wx, z: wz });
      });
    }

    // 戦術リングメニュー
    document.getElementById('btn-ring')!.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.toggleRing();
    });
    document.getElementById('ring')!.addEventListener('pointerdown', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('.ring-item');
      if (el?.dataset.plan) {
        e.preventDefault();
        this.onInput?.({ type: 'plan', choice: el.dataset.plan as AttackChoice });
        this.toggleRing(false);
      } else if (e.target === e.currentTarget) {
        this.toggleRing(false); // 背景タップで閉じる
      }
    });

    // チュートリアル
    document.getElementById('btn-help')!.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.openTutorial(0);
    });
    document.getElementById('tut-prev')!.addEventListener('pointerdown', () => {
      if (this.tutIdx > 0) {
        this.tutIdx--;
        this.renderTut();
      }
    });
    document.getElementById('tut-next')!.addEventListener('pointerdown', () => {
      if (this.tutIdx < this.tutPages().length - 1) {
        this.tutIdx++;
        this.renderTut();
      }
    });
    document.getElementById('tut-close')!.addEventListener('pointerdown', () => {
      document.getElementById('tut')!.style.display = 'none';
      localStorage.setItem('evb-tut-done', '1');
      this.onTutorial?.(false); // 閉じたら試合再開
    });

    document.getElementById('btn-pause')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.onPause?.();
    });
    document.getElementById('btn-resume')!.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.onPause?.();
    });
    for (const id of ['btn-quit', 'btn-quit2']) {
      document.getElementById(id)!.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.onMenu?.();
      });
    }

    if (touch) {
      this.setupZones();
      document.getElementById('btn-cam')!.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.onToggleCam?.();
      });
    }
  }

  // ---------- スマホ専用「2ゾーン」操作 ----------
  // 右半分ぜんぶがアクションボタン。触れた場所にゴーストリングが現れ、
  // タップ=タイミング / 長押し→離す=チャージ。狙って押す必要がない。
  private touchPos: { x: number; y: number; active: boolean } = { x: 0, y: 0, active: false };

  private setupZones() {
    const zr = document.getElementById('zone-r')!;
    zr.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      zr.setPointerCapture(e.pointerId);
      this.touchPos = { x: e.clientX, y: e.clientY, active: true };
      this.onInput?.({ type: 'actionDown' });
    });
    const up = (e: PointerEvent) => {
      e.preventDefault();
      this.touchPos.active = false;
      this.onInput?.({ type: 'actionUp' });
    };
    zr.addEventListener('pointerup', up);
    zr.addEventListener('pointercancel', up);

    // トスカード（左側の大きな縦カード。タップで選択）
    document.getElementById('tosscards')!.addEventListener('pointerdown', (e) => {
      const c = (e.target as HTMLElement).closest<HTMLElement>('.tcard');
      if (!c?.dataset.choice) return;
      e.preventDefault();
      this.onInput?.({ type: 'setChoice', choice: c.dataset.choice as AttackChoice });
    });

    // 左ゾーン: 触れた場所にフローティング方向スティックが出現（eFootball式）。
    // ノブを左右に倒した分がコース / ブロックの手の位置になる。
    const zl = document.getElementById('zone-l')!;
    const stick = document.getElementById('stick')!;
    const knob = document.getElementById('stick-knob')!;
    const R = 58;
    let startX = 0;
    let startAim = 0;
    zl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      zl.setPointerCapture(e.pointerId);
      this.stickActive = true;
      startX = e.clientX;
      startAim = this.lastAimZ;
      stick.style.display = 'block';
      stick.style.left = `${e.clientX}px`;
      stick.style.top = `${e.clientY}px`;
      knob.style.transform = 'translate(-50%, -50%)';
    });
    zl.addEventListener('pointermove', (e) => {
      if (!this.stickActive) return;
      const dx = Math.max(-R, Math.min(R, e.clientX - startX));
      knob.style.transform = `translate(calc(-50% + ${dx}px), -50%)`;
      const z = Math.max(-1, Math.min(1, startAim + dx / 64));
      this.lastAimZ = z;
      this.onInput?.({ type: 'aimSet', z });
    });
    const zlUp = () => {
      this.stickActive = false;
      stick.style.display = 'none';
    };
    zl.addEventListener('pointerup', zlUp);
    zl.addEventListener('pointercancel', zlUp);
  }

  private stickActive = false;
  private lastAimZ = 0;

  // ゴーストリングとトスカードの毎フレーム更新（触れていない時は右中央に案内表示）
  private updateGhost(prompt: Prompt) {
    const ghost = document.getElementById('ghost');
    if (!ghost) return;
    const gTime = ghost.querySelector<HTMLElement>('.g-time')!;
    const gHold = ghost.querySelector<HTMLElement>('.g-hold')!;
    const label = document.getElementById('g-label')!;
    const cards = document.getElementById('tosscards')!;
    const zoneL = document.getElementById('zone-l')!;
    const stickHint = document.getElementById('stick-hint')!;

    if (!prompt) {
      ghost.style.display = 'none';
      cards.style.display = 'none';
      zoneL.style.display = 'none';
      stickHint.style.display = 'none';
      document.getElementById('stick')!.style.display = 'none';
      this.stickActive = false;
      return;
    }
    ghost.style.display = 'block';
    // 位置: 押している間は親指の真下、離している間は右中央のアンカー
    const ax = this.touchPos.active ? this.touchPos.x : window.innerWidth * 0.72;
    const ay = this.touchPos.active ? this.touchPos.y : window.innerHeight * 0.58;
    ghost.style.left = `${ax}px`;
    ghost.style.top = `${ay}px`;

    // 左スティック（コース/手の向きが効く局面のみ有効化）
    const aimable =
      prompt.mode === 'serve' || prompt.mode === 'spike' || prompt.mode === 'block';
    zoneL.style.display = aimable ? 'block' : 'none';
    stickHint.style.display = aimable && !this.stickActive ? 'flex' : 'none';
    if (aimable && (prompt.mode === 'serve' || prompt.mode === 'spike') && !this.stickActive) {
      this.lastAimZ = prompt.aimZ; // シム側の現在値と同期
    }
    if (!aimable) this.stickActive = false;

    // トスカード
    if (prompt.mode === 'set') {
      cards.style.display = 'flex';
      if (!cards.dataset.built) {
        cards.dataset.built = '1';
        cards.innerHTML = [
          ['LEFT', 'オープン'],
          ['QUICK', 'クイック'],
          ['RIGHT', 'バック'],
          ['PIPE', '時間差'],
          ['TWO', 'ツー'],
        ]
          .map(([c, l]) => `<div class="tcard" data-choice="${c}">${l}</div>`)
          .join('');
      }
      cards.querySelectorAll<HTMLElement>('.tcard').forEach((el) => {
        el.classList.toggle('sel', el.dataset.choice === prompt.choice);
      });
    } else {
      cards.style.display = 'none';
    }

    // リング表現: チャージ系=円形ゲージ / タイミング系=収束リング
    switch (prompt.mode) {
      case 'serve':
      case 'spike': {
        gHold.style.display = 'block';
        gHold.classList.toggle(
          'charging',
          prompt.charging || (prompt.mode === 'spike' && prompt.locked),
        );
        gHold.style.setProperty('--p', String(prompt.power));
        label.textContent = prompt.charging
          ? ''
          : prompt.mode === 'serve'
            ? '長押し'
            : 'スパイク';
        if (prompt.mode === 'spike' && !prompt.locked) {
          const frac = prompt.total > 0 ? Math.max(0, prompt.arriveIn / prompt.total) : 0;
          gTime.style.display = 'block';
          gTime.style.transform = `translate(-50%,-50%) scale(${(1 + frac * 1.6).toFixed(3)})`;
        } else {
          gTime.style.display = 'none';
        }
        return;
      }
      case 'receive':
      case 'set': {
        gHold.style.display = 'none';
        const frac =
          prompt.total > 0 ? Math.max(0, Math.min(1, prompt.arriveIn / prompt.total)) : 0;
        const pressed = 'pressed' in prompt && prompt.pressed;
        gTime.style.display = pressed ? 'none' : 'block';
        gTime.style.transform = `translate(-50%,-50%) scale(${(1 + frac * 1.6).toFixed(3)})`;
        label.textContent = pressed
          ? String(prompt.pressed) + '!'
          : prompt.mode === 'receive'
            ? 'レシーブ'
            : 'トス!';
        return;
      }
      case 'block': {
        gHold.style.display = 'none';
        gTime.style.display = 'none';
        label.textContent = 'ジャンプ!';
        return;
      }
    }
  }

  // eFootball 式ジェスチャー判定: タップ / ダブルタップ / 4方向フリック
  private padGesture(
    id: string,
    handlers: {
      onDown?: () => void;
      onUp: (g: { flick: 'U' | 'D' | 'L' | 'R' | null; double: boolean }) => void;
    },
  ) {
    const el = document.getElementById(id)!;
    let sx = 0;
    let sy = 0;
    let lastTap = 0;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      sx = e.clientX;
      sy = e.clientY;
      handlers.onDown?.();
    });
    const finish = (e: PointerEvent) => {
      e.preventDefault();
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      let flick: 'U' | 'D' | 'L' | 'R' | null = null;
      if (Math.hypot(dx, dy) > 22) {
        flick = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : dy > 0 ? 'D' : 'U';
      }
      const now = performance.now();
      const double = !flick && now - lastTap < 280;
      lastTap = flick ? 0 : now;
      handlers.onUp({ flick, double });
    };
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
  }

  // 4方向バーチャルパッド（eFootball 配置: 左上=精密系 右上=攻撃系 左下=基本系 右下=構え系）
  private setupPad() {
    // 基本系（レシーブ/トス/ブロックジャンプ）
    // トス中のフリック: 左=クイック 右=バック 上=時間差(パイプ) 下=ツーアタック
    this.padGesture('pad-toss', {
      onUp: ({ flick }) => {
        if (this.lastPromptMode === 'set') {
          if (flick === 'L') this.onInput?.({ type: 'setChoice', choice: 'QUICK' });
          else if (flick === 'R') this.onInput?.({ type: 'setChoice', choice: 'RIGHT' });
          else if (flick === 'U') this.onInput?.({ type: 'setChoice', choice: 'PIPE' });
          else if (flick === 'D') this.onInput?.({ type: 'setChoice', choice: 'TWO' });
        }
        this.onInput?.({ type: 'actionDown' });
        this.onInput?.({ type: 'actionUp' });
      },
    });
    // 精密系（トス中のみ: タップ=オープン 上下=バック 左=クイック 右=時間差）
    this.padGesture('pad-precise', {
      onUp: ({ flick }) => {
        if (this.lastPromptMode !== 'set') return;
        const choice =
          flick === 'U' || flick === 'D' ? 'RIGHT' : flick === 'L' ? 'QUICK' : flick === 'R' ? 'PIPE' : 'LEFT';
        this.onInput?.({ type: 'setChoice', choice });
        this.onInput?.({ type: 'actionDown' });
        this.onInput?.({ type: 'actionUp' });
      },
    });
    // 攻撃系（長押しチャージ→離す。フリック派生: 上=ふわりフェイント 下=コントロール 左右=コース強打）
    this.padGesture('pad-spike', {
      onDown: () => this.onInput?.({ type: 'actionDown' }),
      onUp: ({ flick }) => {
        if (this.lastPromptMode === 'spike') {
          if (flick === 'U') {
            this.onInput?.({ type: 'spikePreset', power: 0.22 });
            return;
          }
          if (flick === 'D') {
            this.onInput?.({ type: 'spikePreset', power: 0.55 });
            return;
          }
          if (flick === 'L') this.onInput?.({ type: 'aimSet', z: -0.9 });
          if (flick === 'R') this.onInput?.({ type: 'aimSet', z: 0.9 });
        } else if (this.lastPromptMode === 'serve') {
          if (flick === 'L') this.onInput?.({ type: 'aimSet', z: -0.8 });
          if (flick === 'R') this.onInput?.({ type: 'aimSet', z: 0.8 });
        }
        this.onInput?.({ type: 'actionUp' });
      },
    });
    // 構え系（ブロックの手の向き: タップ=中央 左右フリック=左右）
    this.padGesture('pad-dash', {
      onUp: ({ flick }) => {
        const zone = flick === 'L' ? 'L' : flick === 'R' ? 'R' : 'M';
        this.onInput?.({ type: 'blockCommit', zone });
      },
    });
  }

  private lastVarCount = -1;
  private varResultShown = false;

  // VAR オーバーレイ: カウントダウン + 判定確度、リザルトで IN/OUT を表示
  showVar(
    vc: { conf: number; remain: number; inCall: boolean; scorer: Team } | null,
    myTeam: Team,
  ) {
    const el = document.getElementById('var-overlay')!;
    if (!vc) {
      el.style.display = 'none';
      this.lastVarCount = -1;
      this.varResultShown = false;
      return;
    }
    el.style.display = 'flex';
    document.getElementById('var-conf')!.textContent = `${vc.conf}%`;
    const countEl = document.getElementById('var-count')!;
    const resultEl = document.getElementById('var-result')!;
    if (vc.remain > 0.05) {
      const c = Math.ceil(vc.remain);
      countEl.textContent = `判定確定まで ${c}`;
      countEl.style.display = 'block';
      resultEl.textContent = '';
      if (c !== this.lastVarCount) {
        this.lastVarCount = c;
        this.onSfx?.('heartbeat'); // 心拍音でカウントダウン
      }
    } else {
      countEl.style.display = 'none';
      if (!this.varResultShown) {
        this.varResultShown = true;
        this.onSfx?.('whistle');
      }
      const mine = vc.scorer === myTeam;
      resultEl.textContent = vc.inCall
        ? `IN！ ${mine ? 'チャレンジ成功！' : ''}`
        : `OUT！ ${mine ? 'チャレンジ成功！' : ''}`;
      resultEl.className = 'var-result show ' + (mine ? 'good' : 'bad');
    }
  }

  showReplayBanner(show: boolean) {
    document.getElementById('replay-banner')!.style.display = show ? 'block' : 'none';
  }

  ringOpen = false;
  coachOpen = false;
  private coachDots: HTMLElement[] = [];
  private coachDrag: number | null = null;
  private beatColors = ['#4dc3ff', '#4dff7a', '#ffd034'];

  toggleRing(show?: boolean) {
    this.ringOpen = show ?? !this.ringOpen;
    document.getElementById('ring')!.style.display = this.ringOpen ? 'flex' : 'none';
  }

  toggleCoach(show?: boolean) {
    this.coachOpen = show ?? !this.coachOpen;
    document.getElementById('coach')!.style.display = this.coachOpen ? 'flex' : 'none';
  }

  // ---------- チュートリアル ----------

  private tutIdx = 0;

  private tutPages(): { title: string; body: string }[] {
    if (this.isTouch) {
      return [
        {
          title: 'きほん — 2ゾーン操作',
          body: '<b>画面の右半分ぜんぶが「ボタン」</b>です。どこを触ってもOK。触れた場所にリングが現れます。<br><br><b>左半分は味付けゾーン</b>（コースのドラッグ / トスの種類カード）。<b>右を押すだけでも試合は成立</b>します。',
        },
        {
          title: '🏐 サーブ',
          body: '<b>右半分を長押し</b>して円形ゲージを溜め、<b>離して</b>打ちます。<b>7〜8割</b>がスイートスポット。溜めすぎるとミス！<br><br><b>左半分に触れるとスティックが出現</b>。左右に倒すとコースが動き、緑のリングが落下予測地点を示します。',
        },
        {
          title: '🛡️ レシーブ',
          body: '緑のリングが縮んで<b>中心と重なる瞬間に右半分をタップ</b>。<br><br>遅れても POOR で「ギリギリ届く」ことがあります。<b>何も押さないとノータッチで失点</b>！',
        },
        {
          title: '🙌 トス',
          body: 'ボールがセッターへ上がると<b>左側に5枚のカード</b>が出ます。タップで種類を選択（選ばなくてもOK）。<br><br>リングが縮み切る<b>瞬間に右半分をタップ</b>でトス！ツー＝セッターの奇襲もカードから。',
        },
        {
          title: '💥 スパイク',
          body: 'トスが上がったら<b>右半分を長押し</b>で溜めて<b>離す</b>。強いほど決まるがミスも増える。<br><br>コースは<b>左半分をドラッグ</b>（クロス⇔ストレート）。読まれたらコースで抜け！',
        },
        {
          title: '🧱 ブロックと監督',
          body: '相手が打つ<b>瞬間に右半分をタップ</b>でジャンプ！手の向きは自動（<b>左ドラッグで上書き</b>可）。<br><br>♟戦術=攻撃指示 / 📋指示=守備位置ドラッグ / ❓=このチュートリアル。',
        },
      ];
    }
    return [
      {
        title: 'きほん',
        body: '選手は自動で動きます。あなたはプレーの<b>タイミング・強さ・コース</b>だけを決めます。<br><br>画面下に出るパネルが「今できる操作」。右下にキー操作のヒントが常時表示されます。',
      },
      {
        title: '🏐 サーブ',
        body: '<b>SPACE 長押し</b>でパワーを溜め、<b>離して</b>打ちます。ゲージは<b>7〜8割</b>がスイートスポット。<br><br>コースは <b>←→キー</b>。緑のリングが落下予測地点。8秒以内に打たないと反則！',
      },
      {
        title: '🛡️ レシーブ',
        body: 'ボールが届く<b>瞬間に SPACE</b>。タイミングバーの右端の<b>緑ゾーンが PERFECT</b>。<br><br>遅れても POOR で「ギリギリ届く」ことがあります。<b>何も押さないとノータッチで失点</b>！',
      },
      {
        title: '🙌 トス',
        body: '<b>1〜5キー（または矢印キー）でトスの種類</b>を選び、ボール到達の<b>瞬間に SPACE</b>。<br>1 オープン / 2 クイック / 3 バック / 4 時間差 / 5 ツーアタック<br><br><b>Q長押し</b>で攻撃指示リング（初期選択のプリセット）。',
      },
      {
        title: '💥 スパイク',
        body: 'トスが上がったら <b>SPACE 長押し</b>で溜めて<b>離す</b>。<b>←→でコース打ち分け</b>。<br><br>強く溜めるほど決定力が上がるがミスも増える。弱すぎると拾われます。',
      },
      {
        title: '🧱 ブロックと戦術',
        body: '相手のセット中に <b>J/K/L でコースを張り</b>、打つ<b>瞬間に SPACE でジャンプ</b>。読みが当たればシャットアウト！<br><br><b>V</b>=コーチングボード（守備位置ドラッグ）/ <b>C</b>=カメラ / <b>P</b>=ポーズ。',
      },
    ];
  }

  onTutorial: ((open: boolean) => void) | null = null;

  openTutorial(idx = 0) {
    this.tutIdx = idx;
    document.getElementById('tut')!.style.display = 'flex';
    this.renderTut();
    this.onTutorial?.(true); // 読んでいる間は試合を止める（ソロ時）
  }

  private renderTut() {
    const pages = this.tutPages();
    const p = pages[this.tutIdx];
    document.getElementById('tut-title')!.textContent = `${this.tutIdx + 1}. ${p.title}`;
    document.getElementById('tut-body')!.innerHTML = p.body;
    document.getElementById('tut-step')!.textContent = `${this.tutIdx + 1} / ${pages.length}`;
    (document.getElementById('tut-prev') as HTMLButtonElement).disabled = this.tutIdx === 0;
    (document.getElementById('tut-next') as HTMLButtonElement).disabled =
      this.tutIdx === pages.length - 1;
  }

  showTutorialIfFirst() {
    if (navigator.webdriver) return; // 自動テスト時はスキップ
    if (!localStorage.getItem('evb-tut-done')) this.openTutorial(0);
  }

  // 局面が初めて来たときに出る、その場の操作ガイド
  private seenModes = new Set<string>();
  private coachmarkTimer: number | undefined;

  private maybeCoachMark(mode: string) {
    if (!mode || this.seenModes.has(mode)) return;
    this.seenModes.add(mode);
    const texts: Record<string, string> = {
      serve: this.isTouch
        ? '🏐 長押しで溜めて、離すとサーブ！'
        : '🏐 SPACE 長押し→離すとサーブ！',
      receive: this.isTouch ? '🛡️ 届く瞬間にタップ！' : '🛡️ 届く瞬間に SPACE！',
      set: this.isTouch
        ? '🙌 タップでトス。フリックで種類が変わる！'
        : '🙌 1-5 で種類、到達の瞬間に SPACE！',
      spike: this.isTouch
        ? '💥 長押し→離す！フリックで打ち分け'
        : '💥 SPACE 長押し→離す！←→でコース',
      block: this.isTouch
        ? '🧱 打つ瞬間にタップでジャンプ！'
        : '🧱 打つ瞬間に SPACE でジャンプ！',
    };
    const t = texts[mode];
    if (!t) return;
    const el = document.getElementById('coachmark')!;
    el.textContent = t;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.coachmarkTimer);
    this.coachmarkTimer = window.setTimeout(() => el.classList.remove('show'), 3000);
  }

  // 連携のリズム: レシーブ(1)→トス(2)→スパイク(3)で段階的に色が変わる鼓動
  private pulse(step: number) {
    this.root.style.setProperty('--beat-color', this.beatColors[Math.min(2, step - 1)]);
    this.root.classList.remove('beat');
    void this.root.offsetWidth; // アニメーション再トリガー
    this.root.classList.add('beat');
  }

  showPause(paused: boolean) {
    document.getElementById('pause-overlay')!.style.display = paused ? 'flex' : 'none';
    const b = document.getElementById('btn-pause');
    if (b) b.innerHTML = paused ? '<i>▶</i><span>再開</span>' : '<i>⏸</i><span>ポーズ</span>';
  }

  updateBallArrow(info: { off: boolean; x: number; y: number }) {
    const el = document.getElementById('ball-arrow')!;
    if (!info.off) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    el.style.left = `${(info.x * 0.5 + 0.5) * 100}%`;
    el.style.top = `${(-info.y * 0.5 + 0.5) * 100}%`;
    const angle = Math.atan2(-info.y, info.x);
    el.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
  }

  setRoomInfo(text: string) {
    const el = document.getElementById('hud-room')!;
    el.textContent = text;
    el.style.display = text ? 'block' : 'none';
  }

  toggleHelp() {
    this.helpEl.classList.toggle('expanded');
    this.helpEl.innerHTML = this.helpEl.classList.contains('expanded')
      ? `<b>操作方法</b>（選手は自動で動く。あなたはプレーの質を決める）<br>
        <b>サーブ/スパイク</b>: SPACE 長押しでパワーゲージ → 離して実行 / ←→ でコース<br>
        <b>レシーブ</b>: ボールが届く瞬間に SPACE<br>
        <b>トス</b>: 1-4 で攻撃選択 → 到達の瞬間に SPACE<br>
        <b>ブロック</b>: J/K/L でコース張り + 相手が打つ瞬間に SPACE でジャンプ<br>
        C: カメラ / P: ポーズ / R: 再戦 / H: 閉じる`
      : 'C:カメラ | P:ポーズ | H:操作説明';
  }

  private toast(msg: string, cls = '') {
    this.toastEl.textContent = msg;
    this.toastEl.className = 'show ' + cls;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toastEl.className = ''), 1400);
  }

  private drawRadar(snap: Snapshot, myTeam: Team) {
    const g = this.radarCtx;
    const W = 220;
    const H = 128;
    g.clearRect(0, 0, W, H);
    // コート（背景を濃くして、背後の3D描画が透けて見えないようにする）
    g.fillStyle = 'rgba(6, 10, 16, 0.94)';
    g.beginPath();
    g.roundRect(0, 0, W, H, 8);
    g.fill();
    g.strokeStyle = 'rgba(77, 141, 255, 0.55)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.roundRect(0.8, 0.8, W - 1.6, H - 1.6, 8);
    g.stroke();
    const cx = (x: number) => ((x + 10.5) / 21) * (W - 16) + 8;
    const cy = (z: number) => ((z + 5.5) / 11) * (H - 14) + 7;
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.lineWidth = 1;
    g.strokeRect(cx(-9), cy(-4.5), cx(9) - cx(-9), cy(4.5) - cy(-4.5));
    // センターライン + アタックライン
    g.beginPath();
    g.moveTo(cx(0), cy(-4.5));
    g.lineTo(cx(0), cy(4.5));
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.2)';
    for (const ax of [-3, 3]) {
      g.beginPath();
      g.moveTo(cx(ax), cy(-4.5));
      g.lineTo(cx(ax), cy(4.5));
      g.stroke();
    }
    // 選手ドット（操作中はパルス発光）
    const cursorIdx = snap.cursor[myTeam];
    const pulse = 5 + Math.sin(Date.now() * 0.009) * 1.4;
    snap.players.forEach((p, i) => {
      g.beginPath();
      g.arc(cx(p.pos.x), cy(p.pos.z), 3.2, 0, Math.PI * 2);
      g.fillStyle = p.team === 0 ? '#4d8dff' : '#ff5d4d';
      g.fill();
      if (i === cursorIdx) {
        g.beginPath();
        g.arc(cx(p.pos.x), cy(p.pos.z), pulse, 0, Math.PI * 2);
        g.strokeStyle = '#ffd034';
        g.lineWidth = 1.8;
        g.stroke();
      }
    });
    // ボール
    if (snap.ball.visible) {
      g.beginPath();
      g.arc(cx(snap.ball.pos.x), cy(snap.ball.pos.z), 2.6, 0, Math.PI * 2);
      g.fillStyle = '#ffd034';
      g.fill();
    }
  }

  private centerCls = 'neutral';
  private lastCenterMsg: string | null = null;

  update(snap: Snapshot, myTeam: Team) {
    // eFootball 風スコアボード（🏐 = サーブ権）
    document.getElementById('sb-s0')!.textContent = String(snap.score[0]);
    document.getElementById('sb-s1')!.textContent = String(snap.score[1]);
    const sv = document.getElementById('sb-serve')!;
    sv.className = snap.servingTeam === 0 ? 'sv0' : 'sv1';
    // セット数（1セットマッチでは非表示）＋セット番号/先取点
    const multi = snap.sets[0] + snap.sets[1] > 0 || snap.setNo > 1 || snap.targetPts !== 25;
    document.getElementById('sb-set0')!.textContent = String(snap.sets[0]);
    document.getElementById('sb-set1')!.textContent = String(snap.sets[1]);
    const showSets = snap.setNo > 1 || snap.sets[0] + snap.sets[1] > 0;
    document.getElementById('sb-set0')!.style.display = showSets ? '' : 'none';
    document.getElementById('sb-set1')!.style.display = showSets ? '' : 'none';
    document.getElementById('sb-setno')!.textContent = `SET${snap.setNo} / ${snap.targetPts}`;
    void multi;

    // 中央テロップ（結果テキストの単一レイヤー。色はイベントの得失で決まる）
    if (snap.centerMsg !== this.lastCenterMsg) {
      this.lastCenterMsg = snap.centerMsg;
      this.centerEl.textContent = snap.centerMsg ?? '';
      if (snap.centerMsg) {
        this.centerEl.className = '';
        void this.centerEl.offsetWidth;
        this.centerEl.className = `show ${this.centerCls}`;
        this.centerEl.style.display = 'block';
      } else {
        this.centerEl.style.display = 'none';
      }
    }

    this.drawRadar(snap, myTeam);

    // 攻撃指示（リングメニューのプリセット）表示
    const planEl = document.getElementById('hud-plan')!;
    const plan = snap.plan[myTeam];
    if (plan) {
      const label = { LEFT: 'オープン', QUICK: 'クイック', RIGHT: 'バック', PIPE: '二段', TWO: 'ツー' }[plan];
      planEl.textContent = `指示: ${label}`;
      planEl.style.display = 'block';
    } else {
      planEl.style.display = 'none';
    }

    // 操作対象の選手名プレート
    const cIdx = snap.cursor[myTeam];
    const nameEl = document.getElementById('cursor-name')!;
    if (cIdx !== null && snap.players[cIdx]) {
      const p = snap.players[cIdx];
      nameEl.textContent = `▶ ${p.name}  #${p.num} ${p.role}`;
      nameEl.style.display = 'block';
    } else {
      nameEl.style.display = 'none';
    }

    // コーチングボードのドット更新（ドラッグ中のドットは触らない）
    if (this.coachOpen) {
      snap.players.forEach((p, i) => {
        const dot = this.coachDots[i];
        if (!dot || this.coachDrag === i) return;
        dot.style.left = `${((p.pos.x + 10) / 20) * 100}%`;
        dot.style.top = `${((p.pos.z + 5) / 10) * 100}%`;
        const mine = p.team === myTeam;
        dot.dataset.mine = mine ? '1' : '0';
        dot.dataset.slot = String(p.slot);
        dot.className = `coach-dot ${p.team === 0 ? 'ct0' : 'ct1'} ${mine ? 'mine' : ''}`;
        dot.textContent = p.role === 'S' ? 'S' : String(p.num);
      });
    }

    this.matchOver = snap.phase === 'matchOver';
    const prompt = snap.prompts[myTeam];
    this.renderPanel(prompt);
    this.renderGaugeAndHints(prompt);
    this.updateGhost(prompt);

    // 新規イベント → トーストと効果音、連携のビートパルス
    const TOSS_LABELS = ['オープン', 'クイック', 'バック', '二段', 'ツーアタック'];
    for (const ev of snap.events) {
      if (ev.seq <= this.lastEventSeq) continue;
      this.lastEventSeq = ev.seq;
      this.onSfx?.(ev.kind);
      if (ev.team === myTeam) {
        if (ev.kind === 'contact') this.pulse(1);
        else if (ev.kind === 'toss' && ev.msg && TOSS_LABELS.includes(ev.msg)) this.pulse(2);
        else if (ev.kind === 'spike') this.pulse(3);
      }
      if (ev.kind === 'point' || ev.kind === 'ace' || ev.kind === 'block' || ev.kind === 'fault') {
        // 結果テキストは中央テロップ1本に統一（トーストとの二重表示バグの修正）。
        // ここでは色分けクラスだけ決める（自チーム得点=緑 / 失点=赤）
        this.centerCls = ev.team === myTeam ? 'good' : 'bad';
        if (ev.team !== undefined) {
          if (ev.team === this.streakTeam) this.streakCount++;
          else {
            this.streakTeam = ev.team;
            this.streakCount = 1;
          }
          const st = document.getElementById('hud-streak')!;
          if (this.streakCount >= 3) {
            const nm = this.streakTeam === 0 ? 'BLUE' : 'RED';
            st.textContent = `🔥 ${nm} ${this.streakCount}連続得点！`;
            st.className = this.streakTeam === myTeam ? 'good' : 'bad';
          } else {
            st.textContent = '';
          }
        }
      } else if (
        ev.kind === 'toss' &&
        (ev.msg === 'PERFECT!' ||
          ev.msg === 'ナイスレシーブ!' ||
          ev.msg === 'ギリギリ届いた！' ||
          ev.msg?.startsWith('攻撃指示'))
      ) {
        this.toast(ev.msg, 'perfect');
      }
    }
  }

  // 左下パワーゲージと右下ヒント
  private renderGaugeAndHints(prompt: Prompt) {
    const gauge = document.getElementById('gauge')!;
    const fill = document.getElementById('gauge-fill')!;
    const hints = document.getElementById('hints')!;

    let power: number | null = null;
    let hint = '';
    if (prompt?.mode === 'serve') {
      power = prompt.power;
      hint = `${this.ak} 長押し→離す: サーブ（溜めるほど深く強く）<br>←→: コース`;
    } else if (prompt?.mode === 'spike') {
      power = prompt.power;
      hint = `${this.ak} 長押し→離す: スパイクの強さ<br>←→: 打つコース`;
    } else if (prompt?.mode === 'receive') {
      hint = `ボールが届く瞬間に ${this.ak}！`;
    } else if (prompt?.mode === 'set') {
      hint = `1-4: トス先 / 到達の瞬間に ${this.ak}`;
    } else if (prompt?.mode === 'block') {
      hint = `J/K/L: コース張り / 打つ瞬間に ${this.ak} でジャンプ`;
    }

    if (power !== null) {
      gauge.style.display = 'block';
      // eFootball 式の縦ゲージ（下から溜まる）
      fill.style.height = `${(power * 100).toFixed(0)}%`;
      fill.className = power > 0.85 ? 'over' : power > 0.55 ? 'hot' : '';
    } else {
      gauge.style.display = 'none';
    }
    hints.innerHTML = hint;
    hints.style.display = hint ? 'block' : 'none';

    // ---- 視覚アフォーダンス（毎フレーム更新） ----
    // タイミングリング: 収束する円がボタンと重なった瞬間 = 押す瞬間
    const tr = document.querySelector<HTMLElement>('#wrap-toss .timering');
    if (tr) {
      if (
        prompt &&
        (prompt.mode === 'receive' || prompt.mode === 'set') &&
        !('pressed' in prompt && prompt.pressed)
      ) {
        const frac = prompt.total > 0 ? Math.max(0, Math.min(1, prompt.arriveIn / prompt.total)) : 0;
        tr.style.display = 'block';
        tr.style.transform = `scale(${(1 + frac * 1.5).toFixed(3)})`;
        tr.style.opacity = (0.3 + 0.7 * (1 - frac)).toFixed(2);
      } else {
        tr.style.display = 'none';
      }
    }
    // ホールドリング: 点線回転=「長押しして」、チャージ中=円形ゲージ
    const hr = document.querySelector<HTMLElement>('#wrap-spike .holdring');
    if (hr) {
      if (prompt && (prompt.mode === 'serve' || prompt.mode === 'spike')) {
        hr.style.display = 'block';
        const charging = prompt.charging || (prompt.mode === 'spike' && prompt.locked);
        hr.classList.toggle('charging', charging);
        hr.classList.toggle('hint', !charging);
        if (charging) hr.style.setProperty('--p', String(prompt.power));
      } else {
        hr.style.display = 'none';
      }
    }

    // 4方向パッド: 局面ごとにラベルと「入力方式バッジ」が切り替わり、押せるボタンだけ光る
    const mode = prompt?.mode ?? '';
    if (this.lastPromptMode !== mode) {
      this.lastPromptMode = mode;
      // 吹き出しコーチマークは「邪魔」とのフィードバックにより廃止。
      // 入力方法はホールドリング/タイミングリング/フリックチップで視覚的に示す。
      if (document.getElementById('pad')) {
        // ges: 入力方式の明示（タップ / 長押し / フリック）
        const set = (id: string, icon: string, label: string, live: boolean, ges = '') => {
          const el = document.getElementById(id)!;
          el.innerHTML = `<i>${icon}</i><span>${label}</span>${ges ? `<em>${ges}</em>` : ''}`;
          el.classList.toggle('live', live);
        };
        switch (mode) {
          case 'serve':
            set('pad-precise', '🎯', '精密', false);
            set('pad-spike', '🏐', 'サーブ', true, '長押し→離す');
            set('pad-toss', '🙌', 'トス', false);
            set('pad-dash', '🧱', '構え', false);
            break;
          case 'receive':
            set('pad-precise', '🎯', '精密', false);
            set('pad-spike', '💥', 'スパイク', false);
            set('pad-toss', '🛡️', 'レシーブ', true, 'タップ');
            set('pad-dash', '🧱', '構え', false);
            break;
          case 'set':
            set('pad-precise', '🎯', '精密トス', true, 'タップ/フリック');
            set('pad-spike', '💥', 'スパイク', false);
            set('pad-toss', '🙌', 'トス', true, 'タップ/フリック');
            set('pad-dash', '🧱', '構え', false);
            break;
          case 'spike':
            set('pad-precise', '🎯', '精密', false);
            set('pad-spike', '💥', 'スパイク', true, '長押し/フリック');
            set('pad-toss', '🙌', 'トス', false);
            set('pad-dash', '🧱', '構え', false);
            break;
          case 'block':
            set('pad-precise', '🎯', '精密', false);
            set('pad-spike', '💥', 'スパイク', false);
            set('pad-toss', '🧱', 'ジャンプ', true, 'タップ');
            set('pad-dash', '🖐️', '手の向き', true, 'フリック');
            break;
          default:
            set('pad-precise', '🎯', '精密', false);
            set('pad-spike', '💥', 'スパイク', false);
            set('pad-toss', '🙌', 'トス', false);
            set('pad-dash', '🧱', '構え', false);
        }

        // フリックチップ: ボタンの上下左右に「その方向へフリックすると何が出るか」を図示
        const chips = (
          wrapId: string,
          c: { N?: string; S?: string; W?: string; E?: string } | null,
        ) => {
          const wrap = document.getElementById(wrapId);
          if (!wrap) return;
          for (const dir of ['N', 'S', 'W', 'E'] as const) {
            const el = wrap.querySelector<HTMLElement>('.f' + dir);
            if (!el) continue;
            const v = c?.[dir];
            el.textContent = v ?? '';
            el.style.display = v ? 'flex' : 'none';
          }
        };
        chips('wrap-toss', mode === 'set' ? { W: '⚡', E: '↩', N: '⏫', S: '🤫' } : null);
        chips('wrap-precise', mode === 'set' ? { W: '⚡', E: '⏫', N: '🔙' } : null);
        chips(
          'wrap-spike',
          mode === 'spike'
            ? { N: '🍃', S: '🎯', W: '⬅', E: '➡' }
            : mode === 'serve'
              ? { W: '⬅', E: '➡' }
              : null,
        );
        chips('wrap-dash', mode === 'block' ? { W: '⬅', E: '➡' } : null);
      }
    }
  }

  private lastPromptMode = '__init__';

  // パネルは「種類が変わったときだけ」DOM を構築し、毎フレームは数値のみ更新する。
  // （毎フレーム innerHTML を作り直すと出現アニメーションが先頭で止まり続けて
  //   パネルが透明のままになるバグの再発防止。パフォーマンスも良い）
  private panelMode = '';

  private q<T extends HTMLElement>(sel: string): T | null {
    return this.panelEl.querySelector<T>(sel);
  }

  private renderPanel(prompt: Prompt) {
    const mode = prompt ? prompt.mode : this.matchOver ? 'over' : 'none';

    // スマホは2ゾーン方式（ゴーストリング + トスカード）なので
    // 下中央パネルは再戦ボタン以外表示しない（画面の混雑を避ける）
    if (this.isTouch && mode !== 'over') {
      if (this.panelMode !== 'none') {
        this.panelMode = 'none';
        this.panelEl.innerHTML = '';
      }
      return;
    }

    if (mode !== this.panelMode) {
      this.panelMode = mode;
      this.panelEl.innerHTML = this.panelSkeleton(mode);
    }
    if (!prompt) return;

    // ---- 毎フレームの数値更新 ----
    switch (prompt.mode) {
      case 'serve': {
        this.q('.title')!.textContent = prompt.charging ? 'サーブ — 溜め中…' : 'サーブ';
        this.q<HTMLElement>('.aimcur')!.style.left = `${(((prompt.aimZ + 1) / 2) * 100).toFixed(1)}%`;
        return;
      }
      case 'receive': {
        const frac = prompt.total > 0 ? 1 - prompt.arriveIn / prompt.total : 1;
        this.q<HTMLElement>('.fill')!.style.width = `${(frac * 100).toFixed(1)}%`;
        this.q('.hint')!.textContent = prompt.pressed
          ? prompt.pressed + '!'
          : `ボールが届く瞬間に ${this.ak}！`;
        this.q('.panel')!.className = `panel slim ${prompt.pressed ? `locked q-${prompt.pressed}` : ''}`;
        return;
      }
      case 'set': {
        const frac = prompt.total > 0 ? 1 - prompt.arriveIn / prompt.total : 1;
        this.q<HTMLElement>('.fill')!.style.width = `${(frac * 100).toFixed(1)}%`;
        this.panelEl.querySelectorAll<HTMLElement>('[data-choice]').forEach((el) => {
          el.classList.toggle('sel', el.dataset.choice === prompt.choice);
        });
        this.q('.hint')!.textContent = prompt.pressed
          ? prompt.pressed + '!'
          : `到達の瞬間に ${this.ak}！`;
        this.q('.panel')!.className = `panel ${prompt.pressed ? `locked q-${prompt.pressed}` : ''}`;
        return;
      }
      case 'spike': {
        this.q('.title')!.textContent = prompt.locked
          ? `スパイク！ パワー確定 ${(prompt.power * 100).toFixed(0)}%`
          : prompt.charging
            ? 'スパイク！ 溜め中…'
            : `スパイク！ ${this.ak} 長押しでパワー`;
        this.q<HTMLElement>('.aimcur')!.style.left = `${(((prompt.aimZ + 1) / 2) * 100).toFixed(1)}%`;
        this.q('.panel')!.className = `panel slim ${prompt.locked ? 'locked' : ''}`;
        return;
      }
      case 'block': {
        this.panelEl.querySelectorAll<HTMLElement>('[data-block]').forEach((el) => {
          el.classList.toggle('sel', el.dataset.block === prompt.committed);
        });
        this.q('.hint')!.textContent = prompt.jumped
          ? 'ジャンプ！'
          : `打つ瞬間に ${this.ak} でジャンプ！`;
        this.q('.panel')!.className = `panel ${prompt.jumped ? 'locked' : ''}`;
        return;
      }
    }
  }

  // パネルの静的な骨組み（モード切替時のみ生成）
  private panelSkeleton(mode: string): string {
    const aimBar = `<div class="aimbar"><div class="aimmid"></div><div class="aimcur" style="left:50%"></div></div>`;
    const timingBar = `<div class="bar"><div class="fill" style="width:0%"></div><div class="mark"></div></div>`;
    switch (mode) {
      case 'serve':
        return `<div class="panel slim"><div class="title">サーブ</div>${aimBar}</div>`;
      case 'receive':
        return `<div class="panel slim"><div class="title">レシーブ！</div>${timingBar}<div class="hint"></div></div>`;
      case 'set': {
        const btns = CHOICE_KEYS.map(
          (c) =>
            `<div class="opt" data-choice="${c.choice}"><span class="key">${c.key}</span>${c.label}</div>`,
        ).join('');
        return `<div class="panel"><div class="title">トスを選べ</div><div class="opts">${btns}</div>${timingBar}<div class="hint"></div></div>`;
      }
      case 'spike':
        return `<div class="panel slim"><div class="title">スパイク！</div>${aimBar}</div>`;
      case 'block': {
        const zones = [
          { k: 'J', z: 'L', label: '左' },
          { k: 'K', z: 'M', label: '中央' },
          { k: 'L', z: 'R', label: '右' },
        ];
        const btns = zones
          .map(
            (b) => `<div class="opt" data-block="${b.z}"><span class="key">${b.k}</span>${b.label}</div>`,
          )
          .join('');
        return `<div class="panel"><div class="title">ブロック</div><div class="opts">${btns}</div><div class="hint"></div></div>`;
      }
      case 'over':
        return `<div class="panel"><div class="opts"><div class="opt big" data-action="rematch">再戦する</div></div></div>`;
      default:
        return '';
    }
  }
}
