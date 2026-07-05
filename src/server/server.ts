// 2人マルチプレイ用の対戦サーバー。ルームごとに権威シミュレーションを回し、
// 20Hz でスナップショットを配信する。
// ビルド済みクライアント (dist/) も同じポートで配信するため、
// スマホは「このサーバーの URL を開くだけ」で参加できる。
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { VolleySim } from '../sim/sim';
import { Input, Team } from '../sim/types';

const PORT = Number(process.env.PORT ?? 8787);
const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

interface Room {
  code: string;
  sim: VolleySim;
  clients: [WebSocket | null, WebSocket | null];
  lastStep: number;
  stepTimer: NodeJS.Timeout;
  sendTimer: NodeJS.Timeout;
}

const rooms = new Map<string, Room>();

function makeCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let c = '';
  do {
    c = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(c));
  return c;
}

function createRoom(): Room {
  const code = makeCode();
  const sim = new VolleySim(true, true); // プレイヤーが入るまで両チーム AI
  const room: Room = {
    code,
    sim,
    clients: [null, null],
    lastStep: Date.now(),
    stepTimer: setInterval(() => {
      const now = Date.now();
      const dt = Math.min((now - room.lastStep) / 1000, 0.1);
      room.lastStep = now;
      sim.step(dt);
    }, 16),
    sendTimer: setInterval(() => {
      const msg = JSON.stringify({ type: 'snap', snap: sim.snapshot() });
      for (const c of room.clients) {
        if (c && c.readyState === WebSocket.OPEN) c.send(msg);
      }
    }, 50),
  };
  rooms.set(code, room);
  console.log(`[room ${code}] created`);
  return room;
}

function destroyRoom(room: Room) {
  clearInterval(room.stepTimer);
  clearInterval(room.sendTimer);
  rooms.delete(room.code);
  console.log(`[room ${room.code}] destroyed`);
}

const httpServer = http.createServer(async (req, res) => {
  try {
    let p = (req.url ?? '/').split('?')[0];
    if (p === '/') p = '/index.html';
    const file = normalize(join(DIST, p));
    if (!file.startsWith(DIST + sep)) throw new Error('bad path');
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
});

const wss = new WebSocketServer({ server: httpServer });
httpServer.listen(PORT, () => {
  console.log(`eVolleyball server: http://0.0.0.0:${PORT} (ws 同居)`);
  if (!existsSync(join(DIST, 'index.html'))) {
    console.log('※ dist/ がありません。ゲーム画面も配信するには先に `npm run build` を実行してください。');
  }
});

wss.on('connection', (ws) => {
  let room: Room | null = null;
  let team: Team | null = null;

  ws.on('message', (data) => {
    let msg: any;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }

    if (msg.type === 'host') {
      room = createRoom();
      team = 0;
      room.clients[0] = ws;
      room.sim.setCpu(0, false);
      ws.send(JSON.stringify({ type: 'joined', team: 0, code: room.code }));
      return;
    }
    if (msg.type === 'join') {
      const r = rooms.get(String(msg.code || '').toUpperCase());
      if (!r) {
        ws.send(JSON.stringify({ type: 'error', msg: 'ルームが見つかりません' }));
        return;
      }
      if (r.clients[1]) {
        ws.send(JSON.stringify({ type: 'error', msg: 'ルームは満員です' }));
        return;
      }
      room = r;
      team = 1;
      r.clients[1] = ws;
      r.sim.setCpu(1, false);
      ws.send(JSON.stringify({ type: 'joined', team: 1, code: r.code }));
      const host = r.clients[0];
      if (host && host.readyState === WebSocket.OPEN) {
        host.send(JSON.stringify({ type: 'info', msg: '対戦相手が参加しました！' }));
      }
      console.log(`[room ${r.code}] player 2 joined`);
      return;
    }
    if (msg.type === 'input' && room && team !== null) {
      room.sim.input(team, msg.input as Input);
    }
  });

  ws.on('close', () => {
    if (!room || team === null) return;
    room.clients[team] = null;
    room.sim.setCpu(team, true); // 抜けたチームは AI が引き継ぐ
    const other = room.clients[1 - team];
    if (other && other.readyState === WebSocket.OPEN) {
      other.send(JSON.stringify({ type: 'info', msg: '相手が切断しました（AIが引き継ぎ）' }));
    }
    if (!room.clients[0] && !room.clients[1]) destroyRoom(room);
  });
});
