// 부위별 차 모양. 차는 오른쪽을 본다. 앞코는 x=30, 꼬리는 x=-42에서 몸통과 만나고 이음새 폭은 위아래 16으로 같다.
(function (root) {
  const mir = (d) => d + ' ' + d.replace(/(-?\d+) (-?\d+)/g, (m, x, y) => x + ' ' + -Number(y));
  const circ = (cx, r) => `M${cx - r} 0 A${r} ${r} 0 1 1 ${cx + r} 0 A${r} ${r} 0 1 1 ${cx - r} 0 Z`;

  const ART = {
    wing: {
      nova: [['dim', mir('M10 -10 L-48 -46 L-68 -46 L-30 -10 Z')]],
      volt: [['dim', mir('M20 -14 C6 -44 -30 -50 -46 -46 C-42 -34 -36 -24 -30 -14 Z')]],
      kage: [['shadow', mir('M20 -12 L-16 -54 L-60 -54 L-30 -12 Z')], ['color', mir('M-10 -42 L36 -42 L36 -35 L-10 -35 Z')]],
      helios: [['dim', mir('M-20 -36 L20 -36 L20 -8 L-20 -8 Z')], ['color', mir('M72 -38 C50 -49 -40 -49 -76 -45 L-76 -29 C-40 -25 50 -27 72 -38 Z')]],
      titan: [['dim', mir('M-16 -38 L16 -38 L16 -10 L-16 -10 Z')], ['dim', mir('M-30 -52 L42 -52 L42 -36 L-30 -36 Z')], ['white', mir('M42 -52 L50 -44 L42 -36 Z')]],
    },
    tail: {
      nova: [['color', 'M-42 -14 L-78 -12 L-78 12 L-42 14 Z'], ['white', 'M-85 -7 A5 5 0 1 1 -75 -7 A5 5 0 1 1 -85 -7 Z M-85 7 A5 5 0 1 1 -75 7 A5 5 0 1 1 -85 7 Z']],
      volt: [['color', 'M-42 -16 C-66 -16 -84 -10 -84 0 C-84 10 -66 16 -42 16 Z'], ['dark', 'M-76 -8 L-70 -8 L-70 8 L-76 8 Z']],
      kage: [['shadow', 'M-42 -16 L-84 -30 L-66 0 L-84 30 L-42 16 Z'], ['white', 'M-58 -8 L-54 -8 L-54 8 L-58 8 Z']],
      helios: [['color', 'M-42 -16 L-82 -24 L-82 -10 L-56 -4 L-56 4 L-82 10 L-82 24 L-42 16 Z']],
      titan: [['color', 'M-42 -16 L-76 -20 L-88 -12 L-88 12 L-76 20 L-42 16 Z'], ['dark', 'M-88 -7 L-74 -7 L-74 7 L-88 7 Z']],
    },
    body: {
      nova: [['color', 'M36 -16 L-48 -16 L-48 16 L36 16 Z'], ['dark', 'M-10 0 A18 6 0 0 1 26 0 A18 6 0 0 1 -10 0 Z']],
      volt: [['color', 'M36 -16 C24 -36 -34 -38 -48 -16 L-48 16 C-34 38 24 36 36 16 Z'], ['dark', 'M22 -14 C28 -6 28 6 22 14 L-16 14 L-16 -14 Z']],
      kage: [['shadow', 'M36 -16 L-4 -30 L-48 -16 L-48 16 L-4 30 L36 16 Z'], ['color', 'M24 0 L-6 -9 L-24 0 L-6 9 Z']],
      helios: [['color', 'M36 -16 L-48 -16 L-48 16 L36 16 Z'], ['white', circ(-6, 24)], ['dark', circ(-6, 18)], ['white', circ(-6, 7)]],
      titan: [['color', 'M36 -16 L24 -32 L-40 -32 L-48 -16 L-48 16 L-40 32 L24 32 L36 16 Z'], ['dark', circ(-6, 20)], ['color', circ(-6, 8)]],
    },
    nose: {
      nova: [['color', 'M30 -16 L104 0 L30 16 Z']],
      volt: [['color', 'M30 -16 C58 -16 86 -12 94 0 C86 12 58 16 30 16 Z'], ['dark', 'M84 -2 L56 -4 L60 0 L38 -2 L38 2 L56 4 L52 0 L84 2 Z']],
      kage: [['shadow', 'M30 -16 L62 -16 L100 -3 L100 3 L62 16 L30 16 Z'], ['color', 'M84 0 L56 -5 L56 5 Z']],
      helios: [['color', 'M30 -16 L98 -20 L62 -6 L62 6 L98 20 L30 16 Z']],
      titan: [['dark', 'M60 -4 L104 -4 L104 4 L60 4 Z'], ['color', 'M30 -16 L70 -16 L82 -8 L82 8 L70 16 L30 16 Z'], ['dark', 'M76 -4 L104 -4 L104 4 L76 4 Z']],
    },
  };

  // 아래에 깔리는 부위부터 쌓는다.
  function carShapes(lo) {
    const out = [];
    for (const slot of ['wing', 'tail', 'body', 'nose']) {
      for (const [fill, d] of ART[slot][lo[slot]]) {
        out.push({ fill, d, path: new Path2D(d), glow: fill === 'color' || fill === 'shadow', stroke: fill === 'shadow' });
      }
    }
    return out;
  }

  function paint(fill, color) {
    if (fill === 'color') return color;
    if (fill === 'dark') return '#0A1020';
    if (fill === 'white') return '#FFFFFF';
    if (fill === 'shadow') return '#1B1230';
    return color + '88'; // dim
  }

  // ctx는 이미 차 위치로 옮겨 둔 상태여야 한다. glow는 빛 번짐 크기.
  function drawShapes(ctx, shapes, color, glow) {
    for (const part of shapes) {
      if (part.glow) {
        ctx.shadowColor = color;
        ctx.shadowBlur = glow;
      }
      ctx.fillStyle = paint(part.fill, color);
      ctx.fill(part.path);
      if (part.stroke) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 7;
        ctx.stroke(part.path);
      }
      ctx.shadowBlur = 0;
    }
  }

  root.HoverArt = { carShapes, drawShapes };
})(window);
