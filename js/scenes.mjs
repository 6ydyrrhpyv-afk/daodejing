// 场景顶部视觉：用 <picture> 切换桌面/手机素材，输出真·透明？否，是装饰性背景图。
// 设计约束（来自升级需求）：
//  - 文字一律真实 HTML，不写进图片；桌面标题/按钮在左干净区，手机文字在上、场景在下。
//  - 装饰图空 alt / aria-hidden，不拦截点击；图片加载失败回退到匹配底色，文字按钮仍可点。
//  - 优先 AVIF → WebP → PNG；首屏关键图 eager，其余 lazy。
//  - 离线单文件版（build-standalone）会把三张场景 WebP 以 base64 注入 window.__SCENES__，
//    此处优先使用，避免离线环境相对路径失效。

import { el } from './util.mjs';

const BASE = './assets/scenes/';

// 离线版注入的 base64 场景图（键为场景名：reading / practice / reflection）
function offlineSrc(scene) {
  try {
    const m = window.__SCENES__;
    if (m && typeof m[scene] === 'string' && m[scene]) return m[scene];
  } catch (_) { /* 忽略 */ }
  return null;
}

/**
 * 生成场景顶部视觉图。
 * @param {string} scene 场景名：reading | practice | reflection
 * @param {object} opts
 *   - alt {string} 装饰用途传空串（默认），此时 aria-hidden
 *   - eager {boolean} 是否首屏关键图（默认 false → lazy）
 */
export function scenePicture(scene, opts = {}) {
  const alt = opts.alt ?? '';
  const eager = opts.eager ?? false;

  // 离线版：直接出 base64 webp，跳过 <picture> 多源
  const off = offlineSrc(scene);
  if (off) {
    const img = el('img', {
      src: off,
      alt: alt,
      class: 'scene-picture__img',
      loading: eager ? 'eager' : 'lazy',
      decoding: 'async',
    });
    if (!alt) { img.setAttribute('aria-hidden', 'true'); img.setAttribute('role', 'presentation'); }
    return el('span', { class: 'scene-picture scene-picture--offline' }, [img]);
  }

  const picture = el('picture', { class: 'scene-picture' });

  // 顺序：AVIF 优先，其次 WebP；桌面（>=768px）用 -desktop，手机用 -mobile。
  const variants = [
    ['image/avif', '(min-width: 768px)', `${BASE}${scene}-desktop.avif`],
    ['image/webp', '(min-width: 768px)', `${BASE}${scene}-desktop.webp`],
    ['image/avif', null, `${BASE}${scene}-mobile.avif`],
    ['image/webp', null, `${BASE}${scene}-mobile.webp`],
  ];
  for (const [type, media, srcset] of variants) {
    const attrs = { type, srcset };
    if (media) attrs.media = media;
    picture.append(el('source', attrs));
  }

  const img = el('img', {
    src: `${BASE}${scene}-desktop.png`, // 终极回退：原始 PNG
    alt: alt,
    class: 'scene-picture__img',
    loading: eager ? 'eager' : 'lazy',
    decoding: 'async',
    onerror: (e) => {
      // 图片加载失败（含离线相对路径失效）→ 隐藏图，露出底色面板，不显示破图
      const p = e.target.closest('.scene-picture');
      if (p) p.classList.add('scene-picture--missing');
    },
  });
  if (!alt) { img.setAttribute('aria-hidden', 'true'); img.setAttribute('role', 'presentation'); }
  picture.append(img);

  return picture;
}

/**
 * 场景顶部视觉横幅：左/上为干净文字区，右/下为场景图（图片与文字分区域，不强行叠放）。
 * 用于首页阅读入口、情境练习入口、行动复盘页顶部。
 * 文字一律真实 HTML；图片为装饰层（空 alt / aria-hidden），加载失败回退底色。
 *
 * @param {string} scene reading | practice | reflection
 * @param {object} opts { kicker, title, desc, eager, slot }
 */
export function sceneBanner(scene, opts = {}) {
  const kicker = opts.kicker ?? '';
  const title = opts.title ?? '';
  const desc = opts.desc ?? '';
  const eager = opts.eager ?? false;

  const content = el('div', { class: 'scene-banner__content' }, [
    kicker ? el('p', { class: 'scene-banner__kicker', text: kicker }) : null,
    title ? el('h1', { class: 'scene-banner__title', text: title }) : null,
    desc ? el('p', { class: 'scene-banner__desc', text: desc }) : null,
    opts.slot || null,
  ].filter(Boolean));

  const media = el('div', { class: 'scene-banner__media' }, [
    scenePicture(scene, { eager, alt: '' }),
  ]);

  return el('section', { class: `scene-banner scene-banner--${scene}`, 'aria-label': `${title || scene} 场景` }, [
    content,
    media,
  ]);
}
