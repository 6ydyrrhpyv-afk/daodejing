// 分步练习：五步流程 + 可选的 AI 辅助

import { el, frag, toast, debounce, uid, formatDate, icon } from './util.mjs';
import { getBranch, getChapter, getTheme, themeLabel } from './data.mjs';
import { mountainStrip } from './art.mjs';

const STEPS = [
  { n: 1, label: '问事', hint: '问题与主题' },
  { n: 2, label: '明因', hint: '澄清情境' },
  { n: 3, label: '读典', hint: '原文与借鉴' },
  { n: 4, label: '辨意', hint: '理解辨析' },
  { n: 5, label: '践行', hint: '写下行动' },
];

export function renderPractice(ctx) {
  const { store } = ctx;
  const draft = store.state.draft;
  const root = el('div', { class: 'stack' });

  if (!draft) {
    root.append(el('h2', { class: 'section-title', text: '分步练习' }));
    root.append(el('section', { class: 'card empty' }, [
      el('p', { class: 'card__text', text: '还没有进行中的练习。先提出一个真实问题，再进入分步练习。' }),
      el('div', { class: 'row' }, [
        el('a', { class: 'btn btn--primary', href: '#/', text: '去首页提出问题' }),
        el('a', { class: 'btn btn--ghost', href: '#/chapters', text: '先读原典' }),
      ]),
    ]));
    return frag([root]);
  }

  const saveDraft = (patch, options = {}) => {
    const result = store.update((s) => ({
      ...s,
      draft: { ...s.draft, ...patch, updatedAt: new Date().toISOString() },
    }));
    if (!result.ok) { toast(result.error, 'error'); return false; }
    if (options.silent !== true && options.toastText) toast(options.toastText, 'success');
    return true;
  };

  const goto = (step) => {
    if (!saveDraft({ step })) return;
    ctx.rerender();
  };

  root.append(el('h2', { class: 'section-title', text: '分步练习' }));
  root.append(el('div', { class: 'path-strip', 'aria-hidden': 'true' }, [mountainStrip()]));
  root.append(stepper(draft.step, goto));

  if (draft.step === 1) root.append(stepOne(ctx, draft, saveDraft, goto));
  if (draft.step === 2) root.append(stepTwo(ctx, draft, saveDraft, goto));
  if (draft.step === 3) root.append(stepThree(ctx, draft, saveDraft, goto));
  if (draft.step === 4) root.append(stepFour(ctx, draft, saveDraft, goto));
  if (draft.step === 5) root.append(stepFive(ctx, draft, saveDraft, goto));

  root.append(el('p', { class: 'field__hint', text: '每一步都会自动保存草稿；切换页面、刷新或去读原文都不会丢失已填内容。数据仅保存在当前浏览器。' }));
  return frag([root]);
}

function stepper(current, goto) {
  const list = el('ol', { class: 'stepper' });
  for (const step of STEPS) {
    const active = step.n === current;
    const done = step.n < current;
    // 已完成用图标 + 文字双通道表达，不只靠颜色
    const glyph = done
      ? icon('check', 16)
      : el('span', { class: 'stepper__num', 'aria-hidden': 'true', text: String(step.n) });
    const btn = el('button', {
      type: 'button',
      class: `stepper__item${active ? ' is-active' : ''}${done ? ' is-done' : ''}`,
      'aria-current': active ? 'step' : null,
      'aria-label': `${step.n} ${step.label} · ${step.hint}${done ? '（已完成）' : ''}`,
      disabled: step.n > current,
      onclick: () => goto(step.n),
    }, [
      el('span', { class: 'stepper__glyph' }, [glyph]),
      el('span', { class: 'stepper__label', text: step.label }),
      el('span', { class: 'stepper__hint', text: done ? `${step.hint} · 已完成` : step.hint }),
    ]);
    list.append(el('li', {}, [btn]));
  }
  return list;
}

