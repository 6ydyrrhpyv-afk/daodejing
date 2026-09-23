// 章节原文版式：六种可复用的诗性排版 + 标准阅读回退。
// 约束（严格遵守）：
//   1. 全部为真实 DOM 文本，禁用 innerHTML，屏幕阅读器与复制顺序 = 原文顺序；
//   2. 只使用正常文档流 / Grid / Flex，绝不逐字绝对定位拼造型；
//   3. 全文不旋转、不绕圈、不沿曲线排列，不随机换行；
//   4. 原文全文在任一模式下只渲染一次，不重复；
//   5. 意象/装饰一律 aria-hidden，不可点击、不进 Tab 焦点。

import { el } from './util.mjs';
import { findQuote, splitLines } from './citations.mjs';
import { renderMotif } from './motifs.mjs';

// 关键句：全章最多突出一处，避免满页都是重点。
function highlightQuoteOf(design) {
  const list = (design?.highlightQuotes || []).filter((s) => typeof s === 'string' && s.trim());
  return list.length ? list[0].trim() : null;
}

// 去掉句读再比较，避免「上善若水。」与「上善若水」匹配不上
function bare(s) {
  return s.replace(/[。，；：？！、\s]/g, '');
}

// 生成一个「是否已用过关键句」的判定器：全章只命中一次
function highlightMarker(design) {
  const quote = highlightQuoteOf(design);
  const target = quote ? bare(quote) : '';
  let used = false;
  return (line) => {
    if (!target || used) return false;
    const b = bare(line);
    if (!b) return false;
    if (b === target || target.includes(b) || b.includes(target)) {
      used = true;
      return true;
    }
    return false;
  };
}

// 「淡色底衬关键词」：只对关键句命中，取关键句开头两个字（必须是原文真实存在的字）
function keywordOf(design) {
  const quote = highlightQuoteOf(design);
  if (!quote) return null;
  const b = bare(quote);
  return b.length >= 2 ? b.slice(0, 2) : null;
}

function makeLine(line, options = {}) {
  const { isTarget, isHighlight, isLead, align, indent, keyword } = options;
  const cls = ['original__line'];
  if (isTarget) cls.push('original__line--target');
  if (isHighlight) cls.push('original__line--highlight', 'original__line--rise');
  if (isLead) cls.push('original__line--lead');
  if (align) cls.push(`original__line--${align}`);
  if (indent) cls.push(`original__line--indent`);
  const id = isTarget ? 'target-line' : null;

  // 淡色底衬：整句仍完整可读，底衬只落在真实存在的关键词上
  if (isHighlight && keyword && line.includes(keyword)) {
    const i = line.indexOf(keyword);
    return el('p', { class: cls.join(' '), id }, [
      line.slice(0, i),
      el('span', { class: 'og-keyword', text: keyword }),
      line.slice(i + keyword.length),
    ]);
  }
  return el('p', { class: cls.join(' '), id, text: line });
}

/**
 * 标准阅读：连续原文，仅保留字体、主题与舒适行距，去除所有装饰性错位。
 */
export function standardTextBlock(chapter, hit) {
  const lines = splitLines(chapter.original_text);
  const block = el('div', { class: 'original original--standard' });
  lines.forEach((line, index) => {
    const isTarget = hit.found && hit.lineIndex === index;
    block.append(makeLine(line, { isTarget, isLead: index === 0 }));
  });
  return block;
}

// 分组内切句：design.paragraphGroups 缺失时按全文切句兜底
function groupsOf(chapter, design) {
  if (design?.paragraphGroups?.length) return design.paragraphGroups;
  return splitLines(chapter.original_text).map((text, i) => ({ index: i, text, role: 'body' }));
}

// 页边极淡水纹（纯 CSS 绘制，非意象，避免与本章主意象冲突）
function edgeWash() {
  return el('span', { class: 'og-edge', 'aria-hidden': 'true' });
}

