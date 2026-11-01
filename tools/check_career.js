// 연구와 드라이버가 성적을 뒤집지 않을 만큼만 영향을 주는지, 여러 시즌이 이어지는지 본다.
// 실행: node tools/check_career.js [조건당 경주 수]
const DATA = require('../src/data.js');
const Sim = require('../src/sim.js');
const Season = require('../src/season.js');
const Career = require('../src/career.js');

const RUNS = Number(process.argv[2]) || 16;
const pitWhenLow = (race, car) => {
  if (car.pitPhase) return;
  const left = race.laps - Math.max(0, Math.floor(car.dist / race.track.length));
  const need = Sim.lapEnergy(race, car);
  if (car.energy < left * need && car.energy < need * 2.2) Sim.requestPit(race, car.id, true);
};

function rank(lo, skills) {
  let sum = 0;
  for (let seed = 1; seed <= RUNS; seed++) {
    const race = Sim.createRace(DATA, seed, { manualTeams: [DATA.playerTeam], mixAi: false, loadouts: { [DATA.playerTeam]: lo }, skills });
    const mine = race.cars.filter((c) => c.manual);
    while (!race.over) {
      for (const car of mine) if (car.finishTime === null) pitWhenLow(race, car);
      Sim.stepRace(race);
    }
    const order = Sim.standings(race);
    for (const car of mine) sum += order.indexOf(car) + 1;
  }
  return sum / RUNS / 2;
}

const base = Sim.pureLoadout('helios');
console.log('연구 없음', rank(base).toFixed(2));
for (const [id, item] of Object.entries(DATA.research)) {
  if (item.settings) continue;
  console.log(item.name.padEnd(10), rank({ ...base, research: [id] }).toFixed(2));
}

const mine = DATA.teams.find((t) => t.id === DATA.playerTeam).drivers;
const skillOf = (v) => ({ pace: v, corner: v, calm: v, saver: v, know: 0 });
const tiers = { '최하 드라이버': 1, '보통 드라이버': 5, '최고 드라이버': 9 };
for (const [name, v] of Object.entries(tiers)) {
  const skills = {};
  for (const d of mine) skills[d] = skillOf(v);
  console.log(name, rank(base, skills).toFixed(2), ' 볼트 순정', rank(Sim.pureLoadout('volt'), skills).toFixed(2));
}

// 세 시즌을 잇는다. 은퇴, 상금, 영입, 연구가 오류 없이 돌아야 한다.
const career = Career.create(DATA, 42);
for (let y = 1; y <= 3; y++) {
  const season = Season.create(DATA, y * 1000);
  if (Career.startResearch(DATA, career, 'crew')) console.log('연구 시작: 정비 크루');
  while (!Season.finished(DATA, season)) {
    if (Season.inBreak(DATA, season)) {
      Season.endBreak(DATA, season);
      if (Career.sign(DATA, career, career.market[0], 1)) console.log('휴식기 영입, 남은 돈', career.money);
    }
    const trackId = DATA.season.calendar[season.round];
    const seed = season.seed + season.round * 101;
    const skills = Career.skillsFor(career, trackId);
    const lo = {};
    for (const t of DATA.teams) lo[t.id] = { ...season.loadouts[t.id], research: t.id === DATA.playerTeam ? career.active : career.aiResearch[t.id] };
    const grid = Sim.qualify(DATA, trackId, seed, lo, {}, skills).map((r) => r.driver);
    const race = Sim.createRace(DATA, seed, { trackId, grid, loadouts: lo, skills, laps: 3 });
    while (!race.over) Sim.stepRace(race);
    const order = Sim.standings(race);
    Season.record(DATA, season, order);
    Career.afterRace(DATA, career, order, trackId);
  }
  const total = DATA.season.points.reduce((a, b) => a + b, 0) * DATA.season.calendar.length;
  if (Season.teamTable(season).reduce((a, t) => a + t.pts, 0) !== total) throw new Error('팀 점수 합이 맞지 않음');
  const end = Career.afterSeason(DATA, career, Season.teamTable(season));
  console.log(`시즌 ${y}: ${end.place}위 보너스 ${end.bonus} · 돈 ${career.money} · 은퇴 ${end.retired.map((r) => r.name).join(', ') || '없음'} · 내 선수 ${career.rosters[DATA.playerTeam].map((n) => `${n}(${career.drivers[n].age}세 ${Career.myTraits(DATA, career, n).join('/')})`).join(' ')}`);
}
const rival = career.rosters[DATA.teams[1].id][0];
console.log('스카우트 예', rival, Career.scoutReport(DATA, career, rival), '이적료', Career.fee(DATA, career, rival));
console.log('경력 확인 통과');
