// 章节意象线描库：一套统一的原创 SVG 文学阅读视觉语言。
// 规范：viewBox 统一 64×64；线宽 1.5；圆角端点；默认无填充（仅「小径」用一处淡色填充）；
// 颜色一律 currentColor 跟随章节主题；全部 aria-hidden + focusable=false，不可点击、不进 Tab 焦点。
// 不使用 emoji / 彩色贴纸 / 太极八卦 / 香炉符箓 / 仙鹤 / 佛像莲花寺院等元素。

import { svg } from './util.mjs';

const VB = '0 0 64 64';
const STROKE = 1.5;

// 统一的描边属性：细线、圆头、少量不完全对称
const line = (extra = {}) => ({
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': STROKE,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  ...extra,
});

// 每个意象返回若干 SVG 子节点（不包 svg 外壳，由 renderMotif 统一包装）
const MOTIFS = {
  // 水纹：2–3 条不完全闭合的椭圆细线 —— 水、柔、流动
  water: () => [
    svg('path', { d: 'M8 26 C 18 18, 46 18, 56 26', ...line() }),
    svg('path', { d: 'M5 36 C 18 27, 46 45, 59 36', ...line({ 'stroke-opacity': .8 }) }),
    svg('path', { d: 'M12 46 C 22 39, 42 53, 52 46', ...line({ 'stroke-opacity': .6 }) }),
  ],

  // 山谷：两侧低缓轮廓，中间留空 —— 谷、容纳、低处
  valley: () => [
    svg('path', { d: 'M4 52 C 12 44, 17 34, 21 25', ...line() }),
    svg('path', { d: 'M60 52 C 52 44, 47 34, 43 25', ...line() }),
    svg('path', { d: 'M8 54 C 24 58, 40 58, 56 54', ...line({ 'stroke-opacity': .55 }) }),
  ],

  // 空器：简洁陶器外轮廓，内部留白 —— 有无、器用
  vessel: () => [
    svg('path', { d: 'M22 16 H42', ...line() }),
    svg('path', { d: 'M22 16 C 18 29, 14 38, 19 47 C 22 51, 42 51, 45 47 C 50 38, 46 29, 42 16', ...line() }),
    svg('path', { d: 'M21 52 C 27 55, 37 55, 43 52', ...line({ 'stroke-opacity': .5 }) }),
  ],

  // 门窗：细线框及一处开口 —— 空间、出入、器用
  window: () => [
    svg('path', { d: 'M12 12 H52 V52 H12 Z', ...line() }),
    svg('path', { d: 'M32 12 V52', ...line({ 'stroke-opacity': .6 }) }),
    svg('path', { d: 'M12 32 H52', ...line({ 'stroke-opacity': .6 }) }),
    // 一处开启的窗扇（斜开的细线框）
    svg('path', { d: 'M34 31 L47 27 V47 L34 45 Z', ...line({ 'stroke-opacity': .85 }) }),
  ],

  // 弯枝：一根自然弯曲的细枝，少量叶片 —— 柔、生命、生长
  branch: () => [
    svg('path', { d: 'M9 57 C 23 51, 29 35, 43 23 C 47 19, 52 17, 57 16', ...line() }),
    svg('path', { d: 'M25 45 C 29 38, 36 37, 39 41 C 34 48, 27 49, 25 45 Z', ...line({ 'stroke-opacity': .75 }) }),
    svg('path', { d: 'M34 31 C 38 25, 45 24, 48 28 C 43 34, 36 35, 34 31 Z', ...line({ 'stroke-opacity': .75 }) }),
    svg('path', { d: 'M44 22 C 47 18, 52 17, 54 20 C 51 24, 46 25, 44 22 Z', ...line({ 'stroke-opacity': .6 }) }),
  ],

  // 微芽：小芽与短地线 —— 微小、起始、积累
  sprout: () => [
    svg('path', { d: 'M16 52 H48', ...line({ 'stroke-opacity': .55 }) }),
    svg('path', { d: 'M32 52 V33', ...line() }),
    svg('path', { d: 'M32 40 C 26 38, 21 34, 21 28 C 27 28, 31 33, 32 40 Z', ...line({ 'stroke-opacity': .8 }) }),
    svg('path', { d: 'M32 37 C 38 35, 43 31, 43 25 C 37 25, 33 30, 32 37 Z', ...line({ 'stroke-opacity': .8 }) }),
  ],

  // 归根：简化树干与根部轮廓 —— 复归、根本
  root: () => [
    svg('path', { d: 'M32 17 V41', ...line() }),
    svg('path', { d: 'M32 26 C 27 22, 24 20, 19 17', ...line({ 'stroke-opacity': .7 }) }),
    svg('path', { d: 'M32 29 C 37 25, 41 23, 45 21', ...line({ 'stroke-opacity': .7 }) }),
    svg('path', { d: 'M32 41 C 27 47, 23 51, 18 55', ...line() }),
    svg('path', { d: 'M32 41 C 37 47, 41 51, 46 55', ...line() }),
    svg('path', { d: 'M32 41 V56', ...line({ 'stroke-opacity': .65 }) }),
  ],

  // 小径：一条逐渐变细的曲线 —— 行进、实践（唯一一处淡色填充，用于表现由宽变窄）
  path: () => [
    svg('path', {
      d: 'M10 58 L22 58 C 32 46, 37 32, 39 12 L36 12 C 32 32, 26 46, 10 58 Z',
      fill: 'currentColor',
      'fill-opacity': .18,
      stroke: 'currentColor',
      'stroke-width': STROKE,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'stroke-opacity': .55,
    }),
  ],

  // 素石：两三块不规则圆石的轮廓 —— 朴素、安定
  stone: () => [
    svg('path', { d: 'M12 47 C 9 38, 16 31, 25 32 C 32 33, 35 40, 33 47 C 31 53, 18 54, 12 47 Z', ...line() }),
    svg('path', { d: 'M35 51 C 33 44, 39 39, 45 40 C 50 41, 52 47, 49 51 C 46 56, 38 56, 35 51 Z', ...line({ 'stroke-opacity': .8 }) }),
    svg('path', { d: 'M19 32 C 18 26, 22 22, 27 23 C 31 24, 32 29, 30 32 C 27 36, 22 36, 19 32 Z', ...line({ 'stroke-opacity': .6 }) }),
  ],

  // 未雕之木：简洁木块轮廓，极少纹理 —— 朴、自然
  wood: () => [
    svg('path', { d: 'M14 21 L50 17 L52 45 L16 48 Z', ...line() }),
    svg('path', { d: 'M21 29 L46 26', ...line({ 'stroke-opacity': .5 }) }),
    svg('path', { d: 'M23 37 L44 34', ...line({ 'stroke-opacity': .35 }) }),
  ],

  // 递减细线：第 48 章「为道日损」专用，仅用线的长度递减表达「减少」，
  // 不删除、不淡出、不隐藏任何原文。
  decrease: () => [
    svg('path', { d: 'M8 15 H56', ...line() }),
    svg('path', { d: 'M8 25 H44', ...line() }),
    svg('path', { d: 'M8 35 H34', ...line() }),
    svg('path', { d: 'M8 45 H24', ...line() }),
    svg('path', { d: 'M8 55 H16', ...line() }),
  ],

  // 无明确意象：极淡水汽，让章节完全依靠文字与留白成立
  mist: () => [
    svg('path', { d: 'M10 34 C 22 28, 42 40, 54 34', ...line({ 'stroke-opacity': .16 }) }),
    svg('path', { d: 'M14 44 C 26 39, 40 49, 50 44', ...line({ 'stroke-opacity': .1 }) }),
  ],
};

export const MOTIF_IDS = Object.keys(MOTIFS);

/**
 * 渲染一个意象 SVG。
 * @param {string} id 意象 id，取自 MOTIF_IDS
 * @param {object} opts { className: 追加的 CSS 类；title: 无障碍说明（装饰性默认不传） }
 * @returns {SVGElement|null} id 无效时返回 null（调用方直接隐藏，不阻断阅读）
 */
export function renderMotif(id, opts = {}) {
  const build = MOTIFS[id];
  if (!build) return null;
  const cls = ['motif'];
  if (opts.className) cls.push(opts.className);
  return svg('svg', {
    viewBox: VB,
    class: cls.join(' '),
    'aria-hidden': 'true',
    focusable: 'false',
  }, build());
}

/** 判断意象 id 是否有效（用于「加载失败/无效时直接隐藏装饰」） */
export function hasMotif(id) {
  return Object.prototype.hasOwnProperty.call(MOTIFS, id);
}
