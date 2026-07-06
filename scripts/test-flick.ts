// フリック順序（actionDown で押下確定→離す瞬間に setChoice）でトス技が反映されるか検証。
import { VolleySim } from '../src/sim/sim';

const dt = 1 / 60;
const sim = new VolleySim(false, true); // team0=人間, team1=CPU
let checked = false;
let ok = false;
let sawSet = false;

for (let steps = 0; steps < 60 * 60 * 5 && !checked; steps++) {
  sim.step(dt);
  const snap = sim.snapshot();
  const p = snap.prompts[0];
  if (!p) continue;
  switch (p.mode) {
    case 'serve':
      if (!p.charging) sim.input(0, { type: 'actionDown' });
      else if (p.power >= 0.7) sim.input(0, { type: 'actionUp' });
      break;
    case 'receive':
      if (!p.pressed && p.arriveIn < 0.05) sim.input(0, { type: 'actionDown' });
      break;
    case 'set': {
      sawSet = true;
      if (!p.pressed && p.arriveIn < 0.05) {
        // フリックの実際の順序を再現: 先に押下(タイミング確定)→その後に技を確定
        sim.input(0, { type: 'actionDown' });
        sim.input(0, { type: 'setChoice', choice: 'RIGHT' }); // ↑バック相当
        // 直後に setPrompt.choice が反映されているか（pressed 済みでも上書きされる）
        if (sim.setPrompt) {
          ok = sim.setPrompt.choice === 'RIGHT';
          checked = true;
        }
      }
      break;
    }
    case 'spike':
      // スパイク: フェイントのフリックを spikePreset で即時確定（power===null 前提）
      sim.input(0, { type: 'spikePreset', power: 0.22 });
      break;
    case 'block':
      break;
  }
}

console.log('sawSet=', sawSet);
console.log('setChoice-after-pressed reflected:', ok);
if (!sawSet) { console.error('NG: セット局面に到達しませんでした'); process.exit(1); }
if (!ok) { console.error('NG: 押下後の setChoice がトス技に反映されていません'); process.exit(1); }
console.log('OK: フリックのトス技(押下後setChoice)が反映される');
