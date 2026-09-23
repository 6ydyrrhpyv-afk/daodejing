// 首页／情境入口：左练习入口，右纸面镂空中的溪涧意境

import { el, frag, toast, formatDate } from './util.mjs';
import { themeLabel } from './data.mjs';
import { tornHoleScene } from './art.mjs';

const STEP_LABEL = { 1: '步骤一 问题', 2: '步骤二 澄清', 3: '步骤三 原文与借鉴', 4: '步骤四 辨析', 5: '步骤五 行动' };

export function renderHome(ctx) {
  const { store, data, navigate } = ctx;
  const root = el('div', { class: 'stack' });
  const state = store.state;

  // ---- hero：左 60% 练习入口，右 40% 溪涧意境 ----
  const textarea = el('textarea', {
    id: 'question-input',
    name: 'question',
    rows: '4',
    class: 'field__input',
    placeholder: '例如：我交代的事情总要追问进度，怎样既不失控又不显得不信任？',
    'aria-describedby': 'question-hint',
  });

  const params = new URLSearchParams((location.hash.split('?')[1] || ''));
  const draft = state.draft;
  const presetTheme = params.get('theme') || (draft ? draft.theme : '') || '';

  const radios = el('div', { class: 'radio-row' });
  const form = el('form', { class: 'card form', novalidate: true, onsubmit: (event) => submit(event) }, [
    el('h2', { class: 'card__title' }, ['开始一次练习']),
    el('fieldset', { class: 'field' }, [
      el('legend', { class: 'field__label', text: '选择主题' }),
      radios,
    ]),
    el('div', { class: 'field' }, [
      el('label', { class: 'field__label', for: 'question-input', text: '你的真实问题' }),
      textarea,
      el('p', { class: 'field__hint', id: 'question-hint', text: '越具体越好：写清涉及什么人、什么事、卡在哪一步。这一步只是保存下来，不会自动分析。' }),
    ]),
    el('div', { class: 'row' }, [
      el('button', { class: 'btn btn--primary', type: 'submit' }, ['开始分步练习']),
    ]),
    el('p', { class: 'field__hint', text: '数据仅保存在当前浏览器，不跨设备同步。' }),
  ]);

  for (const theme of data.guidance.themes) {
    const input = el('input', { type: 'radio', name: 'theme', value: theme.id, id: `theme-${theme.id}` });
    if (presetTheme === theme.id) input.checked = true;
    radios.append(el('div', { class: 'radio-item' }, [
      input,
      el('label', { for: `theme-${theme.id}`, text: theme.name }),
    ]));
  }

  function fillForm(themeId, question) {
    const radio = form.querySelector(`input[name="theme"][value="${themeId}"]`);
    if (radio) radio.checked = true;
    textarea.value = question;
    textarea.focus();
    toast('已填入输入框，可修改后再提交');
  }

  function submit(event) {
    event.preventDefault();
    const selected = form.querySelector('input[name="theme"]:checked');
    const question = textarea.value.trim();
    if (!selected) { toast('请先选择一个主题', 'error'); return; }
    if (question.length < 4) { toast('请把问题描述得更具体一些（至少 4 个字）', 'error'); return; }
    if (question.length > 1000) { toast('问题太长，请精简到 1000 字以内', 'error'); return; }
    const now = new Date().toISOString();
    const result = store.update((s) => ({
      ...s,
      draft: {
        theme: selected.value,
        question,
        step: 2,
        branchId: '',
        branchOther: '',
        clarifyNote: s.draft && s.draft.theme === selected.value ? s.draft.clarifyNote || '' : '',
        understanding: { choice: '', text: '', answeredAt: '' },
        action: { text: '', when: '', observe: '' },
        updatedAt: now,
      },
    }));
    if (!result.ok) { toast(result.error, 'error'); return; }
    toast('已保存问题与主题（步骤一完成）', 'success');
    navigate('#/practice');
  }

  const visualQuote = el('figure', { class: 'hero-visual__quote' }, [
    el('blockquote', { text: '“上善若水。水善利万物而不争。”' }),
    el('cite', { text: '—— 第八章 · 王弼本' }),
  ]);

  const heroMain = el('div', { class: 'hero__main' }, [
    el('p', { class: 'hero__kicker', text: '处事练习室 · 道德经全本 81 章' }),
    el('h1', { class: 'hero__title', text: '读一段经典，想清一件事。' }),
    el('p', { class: 'hero__sub', text: '提出一个真实问题，澄清情境，读一段有来源的原文，写下你明天能做的一件事。' }),
    el('p', { class: 'notice notice--mode' }, [
      el('strong', { text: state.mode === 'ai' ? '当前模式：AI 辅助' : '当前模式：引导练习' }),
      el('span', {
        text: state.mode === 'ai'
          ? '（AI 辅助需要服务端已配置模型；未配置时会自动退回引导练习，原文阅读与行动保存不依赖 AI）'
          : '（引导模式按你选择的情境分支给出固定材料，不会自动理解你自由输入的文字）',
      }),
    ]),
    form,
  ]);

  const heroVisual = el('aside', { class: 'hero-visual', 'aria-label': '首页意境插画' }, [
    tornHoleScene(),
    el('span', { class: 'hero-visual__tag', 'aria-hidden': 'true', text: '上善若水' }),
    el('span', { class: 'hero-visual__seal', 'aria-hidden': 'true', text: '水' }),
    visualQuote,
    el('p', { class: 'hero-visual__note', text: '※ 此为原创矢量插绘装饰，非摄影素材；生成图片服务不可用时以此保证布局。' }),
  ]);

  root.append(el('div', { class: 'hero' }, [heroMain, heroVisual]));

  // ---- 继续未完成的练习 ----
  if (draft && draft.question) {
    root.append(el('section', { class: 'card card--resume' }, [
      el('h2', { class: 'card__title' }, ['继续未完成的练习']),
      el('p', { class: 'card__meta', text: `${themeLabel(draft.theme)} · ${STEP_LABEL[draft.step] || ''}${draft.updatedAt ? ' · 更新于 ' + formatDate(draft.updatedAt) : ''}` }),
      el('blockquote', { class: 'quote-block', text: draft.question }),
      el('div', { class: 'row' }, [
        el('button', { class: 'btn btn--primary', type: 'button', onclick: () => navigate('#/practice') }, ['继续练习']),
        el('button', {
          class: 'btn btn--ghost',
          type: 'button',
          onclick: async () => {
            const ok = await ctx.confirmDialog({
              title: '放弃这份草稿？',
              body: ['草稿中的问题和已填内容会被删除，已保存到行动清单的记录不受影响。'],
              confirmText: '放弃草稿',
              danger: true,
            });
            if (!ok) return;
            const result = store.update((s) => ({ ...s, draft: null }));
            if (result.ok) { toast('草稿已删除'); ctx.rerender(); } else toast(result.error, 'error');
          },
        }, ['放弃草稿']),
      ]),
    ]));
  }

  // ---- 三个主题（示例只填入，不自动提交） ----
  const grid = el('div', { class: 'grid grid--3' });
  for (const theme of data.guidance.themes) {
    const example = theme.examples[0];
    grid.append(el('section', { class: 'card theme-card' }, [
      el('h2', { class: 'card__title', text: theme.name }),
      el('p', { class: 'card__text', text: theme.summary }),
      el('p', { class: 'card__label', text: '示例问题' }),
      el('blockquote', { class: 'quote-block', text: example }),
      el('button', {
        class: 'btn btn--ghost btn--sm',
        type: 'button',
        onclick: () => fillForm(theme.id, example),
      }, ['填入输入框']),
    ]));
  }
  root.append(el('h2', { class: 'section-title', text: '三个主题' }));
  root.append(grid);

  return frag([root]);
}
