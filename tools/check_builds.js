// 무작위 조합을 많이 돌려 압도적인 부위나 조합이 없는지 본다.
// 실행: node tools/check_builds.js [조합 수]
const DATA = require('../src/data.js');
const Sim = require('../src/sim.js');

const makers = Object.keys(DATA.makers);
const slots = [...Object.keys(DATA.slots), 'engine'];
let state = 12345;
const rand = () => {
  state = (state * 1664525 + 1013904223) >>> 0;
  return state / 4294967296;
};
const randomBuild = () => {
  const lo = Sim.pureLoadout('nova');
  for (const slot of slots) lo[slot] = makers[Math.floor(rand() * makers.length)];
  return lo;
};
const label = (lo) => slots.map((s) => DATA.makers[lo[s]][0]).join('');

// 내 팀 작전은 고정: 사격 켬, 충격 60에 방어막, 에너지 15 아래에서 정비.
function raceRank(lo, seed) {
  const race = Sim.createRace(DATA, seed, { manualTeams: [DATA.playerTeam], loadouts: { [DATA.playerTeam]: lo } });
  const mine = race.cars.filter((c) => c.manual);
  while (!race.over) {
    for (const car of mine) {
      if (car.finishTime !== null || car.pitPhase) continue;
      if (car.meter >= 60) Sim.activateShield(race, car.id);
      const left = race.laps - Math.max(0, Math.floor(car.dist / race.track.length));
      if (car.energy < left * Sim.lapEnergy(race, car) && car.energy < 15) Sim.requestPit(race, car.id, true);
    }
    Sim.stepRace(race);
  }
  const order = Sim.standings(race);
  return (order.indexOf(mine[0]) + order.indexOf(mine[1]) + 2) / 2;
}

const COUNT = Number(process.argv[2]) || 300;
const totals = {};
const results = [];
for (let i = 0; i < COUNT; i++) {
  const lo = randomBuild();
  const rank = raceRank(lo, i + 1);
  results.push({ lo, rank });
  for (const slot of slots) {
    const key = slot + ':' + lo[slot];
    totals[key] = totals[key] || { sum: 0, n: 0 };
    totals[key].sum += rank;
    totals[key].n++;
  }
}
console.log('무작위 조합', COUNT, '개 평균 순위', (results.reduce((a, r) => a + r.rank, 0) / COUNT).toFixed(2));
for (const slot of slots) {
  console.log((DATA.slots[slot] || '엔진').padEnd(4), makers.map((m) => DATA.makers[m] + ' ' + (totals[slot + ':' + m].sum / totals[slot + ':' + m].n).toFixed(2)).join('  '));
}

// 운 좋게 한 판 잘한 조합을 걸러 내려고 상위 조합만 판 수를 늘려 다시 잰다.
const again = (lo) => {
  let sum = 0;
  for (let s = 1000; s < 1020; s++) sum += raceRank(lo, s);
  return (sum / 20).toFixed(2);
};
results.sort((a, b) => a.rank - b.rank);
console.log('상위 조합 20판 재측정 (앞코·몸통·날개·꼬리·엔진 첫 글자)');
for (const r of results.slice(0, 6)) console.log(label(r.lo), again(r.lo));
console.log('순정 조합 20판');
for (const m of makers) console.log(DATA.makers[m], again(Sim.pureLoadout(m)));
