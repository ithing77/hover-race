// 트랙과 차를 그린다. 경주 계산 값을 읽기만 하고 바꾸지 않는다.
(function (root) {
  const CAR_SCALE = 0.14;
  const MAX_SPARKS = 500;

  function trailStyle(kind, color, speedRatio) {
    const base = { color, alpha: 0.55, width: 1.6, offsets: [0], length: 46 * speedRatio, dash: null };
    if (kind === 'twin') return { ...base, offsets: [-3, 3] };
    if (kind === 'wide') return { ...base, width: 9, alpha: 0.22 };
    if (kind === 'dash') return { ...base, width: 2, dash: [6, 8], alpha: 0.8 };
    if (kind === 'split') return { ...base, offsets: [-6, 6], width: 1.8 };
    return { ...base, width: 6, alpha: 0.45, length: 22 * speedRatio }; // thick
  }

  function createRenderer(canvas, race) {
    const ctx = canvas.getContext('2d');
    const { track } = race;
    // 차 모양은 팀마다 조합이 달라서 팀별로 만들어 둔다.
    const shapes = {};
    for (const car of race.cars) shapes[car.team.id] = shapes[car.team.id] || HoverArt.carShapes(car.loadout);
    // 트랙마다 크기가 달라서 도로와 정비소가 다 들어오게 화면 범위를 잡는다.
    const VIEW = (() => {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      const add = (x, y, m) => {
        x0 = Math.min(x0, x - m);
        y0 = Math.min(y0, y - m);
        x1 = Math.max(x1, x + m);
        y1 = Math.max(y1, y + m);
      };
      for (const [x, y] of track.points) add(x, y, track.width / 2 + 24);
      for (let d = race.pit.entry; d <= race.pit.exit; d += 10) {
        const p = pointAt(d, race.pit.lane);
        add(p.x, p.y, 38);
      }
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    })();
    let backdrop = null;
    let scale = 1;
    let offX = 0;
    let offY = 0;
    let dpr = 1;
    const sparks = [];
    const smokes = [];
    const flashes = [];
    const rings = [];
    const tracers = [];
    const bolts = [];
    const missiles = [];
    const hurt = {};
    let shake = 0;
    let gameSpeed = 1;
    const speedNow = () => gameSpeed;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      dpr = root.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      scale = Math.min(canvas.width / VIEW.w, canvas.height / VIEW.h);
      offX = (canvas.width - VIEW.w * scale) / 2 - VIEW.x * scale;
      offY = (canvas.height - VIEW.h * scale) / 2 - VIEW.y * scale;
      backdrop = drawBackdrop();
    }

    function traceTrack(c) {
      c.beginPath();
      track.points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.closePath();
    }

    // 트랙은 변하지 않으니 한 번만 그려 둔다.
    function drawBackdrop() {
      const off = document.createElement('canvas');
      off.width = canvas.width;
      off.height = canvas.height;
      const c = off.getContext('2d');
      c.setTransform(scale, 0, 0, scale, offX, offY);
      c.lineJoin = 'round';
      traceTrack(c);
      c.shadowColor = '#5B4BFF';
      c.shadowBlur = 12 * scale;
      c.strokeStyle = '#5B4BFF';
      c.lineWidth = track.width + 4;
      c.stroke();
      c.shadowBlur = 0;
      traceTrack(c);
      c.strokeStyle = '#0C1226';
      c.lineWidth = track.width;
      c.stroke();
      traceTrack(c);
      c.strokeStyle = '#2A3658';
      c.lineWidth = 1;
      c.setLineDash([8, 12]);
      c.stroke();
      c.setLineDash([]);
      drawPitLane(c);

      // 출발선은 트랙 진행 방향에 수직으로 긋는다.
      const [ax, ay] = track.points[0];
      const [bx, by] = track.points[3];
      const len = Math.hypot(bx - ax, by - ay);
      const nx = -(by - ay) / len;
      const ny = (bx - ax) / len;
      c.strokeStyle = '#FFFFFF';
      c.lineWidth = 4;
      c.setLineDash([4, 4]);
      c.beginPath();
      c.moveTo(ax + (nx * track.width) / 2, ay + (ny * track.width) / 2);
      c.lineTo(ax - (nx * track.width) / 2, ay - (ny * track.width) / 2);
      c.stroke();
      c.setLineDash([]);

      c.font = "700 14px 'Chakra Petch', sans-serif";
      c.fillStyle = '#93A3C4';
      c.textAlign = 'center';
      cornerLabels().forEach((label, i) => c.fillText(i + 1, label.x, label.y + 5));
      c.font = "700 11px 'Noto Sans KR', sans-serif";
      c.fillStyle = '#E8EEFA';
      const startLabel = pointAt(0, track.width / 2 + 13);
      c.fillText('출발선', startLabel.x, startLabel.y + 4);
      c.textAlign = 'left';
      return off;
    }

    // 코너마다 바깥쪽에 번호를 적는다.
    function cornerLabels() {
      const labels = [];
      let tight = null;
      for (let i = 0; i <= track.count; i++) {
        const k = i % track.count;
        const inCorner = track.radius[k] < 150 && i < track.count;
        if (inCorner && (!tight || track.radius[k] < tight.r)) tight = { r: track.radius[k], i: k, sign: Math.sign(track.curve[k]) };
        if (!inCorner && tight) {
          const p = pointAt(tight.i * HoverSim.SAMPLE, -tight.sign * (track.width / 2 + 13));
          labels.push(p);
          tight = null;
        }
      }
      return labels;
    }

    function drawPitLane(c) {
      const pit = race.pit;
      const trace = () => {
        c.beginPath();
        for (let d = pit.entry; d <= pit.exit; d += 4) {
          const p = pointAt(d, pit.lane * HoverSim.pitRamp(pit, d));
          if (d === pit.entry) c.moveTo(p.x, p.y);
          else c.lineTo(p.x, p.y);
        }
      };
      trace();
      c.strokeStyle = '#5B4BFF';
      c.lineWidth = 28;
      c.stroke();
      trace();
      c.strokeStyle = '#0C1226';
      c.lineWidth = 26;
      c.stroke();
      c.textAlign = 'center';
      race.data.teams.forEach((team, i) => {
        const box = pit.firstBox + pit.boxGap * i;
        const p = pointAt(box, pit.lane);
        c.save();
        c.translate(p.x, p.y);
        c.rotate(p.angle);
        c.fillStyle = team.color + '44';
        c.strokeStyle = team.color;
        c.lineWidth = 1.5;
        c.fillRect(-19, -17, 38, 34);
        c.strokeRect(-19, -17, 38, 34);
        c.restore();
        const name = pointAt(box, pit.lane - 26);
        c.font = "700 10px 'Chakra Petch', sans-serif";
        c.fillStyle = team.color;
        c.fillText(team.name, name.x, name.y + 3);
      });
      c.textAlign = 'left';
    }

    function laneOf(car) {
      if (!car.pitPhase) return car.lane;
      const pit = race.pit;
      const d = ((car.dist % track.length) + track.length) % track.length;
      const r = HoverSim.pitRamp(pit, d);
      return car.lane * (1 - r) + pit.lane * r;
    }

    function pointAt(dist, lane) {
      const n = track.count;
      const f = ((dist % track.length) + track.length) % track.length;
      const pos = f / HoverSim.SAMPLE;
      const i = Math.floor(pos) % n;
      const a = track.points[i];
      const b = track.points[(i + 1) % n];
      const t = pos - Math.floor(pos);
      // 방향은 몇 칸 앞뒤로 재서 코너에서 차가 떨리지 않게 한다.
      const p0 = track.points[(i - 3 + n) % n];
      const p1 = track.points[(i + 4) % n];
      const dx = p1[0] - p0[0];
      const dy = p1[1] - p0[1];
      const len = Math.hypot(dx, dy) || 1;
      return {
        x: a[0] + (b[0] - a[0]) * t - (dy / len) * lane,
        y: a[1] + (b[1] - a[1]) * t + (dx / len) * lane,
        angle: Math.atan2(dy, dx),
      };
    }

    function drawTrail(car) {
      const style = trailStyle(car.build.trail, car.team.color, Math.min(1, car.speed / car.profile.top));
      if (style.length < 2 || car.pitPhase) return;
      ctx.strokeStyle = style.color;
      ctx.globalAlpha = style.alpha;
      ctx.lineWidth = style.width;
      ctx.setLineDash(style.dash || []);
      for (const off of style.offsets) {
        ctx.beginPath();
        for (let s = 6; s <= style.length; s += 4) {
          const p = pointAt(car.dist - s, car.lane + off);
          if (s === 6) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // 전투 연출. 계산에는 영향이 없어서 여기서는 그냥 무작위를 써도 된다.
    function spawnSparks(x, y, count, colors, speed, life, dir = null) {
      for (let i = 0; i < count && sparks.length < MAX_SPARKS; i++) {
        const a = dir === null ? Math.random() * Math.PI * 2 : dir + (Math.random() - 0.5) * 1.5;
        const v = speed * (0.35 + Math.random() * 0.9);
        const l = life * (0.5 + Math.random() * 0.7);
        sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: l, max: l, color: colors[Math.floor(Math.random() * colors.length)], w: 0.8 + Math.random() * 1 });
      }
    }

    function spawnSmoke(x, y, size) {
      if (smokes.length >= 120) return;
      smokes.push({ x, y, vx: (Math.random() - 0.5) * 10, vy: (Math.random() - 0.5) * 10, life: 0.9, max: 0.9, size });
    }

    function explode(x, y, big, color) {
      flashes.push({ x, y, life: big ? 0.22 : 0.14, max: big ? 0.22 : 0.14, r: big ? 34 : 18 });
      rings.push({ x, y, life: big ? 0.45 : 0.3, max: big ? 0.45 : 0.3, r: big ? 42 : 22, color: '#FFD9A0', w: big ? 3 : 2 });
      spawnSparks(x, y, big ? 46 : 22, ['#FFFFFF', '#FFE08A', '#FF9A3C', color], big ? 170 : 120, big ? 0.7 : 0.45);
      for (let i = 0; i < (big ? 8 : 3); i++) spawnSmoke(x + (Math.random() - 0.5) * 12, y + (Math.random() - 0.5) * 12, big ? 16 : 9);
      shake = Math.max(shake, big ? 3.5 : 1.2);
    }

    function zigzag(a, b) {
      const pts = [[a.x, a.y]];
      const n = 6;
      for (let i = 1; i < n; i++) {
        const t = i / n;
        pts.push([a.x + (b.x - a.x) * t + (Math.random() - 0.5) * 10, a.y + (b.y - a.y) * t + (Math.random() - 0.5) * 10]);
      }
      pts.push([b.x, b.y]);
      return pts;
    }

    function handleEvent(e) {
      const posOf = (id) => pointAt(race.cars[id].dist, laneOf(race.cars[id]));
      if (e.kind === 'shield') {
        const p = posOf(e.car);
        rings.push({ x: p.x, y: p.y, life: 0.35, max: 0.35, r: 26, color: '#8FE9FF', w: 2 });
        return;
      }
      if (e.kind === 'reboot') {
        const p = posOf(e.car);
        rings.push({ x: p.x, y: p.y, life: 0.5, max: 0.5, r: 36, color: '#8FE9FF', w: 3 });
        spawnSparks(p.x, p.y, 34, ['#FFFFFF', '#8FE9FF', '#5B9BFF'], 130, 0.6);
        shake = Math.max(shake, 2);
        return;
      }
      if (e.kind === 'crash') {
        const a = posOf(e.a);
        const b = posOf(e.b);
        const x = (a.x + b.x) / 2;
        const y = (a.y + b.y) / 2;
        spawnSparks(x, y, e.big ? 26 : 12, ['#FFFFFF', '#FFE08A', '#FF9A3C'], e.big ? 150 : 100, e.big ? 0.45 : 0.3);
        flashes.push({ x, y, life: 0.1, max: 0.1, r: e.big ? 14 : 8 });
        hurt[e.a] = 0.08;
        hurt[e.b] = 0.08;
        shake = Math.max(shake, e.big ? 1.8 : 0.5);
        return;
      }
      if (e.kind === 'wall') {
        const car = race.cars[e.car];
        const p = posOf(e.car);
        spawnSparks(p.x, p.y, 8, ['#FFFFFF', '#FFD08A'], 80, 0.3, p.angle + Math.PI);
        // 긁힌 자리에 불꽃 줄이 잠깐 남는다.
        const from = pointAt(car.dist - 22, car.lane);
        tracers.push({ x1: from.x, y1: from.y, x2: p.x, y2: p.y, life: 0.25, max: 0.25, color: '#FFD08A' });
        return;
      }
      if (e.kind === 'shot') {
        const from = posOf(e.shooter);
        const to = posOf(e.target);
        const color = race.cars[e.shooter].team.color;
        const aim = Math.atan2(to.y - from.y, to.x - from.x);
        if (e.weapon === 'missile' || e.weapon === 'rocket') {
          missiles.push({ sx: from.x, sy: from.y, target: e.target, t: 0, dur: e.flight, big: e.weapon === 'missile', color, last: from });
          spawnSparks(from.x, from.y, 8, ['#FFFFFF', '#FFD08A'], 70, 0.25, aim + Math.PI);
        } else if (e.weapon === 'gun') {
          flashes.push({ x: from.x + Math.cos(aim) * 8, y: from.y + Math.sin(aim) * 8, life: 0.06, max: 0.06, r: 7 });
          const off = e.hit ? 0 : 14;
          const nx = -Math.sin(aim) * off * (Math.random() < 0.5 ? -1 : 1);
          const ny = Math.cos(aim) * off * (Math.random() < 0.5 ? -1 : 1);
          tracers.push({ x1: from.x, y1: from.y, x2: to.x + nx, y2: to.y + ny, life: 0.07, max: 0.07, color });
        } else if (e.hit) {
          bolts.push({ a: from, b: to, life: 0.14, max: 0.14, pts: zigzag(from, to), color });
        }
        return;
      }
      if (e.kind === 'miss') {
        const p = posOf(e.target);
        spawnSparks(p.x + (Math.random() - 0.5) * 24, p.y + (Math.random() - 0.5) * 24, 3, ['#FFD08A', '#FFFFFF'], 50, 0.2);
        return;
      }
      if (e.kind === 'hit') {
        const p = posOf(e.target);
        const away = race.cars[e.shooter];
        const color = away.team.color;
        const fromP = posOf(e.shooter);
        const dir = Math.atan2(p.y - fromP.y, p.x - fromP.x);
        if (e.shielded) {
          rings.push({ x: p.x, y: p.y, life: 0.22, max: 0.22, r: 22, color: '#8FE9FF', w: 2.5 });
          spawnSparks(p.x, p.y, 7, ['#FFFFFF', '#8FE9FF'], 90, 0.3, dir + Math.PI);
          return;
        }
        hurt[e.target] = 0.12;
        if (e.weapon === 'missile') explode(p.x, p.y, true, color);
        else if (e.weapon === 'rocket') explode(p.x, p.y, false, color);
        else if (e.weapon === 'shock') spawnSparks(p.x, p.y, 14, ['#FFFFFF', '#8FE9FF', color], 110, 0.35);
        else spawnSparks(p.x, p.y, 6, ['#FFFFFF', '#FFE08A', '#FF9A3C'], 110, 0.22, dir);
      }
    }

    function updateFx(dt) {
      if (race.fx) {
        for (const e of race.fx) handleEvent(e);
        race.fx.length = 0;
      }
      const decay = (list) => {
        for (let i = list.length - 1; i >= 0; i--) {
          list[i].life -= dt;
          if (list[i].life <= 0) list.splice(i, 1);
        }
      };
      for (const s of sparks) {
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vx *= 1 - 2.5 * dt;
        s.vy *= 1 - 2.5 * dt;
      }
      for (const s of smokes) {
        s.x += s.vx * dt;
        s.y += s.vy * dt;
      }
      for (let i = missiles.length - 1; i >= 0; i--) {
        const m = missiles[i];
        m.t += dt * speedNow();
        const tc = race.cars[m.target];
        const to = pointAt(tc.dist, laneOf(tc));
        const r = Math.min(1, m.t / m.dur);
        const e = r * r;
        m.x = m.sx + (to.x - m.sx) * e;
        m.y = m.sy + (to.y - m.sy) * e;
        spawnSmoke(m.x, m.y, m.big ? 5 : 3);
        spawnSparks(m.x, m.y, m.big ? 2 : 1, ['#FFE08A', '#FF9A3C'], 30, 0.2);
        if (r >= 1) missiles.splice(i, 1);
      }
      [sparks, smokes, flashes, rings, tracers, bolts].forEach(decay);
      for (const id of Object.keys(hurt)) {
        hurt[id] -= dt;
        if (hurt[id] <= 0) delete hurt[id];
      }
      shake = Math.max(0, shake - dt * 14);
      for (const car of race.cars) {
        if (car.finishTime !== null) continue;
        const p = pointAt(car.dist, laneOf(car));
        const smoky = car.rebootLeft > 0 || car.meter > 65;
        if (smoky && Math.random() < dt * (car.rebootLeft > 0 ? 28 : 9)) spawnSmoke(p.x, p.y, car.rebootLeft > 0 ? 9 : 6);
        if (car.rebootLeft > 0 && Math.random() < dt * 14) spawnSparks(p.x, p.y, 2, ['#FFFFFF', '#8FE9FF'], 80, 0.25);
      }
    }

    function drawShields() {
      for (const car of race.cars) {
        if (car.shieldLeft <= 0 || car.finishTime !== null) continue;
        const p = pointAt(car.dist, laneOf(car));
        const pulse = 0.3 + 0.18 * Math.sin(performance.now() / 70);
        const fade = Math.min(1, car.shieldLeft * 2);
        ctx.globalAlpha = fade * pulse;
        ctx.fillStyle = '#8FE9FF';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 17, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = fade * 0.95;
        ctx.strokeStyle = '#D5F7FF';
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    function drawFx() {
      for (const s of smokes) {
        ctx.globalAlpha = 0.28 * (s.life / s.max);
        ctx.fillStyle = '#7C879E';
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size * (1.6 - s.life / s.max), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'lighter';
      for (const t of tracers) {
        ctx.globalAlpha = t.life / t.max;
        ctx.strokeStyle = '#FFF3C4';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        const k = 0.55 + Math.random() * 0.4;
        ctx.moveTo(t.x1 + (t.x2 - t.x1) * (k - 0.4), t.y1 + (t.y2 - t.y1) * (k - 0.4));
        ctx.lineTo(t.x1 + (t.x2 - t.x1) * k, t.y1 + (t.y2 - t.y1) * k);
        ctx.stroke();
      }
      for (const b of bolts) {
        ctx.globalAlpha = b.life / b.max;
        ctx.strokeStyle = '#D5F7FF';
        ctx.lineWidth = 1.6;
        ctx.shadowColor = b.color;
        ctx.shadowBlur = 8 * scale;
        ctx.beginPath();
        b.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      for (const m of missiles) {
        if (m.x === undefined) continue;
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#FFFFFF';
        ctx.shadowColor = '#FF9A3C';
        ctx.shadowBlur = 10 * scale;
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.big ? 3 : 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      for (const s of sparks) {
        const k = s.life / s.max;
        ctx.globalAlpha = k;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.w;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x - s.vx * 0.035, s.y - s.vy * 0.035);
        ctx.stroke();
      }
      for (const f of flashes) {
        const k = f.life / f.max;
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * (1.4 - k * 0.4));
        g.addColorStop(0, '#FFFFFF');
        g.addColorStop(0.35, '#FFD08A');
        g.addColorStop(1, 'rgba(255,120,40,0)');
        ctx.globalAlpha = k;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r * 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const r of rings) {
        const k = r.life / r.max;
        ctx.globalAlpha = k;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = r.w * k + 0.3;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r * (1 - k * 0.75), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    function drawCar(car) {
      const p = pointAt(car.dist, laneOf(car));
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      // 재부팅 중에는 깜빡인다.
      if (car.rebootLeft > 0) ctx.globalAlpha = Math.sin(performance.now() / 45) > 0 ? 1 : 0.35;
      const mine = car.team.id === race.data.playerTeam;
      if (mine) {
        ctx.strokeStyle = car.team.color;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(0, 0, 18, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.scale(CAR_SCALE, CAR_SCALE);
      HoverArt.drawShapes(ctx, shapes[car.team.id], car.team.color, 7 * scale);
      // 맞은 순간 차 전체가 하얗게 번쩍인다.
      if (hurt[car.id]) {
        ctx.globalCompositeOperation = 'lighter';
        for (const part of shapes[car.team.id]) {
          ctx.fillStyle = '#FFFFFF';
          ctx.fill(part.path);
        }
      }
      ctx.restore();
    }

    function drawLabel(car) {
      const mine = car.team.id === race.data.playerTeam;
      const p = pointAt(car.dist, laneOf(car));
      ctx.font = "700 13px 'Noto Sans KR', sans-serif";
      ctx.textAlign = 'center';
      if (mine) {
        ctx.fillStyle = car.team.color;
        ctx.fillText(car.driver, p.x, p.y - 22);
      }
      if (car.rebootLeft > 0) {
        ctx.font = "700 11px 'Noto Sans KR', sans-serif";
        ctx.fillStyle = '#8FE9FF';
        ctx.fillText('재부팅', p.x, p.y + (mine ? 30 : -18));
      }
      ctx.textAlign = 'left';
    }

    function draw(dt = 0) {
      updateFx(dt);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const calm = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const sx = shake > 0 && !calm ? (Math.random() - 0.5) * shake * scale : 0;
      const sy = shake > 0 && !calm ? (Math.random() - 0.5) * shake * scale : 0;
      if (backdrop) ctx.drawImage(backdrop, sx, sy);
      ctx.setTransform(scale, 0, 0, scale, offX + sx, offY + sy);
      for (const car of race.cars) drawTrail(car);
      // 내 차를 맨 위에 그린다.
      const order = [...race.cars].sort((a, b) => (a.team.id === race.data.playerTeam) - (b.team.id === race.data.playerTeam));
      for (const car of order) drawCar(car);
      drawShields();
      drawFx();
      for (const car of order) drawLabel(car);
    }

    resize();
    return { draw, resize, setSpeed: (value) => { gameSpeed = value; } };
  }

  root.HoverRender = { createRenderer };
})(window);
