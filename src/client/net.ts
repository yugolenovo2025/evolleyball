import { VolleySim } from '../sim/sim';
import { Input, RosterEntry, Snapshot, Tactic, Team } from '../sim/types';

export interface Transport {
  myTeam: Team;
  send(input: Input): void;
  tick(dt: number): void; // ローカルシムの駆動（ネット対戦では何もしない）
  latestSnapshot(): Snapshot | null;
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
    this.myTeam = myTeam;
  }
  send(input: Input) {
    if (!this.paused) this.sim.input(this.myTeam, input);
  }
  tick(dt: number) {
    if (this.paused) return;
    this.sim.step(Math.min(dt, 0.05));
    this.snap = this.sim.snapshot();
  }
  latestSnapshot() {
    return this.snap;
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
  tick() {}
  latestSnapshot() {
    return this.snap;
  }
  close() {
    this.ws.close();
  }
}
