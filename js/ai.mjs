// Unified server-backed AI client. Provider credentials never enter the browser.
import { practiceUrl, practiceToken } from './practice-client.mjs';

export function buildSystemPrompt(chapter) {
  const base = [
    '你是《道德经》的阅读与处事辅助助手，服务于一个叫「道德经·处事练习室」的站点。请遵循：',
    '1. 紧扣用户选定的章节原文与本站释义作答，引用尽量用原文原句，不要杜撰章句或张冠李戴。',
    '2. 帮助用户把经典智慧落到现实的工作、协作、成长情境中，给出具体、可操作的理解，而非空泛口号。',
    '3. 不扮演老子、不给人生/投资/医疗等具体决策下绝对结论；把判断权留给读者。',
    '4. 用简体中文、平实清晰的语言。若问到原文没有的内容，坦诚说明边界。',
  ];
  if (chapter) {
    const parts = ['', '【当前章节上下文（优先依据此内容作答）】'];
    parts.push(`章号：第 ${chapter.chapter_number} 章`);
    if (chapter.title_hint) parts.push(`章名：${chapter.title_hint}`);
    if (chapter.original_text) parts.push(`原文：${chapter.original_text}`);
    if (chapter.plain_explanation) parts.push(`本站释义：${chapter.plain_explanation}`);
    if (chapter.application_boundary) parts.push(`应用边界：${chapter.application_boundary}`);
    return base.concat(parts).join('\n');
  }
  base.push('5. 若未提供章节上下文，可基于《道德经》通行理解泛泛而谈，并提示以原文为准。');
  return base.join('\n');
}

// 流式对话。返回 { abort } 供调用方中断。
// onDelta(text)、onDone({aborted?})、onError(Error)。
export function streamChat({ messages, onDelta, onDone, onError, signal }) {
  const controller = new AbortController();
  const activeSignal = signal || controller.signal;
  (async () => {
    try {
      const token = await practiceToken();
      let res = await fetch(await practiceUrl('/api/chat'), {
        method: 'POST', signal: activeSignal,
        headers: { 'Content-Type': 'application/json', 'x-practice-token': token },
        body: JSON.stringify({ messages }),
      });
      if (res.status === 401 && !activeSignal.aborted) {
        const freshToken = await practiceToken(true);
        res = await fetch(await practiceUrl('/api/chat'), {
          method: 'POST', signal: activeSignal,
          headers: { 'Content-Type': 'application/json', 'x-practice-token': freshToken },
          body: JSON.stringify({ messages }),
        });
      }
      const data = await res.json();
      if (!res.ok || typeof data.content !== 'string') throw new Error(data.error?.message || 'AI 服务暂不可用');
      if (activeSignal.aborted) { onDone?.({ aborted: true }); return; }
      onDelta?.(data.content); onDone?.({ aborted: false });
    } catch (error) { if (activeSignal.aborted) onDone?.({ aborted: true }); else onError?.(error); }
  })();
  return { abort: () => controller.abort() };
}
