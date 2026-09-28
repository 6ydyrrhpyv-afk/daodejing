// 章节与引导材料的数据加载与查询。

let cache = null;

export async function loadData() {
  if (cache) return cache;
  const [chaptersRes, guidanceRes, designRes, universeRes] = await Promise.all([
    fetch(new URL('../data/chapters.json', import.meta.url)),
    fetch(new URL('../data/guidance.json', import.meta.url)),
    fetch(new URL('../data/chapter-design.json', import.meta.url)),
    fetch(new URL('../data/universe.json', import.meta.url)),
  ]);
  if (!chaptersRes.ok) throw new Error('章节数据加载失败：HTTP ' + chaptersRes.status);
  if (!guidanceRes.ok) throw new Error('引导材料加载失败：HTTP ' + guidanceRes.status);
  if (!designRes.ok) throw new Error('视觉配置加载失败：HTTP ' + designRes.status);
  const universeJson = await universeRes.json();
  const chaptersJson = await chaptersRes.json();
  const guidanceJson = await guidanceRes.json();
  const designJson = await designRes.json();
  cache = {
    meta: chaptersJson.meta,
    chapters: chaptersJson.chapters,
    guidance: guidanceJson,
    design: designJson,
    universe: universeJson,
    chapterById: new Map(chaptersJson.chapters.map((c) => [c.chapter_id, c])),
    themeById: new Map(guidanceJson.themes.map((t) => [t.id, t])),
    designById: new Map(designJson.chapters.map((c) => [c.chapterId, c])),
    universeById: new Map([
      ...universeJson.themes.map((t) => [t.id, { ...t, kind: 'theme' }]),
      ...universeJson.concepts.map((c) => [c.id, { ...c, kind: 'concept' }]),
      ...universeJson.chapters.map((c) => [c.id, { ...c, kind: 'chapter' }]),
      ['dao', { id: 'dao', name: '道', kind: 'dao', explanation: '万物本源。' }],
    ]),
  };
  return cache;
}

export function getChapter(data, id) {
  return data.chapterById.get(id) || null;
}

export function getTheme(data, id) {
  return data.themeById.get(id) || null;
}

export function getBranch(data, branchId) {
  if (!branchId) return null;
  if (branchId === 'custom') return data.guidance.custom_branch;
  if (branchId === 'not_applicable') return data.guidance.not_applicable_branch;
  return data.guidance.branches[branchId] || null;
}

export function chaptersForTheme(data, themeId) {
  return data.chapters.filter((c) => c.themes.includes(themeId));
}

export const THEME_LABEL = {
  management: '管理',
  collaboration: '协作',
  growth: '成长',
};

export function themeLabel(id) {
  return THEME_LABEL[id] || id || '未分类';
}
