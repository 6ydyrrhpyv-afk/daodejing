// 原典阅读：桌面窄目录 + 宽阅读区；手机横向章节导航；题签区分内容分区
// 本次升级：81 章主题配置 + 多种排版模式 + 标准/意境切换

import { el, frag } from './util.mjs';
import { getChapter, themeLabel } from './data.mjs';
import { findQuote } from './citations.mjs';
import { mountainStrip } from './art.mjs';
import { getChapterDesign, getTheme, applyTheme, resetTheme } from './chapter-themes.mjs';
import { renderOriginalText } from './chapter-layouts.mjs';
import { renderMotif } from './motifs.mjs';
import { renderIllustration, hasIllustration } from './illustrations.mjs';

// 短章名（题签）判定：仅当现有章名为 2–6 个汉字时才作侧边题签，不使用编造章名。
function isShortTitle(title) {
  const len = (title || '').length;
  return len >= 2 && len <= 6;
}

// 摘句在自然标点处断成两行（不机械按字数切），用于序幕的轻微错位。
function splitLead(quote) {
  const punct = ['，', '、', '；', '：', '。'];
  const mid = Math.floor(quote.length / 2);
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < quote.length; i += 1) {
    if (punct.includes(quote[i])) {
      const dist = Math.abs(i - mid);
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
  }
  if (best > 0 && best < quote.length - 1) {
    return [quote.slice(0, best + 1), quote.slice(best + 1)];
  }
  return [quote];
}

/**
 * A. 章节序幕：编号 + 章名（如有）+ 至多一句摘句 + 可选意象。
 * 通过位置、大小与留白建立气氛；不编造章名，不添加「静/悟/禅」等泛化文案。
 * 摘句必须逐字来自本章原文，且只是引子，不替代正文原句。
 */
function renderPrologue(chapter, design, readingMode) {
  const atmos = readingMode === 'atmospheric';
  const pro = el('header', { class: `prologue${atmos ? ' prologue--atmos' : ''}` });

  // 大号低对比章号背景数字：仅作底纹，定位在角落且不与正文重叠
  pro.append(el('span', { class: 'prologue__numeral', 'aria-hidden': 'true', text: String(chapter.chapter_number) }));

  // 一条很短的细线连接章号与标题
  pro.append(el('span', { class: 'prologue__rule', 'aria-hidden': 'true' }));
  pro.append(el('p', { class: 'prologue__chapter', text: `第 ${chapter.chapter_number} 章` }));
  pro.append(el('p', { class: 'prologue__edition', text: `版本：${chapter.edition}` }));

  // 桌面侧边题签：仅使用现有短章名；手机端由 CSS 恢复横排
  if (isShortTitle(chapter.title_hint)) {
    pro.append(el('p', { class: 'prologue__tab', 'aria-hidden': 'true', text: chapter.title_hint }));
  }

  // 至多一句摘句：必须逐字匹配原文，否则不显示
  const quote = (design?.highlightQuotes || []).find(
    (q) => typeof q === 'string' && q.trim() && chapter.original_text.includes(q.trim()),
  );
  if (quote) {
    const lead = el('blockquote', { class: 'prologue__lead' });
    // 意境模式下分成两行并轻微错位；标准模式保持单行，去除装饰性错位
    const parts = atmos ? splitLead(quote.trim()) : [quote.trim()];
    parts.forEach((part, i) => {
      lead.append(el('span', { class: `prologue__lead-line${i === 1 ? ' prologue__lead-line--offset' : ''}`, text: part }));
    });
    pro.append(lead);
  }

  // 可选意象：仅当配置要求放在序幕、且本章没有水彩插画时渲染，避免双重装饰。
  // 有水彩插画时，水彩即本章主装饰，旧的线描意象让位。
  if (design?.illustrationPlacement === 'prologue' && design?.motifId && design.motifId !== 'mist' && !design?.illustration) {
    const motif = renderMotif(design.motifId, { className: 'motif--prologue' });
    if (motif) pro.append(el('div', { class: 'prologue__motif', 'aria-hidden': 'true' }, [motif]));
  }
  return pro;
}

