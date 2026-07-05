// WebAudio による簡易効果音 + 観客音響システム。外部アセット不要。
// 設計方針: 普段は音量を絞り、「ここぞ」の瞬間だけ最大化する（音の緩急が命）。
export class Sfx {
  private ctx: AudioContext | null = null;
  private crowdBus: GainNode | null = null; // 観客系の総合バス（ダッキング用）
  private ambGain: GainNode | null = null; // ざわめきの音量（ラリー緊張度）
  private ambSrc: AudioBufferSourceNode | null = null;
  private padGain: GainNode | null = null; // チャント時の BGM レイヤー
  private clapTimer: number | undefined;
  private chantTimer: number | undefined;
  private quiet = false; // VAR 中などの静寂

  private ac(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (!this.crowdBus) this.initCrowd();
    return this.ctx;
  }

  // 観客アンビエンス（ループするざわめき）と BGM パッドの初期化
  private initCrowd() {
    const ac = this.ctx!;
    this.crowdBus = ac.createGain();
    this.crowdBus.gain.value = 1;
    this.crowdBus.connect(ac.destination);

    // ざわめき: 低くこもった群衆の遠鳴り（強いローパスで「サーッ」という空気音を消す）
    const dur = 3.0;
    const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      last = last * 0.992 + (Math.random() * 2 - 1) * 0.08; // 深いブラウンノイズ=遠いどよめき
      d[i] = last;
    }
    this.ambSrc = ac.createBufferSource();
    this.ambSrc.buffer = buf;
    this.ambSrc.loop = true;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220; // 高域を大きくカット→耳障りな空気音が消える
    const lp2 = ac.createBiquadFilter();
    lp2.type = 'lowpass';
    lp2.frequency.value = 300;
    this.ambGain = ac.createGain();
    this.ambGain.gain.value = 0.01;
    this.ambSrc.connect(lp).connect(lp2).connect(this.ambGain).connect(this.crowdBus);
    this.ambSrc.start();