function stepOne(ctx, draft, saveDraft, goto) {
  const { data } = ctx;
  const question = el('textarea', { id: 'p-question', rows: '4', class: 'field__input' });
  question.value = draft.question || '';
  const autoSave = debounce(() => saveDraft({ question: question.value.trim() }), 400);
  question.addEventListener('input', autoSave);

  const radios = el('div', { class: 'radio-row' });
  for (const theme of data.guidance.themes) {
    const input = el('input', { type: 'radio', name: 'p-theme', value: theme.id, id: `p-theme-${theme.id}` });
    if (draft.theme === theme.id) input.checked = true;
    input.addEventListener('change', () => {
      saveDraft({ theme: input.value, branchId: '', branchOther: '' });
      ctx.rerender();
    });
    radios.append(el('div', { class: 'radio-item' }, [input, el('label', { for: `p-theme-${theme.id}`, text: theme.name })]));
  }

  return el('section', { class: 'card' }, [
    el('h3', { class: 'card__title', text: '步骤一 · 保存你的问题与主题' }),
    el('fieldset', { class: 'field' }, [el('legend', { class: 'field__label', text: '主题' }), radios]),
    el('div', { class: 'field' }, [
      el('label', { class: 'field__label', for: 'p-question', text: '你的真实问题' }),
      question,
    ]),
    el('div', { class: 'row' }, [
      el('button', {
        class: 'btn btn--primary', type: 'button',
        onclick: () => {
          if (question.value.trim().length < 4) { toast('请把问题描述得更具体一些（至少 4 个字）', 'error'); return; }
          if (saveDraft({ question: question.value.trim() }, { toastText: '步骤一已保存' })) goto(2);
        },
      }, ['保存并进入步骤二']),
      el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => { if (saveDraft({ question: question.value.trim() }, { toastText: '草稿已保存' })) ctx.rerender(); } }, ['保存草稿']),
    ]),
  ]);
}

function stepTwo(ctx, draft, saveDraft, goto) {
  const { data } = ctx;
  const theme = getTheme(data, draft.theme);
  const wrap = el('section', { class: 'card' }, [
    el('h3', { class: 'card__title', text: '步骤二 · 澄清最影响判断的原因' }),
    el('p', { class: 'card__text', text: '选一个最接近当下情况的说明。这一步只用于选择固定材料，不会被自动分析。' }),
  ]);
  if (!theme) {
    wrap.append(el('p', { class: 'notice notice--error', text: '主题已失效，请回到步骤一重新选择。' }));
    return wrap;
  }

  const box = el('div', { class: 'radio-stack' });
  const otherBox = el('div', { class: 'sub-box' }, [
    el('p', { class: 'notice', text: '引导模式不会自动理解你自由输入的文字。选择「其他／自己补充」后，你写下的内容只会被保存下来，用于之后自己回看或给 AI 辅助模式使用，本站不会据此生成分析。' }),
  ]);
  const otherInput = el('textarea', { id: 'p-other', rows: '3', class: 'field__input', placeholder: '用自己的话描述这个情境（不会被自动分析）' });
  otherInput.value = draft.branchOther || '';
  otherInput.addEventListener('input', debounce(() => saveDraft({ branchOther: otherInput.value }), 400));
  otherBox.append(el('div', { class: 'field' }, [
    el('label', { class: 'field__label', for: 'p-other', text: '你的补充描述' }),
    otherInput,
  ]));

  const naBox = el('div', { class: 'sub-box' }, [
    el('p', { class: 'notice', text: '已记录：现有固定材料都不适用。引导模式不会猜测你的情境，也不会为了填满流程而编造匹配。' }),
  ]);

  const makeRadio = (value, label) => {
    const input = el('input', { type: 'radio', name: 'p-branch', value, id: `p-branch-${value.replace(':', '-')}` });
    if (draft.branchId === value) input.checked = true;
    input.addEventListener('change', () => {
      saveDraft({ branchId: value });
      ctx.rerender();
    });
    return el('div', { class: 'radio-item' }, [input, el('label', { for: input.id, text: label })]);
  };

  for (const option of theme.clarify) box.append(makeRadio(`${theme.id}:${option.id}`, option.label));
  box.append(makeRadio('custom', '其他／自己补充'));
  box.append(makeRadio('not_applicable', '以上情境都不适用'));

  wrap.append(box);
  if (draft.branchId === 'custom') wrap.append(otherBox);
  if (draft.branchId === 'not_applicable') wrap.append(naBox);

  const note = el('textarea', { id: 'p-note', rows: '2', class: 'field__input', placeholder: '可选：还有什么会影响你的判断？' });
  note.value = draft.clarifyNote || '';
  note.addEventListener('input', debounce(() => saveDraft({ clarifyNote: note.value }), 400));
  wrap.append(el('div', { class: 'field' }, [
    el('label', { class: 'field__label', for: 'p-note', text: '补充说明（可选）' }),
    note,
  ]));

  wrap.append(el('div', { class: 'row' }, [
    el('a', { class: 'btn btn--ghost', href: '#/', text: '返回步骤一' }),
    el('button', {
      class: 'btn btn--primary', type: 'button',
      onclick: () => {
        if (!draft.branchId) { toast('请选择一个最接近的说明', 'error'); return; }
        if (saveDraft({ step: 3 })) ctx.rerender();
      },
    }, ['保存并进入步骤三']),
  ]));
  wrap.append(el('p', { class: 'field__hint', text: `当前主题：${theme.name}。切换主题会清空已选的情境分支。` }));
  return wrap;
}

