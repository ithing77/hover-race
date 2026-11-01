// 화면 없이 한 시즌을 끝까지 돌려 점수와 예선 순서가 맞는지 본다.
// 실행: node tools/check_season.js [시즌 수]
const DATA = require('../src/data.js');
const Sim = require('../src/sim.js');
const Season = require('../src/season.js');

const SEASONS = Number(process.argv[2]) || 3;
const perRace = DATA.season.points.reduce((a, b) => a + b, 0);
const champs = {};
const poleWins = [0, 0];
let noTime = 0;
let gaps = 0;
let races = 0;

for (let s = 1; s <= SEASONS; s++) {
  const season = Season.create(DATA, s * 1000);
  while (!Season.finished(DATA, season)) {
    if (Season.inBreak(DATA, season)) Season.endBreak(DATA, season);
    const trackId = DATA.season.calendar[season.round];
    const seed = season.seed + season.round * 101;
    const rows = Sim.qualify(DATA, trackId, seed, season.loadouts);
    if (rows[0].times.length !== 3 || rows[4].times.length !== 3 || rows[5].times.length !== 2 || rows[8].times.length !== 1) throw new Error('예선 탈락 순서가 이상함');
    noTime += rows.filter((r) => r.time === null).length;
    gaps += rows[4].times[2] - rows[0].times[2];
    races++;
    const grid = rows.map((r) => r.driver);
    const race = Sim.createRace(DATA, seed, { trackId, grid, loadouts: season.loadouts });
    const front = race.cars.reduce((a, b) => (b.dist > a.dist ? b : a));
    if (front.driver !== grid[0]) throw new Error('예선 1위가 맨 앞이 아님');
    while (!race.over) Sim.stepRace(race);
    const order = Sim.standings(race);
    poleWins[1]++;
    if (order[0].driver === grid[0]) poleWins[0]++;
    Season.record(DATA, season, order);
  }
  const total = perRace * DATA.season.calendar.length;
  const sum = (t) => t.reduce((a, r) => a + r.pts, 0);
  if (sum(Season.driverTable(season)) !== total || sum(Season.teamTable(season)) !== total) throw new Error('점수 합이 맞지 않음');
  const d = Season.driverTable(season)[0];
  const t = Season.teamTable(season)[0];
  champs[t.id] = (champs[t.id] || 0) + 1;
  console.log(`시즌 ${s}: 챔피언 ${d.driver}(${d.team}) ${d.pts}점 ${d.wins}승 · 컨스트럭터 ${t.name} ${t.pts}점 · 2위 팀 ${Season.teamTable(season)[1].name} ${Season.teamTable(season)[1].pts}점`);
}
console.log('컨스트럭터 우승', champs, ' 예선 1위가 우승한 비율', ((poleWins[0] / poleWins[1]) * 100).toFixed(0) + '%');
console.log('예선: 기록 없는 차', noTime, '대(전체', races * 10, ') · 3차 1위와 5위 평균 차', (gaps / races).toFixed(3) + '초');
console.log('점수 합·예선 순서 확인 통과');
