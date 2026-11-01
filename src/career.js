// 여러 시즌에 걸쳐 남는 것: 돈, 연구, 드라이버. 화면을 모른다.
(function (root) {
  const Sim = root.HoverSim || (typeof require !== 'undefined' ? require('./sim.js') : null);
  const SKILLS = ['pace', 'corner', 'calm', 'saver'];

  function nextRng(career) {
    career.tick++;
    return Sim.mulberry32(career.seed + career.tick * 7919);
  }

  function newDriver(data, name, rng, age) {
    const d = { name, age, seen: 0, tracks: {} };
    for (const key of SKILLS) d[key] = data.drivers.statLow + rng() * (data.drivers.statHigh - data.drivers.statLow);
    return d;
  }

  function create(data, seed) {
    const career = { seed, tick: 0, year: 1, money: data.money.start, unlocked: [], active: [], researching: null, aiResearch: {}, rosters: {}, drivers: {}, market: [], used: 0, log: [] };
    const rng = nextRng(career);
    const pool = [...data.drivers.pool];
    const draw = (age) => {
      const name = pool[career.used++ % pool.length];
      career.drivers[name] = newDriver(data, name, rng, age ?? 18 + Math.floor(rng() * 16));
      return name;
    };
    for (const team of data.teams) {
      career.rosters[team.id] = [draw(), draw()];
      career.aiResearch[team.id] = [];
    }
    for (let i = 0; i < data.drivers.marketSize; i++) career.market.push(draw());
    apply(data, career);
    return career;
  }

  // 로스터를 팀에 적용한다. 경주 계산은 team.drivers를 읽는다.
  function apply(data, career) {
    for (const team of data.teams) team.drivers = career.rosters[team.id];
  }

  // 경주에 넘기는 드라이버 능력. 트랙을 몇 번 달렸는지도 들어간다.
  function skillsFor(career, trackId) {
    const out = {};
    for (const d of Object.values(career.drivers)) out[d.name] = { pace: d.pace, corner: d.corner, calm: d.calm, saver: d.saver, know: d.tracks[trackId] || 0 };
    return out;
  }

  function startResearch(data, career, id) {
    const item = data.research[id];
    if (!item || career.researching || career.unlocked.includes(id) || career.money < item.cost) return false;
    if (item.needs && !career.unlocked.includes(item.needs)) return false;
    career.money -= item.cost;
    career.researching = { id, left: item.races };
    return true;
  }

  // 연구를 켜고 끈다. 같은 묶음은 하나만 켤 수 있다. 세팅 범위 연구는 켜 둔 채로 둔다.
  function toggleResearch(data, career, id) {
    if (!career.unlocked.includes(id)) return;
    if (career.active.includes(id)) {
      career.active = career.active.filter((x) => x !== id);
      return;
    }
    const group = data.research[id].group;
    if (group) career.active = career.active.filter((x) => data.research[x].group !== group);
    career.active.push(id);
  }

  function finishResearch(data, career) {
    if (!career.researching) return null;
    career.researching.left--;
    if (career.researching.left > 0) return null;
    const { id } = career.researching;
    career.researching = null;
    career.unlocked.push(id);
    toggleResearch(data, career, id);
    return id;
  }

  // 세팅 칸을 얼마나 움직일 수 있는지. 처음엔 ±1이고 연구하면 ±2.
  function settingRange(data, career, key) {
    return career && !career.unlocked.includes(data.settingResearch[key]) ? 1 : 2;
  }

  function grow(data, d, rng) {
    const g = data.drivers;
    const delta = d.age < g.youngUntil ? g.growYoung : d.age < g.oldFrom ? g.growPrime : -g.growOld;
    const key = SKILLS[Math.floor(rng() * SKILLS.length)];
    d[key] = Math.max(0, Math.min(10, d[key] + delta * (0.5 + rng())));
  }

  // 경기가 끝날 때마다. 상금, 연구 진행, 드라이버 성장, 상대 팀 연구.
  function afterRace(data, career, order, trackId) {
    const rng = nextRng(career);
    let earned = 0;
    order.forEach((car, i) => {
      if (car.team.id === data.playerTeam) earned += data.money.prize[i] || 0;
      const d = career.drivers[car.driver];
      if (!d) return;
      d.tracks[trackId] = (d.tracks[trackId] || 0) + 1;
      grow(data, d, rng);
      // 같이 달린 경기가 많을수록 스카우트 보고서가 정확해진다.
      if (car.team.id !== data.playerTeam) d.seen++;
    });
    career.money += earned;
    const done = finishResearch(data, career);
    const ids = Object.keys(data.research);
    for (const team of data.teams) {
      if (team.id === data.playerTeam || rng() > data.money.aiResearchChance) continue;
      const list = career.aiResearch[team.id];
      const pick = ids[Math.floor(rng() * ids.length)];
      const item = data.research[pick];
      if (item.settings || list.includes(pick)) continue;
      career.aiResearch[team.id] = list.filter((x) => !item.group || data.research[x].group !== item.group).concat(pick);
    }
    return { earned, done: done && data.research[done].name };
  }

  // 시즌이 끝나면 상금을 주고 나이를 먹인다. 은퇴하면 신인이 자리를 메운다.
  function afterSeason(data, career, teamTable) {
    const rng = nextRng(career);
    const place = teamTable.findIndex((t) => t.id === data.playerTeam);
    const bonus = data.money.seasonBonus[place] || 0;
    career.money += bonus;
    career.year++;
    const retired = [];
    const replace = (name) => {
      delete career.drivers[name];
      const rookie = data.drivers.pool[career.used++ % data.drivers.pool.length];
      career.drivers[rookie] = newDriver(data, rookie, rng, 17 + Math.floor(rng() * 4));
      return rookie;
    };
    for (const team of data.teams) {
      career.rosters[team.id] = career.rosters[team.id].map((name) => {
        const d = career.drivers[name];
        d.age++;
        if (d.age < data.drivers.retireAge && !(d.age >= data.drivers.mayRetire && rng() < 0.35)) return name;
        const rookie = replace(name);
        retired.push({ name, age: d.age, team: team.id, rookie });
        return rookie;
      });
    }
    career.market = career.market.map((name) => {
      const d = career.drivers[name];
      d.age++;
      return d.age >= data.drivers.mayRetire ? replace(name) : name;
    });
    apply(data, career);
    return { bonus, place: place + 1, retired };
  }

  const average = (d) => SKILLS.reduce((a, k) => a + d[k], 0) / SKILLS.length;

  // 이적료. 잘하고 젊을수록 비싸고, 다른 팀 소속이면 더 비싸다.
  function fee(data, career, name) {
    const d = career.drivers[name];
    const youth = Math.max(0, 30 - d.age) * data.drivers.feePerYouth;
    const rival = career.market.includes(name) ? 1 : data.drivers.rivalFee;
    return Math.round((data.drivers.feeBase + Math.max(0, average(d) - 3) * data.drivers.feePerSkill + youth) * rival);
  }

  // 영입. 내보낸 드라이버는 그 자리로 간다(시장이면 시장, 다른 팀이면 그 팀).
  function sign(data, career, name, slot) {
    const cost = fee(data, career, name);
    if (career.money < cost) return false;
    const mine = career.rosters[data.playerTeam];
    if (mine.includes(name)) return false;
    const out = mine[slot];
    career.money -= cost;
    const at = career.market.indexOf(name);
    if (at >= 0) career.market[at] = out;
    else {
      const team = Object.keys(career.rosters).find((id) => career.rosters[id].includes(name));
      career.rosters[team] = career.rosters[team].map((x) => (x === name ? out : x));
    }
    mine[slot] = name;
    apply(data, career);
    return true;
  }

  // 숫자 없이 특징을 말로 보여 준다. value를 주면 그 값으로(스카우트 추정치) 말한다.
  function traits(data, values) {
    const out = [];
    for (const key of SKILLS) {
      const t = data.drivers.traits[key];
      if (values[key] >= 6.5) out.push(t.good);
      else if (values[key] <= 3.5) out.push(t.bad);
    }
    return out.length ? out : ['무난함'];
  }

  function myTraits(data, career, name) {
    return traits(data, career.drivers[name]);
  }

  // 다른 팀 선수는 스카우트 보고서로. 같이 달린 경기가 적으면 틀릴 수 있다.
  function scoutReport(data, career, name) {
    const d = career.drivers[name];
    const trust = Math.min(1, d.seen / data.drivers.scoutRaces);
    const rng = Sim.mulberry32(career.seed + [...name].reduce((a, c) => a + c.charCodeAt(0), 0) + d.seen);
    const guess = {};
    for (const key of SKILLS) guess[key] = d[key] + (rng() * 2 - 1) * data.drivers.scoutError * (1 - trust);
    return { text: traits(data, guess), trust: trust >= 0.8 ? '확신 높음' : trust >= 0.35 ? '확신 보통' : '확신 낮음' };
  }

  const Career = { create, apply, skillsFor, startResearch, toggleResearch, settingRange, afterRace, afterSeason, fee, sign, myTraits, scoutReport };
  root.HoverCareer = Career;
  if (typeof module !== 'undefined') module.exports = Career;
})(typeof globalThis !== 'undefined' ? globalThis : this);