function stepThree(ctx, draft, saveDraft, goto) {
  const { data, store } = ctx;
  const branch = getBranch(data, draft.branchId);
  const wrap = el('section', { class: 'card' }, [
    el('h3', { class: 'card__title', text: '步骤三 · 相关原文与现代情境借鉴' }),
  ]);

  if (!branch) {
    wrap.append(el('p', { class: 'notice notice--error', text: '还没有选择情境分支，请回到步骤二。' }));
    wrap.append(el('a', { class: 'btn btn--ghost', href: '#/practice', text: '返回步骤二' }));
    return wrap;
  }

  if (branch.chapter_refs.length === 0) {
    wrap.append(el('p', { class: 'notice', text: branch.honest_notice }));
    wrap.append(el('ul', { class: 'bullets' }, branch.options.map((o) => el('li', { text: o }))));
    wrap.append(el('p', { class: 'card__text', text: branch.boundary }));
  } else {
    wrap.append(el('p', { class: 'card__text', text: branch.situation_summary }));
    wrap.append(el('h4', { class: 'card__label', text: '① 原文依据' }));
    for (const ref of branch.chapter_refs) {
      const chapter = getChapter(data, ref.chapter_id);
      if (!chapter) continue;
      const link = `#/chapters/${chapter.chapter_id}?from=practice&q=${encodeURIComponent(ref.quote)}`;
      wrap.append(el('div', { class: 'ref' }, [
        el('p', { class: 'ref__text', text: ref.quote }),
        el('p', { class: 'ref__meta', text: `第 ${chapter.chapter_number} 章 · ${chapter.edition}` }),
        el('p', { class: 'ref__why', text: `为什么相关：${ref.why}` }),
        el('a', { class: 'btn btn--ghost btn--sm', href: link, text: '查看整章并定位这一句' }),
      ]));
    }
    wrap.append(el('h4', { class: 'card__label', text: '② 来源解释' }));
    wrap.append(el('p', { class: 'card__text', text: '本站整理释义，非王弼等古代注家原话；本站未提供多家注解库，也不做逐字校勘。可在上方「查看整章」中核对原文与来源链接。' }));
    wrap.append(el('h4', { class: 'card__label', text: '③ 现代情境推演' }));
    wrap.append(el('p', { class: 'card__text', text: branch.modern_inference }));
    wrap.append(el('h4', { class: 'card__label', text: '④ 适用边界' }));
    wrap.append(el('p', { class: 'card__text', text: branch.boundary }));
    wrap.append(el('h4', { class: 'card__label', text: '⑤ 可尝试行动' }));
    wrap.append(el('p', { class: 'card__text', text: branch.try_action }));
  }

  if (store.state.mode === 'ai') wrap.append(aiPanel(ctx, draft));
  else wrap.append(el('p', { class: 'notice', text: '当前是引导练习模式：以上为按你选择的情境分支给出的固定材料。需要按你的具体描述做情境整理时，可在「设置」切换到 AI 辅助（要求服务端已配置模型）。' }));

  wrap.append(el('div', { class: 'row' }, [
    el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => goto(2) }, ['返回步骤二修改']),
    el('button', { class: 'btn btn--primary', type: 'button', onclick: () => goto(4) }, ['保存并进入步骤四']),
  ]));
  void saveDraft;
  return wrap;
}

