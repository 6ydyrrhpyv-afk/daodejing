// 道家宇宙：交互知识图谱（SVG + 分层视觉）
// 约束：零外部依赖，与现有 SPA 共用数据与路由。

import { el, frag, svg, icon, clear } from './util.mjs';
import { getChapter } from './data.mjs';

const WORLD_SIZE = 1800;
const CENTER = { x: 0, y: 0 };
const THEME_RADIUS = 360;
const CONCEPT_RADIUS = 120;
const CHAPTER_RADIUS = 190;

const NODE_RADIUS = {
  dao: 42,
  theme: 34,
  concept: 18,
  chapter: 9,
};

const FONTS = {
  dao: 'var(--font-serif)',
  theme: 'var(--font-serif)',
  concept: 'var(--font-ui)',
  chapter: 'var(--font-ui)',
};

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function offlineImg(key) {
  try {
    const m = window.__UNIVERSE__;
    if (m && typeof m[key] === 'string' && m[key]) return m[key];
  } catch (_) { /* ignore */ }
  return null;
}

// 伪随机：保证布局稳定
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function angle(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

// 构建节点与边
function buildGraph(universe) {
  const nodes = [];
  const nodeById = new Map();

  const daoNode = {
    id: 'dao',
    kind: 'dao',
    label: '道',
    x: 0,
    y: 0,
    r: NODE_RADIUS.dao,
    data: { name: '道', explanation: '万物本源，不可名状而能生万有。' },
  };
  nodes.push(daoNode);
  nodeById.set('dao', daoNode);

  // 主题节点：均匀环绕，但有轻微角度偏移避免对齐
  const rng = makeRng(20260928);
  universe.themes.forEach((theme, i) => {
    const t = (i + rng() * 0.12 - 0.06) / universe.themes.length;
    const a = t * Math.PI * 2 - Math.PI / 2;
    const node = {
      id: theme.id,
      kind: 'theme',
      label: theme.name,
      x: Math.cos(a) * THEME_RADIUS,
      y: Math.sin(a) * THEME_RADIUS,
      r: NODE_RADIUS.theme,
      data: theme,
      angle: a,
    };
    nodes.push(node);
    nodeById.set(theme.id, node);
  });

  // 概念节点：按主题分组放置
  universe.concepts.forEach((concept, ci) => {
    const primaryTheme = concept.themes[0];
    const themeNode = nodeById.get(primaryTheme);
    const baseAngle = themeNode.angle;
    const conceptRng = makeRng(ci + 1001);
    const spread = 1.2; // 弧度展开
    const offset = (conceptRng() - 0.5) * spread;
    const a = baseAngle + offset;
    const rr = CONCEPT_RADIUS + conceptRng() * 60;
    const node = {
      id: concept.id,
      kind: 'concept',
      label: concept.name,
      x: themeNode.x + Math.cos(a) * rr,
      y: themeNode.y + Math.sin(a) * rr,
      r: NODE_RADIUS.concept,
      data: concept,
      themeId: primaryTheme,
    };
    nodes.push(node);
    nodeById.set(concept.id, node);
  });

  // 章节节点：按首个关系分配到主题附近
  const chapterMap = new Map();
  universe.relationships.forEach((rel) => {
    if (rel.targetType !== 'chapter') return;
    const list = chapterMap.get(rel.targetId) || [];
    list.push(rel);
    chapterMap.set(rel.targetId, list);
  });

  universe.chapters.forEach((chapter, ci) => {
    const rels = chapterMap.get(chapter.id) || [];
    let anchor = nodeById.get('dao');
    if (rels.length) {
      const firstConcept = rels.find((r) => r.sourceType === 'concept');
      if (firstConcept) anchor = nodeById.get(firstConcept.sourceId) || anchor;
      else {
        const firstTheme = rels.find((r) => r.sourceType === 'theme');
        if (firstTheme) anchor = nodeById.get(firstTheme.sourceId) || anchor;
      }
    }
    const chapterRng = makeRng(ci + 3001);
    const a = chapterRng() * Math.PI * 2;
    const rr = CHAPTER_RADIUS + chapterRng() * 80;
    const node = {
      id: chapter.id,
      kind: 'chapter',
      label: String(chapter.number),
      x: anchor.x + Math.cos(a) * rr,
      y: anchor.y + Math.sin(a) * rr,
      r: NODE_RADIUS.chapter,
      data: chapter,
      number: chapter.number,
      rels,
    };
    nodes.push(node);
    nodeById.set(chapter.id, node);
  });

  // 边：去重
  const edgeSet = new Set();
  const edges = [];
  function addEdge(a, b, type) {
    const key = a < b ? `${a}|${b}|${type}` : `${b}|${a}|${type}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push({ source: a, target: b, type });
  }
  universe.relationships.forEach((rel) => {
    if (rel.sourceType === 'theme' && rel.targetType === 'concept') {
      addEdge(rel.sourceId, rel.targetId, 'theme-concept');
    } else if (rel.sourceType === 'concept' && rel.targetType === 'chapter') {
      addEdge(rel.sourceId, rel.targetId, 'concept-chapter');
    }
  });
  // 中央道连接到每个主题
  universe.themes.forEach((theme) => addEdge('dao', theme.id, 'dao-theme'));

  // 简单力导向：轻推节点避免重叠，保持大结构
  for (let iter = 0; iter < 60; iter += 1) {
    const forces = nodes.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        const d = dist(a, b);
        const minD = a.r + b.r + 14;
        if (d < minD && d > 0) {
          const f = (minD - d) / d * 0.25;
          const dx = (b.x - a.x) * f;
          const dy = (b.y - a.y) * f;
          forces[i].x -= dx;
          forces[i].y -= dy;
          forces[j].x += dx;
          forces[j].y += dy;
        }
      }
    }
    // 向中心轻微拉回，防止散开
    nodes.forEach((n, i) => {
      if (n.kind === 'dao') return;
      const d = dist(n, CENTER);
      const target = n.kind === 'theme' ? THEME_RADIUS : n.kind === 'concept' ? CONCEPT_RADIUS * 2.8 : CHAPTER_RADIUS * 2.8;
      const k = 0.002;
      forces[i].x -= (n.x / d) * (d - target) * k;
      forces[i].y -= (n.y / d) * (d - target) * k;
    });
    nodes.forEach((n, i) => {
      if (n.kind === 'dao') return;
      n.x += forces[i].x;
      n.y += forces[i].y;
    });
  }

  // 限制在世界范围内
  const bound = WORLD_SIZE / 2 - 80;
  nodes.forEach((n) => {
    n.x = clamp(n.x, -bound, bound);
    n.y = clamp(n.y, -bound, bound);
  });

  return { nodes, edges, nodeById };
}

// 视图状态
function makeViewState() {
  const saved = sessionStorage.getItem('ddj-universe-state');
  if (saved) {
    try {
      const st = JSON.parse(saved);
      return { saved: true, x: st.x || 0, y: st.y || 0, zoom: st.zoom || 1, selected: st.selected || null, search: st.search || '' };
    } catch (e) { /* ignore */ }
  }
  return { saved: false, x: 0, y: 0, zoom: 1, selected: null, search: '' };
}

function saveViewState(state) {
  sessionStorage.setItem('ddj-universe-state', JSON.stringify({
    x: state.x,
    y: state.y,
    zoom: state.zoom,
    selected: state.selected,
    search: state.search,
  }));
}

// 入口页面
export function renderUniverse(ctx) {
  const { data, navigate } = ctx;
  const universe = data.universe;
  const { nodes, edges, nodeById } = buildGraph(universe);

  const root = el('div', { class: 'universe' });
  const state = makeViewState();
  let selectedId = state.selected;
  let view = { x: state.x, y: state.y, zoom: state.zoom };
  const needsFit = !state.saved;
  let dragging = null;
  let pinch = null;
  let searchQuery = state.search || '';
  let listMode = false;

  // 音频：仅当真实音源存在时才初始化（此处未提供音频文件，故不显示控制入口）
  const audio = (() => {
    try {
      const a = new Audio('./assets/universe/music.mp3');
      a.loop = true;
      a.volume = 0.18;
      return a;
    } catch (e) { return null; }
  })();

  // 背景层
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

  // 雾/遮罩层保证中部清晰
  const fogLayer = el('div', { class: 'universe__fog', 'aria-hidden': 'true' });

  // 工具栏
  const toolbar = el('div', { class: 'universe__toolbar', role: 'toolbar', 'aria-label': '图谱控制' }, [
    el('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'aria-label': '复位全景', title: '复位全景', onclick: () => { fitToView(); worldGroup.style.transition = 'transform .4s ease'; updateTransform(); } }, [icon('mountain', 16), el('span', { text: '复位' })]),
    el('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'aria-label': '放大', title: '放大', onclick: () => { zoomBy(1.2); } }, [el('span', { text: '+' })]),
    el('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'aria-label': '缩小', title: '缩小', onclick: () => { zoomBy(0.8); } }, [el('span', { text: '−' })]),
    el('button', { type: 'button', class: `btn btn--ghost btn--sm${listMode ? ' active' : ''}`, 'aria-label': '列表视图', title: '列表视图', onclick: () => toggleList() }, [icon('scroll', 16), el('span', { text: '列表' })]),
  ]);

  const searchInput = el('input', {
    type: 'search',
    class: 'universe__search',
    placeholder: '搜索章号、概念或原文…',
    value: searchQuery,
    'aria-label': '搜索',
    oninput: (e) => onSearch(e.target.value),
    onkeydown: (e) => { if (e.key === 'Enter') onSearchSubmit(); },
  });

  const searchResults = el('ul', { class: 'universe__search-results', 'aria-live': 'polite' });

  const header = el('header', { class: 'universe__header' }, [
    el('div', { class: 'universe__brand' }, [
      el('a', { class: 'universe__back', href: '#/', 'aria-label': '返回首页' }, [icon('water', 16), el('span', { text: '返回' })]),
      el('h1', { class: 'universe__title', text: '道家宇宙' }),
    ]),
    el('p', { class: 'universe__subtitle', text: '从一个念头，走进八十一章' }),
    el('div', { class: 'universe__search-wrap' }, [searchInput, searchResults]),
    toolbar,
  ]);

  // SVG 容器
  const svgRoot = svg('svg', {
    class: 'universe__svg',
    viewBox: `${-WORLD_SIZE / 2} ${-WORLD_SIZE / 2} ${WORLD_SIZE} ${WORLD_SIZE}`,
    preserveAspectRatio: 'xMidYMid meet',
    'aria-label': '道家宇宙知识图谱',
    role: 'img',
  });

  const worldGroup = svg('g', { class: 'universe__world' });

  // 边层
  const edgesGroup = svg('g', { class: 'universe__edges' });
  edges.forEach((edge) => {
    const a = nodeById.get(edge.source);
    const b = nodeById.get(edge.target);
    if (!a || !b) return;
    const line = svg('line', {
      x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      class: `universe__edge universe__edge--${edge.type}`,
      'data-source': edge.source,
      'data-target': edge.target,
    });
    edgesGroup.append(line);
  });
  worldGroup.append(edgesGroup);

  // 节点层
  const nodesGroup = svg('g', { class: 'universe__nodes' });
  const labelGroup = svg('g', { class: 'universe__labels' });

  function renderNode(node) {
    const g = svg('g', {
      class: `universe__node universe__node--${node.kind}`,
      transform: `translate(${node.x}, ${node.y})`,
      'data-id': node.id,
      'data-kind': node.kind,
      tabindex: '0',
      role: node.kind === 'chapter' ? 'link' : 'button',
      'aria-label': ariaLabelFor(node),
    });

    const circle = svg('circle', {
      r: node.r,
      class: 'universe__node-circle',
    });
    g.append(circle);

    if (node.kind === 'dao') {
      // 中央水滴：img 叠加
      const drop = svg('image', {
        href: offlineImg('core') || './assets/universe/universe-core-512.webp',
        x: -60, y: -70, width: 120, height: 120,
        class: 'universe__drop',
        'aria-hidden': 'true',
      });
      g.append(drop);
      const label = svg('text', {
        x: 0, y: 78, class: 'universe__node-label universe__node-label--dao', 'text-anchor': 'middle',
      }, [document.createTextNode('道')]);
      labelGroup.append(label);
    } else if (node.kind === 'theme') {
      const label = svg('text', {
        x: 0, y: node.r + 18, class: 'universe__node-label universe__node-label--theme', 'text-anchor': 'middle',
      }, [document.createTextNode(node.label)]);
      labelGroup.append(label);
    } else if (node.kind === 'concept') {
      const label = svg('text', {
        x: 0, y: node.r + 14, class: 'universe__node-label universe__node-label--concept', 'text-anchor': 'middle',
      }, [document.createTextNode(node.label)]);
      labelGroup.append(label);
    } else if (node.kind === 'chapter') {
      const label = svg('text', {
        x: 0, y: node.r + 12, class: 'universe__node-label universe__node-label--chapter', 'text-anchor': 'middle',
      }, [document.createTextNode(node.label)]);
      labelGroup.append(label);
    }

    g.addEventListener('click', (e) => {
      e.stopPropagation();
      // 章节节点：直接打开正文本页（不强制中间面板）
      if (node.kind === 'chapter') {
        saveViewState({ ...view, selected: selectedId, search: searchQuery });
        location.hash = `#/chapters/${node.id}?from=universe`;
        return;
      }
      selectNode(node.id);
    });
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (node.kind === 'chapter') {
          saveViewState({ ...view, selected: selectedId, search: searchQuery });
          location.hash = `#/chapters/${node.id}?from=universe`;
          return;
        }
        selectNode(node.id);
      }
    });
    g.addEventListener('pointerenter', () => previewNode(node.id));
    g.addEventListener('pointerleave', () => clearPreview());

    nodesGroup.append(g);
  }

  function ariaLabelFor(node) {
    if (node.kind === 'dao') return '中央节点：道';
    if (node.kind === 'theme') return `主题：${node.data.name}`;
    if (node.kind === 'concept') return `概念：${node.data.name}`;
    return `第 ${node.data.number} 章：${node.data.titleHint}`;
  }

  nodes.forEach(renderNode);
  worldGroup.append(nodesGroup);
  worldGroup.append(labelGroup);
  svgRoot.append(worldGroup);

  // 画布交互层
  const canvasWrap = el('div', { class: 'universe__canvas' }, [bgLayer, fogLayer, svgRoot]);

  // 侧面板 / 底部面板
  const panel = el('aside', { class: 'universe__panel', 'aria-live': 'polite' });
  const overlay = el('div', { class: 'universe__panel-overlay', 'aria-hidden': 'true' });
  overlay.addEventListener('click', closePanel);

  function closePanel() {
    selectedId = null;
    panel.classList.remove('universe__panel--open');
    overlay.classList.remove('universe__panel-overlay--open');
    updateSelection();
    saveViewState({ ...view, selected: null, search: searchQuery });
  }

  function openPanel() {
    panel.classList.add('universe__panel--open');
    overlay.classList.add('universe__panel-overlay--open');
    const closeBtn = panel.querySelector('.universe__panel-close');
    if (closeBtn) closeBtn.focus();
  }

  // 列表视图
  const listView = el('div', { class: 'universe__list' });

  // 页面结构
  root.append(header, canvasWrap, overlay, panel, listView);

  // 提示
  const hint = el('div', { class: 'universe__hint' }, [
    el('p', { text: '拖动平移，滚轮/双指缩放，点击节点查看关系与原文。' }),
  ]);
  root.append(hint);

  // 选择节点
  function selectNode(id) {
    selectedId = id;
    saveViewState({ ...view, selected: id, search: searchQuery });
    updateSelection();
    renderPanel();
    openPanel();
    focusOnNode(id);
  }

  function previewNode(id) {
    if (selectedId) return;
    highlightConnected(id);
  }

  function clearPreview() {
    if (selectedId) return;
    highlightConnected(null);
  }

  function highlightConnected(id) {
    const active = new Set();
    if (id) {
      active.add(id);
      edges.forEach((e) => {
        if (e.source === id || e.target === id) {
          active.add(e.source);
          active.add(e.target);
        }
      });
    }
    nodes.forEach((node) => {
      const elNode = nodesGroup.querySelector(`[data-id="${node.id}"]`);
      if (!elNode) return;
      if (active.size === 0 || active.has(node.id)) {
        elNode.classList.remove('dim');
      } else {
        elNode.classList.add('dim');
      }
    });
    edgesGroup.querySelectorAll('line').forEach((line) => {
      const s = line.getAttribute('data-source');
      const t = line.getAttribute('data-target');
      if (active.size === 0 || ((s === id || t === id))) {
        line.classList.remove('dim');
      } else {
        line.classList.add('dim');
      }
    });
  }

  function updateSelection() {
    highlightConnected(selectedId);
    nodesGroup.querySelectorAll('.universe__node').forEach((n) => n.classList.remove('selected'));
    if (selectedId) {
      const sel = nodesGroup.querySelector(`[data-id="${selectedId}"]`);
      if (sel) sel.classList.add('selected');
    }
  }

  function focusOnNode(id) {
    const node = nodeById.get(id);
    if (!node) return;
    view.zoom = clamp(1.6, 0.4, 3);
    view.x = -view.zoom * node.x;
    view.y = -view.zoom * node.y;
    worldGroup.style.transition = 'transform .35s ease';
    updateTransform();
  }

  // 渲染面板
  function renderPanel() {
    clear(panel);
    if (!selectedId) return;
    const node = nodeById.get(selectedId);
    if (!node) return;

    const closeBtn = el('button', {
      type: 'button',
      class: 'universe__panel-close btn btn--ghost btn--sm',
      'aria-label': '关闭',
      onclick: closePanel,
    }, [el('span', { text: '×' })]);

    const body = el('div', { class: 'universe__panel-body' });

    if (node.kind === 'dao') {
      body.append(el('h2', { class: 'universe__panel-title', text: '道' }));
      body.append(el('p', { class: 'universe__panel-text', text: node.data.explanation }));
    } else if (node.kind === 'theme') {
      body.append(el('h2', { class: 'universe__panel-title', text: node.data.name }));
      body.append(el('p', { class: 'universe__panel-note', text: '本站编辑整理的阅读视角，不等同于经典原有分类。' }));
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
      body.append(el('ul', { class: 'universe__panel-list' }, [...chapterIds].slice(0, 24).map((cid) => {
        const ch = nodeById.get(cid);
        return el('li', {}, [
          el('a', { class: 'link', href: `#/chapters/${cid}?from=universe`, text: `第 ${ch?.number || '?'} 章 ${ch?.data?.titleHint || ''}` }),
        ]);
      })));
    } else if (node.kind === 'concept') {
      body.append(el('h2', { class: 'universe__panel-title', text: node.data.name }));
      body.append(el('p', { class: 'universe__panel-label', text: '解读' }));
      body.append(el('p', { class: 'universe__panel-text', text: node.data.explanation }));
      const rels = universe.relationships.filter((r) => r.sourceId === node.id && r.targetType === 'chapter');
      body.append(el('h3', { text: `原文证据（${rels.length}）` }));
      body.append(el('ul', { class: 'universe__panel-list' }, rels.map((r) => el('li', {}, [
        el('blockquote', { class: 'universe__panel-quote', text: r.quote }),
        el('p', { class: 'universe__panel-reason', text: r.reason }),
        el('a', { class: 'btn btn--sm btn--ghost', href: `#/chapters/${r.targetId}?from=universe&q=${encodeURIComponent(r.quote)}`, text: `第 ${r.chapterNumber} 章` }),
      ]))));
    } else if (node.kind === 'chapter') {
      const chapter = getChapter(data, node.id);
      body.append(el('h2', { class: 'universe__panel-title', text: `第 ${node.data.number} 章 ${node.data.titleHint}` }));
      body.append(el('a', { class: 'btn btn--primary', href: `#/chapters/${node.id}?from=universe`, text: '阅读本章正文' }));
      const rels = node.rels.slice(0, 8);
      body.append(el('h3', { text: '相关概念' }));
      body.append(el('ul', { class: 'universe__panel-list' }, rels.map((r) => {
        const concept = nodeById.get(r.sourceId);
        return el('li', {}, [
          el('button', { type: 'button', class: 'link', onclick: () => selectNode(r.sourceId) }, [concept?.data?.name || r.sourceId]),
          el('p', { class: 'universe__panel-quote', text: r.quote }),
        ]);
      })));
    }

    panel.append(closeBtn, body);
  }

  // 搜索
  function onSearch(query) {
    searchQuery = query.trim();
    saveViewState({ ...view, search: searchQuery });
    if (!searchQuery) {
      clear(searchResults);
      return;
    }
    const results = [];
    const q = searchQuery.toLowerCase();
    // 章号
    const num = parseInt(searchQuery, 10);
    if (!Number.isNaN(num) && num >= 1 && num <= 81) {
      const ch = nodes.find((n) => n.kind === 'chapter' && n.number === num);
      if (ch) results.push({ id: ch.id, label: `第 ${num} 章`, sub: ch.data.titleHint });
    }
    // 概念
    universe.concepts.forEach((c) => {
      if (c.name.includes(searchQuery) || c.explanation.includes(searchQuery)) {
        results.push({ id: c.id, label: c.name, sub: '概念' });
      }
    });
    // 原文
    universe.chapters.forEach((ch) => {
      const full = data.chapterById.get(ch.id);
      if (full && full.original_text.includes(searchQuery)) {
        results.push({ id: ch.id, label: `第 ${ch.number} 章`, sub: ch.titleHint });
      }
    });

    clear(searchResults);
    if (results.length) {
      searchResults.append(...results.slice(0, 8).map((r) => el('li', {}, [
        el('button', { type: 'button', class: 'link', onclick: () => { selectNode(r.id); clear(searchResults); } }, [r.label]),
        el('span', { class: 'muted', text: ` · ${r.sub}` }),
      ])));
    } else {
      searchResults.append(el('li', { class: 'muted', text: '无结果' }));
    }
  }

  function onSearchSubmit() {
    if (!searchQuery) return;
    const result = nodes.find((n) => {
      if (n.kind === 'concept' && n.data.name.includes(searchQuery)) return true;
      if (n.kind === 'chapter') {
        const num = parseInt(searchQuery, 10);
        return num === n.number || n.data.titleHint.includes(searchQuery);
      }
      return false;
    });
    if (result) selectNode(result.id);
  }

  // 列表视图
  function toggleList() {
    listMode = !listMode;
    if (listMode) {
      renderListView();
      listView.classList.add('universe__list--open');
      canvasWrap.classList.add('universe__canvas--hidden');
    } else {
      listView.classList.remove('universe__list--open');
      canvasWrap.classList.remove('universe__canvas--hidden');
    }
    toolbar.querySelector('button:nth-child(4)').classList.toggle('active', listMode);
  }

  function renderListView() {
    clear(listView);
    listView.append(el('button', { type: 'button', class: 'btn btn--ghost universe__list-close', onclick: toggleList }, [el('span', { text: '返回图谱' })]));
    listView.append(el('h2', { class: 'universe__list-title', text: '按主题浏览' }));
    universe.themes.forEach((theme) => {
      const concepts = universe.concepts.filter((c) => c.themes.includes(theme.id));
      const section = el('section', { class: 'card' }, [
        el('h3', { text: theme.name }),
        el('p', { class: 'card__text', text: theme.summary }),
        el('h4', { text: '概念' }),
        el('ul', { class: 'universe__panel-list' }, concepts.map((c) => el('li', {}, [
          el('a', { href: `#/universe?focus=${c.id}`, text: c.name }),
        ]))),
      ]);
      listView.append(section);
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

  // 变换：view.x / view.y 为 viewBox 用户坐标单位，view.zoom 为缩放倍率
  function updateTransform() {
    worldGroup.setAttribute('transform', `translate(${view.x}, ${view.y}) scale(${view.zoom})`);
    saveViewState({ ...view, selected: selectedId, search: searchQuery });
  }

  // 屏幕坐标（clientX/Y）→ viewBox 用户坐标
  function screenToUser(sx, sy) {
    const ctm = svgRoot.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = new DOMPoint(sx, sy).matrixTransform(ctm.inverse());
    return { x: pt.x, y: pt.y };
  }

  function currentSvgScale() {
    const ctm = svgRoot.getScreenCTM();
    return ctm ? ctm.a : 1;
  }

  // 计算使全部节点居中并适配视野的初始视图（不依赖像素尺寸）
  function fitToView(margin = 0.9) {
    if (!nodes.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach((n) => {
      const pad = (n.r || 10) + 40;
      minX = Math.min(minX, n.x - pad);
      minY = Math.min(minY, n.y - pad);
      maxX = Math.max(maxX, n.x + pad);
      maxY = Math.max(maxY, n.y + pad);
    });
    const bboxW = (maxX - minX) || 1;
    const bboxH = (maxY - minY) || 1;
    const k = Math.min((WORLD_SIZE * margin) / bboxW, (WORLD_SIZE * margin) / bboxH);
    view.zoom = clamp(k, 0.25, 4);
    // viewBox 居中坐标为 (0,0)，使包围盒中心映射到视野中心
    view.x = -view.zoom * (minX + bboxW / 2);
    view.y = -view.zoom * (minY + bboxH / 2);
  }

  function zoomBy(factor, sx, sy) {
    const minZoom = 0.25;
    const maxZoom = 4;
    const newZoom = clamp(view.zoom * factor, minZoom, maxZoom);
    if (newZoom === view.zoom) return;
    const r = newZoom / view.zoom;
    const u = screenToUser(sx, sy);
    view.x = r * view.x + (1 - r) * u.x;
    view.y = r * view.y + (1 - r) * u.y;
    view.zoom = newZoom;
    worldGroup.style.transition = 'transform .3s ease';
    updateTransform();
  }

  // 指针交互
  function getPointerPos(evt) {
    const rect = svgRoot.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }

  canvasWrap.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.universe__node')) return;
    dragging = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    canvasWrap.setPointerCapture(e.pointerId);
    worldGroup.style.transition = 'none';
    closePanel();
  });

  canvasWrap.addEventListener('pointermove', (e) => {
    if (dragging) {
      const s = currentSvgScale() || 1;
      view.x = dragging.vx + (e.clientX - dragging.x) / s;
      view.y = dragging.vy + (e.clientY - dragging.y) / s;
      updateTransform();
    }
  });

  canvasWrap.addEventListener('pointerup', () => { dragging = null; });
  canvasWrap.addEventListener('pointercancel', () => { dragging = null; });

  canvasWrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    zoomBy(factor, e.clientX, e.clientY);
  }, { passive: false });

  // 触控双指缩放
  canvasWrap.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      const [t1, t2] = [e.touches[0], e.touches[1]];
      pinch = {
        d: Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY),
        cx: (t1.clientX + t2.clientX) / 2,
        cy: (t1.clientY + t2.clientY) / 2,
      };
    }
  }, { passive: true });

  canvasWrap.addEventListener('touchmove', (e) => {
    if (pinch && e.touches.length === 2) {
      e.preventDefault();
      const [t1, t2] = [e.touches[0], e.touches[1]];
      const d = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      const cx = (t1.clientX + t2.clientX) / 2;
      const cy = (t1.clientY + t2.clientY) / 2;
      if (pinch.d > 0) zoomBy(d / pinch.d, cx, cy);
      pinch.d = d;
    }
  }, { passive: false });

  canvasWrap.addEventListener('touchend', () => { pinch = null; });
  canvasWrap.addEventListener('touchcancel', () => { pinch = null; });

  // 入场动画（仅淡入，不改变位置，避免与交互变换冲突）
  if (!REDUCED) {
    worldGroup.style.opacity = '0';
    bgLayer.style.opacity = '0';
    requestAnimationFrame(() => {
      bgLayer.style.transition = 'opacity 1.2s ease';
      worldGroup.style.transition = 'opacity 1.4s ease';
      bgLayer.style.opacity = '1';
      worldGroup.style.opacity = '1';
    });
  }

  // 首次进入：适配并居中全局视图；带已保存视图则直接恢复
  if (needsFit) fitToView();

  // 恢复上次视图与选择
  updateTransform();
  updateSelection();
  if (selectedId) {
    renderPanel();
    openPanel();
    focusOnNode(selectedId);
  }

  // URL focus 参数
  const focusParam = new URLSearchParams(location.hash.split('?')[1] || '').get('focus');
  if (focusParam && nodeById.has(focusParam)) {
    selectNode(focusParam);
  }

  // 音频控制：仅当成功加载音源后才显示按钮；未提供音频时保持静默。
  if (audio) {
    let musicReady = false;
    const musicBtn = el('button', {
      type: 'button',
      class: 'btn btn--ghost btn--sm universe__music-btn',
      'aria-label': '背景音乐',
      hidden: true,
      onclick: () => {
        if (!musicReady) return;
        if (audio.paused) { audio.play().catch(() => {}); } else { audio.pause(); }
      },
    }, [icon('water', 16), el('span', { text: '音乐' })]);
    audio.addEventListener('canplaythrough', () => { musicReady = true; musicBtn.hidden = false; });
    audio.addEventListener('error', () => { musicBtn.remove(); });
    toolbar.append(musicBtn);
    document.addEventListener('visibilitychange', () => { if (document.hidden && audio && !audio.paused) audio.pause(); });
  }

  return root;
}

// 首页入口卡片
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
