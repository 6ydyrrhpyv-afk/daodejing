// 本地存储层：草稿、行动、复盘全部保存在当前浏览器。
// 读取失败 / 存储被禁用 / 容量不足时如实返回错误，绝不把失败报成成功。

export const STORAGE_KEY = 'ddj-practice-room/v1';
export const STATE_VERSION = 1;

export function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    get length() { return map.size; },
  };
}

export function detectStorage() {
  try {
    const ls = globalThis.localStorage;
    if (!ls) throw new Error('no localStorage');
    const probe = '__ddj_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return { storage: ls, persistent: true, reason: '' };
  } catch (error) {
    return {
      storage: createMemoryStorage(),
      persistent: false,
      reason: '浏览器禁用了本地存储（可能是隐私模式或站点设置），本会话可正常使用，但关闭页面后数据不会保留。',
    };
  }
}

export function defaultState() {
  return {
    version: STATE_VERSION,
    mode: 'guide', // guide = 引导练习, ai = AI 辅助
    readingMode: 'standard', // standard = 标准排版, atmospheric = 意境排版
    draft: null,
    actions: [],
    createdAt: new Date().toISOString(),
    syncedAt: '', // 同步时间戳（跨设备合并标量字段时取较新一侧）
  };
}

function sanitizeDraft(draft) {
  if (!draft || typeof draft !== 'object') return null;
  const understanding = draft.understanding && typeof draft.understanding === 'object' ? draft.understanding : {};
  const action = draft.action && typeof draft.action === 'object' ? draft.action : {};
  return {
    theme: typeof draft.theme === 'string' ? draft.theme : '',
    question: typeof draft.question === 'string' ? draft.question : '',
    step: Number.isInteger(draft.step) ? Math.min(5, Math.max(1, draft.step)) : 1,
    branchId: typeof draft.branchId === 'string' ? draft.branchId : '',
    branchOther: typeof draft.branchOther === 'string' ? draft.branchOther : '',
    clarifyNote: typeof draft.clarifyNote === 'string' ? draft.clarifyNote : '',
    understanding: {
      choice: typeof understanding.choice === 'string' ? understanding.choice : '',
      text: typeof understanding.text === 'string' ? understanding.text : '',
      answeredAt: typeof understanding.answeredAt === 'string' ? understanding.answeredAt : '',
    },
    action: {
      text: typeof action.text === 'string' ? action.text : '',
      when: typeof action.when === 'string' ? action.when : '',
      observe: typeof action.observe === 'string' ? action.observe : '',
    },
    updatedAt: typeof draft.updatedAt === 'string' ? draft.updatedAt : '',
  };
}

function sanitizeAction(action) {
  if (!action || typeof action !== 'object') return null;
  if (typeof action.text !== 'string' || !action.text.trim()) return null;
  const status = ['todo', 'doing', 'reviewed'].includes(action.status) ? action.status : 'todo';
  const practice = action.practice && typeof action.practice === 'object' ? action.practice : {};
  return {
    id: typeof action.id === 'string' && action.id ? action.id : `act-${Math.random().toString(36).slice(2, 10)}`,
    createdAt: typeof action.createdAt === 'string' ? action.createdAt : new Date().toISOString(),
    updatedAt: typeof action.updatedAt === 'string' ? action.updatedAt : new Date().toISOString(),
    question: typeof action.question === 'string' ? action.question : '',
    theme: typeof action.theme === 'string' ? action.theme : '',
    branchId: typeof action.branchId === 'string' ? action.branchId : '',
    chapterRefs: Array.isArray(action.chapterRefs)
      ? action.chapterRefs.filter((r) => r && typeof r.chapter_id === 'string').map((r) => ({ chapter_id: r.chapter_id, quote: typeof r.quote === 'string' ? r.quote : '' }))
      : [],
    text: action.text,
    when: typeof action.when === 'string' ? action.when : '',
    observe: typeof action.observe === 'string' ? action.observe : '',
    status,
    doneAt: typeof action.doneAt === 'string' ? action.doneAt : '',
    practice: {
      actual: typeof practice.actual === 'string' ? practice.actual : '',
      diff: typeof practice.diff === 'string' ? practice.diff : '',
      reason: typeof practice.reason === 'string' ? practice.reason : '',
      next: typeof practice.next === 'string' ? practice.next : '',
      reviewedAt: typeof practice.reviewedAt === 'string' ? practice.reviewedAt : '',
    },
  };
}

export function sanitizeState(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;
  return {
    version: STATE_VERSION,
    mode: raw.mode === 'ai' ? 'ai' : 'guide',
    readingMode: raw.readingMode === 'atmospheric' ? 'atmospheric' : 'standard',
    draft: sanitizeDraft(raw.draft),
    actions: Array.isArray(raw.actions) ? raw.actions.map(sanitizeAction).filter(Boolean) : [],
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : base.createdAt,
    syncedAt: typeof raw.syncedAt === 'string' ? raw.syncedAt : '',
  };
}

export class Store {
  constructor(options = {}) {
    const detected = options.storage ? { storage: options.storage, persistent: true, reason: '' } : detectStorage();
    this.storage = detected.storage;
    this.persistent = detected.persistent;
    this.persistenceReason = detected.reason;
    this.lastError = '';
    this.corruptedRaw = '';
    this.listeners = new Set();
    this.state = defaultState();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this.state);
  }

  // 读取。损坏时保留原始字符串，不做静默清空。
  load() {
    let raw;
    try {
      raw = this.storage.getItem(STORAGE_KEY);
    } catch (error) {
      this.lastError = '读取本地数据失败：' + describeError(error);
      return { ok: false, error: this.lastError };
    }
    if (!raw) {
      this.state = defaultState();
      return { ok: true, fresh: true };
    }
    try {
      const parsed = JSON.parse(raw);
      this.state = sanitizeState(parsed);
      return { ok: true };
    } catch (error) {
      this.corruptedRaw = raw;
      this.state = defaultState();
      this.lastError = '本地数据格式已损坏，无法解析。原有数据未被删除，可在「设置」中导出原始文本后再重置。';
      return { ok: false, error: this.lastError, corrupted: true };
    }
  }

  // 写入。失败必须返回 ok:false，调用方据此给出真实反馈。
  save() {
    const payload = JSON.stringify(this.state);
    try {
      this.storage.setItem(STORAGE_KEY, payload);
      this.lastError = '';
      return { ok: true };
    } catch (error) {
      this.lastError = '保存失败：' + describeError(error);
      return { ok: false, error: this.lastError };
    }
  }

  // 改状态 + 落盘；返回落盘结果，成功与否由调用方决定提示文案。
  update(mutator) {
    const next = mutator(this.state);
    if (next !== undefined) this.state = next;
    const result = this.save();
    this.emit();
    return result;
  }

  replaceState(next) {
    this.state = sanitizeState(next);
    const result = this.save();
    this.emit();
    return result;
  }
}

export function describeError(error) {
  if (!error) return '未知错误';
  const name = error.name || '';
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || error.code === 22) {
    return '浏览器存储空间不足或被限制（数据未写入）';
  }
  if (name === 'SecurityError') return '浏览器拒绝访问本地存储（数据未写入）';
  return error.message ? String(error.message) : String(error);
}