function aiPanel(ctx, draft) {
  const { store } = ctx;
  const panel = el('section', { class: 'card card--ai' }, [
    el('h4', { class: 'card__label', text: 'AI 辅助（可选）' }),
    el('p', { class: 'field__hint', text: '点击请求后，你的问题与所选情境会发送给你在服务端配置的模型服务；密钥只存在于服务端环境变量中，不会写入网页或浏览器存储。原文阅读、行动保存与手动复盘不依赖 AI。' }),
  ]);
  const status = el('p', { class: 'notice', role: 'status' });
  const resultBox = el('div', { class: 'stack' });
  let controller = null;
  let busy = false;
  const pendingKey = `ai:pending:${draft.branchId}:${draft.question}`;

  const actions = el('div', { class: 'row' });
  const askBtn = el('button', { class: 'btn btn--primary', type: 'button', onclick: request }, ['请求 AI 辅助分析']);
  const cancelBtn = el('button', { class: 'btn btn--ghost', type: 'button', onclick: cancel, disabled: true }, ['取消']);
  const retryBtn = el('button', { class: 'btn btn--ghost', type: 'button', onclick: request, disabled: true }, ['重试']);
  actions.append(askBtn, cancelBtn, retryBtn);
  panel.append(actions, status, resultBox);

  function setBusy(value, text) {
    busy = value;
    askBtn.disabled = value;
    cancelBtn.disabled = !value;
    retryBtn.disabled = value;
    status.textContent = text || '';
  }

  function cancel() {
    if (controller) controller.abort();
    controller = null;
    setBusy(false, '已取消本次请求，未产生任何回答。');
    store.session = store.session || {};
    delete store.session[pendingKey];
  }

  async function request() {
    if (busy) return;
    if (store.session && store.session[pendingKey]) { setBusy(false, '上一次请求仍在处理中，请稍候或使用「取消」。'); return; }
    controller = new AbortController();
    store.session = store.session || {};
    store.session[pendingKey] = Date.now();
    setBusy(true, '处理请求中……模型正在按已收录的全部 81 章检索依据。');
    try {
      const response = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          question: draft.question,
          theme: draft.theme,
          branchId: draft.branchId,
          branchOther: draft.branchOther,
          clarifyNote: draft.clarifyNote,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload || payload.ok === false) {
        const code = payload && payload.error ? payload.error.code : 'UNKNOWN';
        const message = payload && payload.error ? payload.error.message : '';
        const shown = message && !errorText(code).includes(message) ? `${errorText(code)}（服务端返回：${message}）` : errorText(code);
        setBusy(false, `${shown}。未产生回答，可重试或继续使用上面的固定材料。`);
        retryBtn.disabled = false;
        return;
      }
      renderResult(payload.data, payload.meta);
      setBusy(false, '已完成。以下为模型返回内容，引用已经服务端校验。');
      retryBtn.disabled = false;
    } catch (error) {
      if (error && error.name === 'AbortError') { setBusy(false, '已取消本次请求。'); return; }
      setBusy(false, `网络或服务异常：${error && error.message ? error.message : error}。未产生回答，可重试。`);
      retryBtn.disabled = false;
    } finally {
      controller = null;
      if (store.session) delete store.session[pendingKey];
    }
  }

  function renderResult(data, meta) {
    const box = el('div', { class: 'stack' });
    if (data.no_match) {
      box.append(el('p', { class: 'notice notice--warn', text: '模型返回：目前没有找到足够贴切的文本，只做情境整理，不强行匹配经典。' }));
    }
    box.append(sectionBlock('情境摘要', data.situation_summary));
    if (data.references && data.references.length) {
      const refs = el('div', {});
      for (const ref of data.references) {
        const chapter = getChapter(ctx.data, ref.chapter_id);
        refs.append(el('div', { class: 'ref' }, [
          el('p', { class: 'ref__text', text: ref.quote }),
          el('p', { class: 'ref__meta', text: `第 ${ref.chapter_number} 章` }),
          ref.relevance ? el('p', { class: 'ref__why', text: ref.relevance }) : null,
          el('a', { class: 'btn btn--ghost btn--sm', href: `#/chapters/${ref.chapter_id}?from=practice&q=${encodeURIComponent(ref.quote)}`, text: '查看整章并定位这一句' }),
        ]));
        void chapter;
      }
      box.append(el('div', {}, [el('h4', { class: 'card__label', text: '① 原文依据（已校验）' }), refs]));
    } else {
      box.append(el('p', { class: 'notice notice--warn', text: '本次返回的引用未通过校验或模型未给出引用，因此本站不展示为「有据的原文依据」，仅保留情境整理部分。' }));
    }
    box.append(sectionBlock('③ 现代借鉴', data.modern_inference));
    box.append(sectionBlock('④ 适用边界', data.boundary));
    box.append(sectionBlock('⑤ 一个小行动', data.try_action));
    box.append(sectionBlock('⑥ 一个观察点', data.observation));
    if (data.uncertainty) box.append(sectionBlock('不确定之处', data.uncertainty));
    if (meta) {
      box.append(el('p', {
        class: 'field__hint',
        text: `模型：${meta.model || '未标注'}；引用校验：${meta.references_verified ? '通过' : '未通过'}；尝试次数：${meta.attempts}${meta.fallback ? '（已回退为无引用展示）' : ''}；本次调用计入服务端额度。`,
      }));
    }
    box.append(el('p', { class: 'field__hint', text: '你可以修改上面的问题或情境分支后重新请求；模型回答不是标准答案，也不代表老子本人的判断。' }));
    resultBox.replaceChildren(box);
  }
  return panel;
}

