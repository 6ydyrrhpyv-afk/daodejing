// 跨设备同步：匿名同步码 + 服务端 JSON 存储。
// 设计：服务端只做“按同步码存最新合并结果”的傻存储；合并逻辑在客户端。
// - 每章（设备）本地数据仍在 localStorage，先 pull 合并远端，再在本地改动时防抖 push。
// - 合并规则：行动按 id 取并集，同 id 取 updatedAt 较新者；草稿取非空的较新者；
//   模式/阅读模式等标量取 syncedAt 较新一侧（syncedAt 由本模块在 push 时写入 state）。

const SYNC_KEY = 'ddj-sync/v1';
const PUSH_DEBOUNCE_MS = 800;
const SYNC_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混 0/O/1/I/L

let statusListeners = new Set();
let lastStatus = { kind: 'disabled', at: '', message: '' };
let subscribed = false;
let pushTimer = null;
let pushing = false;

function emitStatus(kind, message = '') {
  lastStatus = { kind, at: new Date().toISOString(), message };
  for (const fn of statusListeners) {
    try { fn(lastStatus); } catch {}
  }
}

export function onSyncStatus(fn) {
  statusListeners.add(fn);
  fn(lastStatus);
  return () => statusListeners.delete(fn);
}

export function getSyncStatus() { return lastStatus; }

function loadMeta() {
  try {
    const raw = globalThis.localStorage && globalThis.localStorage.getItem(SYNC_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveMeta(meta) {
  try {
    if (globalThis.localStorage) globalThis.localStorage.setItem(SYNC_KEY, JSON.stringify(meta));
  } catch {}
}

export function getSyncMeta() { return loadMeta(); }

export function isSyncEnabled() {
  const m = loadMeta();
  return !!(m && m.syncId && m.enabled);
}

export function genSyncId() {
  const bytes = new Uint8Array(8);
  if (globalThis.crypto && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 8; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let s = '';
  for (let i = 0; i < 8; i++) s += SYNC_ALPHABET[bytes[i] % SYNC_ALPHABET.length];
  return s;
}

export function normalizeSyncId(input) {
  return String(input || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function mergeState(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  const localAt = local.syncedAt ? Date.parse(local.syncedAt) || 0 : 0;
  const remoteAt = remote.syncedAt ? Date.parse(remote.syncedAt) || 0 : 0;
  const newer = localAt >= remoteAt ? local : remote;

  const byId = new Map();
  for (const a of (local.actions || [])) if (a && a.id) byId.set(a.id, a);
  for (const a of (remote.actions || [])) {
    if (!a || !a.id) continue;
    const existing = byId.get(a.id);
    if (!existing) byId.set(a.id, a);
    else byId.set(a.id, (Date.parse(a.updatedAt || 0) >= Date.parse(existing.updatedAt || 0)) ? a : existing);
  }

  const dLocal = local.draft;
  const dRemote = remote.draft;
  let draft = null;
  if (dLocal && dRemote) draft = (Date.parse(dLocal.updatedAt || 0) >= Date.parse(dRemote.updatedAt || 0)) ? dLocal : dRemote;
  else draft = dLocal || dRemote;

  return {
    version: 1,
    mode: newer.mode === 'ai' ? 'ai' : 'guide',
    readingMode: newer.readingMode === 'atmospheric' ? 'atmospheric' : 'standard',
    draft,
    actions: [...byId.values()],
    createdAt: (local.createdAt && remote.createdAt)
      ? (local.createdAt < remote.createdAt ? local.createdAt : remote.createdAt)
      : (local.createdAt || remote.createdAt),
    syncedAt: new Date().toISOString(),
  };
}

function schedulePush(store) {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { doPush(store); }, PUSH_DEBOUNCE_MS);
}

async function doPush(store) {
  const meta = loadMeta();
  if (!meta || !meta.syncId || !meta.enabled) return;
  if (pushing) { schedulePush(store); return; }
  pushing = true;
  try {
    const state = { ...store.state, syncedAt: new Date().toISOString() };
    const res = await fetch('/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ syncId: meta.syncId, state, rev: meta.rev || 0 }),
    });
    const json = await res.json().catch(() => ({}));
    if (json.ok) {
      meta.rev = json.rev;
      meta.lastSyncAt = json.updatedAt;
      meta.lastError = '';
      saveMeta(meta);
      emitStatus('synced');
    } else {
      meta.lastError = (json.error && json.error.message) || '同步失败';
      saveMeta(meta);
      emitStatus('error', meta.lastError);
    }
  } catch {
    meta.lastError = '网络错误，稍后自动重试';
    saveMeta(meta);
    emitStatus('offline', meta.lastError);
  } finally {
    pushing = false;
  }
}

async function pull(store) {
  const meta = loadMeta();
  if (!meta || !meta.syncId || !meta.enabled) return { ok: false, reason: 'disabled' };
  try {
    const res = await fetch('/api/sync/pull?syncId=' + encodeURIComponent(meta.syncId));
    const json = await res.json().catch(() => ({}));
    if (!json.ok) { emitStatus('error', (json.error && json.error.message) || '拉取失败'); return { ok: false, error: json.error }; }
    if (!json.found) {
      meta.rev = 0;
      meta.lastSyncAt = '';
      meta.lastError = '';
      saveMeta(meta);
      emitStatus('synced');
      return { ok: true, found: false };
    }
    const merged = mergeState(store.state, json.state);
    const result = store.replaceState(merged);
    if (!result.ok) { emitStatus('error', result.error || '合并失败'); return { ok: false, error: result.error }; }
    meta.rev = json.rev;
    meta.lastSyncAt = json.updatedAt;
    meta.lastError = '';
    saveMeta(meta);
    emitStatus('synced');
    return { ok: true, found: true };
  } catch (error) {
    meta.lastError = '网络错误，稍后自动重试';
    saveMeta(meta);
    emitStatus('offline', meta.lastError);
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }
}

function attachAutoPush(store) {
  if (subscribed) return;
  subscribed = true;
  store.subscribe(() => schedulePush(store));
  globalThis.addEventListener('online', () => schedulePush(store));
  globalThis.addEventListener('beforeunload', () => { if (pushTimer) doPush(store); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') schedulePush(store);
  });
}

// 启动同步：启用时先 pull 合并远端，再订阅本地改动做防抖推送。boot 时调用。
export async function initSync(store) {
  const meta = loadMeta();
  if (!meta || !meta.syncId || !meta.enabled) { emitStatus('disabled'); return { ok: false, reason: 'disabled' }; }
  attachAutoPush(store);
  const r = await pull(store);
  return r;
}

// 设置页“生成同步码 / 输入同步码”后调用：写入 meta、pull 合并、订阅推送、立即 push 一次。
export async function enableSync(store, syncId) {
  const id = normalizeSyncId(syncId);
  if (!/^[A-Z0-9]{6,16}$/.test(id)) return { ok: false, error: '同步码格式不合法（6-16 位字母数字）' };
  saveMeta({ syncId: id, enabled: true, rev: 0, lastSyncAt: '', lastError: '' });
  attachAutoPush(store);
  const r = await pull(store);
  await doPush(store);
  return r;
}

export function disableSync() {
  const meta = loadMeta() || {};
  meta.enabled = false;
  saveMeta(meta);
  emitStatus('disabled');
  return meta;
}
