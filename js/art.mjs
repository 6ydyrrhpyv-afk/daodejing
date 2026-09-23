// 原创矢量装饰资产：撕纸洞口山水、纸层山形、金缮线。
// 全部为程序绘制、无文字；生图服务恢复后可替换为摄影素材，布局不变。

import { svg } from './util.mjs';

// 首页「纸面镂空中的溪涧」：撕边洞口 + 苔石溪流蕨叶的插绘。
export function tornHoleScene() {
  const fiberEdge = svg('path', {
    d: 'M300 28 C 360 18, 420 44, 470 36 C 520 30, 556 66, 548 118 C 542 168, 566 208, 552 262 C 540 312, 560 356, 544 412 C 530 462, 552 508, 534 560 C 518 610, 536 654, 508 694 C 478 736, 420 728, 366 734 C 312 740, 262 722, 214 728 C 166 734, 122 712, 104 664 C 88 620, 100 574, 88 526 C 76 480, 52 438, 64 386 C 74 340, 58 296, 76 248 C 92 206, 78 160, 104 120 C 132 78, 186 74, 232 56 C 258 46, 276 32, 300 28 Z',
    fill: 'none',
    stroke: '#E4DECD',
    'stroke-width': 7,
    'stroke-dasharray': '2 3',
    opacity: .9,
  });
  const defs = svg('defs', {}, [
    svg('linearGradient', { id: 'sky', x1: 0, y1: 0, x2: 0, y2: 1 }, [
      svg('stop', { offset: '0%', 'stop-color': '#EDF0E8' }),
      svg('stop', { offset: '100%', 'stop-color': '#F7F5EC' }),
    ]),
    svg('linearGradient', { id: 'water', x1: 0, y1: 0, x2: 0, y2: 1 }, [
      svg('stop', { offset: '0%', 'stop-color': '#D7E0D6' }),
      svg('stop', { offset: '100%', 'stop-color': '#C3D2CB' }),
    ]),
    svg('clipPath', { id: 'hole' }, [
      svg('path', { d: 'M300 40 C 356 31, 412 55, 458 48 C 504 42, 538 74, 531 120 C 525 166, 548 204, 535 254 C 524 300, 542 342, 527 394 C 514 440, 535 484, 518 532 C 503 578, 520 618, 494 654 C 466 692, 414 685, 364 690 C 314 696, 268 679, 224 685 C 180 690, 141 670, 125 627 C 110 587, 121 545, 110 501 C 99 459, 77 421, 88 373 C 97 331, 82 291, 99 247 C 114 209, 101 167, 125 131 C 150 93, 199 89, 241 72 C 265 63, 281 43, 300 40 Z' }),
    ]),
  ]);
  const scene = svg('g', { 'clip-path': 'url(#hole)' }, [
    svg('rect', { x: 40, y: 20, width: 540, height: 700, fill: 'url(#sky)' }),
    // 远山（深青，起伏柔和）
    svg('path', { d: 'M40 340 C 120 300, 170 250, 230 262 C 290 274, 320 220, 380 228 C 440 236, 470 200, 560 250 L 560 720 L 40 720 Z', fill: '#2E5350', opacity: .42 }),
    svg('path', { d: 'M40 420 C 130 380, 200 330, 280 352 C 360 374, 420 316, 500 344 C 530 354, 548 350, 560 344 L 560 720 L 40 720 Z', fill: '#294B49', opacity: .62 }),
    // 山谷雾带
    svg('ellipse', { cx: 300, cy: 430, rx: 250, ry: 46, fill: '#F4F2E7', opacity: .5 }),
    svg('ellipse', { cx: 180, cy: 470, rx: 150, ry: 30, fill: '#F4F2E7', opacity: .4 }),
    // 两岸苔坡（中间留出溪道）
    svg('path', { d: 'M40 520 C 120 490, 190 502, 236 530 C 262 546, 268 600, 260 720 L 40 720 Z', fill: '#53614A' }),
    svg('path', { d: 'M560 510 C 480 486, 420 500, 372 526 C 348 540, 342 600, 350 720 L 560 720 Z', fill: '#4C5A45' }),
    // 溪流：自上而下渐宽的蜿蜒水道
    svg('path', { d: 'M296 40 C 282 120, 330 170, 306 240 C 288 292, 322 330, 306 392 C 292 444, 318 490, 300 560 C 288 610, 306 660, 292 720 L 396 720 C 380 660, 398 606, 384 552 C 370 496, 396 448, 382 392 C 370 340, 398 296, 384 240 C 372 186, 408 120, 396 40 Z', fill: 'url(#water)' }),
    // 水纹与落差点
    svg('path', { d: 'M330 120 C 322 170, 350 210, 336 268 M 322 340 C 314 392, 340 430, 328 492 M 318 570 C 312 616, 330 656, 322 700', fill: 'none', stroke: '#FFFFFF', 'stroke-width': 2.6, 'stroke-linecap': 'round', opacity: .55 }),
    svg('g', { fill: '#F7F5EC', opacity: .85 }, [
      svg('circle', { cx: 342, cy: 150, r: 3 }), svg('circle', { cx: 330, cy: 210, r: 2.4 }),
      svg('circle', { cx: 334, cy: 300, r: 2.8 }), svg('circle', { cx: 326, cy: 452, r: 2.4 }),
      svg('circle', { cx: 330, cy: 540, r: 3 }), svg('circle', { cx: 324, cy: 636, r: 2.6 }),
    ]),
    // 苔石群（压住溪道下段，形成「水绕石」）
    svg('g', {}, [
      svg('ellipse', { cx: 214, cy: 586, rx: 78, ry: 48, fill: '#5E6B4E' }),
      svg('ellipse', { cx: 202, cy: 572, rx: 46, ry: 26, fill: '#6E7B5B', opacity: .85 }),
      svg('ellipse', { cx: 300, cy: 640, rx: 66, ry: 40, fill: '#57644A' }),
      svg('ellipse', { cx: 292, cy: 628, rx: 38, ry: 22, fill: '#68755A', opacity: .85 }),
      svg('ellipse', { cx: 408, cy: 606, rx: 84, ry: 50, fill: '#5E6B4E' }),
      svg('ellipse', { cx: 420, cy: 592, rx: 48, ry: 26, fill: '#6E7B5B', opacity: .85 }),
      svg('ellipse', { cx: 350, cy: 700, rx: 140, ry: 44, fill: '#4E5B43' }),
      svg('ellipse', { cx: 340, cy: 690, rx: 84, ry: 26, fill: '#5F6C50', opacity: .85 }),
    ]),
    // 蕨叶（左右两丛，斜向溪心）
    svg('g', { stroke: '#77855F', 'stroke-width': 4, fill: 'none', 'stroke-linecap': 'round' }, [
      svg('path', { d: 'M132 640 C 136 586, 156 552, 188 528 M 132 640 C 116 596, 118 564, 134 538' }),
      svg('path', { d: 'M154 588 l -20 -8 M 162 560 l -22 -10 M 174 542 l -18 -12 M 120 612 l 20 -8 M 116 584 l 20 -8' }),
      svg('path', { d: 'M492 560 C 498 512, 516 486, 542 470 M 492 560 C 478 526, 476 500, 486 478 M 506 522 l -20 -8 M 518 498 l -20 -10 M 496 540 l 16 -8' }),
      svg('path', { d: 'M452 660 C 458 622, 472 600, 492 588 M 452 660 C 442 632, 442 612, 450 596' }),
    ]),
  ]);
  return svg('svg', {
    viewBox: '0 0 640 760',
    class: 'art art-hole',
    role: 'img',
    'aria-label': '装饰插画：宣纸撕边洞口中的山涧、苔石与蕨叶',
  }, [defs, scene, fiberEdge]);
}