function sectionBlock(title, text) {
  if (!text) return null;
  return el('div', {}, [el('h4', { class: 'card__label', text: title }), el('p', { class: 'card__text', text })]);
}

function errorText(code) {
  const map = {
    AI_NOT_CONFIGURED: '服务端未配置模型服务（缺少 AI_BASE_URL / AI_API_KEY），AI 辅助不可用，本地引导练习不受影响',
    INVALID_INPUT: '输入不合法',
    RATE_LIMITED: '请求过于频繁，已被限流',
    UPSTREAM_TIMEOUT: '模型服务超时',
    UPSTREAM_ERROR: '模型服务异常',
    BAD_MODEL_OUTPUT: '模型返回内容无法解析',
    PAYLOAD_INVALID: '模型返回结构不完整',
  };
  return map[code] || '请求失败';
}

function stepFour(ctx, draft, saveDraft, goto) {
  const { data } = ctx;
  const branch = getBranch(data, draft.branchId);
  const wrap = el('section', { class: 'card' }, [
    el('h3', { class: 'card__title', text: '步骤四 · 理解辨析' }),
  ]);

  if (!branch || !branch.quiz) {
    const input = el('textarea', { id: 'p-understand', rows: '4', class: 'field__input', placeholder: '写下你认为这个情境里最影响判断的一点' });
    input.value = draft.understanding?.text || '';
    input.addEventListener('input', debounce(() => saveDraft({ understanding: { ...draft.understanding, text: input.value } }), 400));
    wrap.append(el('p', { class: 'notice', text: '你选择的情境没有匹配到固定材料，因此本站不生成辨析题（不会为了填满流程而编造题目）。你可以写下自己的判断，它不会被评判。' }));
    wrap.append(el('div', { class: 'field' }, [
      el('label', { class: 'field__label', for: 'p-understand', text: '你认为最影响判断的一点' }),
      input,
    ]));
  } else {
    const quiz = branch.quiz;
    wrap.append(el('p', { class: 'card__text', text: quiz.question }));
    const options = el('div', { class: 'radio-stack' });
    for (const option of quiz.options) {
      const input = el('input', { type: 'radio', name: 'p-quiz', value: option.id, id: `p-quiz-${option.id}` });
      if (draft.understanding?.choice === option.id) input.checked = true;
      options.append(el('div', { class: 'radio-item' }, [input, el('label', { for: input.id, text: option.label })]));
    }
    wrap.append(options);
    wrap.append(el('p', { class: 'field__hint', text: '提交后会先显示你选了什么，再给出理由与适用边界。这不是标准答案，也不存在唯一正确答案。' }));
    wrap.append(el('div', { class: 'row' }, [
      el('button', {
        class: 'btn btn--primary', type: 'button',
        onclick: () => {
          const picked = options.querySelector('input[name="p-quiz"]:checked');
          if (!picked) { toast('请先选择一个选项', 'error'); return; }
          saveDraft({ understanding: { choice: picked.value, text: draft.understanding?.text || '', answeredAt: new Date().toISOString() } });
          ctx.rerender();
        },
      }, ['提交并查看反馈']),
    ]));

    if (draft.understanding?.choice) {
      const chosen = quiz.options.find((o) => o.id === draft.understanding.choice);
      wrap.append(el('div', { class: 'feedback' }, [
        el('h4', { class: 'card__label', text: '你的回答' }),
        el('p', { class: 'card__text', text: chosen ? chosen.label : draft.understanding.choice }),
        el('p', { class: 'field__hint', text: `提交时间：${formatDate(draft.understanding.answeredAt)}` }),
        el('h4', { class: 'card__label', text: '理由与适用边界' }),
        el('p', { class: 'card__text', text: chosen ? chosen.feedback : '' }),
        el('p', { class: 'card__text', text: chosen ? `边界：${chosen.boundary}` : '' }),
      ]));
      const others = el('div', { class: 'stack' });
      for (const option of quiz.options) {
        if (option.id === draft.understanding.choice) continue;
        others.append(el('details', { class: 'details' }, [
          el('summary', { text: `其他思路：${option.label}` }),
          el('p', { class: 'card__text', text: option.feedback }),
          el('p', { class: 'field__hint', text: `边界：${option.boundary}` }),
        ]));
      }
      wrap.append(others);
    }
  }

  wrap.append(el('div', { class: 'row' }, [
    el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => goto(3) }, ['返回步骤三修改']),
    el('button', { class: 'btn btn--primary', type: 'button', onclick: () => goto(5) }, ['保存并进入步骤五']),
  ]));
  return wrap;
}

