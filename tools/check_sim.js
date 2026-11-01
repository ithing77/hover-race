// 화면 없이 경주를 여러 번 돌려 바퀴 시간과 기체별 성적을 본다.
// 실행: node tools/check_sim.js
const DATA = require('../src/data.js');
const Sim = require('../src/sim.js');

const RUNS = 40;
const TRACK = process.argv[2] || 'neon';
const stats = {};
for (const { id: key } of DATA.teams) stats[key] = { wins: 0, posSum: 0, lapSum: 0, lapCount: 0, best: Infinity, stops: 0 };
let timeSum = 0;
let length = 0;
let spreadSum = 0;
let emptySum = 0;
let crashSum = 0;
let wallSum = 0;
let passSum = 0;

function countStops(race, counter) {
  for (const car of race.cars) {
    if (car.pitPhase === 'service' && !counter[car.id]) {
      counter[car.id] = true;
      counter.total[car.id]++;
    }
    if (car.pitPhase !== 'service') counter[car.id] = false;
  }
}

for (let seed = 1; seed <= RUNS; seed++) {
  const race = Sim.createRace(DATA, seed, { mixAi: false, trackId: TRACK });
  length = race.track.length;
  const counter = { total: race.cars.map(() => 0) };
  let guard = 0;
  let lastOrder = null;
  while (!race.over && guard++ < 60 * 60 * 30) {
    Sim.stepRace(race);
    // 추월: 1초마다 트랙 위 차들의 순서가 바뀐 횟수를 센다.
    if (guard % 60 === 0) {
      const now = Sim.standings(race).filter((c) => !c.pitPhase && c.finishTime === null).map((c) => c.id);
      if (lastOrder) {
        for (let i = 0; i + 1 < now.length; i++) {
          const a = lastOrder.indexOf(now[i]);
          const b = lastOrder.indexOf(now[i + 1]);
          if (a >= 0 && b >= 0 && a > b) passSum++;
        }
      }
      lastOrder = now;
    }
    countStops(race, counter);
    for (const car of race.cars) if (car.energy <= 0 && car.finishTime === null) emptySum += Sim.STEP;
  }
  if (!race.over) throw new Error('경주가 끝나지 않음, 시드 ' + seed);
  crashSum += race.counts.crash;
  wallSum += race.counts.wall;
  const order = Sim.standings(race);
  timeSum += order[0].finishTime;
  spreadSum += order[order.length - 1].finishTime - order[0].finishTime;
  stats[order[0].team.id].wins++;
  order.forEach((car, i) => {
    const s = stats[car.team.id];
    s.posSum += i + 1;
    s.lapSum += car.finishTime / race.laps;
    s.lapCount++;
    s.best = Math.min(s.best, car.bestLap);
    s.stops += counter.total[car.id];
  });
}

// 같은 시드는 같은 결과여야 나중에 멀티를 붙일 수 있다.
const finish = (seed) => {
  const r = Sim.createRace(DATA, seed);
  while (!r.over) Sim.stepRace(r);
  return Sim.standings(r).map((c) => c.driver + c.finishTime.toFixed(4)).join();
};
if (finish(7) !== finish(7)) throw new Error('같은 시드인데 결과가 다름');

console.log('트랙 길이', length.toFixed(0));
console.log('우승 기록 평균', (timeSum / RUNS).toFixed(1) + '초', ' 1등과 꼴찌 차이', (spreadSum / RUNS).toFixed(1) + '초', ' 에너지 바닥 시간(전체 차 합, 경주당)', (emptySum / RUNS).toFixed(1) + '초');
console.log('경주당 충돌', (crashSum / RUNS).toFixed(0), ' 벽 긁힘', (wallSum / RUNS).toFixed(0), ' 추월', (passSum / RUNS).toFixed(0));
for (const [key, s] of Object.entries(stats)) {
  console.log(
    key.padEnd(7),
    '우승', String(s.wins).padStart(2),
    ' 평균순위', (s.posSum / s.lapCount).toFixed(1),
    ' 평균바퀴', (s.lapSum / s.lapCount).toFixed(2),
    ' 최고바퀴', s.best.toFixed(2),
    ' 평균정비', (s.stops / s.lapCount).toFixed(1)
  );
}
console.log('같은 시드 결과 일치 확인 통과');

// 내 팀(NOVA)이 지시를 다르게 내리면 결과가 달라지는지 본다.
const lapsLeft = (race, car) => race.laps - Math.max(0, Math.floor(car.dist / race.track.length));
const pitWhenLow = (race, car, below) => {
  if (car.pitPhase) return;
  const left = lapsLeft(race, car);
  if (car.energy >= left * Sim.lapEnergy(race, car)) return;
  if (car.energy < below) Sim.requestPit(race, car.id, true);
};
const policies = {
  '지시 없음(정비 안 함)': () => {},
  '들이받기': (race, car) => {
    Sim.setDrive(race, car.id, 'ram');
    pitWhenLow(race, car, 15);
  },
  '막기': (race, car) => {
    Sim.setDrive(race, car.id, 'block');
    pitWhenLow(race, car, 15);
  },
  '사격 끔': (race, car) => {
    Sim.setFire(race, car.id, false);
    pitWhenLow(race, car, 15);
  },
  '방어막도 사용': (race, car) => {
    if (car.meter >= 60) Sim.activateShield(race, car.id);
    pitWhenLow(race, car, 15);
  },
  '보통+빠른 연료': (race, car) => pitWhenLow(race, car, 15),
  '보통+오래가는 연료': (race, car) => {
    Sim.setNextFuel(race, car.id, 'long');
    pitWhenLow(race, car, 15);
  },
  '계속 밀어붙임': (race, car) => {
    Sim.setOrder(race, car.id, 'push');
    pitWhenLow(race, car, 20);
  },
  '계속 아낌': (race, car) => {
    Sim.setOrder(race, car.id, 'save');
    pitWhenLow(race, car, 10);
  },
  '마지막 8바퀴만 밀어붙임': (race, car) => {
    const left = lapsLeft(race, car);
    Sim.setOrder(race, car.id, left <= 8 && car.energy >= left * race.drainPerLap * DATA.orders.push.drain * DATA.fuels[car.fuel].drain * car.build.drain ? 'push' : 'normal');
    pitWhenLow(race, car, 15);
  },
};

console.log('\nNOVA 지시별 결과 (' + RUNS + '번 평균)');
for (const [name, policy] of Object.entries(policies)) {
  let posSum = 0;
  let timeTotal = 0;
  for (let seed = 1; seed <= RUNS; seed++) {
    const race = Sim.createRace(DATA, seed, { manualTeams: [DATA.playerTeam], mixAi: false, trackId: TRACK });
    const mine = race.cars.filter((c) => c.manual);
    while (!race.over) {
      for (const car of mine) if (car.finishTime === null) policy(race, car);
      Sim.stepRace(race);
    }
    const order = Sim.standings(race);
    for (const car of mine) {
      posSum += order.indexOf(car) + 1;
      timeTotal += car.finishTime;
    }
  }
  console.log(name.padEnd(16), ' 평균순위', (posSum / (RUNS * 2)).toFixed(1), ' 평균기록', (timeTotal / (RUNS * 2)).toFixed(1) + '초');
}