    // チャント時に重なる BGM パッド（2音のコード）
    this.padGain = ac.createGain();
    this.padGain.gain.value = 0;
    const plp = ac.createBiquadFilter();
    plp.type = 'lowpass';
    plp.frequency.value = 900;
    this.padGain.connect(ac.destination);
    for (const f of [130.8, 196.0, 261.6]) {
      const o = ac.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = Math.random() * 8 - 4;
      o.connect(plp);
      o.start();
    }
    plp.connect(this.padGain);
  }

  // ---- 状況更新（毎フレーム呼ばれる）----
  // tension: ラリーの長さ 0..1 / clap: ホームの手拍子 / chant: 連続得点チャント / quiet: VAR静寂
  updateCrowd(state: { tension: number; clap: boolean; chant: boolean; quiet: boolean }) {
    if (!this.ctx || !this.ambGain || !this.crowdBus) return;
    const ac = this.ctx;
    this.quiet = state.quiet;
    // ざわめき: 緊張度で音量が上がる。VAR 中はシーンと静まる（控えめに）
    const target = state.quiet ? 0.0015 : 0.01 + state.tension * 0.035;
    this.ambGain.gain.setTargetAtTime(target, ac.currentTime, 0.35);
    if (this.ambSrc) this.ambSrc.playbackRate.setTargetAtTime(1 + state.tension * 0.18, ac.currentTime, 0.4);
    // チャント時の BGM レイヤー
    this.padGain?.gain.setTargetAtTime(state.chant && !state.quiet ? 0.035 : 0, ac.currentTime, 0.8);

    // ホームの手拍子（自チームのサーブ準備中、リズムを後押し）
    if (state.clap && !state.quiet && this.clapTimer === undefined) {
      this.clapTimer = window.setInterval(() => this.clap(), 470);
    } else if ((!state.clap || state.quiet) && this.clapTimer !== undefined) {
      clearInterval(this.clapTimer);
      this.clapTimer = undefined;
    }
    // チャント（オー！オー！のコール）
    if (state.chant && !state.quiet && this.chantTimer === undefined) {
      this.chantTimer = window.setInterval(() => this.chantCall(), 640);
    } else if ((!state.chant || state.quiet) && this.chantTimer !== undefined) {
      clearInterval(this.chantTimer);
      this.chantTimer = undefined;
    }
  }

  private clap() {
    if (!this.ctx || !this.crowdBus) return;
    const ac = this.ctx;
    const t = ac.currentTime;
    const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.06), ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = ac.createBufferSource();
    s.buffer = buf;
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1500;
    const g = ac.createGain();
    g.gain.value = 0.045;
    s.connect(hp).connect(g).connect(this.crowdBus);
    s.start(t);
  }

  // 応援コール（人声は不快なので拍手リズムに置換）
  private chantCall() {
    this.clap();
  }

  // 落胆（人声ボイスは廃止。静寂だけで緊張を演出）
  gasp() {
    this.ac();
    // 静寂を挟む
    if (this.ambGain) this.ambGain.gain.setTargetAtTime(0.003, this.ctx!.currentTime + 0.3, 0.1);
  }

  // アウェイのプレッシャー（人声ブーは廃止。低いブザー風トーンのみ）
  boo() {
    this.tone(140, 0.5, 'sawtooth', 0.05, 0.3);
  }

  // 場内アナウンス（音声読み上げは不快との指摘により無効化）
  announce(_text: string) {
    /* no-op */
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.15, when = 0) {
    const ac = this.ac();
    const t = ac.currentTime + when;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(ac.destination);
    o.start(t);
    o.stop(t + dur);
  }

  // 群衆の「声」をフォルマント合成する。複数のノコギリ波を母音フォルタ(F1,F2)に通し、
  // 微妙にデチューンして人の声の重なりを作る（空気ノイズではなく肉声のざわめき）。
  // vowel: 'a'(ワァー) / 'o'(オー) / 'u'(ブー)。glide でピッチ上昇（歓声の高揚）。
  private voice(opts: {
    vowel: 'a' | 'o' | 'u';
    f0: number;
    dur: number;
    vol: number;
    when?: number;
    glide?: number;
    voices?: number;
  }) {
    const ac = this.ac();
    const t = ac.currentTime + (opts.when ?? 0);
    const FORMANT: Record<string, [number, number]> = {
      a: [800, 1150], // アー
      o: [500, 900], // オー
      u: [350, 700], // ウー
    };
    const [f1, f2] = FORMANT[opts.vowel];
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.vol, t + Math.min(0.12, opts.dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    const bp1 = ac.createBiquadFilter();
    bp1.type = 'bandpass';
    bp1.frequency.value = f1;
    bp1.Q.value = 6;
    const bp2 = ac.createBiquadFilter();
    bp2.type = 'bandpass';
    bp2.frequency.value = f2;
    bp2.Q.value = 8;
    bp1.connect(g);
    bp2.connect(g);
    g.connect(this.crowdBus ?? ac.destination);
    const n = opts.voices ?? 6;
    for (let i = 0; i < n; i++) {
      const o = ac.createOscillator();
      o.type = 'sawtooth';
      const f = opts.f0 * (0.94 + Math.random() * 0.12); // 声の高さのばらつき
      o.frequency.setValueAtTime(f, t);
      if (opts.glide) o.frequency.linearRampToValueAtTime(f * (1 + opts.glide), t + opts.dur * 0.6);
      o.connect(bp1);
      o.connect(bp2);
      o.start(t);
      o.stop(t + opts.dur + 0.05);
    }
  }

  // 観客の歓声「ワァァー！」（人声フォルマント。when で「タメ」を作れる）
  // 得点時は人声ではなく「拍手の湧き上がり」だけにする（歓声ボイスは不快なので廃止）
  private cheer(vol = 0.14, dur = 1.3, when = 0) {
    void vol;
    void dur;
    const base = (when ?? 0) * 1000;
    const n = 14;
    for (let i = 0; i < n; i++) {
      // タメの後、拍手が散発→密集していく
      setTimeout(() => this.clap(), base + i * (40 + Math.random() * 60));
    }
  }

  play(kind: string) {
    switch (kind) {
      case 'whistle':
        this.tone(2200, 0.35, 'square', 0.05);
        break;
      case 'serve':
      case 'contact':
        this.tone(180, 0.12, 'sine', 0.25);
        break;
      case 'spike':
        this.tone(120, 0.18, 'sine', 0.3);
        break;
      case 'point':
      case 'ace':
        // 決定の瞬間は一拍おいて（0.45秒の「タメ」）歓声が爆発する
        this.tone(660, 0.12, 'triangle', 0.12);
        this.tone(880, 0.25, 'triangle', 0.12, 0.1);
        this.tone(1900, 0.05, 'square', 0.1, 0.45); // パーン！という破裂音
        this.cheer(0.22, 1.7, 0.45);
        break;
      case 'block':
        this.tone(300, 0.2, 'sawtooth', 0.12);
        this.tone(1700, 0.05, 'square', 0.09, 0.4);
        this.cheer(0.18, 1.4, 0.4);
        break;
      case 'fault':
        this.tone(220, 0.3, 'triangle', 0.1);
        this.gasp(); // 「あーっ…」+ 静寂
        break;
      case 'toss':
        this.tone(520, 0.08, 'sine', 0.1);
        break;
      case 'matchOver':
        this.tone(523, 0.15, 'triangle', 0.12);
        this.tone(659, 0.15, 'triangle', 0.12, 0.15);
        this.tone(784, 0.4, 'triangle', 0.12, 0.3);
        this.cheer(0.2, 2.5);
        break;
      case 'ui': // ボタンの手触り音
        this.tone(1250, 0.045, 'sine', 0.07);
        this.tone(1650, 0.05, 'sine', 0.045, 0.015);
        break;
      case 'skill': // スキル発動: 上昇する煌めき音
        this.tone(520, 0.12, 'triangle', 0.1);
        this.tone(780, 0.14, 'triangle', 0.1, 0.05);
        this.tone(1170, 0.22, 'triangle', 0.09, 0.11);
        this.tone(2400, 0.08, 'sine', 0.05, 0.11);
        break;
      case 'heartbeat': // VAR 判定中の心拍
        this.tone(58, 0.14, 'sine', 0.4);
        this.tone(52, 0.12, 'sine', 0.3, 0.18);
        break;
      case 'var': // ビデオ判定開始のサスペンス
        this.tone(392, 0.5, 'triangle', 0.08);
        this.tone(370, 0.6, 'triangle', 0.08, 0.45);
        break;
    }
  }
}
