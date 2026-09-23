// 设置：模式、AI 状态、存储说明、备份与恢复

import { el, frag, toast, formatDate } from './util.mjs';
import { buildBackup, validateBackup, mergeStates } from './validate.mjs';
import { getSyncMeta, genSyncId, enableSync, disableSync, onSyncStatus } from './sync.mjs';

export function renderSettings(ctx) {
  const { store } = ctx;
  const root = el('div', { class: 'stack' });
  root.append(el('h2', { class: 'section-title', text: '设置与数据' }));

  // 模式
  const modeBox = el('section', { class: 'card' }, [
    el('h3', { class: 'card__title', text: '练习模式' }),
    el('p', { class: 'card__text', text: '引导练习：按你选择的情境分支给出固定材料。AI 辅助：把你的问题与情境发给服务端配置的模型，并按已收录的全部 81 章校验引用。' }),
  ]);
  const modeRow = el('div', { class: 'radio-row' });
  const modes = [
    ['guide', '引导练习（默认，不需要任何配置）'],
    ['ai', 'AI 辅助（需要服务端已配置模型）'],
  ];
  for (const [value, label] of modes) {
    const input = el('input', { type: 'radio', name: 'mode', value, id: `mode-${value}` });
    if (store.state.mode === value) input.checked = true;
    input.addEventListener('change', () => {
      const result = store.update((s) => ({ ...s, mode: value }));
      if (result.ok) { toast(value === 'ai' ? '已切换到 AI 辅助模式' : '已切换到引导练习模式', 'success'); ctx.rerender(); }
      else toast(result.error, 'error');
    });
    modeRow.append(el('div', { class: 'radio-item' }, [input, el('label', { for: `mode-${value}`, text: label })]));
  }
  modeBox.append(modeRow);
  root.append(modeBox);

  // AI 状态
  const aiBox = el('section', { class: 'card' }, [
    el('h3', { class: 'card__title', text: 'AI 服务状态' }),
    el('p', { class: 'card__text', id: 'ai-status', text: '正在检查服务端配置……' }),
  ]);
  root.append(aiBox);
  fetch('/api/config').then((r) => r.json()).then((cfg) => {
    const node = aiBox.querySelector('#ai-status');
    if (!node) return;
    if (cfg.aiConfigured) {
      node.textContent = `已配置：模型 ${cfg.model || '未标注'}（服务端环境变量）。每日调用上限 ${cfg.limits?.dailyCalls ?? '未设置'}，每分钟 ${cfg.limits?.perMinute ?? '未设置'} 次，输入上限 ${cfg.limits?.maxInputChars ?? '未设置'} 字。`;
    } else {
      node.textContent = '未配置（缺少 AI_BASE_URL 或 AI_API_KEY）。AI 辅助不可用；原文阅读、分步练习、行动保存与手动复盘不依赖 AI。配置方法见项目根目录 README.md 与 .env.example。';
    }
  }).catch(() => {
    const node = aiBox.querySelector('#ai-status');
    if (node) node.textContent = '无法连接服务端接口，AI 状态未知。本地引导练习仍可正常使用。';
  });

  // 跨设备同步
  const syncBox = el('section', { class: 'card' }, [
    el('h3', { class: 'card__title', text: '跨设备同步' }),
    el('p', { class: 'card__text', text: '用一组同步码把草稿、行动与复盘在手机和电脑之间同步。无需注册；数据按同步码存在服务端。在另一台设备输入同一同步码，即可加入同一份数据。' }),
  ]);
  const syncStatusEl = el('p', { class: 'field__hint sync-status', id: 'sync-status' });
  const syncCodeEl = el('div', { class: 'sync-code', id: 'sync-code' });
  const syncBody = el('div', { class: 'stack' });

  function renderSyncBody() {
    const m = getSyncMeta();
    const enabled = !!(m && m.syncId && m.enabled);
    syncCodeEl.replaceChildren();
    syncBody.replaceChildren();
    if (!enabled) {
      const genBtn = el('button', { class: 'btn btn--primary', type: 'button', text: '生成同步码并开启同步' });
      genBtn.addEventListener('click', async () => {
        const code = genSyncId();
        toast(`已生成同步码：${code}`, 'success');
        await enableSync(store, code);
        ctx.rerender();
      });
      const input = el('input', {
        type: 'text', inputmode: 'text', maxlength: 16,
        placeholder: '输入已有同步码', class: 'field__input', id: 'sync-input',
      });
      const joinBtn = el('button', { class: 'btn btn--ghost', type: 'button', text: '用已有同步码加入' });
      joinBtn.addEventListener('click', async () => {
        const code = input.value;
        if (!code.trim()) { toast('请先输入同步码', 'error'); return; }
        const r = await enableSync(store, code);
        if (!r.ok && r.error) { toast(r.error, 'error'); return; }
        toast(`已用同步码 ${String(code).toUpperCase()} 同步`, 'success');
        ctx.rerender();
      });
      syncBody.append(
        el('div', { class: 'row row--wrap' }, [genBtn]),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', for: 'sync-input', text: '或输入另一台设备上的同步码' }),
          el('div', { class: 'row' }, [input, joinBtn]),
        ]),
      );
    } else {
      const code = m.syncId;
      syncCodeEl.append(el('code', { class: 'sync-code__value', text: code }));
      const copyBtn = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: '复制' });
      copyBtn.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(code); toast('同步码已复制', 'success'); }
        catch { toast('复制失败，请手动选择', 'error'); }
      });
      const offBtn = el('button', { class: 'btn btn--danger btn--sm', type: 'button', text: '关闭同步' });
      offBtn.addEventListener('click', async () => {
        const ok = await ctx.confirmDialog({
          title: '关闭同步？',
          body: ['本机不再自动同步，云端副本保留。', '你仍可在另一台设备继续同步，或再次开启（输入同一同步码）。'],
          confirmText: '关闭同步', danger: true,
        });
        if (!ok) return;
        disableSync();
        toast('已关闭同步（本地数据保留）', 'success');
        ctx.rerender();
      });
      syncBody.append(
        el('div', { class: 'row row--wrap' }, [copyBtn, offBtn]),
        el('p', { class: 'field__hint', text: '在手机或另一台电脑打开同一网站，进入「设置与数据 → 跨设备同步」，点“用已有同步码加入”并输入上面这串码，两边数据即开始互相同步。' }),
      );
    }
  }
  renderSyncBody();
  syncBox.append(syncStatusEl, syncCodeEl, syncBody);
  onSyncStatus((s) => {
    const map = { disabled: '未开启同步', synced: '已同步', offline: '离线，稍后自动重试', error: '同步出错' };
    let text = map[s.kind] || s.kind;
    if (s.kind === 'synced') {
      const m = getSyncMeta();
      if (m && m.lastSyncAt) text = `已同步 · 最近 ${formatDate(m.lastSyncAt)}`;
    }
    syncStatusEl.textContent = text;
    syncStatusEl.className = 'field__hint sync-status sync-status--' + s.kind;
  });
  root.append(syncBox);

  // 存储说明
  const storageBox = el('section', { class: 'card' }, [
    el('h3', { class: 'card__title', text: '数据存储' }),
    el('p', {
      class: 'card__text',
      text: store.persistent
        ? '默认保存在当前浏览器（localStorage）。若已开启「跨设备同步」，数据会按同步码在服务端留存一份，可在其他设备加入同一份数据；清理浏览器数据前仍建议导出备份。'
        : `当前浏览器不可写入本地存储：${store.persistenceReason}`,
    }),
  ]);
  if (store.lastError) storageBox.append(el('p', { class: 'notice notice--error', text: store.lastError }));
  storageBox.append(el('p', { class: 'field__hint', text: `已保存行动 ${store.state.actions.length} 条${store.state.draft ? '，有一份进行中的草稿' : ''}。` }));
  root.append(storageBox);

  // 备份
  const backupBox = el('section', { class: 'card' }, [
    el('h3', { class: 'card__title', text: '备份与恢复' }),
    el('div', { class: 'row row--wrap' }, [
      el('button', {
        class: 'btn btn--primary', type: 'button',
        onclick: () => {
          const payload = JSON.stringify(buildBackup(store.state), null, 2);
          const blob = new Blob([payload], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const link = el('a', { href: url, download: `道德经练习室备份-${new Date().toISOString().slice(0, 10)}.json`, text: '下载' });
          document.body.append(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          toast('备份文件已导出', 'success');
        },
      }, ['导出 JSON 备份']),
    ]),
  ]);
  const fileInput = el('input', {
    type: 'file', accept: 'application/json,.json', id: 'import-file', class: 'field__input',
  });
  const importResult = el('div', { class: 'stack' });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let parsed = null;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch (error) {
        importResult.replaceChildren(el('p', { class: 'notice notice--error', text: '这不是有效的 JSON 文件，未做任何改动。' }));
        return;
      }
      const check = validateBackup(parsed);
      if (!check.ok) {
        importResult.replaceChildren(el('div', { class: 'stack' }, [
          el('p', { class: 'notice notice--error', text: '备份文件校验未通过，未导入任何数据。' }),
          el('ul', { class: 'bullets' }, check.errors.map((e) => el('li', { text: e }))),
        ]));
        return;
      }
      const count = (check.data.actions || []).length;
      const box = el('div', { class: 'stack' }, [
        el('p', { class: 'notice', text: `校验通过：该文件包含 ${count} 条行动记录${check.data.draft ? '，以及一份草稿' : ''}。请选择导入方式。` }),
        el('div', { class: 'row row--wrap' }, [
          el('button', {
            class: 'btn btn--primary', type: 'button',
            onclick: () => {
              const merged = mergeStates(store.state, check.data);
              const result = store.replaceState(merged.state);
              if (!result.ok) { toast(result.error, 'error'); return; }
              toast(`合并完成：新增 ${merged.stats.added} 条，跳过同 id ${merged.stats.skipped} 条`, 'success');
              ctx.rerender();
            },
          }, ['合并导入（保留现有数据）']),
          el('button', {
            class: 'btn btn--danger', type: 'button',
            onclick: async () => {
              const ok = await ctx.confirmDialog({
                title: '确认覆盖？',
                body: ['覆盖会用备份文件完全替换当前浏览器中的数据，现有草稿与行动记录将被清除，且无法撤销。', '建议先导出当前数据作为备份。'],
                confirmText: '确认覆盖',
                danger: true,
              });
              if (!ok) { toast('已取消，未做任何改动'); return; }
              const result = store.replaceState(check.data);
              if (!result.ok) { toast(result.error, 'error'); return; }
              toast(`覆盖完成：现在有 ${check.data.actions.length} 条记录`, 'success');
              ctx.rerender();
            },
          }, ['覆盖导入（会先确认）']),
        ]),
      ]);
      if (check.warnings && check.warnings.length) {
        box.append(el('ul', { class: 'bullets' }, check.warnings.map((w) => el('li', { text: '提示：' + w }))));
      }
      importResult.replaceChildren(box);
    };
    reader.onerror = () => {
      importResult.replaceChildren(el('p', { class: 'notice notice--error', text: '文件读取失败，未做任何改动。' }));
    };
    reader.readAsText(file);
  });
  backupBox.append(el('div', { class: 'field' }, [
    el('label', { class: 'field__label', for: 'import-file', text: '导入备份文件（.json）' }),
    fileInput,
    el('p', { class: 'field__hint', text: '导入前会校验结构：缺少 app / version / state 字段或字段类型不对时拒绝导入。合并导入不会删除现有数据；覆盖导入会先要求确认。' }),
  ]));
  backupBox.append(importResult);
  root.append(backupBox);

  // 损坏数据
  if (store.corruptedRaw) {
    root.append(el('section', { class: 'card' }, [
      el('h3', { class: 'card__title', text: '损坏的本地数据（未被删除）' }),
      el('p', { class: 'card__text', text: '启动时检测到无法解析的本地数据。为安全起见它没有被清除，你可以先导出原始文本再决定是否重置。' }),
      el('div', { class: 'row' }, [
        el('button', {
          class: 'btn btn--ghost', type: 'button',
          onclick: () => {
            const blob = new Blob([store.corruptedRaw], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const link = el('a', { href: url, download: '损坏数据原文.txt', text: '下载' });
            document.body.append(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          },
        }, ['导出原始文本']),
      ]),
    ]));
  }

  // 重置
  root.append(el('section', { class: 'card' }, [
    el('h3', { class: 'card__title', text: '清空本站数据' }),
    el('p', { class: 'field__hint', text: `数据创建时间：${formatDate(store.state.createdAt) || '未知'}。清空只影响当前浏览器。` }),
    el('button', {
      class: 'btn btn--danger', type: 'button',
      onclick: async () => {
        const ok = await ctx.confirmDialog({
          title: '清空全部数据？',
          body: ['草稿、行动与复盘都会被删除，无法撤销。', '建议先导出备份。'],
          confirmText: '确认清空',
          danger: true,
        });
        if (!ok) { toast('已取消'); return; }
        const result = store.update(() => ({ version: 1, mode: store.state.mode, draft: null, actions: [], createdAt: new Date().toISOString() }));
        if (result.ok) { toast('已清空', 'success'); ctx.rerender(); } else toast(result.error, 'error');
      },
    }, ['清空草稿与全部记录']),
  ]));

  return frag([root]);
}
