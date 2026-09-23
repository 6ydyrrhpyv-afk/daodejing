// 备份导入的结构校验与合并逻辑（浏览器与测试共用）。

import { STATE_VERSION, sanitizeState, defaultState } from './store.mjs';

export function validateBackup(payload) {
  const errors = [];
  const warnings = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, errors: ['备份文件不是一个 JSON 对象'], warnings, data: null };
  }
  if (payload.app !== 'daode-practice-room') {
    errors.push('缺少 app 标识（应为 daode-practice-room），可能不是本站的备份文件');
  }
  if (!Number.isInteger(payload.version)) {
    errors.push('缺少 version 字段');
  } else if (payload.version > STATE_VERSION) {
    errors.push(`备份版本 v${payload.version} 高于本站支持的 v${STATE_VERSION}`);
  }
  if (!payload.state || typeof payload.state !== 'object') {
    errors.push('缺少 state 字段');
  } else {
    if (payload.state.actions && !Array.isArray(payload.state.actions)) errors.push('state.actions 必须是数组');
    if (payload.state.draft && typeof payload.state.draft !== 'object') errors.push('state.draft 必须是对象');
    if (payload.state.mode && !['guide', 'ai'].includes(payload.state.mode)) warnings.push('state.mode 取值异常，将回退为 guide');
  }
  if (errors.length) return { ok: false, errors, warnings, data: null };
  const sanitized = sanitizeState(payload.state);
  return { ok: true, errors, warnings, data: sanitized };
}

export function mergeStates(current, incoming) {
  const base = defaultState();
  const cur = current && typeof current === 'object' ? current : base;
  const inc = incoming && typeof incoming === 'object' ? incoming : base;
  const actions = [...(cur.actions || [])];
  const seen = new Set(actions.map((a) => a.id));
  let added = 0;
  let skipped = 0;
  for (const item of inc.actions || []) {
    if (seen.has(item.id)) { skipped += 1; continue; }
    actions.push(item);
    seen.add(item.id);
    added += 1;
  }
  const draft = cur.draft || inc.draft || null;
  return {
    state: { ...cur, version: STATE_VERSION, mode: cur.mode || 'guide', draft, actions },
    stats: { added, skipped, draftKept: Boolean(cur.draft) },
  };
}

export function buildBackup(state) {
  return {
    app: 'daode-practice-room',
    version: STATE_VERSION,
    exportedAt: new Date().toISOString(),
    note: '本站备份：草稿 / 行动 / 复盘。仅保存在当前浏览器，不跨设备同步。',
    state,
  };
}