export function renderChapters(ctx, params) {
  const { data } = ctx;
  if (params.id) return renderChapterDetail(ctx, params);
  const root = el('div', { class: 'stack' });

  root.append(el('div', { class: 'torn-divider', 'aria-hidden': 'true' }, [mountainStrip()]));
  root.append(el('h2', { class: 'section-title', text: '原典阅读' }));
  root.append(el('p', { class: 'notice' }, [
    el('span', {
      text: `本站收录《道德经》全部 ${data.chapters.length} 章（王弼本），目录显示真实章号。释义为本站整理，非古代注家原话；不提供多家注解库，不做逐字校勘。`,
    }),
  ]));

  root.append(chapterSideList(data, null, true));
  return frag([root]);
}

// 章节列表（桌面侧栏 / 列表页共用）
function chapterSideList(data, activeId, showMeta = false) {
  const list = el('ul', { class: 'chapter-list' });
  for (const chapter of data.chapters) {
    const link = el('a', {
      class: 'chapter-list__link',
      href: `#/chapters/${chapter.chapter_id}`,
    }, [
      el('span', { class: 'chapter-list__num', text: `第 ${chapter.chapter_number} 章` }),
      el('span', { class: 'chapter-list__title', text: chapter.title_hint }),
      showMeta ? el('span', { class: 'chapter-list__meta', text: chapter.themes.map(themeLabel).join(' · ') }) : null,
    ]);
    if (chapter.chapter_id === activeId) link.setAttribute('aria-current', 'page');
    list.append(el('li', {}, [link]));
  }
  return list;
}

