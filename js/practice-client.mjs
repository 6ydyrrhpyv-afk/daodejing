// Public deployment location only. No provider key or shared bearer secret in browser.
let access = null;
let pending = null;
export async function practiceUrl(path) {
  const config = await import('./practice-config.mjs').catch(() => ({}));
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  return (local ? '' : (config.PRACTICE_API_BASE || '')).replace(/\/+$/, '') + path;
}
export async function practiceToken(forceRefresh = false) {
  if (forceRefresh) access = null;
  if (access && access.expires > Date.now() + 10000) return access.token;
  if (!pending) pending = (async () => {
    const res = await fetch(await practiceUrl('/api/practice/session'), { method: 'POST', signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    if (!res.ok || !data.token) { const e = new Error(data.error?.message || '练习服务暂不可用'); e.code = data.error?.code; throw e; }
    access = data; return data.token;
  })().finally(() => { pending = null; });
  return pending;
}
