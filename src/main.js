// 경주를 돌리고 화면 글자를 갱신한다.
(function () {
  const DATA = HoverData;
  // 시험할 때 주소에 ?laps=2 를 붙이면 바퀴 수를 줄일 수 있다.
  const lapsParam = Number(new URLSearchParams(location.search).get('laps'));
  const $ = (id) => document.getElementById(id);
  let race;
  let renderer;
  let speed = 1;
  let debt = 0;
  let last = 0;
  let uiTimer = 0;
  let seed = DATA.race.seed;
  let inGarage = true;
  let player = DATA.teams.find((t) => t.id === DATA.playerTeam);
  const loadout = HoverSim.pureLoadout(player.maker);
  // 멀티에서는 모두 같은 조건으로 시작하므로 처음 값을 기억해 둔다.
  const teamDefaults = DATA.teams.map((t) => ({ name: t.name, color: t.color, drivers: [...t.drivers] }));
  let net = null; // 멀티 상태. null이면 혼자 하는 중
  const SAVE_KEY = 'hoverrace-career';
  let career = HoverCareer.create(DATA, Date.now() % 100000);
  let season = null; // 시즌 중이 아니면 자유 경주
  let trackId = DATA.tracks[0].id;
  let grid = null;
  let breakBase = null; // 휴식기가 시작될 때의 조합. 몇 개 바꿨는지 잴 때 쓴다.
  let qual = null; // 예선 진행 상태
  let recorded = false;
  let warned = {};
  let audio = null;

  const fmt = (t) => {
    const s = Math.floor(t);
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  };

  // 시즌은 한 경기가 8분이 넘어서 경기가 끝날 때마다 저장해 둔다.
  function saveSeason() {
    if (net) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ season, career, loadout, color: player.color, name: player.name }));
    } catch (e) { /* 저장을 못 해도 게임은 계속된다 */ }
  }

  function loadSeason() {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!saved) return;
      season = saved.season;
      career = saved.career;
      HoverCareer.apply(DATA, career);
      Object.assign(loadout, saved.loadout);
      setName(saved.name);
      setColor(saved.color);
    } catch (e) {
      season = null;
    }
  }

  function setName(name) {
    player.name = name || '내 팀';
    if (season) season.teams[player.id].name = player.name;
    $('brandName').textContent = player.name;
  }

  function setColor(color) {
    player.color = color;
    if (season) season.teams[player.id].color = color;
    document.documentElement.style.setProperty('--mine', color);
  }

  const currentTrack = () => (net ? (net.match ? net.match.track : net.room.track) : season ? DATA.season.calendar[season.round] : trackId);
  const trackDef = (id) => DATA.tracks.find((t) => t.id === id);
  const raceSeed = () => (net ? net.match.seed : season ? season.seed + season.round * 101 : seed);
  const manualTeams = () => (net ? net.match.manual : [DATA.playerTeam]);
  const skillsNow = () => (net ? {} : HoverCareer.skillsFor(career, currentTrack()));
  // 상대 팀은 시즌 조합에 그 팀 연구를 얹고, 내 차는 켜 둔 연구를 쓴다.
  function allLoadouts() {
    if (net) return net.match.loadouts;
    const out = {};
    if (season) for (const t of DATA.teams) out[t.id] = { ...season.loadouts[t.id], research: career.aiResearch[t.id] };
    loadout.research = career.active;
    out[DATA.playerTeam] = loadout;
    return out;
  }

  function setup() {
    recorded = false;
    warned = {};
    const laps = net ? net.match.laps : lapsParam > 0 ? lapsParam : null;
    race = HoverSim.createRace(DATA, raceSeed(), { manualTeams: manualTeams(), fx: true, trackId: currentTrack(), grid, laps, loadouts: allLoadouts(), skills: skillsNow() });
    if (net) netStageStarted('race');
    renderer = HoverRender.createRenderer($('track'), race);
    renderer.setSpeed(speed);
    debt = 0;
    $('result').hidden = true;
    $('trackName').textContent = race.track.name + (net ? ` · 친구와 대전` : season ? ` · 시즌 ${season.round + 1}/${DATA.season.calendar.length}경기` : ' · 자유 경주');
    $('lapLabel').textContent = '바퀴';
    $('clockLabel').textContent = '경과 시간';
    $('chassis').hidden = false;
    $('chassisTitle').hidden = false;
    $('restart').hidden = Boolean(season || net);
    $('toGarage').hidden = Boolean(season || net);
    $('lapTotal').textContent = race.laps;
    $('pips').style.gridTemplateColumns = `repeat(${race.laps}, minmax(0, 1fr))`;
    $('pips').innerHTML = '<div></div>'.repeat(race.laps);
    renderChassis();
    renderRadio();
    updateUi();
  }

  function myCars() {
    return race.cars.filter((c) => c.team.id === DATA.playerTeam).sort((a, b) => a.team.drivers.indexOf(a.driver) - b.team.drivers.indexOf(b.driver));
  }

  // 버튼은 경주마다 한 번만 만든다. 자주 다시 만들면 누르는 순간 사라질 수 있다.
  function renderRadio() {
    const choices = (kind, id, table) => Object.entries(table).map(([key, v]) =>
      `<button type="button" data-${kind}="${key}" data-car="${id}">${v.name}</button>`).join('');
    $('radio').innerHTML = myCars().map((car) => `
      <div class="radio-car" data-card="${car.id}">
        <div class="radio-head"><span class="chip" style="background:${car.team.color}"></span>${car.driver}<span class="pos"></span></div>
        <div class="energy"><i style="background:${car.team.color}"></i></div>
        <div class="radio-note"><span class="left-text"></span><span class="state-text"></span></div>
        <div class="radio-call"></div>
        <div class="radio-fore"></div>
        <div class="choices three">${choices('order', car.id, DATA.orders)}</div>
        <div class="choices three">${choices('drive', car.id, DATA.drives)}</div>
        <button type="button" class="pit-btn" data-pit="${car.id}"></button>
        <div class="choice-label">${car.build.weapon.name}</div>
        <div class="choices three">
          <button type="button" data-fire="on" data-car="${car.id}">쏴</button>
          <button type="button" data-fire="off" data-car="${car.id}">쏘지 마</button>
          <button type="button" class="shield-btn" data-shield="${car.id}"></button>
        </div>
        <div class="meter"><i></i></div>
        <div class="radio-note"><span class="meter-text"></span></div>
        <div class="choice-label">다음 정비 때 넣을 연료</div>
        <div class="choices two">${choices('fuel', car.id, DATA.fuels)}</div>
      </div>`).join('');
  }

  function updateRadio(order) {
    for (const car of myCars()) {
      const card = document.querySelector(`[data-card="${car.id}"]`);
      if (!card) continue; // 멀티에서 내 팀이 정해지기 전의 경주
      card.querySelector('.pos').textContent = order.indexOf(car) + 1 + '위';
      const bar = card.querySelector('.energy i');
      bar.style.width = (car.energy / car.build.maxEnergy) * 100 + '%';
      bar.style.background = car.energy < 15 ? '#FF5B5B' : car.team.color;
      const laps = car.energy / HoverSim.lapEnergy(race, car);
      card.querySelector('.left-text').textContent = `지금 페이스로 ${laps.toFixed(1)}바퀴`;
      updateEngineer(car, card, laps);
      const state = car.finishTime !== null ? '완주'
        : car.pitPhase === 'service' ? `정비 중 ${Math.max(0, car.pitLeft).toFixed(1)}초`
        : car.pitPhase === 'in' ? '정비소로'
        : car.pitPhase === 'out' ? '복귀 중'
        : car.rebootLeft > 0 ? `재부팅 ${car.rebootLeft.toFixed(1)}초`
        : car.energy <= 0 ? '에너지 없음'
        : car.slipping ? '앞차 뒤 절약 중' : DATA.fuels[car.fuel].name;
      card.querySelector('.state-text').textContent = state;
      card.querySelectorAll('[data-order]').forEach((b) => b.classList.toggle('on', b.dataset.order === car.order));
      card.querySelectorAll('[data-drive]').forEach((b) => b.classList.toggle('on', b.dataset.drive === car.drive));
      card.querySelectorAll('[data-fuel]').forEach((b) => b.classList.toggle('on', b.dataset.fuel === car.nextFuel));
      card.querySelectorAll('[data-fire]').forEach((b) => b.classList.toggle('on', (b.dataset.fire === 'on') === car.fireOn));
      const shield = card.querySelector('.shield-btn');
      shield.disabled = !HoverSim.canShield(race, car);
      shield.classList.toggle('on', car.shieldLeft > 0);
      shield.textContent = car.shieldLeft > 0 ? `방어 ${car.shieldLeft.toFixed(1)}`
        : car.shieldCd > 0 ? `충전 ${Math.ceil(car.shieldCd)}초` : '방어막';
      const meter = card.querySelector('.meter i');
      meter.style.width = car.meter + '%';
      meter.style.background = car.meter > 70 ? '#FF5B5B' : '#FF9A3C';
      card.querySelector('.meter-text').textContent = `충격 ${Math.round(car.meter)} · 100이 되면 재부팅`;
      const pit = card.querySelector('.pit-btn');
      pit.disabled = car.finishTime !== null || car.pitPhase !== null;
      pit.classList.toggle('on', car.pitRequested);
      pit.textContent = car.pitRequested ? '다음 바퀴 정비 · 누르면 취소' : '들어와';
    }
  }

  // 엔지니어 무전. 알려만 주고 들어올지는 감독이 정한다.
  function updateEngineer(car, card, can) {
    const call = card.querySelector('.radio-call');
    const fore = card.querySelector('.radio-fore');
    const left = race.laps - car.dist / race.track.length;
    const busy = car.finishTime !== null || car.pitPhase !== null;
    const short = can < left;
    const danger = !busy && short && can < 1.5 && !car.pitRequested;
    let text = '';
    if (car.finishTime !== null) text = '';
    else if (car.pitPhase) text = '좋아, 정비 맡겨 둬';
    else if (car.pitRequested) text = '이번 바퀴 끝나고 들어와';
    else if (!short) text = '끝까지 갈 수 있어';
    else if (can < 1) text = '이번 바퀴에 들어와야 해!';
    else if (can < 4) text = `${Math.floor(can)}바퀴 안에 들어와야 해`;
    else text = '이대로는 끝까지 못 가';
    call.textContent = text;
    call.classList.toggle('warn', danger);
    card.classList.toggle('danger', danger);
    if (danger && !warned[car.id]) {
      warned[car.id] = true;
      beep();
    }
    if (!danger) warned[car.id] = false;
    fore.textContent = busy ? '' : `지금 들어가면 약 ${HoverSim.pitForecast(race, car).rank}위로 복귀`;
  }

  function beep() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.18].forEach((at) => {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.frequency.value = 880;
        gain.gain.value = 0.06;
        osc.connect(gain).connect(audio.destination);
        osc.start(audio.currentTime + at);
        osc.stop(audio.currentTime + at + 0.1);
      });
    } catch (e) { /* 소리를 못 내도 카드가 깜빡인다 */ }
  }

  function renderChassis() {
    const labels = [['top', '최고 속도'], ['accel', '가속'], ['corner', '코너링'], ['stability', '안정성']];
    $('chassis').innerHTML = DATA.teams.map((team) => {
      const car = race.cars.find((c) => c.team === team);
      const bars = labels.map(([k, name]) =>
        `<div class="stat"><span>${name}</span><div class="bar"><i style="width:${car.build[k] * 10}%;background:${team.color}"></i></div></div>`).join('');
      return `<div class="cb"><div class="cb-head"><span class="chip" style="background:${team.color}"></span>${team.name} · ${car.build.weapon.name}<span class="best" data-best="${team.id}">-</span></div>${bars}</div>`;
    }).join('');
  }

  // 차고. 슬라이더를 움직일 때는 다시 만들지 않아 끌고 있는 중에도 끊기지 않는다.
  // 연구소와 드라이버 화면. 차고 위에 뜬다.
  let officeTab = 'research';

  function openOffice(tab) {
    officeTab = tab;
    $('office').hidden = false;
    renderOffice();
  }

  function renderOffice() {
    $('officeMoney').textContent = career.money + '억';
    if (officeTab === 'research') renderResearch();
    else renderDrivers();
  }

  function renderResearch() {
    $('officeTitle').textContent = '연구소';
    const now = career.researching;
    const rows = Object.entries(DATA.research).map(([id, item]) => {
      let action;
      if (now && now.id === id) action = `<button type="button" disabled>${now.left}경기 남음</button>`;
      else if (career.unlocked.includes(id)) {
        action = item.settings ? '<button type="button" disabled>완료</button>'
          : `<button type="button" data-toggle="${id}"${career.active.includes(id) ? ' class="on"' : ''}>${career.active.includes(id) ? '켜짐' : '꺼짐'}</button>`;
      } else {
        action = `<button type="button" data-research="${id}"${now || career.money < item.cost ? ' disabled' : ''}>연구 ${item.cost}억 · ${item.races}경기</button>`;
      }
      return `<div class="o-row"><div class="o-main"><b>${item.name}</b><span class="o-sub">${item.desc}</span></div>${action}</div>`;
    }).join('');
    $('officeBody').innerHTML = `<p class="muted small">연구는 한 번에 하나씩, 경기가 끝날 때마다 진행돼. 끝난 연구는 켜고 끌 수 있고, 저항·접지력과 경량·보강은 하나만 켤 수 있어.</p>${rows}`;
  }

  function canTransfer() {
    return !season || season.round === 0 || HoverSeason.inBreak(DATA, season);
  }

  function renderDrivers() {
    $('officeTitle').textContent = '드라이버';
    const mine = career.rosters[DATA.playerTeam];
    const open = canTransfer();
    const myRows = mine.map((name) => {
      const d = career.drivers[name];
      return `<div class="o-row"><div class="o-main"><b>${name} · ${d.age}세</b><span class="o-sub">${HoverCareer.myTraits(DATA, career, name).join(' · ')}</span></div></div>`;
    }).join('');
    const offer = (name, where) => {
      const d = career.drivers[name];
      const report = HoverCareer.scoutReport(DATA, career, name);
      const cost = HoverCareer.fee(DATA, career, name);
      const buttons = mine.map((m, slot) => `<button type="button" data-sign="${name}" data-slot="${slot}"${!open || career.money < cost ? ' disabled' : ''}>${m} 대신 ${cost}억</button>`).join('');
      return `<div class="o-row"><div class="o-main"><b>${name} · ${d.age}세</b><span class="o-sub">${where} · 스카우트: ${report.text.join(' · ')} (${report.trust})</span></div>${buttons}</div>`;
    };
    const rivals = DATA.teams.filter((t) => t.id !== DATA.playerTeam).flatMap((t) => career.rosters[t.id].map((n) => offer(n, t.name))).join('');
    $('officeBody').innerHTML = `<div class="o-head">내 드라이버</div>${myRows}
      <p class="muted small">${open ? '지금 영입할 수 있어. 내보낸 선수는 상대 자리로 가.' : '영입은 시즌 전과 휴식기에만 할 수 있어.'}</p>
      <div class="o-head">무소속</div>${career.market.map((n) => offer(n, '무소속')).join('')}
      <div class="o-head">다른 팀 소속 (이적료 더 비쌈)</div>${rivals}`;
  }

  function partsChanged() {
    return [...Object.keys(DATA.slots), 'engine'].filter((slot) => loadout[slot] !== breakBase[slot]).length;
  }

  function renderGarageSeason() {
    const box = $('garageSeason');
    if (net) {
      renderRoom(box);
      return;
    }
    $('startFree').hidden = Boolean(season);
    $('quitSeason').hidden = !season;
    $('startRace').textContent = season ? '예선으로' : `${career.year}년차 시즌 시작`;
    if (!season) {
      box.innerHTML = `<div class="choice-label">자유 경주 트랙</div><div class="g-tracks">${DATA.tracks.map((t) =>
        `<button type="button" data-track="${t.id}"${t.id === trackId ? ' class="on"' : ''}>${t.name}</button>`).join('')}</div>
        <p class="muted small">${trackDef(trackId).desc}</p>`;
      return;
    }
    const def = trackDef(currentTrack());
    const max = DATA.season.breakParts;
    const note = HoverSeason.inBreak(DATA, season)
      ? `<p class="warn">휴식기: 부위를 최대 ${max}개 바꿀 수 있어 (${partsChanged()}/${max})</p>`
      : season.round === 0 ? `<p class="warn">첫 경기 뒤에는 부위를 휴식기까지 못 바꿔. 세팅은 경기마다 바꿀 수 있어.</p>`
      : season.round > DATA.season.breakAfter ? `<p>이번 시즌은 더 이상 부위를 못 바꿔. 세팅은 바꿀 수 있어.</p>`
      : `<p>부위는 휴식기까지 잠겨 있어. 세팅은 바꿀 수 있어.</p>`;
    box.innerHTML = `<div class="season-box"><b>시즌 ${season.round + 1}/${DATA.season.calendar.length}경기 · ${def.name}</b><p>${def.desc} ${def.laps}바퀴.</p>${note}</div>`;
  }

  function partsLocked() {
    return Boolean(season) && season.round > 0 && !HoverSeason.inBreak(DATA, season);
  }

  function renderGarage(fromSlider = false) {
    renderGarageSeason();
    const locked = partsLocked();
    loadout.research = net ? [] : career.active;
    if (net && net.role === 'guest') netSend({ t: 'load', loadout });
    const build = HoverSim.computeBuild(DATA, loadout);
    $('garageMoney').textContent = career.money + '억';
    $('garageYear').textContent = `${career.year}년차`;
    if (document.activeElement !== $('teamName')) $('teamName').value = player.name;
    $('garageWeapon').textContent = '무기: ' + build.weapon.name;
    const pct = (v) => Math.round(v * 100) + '%';
    const rows = [
      ['최고 속도', build.top / 10, build.top.toFixed(1)],
      ['가속', build.accel / 10, build.accel.toFixed(1)],
      ['코너링', build.corner / 10, build.corner.toFixed(1)],
      ['안정성', build.stability / 10, build.stability.toFixed(1)],
      ['맷집', build.armor / 0.5, pct(build.armor)],
      ['무게', build.weight / 7, String(build.weight)],
      ['에너지', build.maxEnergy / 130, String(build.maxEnergy)],
      ['회복', build.regen / 0.12, build.regen.toFixed(2)],
      ['에너지 소모', build.drain / 1.5, pct(build.drain)],
    ];
    $('garageStats').innerHTML = rows.map(([name, w, text]) =>
      `<div class="g-stat"><span>${name}</span><div class="bar"><i style="width:${Math.max(0, Math.min(1, w)) * 100}%;background:${player.color}"></i></div><em>${text}</em></div>`).join('');
    const slots = { ...DATA.slots, engine: '엔진' };
    $('garageParts').innerHTML = Object.entries(slots).map(([slot, label]) =>
      `<div class="g-row"><div class="choice-label">${label}</div><div class="choices">${Object.entries(DATA.makers).map(([id, name]) =>
        `<button type="button" data-slot="${slot}" data-maker="${id}"${loadout[slot] === id ? ' class="on"' : ''}${locked ? ' disabled' : ''}>${name}</button>`).join('')}</div></div>`).join('');
    if (!fromSlider) {
      $('garageSettings').innerHTML = `<div class="choice-label">세팅</div>` + Object.entries(DATA.settings).map(([key, s]) => {
        // 연구 전에는 ±1까지만 움직인다.
        const range = HoverCareer.settingRange(DATA, net ? null : career, key);
        loadout.setting[key] = Math.max(-range, Math.min(range, loadout.setting[key]));
        return `<label class="g-set"><span>${s.low}</span><input type="range" min="${-range}" max="${range}" step="1" value="${loadout.setting[key]}" data-setting="${key}" aria-label="${s.name}"><span>${s.high}</span></label>`;
      }).join('');
      $('garageColors').innerHTML = DATA.playerColors.map((c) =>
        `<button type="button" data-color="${c}" aria-label="팀 색 ${c}" style="background:${c}"${c === player.color ? ' class="on"' : ''}></button>`).join('');
    }
    drawGarageCar();
  }

  function drawGarageCar() {
    const canvas = $('garageCar');
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    const s = Math.min(canvas.width / 220, canvas.height / 120);
    ctx.setTransform(s, 0, 0, s, canvas.width / 2, canvas.height / 2);
    HoverArt.drawShapes(ctx, HoverArt.carShapes(loadout), player.color, 8 * s);
  }

  function openGarage() {
    inGarage = true;
    grid = null;
    $('result').hidden = true;
    $('qual').hidden = true;
    $('office').hidden = true;
    $('garage').hidden = false;
    breakBase = season && HoverSeason.inBreak(DATA, season) ? { ...loadout } : null;
    renderGarage();
  }

  function fmtLap(t) {
    return t === undefined || t === null ? '-' : t.toFixed(3);
  }

  const qualStageCount = () => DATA.qualifying.cut.length + 1;

  function openQualifying() {
    $('garage').hidden = true;
    qual = { rows: HoverSim.qualRows(DATA), stage: 0 };
    startStage();
  }

  function startStage() {
    const entrants = HoverSim.qualEntrants(DATA, qual.rows, qual.stage);
    const seedNow = raceSeed() + qual.stage * 7;
    race = HoverSim.createQualStage(DATA, currentTrack(), seedNow, allLoadouts(), entrants, { manualTeams: manualTeams(), fx: true, skills: skillsNow() });
    if (net) netStageStarted('qual');
    // 사람 차가 다 떨어졌으면 볼 필요 없이 결과만 낸다. 손님은 방장 결과를 기다린다.
    if (!race.cars.some((c) => c.manual) && !(net && net.role === 'guest')) {
      while (!race.over) HoverSim.stepRace(race);
      endStage();
      return;
    }
    renderer = HoverRender.createRenderer($('track'), race);
    renderer.setSpeed(speed);
    debt = 0;
    inGarage = false;
    qual.ended = false;
    $('qual').hidden = true;
    $('trackName').textContent = net ? `${race.track.name} · 친구와 대전` : `${race.track.name} · 시즌 ${season.round + 1}/${DATA.season.calendar.length}경기`;
    $('lapLabel').textContent = '예선';
    $('clockLabel').textContent = '남은 시간';
    $('lapNow').textContent = qual.stage + 1;
    $('lapTotal').textContent = qualStageCount();
    $('pips').innerHTML = '';
    $('restart').hidden = true;
    $('toGarage').hidden = true;
    $('chassis').hidden = true;
    $('chassisTitle').hidden = true;
    renderQualRadio();
    updateQual();
  }

  function renderQualRadio() {
    $('radio').innerHTML = myCars().map((car) => `
      <div class="radio-car" data-card="${car.id}">
        <div class="radio-head"><span class="chip" style="background:${car.team.color}"></span>${car.driver}<span class="pos"></span></div>
        <div class="q-card-time">최고 <b class="q-best"></b> · 지난 <b class="q-last"></b></div>
        <div class="radio-call"></div>
        <div class="radio-fore"></div>
        <div class="choices two">${Object.entries(DATA.qualifying.modes).map(([key, m]) =>
          `<button type="button" data-qmode="${key}" data-car="${car.id}">${m.name}</button>`).join('')}</div>
        <button type="button" class="pit-btn" data-release="${car.id}">내보내</button>
      </div>`).join('');
  }

  function updateQual() {
    const left = Math.max(0, race.qual.duration - race.time);
    $('clock').textContent = fmt(Math.ceil(left));
    const best = (c) => (c.qualBest === null ? Infinity : c.qualBest);
    const order = [...race.cars].sort((a, b) => best(a) - best(b));
    const keep = DATA.qualifying.cut[qual.stage];
    $('standings').innerHTML = order.map((car, i) =>
      `<div class="row${car.team.id === DATA.playerTeam ? ' mine' : ''}${i === keep ? ' cut' : ''}"><span class="pos">${i + 1}</span><span class="chip" style="background:${car.team.color}"></span><span class="name">${car.driver}</span>${car.qualState === 'flying' ? '<span class="tag">기록 중</span>' : ''}<span class="gap">${car.qualBest === null ? '-' : car.qualBest.toFixed(3)}</span></div>`).join('');
    $('news').innerHTML = [...race.news].reverse().map((n) =>
      `<div class="news-row"><span class="chip" style="background:${n.color}"></span><span>${n.text}</span></div>`).join('');
    for (const car of myCars()) {
      const card = document.querySelector(`[data-card="${car.id}"]`);
      if (!card) continue; // 멀티에서 내 팀이 정해지기 전의 경주
      card.querySelector('.pos').textContent = car.qualBest === null ? '기록 없음' : order.indexOf(car) + 1 + '위';
      card.querySelector('.q-best').textContent = car.qualBest === null ? '-' : car.qualBest.toFixed(3);
      card.querySelector('.q-last').textContent = car.qualLast === null ? '-' : car.qualLast.toFixed(3);
      const lap = race.qual.lap;
      let text = '';
      if (car.qualState === 'flying') text = `기록 중 ${(race.time - car.lapStart).toFixed(1)}초`;
      else if (car.qualState === 'out') text = left > 0 ? '준비 바퀴' : '시간 끝, 들어와';
      else if (car.qualState === 'in') text = '들어오는 중';
      else if (left < lap * 1.05) text = '이제 나가도 기록을 못 내';
      else if (left < lap * 1.5) text = '지금 안 나가면 늦어!';
      else text = '대기 중 · 앞이 빌 때 내보내';
      const call = card.querySelector('.radio-call');
      call.textContent = text;
      const late = car.qualState === 'ready' && left < lap * 1.5 && left >= lap * 1.05;
      call.classList.toggle('warn', late);
      card.classList.toggle('danger', late);
      card.querySelector('.radio-fore').textContent = car.qualState === 'ready' ? nextOnTrack(car) : '';
      card.querySelectorAll('[data-qmode]').forEach((b) => b.classList.toggle('on', b.dataset.qmode === car.qualMode));
      card.querySelector('[data-release]').disabled = car.pitPhase !== 'garage';
    }
    if (race.over && !qual.ended && !(net && net.role === 'guest')) endStage();
  }

  // 정비소 출구로 다가오는 차가 있으면 알려 준다. 나가자마자 막히는지 판단하는 재료.
  function nextOnTrack(car) {
    const L = race.track.length;
    let near = Infinity;
    for (const other of race.cars) {
      if (other === car || other.pitPhase) continue;
      near = Math.min(near, ((race.pit.exit - other.dist) % L + L) % L);
    }
    return near === Infinity ? '트랙이 비어 있어' : `출구까지 가장 가까운 차 약 ${(near / (car.profile.top * 0.8)).toFixed(1)}초`;
  }

  function endStage() {
    HoverSim.qualApply(qual.rows, race, qual.stage);
    if (net) {
      net.lastEnd = { t: 'qualEnd', rows: packRows(qual.rows) };
      netBroadcast(net.lastEnd);
    }
    showStageResult();
  }

  function showStageResult() {
    qual.ended = true;
    inGarage = true;
    const last = qual.stage === qualStageCount() - 1;
    const keep = DATA.qualifying.cut[qual.stage];
    $('qualTitle').textContent = last ? `예선 결과 · 출발 순서` : `${qual.stage + 1}차 예선 결과`;
    $('qualDesc').textContent = last ? '이 순서대로 출발해.' : `위 ${keep}대가 다음 예선으로 가.`;
    const count = qualStageCount();
    $('qualRows').innerHTML = `<div class="row q-head"><span class="pos"></span><span class="name">차</span>${[...Array(count).keys()].map((q) => `<span class="q-time">${q + 1}차</span>`).join('')}</div>`
      + qual.rows.map((r, i) => `<div class="row${r.team.id === DATA.playerTeam ? ' mine' : ''}${!last && i === keep ? ' cut' : ''}"><span class="pos">${i + 1}</span><span class="chip" style="background:${r.team.color}"></span><span class="name">${r.driver} · ${r.team.name}</span>${[...Array(count).keys()].map((q) =>
        `<span class="q-time${q === r.times.length - 1 ? ' now' : ''}">${fmtLap(r.times[q])}</span>`).join('')}</div>`).join('');
    const waiting = net && net.role === 'guest';
    if (waiting) $('qualDesc').textContent += ' 방장이 넘기면 이어져.';
    $('qualGo').hidden = waiting;
    $('qualGo').textContent = last ? '경기 시작' : `${qual.stage + 2}차 예선`;
    $('qual').hidden = false;
  }

  function tableRows(rows, name, color) {
    return rows.map((r, i) => `<div class="row${(r.team || r.id) === DATA.playerTeam ? ' mine' : ''}"><span class="pos">${i + 1}</span><span class="chip" style="background:${color(r)}"></span><span class="name">${name(r)}</span><span class="pts">${r.pts}</span></div>`).join('');
  }

  function renderSeasonResult(order) {
    const trackNow = currentTrack();
    const gained = HoverSeason.record(DATA, season, order);
    const gain = HoverCareer.afterRace(DATA, career, order, trackNow);
    recorded = true;
    const color = (id) => DATA.teams.find((t) => t.id === id).color;
    const done = HoverSeason.finished(DATA, season);
    const drivers = HoverSeason.driverTable(season);
    const teams = HoverSeason.teamTable(season);
    $('resultTitle').textContent = done
      ? `시즌 종료 · 챔피언 ${drivers[0].driver} · 컨스트럭터 ${teams[0].name}`
      : `${season.round}/${DATA.season.calendar.length}경기 결과 · ${race.track.name}`;
    $('resultRows').innerHTML = order.map((car, i) =>
      `<div class="row${car.team.id === DATA.playerTeam ? ' mine' : ''}"><span class="pos">${i + 1}</span><span class="chip" style="background:${car.team.color}"></span><span class="name">${car.driver} · ${car.team.name}</span><span class="pts">+${gained[i].pts}</span></div>`).join('');
    $('seasonTables').innerHTML = `<div class="muted small title">드라이버 챔피언십</div>${tableRows(drivers, (r) => r.driver, (r) => color(r.team))}
      <div class="muted small title">컨스트럭터 챔피언십</div>${tableRows(teams, (r) => r.name, (r) => color(r.id))}`;
    $('nextRace').hidden = false;
    let note = `상금 ${gain.earned}억`;
    if (gain.done) note += ` · 연구 완료: ${gain.done}`;
    if (done) {
      const end = HoverCareer.afterSeason(DATA, career, teams);
      note = `컨스트럭터 ${end.place}위 · 시즌 보너스 ${end.bonus}억 · ${note}`;
      for (const r of end.retired) note += ` · ${r.name}(${r.age}세) 은퇴, 신인 ${r.rookie} 합류`;
    }
    $('resultNote').textContent = `${note} · 돈 ${career.money}억`;
    $('nextRace').textContent = done ? '다음 시즌 준비' : '다음 경기';
    $('restart2').hidden = true;
    $('toGarage2').hidden = true;
    if (done) season = null;
    saveSeason();
  }

  function gapText(car, leader, avgLap) {
    if (car === leader) return '선두';
    if (car.finishTime !== null && leader.finishTime !== null) return '+' + (car.finishTime - leader.finishTime).toFixed(1);
    const diff = leader.dist - car.dist;
    if (diff >= race.track.length) return '+' + Math.floor(diff / race.track.length) + '바퀴';
    return '+' + ((diff / race.track.length) * avgLap).toFixed(1);
  }

  function updateUi() {
    if (race.qual) {
      updateQual();
      return;
    }
    const order = HoverSim.standings(race);
    const leader = order[0];
    const lapNow = Math.min(race.laps, Math.max(1, Math.floor(leader.dist / race.track.length) + 1));
    $('lapNow').textContent = lapNow;
    $('clock').textContent = fmt(race.time);
    [...$('pips').children].forEach((el, i) => {
      el.style.background = i < lapNow - 1 ? player.color : i === lapNow - 1 ? '#FFFFFF' : '';
    });

    const avgLap = leader.lastLap || 16;
    $('standings').innerHTML = order.map((car, i) =>
      `<div class="row${car.team.id === DATA.playerTeam ? ' mine' : ''}"><span class="pos">${i + 1}</span><span class="chip" style="background:${car.team.color}"></span><span class="name">${car.driver}</span>${car.pitPhase ? '<span class="tag">정비</span>' : car.rebootLeft > 0 ? '<span class="tag">재부팅</span>' : ''}<span class="gap">${gapText(car, leader, avgLap)}</span></div>`).join('');
    updateRadio(order);
    $('news').innerHTML = [...race.news].reverse().map((n) =>
      `<div class="news-row"><span class="chip" style="background:${n.color}"></span><span>${n.text}</span><b>${fmt(n.time)}</b></div>`).join('');

    for (const team of DATA.teams) {
      const best = race.cars.filter((c) => c.team === team && c.bestLap !== null).map((c) => c.bestLap);
      const el = document.querySelector(`[data-best="${team.id}"]`);
      if (el && best.length) el.textContent = Math.min(...best).toFixed(2) + '초';
    }

    if (race.over && $('result').hidden && season && !recorded) {
      renderSeasonResult(order);
      $('seasonTables').hidden = false;
      $('result').hidden = false;
    } else if (race.over && $('result').hidden && !recorded) {
      recorded = true;
      $('resultTitle').textContent = '경기 결과';
      $('resultNote').textContent = '';
      $('seasonTables').innerHTML = '';
      $('nextRace').hidden = !(net && net.role === 'host');
      $('nextRace').textContent = '대기실로';
      $('restart2').hidden = Boolean(net);
      $('toGarage2').hidden = Boolean(net);
      if (net && net.role === 'guest') $('resultNote').textContent = '방장이 대기실로 옮기면 다음 경기를 준비할 수 있어.';
      $('resultRows').innerHTML = order.map((car, i) =>
        `<div class="row${car.team.id === DATA.playerTeam ? ' mine' : ''}"><span class="pos">${i + 1}</span><span class="chip" style="background:${car.team.color}"></span><span class="name">${car.driver} · ${car.team.name}</span><span class="gap">${i ? gapText(car, leader, avgLap) : fmt(car.finishTime)}</span></div>`).join('');
      $('result').hidden = false;
    }
  }

  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000 || 0);
    last = now;
    if (net && net.role === 'guest') netAdvance(dt);
    else if (!net) {
      if (!inGarage) debt += dt * speed;
      while (!inGarage && debt >= HoverSim.STEP) {
        HoverSim.stepRace(race);
        debt -= HoverSim.STEP;
      }
    }
    renderer.draw(dt);
    if (net) net.fxSent = 0; // 그리면서 연출 신호를 비웠다
    uiTimer += dt;
    if (uiTimer > 0.2) {
      uiTimer = 0;
      updateUi();
    }
    requestAnimationFrame(frame);
  }

  // ---------- 멀티 ----------
  // 방장이 경주를 계산한다. 손님은 같은 시드로 경주를 만들어 두고, 받은 상태로 차를 옮겨 그린다.
  const PIT_PHASES = [null, 'in', 'service', 'out', 'garage'];
  const SLOW_KEYS = ['order', 'drive', 'fuel', 'nextFuel', 'fireOn', 'pitRequested', 'slipping', 'finishTime', 'lapsDone', 'lastLap', 'bestLap', 'pitLeft', 'shieldCd', 'lapStart', 'qualState', 'qualBest', 'qualLast', 'qualMode'];
  const COMMANDS = ['setOrder', 'setNextFuel', 'setDrive', 'setFire', 'activateShield', 'requestPit', 'releaseCar', 'setQualMode'];

  // 지시를 내린다. 손님은 내 화면에 먼저 반영하고 방장에게도 보낸다.
  function command(fn, carId, ...args) {
    HoverSim[fn](race, carId, ...args);
    if (net && net.role === 'guest') netSend({ t: 'cmd', fn, carId, args });
  }

  function netSend(msg) {
    if (net && net.conn && net.conn.open) net.conn.send(msg);
  }

  function netBroadcast(msg) {
    for (const member of net.room.members) {
      const conn = net.conns[member.name];
      if (conn && conn.open) conn.send(msg);
    }
  }

  function enterNet(role, name) {
    net = { role, name, room: null, match: null, conns: {}, conn: null, fxSent: 0, fxBuf: [], lastStage: null, lastEnd: null, ready: false, sendAt: 0, slowAt: 0, stepAt: 0 };
    season = null;
    qual = null;
    // 모두 같은 조건: 기본 드라이버, 연구 없음, 팀마다 정해진 색.
    DATA.teams.forEach((t, i) => Object.assign(t, { name: teamDefaults[i].name, color: teamDefaults[i].color, drivers: [...teamDefaults[i].drivers] }));
    loadout.research = [];
    setSpeed(Number(new URLSearchParams(location.search).get('netspeed')) || 1);
    $('speeds').hidden = true;
    ['startFree', 'openLobby', 'resetAll', 'officeBtns', 'moneyLine', 'teamName', 'teamNameLabel', 'garageColors', 'colorLabel'].forEach((id) => { $(id).hidden = true; });
    $('lobby').hidden = true;
  }

  function assignPlayer(room) {
    net.room = room;
    DATA.teams.forEach((team, i) => {
      const member = room.members.find((m) => m.team === team.id);
      team.name = member ? member.name : teamDefaults[i].name;
    });
    const me = room.members.find((m) => m.name === net.name);
    if (me) {
      DATA.playerTeam = me.team;
      player = DATA.teams.find((t) => t.id === me.team);
      net.ready = me.ready;
      setColor(player.color);
      $('brandName').textContent = player.name;
    }
    if (!$('garage').hidden) renderGarage();
  }

  function renderRoom(box) {
    const host = net.role === 'host';
    const room = net.room;
    const def = trackDef(room.track);
    $('quitSeason').hidden = false;
    $('quitSeason').textContent = '방 나가기';
    $('startRace').textContent = host ? '경기 시작' : net.ready ? '준비 취소' : '준비';
    const others = room.members.filter((m) => !m.host);
    const members = room.members.map((m) => {
      const team = DATA.teams.find((t) => t.id === m.team);
      const state = !m.online ? '끊김' : m.host ? '방장' : m.ready ? '준비됨' : '고르는 중';
      return `<div class="room-row"><span class="chip" style="background:${team.color}"></span>${m.name}<span class="tag${m.ready || m.host ? ' ok' : ''}">${state}</span></div>`;
    }).join('');
    const tracks = host
      ? `<div class="g-tracks">${DATA.tracks.map((t) => `<button type="button" data-track="${t.id}"${t.id === room.track ? ' class="on"' : ''}>${t.name}</button>`).join('')}</div>`
      : `<b>${def.name}</b>`;
    box.innerHTML = `<div class="season-box"><div class="muted small">방 코드 · 친구에게 알려 줘</div><div class="room-code">${room.code}</div>${members}
      <p>빈 팀은 컴퓨터가 달려. ${host && others.some((m) => !m.ready) ? '아직 고르는 친구가 있어.' : ''}</p></div>
      <div class="choice-label">트랙</div>${tracks}<p class="muted small">${def.desc}</p>`;
  }

  function broadcastRoom() {
    netBroadcast({ t: 'room', room: net.room });
    assignPlayer(net.room);
  }

  function hostRoom() {
    const name = $('netName').value.trim();
    if (!name) {
      $('netStatus').textContent = '이름을 적어 줘.';
      return;
    }
    $('netStatus').textContent = '방을 만드는 중…';
    net = { role: 'connecting' };
    HoverNet.host({
      ready(code) {
        enterNet('host', name);
        net.room = { code, track: DATA.tracks[0].id, members: [{ name, team: DATA.teams[0].id, host: true, ready: true, online: true }] };
        assignPlayer(net.room);
        setInterval(hostTick, 25);
        openGarage();
      },
      open() {},
      data: hostReceive,
      close(conn) {
        if (conn.memberName) memberLeft(conn.memberName, conn);
      },
      error(text) {
        if (net && net.role === 'connecting') net = null;
        $('netStatus').textContent = text;
      },
    });
  }

  function memberLeft(name, conn) {
    if (net.conns[name] !== conn) return;
    delete net.conns[name];
    const member = net.room.members.find((m) => m.name === name);
    if (!member) return;
    member.online = false;
    member.ready = false;
    // 끊긴 팀은 컴퓨터가 대신 달린다.
    if (race) for (const car of race.cars) if (car.team.id === member.team) car.manual = false;
    if (net.match) net.match.manual = net.match.manual.filter((id) => id !== member.team);
    // 경기 전이면 자리를 비운다.
    if (!net.match) net.room.members = net.room.members.filter((m) => m !== member);
    broadcastRoom();
  }

  function hostReceive(conn, msg) {
    if (msg.t === 'hello') {
      let member = net.room.members.find((m) => m.name === msg.name);
      if (member && member.online) {
        conn.send({ t: 'denied', text: '같은 이름이 이미 방에 있어.' });
        return;
      }
      if (!member) {
        const free = DATA.teams.find((t) => !net.room.members.some((m) => m.team === t.id));
        if (!free) {
          conn.send({ t: 'denied', text: '방이 꽉 찼어.' });
          return;
        }
        member = { name: msg.name, team: free.id, ready: false, online: true };
        net.room.members.push(member);
      }
      member.online = true;
      conn.memberName = msg.name;
      net.conns[msg.name] = conn;
      // 다시 들어온 사람이면 다시 맡긴다.
      if (net.match && net.match.started && race && race.cars.some((c) => c.team.id === member.team)) {
        for (const car of race.cars) if (car.team.id === member.team) car.manual = true;
        net.match.manual = [...new Set([...net.match.manual, member.team])];
      }
      broadcastRoom();
      // 다시 들어온 사람에게 지금 상태를 바로 보낸다. 경기가 끝났어도 결과를 볼 수 있게.
      if (net.lastStage) {
        conn.send(net.lastStage);
        conn.send(fastState([]));
        conn.send(slowState());
      }
      if (net.lastEnd) conn.send(net.lastEnd);
      return;
    }
    const member = net.room.members.find((m) => m.name === conn.memberName);
    if (!member) return;
    if (msg.t === 'load') member.loadout = cleanLoadout(msg.loadout, member.team);
    if (msg.t === 'ready') {
      member.ready = Boolean(msg.ready);
      broadcastRoom();
    }
    if (msg.t === 'cmd' && COMMANDS.includes(msg.fn) && race && net.match) {
      const car = race.cars[msg.carId];
      if (car && car.team.id === member.team) HoverSim[msg.fn](race, msg.carId, ...(msg.args || []));
    }
  }

  // 받은 조합을 그대로 믿지 않고 게임에 있는 값만 남긴다.
  function cleanLoadout(lo, teamId) {
    const out = HoverSim.pureLoadout(DATA.teams.find((t) => t.id === teamId).maker);
    if (!lo) return out;
    for (const slot of [...Object.keys(DATA.slots), 'engine']) if (DATA.makers[lo[slot]]) out[slot] = lo[slot];
    for (const key of Object.keys(DATA.settings)) {
      const v = Number(lo.setting && lo.setting[key]);
      if (Number.isFinite(v)) out.setting[key] = Math.max(-2, Math.min(2, Math.round(v)));
    }
    return out;
  }

  function startMatch() {
    const matchSeed = Math.floor(Math.random() * 1e9);
    const rng = HoverSim.mulberry32(matchSeed);
    const loadouts = {};
    const members = net.room.members;
    for (const team of DATA.teams) {
      const member = members.find((m) => m.team === team.id);
      if (member && member.host) loadouts[team.id] = cleanLoadout(loadout, team.id);
      else if (member && member.online) loadouts[team.id] = member.loadout || cleanLoadout(null, team.id);
      else loadouts[team.id] = HoverSim.aiLoadout(DATA, team, rng, true);
    }
    net.match = { seed: matchSeed, track: net.room.track, laps: lapsParam > 0 ? lapsParam : null, loadouts, manual: members.filter((m) => m.online).map((m) => m.team), started: true };
    net.lastEnd = null;
    grid = null;
    $('garage').hidden = true;
    qual = { rows: HoverSim.qualRows(DATA), stage: 0 };
    startStage();
  }

  const packRows = (rows) => rows.map((r) => ({ driver: r.driver, team: r.team.id, times: r.times, time: r.time }));
  const unpackRows = (rows) => rows.map((r) => ({ ...r, times: r.times.map((t) => t), team: DATA.teams.find((t) => t.id === r.team) }));

  // 새 단계가 시작되면 방장은 손님에게 같은 경주를 만들 재료를 보낸다.
  function netStageStarted(kind) {
    if (net.role !== 'host') {
      inGarage = false;
      return;
    }
    net.lastEnd = null;
    net.fxSent = 0;
    net.stepAt = performance.now();
    net.lastStage = { t: 'stage', kind, match: net.match, grid, stage: qual ? qual.stage : 0, rows: qual ? packRows(qual.rows) : null };
    netBroadcast(net.lastStage);
  }

  function backToRoom() {
    net.match = null;
    net.lastStage = null;
    net.lastEnd = null;
    for (const m of net.room.members) if (!m.host) m.ready = false;
    net.room.members = net.room.members.filter((m) => m.online);
    netBroadcast({ t: 'back' });
    broadcastRoom();
    openGarage();
  }

  // 위치처럼 자주 바뀌는 값은 자주, 지시 상태처럼 드문 값은 가끔 보낸다.
  function fastState(fx) {
    return {
      t: 'f',
      time: race.time,
      fx,
      c: race.cars.map((c) => [Math.round(c.dist * 10) / 10, Math.round(c.lane * 10) / 10, Math.round(c.speed), Math.round(c.energy * 10) / 10, Math.round(c.meter), PIT_PHASES.indexOf(c.pitPhase), Math.round(c.shieldLeft * 10) / 10, Math.round(c.rebootLeft * 10) / 10]),
    };
  }

  function slowState() {
    return { t: 's', over: race.over, news: race.news, cars: race.cars.map((c) => SLOW_KEYS.map((k) => c[k])) };
  }

  // 방장의 계산과 전송. 탭이 내려가 화면이 멈춰도 돌도록 타이머로 돈다.
  function hostTick() {
    const now = performance.now();
    if (!race || inGarage || race.over && net.overSent === race) return;
    const dt = Math.min(2, (now - net.stepAt) / 1000);
    net.stepAt = now;
    debt += dt * speed;
    while (debt >= HoverSim.STEP && !race.over) {
      HoverSim.stepRace(race);
      debt -= HoverSim.STEP;
    }
    // 연출 신호는 화면이 그릴 때 비워지므로 아직 안 보낸 것만 모은다.
    if (race.fx.length > 400) {
      race.fx.splice(0, race.fx.length - 200);
      net.fxSent = 0;
    }
    net.fxBuf.push(...race.fx.slice(net.fxSent));
    net.fxSent = race.fx.length;
    if (now >= net.sendAt) {
      net.sendAt = now + 100;
      netBroadcast(fastState(net.fxBuf.splice(0)));
    }
    if (now >= net.slowAt || race.over) {
      net.slowAt = now + 500;
      netBroadcast(slowState());
      if (race.over) net.overSent = race;
    }
  }

  function joinRoom() {
    const name = $('netName').value.trim();
    const code = $('netCode').value.trim();
    if (!name || code.length !== 4) {
      $('netStatus').textContent = '이름과 방 코드 네 글자를 적어 줘.';
      return;
    }
    $('netStatus').textContent = '들어가는 중…';
    const link = HoverNet.join(code, {
      open(conn) {
        if (!net || net.role !== 'guest') enterNet('guest', name);
        net.conn = conn;
        net.link = link;
        $('netBanner').hidden = true;
        conn.send({ t: 'hello', name });
      },
      data: guestReceive,
      close() {
        if (!net || net.role !== 'guest') return;
        net.conn = null;
        $('netBannerText').textContent = '방장과 연결이 끊겼어. 다시 연결하는 중…';
        $('netBanner').hidden = false;
        setTimeout(() => {
          if (net && !net.conn) net.link.connect();
        }, 3000);
      },
      error(text) {
        if (net && net.role === 'guest') {
          if (!net.conn) setTimeout(() => net.link.connect(), 3000);
        } else {
          $('netStatus').textContent = text;
        }
      },
    });
  }

  function guestReceive(msg) {
    if (msg.t === 'denied') {
      alert(msg.text);
      location.reload();
    } else if (msg.t === 'room') {
      assignPlayer(msg.room);
      if (!qual && !net.match) openGarage();
    } else if (msg.t === 'stage') {
      guestStage(msg);
    } else if (msg.t === 'qualEnd') {
      if (qual) {
        qual.rows = unpackRows(msg.rows);
        showStageResult();
      }
    } else if (msg.t === 'back') {
      net.match = null;
      qual = null;
      openGarage();
    } else if (msg.t === 'f') {
      guestFast(msg);
    } else if (msg.t === 's') {
      guestSlow(msg);
    }
  }

  function guestStage(msg) {
    net.match = msg.match;
    grid = msg.grid;
    $('garage').hidden = true;
    $('qual').hidden = true;
    $('result').hidden = true;
    if (msg.kind === 'qual') {
      qual = { rows: unpackRows(msg.rows), stage: msg.stage };
      startStage();
    } else {
      qual = null;
      inGarage = false;
      setup();
    }
  }

  function guestFast(msg) {
    if (!race || !net.match) return;
    race.time = msg.time;
    race.fx.push(...msg.fx);
    msg.c.forEach((v, i) => {
      const car = race.cars[i];
      if (!car) return;
      car.netDist = v[0];
      car.netLane = v[1];
      car.speed = v[2];
      car.energy = v[3];
      car.meter = v[4];
      car.pitPhase = PIT_PHASES[v[5]];
      car.shieldLeft = v[6];
      car.rebootLeft = v[7];
    });
  }

  function guestSlow(msg) {
    if (!race || !net.match) return;
    race.news = msg.news;
    msg.cars.forEach((values, i) => {
      if (race.cars[i]) SLOW_KEYS.forEach((k, j) => { race.cars[i][k] = values[j]; });
    });
    race.over = msg.over;
  }

  // 받은 상태 사이를 이어서 부드럽게 움직인다.
  function netAdvance(dt) {
    if (!race || !net.match || race.over) return;
    race.time += dt;
    for (const car of race.cars) {
      if (car.netDist === undefined) continue;
      car.netDist += car.speed * dt;
      car.dist += car.speed * dt;
      const err = car.netDist - car.dist;
      car.dist = Math.abs(err) > 80 ? car.netDist : car.dist + err * Math.min(1, dt * 6);
      car.lane += (car.netLane - car.lane) * Math.min(1, dt * 8);
    }
  }

  function toggleReady() {
    netSend({ t: 'load', loadout });
    netSend({ t: 'ready', ready: !net.ready });
  }

  function setSpeed(value) {
    speed = value;
    if (renderer) renderer.setSpeed(value);
    document.querySelectorAll('#speeds button').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === value));
  }

  function restart() {
    seed += 1;
    setup();
  }

  $('speeds').addEventListener('click', (e) => {
    if (e.target.dataset.speed) setSpeed(Number(e.target.dataset.speed));
  });
  $('radio').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.release) command('releaseCar', Number(b.dataset.release));
    if (b.dataset.qmode) command('setQualMode', Number(b.dataset.car), b.dataset.qmode);
    if (race.qual) {
      updateQual();
      return;
    }
    if (b.dataset.order) command('setOrder', Number(b.dataset.car), b.dataset.order);
    if (b.dataset.fuel) command('setNextFuel', Number(b.dataset.car), b.dataset.fuel);
    if (b.dataset.drive) command('setDrive', Number(b.dataset.car), b.dataset.drive);
    if (b.dataset.fire) command('setFire', Number(b.dataset.car), b.dataset.fire === 'on');
    if (b.dataset.shield) command('activateShield', Number(b.dataset.shield));
    if (b.dataset.pit) {
      const id = Number(b.dataset.pit);
      command('requestPit', id, !race.cars[id].pitRequested);
    }
    updateUi();
  });
  $('restart').addEventListener('click', restart);
  $('restart2').addEventListener('click', restart);
  $('toGarage').addEventListener('click', openGarage);
  $('toGarage2').addEventListener('click', openGarage);
  $('startRace').addEventListener('click', () => {
    if (net) {
      if (net.role === 'host') startMatch();
      else toggleReady();
      return;
    }
    if (!season) {
      seed += 1;
      seed += career.year * 13;
      season = HoverSeason.create(DATA, seed * 1000);
      season.teams[player.id].color = player.color;
      season.teams[player.id].name = player.name;
    } else if (HoverSeason.inBreak(DATA, season)) {
      HoverSeason.endBreak(DATA, season);
    }
    saveSeason();
    openQualifying();
  });
  $('startFree').addEventListener('click', () => {
    inGarage = false;
    grid = null;
    $('garage').hidden = true;
    seed += 1;
    setup();
  });
  $('quitSeason').addEventListener('click', () => {
    if (net) {
      location.reload();
      return;
    }
    if (!confirm('이번 시즌 순위를 지우고 그만둘까? 돈과 연구, 드라이버는 남아.')) return;
    season = null;
    saveSeason();
    openGarage();
  });
  $('resetAll').addEventListener('click', () => {
    if (!confirm('돈, 연구, 드라이버까지 전부 지우고 처음부터 할까?')) return;
    season = null;
    career = HoverCareer.create(DATA, Date.now() % 100000);
    saveSeason();
    openGarage();
  });
  $('teamName').addEventListener('input', (e) => {
    setName(e.target.value.trim());
    saveSeason();
  });
  $('openResearch').addEventListener('click', () => openOffice('research'));
  $('openDrivers').addEventListener('click', () => openOffice('drivers'));
  $('closeOffice').addEventListener('click', () => {
    $('office').hidden = true;
    renderGarage();
  });
  $('officeBody').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.research) HoverCareer.startResearch(DATA, career, b.dataset.research);
    if (b.dataset.toggle) HoverCareer.toggleResearch(DATA, career, b.dataset.toggle);
    if (b.dataset.sign) HoverCareer.sign(DATA, career, b.dataset.sign, Number(b.dataset.slot));
    saveSeason();
    renderOffice();
  });
  $('garageSeason').addEventListener('click', (e) => {
    if (!e.target.dataset.track) return;
    if (net) {
      net.room.track = e.target.dataset.track;
      broadcastRoom();
      return;
    }
    trackId = e.target.dataset.track;
    renderGarage();
  });
  $('openLobby').addEventListener('click', () => {
    $('netName').value = player.name === '내 팀' ? '' : player.name;
    $('netStatus').textContent = '';
    $('lobby').hidden = false;
  });
  $('closeLobby').addEventListener('click', () => {
    $('lobby').hidden = true;
  });
  $('netHost').addEventListener('click', hostRoom);
  $('netJoin').addEventListener('click', joinRoom);
  $('netLeave').addEventListener('click', () => location.reload());
  $('qualGo').addEventListener('click', () => {
    if (qual.stage < qualStageCount() - 1) {
      qual.stage++;
      startStage();
      return;
    }
    grid = qual.rows.map((r) => r.driver);
    qual = null;
    $('qual').hidden = true;
    inGarage = false;
    setup();
  });
  $('nextRace').addEventListener('click', () => {
    if (net) backToRoom();
    else openGarage();
  });
  $('garageParts').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || partsLocked()) return;
    const before = loadout[b.dataset.slot];
    loadout[b.dataset.slot] = b.dataset.maker;
    if (breakBase && partsChanged() > DATA.season.breakParts) loadout[b.dataset.slot] = before;
    renderGarage();
  });
  $('garageSettings').addEventListener('input', (e) => {
    loadout.setting[e.target.dataset.setting] = Number(e.target.value);
    renderGarage(true);
  });
  $('garageColors').addEventListener('click', (e) => {
    if (!e.target.dataset.color) return;
    setColor(e.target.dataset.color);
    renderGarage();
  });
  addEventListener('resize', () => renderer.resize());

  setSpeed(1);
  HoverCareer.apply(DATA, career);
  $('brandName').textContent = player.name;
  loadSeason();
  setup();
  openGarage();
  // 글꼴이 늦게 오면 트랙 글자를 다시 그린다.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => renderer.resize());
  requestAnimationFrame((t) => {
    last = t;
    frame(t);
  });
})();
