// 출발 자리가 얼마나 유리한지 본다. 모든 팀이 같은 차를 타고 자리만 무작위로 바꾼다.
// 실행: node tools/check_grid.js [트랙당 경주 수]
const DATA = require('../src/data.js');
const Sim = require('../src/sim.js');

const RUNS = Number(process.argv[2]) || 40;
const same = {};
for (const t of DATA.teams) same[t.id] = Sim.pureLoadout('helios');
const drivers = DATA.teams.flatMap((t) => t.drivers);

for (const def of DATA.tracks) {
  const pos = new Array(10).fill(0);
  const time = new Array(10).fill(0);
  const wins = new Array(10).fill(0);
  for (let seed = 1; seed <= RUNS; seed++) {
    const rng = Sim.mulberry32(seed * 31);
    const grid = [...drivers];
    for (let i = grid.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [grid[i], grid[j]] = [grid[j], grid[i]];
    }
    const race = Sim.createRace(DATA, seed, { trackId: def.id, grid, loadouts: same });
    while (!race.over) Sim.stepRace(race);
    const order = Sim.standings(race);
    order.forEach((car, i) => {
      const slot = grid.indexOf(car.driver);
      pos[slot] += i + 1;
      time[slot] += car.finishTime - order[0].finishTime;
      if (i === 0) wins[slot]++;
    });
  }
  console.log(`${def.name}  자리별 평균 순위: ` + pos.map((p) => (p / RUNS).toFixed(1)).join(' '));
  console.log(`  1번 자리 ${wins[0]}승, 앞 세 자리 ${wins[0] + wins[1] + wins[2]}승 / 뒤 세 자리 ${wins[7] + wins[8] + wins[9]}승 (${RUNS}판) · 1번과 10번 평균 기록 차 ${((time[9] - time[0]) / RUNS).toFixed(1)}초`);
}
