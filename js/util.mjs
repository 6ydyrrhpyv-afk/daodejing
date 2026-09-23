// 通用 DOM / 提示 / 弹窗工具。所有文本一律走 textContent，禁用 innerHTML。

const SVG_NS = 'http://www.w3.org/2000/svg';

// 创建 SVG 节点：attrs 走 setAttribute，children 为子元素或 [tag, attrs] 数组。
export function svg(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (!child) continue;
    if (Array.isArray(child)) node.append(svg(child[0], child[1] || {}, child[2] || []));
    else node.append(child);
  }
  return node;
}

// 小尺寸国风线性图标（毛笔 / 卷轴 / 印章勾选 / 山 / 水），装饰用途，aria-hidden。
export function icon(name, size = 18) {
  const common = { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': 'true', focusable: 'false' };
  switch (name) {
    case 'brush':
      return svg('svg', common, [
        svg('path', { d: 'M20.5 3.5c-3 .5-8.2 4.6-10.6 7.9l2.7 2.7c3.3-2.4 7.4-7.6 7.9-10.6z', fill: 'currentColor', opacity: .9 }),
        svg('path', { d: 'M9 12.5c-1.8.4-3.2 1.8-3.6 3.6-.3 1.3-1 2.3-2.4 2.9 1.6 1.2 4.4 1.4 5.9-.1 1.2-1.2 1.5-2.9 1-4.3z', fill: 'currentColor' }),
      ]);
    case 'scroll':
      return svg('svg', common, [
        svg('path', { d: 'M6 4h11a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6z', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6 }),
        svg('path', { d: 'M6 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6 }),
        svg('path', { d: 'M9.5 8.5h6M9.5 12h6M9.5 15.5h3.5', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round' }),
      ]);
    case 'check':
      return svg('svg', common, [
        svg('path', { d: 'M5 12.5l4.2 4L19 7', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
      ]);
    case 'mountain':
      return svg('svg', common, [
        svg('path', { d: 'M3 18l5.5-9 3.5 5.5L15 9l6 9z', fill: 'currentColor', opacity: .85 }),
      ]);
    case 'water':
      return svg('svg', common, [
        svg('path', { d: 'M12 3.5s5.5 6.2 5.5 10a5.5 5.5 0 0 1-11 0c0-3.8 5.5-10 5.5-10z', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7 }),
        svg('path', { d: 'M9.2 14.5c.6 1.6 2 2.6 3.8 2.6', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round' }),
      ]);
    default:
      return svg('svg', common, []);
  }
}

// 落墨反馈：点击主按钮时在指针处晕开一个小墨点（尊重减少动态设置，由 CSS 控制时长）。
export function initInkRipple() {
  document.addEventListener('pointerdown', (event) => {
    const target = event.target.closest('.btn, .chip, .stepper__item');
    if (!target || target.disabled) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect = target.getBoundingClientRect();
    const dot = document.createElement('span');
    dot.className = 'ink-dot';
    dot.style.left = `${event.clientX - rect.left}px`;
    dot.style.top = `${event.clientY - rect.top}px`;
    target.append(dot);
    dot.addEventListener('animationend', () => dot.remove());
    setTimeout(() => dot.remove(), 800);
  });
}


export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'html') throw new Error('不支持 html 属性：请改用 text（禁止直接写入 HTML）');
    if (key === 'text') { node.textContent = value; continue; }
    if (key === 'class') { node.className = value; continue; }
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
      continue;
    }
    node.setAttribute(key, value === true ? '' : String(value));
  }
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }
  return node;
}

export function frag(children = []) {
  const f = document.createDocumentFragment();
  for (const c of children) if (c) f.append(c);
  return f;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

let toastTimer = null;
export function toast(message, kind = 'info') {
  const host = document.getElementById('toast');
  if (!host) return;
  clear(host);
  const box = el('div', { class: `toast toast--${kind}`, role: kind === 'error' ? 'alert' : 'status' }, [message]);
  host.append(box);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => clear(host), kind === 'error' ? 6000 : 3500);
}

// 返回一个 Promise<boolean> 的确认弹窗，键盘可操作（Esc 取消，回车确认）。
export function confirmDialog({ title, body = [], confirmText = '确认', cancelText = '取消', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      lastFocus?.focus?.();
      resolve(value);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
      if (event.key === 'Tab') {
        const focusables = overlay.querySelectorAll('button');
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    const lastFocus = document.activeElement;
    const bodyNodes = body.map((line) => (typeof line === 'string' ? el('p', { class: 'modal__text', text: line }) : line));
    const okBtn = el('button', {
      class: danger ? 'btn btn--danger' : 'btn btn--primary',
      type: 'button',
      onclick: () => finish(true),
    }, [confirmText]);
    const cancelBtn = el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => finish(false) }, [cancelText]);
    const dialog = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
      el('h2', { class: 'modal__title', text: title }),
      ...bodyNodes,
      el('div', { class: 'modal__actions' }, [cancelBtn, okBtn]),
    ]);
    const overlay = el('div', { class: 'modal-overlay', onmousedown: (e) => { if (e.target === overlay) finish(false); } }, [dialog]);
    document.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    cancelBtn.focus();
  });
}

// 按标点切句，用于章节原文的逐句展示与引用定位。
export function splitLines(text) {
  return text
    .split(/(?<=[。；；？！：])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function uid(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function debounce(fn, wait = 300) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
