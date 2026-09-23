// 应用入口：路由、模式标识、持久化状态提示

import { el, clear, toast, initInkRipple } from './util.mjs';
import { Store } from './store.mjs';
import { loadData } from './data.mjs';
import { mountainStrip } from './art.mjs';
import { renderHome } from './home.mjs';
import { renderChapters } from './chapters.mjs';
import { resetTheme } from './chapter-themes.mjs';
import { initSync } from './sync.mjs';
import { renderPractice } from './practice.mjs';
import { renderActions } from './actions.mjs';
import { renderSettings } from './settings.mjs';
import { confirmDialog } from './util.mjs';

const main = document.getElementById('main');
const modeBadge = document.getElementById('mode-badge');
const storageBar = document.getElementById('storage-bar');

const store = new Store();
const ui = { actionFilter: 'all' };
let data = null;

const ctx = {
  store,
  ui,
  get data() { return data; },
  navigate(hash) { location.hash = hash; },
  rerender() { render(); },
  toast,
  confirmDialog,
};

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  const segments = path.split('/').filter(Boolean);
  const params = {};
  for (const [key, value] of new URLSearchParams(query)) params[key] = value;
  return { name: segments[0] || '', id: segments[1] || '', params };
}

function setActiveNav(name) {
  const map = { '': 'nav-home', chapters: 'nav-chapters', practice: 'nav-practice', actions: 'nav-actions', settings: 'nav-settings' };
  document.querySelectorAll('[data-nav]').forEach((node) => {
    const active = node.id === map[name];
    if (active) node.setAttribute('aria-current', 'page');
    else node.removeAttribute('aria-current');
  });
}

function updateModeBadge() {
  const mode = store.state.mode;
  modeBadge.textContent = mode === 'ai' ? 'AI 辅助' : '引导练习';
  modeBadge.className = `mode-badge mode-badge--${mode}`;
}

function updateStorageBar() {
  clear(storageBar);
  if (!store.persistent) {
    storageBar.append(el('p', { class: 'banner banner--warn', role: 'status', text: store.persistenceReason }));
  } else if (store.lastError) {
    storageBar.append(el('p', { class: 'banner banner--error', role: 'alert', text: store.lastError }));
  }
}

let lastRouteName = '';
let switchTimer = null;

function render() {
  if (!data) return;
  const route = parseHash();
  const isChapterSwitch = route.name === 'chapters' && lastRouteName === 'chapters';
  lastRouteName = route.name;
  clear(main);
  // 离开章节页时复位主题色（章节详情页会再写入对应章的色彩）
  resetTheme();
  // 快速连续切章：取消过期背景过渡，避免叠色/闪白
  document.body.classList.add('is-switching');
  clearTimeout(switchTimer);
  switchTimer = setTimeout(() => document.body.classList.remove('is-switching'), 60);
  setActiveNav(route.name);
  updateModeBadge();
  updateStorageBar();
  let view;
  try {
    if (route.name === 'chapters') view = renderChapters(ctx, { id: route.id, from: route.params.from, q: route.params.q });
    else if (route.name === 'practice') view = renderPractice(ctx);
    else if (route.name === 'actions') view = renderActions(ctx);
    else if (route.name === 'settings') view = renderSettings(ctx);
    else view = renderHome(ctx);
  } catch (error) {
    view = el('section', { class: 'card' }, [
      el('h2', { class: 'card__title', text: '页面渲染出错' }),
      el('p', { class: 'card__text', text: String(error && error.message ? error.message : error) }),
    ]);
  }
  main.replaceChildren(el('div', { class: 'page-enter' }, [view]));
  // 章节间切换保留滚动位置，跨功能切换回到顶部
  if (!isChapterSwitch) window.scrollTo({ top: 0 });
}

async function boot() {
  const loaded = store.load();
  try {
    data = await loadData();
  } catch (error) {
    main.append(el('section', { class: 'card' }, [
      el('h2', { class: 'card__title', text: '内容加载失败' }),
      el('p', { class: 'card__text', text: String(error && error.message ? error.message : error) }),
      el('p', { class: 'card__text', text: '请确认服务端已启动，并通过 http://localhost:PORT 访问（直接双击打开 index.html 会无法读取数据文件）。' }),
    ]));
    return;
  }
  if (!loaded.ok) toast(loaded.error, 'error');
  // 跨设备同步：先 pull 合并远端数据，再订阅本地改动做防抖推送（失败不阻断启动）
  try {
    await initSync(store);
  } catch (error) {
    console.warn('[同步] 启动同步失败（不影响本地使用）：', error);
  }
  const footerArt = document.getElementById('footer-art');
  if (footerArt) footerArt.append(mountainStrip());
  initInkRipple();
  render();
  window.addEventListener('hashchange', render);
}

boot();
