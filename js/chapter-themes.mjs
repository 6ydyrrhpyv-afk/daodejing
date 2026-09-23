// 章节主题系统：加载 chapter-design.json，按章节写入 CSS 变量，提供主题查询。

let designCache = null;

export async function loadDesign() {
  if (designCache) return designCache;
  const res = await fetch(new URL('../data/chapter-design.json', import.meta.url));
  if (!res.ok) throw new Error('章节设计配置加载失败：HTTP ' + res.status);
  designCache = await res.json();
  return designCache;
}

export function getTheme(design, themeId) {
  return design?.themes?.[themeId] || design?.themes?.xuanzhi || null;
}

export function getChapterDesign(design, chapterId) {
  return design?.chapters?.find((c) => c.chapterId === chapterId) || null;
}

export function applyTheme(theme) {
  const root = document.documentElement;
  if (!theme) {
    resetTheme();
    return;
  }
  const vars = [
    ['--chapter-page-bg', theme.pageBg],
    ['--chapter-surface-bg', theme.surfaceBg],
    ['--chapter-text', theme.text],
    ['--chapter-muted', theme.muted],
    ['--chapter-accent', theme.accent],
    ['--chapter-link', theme.link],
    ['--chapter-border', theme.border],
    ['--chapter-chip-bg', theme.chipBg],
    ['--chapter-chip-active-bg', theme.chipActiveBg],
    ['--chapter-chip-active-text', theme.chipActiveText],
    ['--chapter-btn-hover-bg', theme.btnHoverBg],
    ['--chapter-focus', theme.focus],
    ['--chapter-selection', theme.selection],
    ['--chapter-error', theme.error],
    ['--chapter-shadow', theme.shadow],
    ['--chapter-is-dark', theme.isDark ? '1' : '0'],
  ];
  for (const [k, v] of vars) root.style.setProperty(k, v);
  document.body.classList.toggle('chapter-dark', !!theme.isDark);
}

export function resetTheme() {
  const root = document.documentElement;
  const vars = [
    '--chapter-page-bg',
    '--chapter-surface-bg',
    '--chapter-text',
    '--chapter-muted',
    '--chapter-accent',
    '--chapter-link',
    '--chapter-border',
    '--chapter-chip-bg',
    '--chapter-chip-active-bg',
    '--chapter-chip-active-text',
    '--chapter-btn-hover-bg',
    '--chapter-focus',
    '--chapter-selection',
    '--chapter-error',
    '--chapter-shadow',
    '--chapter-is-dark',
  ];
  for (const k of vars) root.style.removeProperty(k);
  document.body.classList.remove('chapter-dark');
}
