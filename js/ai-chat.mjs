// 问道 · AI 解读：章节感知的 AI 问答页（路由 #/ai 与 #/ai/<chapterId>）。
// 与分步练习共用服务端 AI，无用户密钥配置界面。

import { el, frag, toast, clear } from './util.mjs';
import { streamChat, buildSystemPrompt } from './ai.mjs';
import { getChapter } from './data.mjs';

// 对话历史在模块级保留，路由再进入时不清空（单轮会话）。
let conversation = []; // { role: 'user'|'assistant', content }
let streaming = false;
let currentAbort = null;
let activeChapterId = null;
let contextEnabled = true;

const SUGGESTIONS = [
  '用一句话概括本章的核心意思',
  '这一章和我现实中的协作困境有什么关系？',
  '请举一个现代职场中的应用例子',
  '本章里哪一句最值得我反复体会？为什么',
];

export function renderAI(ctx, params) {
  const { data } = ctx;
  if (params.id) {
    const ch = getChapter(data, params.id);
    if (ch) { activeChapterId = params.id; contextEnabled = true; }
  }

  const root = el('div', { class: 'stack ai-page' });
  root.append(el('h2', { class: 'section-title', text: '问道 · AI 解读' }));
  root.append(el('p', { class: 'card__text', text: '使用本站接入的 AI 服务，无需配置。提交内容将发送给 AI 服务，请避免填写个人隐私。' }));
  // ---- 章节上下文选择 ----
  const chapterSelect = el('select', { class: 'field__input ai-chapter-select', id: 'ai-chapter', 'aria-label': '选择解读章节' });
  chapterSelect.append(el('option', { value: '', text: '不限定章节（自由提问）' }));
  for (const c of data.chapters) {
    const opt = el('option', { value: c.chapter_id, text: `第 ${c.chapter_number} 章 · ${c.title_hint || ''}` });
    if (c.chapter_id === activeChapterId) opt.selected = true;
    chapterSelect.append(opt);
  }
  chapterSelect.addEventListener('change', () => {
    activeChapterId = chapterSelect.value || null;
    contextEnabled = true;
    ctx.rerender();
  });

  const contextToggle = el('label', { class: 'ai-context-toggle' }, [
    (() => {
      const cb = el('input', { type: 'checkbox' });
      cb.checked = contextEnabled;
      cb.addEventListener('change', () => { contextEnabled = cb.checked; });
      return cb;
    })(),
    el('span', { text: '把所选章节的原文与释义放进提问上下文' }),
  ]);

  const contextBar = el('div', { class: 'ai-context-bar' }, [
    el('div', { class: 'field' }, [
      el('label', { class: 'field__label', for: 'ai-chapter', text: '解读章节' }),
      chapterSelect,
    ]),
    contextToggle,
  ]);

  // ---- 快捷提问 ----
  const suggestionRow = el('div', { class: 'ai-suggestions' });
  for (const s of SUGGESTIONS) {
    suggestionRow.append(el('button', {
      type: 'button', class: 'chip', text: s,
      onclick: () => send(ctx, s),
    }));
  }

  // ---- 消息列表 ----
  const messagesEl = el('div', { class: 'ai-messages', id: 'ai-messages', 'aria-live': 'polite' });
  const renderMessages = () => {
    clear(messagesEl);
    if (!conversation.length) {
      messagesEl.append(el('p', { class: 'ai-empty', text: '还没有对话。选好章节，点上面的快捷提问，或直接输入你的问题。' }));
      return;
    }
    for (const m of conversation) {
      messagesEl.append(renderBubble(m));
    }
    requestAnimationFrame(() => { messagesEl.scrollTop = messagesEl.scrollHeight; });
  };
  renderMessages();

  // ---- 输入区 ----
  const textarea = el('textarea', {
    class: 'field__input ai-input', id: 'ai-input', rows: '3',
    placeholder: '问点什么——比如「这一章对我的一个具体决定有什么启发？」',
    'aria-label': '向 AI 提问',
  });
  const sendBtn = el('button', { type: 'button', class: 'btn btn--primary', text: '发送' });
  const stopBtn = el('button', { type: 'button', class: 'btn btn--danger', text: '停止', hidden: true });
  const clearBtn = el('button', { type: 'button', class: 'btn btn--ghost btn--sm', text: '清空对话' });

  const doSend = () => {
    const text = textarea.value.trim();
    if (!text || streaming) return;
    textarea.value = '';
    send(ctx, text);
  };
  sendBtn.addEventListener('click', doSend);
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
  });
  stopBtn.addEventListener('click', () => {
    if (currentAbort) currentAbort.abort();
  });
  clearBtn.addEventListener('click', () => {
    conversation = [];
    renderMessages();
    toast('已清空对话', 'success');
  });

  const inputBar = el('div', { class: 'ai-input-bar' }, [
    textarea,
    el('div', { class: 'row ai-input-actions' }, [clearBtn, stopBtn, sendBtn]),
  ]);

  // 把发送逻辑暴露给快捷按钮（send 定义在下方，但需引用 UI 引用）
  function send(_ctx, text) {
    if (streaming) return;
    conversation.push({ role: 'user', content: text });
    // 渲染用户气泡 + 占位助手气泡
    clear(messagesEl);
    for (const m of conversation) messagesEl.append(renderBubble(m));
    const assistantBubble = renderBubble({ role: 'assistant', content: '' });
    messagesEl.append(assistantBubble);
    const bodyEl = assistantBubble.querySelector('.ai-bubble__body');
    const cursor = el('span', { class: 'ai-cursor', 'aria-hidden': 'true', text: '▍' });
    bodyEl.append(cursor);
    requestAnimationFrame(() => { messagesEl.scrollTop = messagesEl.scrollHeight; });

    streaming = true;
    sendBtn.disabled = true;
    stopBtn.hidden = false;

    const chapter = activeChapterId ? getChapter(data, activeChapterId) : null;
    const system = buildSystemPrompt(contextEnabled ? chapter : null);
    const history = [{ role: 'system', content: system }].concat(
      conversation.map((m) => ({ role: m.role, content: m.content })),
    );

    currentAbort = streamChat({
      messages: history,
      onDelta: (delta) => {
        bodyEl.textContent += delta;
        cursor.remove();
        bodyEl.append(cursor);
        requestAnimationFrame(() => { messagesEl.scrollTop = messagesEl.scrollHeight; });
      },
      onDone: ({ aborted }) => {
        cursor.remove();
        streaming = false;
        sendBtn.disabled = false;
        stopBtn.hidden = true;
        currentAbort = null;
        if (!aborted) {
          // 把已渲染的助手内容固化进 conversation
          conversation.push({ role: 'assistant', content: bodyEl.textContent });
        } else {
          conversation.push({ role: 'assistant', content: bodyEl.textContent + '（已停止）' });
        }
        renderMessages();
      },
      onError: (err) => {
        cursor.remove();
        streaming = false;
        sendBtn.disabled = false;
        stopBtn.hidden = true;
        currentAbort = null;
        // 移除占位的空助手气泡，改为错误提示
        if (bodyEl.textContent.trim() === '') assistantBubble.remove();
        conversation = conversation.filter((m, i) => !(m.role === 'assistant' && i === conversation.length - 1 && m.content === ''));
        toast(err.message, 'error');
        renderMessages();
      },
    });
  }

  const foot = el('p', {
    class: 'field__hint ai-foot',
    text: '回答由 AI 生成，仅供阅读与思考参考。重要判断请回到原文和现实情况。',
  });

  root.append(
    contextBar,
    suggestionRow,
    messagesEl,
    inputBar,
    foot,
  );

  return frag([root]);
}

// send 为闭包内的函数声明，会被提升，因此上方 suggestionRow / sendBtn 的 onclick 可安全引用。

function renderBubble(m) {
  const isUser = m.role === 'user';
  return el('div', { class: `ai-bubble ai-bubble--${isUser ? 'user' : 'assistant'}` }, [
    el('p', { class: 'ai-bubble__role', text: isUser ? '你' : 'AI 解读' }),
    el('div', { class: 'ai-bubble__body', text: m.content || '' }),
  ]);
}
