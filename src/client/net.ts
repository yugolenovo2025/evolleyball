import { VolleySim } from '../sim/sim';
import { Input, RosterEntry, Snapshot, Tactic, Team } from '../sim/types';

export interface MatchSetup {
  roster: RosterEntry[];
  tactic: Tactic;
  libero?: RosterEntry | null;
  matchLen?: { basePts: number; bestOf: number };
}

export interface Transport {
  myTeam: Team;
  send(input: Input): void;
  tick(dt: number): void; // ローカルシムの駆動（ネット対戦では何もしない）
  latestSnapshot(): Snapshot | null;
  configure(setup: MatchSetup): void; // 試合準備の確定（マルチはサーバーへ送信）
  close(): void;
}

// ソロ / 観戦: ブラウザ内でシムを回す
export class LocalTransport implements Transport {
  myTeam: Team;
  paused = false;
  private sim: VolleySim;
  private snap: Snapshot | null = null;

  constructor(
    cpu0: boolean,
    cpu1: boolean,
    myTeam: Team = 0,
    rosters?: [RosterEntry[], RosterEntry[]],
    tactic?: Tactic,
    matchLen?: { basePts: number; bestOf: number },
  ) {
    this.sim = new VolleySim(cpu0, cpu1, rosters);
    if (tactic) this.sim.setTactic(myTeam, tactic);
    if (matchLen) this.sim.setMatchLength(matchLen.basePts, matchLen.bestOf);
    this.sim.setHome(myTeam); // ソロはプレイヤーがホーム
    this.myTeam = myTeam;
  }
  private acc = 0;
  send(input: Input) {
    if (!this.paused) this.sim.input(this.myTeam, input);
  }
  tick(dt: number) {
    if (this.paused) return;
    // 固定タイムステップの蓄積: フレームレートが落ちてもシムは実時間で進む
    // （低fps端末やヘッドレスでスローモーションにならないように）
    this.acc = Math.min(this.acc + dt, 0.5); // 溜めすぎ防止（スパイラル回避）
    const STEP = 1 / 60;
    while (this.acc >= STEP) {
      this.sim.step(STEP);
      this.acc -= STEP;
    }
    this.snap = this.sim.snapshot();
  }
  latestSnapshot() {
    return this.snap;
  }
  configure(setup: MatchSetup) {
    // ソロは相手(team1)もこちらで用意済み。自チームだけ確定でよいが、念のため反映
    this.sim.setTeamRoster(this.myTeam, setup.roster);
    this.sim.setTactic(this.myTeam, setup.tactic);
    this.sim.setLibero(this.myTeam, setup.libero ?? null);
    if (setup.matchLen) this.sim.setMatchLength(setup.matchLen.basePts, setup.matchLen.bestOf);
  }
  close() {}
}

// マルチプレイ: WebSocket サーバー上のシムに接続
export class WsTransport implements Transport {
  myTeam: Team = 0;
  private ws: WebSocket;
  private snap: Snapshot | null = null;
  onStatus: (msg: string) => void = () => {};
  onReady: (team: Team, code: string) => void = () => {};
  onError: (msg: string) => void = () => {};

  constructor(url: string, mode: 'host' | 'join', code?: string) {
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
      this.ws.send(JSON.stringify(mode === 'host' ? { type: 'host' } : { type: 'join', code }));
    };
    this.ws.onmessage = (e) => {
      const msg = JSON.parse(String(e.data));
      switch (msg.type) {
        case 'joined':
          this.myTeam = msg.team as Team;
          this.onReady(this.myTeam, msg.code);
          break;
        case 'snap':
          this.snap = msg.snap as Snapshot;
          break;
        case 'info':
          this.onStatus(msg.msg);
          break;
        case 'error':
          this.onError(msg.msg);
          break;
      }
    };
    this.ws.onerror = () => this.onError('サーバーに接続できません');
    this.ws.onclose = () => this.onStatus('切断されました');
  }
  send(input: Input) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'input', input }));
    }
  }
  configure(setup: MatchSetup) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'setup',
          roster: setup.roster,
          tactic: setup.tactic,
          libero: setup.libero ?? null,
          matchLen: setup.matchLen,
        }),
      );
    }
  }
  tick() {}
  latestSnapshot() {
    return this.snap;
  }
  close() {
    this.ws.close();
  }
}
