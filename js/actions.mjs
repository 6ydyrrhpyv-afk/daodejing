// 行动与复盘

import { el, frag, toast, formatDate } from './util.mjs';
import { getChapter, themeLabel } from './data.mjs';
import { kintsugiLine } from './art.mjs';

const STATUS = {
  todo: { label: '待实践', cls: 'badge--todo' },
  doing: { label: '已实践待复盘', cls: 'badge--doing' },
  reviewed: { label: '已复盘', cls: 'badge--reviewed' },
};

export function renderActions(ctx) {
  const { store, data } = ctx;
  const state = store.state;
  const ui = ctx.ui;
  const filter = ui.actionFilter || 'all';
  const root = el('div', { class: 'stack' });
  root.append(el('div', { class: 'letterhead' }, [
    el('div', {}, [
      el('h2', { class: 'section-title', text: '行动与复盘' }),
      el('p', { class: 'field__hint', text: '这里只记录你实际要做、做过和复盘的事。本站不做能力评分，也不显示累计天数或成就。' }),
    ]),
    kintsugiLine(240, 56),
  ]));

  const filtered = state.actions.filter((a) => (filter === 'all' ? true : a.status === filter));
  const counts = state.actions.reduce((acc, a) => { acc[a.status] = (acc[a.status] || 0) + 1; return acc; }, {});

  const filterRow = el('div', { class: 'row row--wrap' });
  const options = [
    ['all', `全部（${state.actions.length}）`],
    ['todo', `待实践（${counts.todo || 0}）`],
    ['doing', `已实践待复盘（${counts.doing || 0}）`],
    ['reviewed', `已复盘（${counts.reviewed || 0}）`],
  ];
  for (const [value, label] of options) {
    filterRow.append(el('button', {
      type: 'button',
      class: `chip${filter === value ? ' chip--active' : ''}`,
      'aria-pressed': filter === value ? 'true' : 'false',
      onclick: () => { ui.actionFilter = value; ctx.rerender(); },
    }, [label]));
  }
  root.append(filterRow);

  if (state.actions.length === 0) {
    root.append(el('section', { class: 'card empty stack-tight' }, [
      kintsugiLine(220, 52),
      el('p', { class: 'card__text', text: '还没有保存的行动。完成一次分步练习后，行动会像一页手札一样在这里展开——金线只记录你的修正与积累。' }),
      el('div', { class: 'row' }, [
        el('a', { class: 'btn btn--primary', href: '#/', text: '开始一次练习' }),
        el('a', { class: 'btn btn--ghost', href: '#/chapters', text: '先读原典' }),
      ]),
    ]));
    return frag([root]);
  }

  if (filtered.length === 0) {
    root.append(el('section', { class: 'card empty' }, [
      el('p', { class: 'card__text', text: '这个状态下暂时没有记录。' }),
    ]));
  }

  for (const action of filtered) root.append(actionCard(ctx, action, data));
  return frag([root]);
}

