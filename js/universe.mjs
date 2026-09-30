// 道家宇宙：交互知识图谱
// 结构：SVG 画节点与连线（世界坐标），HTML 覆盖层画标签（屏幕坐标，字号恒定）。
// 布局为确定性扇形分区：中央「道」→ 八个主题锚点 → 概念环绕主题 → 章节向外分层。
// 标签位置由「节点世界坐标 → 屏幕坐标」换算，与节点共享同一视图变换。

import { el, svg, icon, clear } from './util.mjs';
import { getChapter } from './data.mjs';
import { Listen } from './listen-player.mjs';

const WORLD = 1800;              // viewBox 尺寸（用户坐标）
const R_THEME = 400;             // 主题锚点环半径
const R_CONCEPT = 112;           // 概念环绕主题的半径
const R_CHAPTER_BASE = 175;      // 章节外扩起始半径（压缩后主题环可更舒展）
const R_CHAPTER_STEP = 72;       // 章节层间距（须大于标签高度+避让间隙，避免层间标签相撞）
const CHAPTER_PER_RING = 5;      // 每层章节数
const CHAPTER_FAN = 0.76;        // 章节扇面张角（弧度，略小于相邻主题间隔 0.785）

const NODE_R = { dao: 26, theme: 26, concept: 13, chapter: 7 };
const HIT_MIN_PX = 22;           // 最小命中半径（= 44px 热区直径）
const LABEL_GAP = 8;             // 标签视觉间隔

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function offlineImg(key) {
  try {
    const m = window.__UNIVERSE__;
    if (m && typeof m[key] === 'string' && m[key]) return m[key];
  } catch (_) { /* ignore */ }
  return null;
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function isMobileLayout() { return window.matchMedia('(max-width: 56rem)').matches; }

/* ============================================================
   1. 图数据与布局（确定性，无随机抖动）
   ============================================================ */
function buildGraph(universe) {
  const nodes = [];
  const byId = new Map();

  const dao = {
    id: 'dao', kind: 'dao', label: '道', x: 0, y: 0, r: NODE_R.dao,
    data: { name: '道', explanation: '万物本源，不可名状而能生万有。' },
  };
  nodes.push(dao); byId.set('dao', dao);

  // 主题：八等分圆周，角度固定（稳定锚点）
  const themes = universe.themes;
  themes.forEach((theme, i) => {
    const a = (i / themes.length) * Math.PI * 2 - Math.PI / 2;
    const n = {
      id: theme.id, kind: 'theme', label: theme.name,
      x: Math.cos(a) * R_THEME, y: Math.sin(a) * R_THEME,
      r: NODE_R.theme, data: theme, angle: a, index: i,
    };
    nodes.push(n); byId.set(theme.id, n);
  });

  // 概念的主归属主题（仅用于布局，不代表排他分类）
  const conceptTheme = new Map();
  universe.concepts.forEach((c) => conceptTheme.set(c.id, c.themes && c.themes[0]));

  const conceptsByTheme = new Map();
  universe.concepts.forEach((c) => {
    const t = conceptTheme.get(c.id);
    if (!conceptsByTheme.has(t)) conceptsByTheme.set(t, []);
    conceptsByTheme.get(t).push(c);
  });

  conceptsByTheme.forEach((list, themeId) => {
    const tn = byId.get(themeId);
    if (!tn) return;
    list.forEach((c, k) => {
      const a = tn.angle + Math.PI + 0.45 + (k / list.length) * Math.PI * 2;
      const n = {
        id: c.id, kind: 'concept', label: c.name,
        x: tn.x + Math.cos(a) * R_CONCEPT,
        y: tn.y + Math.sin(a) * R_CONCEPT,
        r: NODE_R.concept, data: c, themeId, angle: a,
      };
      nodes.push(n); byId.set(c.id, n);
    });
  });

  // 章节主归属：取关联最多的概念所属主题
  const chapterRels = new Map();
  universe.relationships.forEach((r) => {
    if (r.targetType !== 'chapter') return;
    if (!chapterRels.has(r.targetId)) chapterRels.set(r.targetId, []);
    chapterRels.get(r.targetId).push(r);
  });

  const chapterTheme = new Map();
  universe.chapters.forEach((ch) => {
    const rels = chapterRels.get(ch.id) || [];
    const count = new Map();
    rels.forEach((r) => {
      const th = r.sourceType === 'concept' ? conceptTheme.get(r.sourceId) : r.sourceId;
      if (!th) return;
      count.set(th, (count.get(th) || 0) + 1);
    });
    let best = null; let bestN = -1;
    count.forEach((v, k) => { if (v > bestN) { bestN = v; best = k; } });
    chapterTheme.set(ch.id, best);
  });

  const chaptersByTheme = new Map();
  universe.chapters.forEach((ch) => {
    const t = chapterTheme.get(ch.id);
    if (!chaptersByTheme.has(t)) chaptersByTheme.set(t, []);
    chaptersByTheme.get(t).push(ch);
  });

  chaptersByTheme.forEach((list, themeId) => {
    const tn = byId.get(themeId);
    if (!tn) return;
    list.sort((a, b) => a.number - b.number);
    list.forEach((ch, k) => {
      const ring = Math.floor(k / CHAPTER_PER_RING);
      const idx = k % CHAPTER_PER_RING;
      const frac = CHAPTER_PER_RING > 1 ? idx / (CHAPTER_PER_RING - 1) : 0.5;
      const a = tn.angle + (frac - 0.5) * CHAPTER_FAN + (ring % 2) * 0.05;
      const rr = R_CHAPTER_BASE + ring * R_CHAPTER_STEP;
      const n = {
        id: ch.id, kind: 'chapter', label: String(ch.number),
        x: tn.x + Math.cos(a) * rr,
        y: tn.y + Math.sin(a) * rr,
        r: NODE_R.chapter, data: ch, number: ch.number,
        themeId, rels: chapterRels.get(ch.id) || [],
      };
      nodes.push(n); byId.set(ch.id, n);
    });
  });

  // 边：带主题归属与是否主归属，供分级显示
  const edgeSet = new Set();
  const edges = [];
  function addEdge(a, b, type, themeId, primary) {
    const key = `${a}|${b}|${type}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push({ source: a, target: b, type, themeId, primary: primary !== false });
  }
  universe.relationships.forEach((r) => {
    if (r.sourceType === 'theme' && r.targetType === 'concept') {
      addEdge(r.sourceId, r.targetId, 'theme-concept', r.sourceId, conceptTheme.get(r.targetId) === r.sourceId);
    } else if (r.sourceType === 'concept' && r.targetType === 'chapter') {
      addEdge(r.sourceId, r.targetId, 'concept-chapter', conceptTheme.get(r.sourceId), true);
    }
  });
  themes.forEach((t) => addEdge('dao', t.id, 'dao-theme', t.id, true));

  // 邻接索引
  const neighbors = new Map();
  edges.forEach((e) => {
    if (!neighbors.has(e.source)) neighbors.set(e.source, new Set());
    if (!neighbors.has(e.target)) neighbors.set(e.target, new Set());
    neighbors.get(e.source).add(e.target);
    neighbors.get(e.target).add(e.source);
  });

  return { nodes, edges, byId, conceptTheme, chapterTheme, neighbors };
}

/* ============================================================
   2. 视图状态持久化
   ============================================================ */
const STORE_KEY = 'ddj-universe-state';

function loadState() {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (!raw) return { saved: false, x: 0, y: 0, zoom: 1, selected: null, search: '' };
    const st = JSON.parse(raw);
    return {
      saved: true,
      x: st.x || 0, y: st.y || 0, zoom: st.zoom || 1,
      selected: st.selected || null, search: st.search || '',
    };
  } catch (_) {
    return { saved: false, x: 0, y: 0, zoom: 1, selected: null, search: '' };
  }
}

function saveState(s) {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify({
      x: s.x, y: s.y, zoom: s.zoom, selected: s.selected, search: s.search,
    }));
  } catch (_) { /* ignore */ }
}

/* ============================================================
   3. 页面
   ============================================================ */
export function renderUniverse(ctx) {
  const { data, navigate } = ctx;
  const universe = data.universe;
  const G = buildGraph(universe);
  const { nodes, edges, byId, conceptTheme } = G;

  const savedState = loadState();
  const view = { x: savedState.x, y: savedState.y, zoom: savedState.zoom };
  const needsFit = !savedState.saved;

  let mode = 'overview';        // overview | theme | node
  let focusTheme = null;
  let selectedId = null;
  let searchQuery = savedState.search || '';
  let searchHits = new Set();
  let listMode = false;
  // 移动端面板状态机：closed | collapsed | preview | full
  let panelState = 'closed';
  let currentPanelNode = null;
  let isMobile = isMobileLayout();

  const root = el('div', { class: 'universe' });

  /* ---------- 背景与雾面 ---------- */
  const bgOff = offlineImg('desktop');
  const bgLayer = el('div', { class: 'universe__bg', 'aria-hidden': 'true' }, [
    bgOff
      ? el('img', { src: bgOff, alt: '', class: 'universe__bg-img' })
      : el('picture', { class: 'universe__bg-picture' }, [
          el('source', { type: 'image/avif', srcset: './assets/universe/universe-desktop-1280.avif', media: '(min-width: 768px)' }),
          el('source', { type: 'image/webp', srcset: './assets/universe/universe-desktop-1280.webp', media: '(min-width: 768px)' }),
          el('source', { type: 'image/avif', srcset: './assets/universe/universe-mobile-768.avif' }),
          el('img', { src: './assets/universe/universe-desktop.png', alt: '', class: 'universe__bg-img' }),
        ]),
  ]);
  const fogLayer = el('div', { class: 'universe__fog', 'aria-hidden': 'true' });

  /* ---------- 工具栏 ---------- */
  const btnReset = el('button', { type: 'button', class: 'btn btn--ghost btn--sm universe__tb-reset', 'aria-label': '复位全景', title: '复位全景' }, [icon('mountain', 15), el('span', { text: '复位' })]);
  const btnZoomIn = el('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'aria-label': '放大', title: '放大' }, [el('span', { text: '＋' })]);
  const btnZoomOut = el('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'aria-label': '缩小', title: '缩小' }, [el('span', { text: '－' })]);
  const btnList = el('button', { type: 'button', class: 'btn btn--ghost btn--sm universe__tb-list', 'aria-label': '列表视图', title: '列表视图' }, [icon('scroll', 15), el('span', { text: '列表' })]);

  btnReset.addEventListener('click', () => resetView(true));
  btnZoomIn.addEventListener('click', () => zoomBy(1.25));
  btnZoomOut.addEventListener('click', () => zoomBy(0.8));
  btnList.addEventListener('click', () => toggleList());

  // 移动端「更多」菜单：承载复位 / 列表（空间不足时从工具行移入此处）
  const moreBtn = el('button', { type: 'button', class: 'universe__more btn btn--ghost btn--sm', 'aria-label': '更多', 'aria-pressed': 'false' }, [el('span', { text: '更多' })]);
  const btnResetM = el('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'aria-label': '复位全景' }, [icon('mountain', 15), el('span', { text: '复位全景' })]);
  const btnListM = el('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'aria-label': '列表视图' }, [icon('scroll', 15), el('span', { text: '列表视图' })]);
  const closeMore = () => { moreWrap.classList.remove('universe__more-wrap--open'); moreBtn.setAttribute('aria-pressed', 'false'); };
  btnResetM.addEventListener('click', () => { resetView(true); closeMore(); });
  btnListM.addEventListener('click', () => { toggleList(); closeMore(); });
  moreBtn.addEventListener('click', () => {
    const open = moreWrap.classList.toggle('universe__more-wrap--open');
    moreBtn.setAttribute('aria-pressed', String(open));
  });
  const moreMenu = el('div', { class: 'universe__more-menu', role: 'menu', 'aria-label': '更多操作' }, [btnResetM, btnListM]);
  const moreWrap = el('div', { class: 'universe__more-wrap' }, [moreBtn, moreMenu]);
  document.addEventListener('click', (e) => { if (!moreWrap.contains(e.target)) closeMore(); });

  // 工具行：桌面含全部（复位/缩放/列表）；窄屏由 CSS 隐藏其中的复位/列表，仅留缩放，二者移入「更多」
  const toolbar = el('div', { class: 'universe__toolbar', role: 'group', 'aria-label': '图谱操作' }, [btnReset, btnZoomOut, btnZoomIn, btnList]);

  const searchInput = el('input', {
    type: 'search', class: 'universe__search',
    placeholder: '搜索章号、概念或原文…',
    value: searchQuery, 'aria-label': '搜索',
  });
  const searchResults = el('ul', { class: 'universe__search-results', 'aria-live': 'polite' });
  searchResults.hidden = true;   // 仅在有结果/搜索状态时显示

  searchInput.addEventListener('input', (e) => runSearch(e.target.value));
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearchSubmit(); });
  // 移动端：键盘弹起/收起改变可视高度，重算面板高度与取景
  searchInput.addEventListener('focus', () => { if (isMobile) reframeIfMobile(); });
  searchInput.addEventListener('blur', () => { if (isMobile) reframeIfMobile(); });

  const header = el('header', { class: 'universe__header' }, [
    el('div', { class: 'universe__head-left' }, [
      el('a', { class: 'universe__back', href: '#/', 'aria-label': '返回首页' }, [icon('water', 16), el('span', { text: '返回' })]),
      el('div', { class: 'universe__brand' }, [
        el('h1', { class: 'universe__title', text: '道家宇宙' }),
        el('p', { class: 'universe__subtitle', text: '从一个念头，走进八十一章' }),
      ]),
    ]),
    el('div', { class: 'universe__head-center' }, [el('div', { class: 'universe__search-wrap' }, [searchInput, searchResults])]),
    toolbar,
    moreWrap,
  ]);

  /* ---------- SVG ---------- */
  const svgRoot = svg('svg', {
    class: 'universe__svg',
    viewBox: `${-WORLD / 2} ${-WORLD / 2} ${WORLD} ${WORLD}`,
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img', 'aria-label': '道家宇宙知识图谱',
  });
  const worldGroup = svg('g', { class: 'universe__world' });
  const edgesGroup = svg('g', { class: 'universe__edges' });
  const nodesGroup = svg('g', { class: 'universe__nodes' });

  const edgeEls = [];
  edges.forEach((e) => {
    const a = byId.get(e.source); const b = byId.get(e.target);
    if (!a || !b) return;
    const line = svg('line', {
      x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      class: `universe__edge universe__edge--${e.type}`,
    });
    line.style.display = 'none';
    edgesGroup.append(line);
    edgeEls.push({ edge: e, el: line });
  });

  nodes.forEach((n) => {
    const g = svg('g', {
      class: `universe__node universe__node--${n.kind}`,
      transform: `translate(${n.x}, ${n.y})`,
      'data-id': n.id, 'data-kind': n.kind,
    });
    g.append(svg('circle', { r: n.r, class: 'universe__node-circle' }));
    nodesGroup.append(g);
    n._g = g;
  });

  worldGroup.append(edgesGroup, nodesGroup);
  svgRoot.append(worldGroup);

  /* ---------- HTML 标签层（屏幕坐标，字号恒定） ---------- */
  const labelLayer = el('div', { class: 'universe__labels', 'aria-hidden': 'true' });

  // 中央「道」徽记：素材无透明通道，改用「道」字 + 淡青圆晕（恒定尺寸）
  const daoBadge = el('div', { class: 'universe__dao-badge' }, [
    el('span', { class: 'universe__dao-text', text: '道' }),
  ]);
  labelLayer.append(daoBadge);

  const labelEls = new Map();
  nodes.forEach((n) => {
    if (n.kind === 'dao') return;   // 中央由徽记呈现，不再堆叠文字
    const span = el('span', {
      class: `unv-label unv-label--${n.kind}`,
      'data-id': n.id,
    }, [document.createTextNode(n.kind === 'chapter' ? n.label : n.label)]);
    span.hidden = true;
    labelLayer.append(span);
    labelEls.set(n.id, { el: span, w: 0, h: 0 });
  });

  const canvasWrap = el('div', { class: 'universe__canvas' }, [bgLayer, fogLayer, svgRoot, labelLayer]);

  /* ---------- 面板 / 列表 ---------- */
  const panel = el('aside', { class: 'universe__panel', 'aria-live': 'polite' });
  const overlay = el('div', { class: 'universe__panel-overlay', 'aria-hidden': 'true' });
  overlay.addEventListener('click', closePanel);
  const listView = el('div', { class: 'universe__list' });

  root.append(header, canvasWrap, overlay, panel, listView);

  /* ---------- 底部提示（可关闭） ---------- */
  const hint = el('div', { class: 'universe__hint' });
  let hintDismissed = false;
  try { hintDismissed = localStorage.getItem('ddj-universe-hint') === 'off'; } catch (_) { /* ignore */ }
  if (!hintDismissed) {
    hint.append(el('p', { class: 'universe__hint-text', text: '拖动平移 · 滚轮/双指缩放 · 点击主题展开' }));
    const closeHint = el('button', { type: 'button', class: 'universe__hint-close', 'aria-label': '关闭提示', text: '×' });
    closeHint.addEventListener('click', () => {
      hint.remove();
      try { localStorage.setItem('ddj-universe-hint', 'off'); } catch (_) { /* ignore */ }
    });
    hint.append(closeHint);
    root.append(hint);
  }

  /* ============================================================
     坐标换算：节点世界坐标 → 画布屏幕坐标
     经 worldGroup.getScreenCTM() 取得「世界坐标 → 屏幕」矩阵，
     与节点完全同源，缩放/平移/复位后自动一致。
     ============================================================ */
  function worldToCanvas(x, y) {
    const m = worldGroup.getScreenCTM();
    if (!m) return null;
    const rect = canvasWrap.getBoundingClientRect();
    const p = new DOMPoint(x, y).matrixTransform(m);
    return { x: p.x - rect.left, y: p.y - rect.top };
  }

  function pxPerUnit() {
    const ctm = svgRoot.getScreenCTM();
    return ctm ? ctm.a : 1;
  }

  function nodeScreenR(n) {
    return n.r * pxPerUnit() * view.zoom;
  }

  function screenToWorld(sx, sy) {
    const m = worldGroup.getScreenCTM();
    if (!m) return null;
    return new DOMPoint(sx, sy).matrixTransform(m.inverse());
  }

  /* ============================================================
     移动端：安全可视区 / 面板状态机 / 取景重算
     —— 仅移动端生效；桌面端沿用原 computeFit 取景，不受影响。
     ============================================================ */
  function readSafeArea() {
    const cs = getComputedStyle(document.documentElement);
    const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
    return {
      top: num(cs.getPropertyValue('--sat-top')),
      bottom: num(cs.getPropertyValue('--sat-bottom')),
      left: num(cs.getPropertyValue('--sat-left')),
      right: num(cs.getPropertyValue('--sat-right')),
    };
  }

  // 听书播放器占用高度（由 listen-player 通过 CSS 变量 + 事件同步），用于收缩图谱安全区
  let listenHeightPx = 0;

  // 实际图谱可视区（canvas 局部像素坐标）：扣除顶部工具栏、底部面板、听书播放器、安全边距
  function getSafeRect() {
    const w = canvasWrap.clientWidth || window.innerWidth || 1;
    const h = canvasWrap.clientHeight || window.innerHeight || 1;
    const sa = readSafeArea();
    const headerH = header.offsetHeight || 56;
    const margin = 18;
    let bottom = sa.bottom + listenHeightPx;
    if (panelState !== 'closed') {
      const ph = parseFloat(panel.style.height) || (panelState === 'collapsed' ? 72 : Math.round(h * 0.34));
      bottom += ph;
    }
    const top = headerH + sa.top;
    const x = sa.left + margin;
    const y = top + margin;
    const rw = Math.max(w - sa.left - sa.right - margin * 2, 40);
    const rh = Math.max(h - top - bottom - margin * 2, 40);
    return { x, y, w: rw, h: rh };
  }

  // 将世界坐标下的一组节点适配进指定矩形；视图以 focalWorld（选中/聚焦节点）为可视区中心，
  // 保证选中节点始终落在安全区中心，不被顶部工具栏或底部面板遮挡。
  function fitIntoRect(list, rect, focalWorld, marginPx = 22) {
    if (!list.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    list.forEach((n) => {
      const pad = (n.r || 8) + 40;
      minX = Math.min(minX, n.x - pad); minY = Math.min(minY, n.y - pad);
      maxX = Math.max(maxX, n.x + pad); maxY = Math.max(maxY, n.y + pad);
    });
    const bw = (maxX - minX) || 1, bh = (maxY - minY) || 1;
    // 布局前（root 尚未插入 DOM）clientWidth/Height 为 0，会导致 s=0 进而 0/0=NaN；
    // 用视口尺寸兜底，保证始终算出有限取景（ResizeObserver 布局完成后再用真实尺寸重算）。
    const Wc = canvasWrap.clientWidth || window.innerWidth || 1;
    const Hc = canvasWrap.clientHeight || window.innerHeight || 1;
    const s = Math.min(Wc, Hc) / WORLD;          // SVG meet 缩放
    const availW = Math.max(rect.w - 2 * marginPx, 40);
    const availH = Math.max(rect.h - 2 * marginPx, 40);
    let zoom = Math.min(availW / (bw * s), availH / (bh * s));
    zoom = clamp(zoom, 0.3, 3.2);
    // 以焦点节点为中心（无焦点则取包围盒中心，即全景时世界中心）
    const fw = focalWorld ? focalWorld.x : (minX + bw / 2);
    const fh = focalWorld ? focalWorld.y : (minY + bh / 2);
    const targetCx = rect.x + rect.w / 2, targetCy = rect.y + rect.h / 2;
    const offX = (Wc - WORLD * s) / 2, offY = (Hc - WORLD * s) / 2;

    // 保证焦点节点不被顶部工具栏 / 底部面板遮挡：
    // 先按包围盒取景，再把焦点节点夹在安全区内；若节点本身比安全区还大，则缩至整体可见。
    const focalR = (focalWorld && Number.isFinite(focalWorld.r)) ? focalWorld.r : 8;
    const gap = 6;
    const fsr = focalR * zoom;
    let cx = targetCx, cy = targetCy;
    const minCx = rect.x + fsr + gap, maxCx = rect.x + rect.w - fsr - gap;
    const minCy = rect.y + fsr + gap, maxCy = rect.y + rect.h - fsr - gap;
    if (minCx > maxCx || minCy > maxCy) {
      // 焦点节点比安全区还大（如横屏矮视口下的大中央节点）：缩小取景至整体装下
      const fitByH = (rect.h - 2 * gap) / (2 * focalR);
      const fitByW = (rect.w - 2 * gap) / (2 * focalR);
      zoom = clamp(Math.min(zoom, fitByH, fitByW), 0.3, 3.2);
      const fsr2 = focalR * zoom;
      cx = rect.x + Math.min(rect.w / 2, fsr2 + gap);
      cy = rect.y + Math.min(rect.h / 2, fsr2 + gap);
    } else {
      cx = Math.min(Math.max(targetCx, minCx), maxCx);
      cy = Math.min(Math.max(targetCy, minCy), maxCy);
    }
    // viewBox 为 -900..900，世界原点在视口中心，故聚焦节点居中需补 viewBox 半幅偏移
    const viewX = (cx - offX) / s - fw * zoom - WORLD / 2;
    const viewY = (cy - offY) / s - fh * zoom - WORLD / 2;
    return { zoom, x: viewX, y: viewY };
  }

  // 当前选择/聚焦对应的世界节点集合
  function currentFocusList() {
    if (selectedId) {
      const n = byId.get(selectedId);
      if (!n) return [];
      if (n.kind === 'theme') return nodes.filter((x) => x.id === selectedId || x.themeId === selectedId);
      const nb = G.neighbors.get(selectedId) || new Set();
      return [n].concat([...nb].map((x) => byId.get(x)).filter(Boolean));
    }
    if (focusTheme) return nodes.filter((x) => x.id === focusTheme || x.themeId === focusTheme);
    return nodes;
  }

  // 依据当前模式 + 安全区重算取景（仅移动端生效）；焦点节点置于安全区中心
  function frameCurrent(animate = true) {
    if (!isMobile) return;
    if (panelState === 'full') return;   // 完整详情阅读模式：保持进入前取景，不重算
    const list = currentFocusList();
    const rect = getSafeRect();
    let focal = null;
    if (selectedId) { const n = byId.get(selectedId); if (n) focal = { x: n.x, y: n.y, r: n.r }; }
    else if (focusTheme) { const n = byId.get(focusTheme); if (n) focal = { x: n.x, y: n.y, r: n.r }; }
    const target = (selectedId || focusTheme) ? fitIntoRect(list, rect, focal) : fitIntoRect(nodes, rect, { x: 0, y: 0 });
    if (!target) return;
    if (!Number.isFinite(target.x) || !Number.isFinite(target.y) || !Number.isFinite(target.zoom)) return;
    if (animate) animateTo(target); else { Object.assign(view, target); updateTransform(); }
  }

  function applyPanelHeight() {
    if (panelState === 'closed' || panelState === 'full') { panel.style.height = ''; return; }
    const h = canvasWrap.clientHeight || window.innerHeight;
    const sa = readSafeArea();
    const headerH = header.offsetHeight || 56;
    const avail = Math.max(h - headerH - sa.top - sa.bottom, 120);
    let ph;
    if (panelState === 'collapsed') ph = 72;
    else ph = Math.round(avail * 0.34); // preview
    panel.style.height = ph + 'px';
  }

  // 图谱可交互性：完整详情阅读模式下，底层图谱不可点击、不可获得键盘焦点
  function setCanvasInteractive(on) {
    if (on) {
      canvasWrap.removeAttribute('inert');
      canvasWrap.removeAttribute('aria-hidden');
      canvasWrap.style.pointerEvents = '';
    } else {
      canvasWrap.setAttribute('inert', '');
      canvasWrap.setAttribute('aria-hidden', 'true');
      canvasWrap.style.pointerEvents = 'none';
    }
  }

  // 从完整详情返回图谱：恢复进入前的取景与选中（full 期间未改动 view）
  function exitFull() {
    setPanelState('preview', { reframe: false });
  }

  // 面板状态切换：更新高度、重渲染内容、移动端重算取景；full = 专注阅读模式
  function setPanelState(state, opts = {}) {
    const reframe = opts.reframe !== false;
    panelState = state;
    if (state === 'closed') {
      panel.classList.remove('universe__panel--open', 'universe__panel--full');
      overlay.classList.remove('universe__panel-overlay--open');
      panel.style.height = '';
      setCanvasInteractive(true);
      if (isMobile) { applyPanelHeight(); if (reframe) frameCurrent(); }
      return;
    }
    panel.classList.add('universe__panel--open');
    if (!isMobile) {
      overlay.classList.add('universe__panel-overlay--open');
      return;               // 桌面端维持原侧栏布局，不改高度/不重算取景
    }
    if (state === 'full') {
      panel.classList.add('universe__panel--full');
      setCanvasInteractive(false);
      if (currentPanelNode) renderPanel(currentPanelNode, 'full');
      applyPanelHeight();
      return;               // 不重算取景，保留进入前图谱位置/缩放/选中
    }
    // collapsed / preview：恢复图谱交互、去掉全屏类、重算取景
    panel.classList.remove('universe__panel--full');
    setCanvasInteractive(true);
    overlay.classList.remove('universe__panel-overlay--open');
    if (currentPanelNode) renderPanel(currentPanelNode, state);
    applyPanelHeight();
    if (reframe) frameCurrent();
  }

  /* ---------- 命中测试：屏幕距离最近优先，保证 44px 热区且结果确定 ---------- */
  function pickNode(clientX, clientY) {
    const rect = canvasWrap.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    let best = null; let bestD = Infinity;
    for (const n of nodes) {
      const p = worldToCanvas(n.x, n.y);
      if (!p) continue;
      const d = Math.hypot(p.x - sx, p.y - sy);
      const thresh = Math.max(nodeScreenR(n) + 6, HIT_MIN_PX);
      if (d <= thresh && d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  /* ============================================================
     标签：可见性 + 真实边界避让
     ============================================================ */
  function measureLabels() {
    // 用 getBoundingClientRect 取亚像素尺寸：offsetWidth/Height 为整数，会低估高度并压缩避让间隙
    labelEls.forEach((rec) => {
      rec.el.hidden = false;
      const r = rec.el.getBoundingClientRect();
      rec.w = r.width;
      rec.h = r.height;
      rec.el.hidden = true;
    });
  }

  function labelPriority(n) {
    let p = 0;
    if (n.kind === 'theme') p = 100;
    else if (n.kind === 'concept') p = 40;
    else p = 10;
    if (searchHits.has(n.id)) p = Math.max(p, 85);
    if (selectedId === n.id) p = Math.max(p, 90);
    else if (selectedId && G.neighbors.get(selectedId) && G.neighbors.get(selectedId).has(n.id)) p = Math.max(p, 75);
    // 聚焦 / 选中态下的概念与章号必须可见（≥65），避让失败也不隐藏
    if (focusTheme && n.themeId === focusTheme && n.kind === 'concept') p = Math.max(p, 70);
    if (focusTheme && n.themeId === focusTheme && n.kind === 'chapter') p = Math.max(p, 66);
    return p;
  }

  function desiredVisible(n) {
    if (n.kind === 'theme') return true;
    if (searchHits.has(n.id)) return true;
    if (selectedId === n.id) return true;
    if (selectedId && G.neighbors.get(selectedId) && G.neighbors.get(selectedId).has(n.id)) return true;
    if (focusTheme && n.themeId === focusTheme) return true;
    if (mode === 'overview' && n.kind === 'concept') {
      // 全景：仅显示关联章节最多的若干代表概念
      const ranked = conceptRank.slice(0, conceptBudget());
      return ranked.includes(n.id);
    }
    return false;
  }

  const conceptRank = universe.concepts
    .map((c) => ({ id: c.id, n: universe.relationships.filter((r) => r.sourceId === c.id && r.targetType === 'chapter').length }))
    .sort((a, b) => b.n - a.n)
    .map((x) => x.id);

  function conceptBudget() {
    const w = canvasWrap.clientWidth || window.innerWidth;
    if (w < 560) return 5;
    if (w < 900) return 8;
    return 12;
  }

  let labelsMeasured = false;
  let measuredAtWidth = -1;
  function layoutLabels() {
    const rect0 = canvasWrap.getBoundingClientRect();
    // 尺寸会随视口/断点变化（字号是响应式 clamp），宽度变化时必须重新测量，
    // 否则会沿用旧断点测得的尺寸做避让，产生实际重叠。
    if (!labelsMeasured || Math.abs(rect0.width - measuredAtWidth) > 1) {
      measureLabels();
      labelsMeasured = true;
      measuredAtWidth = rect0.width;
    }
    const rect = canvasWrap.getBoundingClientRect();
    const padX = 8; const padY = 8;
    const candidates = [];
    for (const n of nodes) {
      if (n.kind === 'dao') continue;
      if (!desiredVisible(n)) { labelEls.get(n.id).el.hidden = true; continue; }
      const p = worldToCanvas(n.x, n.y);
      if (!p) { labelEls.get(n.id).el.hidden = true; continue; }
      // 节点已移出可视区：不绘制其标签（避免标签被钳到边缘而脱离节点）
      if (p.x < -24 || p.y < -24 || p.x > rect.width + 24 || p.y > rect.height + 24) {
        labelEls.get(n.id).el.hidden = true;
        continue;
      }
      candidates.push({ n, p, pr: labelPriority(n) });
    }
    candidates.sort((a, b) => b.pr - a.pr);

    // 图谱中心（中央「道」）的屏幕位置，用于计算标签的径向外扩方向
    const center = worldToCanvas(0, 0) || { x: rect.width / 2, y: rect.height / 2 };
    const placed = [];

    for (const item of candidates) {
      const rec = labelEls.get(item.n.id);
      if (!rec.w || !rec.h) {
        const rr = rec.el.getBoundingClientRect();
        rec.w = rr.width; rec.h = rr.height;
      }
      // 尚未测得真实尺寸（元素仍隐藏）时不参与布局，避免用 0×0 盒子占位导致重叠
      if (!rec.w || !rec.h) { rec.el.hidden = true; continue; }
      const w = rec.w; const h = rec.h;
      const r = nodeScreenR(item.n);
      // 窄屏空间不足：章号（66）允许避让失败时隐藏，改由底部面板列出全部章节；
      // 宽屏则强制可见。主题 / 选中 / 搜索命中在任何屏幕都必须可见。
      const must = item.pr >= (rect.width >= 560 ? 65 : 68);

      // 优先沿「远离中心」的径向摆放：环形布局下标签自然向外发散，减少切向拥挤
      const d1 = r + 6 + h / 2;
      const d2 = r + 8 + w / 2;
      const d3 = r + 6 + h;
      const q = d2 * 0.72;
      const vx = item.p.x - center.x;
      const vy = item.p.y - center.y;
      const vlen = Math.hypot(vx, vy) || 1;
      const ux = vx / vlen; const uy = vy / vlen;
      const rad = r + 10 + (Math.abs(ux) * w + Math.abs(uy) * h) / 2;
      const cos45 = 0.7071;
      const offsets = [
        { dx: ux * rad, dy: uy * rad },
        { dx: (ux * cos45 - uy * cos45) * rad, dy: (uy * cos45 + ux * cos45) * rad },
        { dx: (ux * cos45 + uy * cos45) * rad, dy: (uy * cos45 - ux * cos45) * rad },
        { dx: 0, dy: d1 },
        { dx: 0, dy: -d1 },
        { dx: d2, dy: 0 },
        { dx: -d2, dy: 0 },
        { dx: q, dy: d1 },
        { dx: -q, dy: d1 },
        { dx: q, dy: -d1 },
        { dx: -q, dy: -d1 },
        { dx: 0, dy: d3 },
        { dx: 0, dy: -d3 },
      ];

      // 在所有候选位中挑选「无碰撞且最贴近节点」的一个，而非固定顺序首个命中
      let chosen = null;
      for (const off of offsets) {
        const cx = item.p.x + off.dx;
        const cy = item.p.y + off.dy;
        const box = { x: cx - w / 2, y: cy - h / 2, w, h };
        if (box.x < padX || box.y < padY || box.x + box.w > rect.width - padX || box.y + box.h > rect.height - padY) continue;
        let hit = false;
        // 内部按 9px 判定，保证实际视觉间隔稳定 ≥ 8px（留出亚像素余量）
        const gap = LABEL_GAP + 1;
        for (const q2 of placed) {
          if (box.x < q2.x + q2.w + gap && box.x + box.w + gap > q2.x
              && box.y < q2.y + q2.h + gap && box.y + box.h + gap > q2.y) { hit = true; break; }
        }
        if (hit) continue;
        const mag = Math.hypot(off.dx, off.dy);
        if (!chosen || mag < chosen.mag) chosen = { cx, cy, box, mag };
      }

      if (!chosen) {
        if (!must) { rec.el.hidden = true; continue; }
        const off = offsets[0];
        const cx = clamp(item.p.x + off.dx, w / 2 + padX, rect.width - w / 2 - padX);
        const cy = clamp(item.p.y + off.dy, h / 2 + padY, rect.height - h / 2 - padY);
        chosen = { cx, cy, box: { x: cx - w / 2, y: cy - h / 2, w, h } };
      }

      placed.push({
        id: item.n.id,
        cx: chosen.cx, cy: chosen.cy,
        ocx: chosen.cx, ocy: chosen.cy,
        x: chosen.box.x, y: chosen.box.y,
        w: chosen.box.w, h: chosen.box.h,
        pr: item.pr,
      });
    }

    // —— 残余重叠分离（优先级感知）——
    // 贪心候选挑选在标签密集（主题聚焦 / 章节环）时仍可能留下少量重叠，
    // 这里做几轮轻量分离：沿「代价更小」的轴把低优先级标签推离高优先级，
    // 并把位移限制在预算内，保证标签仍贴近节点且不越出视口。
    const MAX_PUSH = 46, SEP_GAP = LABEL_GAP + 1, SEP_ITER = 18;
    for (let it = 0; it < SEP_ITER; it++) {
      let moved = false;
      for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) {
          const A = placed[i], B = placed[j];
          const ax = A.x + A.w / 2, ay = A.y + A.h / 2;
          const bx = B.x + B.w / 2, by = B.y + B.h / 2;
          const ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
          const oy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
          if (ox > 0 && oy > 0) {
            const pushX = ox + SEP_GAP, pushY = oy + SEP_GAP;
            const rigA = A.pr, rigB = B.pr, tot = (rigA + rigB) || 1;
            const shareA = rigB / tot, shareB = rigA / tot; // 高优先级少动
            if (pushX <= pushY) {
              const dir = (bx >= ax) ? 1 : -1;
              A.cx += -dir * pushX * shareA; B.cx += dir * pushX * shareB;
            } else {
              const dir = (by >= ay) ? 1 : -1;
              A.cy += -dir * pushY * shareA; B.cy += dir * pushY * shareB;
            }
            A.x = A.cx - A.w / 2; A.y = A.cy - A.h / 2;
            B.x = B.cx - B.w / 2; B.y = B.cy - B.h / 2;
            moved = true;
          }
        }
      }
      if (!moved) break;
      for (const b of placed) {
        b.cx = clamp(b.cx, b.ocx - MAX_PUSH, b.ocx + MAX_PUSH);
        b.cy = clamp(b.cy, b.ocy - MAX_PUSH, b.ocy + MAX_PUSH);
        b.cx = clamp(b.cx, b.w / 2 + padX, rect.width - b.w / 2 - padX);
        b.cy = clamp(b.cy, b.h / 2 + padY, rect.height - b.h / 2 - padY);
        b.x = b.cx - b.w / 2; b.y = b.cy - b.h / 2;
      }
    }

    // 应用最终位置（保留亚像素精度，不取整）
    for (const b of placed) {
      const rec = labelEls.get(b.id);
      if (!rec) continue;
      rec.el.hidden = false;
      rec.el.style.transform = `translate(${(b.cx - b.w / 2).toFixed(2)}px, ${(b.cy - b.h / 2).toFixed(2)}px)`;
    }

    // 中央徽记跟随 dao 节点
    const dp = worldToCanvas(0, 0);
    if (dp) {
      const size = daoBadge.offsetWidth || 120;
      daoBadge.style.transform = `translate(${Math.round(dp.x - size / 2)}px, ${Math.round(dp.y - size / 2)}px)`;
      daoBadge.hidden = false;
    }
  }

  /* ============================================================
     连线分级显示
     ============================================================ */
  function updateEdges() {
    edgeEls.forEach(({ edge, el: line }) => {
      let show = false;
      if (selectedId) {
        show = edge.source === selectedId || edge.target === selectedId;
      } else if (focusTheme) {
        // 主题聚焦：只显示该主题分区内部的关系，跨主题长线留到选中节点时再显示
        if (edge.type === 'dao-theme') show = edge.target === focusTheme;
        else if (edge.type === 'theme-concept') show = edge.themeId === focusTheme;
        else if (edge.type === 'concept-chapter') {
          const ch = byId.get(edge.target);
          show = edge.themeId === focusTheme && !!ch && ch.themeId === focusTheme;
        } else show = false;
      } else {
        // 全景：中央→主题的主干 + 主题内主归属关系；隐藏跨主题与章节连线
        show = edge.type === 'dao-theme' || (edge.type === 'theme-concept' && edge.primary);
      }
      line.style.display = show ? '' : 'none';
    });
  }

  function updateNodes() {
    const active = new Set();
    if (selectedId) {
      active.add(selectedId);
      const nb = G.neighbors.get(selectedId);
      if (nb) nb.forEach((id) => active.add(id));
    }
    nodes.forEach((n) => {
      const g = n._g;
      if (!g) return;
      let dim = false;
      if (selectedId) dim = !active.has(n.id);
      else if (focusTheme) dim = !(n.themeId === focusTheme || n.kind === 'dao' || n.id === focusTheme);
      g.classList.toggle('dim', dim);
      g.classList.toggle('selected', selectedId === n.id);
    });
  }

  /* ============================================================
     视图变换
     ============================================================ */
  function updateTransform() {
    if (!Number.isFinite(view.x) || !Number.isFinite(view.y) || !Number.isFinite(view.zoom)) return;
    worldGroup.setAttribute('transform', `translate(${view.x}, ${view.y}) scale(${view.zoom})`);
    layoutLabels();
    saveState({ ...view, selected: selectedId, search: searchQuery });
  }

  // 计算包围盒对应的目标视图（不直接写入 view，便于做插值动画）
  function computeFit(list, margin = 0.78) {
    if (!list.length) return null;
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    list.forEach((n) => {
      const pad = (n.r || 8) + 46;
      minX = Math.min(minX, n.x - pad); minY = Math.min(minY, n.y - pad);
      maxX = Math.max(maxX, n.x + pad); maxY = Math.max(maxY, n.y + pad);
    });
    const bw = (maxX - minX) || 1; const bh = (maxY - minY) || 1;
    const k = Math.min((WORLD * margin) / bw, (WORLD * margin) / bh);
    const zoom = clamp(k, 0.3, 3.2);
    return { zoom, x: -zoom * (minX + bw / 2), y: -zoom * (minY + bh / 2) };
  }

  // 径向取景：布局以原点为中心，按「最大半径」适配可避免包围盒偏心浪费空间，
  // 让八个主题环尽可能舒展地铺开（用于全景 / 复位）
  function computeFitCircle(list, margin = 0.92) {
    let maxR = 0;
    list.forEach((n) => { maxR = Math.max(maxR, Math.hypot(n.x, n.y) + (n.r || 8) + 44); });
    if (!maxR) return null;
    return { zoom: clamp((WORLD * margin / 2) / maxR, 0.3, 3.2), x: 0, y: 0 };
  }

  function fitToBox(list, margin = 0.78) {
    const t = computeFit(list, margin);
    if (!t) return;
    Object.assign(view, t);
  }

  // 逐帧插值：每帧重算标签位置，保证标签与节点始终同步（避免 CSS 过渡导致标签滞后）
  let animId = 0;
  function animateTo(target, duration = 420) {
    if (!target) return;
    cancelAnimationFrame(animId);
    worldGroup.style.transition = 'none';
    if (REDUCED) { Object.assign(view, target); updateTransform(); return; }
    const start = { x: view.x, y: view.y, zoom: view.zoom };
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / duration);
      const e = p < 0.5 ? 2 * p * p : 1 - ((-2 * p + 2) ** 2) / 2;
      view.x = start.x + (target.x - start.x) * e;
      view.y = start.y + (target.y - start.y) * e;
      view.zoom = start.zoom + (target.zoom - start.zoom) * e;
      updateTransform();
      if (p < 1) animId = requestAnimationFrame(step);
    };
    animId = requestAnimationFrame(step);
  }

  function resetView(animate) {
    mode = 'overview'; focusTheme = null; selectedId = null; currentPanelNode = null;
    updateEdges(); updateNodes();           // 清除选中/淡化高亮（桌面与移动端都需要）
    setPanelState('closed');                 // 移动端会重算取景到安全区
    if (!isMobile) {
      const t = computeFitCircle(nodes);
      if (animate) animateTo(t); else { if (t) Object.assign(view, t); updateTransform(); }
    }
  }

  function zoomBy(factor, sx, sy) {
    const nz = clamp(view.zoom * factor, 0.3, 3.2);
    if (nz === view.zoom) return;
    const r = nz / view.zoom;
    if (sx === undefined) {
      const rect = canvasWrap.getBoundingClientRect();
      sx = rect.left + rect.width / 2; sy = rect.top + rect.height / 2;
    }
    const w = screenToWorld(sx, sy);
    if (w) { view.x = r * view.x + (1 - r) * w.x; view.y = r * view.y + (1 - r) * w.y; }
    view.zoom = nz;
    updateTransform();   // 立即生效并由每帧重排保证标签同步（不使用 CSS 过渡）
  }

  /* ============================================================
     交互状态切换
     ============================================================ */
  function selectTheme(themeId, opts = {}) {
    selectedId = null;
    focusTheme = themeId;
    mode = 'theme';
    const node = byId.get(themeId);
    currentPanelNode = node;
    const list = nodes.filter((n) => n.id === themeId || n.themeId === themeId);
    updateEdges(); updateNodes();
    if (!isMobile) {
      // 只取景到该主题及其概念/章节（不含中央「道」，否则包围盒被拉大而挤在一起）
      animateTo(computeFit(list, 0.58));
      renderPanel(node, 'full');
      openPanel();
    } else {
      setPanelState('preview', { reframe: opts.reframe !== false });  // 内部渲染 + 高度 + 取景重算
    }
  }

  function selectNode(id, opts = {}) {
    const n = byId.get(id);
    if (!n) return;
    if (n.kind === 'chapter') { activateChapter(n); return; }
    selectedId = id;
    focusTheme = n.kind === 'theme' ? id : null;
    mode = 'node';
    currentPanelNode = n;
    updateEdges(); updateNodes();
    if (!isMobile) {
      let target;
      if (n.kind === 'theme') {
        const tList = nodes.filter((x) => x.id === id || x.themeId === id);
        target = computeFit(tList, 0.74);
      } else {
        const nb = G.neighbors.get(id) || new Set();
        const nList = [n].concat([...nb].map((x) => byId.get(x)).filter(Boolean));
        target = computeFit(nList, 0.62);
      }
      if (target) animateTo(target);
      renderPanel(n, 'full');
      openPanel();
    } else {
      setPanelState('preview', { reframe: opts.reframe !== false });  // 内部渲染 + 高度 + 取景重算
    }
  }

  function activateChapter(n) {
    saveState({ ...view, selected: null, search: searchQuery });
    location.hash = `#/chapters/${n.id}?from=universe`;
  }

  function openPanel() {
    panelState = 'preview';
    panel.classList.add('universe__panel--open');
    overlay.classList.add('universe__panel-overlay--open');
  }

  function closePanel(silent) {
    if (!silent) {
      selectedId = null;
      currentPanelNode = null;
      if (mode === 'node') { mode = focusTheme ? 'theme' : 'overview'; }
      updateEdges(); updateNodes(); updateTransform();
    }
    setPanelState('closed');
  }

  /* ---------- 面板内容（三态：collapsed / preview / full） ---------- */
  function nodeTitle(node) {
    if (node.kind === 'dao') return '道';
    if (node.kind === 'theme') return node.data.name;
    if (node.kind === 'concept') return node.data.name;
    return `第 ${node.data.number} 章 ${node.data.titleHint}`;
  }
  function relatedSummary(node) {
    if (node.kind === 'theme') {
      const concepts = universe.concepts.filter((c) => c.themes.includes(node.data.id));
      return `相关概念 ${concepts.length} · 章节若干 · 点击展开完整详情`;
    }
    if (node.kind === 'concept') {
      const n = universe.relationships.filter((r) => r.sourceId === node.id && r.targetType === 'chapter').length;
      return `原文证据 ${n} 条 · 点击展开`;
    }
    if (node.kind === 'chapter') return '点击查看完整章节关联';
    return '';
  }

  function renderPanelContent(node, body, mode) {
    if (node.kind === 'dao') {
      body.append(el('h2', { class: 'universe__panel-title', text: '道' }));
      body.append(el('p', { class: 'universe__panel-text', text: node.data.explanation }));
      return;
    }
    if (node.kind === 'theme') {
      body.append(el('h2', { class: 'universe__panel-title', text: node.data.name }));
      body.append(el('p', { class: 'universe__panel-note', text: '本站编辑整理的阅读视角，不等同于经典原有分类。主要归属仅用于布局，不代表排他分类。' }));
      body.append(el('p', { class: 'universe__panel-text', text: node.data.summary }));
      const concepts = universe.concepts.filter((c) => c.themes.includes(node.data.id));
      body.append(el('h3', { text: `相关概念（${concepts.length}）` }));
      body.append(el('ul', { class: 'universe__panel-list' }, concepts.map((c) => el('li', {}, [
        el('button', { type: 'button', class: 'link', onclick: () => selectNode(c.id) }, [c.name]),
      ]))));
      const conceptIds = new Set(concepts.map((c) => c.id));
      const chapterIds = new Set(universe.relationships
        .filter((r) => r.sourceType === 'concept' && conceptIds.has(r.sourceId) && r.targetType === 'chapter')
        .map((r) => r.targetId));
      body.append(el('h3', { text: `相关章节（${chapterIds.size}）` }));
      body.append(el('ul', { class: 'universe__panel-list' }, [...chapterIds].map((cid) => {
        const ch = byId.get(cid);
        return el('li', {}, [
          el('a', { class: 'link', href: `#/chapters/${cid}?from=universe`, text: `第 ${ch?.number || '?'} 章 ${ch?.data?.titleHint || ''}` }),
        ]);
      })));
      return;
    }
    if (node.kind === 'concept') {
      body.append(el('h2', { class: 'universe__panel-title', text: node.data.name }));
      body.append(el('p', { class: 'universe__panel-label', text: '解读' }));
      body.append(el('p', { class: 'universe__panel-text', text: node.data.explanation }));
      const rels = universe.relationships.filter((r) => r.sourceId === node.id && r.targetType === 'chapter');
      const shown = mode === 'preview' ? rels.slice(0, 2) : rels;
      body.append(el('h3', { text: `原文证据（${rels.length}）` }));
      body.append(el('ul', { class: 'universe__panel-list' }, shown.map((r) => el('li', {}, [
        el('blockquote', { class: 'universe__panel-quote', text: r.quote }),
        el('p', { class: 'universe__panel-reason', text: r.reason }),
        el('div', { class: 'universe__panel-cta' }, [
          el('a', { class: 'btn btn--sm btn--ghost', href: `#/chapters/${r.targetId}?from=universe&q=${encodeURIComponent(r.quote)}`, text: `第 ${r.chapterNumber} 章` }),
          el('button', { type: 'button', class: 'btn btn--sm btn--ghost', onclick: () => Listen.playOriginal(r.targetId) }, ['听原文']),
        ]),
      ]))));
      return;
    }
    // chapter
    const chapter = getChapter(data, node.id);
    body.append(el('h2', { class: 'universe__panel-title', text: `第 ${node.data.number} 章 ${node.data.titleHint}` }));
    body.append(el('div', { class: 'universe__panel-cta' }, [
      el('a', { class: 'btn btn--primary', href: `#/chapters/${node.id}?from=universe`, text: '阅读本章正文' }),
      el('button', { type: 'button', class: 'btn btn--sm btn--ghost', onclick: () => Listen.playOriginal(node.id) }, ['听原文']),
    ]));
    const rels = (node.rels || []).slice(0, mode === 'preview' ? 2 : 8);
    body.append(el('h3', { text: '相关概念' }));
    body.append(el('ul', { class: 'universe__panel-list' }, rels.map((r) => {
      const c = byId.get(r.sourceId);
      return el('li', {}, [
        el('button', { type: 'button', class: 'link', onclick: () => selectNode(r.sourceId) }, [c?.data?.name || r.sourceId]),
        el('p', { class: 'universe__panel-quote', text: r.quote }),
      ]);
    })));
    if (chapter) body.append(el('p', { class: 'universe__panel-text', text: chapter.original_text }));
  }

  function renderPanel(node, state = 'preview') {
    clear(panel);
    if (!node) return;

    // 移动端「完整详情」：专注阅读模式（实色全屏，无图谱、无缩放工具）
    if (state === 'full' && isMobile) {
      const topbar = el('div', { class: 'universe__panel-topbar' }, [
        el('button', { type: 'button', class: 'btn btn--ghost btn--sm universe__back-graph', onclick: exitFull }, [el('span', { text: '← 返回图谱' })]),
        el('div', { class: 'universe__panel-topname', text: nodeTitle(node) }),
        el('button', { type: 'button', class: 'btn btn--ghost btn--sm universe__panel-topclose', 'aria-label': '关闭', onclick: () => { closePanel(false); } }, [el('span', { text: '×' })]),
      ]);
      const body = el('div', { class: 'universe__panel-body universe__panel-body--full' });
      panel.append(topbar, body);
      renderPanelContent(node, body, 'full');
      return;
    }

    const handle = el('div', { class: 'universe__panel-handle', 'aria-hidden': 'true' });

    const closeBtn = el('button', {
      type: 'button', class: 'universe__panel-close btn btn--ghost btn--sm', 'aria-label': '关闭面板',
      onclick: () => { closePanel(false); },
    }, [el('span', { text: '×' })]);

    const actions = el('div', { class: 'universe__panel-actions' });
    if (state === 'collapsed') {
      actions.append(el('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => setPanelState('preview') }, [el('span', { text: '展开' })]));
    } else if (state === 'preview') {
      actions.append(
        el('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => setPanelState('full') }, [el('span', { text: '查看全部' })]),
        el('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => setPanelState('collapsed') }, [el('span', { text: '收起' })]),
      );
    } else {
      // 桌面端完整态（沿用原侧栏布局）
      actions.append(el('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => setPanelState('collapsed') }, [el('span', { text: '收起' })]));
    }

    const body = el('div', { class: 'universe__panel-body' });
    panel.append(handle, actions, closeBtn, body);

    // 收起态：仅名称 + 相关章数，最大化图谱可视区
    if (state === 'collapsed') {
      body.append(el('h2', { class: 'universe__panel-title', text: nodeTitle(node) }));
      body.append(el('p', { class: 'universe__panel-note', text: relatedSummary(node) }));
      return;
    }

    renderPanelContent(node, body, state === 'preview' ? 'preview' : 'full');
  }

  /* ---------- 搜索 ---------- */
  function runSearch(query) {
    searchQuery = query.trim();
    searchHits = new Set();
    clear(searchResults);

    if (!searchQuery) {
      searchResults.hidden = true;
      saveState({ ...view, selected: selectedId, search: '' });
      updateTransform();
      return;
    }

    const q = searchQuery.toLowerCase();
    const results = [];

    const num = parseInt(searchQuery, 10);
    if (!Number.isNaN(num) && num >= 1 && num <= 81) {
      const ch = nodes.find((n) => n.kind === 'chapter' && n.number === num);
      if (ch) results.push({ id: ch.id, label: `第 ${num} 章`, sub: ch.data.titleHint });
    }
    universe.concepts.forEach((c) => {
      if (c.name.includes(searchQuery) || c.explanation.includes(searchQuery)) {
        results.push({ id: c.id, label: c.name, sub: '概念' });
      }
    });
    universe.themes.forEach((t) => {
      if (t.name.includes(searchQuery)) results.push({ id: t.id, label: t.name, sub: '主题' });
    });
    universe.chapters.forEach((ch) => {
      const full = data.chapterById.get(ch.id);
      if (full && full.original_text.includes(searchQuery)) {
        results.push({ id: ch.id, label: `第 ${ch.number} 章`, sub: ch.titleHint });
      }
    });

    results.forEach((r) => searchHits.add(r.id));

    if (results.length) {
      searchResults.append(...results.slice(0, 8).map((r) => el('li', {}, [
        el('button', {
          type: 'button', class: 'link',
          onclick: () => {
            const target = byId.get(r.id);
            if (target && target.kind === 'chapter') activateChapter(target);
            else selectNode(r.id);
            searchResults.hidden = true;
          },
        }, [r.label]),
        el('span', { class: 'muted', text: ` · ${r.sub}` }),
      ])));
    } else {
      searchResults.append(el('li', { class: 'muted', text: '无结果' }));
    }
    searchResults.hidden = false;
    saveState({ ...view, selected: selectedId, search: searchQuery });
    updateTransform();
  }

  function runSearchSubmit() {
    if (!searchQuery) return;
    const first = [...searchHits][0];
    if (!first) return;
    const t = byId.get(first);
    if (t && t.kind === 'chapter') activateChapter(t); else selectNode(first);
  }

  /* ---------- 列表视图 ---------- */
  function toggleList() {
    listMode = !listMode;
    if (listMode) {
      renderListView();
      listView.classList.add('universe__list--open');
      canvasWrap.classList.add('universe__canvas--hidden');
      btnList.classList.add('active');
    } else {
      listView.classList.remove('universe__list--open');
      canvasWrap.classList.remove('universe__canvas--hidden');
      btnList.classList.remove('active');
    }
  }

  function renderListView() {
    clear(listView);
    listView.append(el('button', { type: 'button', class: 'btn btn--ghost universe__list-close', onclick: toggleList }, [el('span', { text: '返回图谱' })]));
    listView.append(el('h2', { class: 'universe__list-title', text: '按主题浏览' }));
    universe.themes.forEach((theme) => {
      const concepts = universe.concepts.filter((c) => c.themes.includes(theme.id));
      listView.append(el('section', { class: 'card' }, [
        el('h3', { text: theme.name }),
        el('p', { class: 'card__text', text: theme.summary }),
        el('ul', { class: 'universe__panel-list' }, concepts.map((c) => el('li', {}, [
          el('button', { type: 'button', class: 'link', onclick: () => { toggleList(); selectNode(c.id); } }, [c.name]),
        ]))),
      ]));
    });
    listView.append(el('h2', { class: 'universe__list-title', text: '全部 81 章' }));
    const chapterList = el('ul', { class: 'chapter-list' });
    universe.chapters.forEach((ch) => {
      chapterList.append(el('li', {}, [
        el('a', { class: 'chapter-list__link', href: `#/chapters/${ch.id}?from=universe`, text: `第 ${ch.number} 章 ${ch.titleHint}` }),
      ]));
    });
    listView.append(chapterList);
  }

  /* ============================================================
     指针交互：拖动平移 + 点击命中（分离，避免误触）
     ============================================================ */
  let dragging = null;
  let pinch = null;
  let downPos = null;

  canvasWrap.addEventListener('pointerdown', (e) => {
    downPos = { x: e.clientX, y: e.clientY };
    dragging = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    try { canvasWrap.setPointerCapture(e.pointerId); } catch (_) { /* 合成事件可能无活动指针 */ }
    worldGroup.style.transition = 'none';
  });

  canvasWrap.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const s = pxPerUnit() || 1;
    view.x = dragging.vx + (e.clientX - dragging.x) / s;
    view.y = dragging.vy + (e.clientY - dragging.y) / s;
    updateTransform();
  });

  function endDrag(e) {
    if (!dragging) return;
    const moved = downPos ? Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) : 999;
    dragging = null;
    if (moved > 6) return;                    // 视为拖动，不触发选中
    // 移动端：被底部面板遮挡的区域不响应图谱点击（被遮节点不可点）
    if (isMobile && panelState !== 'closed') {
      const pr = panel.getBoundingClientRect();
      if (e.clientX >= pr.left && e.clientX <= pr.right && e.clientY >= pr.top && e.clientY <= pr.bottom) return;
    }
    const hit = pickNode(e.clientX, e.clientY);
    if (!hit) { closePanel(false); return; }
    if (hit.kind === 'chapter') activateChapter(hit);
    else if (hit.kind === 'theme') selectTheme(hit.id);
    else selectNode(hit.id);
  }

  canvasWrap.addEventListener('pointerup', endDrag);
  canvasWrap.addEventListener('pointercancel', () => { dragging = null; });

  canvasWrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.12 : 0.89, e.clientX, e.clientY);
  }, { passive: false });

  canvasWrap.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      const [t1, t2] = [e.touches[0], e.touches[1]];
      pinch = { d: Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY) };
    }
  }, { passive: true });

  canvasWrap.addEventListener('touchmove', (e) => {
    if (pinch && e.touches.length === 2) {
      e.preventDefault();
      const [t1, t2] = [e.touches[0], e.touches[1]];
      const d = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      if (pinch.d > 0) zoomBy(d / pinch.d, (t1.clientX + t2.clientX) / 2, (t1.clientY + t2.clientY) / 2);
      pinch.d = d;
    }
  }, { passive: false });

  canvasWrap.addEventListener('touchend', () => { pinch = null; });
  canvasWrap.addEventListener('touchcancel', () => { pinch = null; });

  /* ---------- 尺寸变化（窗口 / 可视区 / 容器 / 方向） ---------- */
  function reframeIfMobile() {
    if (!isMobile) return;
    applyPanelHeight();
    frameCurrent();
  }
  const onResize = () => { isMobile = isMobileLayout(); updateTransform(); reframeIfMobile(); };
  window.addEventListener('resize', onResize);
  if (window.visualViewport) {
    const vv = () => reframeIfMobile();
    window.visualViewport.addEventListener('resize', vv);
    window.visualViewport.addEventListener('scroll', vv);
  }
  if (window.ResizeObserver) {
    new ResizeObserver(() => reframeIfMobile()).observe(canvasWrap);
  }
  window.addEventListener('orientationchange', () => { setTimeout(reframeIfMobile, 200); });

  // 听书播放器出现/收起/尺寸变化时，收缩图谱安全区并重算取景（保留已有坐标与遮挡修复）
  window.addEventListener('listen:playerchange', (e) => {
    const h = (e && e.detail && Number.isFinite(e.detail.height)) ? e.detail.height : 0;
    if (h === listenHeightPx) return;
    listenHeightPx = h;
    if (isMobile) { applyPanelHeight(); frameCurrent(); }
  });

  /* ---------- 初始化 ---------- */
  if (needsFit) { const t0 = computeFitCircle(nodes); if (t0) Object.assign(view, t0); }
  updateEdges(); updateNodes();
  updateTransform();

  // 字体就绪后重新测量标签真实边界（避免字体加载前后测量失效）
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { measureLabels(); layoutLabels(); });
  }
  requestAnimationFrame(() => { measureLabels(); layoutLabels(); });

  // 恢复上次选择（移动端不恢复跨会话选择，避免残留选中态遮挡）
  if (!isMobile && savedState.selected && byId.has(savedState.selected)) {
    const n = byId.get(savedState.selected);
    if (n.kind === 'chapter') { /* 章节不入面板，直接回到全景 */ }
    else if (n.kind === 'theme') selectTheme(n.id);
    else selectNode(n.id);
  }
  if (searchQuery) runSearch(searchQuery);

  // URL focus 参数
  const focusParam = new URLSearchParams(location.hash.split('?')[1] || '').get('focus');
  if (focusParam && byId.has(focusParam)) {
    const n = byId.get(focusParam);
    // reframe:false —— 仅开面板，取景留给下方延迟到布局完成后的 frameCurrent，避免竖→横时用旧尺寸取景
    if (n.kind === 'theme') selectTheme(n.id, { reframe: false }); else selectNode(n.id, { reframe: false });
  }

  // 移动端初始取景：扣安全区，避免顶栏/底栏遮挡。
  // 延迟到布局完成后再取景——模块初始化时 canvas 尚未插入 DOM，直接取景会回退到
  // window.innerHeight（竖→横切换时可能是旧肖像尺寸），导致横屏沿用肖像取景把节点顶到工具栏下。
  // 双 rAF 不够稳：经 hash 导航进入的新文档，视口尺寸有时在初始布局后才生效、且不触发 resize 事件，
  // 故再追加一个 setTimeout 兜底，确保最终取景与真实横/竖屏一致（frameCurrent(false) 幂等、无动画）。
  if (isMobile) {
    const initFrame = () => { if (isMobile && panelState !== 'full') { applyPanelHeight(); frameCurrent(false); } };
    requestAnimationFrame(() => requestAnimationFrame(initFrame));
    // 兜底：极少数情况下（如经 hash 导航进入、视口尺寸在初始布局后才生效且不触发 resize）
    // 首帧可能用了旧尺寸，补一帧确保最终取景与真实横/竖屏一致。frameCurrent(false) 幂等、无动画。
    setTimeout(initFrame, 450);
  }

  return root;
}

/* 首页入口卡片 */
export function renderUniverseEntry(ctx) {
  const entryOff = offlineImg('entry');
  return el('section', { class: 'card universe-entry' }, [
    el('h2', { class: 'card__title', text: '道家宇宙' }),
    el('p', { class: 'card__text', text: '从一个念头，走进八十一章。在交互图谱中探索主题、概念与八十一章的关系，点击即可阅读原文。' }),
    entryOff
      ? el('img', { class: 'universe-entry__pic', src: entryOff, alt: '', loading: 'lazy' })
      : el('picture', { class: 'universe-entry__pic', 'aria-hidden': 'true' }, [
          el('source', { type: 'image/avif', srcset: './assets/universe/universe-entry-1280.avif' }),
          el('img', { src: './assets/universe/universe-entry.png', alt: '', loading: 'lazy' }),
        ]),
    el('div', { class: 'row' }, [
      el('a', { class: 'btn btn--primary', href: '#/universe', text: '进入宇宙' }),
    ]),
  ]);
}
