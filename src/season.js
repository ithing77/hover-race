// 시즌 계산. 경기 결과를 받아 점수를 쌓고 드라이버·컨스트럭터 순위를 낸다. 화면을 모른다.
(function (root) {
  const Sim = root.HoverSim || (typeof require !== 'undefined' ? require('./sim.js') : null);

  function rollAi(data, season) {
    const rng = Sim.mulberry32(season.seed + season.round * 977);
    for (const team of data.teams) season.loadouts[team.id] = Sim.aiLoadout(data, team, rng, true);
  }

  function create(data, seed) {
    const season = { seed, round: 0, breakDone: false, loadouts: {}, drivers: {}, teams: {}, results: [] };
    rollAi(data, season);
    for (const team of data.teams) {
      season.teams[team.id] = { id: team.id, name: team.name, color: team.color, pts: 0, wins: 0, best: 99 };
      for (const driver of team.drivers) season.drivers[driver] = { driver, team: team.id, pts: 0, wins: 0, best: 99 };
    }
    return season;
  }

  // 휴식기는 정해진 경기가 끝난 뒤 다음 예선 전까지다.
  function inBreak(data, season) {
    return season.round === data.season.breakAfter && !season.breakDone;
  }

  function endBreak(data, season) {
    season.breakDone = true;
    rollAi(data, season); // 상대 팀도 휴식기에 조합을 바꾼다.
  }

  function record(data, season, order) {
    const rows = order.map((car, i) => {
      const pts = data.season.points[i] || 0;
      // 휴식기에 영입한 선수는 이때 표에 들어간다.
      if (!season.drivers[car.driver]) season.drivers[car.driver] = { driver: car.driver, team: car.team.id, pts: 0, wins: 0, best: 99 };
      const d = season.drivers[car.driver];
      d.team = car.team.id;
      const t = season.teams[car.team.id];
      d.pts += pts;
      t.pts += pts;
      if (i === 0) {
        d.wins++;
        t.wins++;
      }
      d.best = Math.min(d.best, i + 1);
      t.best = Math.min(t.best, i + 1);
      return { driver: car.driver, team: car.team.id, pos: i + 1, pts };
    });
    season.results.push({ track: data.season.calendar[season.round], rows });
    season.round++;
    return rows;
  }

  const rank = (a, b) => b.pts - a.pts || b.wins - a.wins || a.best - b.best;
  const driverTable = (season) => Object.values(season.drivers).sort(rank);
  const teamTable = (season) => Object.values(season.teams).sort(rank);
  const finished = (data, season) => season.round >= data.season.calendar.length;

  const Season = { create, inBreak, endBreak, record, driverTable, teamTable, finished };
  root.HoverSeason = Season;
  if (typeof module !== 'undefined') module.exports = Season;
})(typeof globalThis !== 'undefined' ? globalThis : this);