function stepFive(ctx, draft, saveDraft, goto) {
  const { store, data, navigate } = ctx;
  const branch = getBranch(data, draft.branchId);
  const text = el('textarea', { id: 'p-action', rows: '3', class: 'field__input', placeholder: '写下你准备做的一件具体的事' });
  const when = el('textarea', { id: 'p-when', rows: '2', class: 'field__input', placeholder: '例如：明天上午开工前 10 分钟 / 下次他来问我的时候' });
  const observe = el('textarea', { id: 'p-observe', rows: '2', class: 'field__input', placeholder: '例如：他会不会主动说出自己的第一步' });
  text.value = draft.action?.text || '';
  when.value = draft.action?.when || '';
  observe.value = draft.action?.observe || '';
  const sync = debounce(() => saveDraft({ action: { text: text.value, when: when.value, observe: observe.value } }), 400);
  for (const node of [text, when, observe]) node.addEventListener('input', sync);

  const wrap = el('section', { class: 'card' }, [
    el('h3', { class: 'card__title', text: '步骤五 · 写下一个可执行的行动' }),
    branch && branch.try_action ? el('p', { class: 'notice', text: `参考（可改写成你自己的版本）：${branch.try_action}` }) : null,
    el('div', { class: 'field' }, [el('label', { class: 'field__label', for: 'p-action', text: '你要做的行动' }), text]),
    el('div', { class: 'field' }, [el('label', { class: 'field__label', for: 'p-when', text: '实施时间或触发情境' }), when]),
    el('div', { class: 'field' }, [el('label', { class: 'field__label', for: 'p-observe', text: '预期观察到的现象' }), observe]),
    el('div', { class: 'row' }, [
      el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => goto(4) }, ['返回步骤四修改']),
      el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => { if (saveDraft({ action: { text: text.value, when: when.value, observe: observe.value } }, { toastText: '草稿已保存' })) ctx.rerender(); } }, ['保存草稿']),
      el('button', {
        class: 'btn btn--primary', type: 'button',
        onclick: () => {
          const actionText = text.value.trim();
          if (actionText.length < 4) { toast('请把行动写得具体一些（至少 4 个字）', 'error'); return; }
          const now = new Date().toISOString();
          const record = {
            id: uid('act'),
            createdAt: now,
            updatedAt: now,
            question: draft.question,
            theme: draft.theme,
            branchId: draft.branchId,
            chapterRefs: (branch?.chapter_refs || []).map((r) => ({ chapter_id: r.chapter_id, quote: r.quote })),
            text: actionText,
            when: when.value.trim(),
            observe: observe.value.trim(),
            status: 'todo',
            doneAt: '',
            practice: { actual: '', diff: '', reason: '', next: '', reviewedAt: '' },
          };
          const result = store.update((s) => ({
            ...s,
            actions: [record, ...s.actions],
            draft: { ...s.draft, step: 5, action: { text: actionText, when: when.value.trim(), observe: observe.value.trim() }, updatedAt: now },
          }));
          if (!result.ok) { toast(result.error, 'error'); return; }
          toast('已保存到行动清单（状态：待实践）', 'success');
          navigate('#/actions');
        },
      }, ['保存到行动清单']),
    ]),
    el('p', { class: 'field__hint', text: `主题：${themeLabel(draft.theme)}。保存后仍可在行动清单里修改与复盘。` }),
  ]);
  return wrap;
}