// 手机端章节选择抽屉：从右侧滑出，可纵向滚动全部 81 章，符合人类使用手机的习惯。
function chapterPickerMobile(data, activeId) {
  const current = data.chapters.find((c) => c.chapter_id === activeId);
  const trigger = el('button', {
    type: 'button',
    class: 'chapter-picker__trigger',
    'aria-haspopup': 'dialog',
    'aria-expanded': 'false',
    'aria-controls': 'chapter-picker-drawer',
    text: current ? `第 ${current.chapter_number} 章 · 目录` : '章节目录',
  });

  const drawer = el('div', {
    class: 'chapter-picker__drawer',
    id: 'chapter-picker-drawer',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': '章节目录',
    'aria-hidden': 'true',
    tabindex: '-1',
  });

  const closeBtn = el('button', {
    type: 'button',
    class: 'chapter-picker__close',
    'aria-label': '关闭目录',
    text: '×',
  });

  const header = el('div', { class: 'chapter-picker__head' }, [
    el('p', { class: 'chapter-picker__title', text: '章节目录' }),
    closeBtn,
  ]);

  const list = chapterSideList(data, activeId);
  list.classList.add('chapter-picker__list');
  drawer.append(header, list);

  const overlay = el('div', { class: 'chapter-picker__overlay', 'aria-hidden': 'true' });

  const open = () => {
    document.body.classList.add('chapter-picker-open');
    drawer.setAttribute('aria-hidden', 'false');
    overlay.setAttribute('aria-hidden', 'false');
    trigger.setAttribute('aria-expanded', 'true');
    drawer.focus({ preventScroll: true });
    const cur = list.querySelector('[aria-current="page"]');
    if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  const close = () => {
    document.body.classList.remove('chapter-picker-open');
    drawer.setAttribute('aria-hidden', 'true');
    overlay.setAttribute('aria-hidden', 'true');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.focus({ preventScroll: true });
  };

  trigger.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', close);
  drawer.addEventListener('click', (e) => {
    const link = e.target.closest('.chapter-list__link');
    if (link) close();
  });
  drawer.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  return el('div', { class: 'chapter-picker' }, [trigger, overlay, drawer]);
}

function renderChapterDetail(ctx, params) {
  const { data, navigate, store } = ctx;
  const chapter = getChapter(data, params.id);
  const root = el('div', { class: 'stack' });

  if (!chapter) {
    resetTheme();
    root.append(el('p', { class: 'notice notice--error', text: `没有找到章节 ${params.id}，本站目前收录全部 ${data.chapters.length} 章。` }));
    root.append(el('a', { class: 'btn btn--ghost', href: '#/chapters', text: '返回目录' }));
    return frag([root]);
  }

  const design = getChapterDesign(data.design, chapter.chapter_id) || null;
  const theme = getTheme(data.design, design?.themeId);
  applyTheme(theme);

  const fromPractice = params.from === 'practice';
  if (fromPractice) {
    root.append(el('div', { class: 'return-bar' }, [
      el('a', { class: 'btn btn--primary', href: '#/practice' }, ['返回练习（已填内容不会丢失）']),
    ]));
  }

  const tabLabel = (text) => el('p', { class: 'tab-label', text });

  // 标准 / 意境 切换
  const readingMode = store.state.readingMode === 'atmospheric' ? 'atmospheric' : 'standard';
  const modeToggle = el('div', { class: 'reading-mode', role: 'group', 'aria-label': '阅读排版模式' }, [
    el('button', {
      type: 'button',
      class: `reading-mode__btn${readingMode === 'standard' ? ' reading-mode__btn--active' : ''}`,
      'aria-pressed': readingMode === 'standard',
      onclick: () => switchReadingMode(ctx, 'standard'),
    }, ['标准']),
    el('button', {
      type: 'button',
      class: `reading-mode__btn${readingMode === 'atmospheric' ? ' reading-mode__btn--active' : ''}`,
      'aria-pressed': readingMode === 'atmospheric',
      onclick: () => switchReadingMode(ctx, 'atmospheric'),
    }, ['意境']),
  ]);

  // ---- 原文（原文全文在两种模式下均只渲染一次，避免重复内容）----
  const hit = params.q ? findQuote(chapter, params.q) : { found: false, lineIndex: -1 };
  const textBlock = renderOriginalText(chapter, design, readingMode, hit);
  // 标准模式：变体排版 + 辅助折叠信息。
  // 意境模式：只保留两块核心内容——上面的“意境排版”和下面的“全文”。
  const standardExtras = readingMode === 'standard' ? [
    hit.found ? el('p', { class: 'field__hint', text: `已定位到你要查看的原句：${hit.line}` }) : null,
    el('details', { class: 'details' }, [
      el('summary', { text: '查看繁体底本原文' }),
      el('p', { class: 'original original--ft', text: chapter.original_text_traditional }),
    ]),
    el('details', { class: 'details' }, [
      el('summary', { text: '版本异文（不同版本用字，本站不混排）' }),
      el('ul', { class: 'bullets' }, chapter.variants.map((v) => el('li', { text: v }))),
    ]),
  ] : [];
  const originalCard = el('section', { class: `card card--original card--${readingMode}` }, [
    el('div', { class: 'card__header' }, [
      tabLabel('原 文'),
      modeToggle,
    ]),
    textBlock,
    ...standardExtras,
  ]);

  // ---- 英译（理雅各公版，附于原文之下便于对照）----
  let englishCard = null;
  if (chapter.english_text) {
    const enLines = chapter.english_text.split('\n').map((l) => l.trim()).filter(Boolean);
    const enBlock = el('div', { class: 'original original--en' });
    enLines.forEach((line) => enBlock.append(el('p', { class: 'original__line', text: line })));
    const src = chapter.english_source || {};
    englishCard = el('section', { class: 'card card--inset' }, [
      tabLabel('英 译'),
      el('p', { class: 'field__hint', text: '英文为 James Legge（理雅各，1891）公版译本，附于原文之下便于对照；非本站释义，亦不替代原文。' }),
      enBlock,
      src.url ? el('p', { class: 'translation__cite' }, [
        el('span', { text: `来源：${src.translator}《${src.work}》(${src.year}，${src.license}) · ` }),
        el('a', { class: 'link', href: src.url, target: '_blank', rel: 'noopener noreferrer', text: '维基文库' }),
      ]) : null,
    ]);
  }

  // ---- 释义 ----
  const explainCard = el('section', { class: 'card' }, [
    tabLabel('本站释义'),
    el('p', { class: 'card__text', text: chapter.plain_explanation }),
    el('p', { class: 'field__hint', text: `释义来源：${chapter.explanation_source}，非古代注家原话。本站未提供多家注解库，也不做逐字校勘。` }),
  ]);

  // ---- 边界 ----
  const boundaryCard = el('section', { class: 'card' }, [
    tabLabel('应 用 边 界'),
    el('p', { class: 'card__text', text: chapter.application_boundary }),
  ]);

  // ---- 相关主题与操作 ----
  const themeRow = el('div', { class: 'row' }, chapter.themes.map((t) =>
    el('a', { class: 'chip', href: `#/?theme=${t}`, text: `${themeLabel(t)}相关` }),
  ));
  const footCard = el('section', { class: 'card' }, [
    tabLabel('相 关'),
    themeRow,
    el('div', { class: 'row' }, [
      el('a', { class: 'btn btn--ghost', href: '#/chapters', text: '返回目录' }),
      el('a', { class: 'btn btn--ghost', href: '#/practice', text: '回到练习' }),
    ]),
  ]);

  // ---- 水彩插画（阅读氛围层，按每章配置布置；无配置则完全不出现）----
  const illus = design?.illustration || null;

  const pro = renderPrologue(chapter, design, readingMode);

  // ① 水纹承句 / ④ 枝叶入页：作为阅读列中、序幕之后的流式元素（避免被序幕 overflow 裁切）
  const edgeEl = (hasIllustration(illus) && (illus.layout === 'ripple-carry' || illus.layout === 'branch-edge'))
    ? renderIllustration(illus)
    : null;

  // ② 远山侧景 / ③ 空器留白：与原文组成非对称两栏（桌面 2/3 文 + 1/3 图，移动端回落单栏）
  let originalSlot = originalCard;
  if (hasIllustration(illus) && (illus.layout === 'farview-side' || illus.layout === 'vessel-blank')) {
    const side = renderIllustration(illus);
    if (side) {
      originalSlot = el('div', { class: `orig-illus orig-illus--${illus.layout}` }, [originalCard, side]);
    }
  }

  // ⑤ 段落落款：原文结束后、译文前的轻落款
  const sealEl = (hasIllustration(illus) && illus.layout === 'passage-seal') ? renderIllustration(illus) : null;

  // ---- 布局：桌面侧栏 + 阅读区；手机端使用右侧滑出抽屉选章 ----
  const readingChildren = [
    chapterPickerMobile(data, chapter.chapter_id),
    pro,
  ];
  if (edgeEl) readingChildren.push(edgeEl);
  readingChildren.push(originalSlot);
  if (sealEl) readingChildren.push(sealEl);
  if (englishCard) readingChildren.push(englishCard);
  readingChildren.push(explainCard, boundaryCard, footCard);

  const layout = el('div', { class: 'chapter-layout' }, [
    el('aside', { class: 'chapter-side', 'aria-label': '章节目录' }, [
      el('p', { class: 'chapter-side__title', text: '目 录' }),
      chapterSideList(data, chapter.chapter_id),
    ]),
    el('div', { class: 'reading-col' }, readingChildren),
  ]);
  root.append(layout);

  if (hit.found && hit.lineIndex >= 0) {
    requestAnimationFrame(() => {
      const node = document.getElementById('target-line');
      if (node) node.scrollIntoView({ block: 'center' });
    });
  }
  void navigate;
  return frag([root]);
}

function switchReadingMode(ctx, mode) {
  if (ctx.store.state.readingMode === mode) return;
  const y = window.scrollY;
  ctx.store.update((s) => ({ ...s, readingMode: mode }));
  ctx.rerender();
  // 切换后尽量保持阅读位置，避免跳回顶部造成中断
  requestAnimationFrame(() => window.scrollTo({ top: y }));
}