// ---------------- 1. 静水式 ----------------
// 语句较短、节奏平缓：分成 2–4 个语义组，组内左对齐，文字组居中，
// 组间留白明显，页边放极淡水纹。长段落不整体居中。
function stillWater(chapter, design, hit) {
  const groups = groupsOf(chapter, design);
  const mark = highlightMarker(design);
  const kw = keywordOf(design);
  const wrapper = el('div', { class: 'original original--still-water' });
  groups.forEach((g, gi) => {
    const lines = splitLines(g.text);
    const groupEl = el('div', { class: 'og-group' });
    lines.forEach((line, li) => {
      const isHighlight = mark(line);
      groupEl.append(makeLine(line, {
        isTarget: hit.found && hit.line.includes(line),
        isHighlight,
        isLead: gi === 0 && li === 0,
        keyword: isHighlight ? kw : null,
      }));
    });
    wrapper.append(groupEl);
  });
  wrapper.append(edgeWash());
  return wrapper;
}

// ---------------- 2. 对照式 ----------------
// 对应、转折、相互关系的句子：前后相邻对应句组成连续单元，上下错位 + 轻微缩进。
// 仅当对应关系明确时桌面才用成对双栏；移动端严格单栏，顺序完全不变。
function isClearlyPaired(chapter) {
  return /有无相生|难易相成|长短相形|高下相倾|音声相和|前后相随|曲则全|枉则直|洼则盈|敝则新|少则得|多则惑|重为轻根|静为躁君|故有之以为利|有无之相生/.test(chapter.original_text);
}

function contrast(chapter, design, hit) {
  const lines = splitLines(chapter.original_text);
  const mark = highlightMarker(design);
  const kw = keywordOf(design);
  const paired = isClearlyPaired(chapter);
  const wrapper = el('div', {
    class: 'original original--contrast',
    'data-paired': paired ? 'true' : 'false',
  });
  for (let i = 0; i < lines.length; i += 2) {
    const a = lines[i];
    const b = lines[i + 1];
    // DOM 顺序 = 原文顺序，双栏只是视觉呈现，移动端自然回落为单栏
    const row = el('div', { class: 'og-pair' });
    const ha = mark(a);
    row.append(makeLine(a, { isTarget: hit.found && hit.line.includes(a), isHighlight: ha, isLead: i === 0, keyword: ha ? kw : null }));
    if (b) {
      const hb = mark(b);
      row.append(makeLine(b, { isTarget: hit.found && hit.line.includes(b), isHighlight: hb, keyword: hb ? kw : null }));
    }
    wrapper.append(row);
  }
  return wrapper;
}

// ---------------- 3. 疏密式 ----------------
// 短章或有明确关键句：前半紧凑，关键句前增加一段留白使其自然浮现；最多突出一处。
function whitespace(chapter, design, hit) {
  const lines = splitLines(chapter.original_text);
  const mark = highlightMarker(design);
  const kw = keywordOf(design);
  const wrapper = el('div', { class: 'original original--whitespace' });
  lines.forEach((line, i) => {
    const isHighlight = mark(line);
    wrapper.append(makeLine(line, {
      isTarget: hit.found && hit.line.includes(line),
      isHighlight,
      isLead: i === 0,
      keyword: isHighlight ? kw : null,
    }));
  });
  return wrapper;
}

// ---------------- 4. 行旅式 ----------------
// 积累、推进、逐步发展：语义组纵向展开，桌面 0/24/48px 小幅横向偏移，
// 细线只出现在留白区；手机偏移 0–12px，不做大幅阶梯式缩窄。
function progressive(chapter, design, hit) {
  const groups = groupsOf(chapter, design);
  const mark = highlightMarker(design);
  const kw = keywordOf(design);
  const wrapper = el('div', { class: 'original original--progressive' });
  groups.forEach((g, gi) => {
    const lines = splitLines(g.text);
    const tier = Math.min(gi, 3);
    const groupEl = el('div', { class: 'og-tier', 'data-tier': String(tier) });
    lines.forEach((line, li) => {
      const isHighlight = mark(line);
      groupEl.append(makeLine(line, {
        isTarget: hit.found && hit.line.includes(line),
        isHighlight,
        isLead: gi === 0 && li === 0,
        keyword: isHighlight ? kw : null,
      }));
    });
    wrapper.append(groupEl);
    // 组间细线：只出现在留白区，不穿过文字
    if (gi < groups.length - 1) groupEl.append(el('span', { class: 'og-rule', 'aria-hidden': 'true' }));
    // 本章主意象：放在首组之后的留白处（行旅式的「路径」意象），最多一次
    if (gi === 0 && groups.length > 1) {
      const motif = renderMotif(design?.motifId, { className: 'motif--between' });
      if (motif) wrapper.append(el('div', { class: 'og-between', 'aria-hidden': 'true' }, [motif]));
    }
  });
  return wrapper;
}

