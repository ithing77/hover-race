// 게임 수치 원본. 밸런스는 이 파일만 고치면 된다.
(function (root) {
  const DATA = {
    race: { seed: 2026 },

    // 트랙. poly는 꼭짓점 [x, y, 둥글리는 반지름]이고 start가 곧 출발선이다. 시계 방향으로 돈다.
    // 첫 직선 바깥에 정비소가 붙으니 첫 직선은 400 이상 길어야 한다.
    // laps는 경기 시간이 8분 반쯤 되게, drain은 바퀴당 에너지 소모.
    tracks: [
      {
        id: 'neon', name: '네온 서킷', desc: '직선과 코너가 반반. 고르게 맞춘 차가 좋아.',
        width: 57, laps: 28, drain: 7.5,
        start: [170, 110],
        poly: [[710, 110, 80], [710, 290, 60], [420, 290, 45], [420, 400, 45], [710, 400, 50], [710, 530, 60], [80, 530, 80], [130, 320, 90], [70, 110, 60]],
      },
      {
        id: 'speedway', name: '고속 직선', desc: '긴 직선과 큰 코너. 최고 속도가 빛나지만 에너지가 빨리 닳아.',
        width: 57, laps: 41, drain: 5.9,
        start: [280, 100],
        poly: [[850, 100, 210], [850, 570, 210], [510, 570, 110], [420, 490, 90], [330, 570, 110], [60, 570, 210], [60, 100, 210]],
      },
      {
        id: 'city', name: '꼬불 시가지', desc: '짧은 직선에 코너가 계속. 코너링과 가속이 중요하고 추월이 어려워.',
        width: 44, laps: 19, drain: 11,
        start: [120, 90],
        poly: [[680, 90, 50], [680, 220, 45], [540, 220, 40], [540, 320, 40], [720, 320, 45], [720, 540, 50], [600, 540, 40], [600, 430, 40], [460, 430, 40], [460, 540, 40], [300, 540, 40], [300, 400, 40], [190, 400, 40], [190, 540, 40], [60, 540, 50], [60, 280, 45], [260, 280, 40], [260, 190, 40], [60, 190, 40], [60, 90, 40]],
      },
      {
        id: 'wave', name: '파도 고리', desc: '큰 곡선이 이어져. 코너링과 안정성이 좋은 차가 유리해.',
        width: 57, laps: 40, drain: 5.3,
        start: [190, 90],
        poly: [[790, 90, 110], [640, 500, 80], [470, 250, 80], [300, 500, 80], [60, 90, 70]],
      },
      {
        id: 'canyon', name: '좁은 협곡', desc: '폭이 좁아 비킬 틈이 적어. 무거운 차와 막기·들이받기가 잘 먹혀.',
        width: 38, laps: 26, drain: 8,
        start: [170, 100],
        poly: [[700, 100, 70], [700, 260, 60], [300, 260, 55], [300, 370, 55], [700, 370, 60], [700, 530, 70], [70, 530, 80], [70, 100, 70]],
      },
    ],

    // 시즌. 점수는 F1과 같고, breakAfter 경기가 끝나면 휴식기에 부위를 바꿀 수 있다.
    season: {
      calendar: ['neon', 'speedway', 'city', 'wave', 'canyon', 'city', 'speedway', 'wave', 'canyon', 'neon'],
      points: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
      breakAfter: 5, breakParts: 2,
    },

    // 예선. 정비소에서 시간차를 두고 나가 한 바퀴 기록을 잰다. 세 단계로 뒤쪽 차가 떨어진다.
    // cut은 다음 단계로 가는 대수. 전투와 충돌은 없고 앞차에 막히는 것만 있다.
    qualifying: {
      cut: [8, 5],
      stageLaps: 3.6, // 한 단계 제한 시간(바퀴 기록의 몇 배)
      outSpeed: 0.88, // 준비 바퀴 속도
      tow: 1.006, // 앞차 뒤에 적당히 붙으면 빨라지는 배수
      modes: {
        safe: { name: '안전하게', time: 1, mistake: 0, lose: 0 },
        attack: { name: '공격적으로', time: 0.992, mistake: 0.2, lose: 0.018 },
      },
      aiAttack: 0.4,
    },

    // 능력치 1점이 실제 움직임에 주는 값
    physics: {
      topSpeedBase: 133, topSpeedPerStat: 9,
      accelBase: 50, accelPerStat: 12,
      gripBase: 150, gripPerStat: 11,
      raceFormSwing: 0.006,
      brake: 260,
      lapSwingBase: 0.03, lapSwingPerStat: 0.0025,
      afterFinishSpeed: 0.55,
      gridSpacing: 30,
    },

    // 에너지. 지금은 달리는 데만 쓴다. 사격·방어막은 전투 단계에서 나눠 쓴다.
    energy: {
      emptySpeed: 0.7, // 다 떨어졌을 때 속도 배수
      slipRange: 40, // 앞차와 이 거리 안이면 에너지가 덜 닳는다
      slipDrain: 0.8,
    },

    // 라인과 충돌. 거리 단위는 트랙 좌표와 같다.
    traffic: {
      laneRoom: 5, // 도로 가장자리에서 이만큼 안쪽까지만 일부러 달린다
      wallRoom: 3.5, // 가장자리에서 이만큼이 벽이라 긁히면 느려진다
      lineEffect: 0.35, // 안쪽·바깥쪽 차이의 세기
      lateralSpeed: 34, // 초당 옆으로 움직이는 거리
      carLength: 24, carWidth: 11,
      followGap: 20, // 앞차와 이 거리 안이고 같은 줄이면 막힌다
      passOffset: 13, // 앞차를 피할 때 옆으로 비키는 거리
      lookAhead: 34,
      crash: {
        gap: 12, lane: 7, cooldown: 0.8,
        damage: 3, ramDamage: 1.25, rearSpeed: 0.97, frontSpeed: 0.995,
        push: 85, pushDecay: 5,
        startGrace: 6, graceDamage: 0.25,
      },
      wallSpeed: 0.994,
      cleanAir: 1.002, // 앞에 차가 없으면 조금 빠르다. 앞자리의 이득
    },
    drives: {
      normal: { name: '기본' },
      block: { name: '막아', speed: 0.993, range: 45 },
      ram: { name: '들이받아', range: 35 },
    },

    // 팀별 AI 성격. 규칙은 플레이어와 같고 판단만 다르다.
    // pushUntil: 경주의 이 비율까지 밀어붙임 / pushFrom: 끝까지 버틸 에너지가 되면 이 비율부터 밀어붙임
    // pushGap: 앞차가 이 거리 안이면 밀어붙임 / fastFuel: 빠른 연료를 고를 확률
    // pitBelow: 정비하러 들어올 에너지 범위 / undercut: 앞차가 가깝고 에너지가 이보다 적으면 먼저 정비
    ai: {
      common: { pushEnergy: 35, undercutGap: 260, shieldEnergy: 20 },
      nova: { pushUntil: 0.06, pushFrom: 1, pushGap: 60, fastFuel: 0.6, pitBelow: [10, 16], undercut: 20, fireAbove: 20, shieldAt: 80, baseSave: false, ram: false, block: true },
      volt: { pushUntil: 0, pushFrom: 0.7, pushGap: 0, fastFuel: 0.15, pitBelow: [8, 14], undercut: 0, fireAbove: 25, shieldAt: 80, baseSave: false, ram: false, block: false },
      kage: { pushUntil: 0, pushFrom: 0.85, pushGap: 60, fastFuel: 0.5, pitBelow: [8, 14], undercut: 20, fireAbove: 15, shieldAt: 90, baseSave: false, ram: false, block: true },
      helios: { pushUntil: 0, pushFrom: 0.6, pushGap: 0, fastFuel: 0.4, pitBelow: [8, 14], undercut: 0, fireAbove: 30, shieldAt: 70, baseSave: true, ram: false, block: false },
      titan: { pushUntil: 0, pushFrom: 0.9, pushGap: 0, fastFuel: 0.3, pitBelow: [12, 18], undercut: 0, fireAbove: 12, shieldAt: 75, baseSave: false, ram: true, block: false },
    },

    // 무전 지시. speed는 속도 배수, drain은 에너지 소모 배수.
    orders: {
      push: { name: '밀어붙여', speed: 1.03, drain: 1.6 },
      normal: { name: '보통', speed: 1, drain: 1 },
      save: { name: '아껴', speed: 0.975, drain: 0.65 },
    },

    // 전투. 맞으면 충격이 쌓여 느려지고, 가득 차면 재부팅된다. 탈락은 없다.
    combat: {
      meterDecay: 2.5, // 초당 줄어드는 충격
      slowPerMeter: 0.0009, // 충격 1당 속도 감소
      staggerTime: 0.35, staggerSpeed: 0.94, // 맞은 직후 잠깐 휘청임
      reboot: { at: 100, time: 4, speed: 0.45, meterAfter: 30 },
      shield: { time: 4, cost: 3, cooldown: 14, damage: 0.15, decayBoost: 3 },
      // 무기는 날개를 따라간다. dir은 any(앞뒤 모두) 또는 ahead(앞차만).
      weapons: {
        kage: { name: '측면 기관총', kind: 'gun', dir: 'any', range: 70, cooldown: 0.25, damage: 2, accuracy: 0.7, cost: 0.015, flight: 0 },
        titan: { name: '미사일', kind: 'missile', dir: 'ahead', range: 220, cooldown: 5, damage: 48, accuracy: 0.9, cost: 0.25, flight: 0.6 },
        nova: { name: '소형 로켓', kind: 'rocket', dir: 'ahead', range: 130, cooldown: 2.5, damage: 20, accuracy: 0.8, cost: 0.12, flight: 0.25 },
        volt: { name: '전기 충격', kind: 'shock', dir: 'any', range: 45, cooldown: 1.5, damage: 3, accuracy: 0.9, cost: 0.1, flight: 0, energyDrain: 1 },
        helios: { name: '약한 기관총', kind: 'gun', dir: 'ahead', range: 80, cooldown: 0.3, damage: 4, accuracy: 0.7, cost: 0.01, flight: 0 },
      },
    },

    // 추진 연료. 정비할 때 고른다.
    fuels: {
      fast: { name: '빠른 연료', speed: 1.012, drain: 1.2 },
      long: { name: '오래가는 연료', speed: 0.994, drain: 0.85 },
    },
    startFuel: 'fast',

    // 정비소는 출발선 뒤 첫 직선 바깥에 있다. 값은 출발선에서 잰 거리.
    pit: {
      entry: 30, exit: 335, ramp: 45,
      laneGap: 24, // 도로 가장자리에서 정비 도로 중심까지 거리
      speed: 90, // 정비 도로 제한 속도
      firstBox: 85, boxGap: 46, // 팀별 정비 칸 위치
      waitGap: 18, // 같은 팀 차가 정비 중일 때 뒤에서 기다리는 거리
      fillPerSec: 40, baseTime: 0.5,
    },

    // 제조사. 부위와 엔진은 이 다섯 곳에서 고른다.
    makers: { nova: '노바', volt: '볼트', kage: '카게', helios: '헬리오스', titan: '타이탄' },

    // 부위. 능력치는 더해서 1~10으로 자른다. 코너링과 가속이 특히 강해서 차이를 좁게 뒀다.
    // 앞코=최고 속도, 몸통=안정성·맷집·무게, 날개=코너링·무기, 꼬리=가속.
    // armor는 충격을 줄이는 비율, drain은 에너지 소모 증감, weight는 충돌 단계에서 쓴다.
    parts: {
      nose: {
        nova: { top: 9, corner: -0.6 },
        volt: { top: 6.5, corner: 0.6 },
        kage: { top: 7.7 },
        helios: { top: 7.5 },
        titan: { top: 7, weight: 1 },
      },
      body: {
        nova: { stability: 5, armor: 0, weight: 2 },
        volt: { stability: 8, armor: 0.1, weight: 3 },
        kage: { stability: 4, armor: 0, weight: 2 },
        helios: { stability: 9, armor: 0.1, weight: 3 },
        titan: { stability: 7, armor: 0.25, weight: 5, accel: -1 },
      },
      wing: {
        nova: { corner: 5.2 },
        volt: { corner: 6.2 },
        kage: { corner: 5.5 },
        helios: { corner: 5.8 },
        titan: { corner: 5, weight: 1 },
      },
      tail: {
        nova: { accel: 6.5, drain: 0.03, trail: 'twin' },
        volt: { accel: 5.2, drain: -0.1, trail: 'wide' },
        kage: { accel: 6.8, trail: 'dash' },
        helios: { accel: 6, drain: -0.05, trail: 'split' },
        titan: { accel: 6, trail: 'thick' },
      },
    },
    slots: { nose: '앞코', body: '몸통', wing: '날개', tail: '꼬리' },

    // 능력치 합이 기준을 넘는 조합은 그만큼 에너지를 더 먹는다. 좋은 부위만 모으면 대가가 있다.
    budget: { base: 25, drainPerPoint: 0.04 },

    // 엔진. 에너지 양과 달리면서 차는 회복 속도(초당)를 정한다. 조합과 별개로 고른다.
    engines: {
      nova: { max: 100, regen: 0.05 },
      volt: { max: 85, regen: 0.08 },
      kage: { max: 100, regen: 0.04 },
      helios: { max: 115, regen: 0.02 },
      titan: { max: 130, regen: 0, weight: 1 },
    },

    // 세팅. 한쪽을 올리면 다른 쪽이 내려가는 미세 조정이고 값은 -2~2.
    settings: {
      balance: { name: '직선 ↔ 코너', low: '코너', high: '직선', top: 0.4, corner: -0.4 },
      gearing: { name: '최고 속도 ↔ 가속', low: '최고 속도', high: '가속', accel: 0.4, top: -0.4 },
      power: { name: '연비 ↔ 출력', low: '연비', high: '출력', speed: 0.003, drain: 0.04 },
    },

    // 상대 팀은 경주마다 자기 회사 부위에 한두 개를 섞어 나온다.
    aiMix: { first: 0.6, second: 0.25 },

    playerColors: ['#2DE2E6', '#4D8BFF', '#FF5B5B', '#E8EEFA'],

    teams: [
      // maker는 주로 쓰는 제조사, style은 AI 성격(ai 표의 이름). 팀과 제조사는 별개다.
      { id: 'mine', name: '내 팀', color: '#2DE2E6', maker: 'nova', style: 'nova', drivers: ['유나', '도윤'] },
      { id: 'aurora', name: '오로라 GP', color: '#FFB020', maker: 'volt', style: 'volt', drivers: ['라이', '세라'] },
      { id: 'lotus', name: '레드 로터스', color: '#FF5FB0', maker: 'kage', style: 'kage', drivers: ['진', '타로'] },
      { id: 'solaris', name: '솔라리스', color: '#B7A6FF', maker: 'helios', style: 'helios', drivers: ['마르코', '벤'] },
      { id: 'wolf', name: '아이언 울프', color: '#A8F04A', maker: 'titan', style: 'titan', drivers: ['그렉', '한나'] },
    ],
    playerTeam: 'mine',

    // 돈. 단위는 억. 상금은 순위별, 시즌 보너스는 컨스트럭터 순위별.
    money: {
      start: 40,
      prize: [14, 11, 9, 7, 6, 5, 4, 3, 2, 1],
      seasonBonus: [80, 60, 45, 30, 20],
      aiResearchChance: 0.3, // 경기마다 상대 팀이 연구 하나를 끝낼 확률
    },

    // 연구. 세지기보다 차를 다듬는 쪽이다. 한 번에 하나, races 경기가 지나면 끝난다.
    // group이 같으면 하나만 켤 수 있다. 다 끝난 연구는 차고 밖 연구소에서 켜고 끌 수 있다.
    research: {
      setBalance: { name: '공력 세팅 연구', desc: '직선 ↔ 코너 슬라이더를 끝까지 쓸 수 있어', cost: 15, races: 1, settings: true },
      setGearing: { name: '변속 세팅 연구', desc: '최고 속도 ↔ 가속 슬라이더를 끝까지 쓸 수 있어', cost: 15, races: 1, settings: true },
      setPower: { name: '출력 세팅 연구', desc: '연비 ↔ 출력 슬라이더를 끝까지 쓸 수 있어', cost: 15, races: 1, settings: true },
      crew: { name: '정비 크루 훈련', desc: '정비가 0.25초 빨라져', cost: 30, races: 2, effect: { pitSave: 0.25 } },
      lowDrag: { name: '저항 줄이기', desc: '최고 속도가 오르고 코너링이 줄어', cost: 25, races: 2, group: 'aero', effect: { top: 0.25, corner: -0.15 } },
      highGrip: { name: '접지력 높이기', desc: '코너링이 오르고 최고 속도가 줄어', cost: 25, races: 2, group: 'aero', effect: { corner: 0.2, top: -0.2 } },
      light: { name: '경량 차체', desc: '가볍고 가속이 좋아지지만 충격에 약해져', cost: 30, races: 2, group: 'frame', effect: { weight: -1, accel: 0.4, armor: -0.02 } },
      armor: { name: '보강 차체', desc: '충격에 강하고 무거워지지만 가속이 줄어', cost: 30, races: 2, group: 'frame', effect: { weight: 1, armor: 0.07, accel: -0.25 } },
      coolant: { name: '회복 냉각기', desc: '달리며 에너지가 조금 더 차지만 최고 속도가 줄어', cost: 35, races: 2, effect: { regen: 0.02, top: -0.1 } },
      shieldCell: { name: '방어막 축전지', desc: '방어막이 2초 빨리 충전돼', cost: 25, races: 2, effect: { shieldSave: 2 } },
      qualData: { name: '예선 시뮬레이터', desc: '공격적으로 달릴 때 실수가 줄어', cost: 25, races: 2, effect: { mistake: 0.6 } },
    },
    settingResearch: { balance: 'setBalance', gearing: 'setGearing', power: 'setPower' },

    // 멀티 시즌 드래프트. odds는 지난 시즌 컨스트럭터 1위부터의 추첨 비중(꼴찌일수록 큼).
    draft: { odds: [5, 10, 18, 27, 40], rookies: 8, pickSeconds: 20, aiSeconds: 1.2, lockSeasons: 2 },

    // 드라이버. 능력 숫자는 계산에만 쓰고 화면엔 말로 보여 준다. 기체 성격을 뒤집지 않을 만큼만.
    drivers: {
      paceStat: 0.001, // 빠르기 1점당 속도
      cornerStat: 0.05, // 코너 1점당 코너링 능력치
      calmStat: 0.05, // 침착 1점당 바퀴 흔들림 감소
      saverStat: 0.006, // 절약 1점당 에너지 소모 감소
      knowStat: 0.0004, knowMax: 4, // 그 트랙을 달린 경기 수만큼 빨라진다
      statLow: 2, statHigh: 8,
      youngUntil: 28, oldFrom: 34, growYoung: 0.12, growPrime: 0.03, growOld: 0.08,
      retireAge: 40, mayRetire: 37,
      marketSize: 6,
      feeBase: 15, feePerSkill: 18, feePerYouth: 3, rivalFee: 1.5,
      scoutRaces: 12, scoutError: 3,
      traits: {
        pace: { good: '직선 승부사', bad: '속도가 아쉬움' },
        corner: { good: '코너 장인', bad: '코너가 불안함' },
        calm: { good: '흔들림 없음', bad: '기복이 큼' },
        saver: { good: '연비 달인', bad: '에너지를 많이 씀' },
      },
      pool: ['유나', '도윤', '라이', '세라', '진', '타로', '마르코', '벤', '그렉', '한나', '소피', '이안', '미라', '카이', '레오', '아린', '노아', '에바', '하루', '린', '오웬', '다샤', '루카', '미나', '태오', '니코', '아야', '보리스', '시온', '엘라', '주노', '리사', '파블로', '하나', '콜', '사라', '이반', '유키', '단테', '로이', '베라', '토마', '수아', '칼', '안나', '제이', '모모', '빅터', '지안', '올가'],
    },
  };

  root.HoverData = DATA;
  if (typeof module !== 'undefined') module.exports = DATA;
})(typeof globalThis !== 'undefined' ? globalThis : this);