function actionCard(ctx, action, data) {
  const { store } = ctx;
  const meta = STATUS[action.status] || STATUS.todo;
  const card = el('section', { class: 'card action-card', 'data-status': action.status });

  card.append(el('div', { class: 'action-card__head' }, [
    el('span', { class: `badge ${meta.cls}`, text: meta.label }),
    el('span', { class: 'card__meta', text: `${themeLabel(action.theme)} · 创建于 ${formatDate(action.createdAt)}` }),
  ]));
  if (action.question) card.append(el('blockquote', { class: 'quote-block', text: `问题：${action.question}` }));
  card.append(el('p', { class: 'action-card__text', text: action.text }));
  if (action.when) card.append(el('p', { class: 'card__meta', text: `实施时间／触发情境：${action.when}` }));
  if (action.observe) card.append(el('p', { class: 'card__meta', text: `预期观察：${action.observe}` }));

  if (action.chapterRefs && action.chapterRefs.length) {
    const refs = el('div', { class: 'row row--wrap' });
    for (const ref of action.chapterRefs) {
      const chapter = getChapter(data, ref.chapter_id);
      refs.append(el('a', {
        class: 'chip',
        href: `#/chapters/${ref.chapter_id}?q=${encodeURIComponent(ref.quote)}`,
        text: chapter ? `第 ${chapter.chapter_number} 章：${ref.quote}` : ref.chapter_id,
      }));
    }
    card.append(refs);
  }

  const saveAction = (patch, successText) => {
    const result = store.update((s) => ({
      ...s,
      actions: s.actions.map((a) => (a.id === action.id ? { ...a, ...patch, updatedAt: new Date().toISOString() } : a)),
    }));
    if (result.ok) { toast(successText, 'success'); ctx.rerender(); } else toast(result.error, 'error');
  };

  const buttons = el('div', { class: 'row row--wrap' });
  if (action.status === 'todo') {
    buttons.append(el('button', {
      class: 'btn btn--primary', type: 'button',
      onclick: () => saveAction({ status: 'doing', doneAt: new Date().toISOString() }, '已标记为「已实践待复盘」'),
    }, ['标记为已实践']));
  }
  if (action.status === 'doing' || action.status === 'reviewed') {
    buttons.append(el('button', {
      class: 'btn btn--primary', type: 'button',
      onclick: () => { const d = card.querySelector('.review-form'); if (d) { d.open = true; d.scrollIntoView({ block: 'nearest' }); } },
    }, [action.status === 'reviewed' ? '查看／修改复盘' : '写复盘']));
  }
  buttons.append(el('button', {
    class: 'btn btn--ghost', type: 'button',
    onclick: () => { const d = card.querySelector('.edit-form'); if (d) { d.open = true; d.scrollIntoView({ block: 'nearest' }); } },
  }, ['修改行动']));
  buttons.append(el('button', {
    class: 'btn btn--danger', type: 'button',
    onclick: async () => {
      const ok = await ctx.confirmDialog({
        title: '删除这条行动记录？',
        body: [`将删除：${action.text}`, '删除后无法恢复（除非你有备份文件）。'],
        confirmText: '确认删除',
        danger: true,
      });
      if (!ok) return;
      const result = store.update((s) => ({ ...s, actions: s.actions.filter((a) => a.id !== action.id) }));
      if (result.ok) { toast('已删除', 'success'); ctx.rerender(); } else toast(result.error, 'error');
    },
  }, ['删除']));
  card.append(buttons);

  // 修改行动
  const editText = el('textarea', { rows: '3', class: 'field__input' });
  const editWhen = el('textarea', { rows: '2', class: 'field__input' });
  const editObserve = el('textarea', { rows: '2', class: 'field__input' });
  editText.value = action.text;
  editWhen.value = action.when || '';
  editObserve.value = action.observe || '';
  const editForm = el('details', { class: 'details edit-form' }, [
    el('summary', { text: '修改行动内容' }),
    el('div', { class: 'field' }, [el('label', { class: 'field__label', text: '行动' }), editText]),
    el('div', { class: 'field' }, [el('label', { class: 'field__label', text: '实施时间／触发情境' }), editWhen]),
    el('div', { class: 'field' }, [el('label', { class: 'field__label', text: '预期观察' }), editObserve]),
    el('div', { class: 'row' }, [
      el('button', {
        class: 'btn btn--primary', type: 'button',
        onclick: () => {
          if (editText.value.trim().length < 4) { toast('行动描述太短', 'error'); return; }
          saveAction({ text: editText.value.trim(), when: editWhen.value.trim(), observe: editObserve.value.trim() }, '修改已保存');
        },
      }, ['保存修改']),
    ]),
  ]);
  card.append(editForm);

  // 复盘
  const practice = action.practice || {};
  const fActual = el('textarea', { rows: '3', class: 'field__input', placeholder: '实际发生了什么' });
  const fDiff = el('textarea', { rows: '2', class: 'field__input', placeholder: '与预期有什么不同' });
  const fReason = el('textarea', { rows: '2', class: 'field__input', placeholder: '可能的原因' });
  const fNext = el('textarea', { rows: '2', class: 'field__input', placeholder: '下次调整什么' });
  fActual.value = practice.actual || '';
  fDiff.value = practice.diff || '';
  fReason.value = practice.reason || '';
  fNext.value = practice.next || '';
  const reviewForm = el('details', { class: 'details review-form' }, [
    el('summary', { text: action.status === 'reviewed' ? '复盘内容（可修改）' : '填写复盘' }),
    el('div', { class: 'field' }, [el('label', { class: 'field__label', text: '实际发生了什么' }), fActual]),
    el('div', { class: 'field' }, [el('label', { class: 'field__label', text: '与预期有什么不同' }), fDiff]),
    el('div', { class: 'field' }, [el('label', { class: 'field__label', text: '可能的原因' }), fReason]),
    el('div', { class: 'field' }, [el('label', { class: 'field__label', text: '下次调整什么' }), fNext]),
    el('div', { class: 'row' }, [
      el('button', {
        class: 'btn btn--primary', type: 'button',
        onclick: () => {
          if (!fActual.value.trim()) { toast('请先写「实际发生了什么」', 'error'); return; }
          saveAction({
            status: 'reviewed',
            practice: {
              actual: fActual.value.trim(),
              diff: fDiff.value.trim(),
              reason: fReason.value.trim(),
              next: fNext.value.trim(),
              reviewedAt: new Date().toISOString(),
            },
          }, '复盘已保存');
        },
      }, ['保存复盘']),
    ]),
  ]);
  card.append(reviewForm);

  if (action.status === 'reviewed') {
    card.append(el('div', { class: 'feedback' }, [
      el('h4', { class: 'card__label', text: `复盘记录${practice.reviewedAt ? '（' + formatDate(practice.reviewedAt) + '）' : ''}` }),
      el('p', { class: 'card__text', text: `实际：${practice.actual || '（未填写）'}` }),
      el('p', { class: 'card__text', text: `与预期的不同：${practice.diff || '（未填写）'}` }),
      el('p', { class: 'card__text', text: `可能原因：${practice.reason || '（未填写）'}` }),
      el('p', { class: 'card__text', text: `下次调整：${practice.next || '（未填写）'}` }),
    ]));
  }

  return card;
}