// ---------------- 5. 虚室式 ----------------
// 有无、器用、空与容纳：正文只占一侧，另一侧保留明确空白并安排空心器物线描。
// 空白属于设计，但不制造需要连续滑动数屏才能读到下一句的障碍。
function voidRoom(chapter, design, hit) {
  const lines = splitLines(chapter.original_text);
  const mark = highlightMarker(design);
  const kw = keywordOf(design);
  const wrapper = el('div', { class: 'original original--void-room' });

  const textSide = el('div', { class: 'og-void-text' });
  lines.forEach((line, i) => {
    const isHighlight = mark(line);
    textSide.append(makeLine(line, {
      isTarget: hit.found && hit.line.includes(line),
      isHighlight,
      isLead: i === 0,
      keyword: isHighlight ? kw : null,
    }));
  });
  wrapper.append(textSide);

  // 留白侧：空心器物线描（本章主意象），纯装饰
  const spaceSide = el('div', { class: 'og-void-space', 'aria-hidden': 'true' });
  const motif = renderMotif(design?.motifId || 'vessel', { className: 'motif--side' });
  if (motif) spaceSide.append(motif);
  wrapper.append(spaceSide);
  return wrapper;
}

// ---------------- 6. 远景式 ----------------
// 水、山谷、草木等自然意象：文字沿清晰阅读轴展开，右侧/下方出现自然意象局部，
// 边缘用遮罩渐隐到页面底色；正文始终处于纯净、对比充足的区域，不覆盖复杂纹理。
function imageBlend(chapter, design, hit) {
  const groups = groupsOf(chapter, design);
  const mark = highlightMarker(design);
  const kw = keywordOf(design);
  const wrapper = el('div', { class: 'original original--image-blend' });

  // 自然意象局部：置于页边，遮罩渐隐，pointer-events:none，绝不压住文字
  const scene = el('figure', { class: 'og-scene', 'aria-hidden': 'true' });
  const motif = renderMotif(design?.motifId || 'mist', { className: 'motif--scene' });
  if (motif) scene.append(motif);
  wrapper.append(scene);

  const axis = el('div', { class: 'og-axis' });
  groups.forEach((g, gi) => {
    const lines = splitLines(g.text);
    const groupEl = el('div', { class: 'og-group' });
    lines.forEach((line, li) => {
      const isHighlight = mark(line);
      groupEl.append(makeLine(line, {
        isTarget: hit.found && hit.line.includes(line),
        isHighlight,
        isLead: gi === 0 && li === 0,
        keyword: isHighlight ? kw : null,
      }));
    });
    axis.append(groupEl);
  });
  wrapper.append(axis);
  return wrapper;
}

const RENDERERS = {
  'still-water': stillWater,
  'contrast': contrast,
  'whitespace': whitespace,
  'progressive': progressive,
  'void-room': voidRoom,
  'image-blend': imageBlend,
};

/**
 * 渲染原文。
 * @param {object} chapter 章节（原文取自 chapter.original_text，配置不复制原文）
 * @param {object|null} design 该章视觉配置（chapter-design.json 中的一条）
 * @param {'standard'|'atmospheric'} mode 阅读模式
 * @param {{found:boolean,lineIndex:number,line:string}} hit 引用定位结果
 */
export function renderOriginalText(chapter, design, mode, hit) {
  // 标准阅读：去除装饰性错位，保留字体、主题与舒适行距。
  if (mode === 'standard') return standardTextBlock(chapter, hit);
  // 意境阅读：使用该章分配的诗性版式；配置缺失或版式不支持时回退到正常阅读布局。
  const renderer = RENDERERS[design?.layoutVariant];
  if (!renderer) return standardTextBlock(chapter, hit);
  return renderer(chapter, design, hit);
}

export { findQuote };
