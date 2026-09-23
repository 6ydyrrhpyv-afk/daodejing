// 引用校验：供浏览器（定位原句）与服务端（校验模型返回的引用）共用。

export function normalizeForMatch(text) {
  return String(text || '')
    .replace(/\s+/g, '')
    .replace(/[，。；：？！、《》「」『』（）()·．,.;:!?<>]/g, '');
}

export function splitLines(text) {
  return String(text || '')
    .split(/(?<=[。；？！：])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// 在章节原文中定位一个引用句。返回 { found, lineIndex, line }
export function findQuote(chapter, quote) {
  if (!chapter || !quote) return { found: false, lineIndex: -1, line: '' };
  const lines = splitLines(chapter.original_text || '');
  const target = normalizeForMatch(quote);
  if (!target) return { found: false, lineIndex: -1, line: '' };
  for (let i = 0; i < lines.length; i += 1) {
    if (normalizeForMatch(lines[i]).includes(target)) {
      return { found: true, lineIndex: i, line: lines[i] };
    }
  }
  const whole = normalizeForMatch(chapter.original_text);
  if (whole.includes(target)) return { found: true, lineIndex: -1, line: quote };
  return { found: false, lineIndex: -1, line: '' };
}

// 校验一组引用：章号必须存在，原句必须能在该章原文中找到。
export function verifyReferences(chapters, references) {
  const byId = new Map(chapters.map((c) => [c.chapter_id, c]));
  const verified = [];
  const failures = [];
  for (const ref of references || []) {
    if (!ref || typeof ref !== 'object') {
      failures.push({ reason: '引用格式不正确', ref: null });
      continue;
    }
    const chapter = byId.get(ref.chapter_id);
    if (!chapter) {
      failures.push({ reason: `章号 ${String(ref.chapter_id)} 不在本站已收录的 ${chapters.length} 章内`, ref });
      continue;
    }
    const hit = findQuote(chapter, ref.quote);
    if (!hit.found) {
      failures.push({ reason: `第 ${chapter.chapter_number} 章中找不到该原句`, ref });
      continue;
    }
    verified.push({
      chapter_id: chapter.chapter_id,
      chapter_number: chapter.chapter_number,
      quote: hit.lineIndex >= 0 ? hit.line : ref.quote,
      relevance: typeof ref.relevance === 'string' ? ref.relevance : '',
    });
  }
  return { ok: failures.length === 0, verified, failures };
}
