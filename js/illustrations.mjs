// 东方水彩插画画廊：把裁剪好的 9 张透明 PNG 作为“阅读氛围”装饰层渲染。
// 与 motifs.mjs 的矢量线描不同，这里用的是用户提供的真实水彩插画。
// 规范（与 brief 一致）：
//   1. 走正常文档流 / Flex，绝不逐字绝对定位；不旋转、不浮动；
//   2. 真实 <img> 元素，lazy-load，空 alt、aria-hidden、不可聚焦；
//   3. 尺寸由每章配置给出（桌面 --d / 移动 --m），移动端不照搬桌面两栏；
//   4. 离线单文件版优先使用内联 base64（window.__IMAGES__），在线版走 assets/illus/*.png；
//   5. 若配置缺失或资源加载失败，renderIllustration 返回 null，调用方直接隐藏，不阻断阅读。

import { el } from './util.mjs';

export const ILLUS_ASSETS = ['ripple', 'valley', 'bowl', 'window', 'branch', 'sprout', 'roots', 'path', 'stones'];

// 五种可复用版式（与 brief 对应）
export const ILLUS_LAYOUTS = ['ripple-carry', 'farview-side', 'vessel-blank', 'branch-edge', 'passage-seal'];

export function getIllusSrc(name) {
  if (name && typeof window !== 'undefined' && window.__IMAGES__ && window.__IMAGES__[name]) {
    return window.__IMAGES__[name];
  }
  return `assets/illus/${name}.png`;
}

export function hasIllustration(cfg) {
  return !!(cfg && cfg.asset && ILLUS_ASSETS.includes(cfg.asset));
}

/**
 * 渲染一张水彩插画。
 * @param {object} cfg { asset, layout, desktop, mobile }
 *   asset   : ILLUS_ASSETS 之一
 *   layout  : ILLUS_LAYOUTS 之一（决定 CSS 版式类）
 *   desktop : 桌面端宽度(px)  | mobile : 移动端宽度(px)
 * @returns {HTMLElement|null}
 */
export function renderIllustration(cfg) {
  if (!hasIllustration(cfg)) return null;
  const layout = cfg.layout && ILLUS_LAYOUTS.includes(cfg.layout) ? cfg.layout : 'ripple-carry';
  const wrap = el('div', { class: `illus illus--${layout}`, 'aria-hidden': 'true' });
  if (cfg.desktop) wrap.style.setProperty('--d', `${cfg.desktop}px`);
  if (cfg.mobile) wrap.style.setProperty('--m', `${cfg.mobile}px`);

  const img = el('img', {
    class: 'illus__img',
    src: getIllusSrc(cfg.asset),
    alt: '',
    loading: 'lazy',
    decoding: 'async',
    draggable: 'false',
  });
  img.setAttribute('tabindex', '-1');
  img.setAttribute('focusable', 'false');
  img.addEventListener('error', () => wrap.remove(), { once: true });

  wrap.append(img);
  return wrap;
}
