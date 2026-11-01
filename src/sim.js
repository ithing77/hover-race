// 경주 계산. 화면을 전혀 모르므로 같은 시드면 어디서 돌려도 같은 결과가 나온다.
(function (root) {
  const STEP = 1 / 60;
  const SAMPLE = 2; // 트랙 점 간격

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 꼭짓점 목록을 직선과 둥근 코너로 바꾼다.
  function polyPath(def) {
    const unit = (a, b) => {
      const len = Math.hypot(a[0] - b[0], a[1] - b[1]);
      return [(a[0] - b[0]) / len, (a[1] - b[1]) / len];
    };
    const path = [{ to: def.start }];
    def.poly.forEach((v, i) => {
      const before = i ? def.poly[i - 1] : def.start;
      const after = i + 1 < def.poly.length ? def.poly[i + 1] : def.start;
      const ua = unit(before, v);
      const ub = unit(after, v);
      const angle = Math.acos(ua[0] * ub[0] + ua[1] * ub[1]);
      const r = v[2];
      const t = r / Math.tan(angle / 2);
      const k = (4 / 3) * Math.tan((Math.PI - angle) / 4) * r;
      const p1 = [v[0] + ua[0] * t, v[1] + ua[1] * t];
      const p2 = [v[0] + ub[0] * t, v[1] + ub[1] * t];
      path.push({ to: p1 });
      path.push({ c1: [p1[0] - ua[0] * k, p1[1] - ua[1] * k], c2: [p2[0] - ub[0] * k, p2[1] - ub[1] * k], to: p2 });
    });
    path.push({ to: def.start });
    return path;
  }

  function buildTrack(def, traffic) {
    // 곡선을 잘게 나눈 뒤 일정한 간격의 점으로 다시 찍는다.
    const raw = [];
    const path = polyPath(def);
    let prev = path[0].to;
    raw.push(prev);
    for (const seg of path.slice(1)) {
      const n = 60;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        if (seg.c1) {
          const u = 1 - t;
          raw.push([
            u * u * u * prev[0] + 3 * u * u * t * seg.c1[0] + 3 * u * t * t * seg.c2[0] + t * t * t * seg.to[0],
            u * u * u * prev[1] + 3 * u * u * t * seg.c1[1] + 3 * u * t * t * seg.c2[1] + t * t * t * seg.to[1],
          ]);
        } else {
          raw.push([prev[0] + (seg.to[0] - prev[0]) * t, prev[1] + (seg.to[1] - prev[1]) * t]);
        }
      }
      prev = seg.to;
    }

    const points = [raw[0]];
    let carry = 0;
    for (let i = 1; i < raw.length; i++) {
      let [ax, ay] = raw[i - 1];
      const [bx, by] = raw[i];
      let d = Math.hypot(bx - ax, by - ay);
      while (carry + d >= SAMPLE) {
        const r = (SAMPLE - carry) / d;
        ax += (bx - ax) * r;
        ay += (by - ay) * r;
        points.push([ax, ay]);
        d = Math.hypot(bx - ax, by - ay);
        carry = 0;
      }
      carry += d;
    }

    const n = points.length;
    const length = n * SAMPLE;
    const at = (i) => points[((i % n) + n) % n];

    // 앞뒤 점으로 그린 원의 반지름으로 코너가 얼마나 급한지 잰다.
    const radius = new Array(n);
    const curve = new Array(n); // 방향 있는 곡률. +면 lane이 +인 쪽이 안쪽이다.
    const W = 10;
    for (let i = 0; i < n; i++) {
      const [ax, ay] = at(i - W);
      const [bx, by] = at(i);
      const [cx, cy] = at(i + W);
      const area = Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay));
      const abc = Math.hypot(bx - ax, by - ay) * Math.hypot(cx - bx, cy - by) * Math.hypot(ax - cx, ay - cy);
      radius[i] = area < 1e-6 ? Infinity : abc / (2 * area);
      const cross = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
      curve[i] = radius[i] < 220 ? Math.sign(cross) / radius[i] : 0;
    }

    const laneMax = def.width / 2 - traffic.laneRoom;
    const wall = def.width / 2 - traffic.wallRoom;
    // 빠른 라인. 다가올 코너의 안쪽을 미리 노린다.
    const line = new Array(n);
    const AHEAD = 28;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = 0; j < AHEAD; j++) sum += Math.max(-1, Math.min(1, curve[(i + j) % n] * 60));
      line[i] = (sum / AHEAD) * laneMax * 0.78;
    }

    return { points, radius, curve, line, length, count: n, width: def.width, laneMax, wall, id: def.id, name: def.name };
  }

  // 기체마다 트랙 위치별 한계 속도를 미리 계산한다. 코너 앞에서 미리 감속하는 것까지 포함.
  function speedProfile(track, stats, phys) {
    const top = phys.topSpeedBase + phys.topSpeedPerStat * stats.top;
    const grip = phys.gripBase + phys.gripPerStat * stats.corner;
    const n = track.count;
    const limit = new Array(n);
    for (let i = 0; i < n; i++) limit[i] = Math.min(top, Math.sqrt(grip * track.radius[i]));
    for (let pass = 0; pass < 2; pass++) {
      for (let i = n - 1; i >= 0; i--) {
        const next = limit[(i + 1) % n];
        limit[i] = Math.min(limit[i], Math.sqrt(next * next + 2 * phys.brake * SAMPLE));
      }
    }
    return { limit, top, accel: phys.accelBase + phys.accelPerStat * stats.accel };
  }

  // 부위·엔진·세팅을 합쳐 실제 능력치를 만든다.
  function pureLoadout(maker) {
    return { nose: maker, body: maker, wing: maker, tail: maker, engine: maker, setting: { balance: 0, gearing: 0, power: 0 }, research: [] };
  }

  function computeBuild(data, lo) {
    const sum = { top: 0, accel: 0, corner: 0, stability: 0, armor: 0, weight: 0, drain: 0 };
    for (const slot of Object.keys(data.slots)) {
      const part = data.parts[slot][lo[slot]];
      for (const key of Object.keys(sum)) sum[key] += part[key] || 0;
    }
    const clamp = (v) => Math.max(1, Math.min(10, v));
    const top = clamp(sum.top);
    const accel = clamp(sum.accel);
    const corner = clamp(sum.corner);
    const stability = clamp(sum.stability);
    const over = Math.max(0, top + accel + corner + stability - data.budget.base);
    const s = lo.setting;
    const engine = data.engines[lo.engine];
    // 켜 둔 연구의 효과를 더한다.
    const r = { top: 0, accel: 0, corner: 0, armor: 0, weight: 0, regen: 0, pitSave: 0, shieldSave: 0, mistake: 1 };
    for (const id of lo.research || []) {
      const fx = data.research[id].effect || {};
      for (const key of Object.keys(fx)) {
        if (key === 'mistake') r.mistake *= fx.mistake;
        else r[key] += fx[key];
      }
    }
    return {
      top: top + r.top + s.balance * data.settings.balance.top + s.gearing * data.settings.gearing.top,
      accel: accel + r.accel + s.gearing * data.settings.gearing.accel,
      corner: corner + r.corner + s.balance * data.settings.balance.corner,
      stability,
      pitSave: r.pitSave,
      shieldSave: r.shieldSave,
      mistake: r.mistake,
      armor: Math.max(0, sum.armor + r.armor),
      weight: Math.max(1, sum.weight + (engine.weight || 0) + r.weight),
      drain: (1 + sum.drain + over * data.budget.drainPerPoint) * (1 + s.power * data.settings.power.drain),
      speedMod: 1 + s.power * data.settings.power.speed,
      maxEnergy: engine.max,
      regen: engine.regen + r.regen,
      wing: lo.wing,
      trail: data.parts.tail[lo.tail].trail,
      weapon: data.combat.weapons[lo.wing],
    };
  }

  // 상대 팀 조합. 자기 회사 부위에 한두 개를 다른 회사 것으로 바꾼다.
  function aiLoadout(data, team, rng, mix) {
    const lo = pureLoadout(team.maker);
    const makers = Object.keys(data.makers);
    const slots = Object.keys(data.slots);
    for (const chance of [data.aiMix.first, data.aiMix.second]) {
      const roll = rng();
      const slot = slots[Math.floor(rng() * slots.length)];
      const maker = makers[Math.floor(rng() * makers.length)];
      if (mix && roll < chance) lo[slot] = maker;
    }
    return lo;
  }

  function createRace(data, seed, options = {}) {
    const manual = options.manualTeams || [];
    const def = data.tracks.find((t) => t.id === options.trackId) || data.tracks[0];
    const track = buildTrack(def, data.traffic);
    const rng = mulberry32(seed ?? data.race.seed);
    const phys = data.physics;
    // 팀마다 차는 같다. 조합과 능력치를 팀별로 한 번만 계산한다.
    const profiles = {};
    const builds = {};
    const loadouts = {};
    for (const team of data.teams) {
      const auto = aiLoadout(data, team, rng, options.mixAi !== false);
      loadouts[team.id] = (options.loadouts && options.loadouts[team.id]) || auto;
      builds[team.id] = computeBuild(data, loadouts[team.id]);
      profiles[team.id] = speedProfile(track, builds[team.id], phys);
    }

    const entries = [];
    data.teams.forEach((team) => team.drivers.forEach((driver, d) => {
      if (!options.entrants || options.entrants.includes(driver)) entries.push({ team, driver, d });
    }));
    // 출발 순서는 시드로 섞는다.
    for (let i = entries.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [entries[i], entries[j]] = [entries[j], entries[i]];
    }
    // 예선을 했으면 그 순서대로 선다.
    if (options.grid) entries.sort((a, b) => options.grid.indexOf(a.driver) - options.grid.indexOf(b.driver));

    const skills = options.skills || {};
    const ds = data.drivers;
    const cars = entries.map((e, i) => {
      const skill = skills[e.driver] || { pace: 5, corner: 5, calm: 5, saver: 5, know: 0 };
      return {
      id: i,
      paceMul: 1 + (skill.pace - 5) * ds.paceStat + Math.min(ds.knowMax, skill.know) * ds.knowStat,
      saveMul: 1 - (skill.saver - 5) * ds.saverStat,
      calmMul: 1 - (skill.calm - 5) * ds.calmStat,
      driver: e.driver,
      team: e.team,
      loadout: loadouts[e.team.id],
      build: builds[e.team.id],
      profile: skill.corner === 5 ? profiles[e.team.id] : speedProfile(track, { ...builds[e.team.id], corner: builds[e.team.id].corner + (skill.corner - 5) * ds.cornerStat }, phys),
      lane: (i % 2 === 0 ? -1 : 1) * (4 + (i % 3) * 4),
      dist: -phys.gridSpacing * (i + 1),
      speed: 0,
      lapStart: null,
      lastLap: null,
      bestLap: null,
      lapsDone: 0,
      swing: 1,
      // 경주마다 달라지는 그날의 컨디션. 바퀴 흔들림은 30바퀴면 평균으로 사라져서 따로 둔다.
      form: 1 + (rng() * 2 - 1) * phys.raceFormSwing,
      finishTime: null,
      manual: manual.includes(e.team.id),
      energy: builds[e.team.id].maxEnergy,
      order: 'normal',
      fuel: data.startFuel,
      nextFuel: data.startFuel,
      pitRequested: false,
      pitPhase: null, // 'in' 칸으로 가는 중, 'service' 정비 중, 'out' 나가는 중
      pitLeft: 0,
      slipping: false,
      fireOn: true,
      drive: 'normal',
      blocking: false,
      laneTarget: 0,
      speedCap: Infinity,
      pushV: 0,
      crashCd: 0,
      wallCd: 0,
      fireCd: 0,
      meter: 0,
      stagger: 0,
      rebootLeft: 0,
      shieldLeft: 0,
      shieldCd: 0,
      pitBelow: data.ai[e.team.style].pitBelow[0] + rng() * (data.ai[e.team.style].pitBelow[1] - data.ai[e.team.style].pitBelow[0]),
      aiTimer: i * 0.05, // 판단 시점을 차마다 조금씩 어긋나게 한다
      };
    });

    const pit = { ...data.pit, lane: -(def.width / 2 + data.pit.laneGap) };
    const race = { track, pit, drainPerLap: def.drain, cars, time: 0, laps: options.laps || def.laps, rng, profiles, phys, data, over: false, pitBusy: {}, impacts: [], fx: options.fx ? [] : null, news: [], counts: { crash: 0, wall: 0 } };
    cars.forEach((car) => rollSwing(race, car));
    return race;
  }

  // 무전 지시. 나중에 멀티를 붙이면 이 함수들을 같은 시점에 함께 부르면 된다.
  function setOrder(race, carId, order) {
    race.cars[carId].order = order;
  }

  function requestPit(race, carId, on) {
    race.cars[carId].pitRequested = on;
  }

  function setNextFuel(race, carId, fuel) {
    race.cars[carId].nextFuel = fuel;
  }

  function setDrive(race, carId, drive) {
    race.cars[carId].drive = drive;
  }

  function setFire(race, carId, on) {
    race.cars[carId].fireOn = on;
  }

  // 차끼리의 앞뒤 거리. 양수면 other가 앞이다.
  function signedGap(race, car, other) {
    const L = race.track.length;
    const g = (((other.dist - car.dist) % L) + L) % L;
    return g > L / 2 ? g - L : g;
  }

  function nearestEnemy(race, car, range, wantBehind) {
    let best = null;
    let bestGap = Infinity;
    for (const other of race.cars) {
      if (other.team === car.team || other.pitPhase || other.finishTime !== null) continue;
      const g = signedGap(race, car, other);
      if (wantBehind && g >= 0) continue;
      if (Math.abs(g) <= range && Math.abs(g) < bestGap) {
        best = other;
        bestGap = Math.abs(g);
      }
    }
    return best;
  }

  function crash(race, a, b, gap) {
    const c = race.data.traffic.crash;
    const rear = gap >= 0 ? a : b;
    const front = gap >= 0 ? b : a;
    race.counts.crash++;
    a.crashCd = c.cooldown;
    b.crashCd = c.cooldown;
    rear.speed *= c.rearSpeed;
    front.speed *= c.frontSpeed;
    const total = a.build.weight + b.build.weight;
    const side = a.lane === b.lane ? (a.id < b.id ? 1 : -1) : Math.sign(a.lane - b.lane);
    a.pushV += side * c.push * (b.build.weight / total);
    b.pushV -= side * c.push * (a.build.weight / total);
    let big = false;
    if (a.team !== b.team) {
      const grace = race.time < c.startGrace ? c.graceDamage : 1;
      const hurt = (victim, other) => {
        const ram = other.drive === 'ram' ? c.ramDamage : 1;
        const dmg = c.damage * grace * ram * (other.build.weight / victim.build.weight) * (1 - victim.build.armor);
        if (victim.rebootLeft <= 0) victim.meter = Math.min(100, victim.meter + dmg);
        victim.stagger = race.data.combat.staggerTime;
        if (dmg >= 8) big = true;
        if (victim.meter >= race.data.combat.reboot.at && victim.rebootLeft <= 0) {
          victim.rebootLeft = race.data.combat.reboot.time;
          if (race.fx) race.fx.push({ kind: 'reboot', car: victim.id });
          say(race, victim, '충돌로 재부팅!');
        }
      };
      hurt(a, b);
      hurt(b, a);
    }
    if (race.fx) race.fx.push({ kind: 'crash', a: a.id, b: b.id, big });
  }

  // 라인을 고르고, 막히면 비키고, 부딪히면 밀어낸다. 차가 움직이기 전에 한 번 돈다.
  function trafficStep(race) {
    const tr = race.data.traffic;
    const c = tr.crash;
    const { track } = race;
    for (const car of race.cars) {
      car.speedCap = Infinity;
      car.crashCd = Math.max(0, car.crashCd - STEP);
      car.wallCd = Math.max(0, car.wallCd - STEP);
      const d = ((car.dist % track.length) + track.length) % track.length;
      car.laneTarget = track.line[Math.floor(d / SAMPLE) % track.count];
    }
    const active = race.cars.filter((car) => !car.pitPhase && car.finishTime === null);
    for (const car of active) {
      // 막아: 뒤따라오는 적과 같은 줄로 옮긴다. 들이받아: 가까운 적에게 붙는다.
      const drive = race.data.drives[car.drive];
      if (car.drive === 'block') {
        const chaser = nearestEnemy(race, car, drive.range, true);
        car.blocking = Boolean(chaser);
        if (chaser) car.laneTarget = chaser.lane;
      } else if (car.drive === 'ram') {
        const victim = nearestEnemy(race, car, drive.range, false);
        if (victim) car.laneTarget = victim.lane;
      }
      if (car.drive === 'ram') continue;
      // 앞이 막히면 옆으로 비키고, 틈이 없으면 앞차 속도에 맞춘다.
      let ahead = null;
      let aheadGap = Infinity;
      for (const other of active) {
        if (other === car) continue;
        const g = signedGap(race, car, other);
        if (g <= 0 || g > tr.lookAhead) continue;
        if (Math.abs(other.lane - car.lane) >= tr.carWidth) continue;
        if (other.speed >= car.speed && g > tr.followGap) continue;
        if (g < aheadGap) {
          ahead = other;
          aheadGap = g;
        }
      }
      if (!ahead) continue;
      if (!(car.drive === 'block' && car.blocking)) {
        const up = ahead.lane + tr.passOffset;
        const down = ahead.lane - tr.passOffset;
        const upOk = up <= track.laneMax;
        const downOk = down >= -track.laneMax;
        if (upOk && downOk) car.laneTarget = Math.abs(up - car.laneTarget) < Math.abs(down - car.laneTarget) ? up : down;
        else if (upOk) car.laneTarget = up;
        else if (downOk) car.laneTarget = down;
      }
      if (aheadGap < tr.followGap && Math.abs(ahead.lane - car.lane) < tr.carWidth * 0.8) car.speedCap = Math.max(ahead.speed, 40);
    }
    // 옆으로 움직인다. 정비 중인 차는 트랙 줄을 그대로 둔다.
    for (const car of active) {
      const want = Math.max(-track.laneMax, Math.min(track.laneMax, car.laneTarget));
      const step = tr.lateralSpeed * STEP;
      const move = Math.max(-step, Math.min(step, want - car.lane));
      // 바로 옆에 차가 있으면 그쪽으로 파고들지 않는다. 들이받을 때만 예외.
      const beside = car.drive !== 'ram' && active.some((other) => other !== car
        && Math.abs(signedGap(race, car, other)) < c.gap + 6
        && Math.sign(other.lane - car.lane) === Math.sign(move)
        && Math.abs(other.lane - car.lane) < c.lane + 3);
      if (!beside) car.lane += move;
      car.lane += car.pushV * STEP;
      car.pushV *= Math.max(0, 1 - c.pushDecay * STEP);
      if (Math.abs(car.lane) > track.wall) {
        car.lane = Math.sign(car.lane) * track.wall;
        car.pushV = 0;
        car.speed *= tr.wallSpeed;
        if (car.wallCd <= 0) {
          car.wallCd = 0.4;
          race.counts.wall++;
          if (race.fx) race.fx.push({ kind: 'wall', car: car.id });
        }
      }
    }
    if (race.qual) return; // 예선에는 충돌이 없다
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i];
        const b = active[j];
        if (a.crashCd > 0 || b.crashCd > 0) continue;
        const g = signedGap(race, a, b);
        if (Math.abs(g) < c.gap && Math.abs(a.lane - b.lane) < c.lane) crash(race, a, b, g);
      }
    }
  }

  function canShield(race, car) {
    const s = race.data.combat.shield;
    return car.finishTime === null && !car.pitPhase && car.shieldCd <= 0 && car.energy >= s.cost;
  }

  function activateShield(race, carId) {
    const car = race.cars[carId];
    if (!canShield(race, car)) return;
    const s = race.data.combat.shield;
    car.energy -= s.cost;
    car.shieldLeft = s.time;
    car.shieldCd = s.cooldown - car.build.shieldSave;
    if (race.fx) race.fx.push({ kind: 'shield', car: car.id });
  }

  function findTarget(race, car, weapon) {
    const { track } = race;
    const mate = race.cars.find((c) => c.team === car.team && c !== car);
    let best = null;
    let bestScore = Infinity;
    for (const other of race.cars) {
      if (other.team === car.team || other.finishTime !== null || other.pitPhase) continue;
      const ahead = (((other.dist - car.dist) % track.length) + track.length) % track.length;
      const gap = weapon.dir === 'ahead' ? ahead : Math.min(ahead, track.length - ahead);
      if (gap <= 4 || gap > weapon.range) continue;
      // AI는 앞서가는 같은 팀 차를 쫓는 적을 먼저 노린다.
      const chasingMate = !car.manual && (((mate.dist - other.dist) % track.length) + track.length) % track.length < 60;
      const score = chasingMate ? gap - 40 : gap;
      if (score < bestScore) {
        best = other;
        bestScore = score;
      }
    }
    return best;
  }

  function applyImpact(race, shot) {
    const combat = race.data.combat;
    const target = race.cars[shot.target];
    const weapon = race.cars[shot.shooter].build.weapon;
    if (target.finishTime !== null || target.pitPhase) return;
    if (!shot.hit) {
      if (race.fx) race.fx.push({ kind: 'miss', weapon: weapon.kind, target: target.id });
      return;
    }
    const shielded = target.shieldLeft > 0;
    const factor = (shielded ? combat.shield.damage : 1) * (1 - target.build.armor);
    if (target.rebootLeft <= 0) target.meter = Math.min(100, target.meter + weapon.damage * factor);
    target.stagger = shielded ? target.stagger : combat.staggerTime;
    if (weapon.energyDrain) target.energy = Math.max(0, target.energy - weapon.energyDrain * factor);
    if (race.fx) race.fx.push({ kind: 'hit', weapon: weapon.kind, shooter: shot.shooter, target: target.id, shielded });
    if (target.meter >= combat.reboot.at && target.rebootLeft <= 0) {
      target.rebootLeft = combat.reboot.time;
      if (race.fx) race.fx.push({ kind: 'reboot', car: target.id });
      say(race, target, '재부팅!');
    }
  }

  function combatStep(race) {
    const combat = race.data.combat;
    race.impacts = race.impacts.filter((shot) => {
      if (shot.at > race.time) return true;
      applyImpact(race, shot);
      return false;
    });
    for (const car of race.cars) {
      car.fireCd = Math.max(0, car.fireCd - STEP);
      if (car.finishTime === null && !car.pitPhase) car.energy = Math.min(car.build.maxEnergy, car.energy + car.build.regen * STEP);
      car.stagger = Math.max(0, car.stagger - STEP);
      car.shieldLeft = Math.max(0, car.shieldLeft - STEP);
      car.shieldCd = Math.max(0, car.shieldCd - STEP);
      car.meter = Math.max(0, car.meter - combat.meterDecay * (car.shieldLeft > 0 ? combat.shield.decayBoost : 1) * STEP);
      if (car.rebootLeft > 0) {
        car.rebootLeft -= STEP;
        if (car.rebootLeft <= 0) car.meter = combat.reboot.meterAfter;
      }
      if (car.finishTime !== null || car.pitPhase) continue;
      if (!car.manual) {
        car.aiTimer -= STEP;
        if (car.aiTimer <= 0) {
          car.aiTimer = 0.5;
          aiThink(race, car);
        }
      }
      const weapon = car.build.weapon;
      if (race.time < race.data.traffic.crash.startGrace || !car.fireOn || car.rebootLeft > 0 || car.fireCd > 0 || car.energy < weapon.cost) continue;
      const target = findTarget(race, car, weapon);
      if (!target) continue;
      car.fireCd = weapon.cooldown;
      car.energy -= weapon.cost;
      const hit = race.rng() < weapon.accuracy;
      race.impacts.push({ at: race.time + weapon.flight, shooter: car.id, target: target.id, hit });
      if (race.fx) race.fx.push({ kind: 'shot', weapon: weapon.kind, shooter: car.id, target: target.id, hit, flight: weapon.flight });
      if (weapon.kind === 'missile' && target.manual) say(race, car, `미사일 → ${target.driver}`);
    }
  }

  // 정비 도로로 옮겨 간 정도. 0이면 트랙 위, 1이면 정비 도로 위.
  function pitRamp(pit, d) {
    const clamp = (v) => Math.max(0, Math.min(1, v));
    return clamp((d - pit.entry) / pit.ramp) * clamp((pit.exit - d) / pit.ramp);
  }

  function lapEnergy(race, car) {
    return race.drainPerLap * race.data.orders[car.order].drain * race.data.fuels[car.fuel].drain * car.build.drain * car.saveMul;
  }

  function say(race, car, text) {
    if (!race.fx) return;
    race.news.push({ time: race.time, color: car.team.color, text: `${car.team.name} ${car.driver} ${text}` });
    if (race.news.length > 6) race.news.shift();
  }

  function gapToNext(race, car) {
    const { track } = race;
    let best = Infinity;
    for (const other of race.cars) {
      if (other === car || other.pitPhase || other.finishTime !== null) continue;
      const gap = (((other.dist - car.dist) % track.length) + track.length) % track.length;
      if (gap < best) best = gap;
    }
    return best;
  }

  // 남은 바퀴를 보고 연료를 고른다. 한 통으로 끝낼 수 있으면 빠른 연료, 아니면 성격대로.
  function chooseFuel(race, car, remaining) {
    const { fuels, ai } = race.data;
    const fastNeed = remaining * race.drainPerLap * fuels.fast.drain;
    if (fastNeed * car.build.drain <= car.build.maxEnergy * 0.95) return 'fast';
    return race.rng() < ai[car.team.style].fastFuel ? 'fast' : 'long';
  }

  // 출발선을 지날 때 이번 바퀴에 정비할지 정한다. 정비소 입구가 출발선 바로 뒤에 있다.
  function aiThinkAtLine(race, car) {
    const p = race.data.ai[car.team.style];
    const common = race.data.ai.common;
    const need = lapEnergy(race, car);
    const remaining = race.laps - car.lapsDone;
    const saveNeed = remaining * race.drainPerLap * race.data.orders.save.drain * race.data.fuels[car.fuel].drain * car.build.drain;
    if (car.energy >= saveNeed) return; // 아끼면 끝까지 갈 수 있다
    const mate = race.cars.find((c) => c.team === car.team && c !== car);
    const mateBusy = mate.pitPhase || mate.pitRequested;
    const low = car.energy - need < car.pitBelow;
    const undercut = p.undercut > 0 && car.energy < p.undercut && gapToNext(race, car) < common.undercutGap;
    // 같은 팀이 정비 중이면 한 바퀴 더 버틸 수 있을 때 미룬다.
    if (mateBusy && car.energy - need > 3) return;
    if (low || undercut) {
      car.pitRequested = true;
      car.nextFuel = chooseFuel(race, car, remaining);
      say(race, car, `정비 · ${race.data.fuels[car.nextFuel].name}`);
    }
  }

  // 지시와 사격, 방어막을 0.5초마다 판단한다.
  function aiThink(race, car) {
    const { orders, fuels, ai } = race.data;
    const p = ai[car.team.style];
    const remaining = race.laps - car.lapsDone;
    const progress = car.lapsDone / race.laps;
    const enough = (o) => car.energy >= remaining * race.drainPerLap * orders[o].drain * fuels[car.fuel].drain * car.build.drain;
    const gap = gapToNext(race, car);
    let order = 'normal';
    if (enough('normal')) {
      if ((progress >= p.pushFrom || gap < p.pushGap) && enough('push')) order = 'push';
    } else if (enough('save')) {
      order = 'save';
    } else if (progress < p.pushUntil) {
      order = 'push';
    } else if (gap < p.pushGap && car.energy > ai.common.pushEnergy) {
      order = 'push';
    } else if (p.baseSave && progress < 0.4) {
      order = 'save';
    }
    // 주행 방식. 무거운 팀은 들이받고, 앞서는 같은 팀 차가 있으면 뒤차가 막아 준다.
    const mate = race.cars.find((c) => c.team === car.team && c !== car);
    const mateAhead = mate.finishTime === null && !mate.pitPhase && signedGap(race, car, mate) > 0 && signedGap(race, car, mate) < 150;
    if (p.ram) car.drive = 'ram';
    else if (p.block && mateAhead) car.drive = 'block';
    else car.drive = 'normal';
    if (order === 'push' && car.order !== 'push' && progress >= p.pushFrom) say(race, car, '막판 스퍼트');
    car.order = order;
    car.fireOn = car.energy > p.fireAbove;
    const missileComing = race.impacts.some((s) => s.target === car.id && s.hit && race.cars[s.shooter].build.weapon.kind === 'missile');
    if ((missileComing || car.meter >= p.shieldAt) && car.energy > ai.common.shieldEnergy) activateShield(race, car.id);
  }

  function isSlipping(race, car) {
    const { track } = race;
    const range = race.data.energy.slipRange;
    return race.cars.some((other) => {
      if (other === car || other.finishTime !== null || other.pitPhase) return false;
      const gap = (((other.dist - car.dist) % track.length) + track.length) % track.length;
      return gap > 6 && gap <= range;
    });
  }

  // 정비소 안에서의 목표 속도를 정한다. 멈춰서 정비 중이면 null.
  function pitTarget(race, car, d, target) {
    const pit = race.pit;
    if (car.pitPhase === 'garage') {
      car.speed = 0;
      return null;
    }
    if (car.pitPhase === 'out') {
      if (d >= pit.exit) car.pitPhase = null;
      return Math.min(target, pit.speed);
    }
    if (race.qual) {
      const spot = qualSpot(race, car);
      if (d >= spot - 0.5) {
        car.pitPhase = 'garage';
        car.qualState = 'ready';
        car.speed = 0;
        car.qualPlan = race.time + race.rng() * 2;
        return null;
      }
      return Math.min(target, pit.speed, Math.sqrt(2 * race.phys.brake * (spot - d)));
    }
    const teamIndex = race.data.teams.indexOf(car.team);
    const box = pit.firstBox + pit.boxGap * teamIndex;
    if (car.pitPhase === 'service') {
      car.speed = 0;
      car.pitLeft -= STEP;
      car.energy = Math.min(car.build.maxEnergy, car.energy + pit.fillPerSec * STEP);
      if (car.pitLeft <= 0) {
        car.energy = car.build.maxEnergy;
        car.pitPhase = 'out';
        race.pitBusy[car.team.id] = null;
      }
      return null;
    }
    // 먼저 들어온 차가 칸을 맡아 둬야 뒤차가 겹치지 않고 뒤에서 기다린다.
    if (race.pitBusy[car.team.id] === undefined || race.pitBusy[car.team.id] === null) race.pitBusy[car.team.id] = car.id;
    const occupied = race.pitBusy[car.team.id] !== car.id;
    if (!occupied && d >= box - 0.5) {
      car.pitPhase = 'service';
      car.fuel = car.nextFuel;
      car.pitLeft = Math.max(0.1, pit.baseTime - car.build.pitSave) + (car.build.maxEnergy - car.energy) / pit.fillPerSec;
      car.speed = 0;
      return null;
    }
    const stopAt = occupied ? Math.max(box - pit.waitGap, d) : box;
    const room = stopAt - d;
    if (room <= 0.5) return 0;
    return Math.min(target, pit.speed, Math.sqrt(2 * race.phys.brake * room));
  }

  // 안정성이 낮을수록 바퀴마다 컨디션이 크게 흔들린다.
  function rollSwing(race, car) {
    const stat = car.build.stability;
    const size = Math.max(0, race.phys.lapSwingBase - race.phys.lapSwingPerStat * stat) * car.calmMul;
    const g = (race.rng() + race.rng() + race.rng()) / 1.5 - 1;
    car.swing = car.form * (1 + g * size);
  }

  function stepRace(race) {
    if (race.over) return;
    race.time += STEP;
    const { track, phys, data, pit } = race;
    trafficStep(race);
    for (const car of race.cars) {
      const p = car.profile;
      const d = ((car.dist % track.length) + track.length) % track.length;
      const idx = Math.floor(d / SAMPLE) % track.count;
      const order = data.orders[car.order];
      const fuel = data.fuels[car.fuel];
      let scale = car.swing * car.paceMul;
      if (car.finishTime !== null) {
        scale *= phys.afterFinishSpeed;
      } else {
        scale *= order.speed * fuel.speed * car.build.speedMod;
        if (!car.slipping) scale *= data.traffic.cleanAir;
        if (race.qual) {
          const q = data.qualifying;
          const mode = q.modes[car.qualMode];
          if (car.qualState !== 'flying') scale *= q.outSpeed;
          else {
            scale /= mode.time;
            if (car.qualMiss) scale *= 1 - mode.lose;
            if (car.slipping) scale *= q.tow;
          }
        }
        if (car.energy < 1) scale *= data.energy.emptySpeed; // 회복분으로 바닥을 피하지 못하게 1 미만이면 바닥으로 본다
        scale *= 1 - car.meter * data.combat.slowPerMeter;
        if (car.stagger > 0) scale *= data.combat.staggerSpeed;
        if (car.rebootLeft > 0) scale *= data.combat.reboot.speed;
        if (car.drive === 'block' && car.blocking) scale *= data.drives.block.speed;
      }
      // 안쪽은 달릴 거리가 짧지만 코너 한계 속도가 낮고, 바깥쪽은 그 반대다.
      const onTrack = !car.pitPhase && car.finishTime === null;
      const lineK = onTrack ? 1 - car.lane * track.curve[idx] * data.traffic.lineEffect : 1;
      let target = Math.min(p.limit[idx] * scale * Math.sqrt(lineK), p.top * scale);
      if (onTrack) target = Math.min(target, car.speedCap);
      const top = p.top * scale;
      if (car.pitPhase) {
        target = pitTarget(race, car, d, target);
        if (target === null) continue;
      }
      if (car.speed < target) {
        car.speed = Math.min(target, car.speed + p.accel * Math.max(0.1, 1 - car.speed / top) * STEP);
      } else {
        car.speed = Math.max(target, car.speed - phys.brake * STEP);
      }
      const before = car.dist;
      const move = (car.speed * STEP) / lineK;
      car.dist += move;

      car.slipping = false;
      if (car.finishTime === null && !car.pitPhase) {
        car.slipping = isSlipping(race, car);
        const drain = race.drainPerLap * order.drain * fuel.drain * car.build.drain * car.saveMul * (car.slipping ? data.energy.slipDrain : 1);
        if (!race.qual) car.energy = Math.max(0, car.energy - (move * drain) / track.length);
        const after = d + move;
        if (car.pitRequested && d < pit.entry && after >= pit.entry) {
          car.pitRequested = false;
          car.pitPhase = 'in';
        }
      }

      const crossed = Math.floor(car.dist / track.length);
      if (crossed > Math.floor(before / track.length)) {
        if (race.qual) {
          qualLine(race, car);
        } else if (crossed === 0) {
          car.lapStart = race.time;
        } else if (car.finishTime === null) {
          car.lastLap = race.time - car.lapStart;
          car.bestLap = car.bestLap === null ? car.lastLap : Math.min(car.bestLap, car.lastLap);
          car.lapStart = race.time;
          car.lapsDone = crossed;
          rollSwing(race, car);
          if (crossed >= race.laps) {
            car.finishTime = race.time;
            car.pitRequested = false;
          } else if (!car.manual) {
            aiThinkAtLine(race, car);
          }
        }
      }
    }
    if (race.qual) {
      qualThink(race);
      qualEnd(race);
      return;
    }
    combatStep(race);
    if (race.cars.every((c) => c.finishTime !== null)) race.over = true;
  }

  function standings(race) {
    return [...race.cars].sort((a, b) => {
      if (a.finishTime !== null && b.finishTime !== null) return a.finishTime - b.finishTime;
      if (a.finishTime !== null) return -1;
      if (b.finishTime !== null) return 1;
      return b.dist - a.dist;
    });
  }

  // 지금 정비하러 들어가면 몇 위로 나오는지 어림한다. 다른 차의 정비는 셈하지 않는다.
  function pitForecast(race, car) {
    const p = race.pit;
    const avg = car.profile.top * 0.8;
    const span = p.exit - p.entry;
    const loss = span / p.speed - span / avg + p.baseTime + (car.build.maxEnergy - car.energy) / p.fillPerSec;
    const after = car.dist - loss * avg;
    return { rank: 1 + race.cars.filter((c) => c !== car && c.dist > after).length, loss };
  }

  // 빈 트랙에서 한 바퀴 기록. 두 바퀴째를 재서 출발 가속을 뺀다.
  function cleanLap(profile, track) {
    let v = profile.limit[0];
    let time = 0;
    for (let lap = 0; lap < 2; lap++) {
      time = 0;
      for (let i = 0; i < track.count; i++) {
        const gain = profile.accel * Math.max(0.1, 1 - v / profile.top);
        v = Math.min(profile.limit[(i + 1) % track.count], Math.sqrt(v * v + 2 * gain * SAMPLE));
        time += SAMPLE / v;
      }
    }
    return time;
  }

  // 예선 한 단계. 차들은 정비소에 서 있다가 나가서 준비 바퀴 뒤 한 바퀴 기록을 잰다.
  function createQualStage(data, trackId, seed, loadouts, entrants, options = {}) {
    const race = createRace(data, seed, { ...options, trackId, loadouts, entrants, laps: 1, mixAi: false });
    const q = data.qualifying;
    const lap = cleanLap(race.cars[0].profile, race.track);
    race.qual = { lap, duration: lap * q.stageLaps };
    const modes = options.modes || {};
    race.cars.forEach((car) => {
      car.pitPhase = 'garage';
      car.dist = qualSpot(race, car);
      car.qualState = 'ready';
      car.qualBest = null;
      car.qualLast = null;
      car.qualMiss = false;
      car.qualMode = modes[car.team.id] || (race.rng() < q.aiAttack ? 'attack' : 'safe');
      car.qualPlan = race.rng() * race.qual.duration * 0.3;
    });
    return race;
  }

  // 같은 팀 두 대는 칸 앞뒤로 나란히 선다.
  function qualSpot(race, car) {
    const p = race.pit;
    return p.firstBox + p.boxGap * race.data.teams.indexOf(car.team) - p.waitGap * car.team.drivers.indexOf(car.driver);
  }

  function releaseCar(race, carId) {
    const car = race.cars[carId];
    if (car.pitPhase !== 'garage' || race.over) return;
    car.pitPhase = 'out';
    car.qualState = 'out';
  }

  function setQualMode(race, carId, mode) {
    race.cars[carId].qualMode = mode;
  }

  // 출발선을 지날 때. 준비 바퀴면 기록을 시작하고, 기록 중이었으면 재고 들어온다.
  function qualLine(race, car) {
    const over = ((car.dist % race.track.length) + race.track.length) % race.track.length;
    const at = race.time - over / Math.max(1, car.speed);
    const q = race.data.qualifying;
    if (car.qualState === 'flying') {
      car.qualLast = at - car.lapStart;
      if (car.qualBest === null || car.qualLast < car.qualBest) car.qualBest = car.qualLast;
      if (race.fx) say(race, car, `기록 ${car.qualLast.toFixed(3)}`);
      car.qualState = 'in';
      car.pitRequested = true;
    } else if (race.time >= race.qual.duration) {
      car.qualState = 'in'; // 시간이 끝나면 새 기록을 시작할 수 없다
      car.pitRequested = true;
    } else {
      car.qualState = 'flying';
      car.lapStart = at;
      car.qualMiss = race.rng() < q.modes[car.qualMode].mistake * car.build.mistake;
      rollSwing(race, car);
    }
  }

  // 컴퓨터 차를 내보낸다. 늦어서 기록을 못 낼 때는 나가지 않는다.
  function qualThink(race) {
    for (const car of race.cars) {
      if (car.manual || car.pitPhase !== 'garage') continue;
      if (race.time >= car.qualPlan && race.time <= race.qual.duration - race.qual.lap * 1.05) releaseCar(race, car.id);
    }
  }

  function qualEnd(race) {
    race.over = race.time >= race.qual.duration && race.cars.every((c) => c.qualState !== 'flying');
  }

  function qualRows(data) {
    return data.teams.flatMap((team) => team.drivers.map((driver) => ({ driver, team, times: [], time: null })));
  }

  // 이번 단계에 달릴 차. 앞 단계 순서대로 정해진 대수까지.
  function qualEntrants(data, rows, stage) {
    return stage === 0 ? rows.map((r) => r.driver) : rows.slice(0, data.qualifying.cut[stage - 1]).map((r) => r.driver);
  }

  // 단계가 끝나면 기록을 옮겨 적고 순서를 다시 매긴다. 멀리 간 차가 앞, 그다음 그 단계 기록순.
  function qualApply(rows, race, stage) {
    for (const car of race.cars) {
      const row = rows.find((r) => r.driver === car.driver);
      row.times[stage] = car.qualBest;
      row.time = car.qualBest;
    }
    const best = (r) => (r.time === null ? Infinity : r.time);
    rows.sort((a, b) => b.times.length - a.times.length || best(a) - best(b));
  }

  // 화면 없이 예선을 끝까지 돌린다. modes는 팀별 안전·공격 선택.
  function qualify(data, trackId, seed, loadouts, modes = {}, skills = {}) {
    const rows = qualRows(data);
    for (let stage = 0; stage <= data.qualifying.cut.length; stage++) {
      const race = createQualStage(data, trackId, seed + stage * 7, loadouts, qualEntrants(data, rows, stage), { modes, skills });
      while (!race.over) stepRace(race);
      qualApply(rows, race, stage);
    }
    return rows;
  }

  const Sim = { STEP, SAMPLE, createRace, stepRace, standings, buildTrack, setOrder, requestPit, setNextFuel, setFire, setDrive, activateShield, computeBuild, pureLoadout, canShield, pitRamp, lapEnergy, pitForecast, qualify, createQualStage, releaseCar, setQualMode, qualRows, qualEntrants, qualApply, aiLoadout, mulberry32 };
  root.HoverSim = Sim;
  if (typeof module !== 'undefined') module.exports = Sim;
})(typeof globalThis !== 'undefined' ? globalThis : this);