// 纸层山形横带（图四语言：深青 × 赭黄 × 纸白，撕纸叠层 + 路径感）。
export function mountainStrip() {
  return svg('svg', {
    viewBox: '0 0 1200 150',
    class: 'art art-strip',
    role: 'img',
    'aria-label': '装饰插画：纸层山形与蜿蜒路径',
    preserveAspectRatio: 'none',
  }, [
    svg('path', { d: 'M0 118 L 90 96 L 180 112 L 300 84 L 420 108 L 540 80 L 660 104 L 780 76 L 900 100 L 1020 72 L 1140 96 L 1200 84 L 1200 150 L 0 150 Z', fill: '#D9D2BF' }),
    svg('path', { d: 'M0 128 L 120 108 L 240 124 L 380 98 L 520 122 L 660 96 L 800 120 L 940 94 L 1080 118 L 1200 100 L 1200 150 L 0 150 Z', fill: '#294B49', opacity: .92 }),
    svg('path', { d: 'M0 140 L 150 124 L 300 138 L 470 116 L 640 138 L 810 114 L 980 136 L 1140 116 L 1200 126 L 1200 150 L 0 150 Z', fill: '#B59658', opacity: .9 }),
    svg('path', { d: 'M20 122 C 220 96, 420 128, 620 100 C 820 74, 1020 106, 1180 84', fill: 'none', stroke: '#F3EFE5', 'stroke-width': 2, 'stroke-dasharray': '1 7', 'stroke-linecap': 'round', opacity: .85 }),
  ]);
}

// 金缮线（图二语言：金线修复的裂痕，仅作小面积装饰，不作价值判断）。
export function kintsugiLine(width = 260, height = 64) {
  return svg('svg', {
    viewBox: '0 0 260 64',
    width,
    height,
    class: 'art art-kintsugi',
    role: 'img',
    'aria-label': '装饰插画：金缮细线',
  }, [
    svg('defs', {}, [
      svg('linearGradient', { id: 'gold', x1: 0, y1: 0, x2: 1, y2: 0 }, [
        svg('stop', { offset: '0%', 'stop-color': '#C8A96A' }),
        svg('stop', { offset: '50%', 'stop-color': '#B29351' }),
        svg('stop', { offset: '100%', 'stop-color': '#D4B87E' }),
      ]),
    ]),
    svg('path', {
      d: 'M6 44 L 48 36 L 82 46 L 122 24 L 158 40 L 196 18 L 254 30',
      fill: 'none', stroke: 'url(#gold)', 'stroke-width': 3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    }),
    svg('path', { d: 'M48 36 L 60 54 L 96 58 M 158 40 L 170 56 L 206 58', fill: 'none', stroke: 'url(#gold)', 'stroke-width': 1.6, opacity: .8 }),
    svg('g', { fill: '#C8A96A' }, [
      svg('path', { d: 'M118 20 l 7 3 -6 4 z' }),
      svg('path', { d: 'M192 14 l 8 3 -6 5 z' }),
    ]),
  ]);
}

// 朱砂小印章（装饰，外框 + 留白，实际文字用 HTML 渲染）。
export function sealFrame() {
  return svg('svg', {
    viewBox: '0 0 44 44',
    class: 'art art-seal',
    'aria-hidden': 'true',
    focusable: 'false',
  }, [
    svg('rect', { x: 2, y: 2, width: 40, height: 40, rx: 4, fill: 'none', stroke: '#9E3C31', 'stroke-width': 2.4, opacity: .85 }),
    svg('rect', { x: 6.5, y: 6.5, width: 31, height: 31, rx: 2, fill: 'none', stroke: '#9E3C31', 'stroke-width': 1, opacity: .5 }),
  ]);
}
