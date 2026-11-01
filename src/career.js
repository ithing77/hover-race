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

  // 살아 있는 선수와 이름이 겹치지 않게 새 선수를 만든다.
  function addDriver(data, career, rng, age) {
    const pool = data.drivers.pool;
    let name = pool[career.used++ % pool.length];
    for (let tries = 0; career.drivers[name] && tries < pool.length; tries++) name = pool[career.used++ % pool.length];
    let n = 2;
    const base = name;
    while (career.drivers[name]) name = `${base} ${n++}`;
    career.drivers[name] = newDriver(data, name, rng, age);
    return name;
  }

  function create(data, seed) {
    // orgs는 사람이 맡은 팀의 돈과 연구. humans에 없는 팀은 aiResearch로 연구한다.
    const career = { seed, tick: 0, year: 1, orgs: {}, humans: [data.playerTeam], aiResearch: {}, rosters: {}, drivers: {}, market: [], used: 0, log: [] };
    const rng = nextRng(career);
    const draw = (age) => addDriver(data, career, rng, age ?? 18 + Math.floor(rng() * 16));
    for (const team of data.teams) {
      career.rosters[team.id] = [draw(), draw()];
      career.aiResearch[team.id] = [];
      career.orgs[team.id] = { money: data.money.start, unlocked: [], active: [], researching: null };
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

  function startResearch(data, career, id, team = data.playerTeam) {
    const item = data.research[id];
    const org = career.orgs[team];
    if (!item || org.researching || org.unlocked.includes(id) || org.money < item.cost) return false;
    org.money -= item.cost;
    org.researching = { id, left: item.races };
    return true;
  }

  // 연구를 켜고 끈다. 같은 묶음은 하나만 켤 수 있다. 세팅 범위 연구는 켜 둔 채로 둔다.
  function toggleResearch(data, career, id, team = data.playerTeam) {
    const org = career.orgs[team];
    if (!org.unlocked.includes(id)) return;
    if (org.active.includes(id)) {
      org.active = org.active.filter((x) => x !== id);
      return;
    }
    const group = data.research[id].group;
    if (group) org.active = org.active.filter((x) => data.research[x].group !== group);
    org.active.push(id);
  }

  function finishResearch(data, career, team) {
    const org = career.orgs[team];
    if (!org.researching) return null;
    org.researching.left--;
    if (org.researching.left > 0) return null;
    const { id } = org.researching;
    org.researching = null;
    org.unlocked.push(id);
    toggleResearch(data, career, id, team);
    return id;
  }

  // 세팅 칸을 얼마나 움직일 수 있는지. 처음엔 ±1이고 연구하면 ±2.
  function settingRange(data, career, key, team = data.playerTeam) {
    return career && !career.orgs[team].unlocked.includes(data.settingResearch[key]) ? 1 : 2;
  }

  function grow(data, d, rng) {
    const g = data.drivers;
    const delta = d.age < g.youngUntil ? g.growYoung : d.age < g.oldFrom ? g.growPrime : -g.growOld;
    const key = SKILLS[Math.floor(rng() * SKILLS.length)];
    d[key] = Math.max(0, Math.min(10, d[key] + delta * (0.5 + rng())));
  }

  // 경기가 끝날 때마다. 상금, 연구 진행, 드라이버 성장, 상대 팀 연구. 팀별 결과를 돌려준다.
  function afterRace(data, career, order, trackId) {
    const rng = nextRng(career);
    const out = {};
    for (const id of career.humans) out[id] = { earned: 0, done: null };
    order.forEach((car, i) => {
      if (out[car.team.id]) out[car.team.id].earned += data.money.prize[i] || 0;
      const d = career.drivers[car.driver];
      if (!d) return;
      d.tracks[trackId] = (d.tracks[trackId] || 0) + 1;
      grow(data, d, rng);
      // 같이 달린 경기가 많을수록 스카우트 보고서가 정확해진다.
      if (!career.humans.includes(car.team.id)) d.seen++;
      else d.seen += 0.5;
    });
    for (const id of career.humans) {
      career.orgs[id].money += out[id].earned;
      const done = finishResearch(data, career, id);
      out[id].done = done && data.research[done].name;
    }
    const ids = Object.keys(data.research);
    for (const team of data.teams) {
      if (career.humans.includes(team.id) || rng() > data.money.aiResearchChance) continue;
      const list = career.aiResearch[team.id];
      const pick = ids[Math.floor(rng() * ids.length)];
      const item = data.research[pick];
      if (item.settings || list.includes(pick)) continue;
      career.aiResearch[team.id] = list.filter((x) => !item.group || data.research[x].group !== item.group).concat(pick);
    }
    return out;
  }

  // 시즌이 끝나면 상금을 주고 나이를 먹인다. 은퇴하면 신인이 자리를 메운다.
  function afterSeason(data, career, teamTable) {
    const rng = nextRng(career);
    const standings = {};
    for (const id of career.humans) {
      const place = teamTable.findIndex((t) => t.id === id);
      const bonus = data.money.seasonBonus[place] || 0;
      career.orgs[id].money += bonus;
      standings[id] = { place: place + 1, bonus };
    }
    career.year++;
    const retired = [];
    const replace = (name) => {
      delete career.drivers[name];
      return addDriver(data, career, rng, 17 + Math.floor(rng() * 4));
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
    return { standings, retired };
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
  function sign(data, career, name, slot, team = data.playerTeam) {
    const cost = fee(data, career, name);
    const org = career.orgs[team];
    const mine = career.rosters[team];
    if (org.money < cost || mine.includes(name) || !mine[slot] || !career.drivers[name]) return false;
    if (isLocked(career, name)) return false;
    const owner = Object.keys(career.rosters).find((id) => career.rosters[id].includes(name));
    if (owner && career.humans.includes(owner)) return false; // 다른 사람의 선수는 못 데려온다
    const out = mine[slot];
    org.money -= cost;
    const at = career.market.indexOf(name);
    if (at >= 0) career.market[at] = out;
    else {
      career.rosters[owner] = career.rosters[owner].map((x) => (x === name ? out : x));
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

  // 드래프트로 뽑은 선수는 정해진 시즌 동안 다른 팀이 못 데려간다.
  function isLocked(career, name) {
    const d = career.drivers[name];
    return Boolean(d.lockUntil) && d.lockUntil >= career.year;
  }

  // 화면에 줄 것만 추린다. 멀티 손님에게도 이것만 보내서 능력 숫자가 나가지 않는다.
  function viewFor(data, career, team, open) {
    const org = career.orgs[team];
    const mine = career.rosters[team];
    const research = Object.entries(data.research).map(([id, item]) => ({
      id, name: item.name, desc: item.desc, cost: item.cost, races: item.races, settings: Boolean(item.settings),
      left: org.researching && org.researching.id === id ? org.researching.left : null,
      done: org.unlocked.includes(id),
      on: org.active.includes(id),
    }));
    const offer = (name, where) => {
      const d = career.drivers[name];
      const report = scoutReport(data, career, name);
      return { name, age: d.age, where, text: report.text, trust: report.trust, fee: fee(data, career, name), locked: isLocked(career, name) };
    };
    const rivals = data.teams.filter((t) => !career.humans.includes(t.id)).flatMap((t) => career.rosters[t.id].map((n) => offer(n, t.name)));
    const range = {};
    for (const key of Object.keys(data.settings)) range[key] = settingRange(data, career, key, team);
    return {
      year: career.year, money: org.money, researching: Boolean(org.researching), active: org.active, research, range, open,
      mine: mine.map((name) => ({ name, age: career.drivers[name].age, traits: myTraits(data, career, name), locked: isLocked(career, name) })),
      market: career.market.map((n) => offer(n, '무소속')),
      rivals,
    };
  }

  // ---------- 드래프트 ----------
  // 첫 시즌: 팀마다 한 명만 남기고 나머지를 후보로 모아 번갈아 뽑는다.
  // 다음 시즌부터: 추첨 순서대로 신인 중에서 뽑거나 넘긴다.
  function lotteryOrder(data, teamTable, rng) {
    let left = teamTable.map((t, rank) => ({ id: t.id, weight: data.draft.odds[rank] || 1 }));
    const all = left.reduce((a, t) => a + t.weight, 0);
    const order = [];
    while (left.length) {
      const total = left.reduce((a, t) => a + t.weight, 0);
      let roll = rng() * total;
      const pick = left.find((t) => (roll -= t.weight) < 0) || left[left.length - 1];
      // 화면에는 그 팀의 1순위 확률을 보여 준다.
      order.push({ id: pick.id, chance: Math.round((pick.weight / all) * 100) });
      left = left.filter((t) => t !== pick);
    }
    return order;
  }

  function startDraft(data, career, teamTable) {
    const rng = nextRng(career);
    if (!teamTable) {
      for (const team of data.teams) career.market.push(career.rosters[team.id].pop());
      const order = data.teams.map((t) => ({ id: t.id, chance: null }));
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      apply(data, career);
      return { first: true, order, idx: 0, pool: [...career.market], picks: [] };
    }
    const pool = [];
    for (let i = 0; i < data.draft.rookies; i++) pool.push(addDriver(data, career, rng, 17 + Math.floor(rng() * 4)));
    career.market.push(...pool);
    return { first: false, order: lotteryOrder(data, teamTable, rng), idx: 0, pool, picks: [] };
  }

  const currentPicker = (draft) => (draft.idx < draft.order.length ? draft.order[draft.idx].id : null);

  // 뽑기. 첫 드래프트는 빈자리에, 다음부터는 slot 자리에 넣고 원래 선수는 시장으로 간다. name이 없으면 넘기기.
  function draftPick(data, career, draft, team, name, slot) {
    if (currentPicker(draft) !== team) return false;
    if (name) {
      if (!draft.pool.includes(name)) return false;
      if (!draft.first && !career.rosters[team][slot]) return false;
      career.market = career.market.filter((n) => n !== name);
      draft.pool = draft.pool.filter((n) => n !== name);
      if (draft.first) career.rosters[team].push(name);
      else {
        career.market.push(career.rosters[team][slot]);
        career.rosters[team][slot] = name;
      }
      career.drivers[name].lockUntil = career.year + data.draft.lockSeasons - 1;
    } else if (draft.first) {
      return false; // 첫 드래프트는 빈자리가 있어 넘길 수 없다
    }
    draft.picks.push({ team, name: name || null });
    draft.idx++;
    apply(data, career);
    return true;
  }

  // 컴퓨터와 시간이 지난 사람의 선택. 첫 드래프트는 좋아 보이는 선수, 다음부터는 약한 선수보다 나을 때만.
  function draftAuto(data, career, draft, team) {
    const best = [...draft.pool].sort((a, b) => average(career.drivers[b]) - average(career.drivers[a]))[0];
    if (draft.first) return draftPick(data, career, draft, team, best);
    const roster = career.rosters[team];
    const slot = average(career.drivers[roster[0]]) <= average(career.drivers[roster[1]]) ? 0 : 1;
    if (best && average(career.drivers[best]) > average(career.drivers[roster[slot]])) return draftPick(data, career, draft, team, best, slot);
    return draftPick(data, career, draft, team, null);
  }

  function draftView(data, career, draft, team) {
    return {
      first: draft.first,
      year: career.year,
      current: currentPicker(draft),
      order: draft.order.map((o) => ({ id: o.id, chance: o.chance })),
      idx: draft.idx,
      picks: draft.picks,
      pool: draft.pool.map((name) => {
        const report = scoutReport(data, career, name);
        return { name, age: career.drivers[name].age, text: report.text, trust: report.trust };
      }),
      mine: career.rosters[team] || [],
    };
  }

  const Career = { create, apply, skillsFor, startResearch, toggleResearch, settingRange, afterRace, afterSeason, fee, sign, myTraits, scoutReport, viewFor, startDraft, draftPick, draftAuto, draftView, currentPicker };
  root.HoverCareer = Career;
  if (typeof module !== 'undefined') module.exports = Career;
})(typeof globalThis !== 'undefined' ? globalThis : this);
