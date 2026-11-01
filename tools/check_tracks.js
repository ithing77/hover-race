// 트랙마다 모양이 겹치지 않는지, 경기 시간과 유리한 차가 어떻게 다른지 본다.
// 실행: node tools/check_tracks.js [경주 수]
const DATA = require('../src/data.js');
const Sim = require('../src/sim.js');

const RUNS = Number(process.argv[2]) || 40;

// 부위 하나만 다른 차를 내 팀으로 태우면 트랙별로 어느 쪽이 유리한지 바로 보인다.
const slants = {
  '속도형': { nose: 'nova', body: 'kage', wing: 'nova', tail: 'nova', engine: 'nova', setting: { balance: 2, gearing: -2, power: 0 } },
  '코너형': { nose: 'volt', body: 'volt', wing: 'volt', tail: 'kage', engine: 'volt', setting: { balance: -2, gearing: 2, power: 0 } },
  '무거운형': { nose: 'titan', body: 'titan', wing: 'titan', tail: 'titan', engine: 'titan', setting: { balance: 0, gearing: 0, power: 0 } },
};
const pitWhenLow = (race, car) => {
  if (car.pitPhase) return;
  const left = race.laps - Math.max(0, Math.floor(car.dist / race.track.length));
  const need = Sim.lapEnergy(race, car);
  if (car.energy < left * need && car.energy < need * 2.2) Sim.requestPit(race, car.id, true);
};

for (const def of DATA.tracks) {
  const track = Sim.buildTrack(def, DATA.traffic);
  // 멀리 떨어진 구간끼리 도로가 겹치는지 잰다.
  let closest = Infinity;
  const near = Math.ceil((def.width * 3) / Sim.SAMPLE);
  for (let i = 0; i < track.count; i += 4) {
    for (let j = i + near; j < track.count; j += 4) {
      if (i + track.count - j < near) continue;
      const d = Math.hypot(track.points[i][0] - track.points[j][0], track.points[i][1] - track.points[j][1]);
      if (d < closest) closest = d;
    }
  }
  const minR = Math.min(...track.radius);
  const straight = track.radius.findIndex((r) => r < 400) * Sim.SAMPLE;

  const teams = {};
  for (const t of DATA.teams) teams[t.id] = { wins: 0, pos: 0, stops: 0 };
  let time = 0;
  let spread = 0;
  let crash = 0;
  let wall = 0;
  let pass = 0;
  for (let seed = 1; seed <= RUNS; seed++) {
    const race = Sim.createRace(DATA, seed, { mixAi: false, trackId: def.id });
    const was = {};
    let tick = 0;
    let last = null;
    while (!race.over) {
      Sim.stepRace(race);
      for (const car of race.cars) {
        if (car.pitPhase === 'service' && !was[car.id]) teams[car.team.id].stops++;
        was[car.id] = car.pitPhase === 'service';
      }
      if (++tick % 60 === 0) {
        const now = Sim.standings(race).filter((c) => !c.pitPhase && c.finishTime === null).map((c) => c.id);
        if (last) for (let i = 0; i + 1 < now.length; i++) if (last.indexOf(now[i]) > last.indexOf(now[i + 1]) && last.indexOf(now[i + 1]) >= 0) pass++;
        last = now;
      }
    }
    const order = Sim.standings(race);
    time += order[0].finishTime;
    spread += order[9].finishTime - order[0].finishTime;
    crash += race.counts.crash;
    wall += race.counts.wall;
    teams[order[0].team.id].wins++;
    order.forEach((c, i) => { teams[c.team.id].pos += i + 1; });
  }

  console.log(`\n${def.name} 길이 ${track.length} · ${def.laps}바퀴 · 가까운 구간 ${closest.toFixed(0)}(폭 ${def.width}) · 가장 급한 코너 ${minR.toFixed(0)} · 첫 직선 ${straight}`);
  if (closest < def.width + 6) console.log('  !! 도로가 겹침');
  if (straight < DATA.pit.exit + 20) console.log('  !! 첫 직선이 정비소보다 짧음');
  console.log(`  우승 ${(time / RUNS).toFixed(0)}초 · 1등과 꼴찌 ${(spread / RUNS).toFixed(1)}초 · 충돌 ${(crash / RUNS).toFixed(0)} · 벽 ${(wall / RUNS).toFixed(1)} · 추월 ${(pass / RUNS).toFixed(0)}`);
  console.log('  ' + DATA.teams.map((t) => `${t.id} ${teams[t.id].wins}승 ${(teams[t.id].pos / RUNS / 2).toFixed(1)}위 정비${(teams[t.id].stops / RUNS / 2).toFixed(1)}`).join(' / '));
  const slantText = Object.entries(slants).map(([name, lo]) => {
    let pos = 0;
    const runs = Math.ceil(RUNS / 2);
    for (let seed = 1; seed <= runs; seed++) {
      const race = Sim.createRace(DATA, seed, { manualTeams: [DATA.playerTeam], mixAi: false, trackId: def.id, loadouts: { [DATA.playerTeam]: lo } });
      const mine = race.cars.filter((c) => c.manual);
      while (!race.over) {
        for (const car of mine) if (car.finishTime === null) pitWhenLow(race, car);
        Sim.stepRace(race);
      }
      const order = Sim.standings(race);
      for (const car of mine) pos += order.indexOf(car) + 1;
    }
    return `${name} ${(pos / runs / 2).toFixed(1)}위`;
  }).join(' / ');
  console.log('  내 팀 조합: ' + slantText);
}
