// 分步练习：五步流程（问事 → 明因 → 读典 → 辨意 → 践行）
// 两种模式：
//   - ai：由服务端模型按「场景 + 已确认选择 + 当前步骤目的」动态生成问题与选项（本文件核心改造）
//   - generic：复用原有固定分支材料，明确标注「未使用 AI 分析」，供无 Key / 离线时回退

import { el, frag, toast, debounce, uid, formatDate, icon } from './util.mjs';
import { getBranch, getChapter, getTheme, themeLabel } from './data.mjs';
import { sceneBanner } from './scenes.mjs';
// 练习访问凭证（仅用于"无登录测试入口"的限流鉴权，不是模型密钥）与 API 基址不在仓库中，
// 缺失时前端优雅降级为"AI 不可用 → 通用练习"，不会因加载失败整体崩溃。
let _practiceTokenPromise = null;
function loadPracticeToken() {
  if (_practiceTokenPromise) return _practiceTokenPromise;
  _practiceTokenPromise = import('./practice-config.mjs')
    .then((m) => (m && m.PRACTICE_ACCESS_TOKEN) || '')
    .catch(() => '');
  return _practiceTokenPromise;
}

// API 基址：留空走同源；静态前端跨域部署时（如 GitHub Pages → 自有 Node 后端）需配置。
let _practiceApiBasePromise = null;
function loadApiBase() {
  if (_practiceApiBasePromise) return _practiceApiBasePromise;
  _practiceApiBasePromise = import('./practice-config.mjs')
    .then((m) => (m && m.PRACTICE_API_BASE) || '')
    .catch(() => '');
  return _practiceApiBasePromise;
}
async function apiUrl(path) {
  const base = await loadApiBase();
  if (!base) return path;
  const cleanBase = base.replace(/\/+$/, '');
  return cleanBase + (path.startsWith('/') ? path : '/' + path);
}

const STEPS = [
  { n: 1, label: '问事', hint: '问题与主题' },
  { n: 2, label: '明因', hint: '澄清情境' },
  { n: 3, label: '读典', hint: '原文与借鉴' },
  { n: 4, label: '辨意', hint: '理解辨析' },
  { n: 5, label: '践行', hint: '写下行动' },
];

// —— 服务端 /api/config 缓存（仅用于决定默认模式与提示，不暴露密钥）——
let _practiceConfig = null;
let _practiceConfigPromise = null;
function getPracticeConfig() {
  if (_practiceConfig) return Promise.resolve(_practiceConfig);
  if (_practiceConfigPromise) return _practiceConfigPromise;
  _practiceConfigPromise = apiUrl('/api/config').then((u) => fetch(u)).then((r) => r.json()).then((c) => {
    _practiceConfig = c || {};
    return _practiceConfig;
  }).catch(() => { _practiceConfig = {}; return _practiceConfig; });
  return _practiceConfigPromise;
}

// 调用 /api/practice/next。generation 用于「取消/过期响应忽略」：每次新请求自增，
// 响应回来时若 generation 已变化则丢弃，避免旧响应覆盖新状态。
// 返回 { status, data, meta, cached }；失败时抛出带 code 的 Error。
async function callPractice({ draft, step, extra = {}, signal, generation, onStale }) {
  const body = {
    session_id: draft.sessionId,
    request_id: uid('req'),
    step,
    revision: draft.revision,
    theme: draft.theme || '',
    scene: draft.scene || '',
    selections: draft.selections || [],
    ...extra,
  };
  const headers = { 'Content-Type': 'application/json' };
  const token = await loadPracticeToken();
  if (token) headers['x-practice-token'] = token;
  const apiEndpoint = await apiUrl('/api/practice/next');
  const res = await fetch(apiEndpoint, { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (generation !== undefined && onStale && generation.stale()) { const e = new Error('STALE'); e.code = 'STALE'; throw e; }
  if (res.status === 200) {
    const json = await res.json();
    if (generation !== undefined && onStale && generation.stale()) { const e = new Error('STALE'); e.code = 'STALE'; throw e; }
    return json;
  }
  let payload = null;
  try { payload = await res.json(); } catch {}
  const code = payload && payload.error && payload.error.code ? payload.error.code : `HTTP_${res.status}`;
  const message = payload && payload.error && payload.error.message ? payload.error.message : `请求失败（${res.status}）`;
  const e = new Error(message);
  e.code = code;
  throw e;
}

// 上游变更（改场景 / 改某步选择）后，使该步及之后所有已缓存结果失效。
function invalidateFrom(draft, fromStep) {
  draft.revision = (draft.revision || 0) + 1;
  if (!draft.results) draft.results = {};
  for (let s = fromStep; s <= 5; s += 1) delete draft.results[s];
}

// 把服务端返回写入某步缓存（用于「返回查看不重新调用」）。
function cacheResult(draft, step, data) {
  if (!draft.results) draft.results = {};
  draft.results[step] = data;
}

function humanError(code, message) {
  switch (code) {
    case 'PRACTICE_NOT_CONFIGURED': return '练习服务尚未配置模型（真实模型联调未完成）。你可以改用下方「通用练习（未使用 AI 分析）」。';
    case 'UNAUTHORIZED': return '练习访问凭证无效或未填写。请在「设置」中填入与服务器一致的测试凭证，或改用通用练习。';
    case 'RATE_LIMITED': return '请求过于频繁，已被限流（每用户每分钟最多 6 次、每日最多 30 次）。请稍后重试。';
    case 'UPSTREAM_TIMEOUT': return '模型服务超时（30 秒）。可能是网络或模型繁忙，可重试一次。';
    case 'BAD_MODEL_OUTPUT':
    case 'PAYLOAD_INVALID': return '模型返回内容无法解析，本次未产生结果。可重试一次。';
    case 'INVALID_INPUT': return message || '输入不合法，请检查场景描述（至少 4 字、不超过 1000 字）。';
    case 'STALE': return ''; // 过期响应，不提示
    default: return message || '网络或服务异常，本次未产生结果，可重试。';
  }
}

export function renderPractice(ctx) {
  const { store } = ctx;
  const draft = store.state.draft;
  const root = el('div', { class: 'stack' });

  // 没有草稿：起始选择页（明确区分 AI 模式与通用回退，不偷偷回退固定选项）
  if (!draft) {
    root.append(sceneBanner('practice', {
      kicker: '五步情境练习',
      title: '分步练习',
      desc: '把一句经典落到你明天能做的一件事：问事 → 明因 → 读典 → 辨意 → 践行。',
    }));
    const card = el('section', { class: 'card empty' }, [
      el('p', { class: 'card__text', text: '选择开始方式：' }),
    ]);
    const aiBtn = el('button', { class: 'btn btn--primary', type: 'button', text: '开始 AI 情境练习', onclick: () => startPractice(ctx, 'ai') });
    const genBtn = el('button', { class: 'btn btn--ghost', type: 'button', text: '通用练习（未使用 AI 分析）', onclick: () => startPractice(ctx, 'generic') });
    card.append(el('div', { class: 'row' }, [aiBtn, genBtn]));
    const note = el('p', { class: 'field__hint', text: '正在检查练习服务可用性…' });
    card.append(note);
    root.append(card);
    getPracticeConfig().then((cfg) => {
      if (cfg && cfg.practiceConfigured) {
        note.textContent = 'AI 情境练习已可用：模型会按你的真实场景动态生成每一步的问题与选项。';
      } else {
        note.textContent = '当前服务端未配置练习模型（真实模型联调尚未完成）。AI 练习暂不可用，可先用「通用练习」。';
        aiBtn.disabled = true;
      }
    });
    return frag([root]);
  }

  // 已有草稿：按模式分发
  if (draft.mode === 'ai') return renderAiPractice(ctx, draft);
  return renderGenericPractice(ctx, draft);
}

function startPractice(ctx, mode) {
  const { store } = ctx;
  const draft = {
    mode,
    step: 1,
    revision: 1,
    sessionId: uid('sess'),
    // 通用模式沿用原分支字段；AI 模式用下方字段
    scene: '',
    theme: '',
    sceneSummary: '',
    clarificationAnswers: '',
    selections: [],
    results: {},
    // 通用模式字段（保持原结构，避免破坏旧逻辑）
    question: '',
    branchId: '',
    branchOther: '',
    clarifyNote: '',
    understanding: null,
    action: null,
  };
  const result = store.update((s) => ({ ...s, draft, updatedAt: new Date().toISOString() }));
  if (!result.ok) { toast(result.error, 'error'); return; }
  ctx.rerender();
}

// —— 通用模式（原有固定分支材料，明确标注未使用 AI）——
function renderGenericPractice(ctx, draft) {
  const { store } = ctx;
  const root = el('div', { class: 'stack' });
  root.append(sceneBanner('practice', {
    kicker: '五步情境练习 · 通用',
    title: '分步练习（通用，未使用 AI 分析）',
    desc: '使用本站整理的固定素材。这一步不会调用任何模型，也不会被伪装成 AI 成功。',
  }));
  const saveDraft = (patch, options = {}) => {
    const result = store.update((s) => ({ ...s, draft: { ...s.draft, ...patch, updatedAt: new Date().toISOString() } }));
    if (!result.ok) { toast(result.error, 'error'); return false; }
    if (options.silent !== true && options.toastText) toast(options.toastText, 'success');
    return true;
  };
  const goto = (step) => { if (!saveDraft({ step })) return; ctx.rerender(); };
  root.append(stepper(draft.step, goto));
  if (draft.step === 1) root.append(stepOne(ctx, draft, saveDraft, goto));
  if (draft.step === 2) root.append(stepTwo(ctx, draft, saveDraft, goto));
  if (draft.step === 3) root.append(stepThree(ctx, draft, saveDraft, goto));
  if (draft.step === 4) root.append(stepFour(ctx, draft, saveDraft, goto));
  if (draft.step === 5) root.append(stepFive(ctx, draft, saveDraft, goto));
  root.append(el('p', { class: 'field__hint', text: '每一步都会自动保存草稿；切换页面、刷新或去读原文都不会丢失已填内容。数据仅保存在当前浏览器。' }));
  root.append(el('p', { class: 'notice', text: '当前为通用练习：以上为按固定分支给出的材料，未使用 AI 分析。' }));
  return frag([root]);
}

// —— AI 模式：动态步骤驱动 ——
let _practiceAbort = null;   // 当前进行中的请求，用于取消
let _practiceGen = 0;        // 代际：过期响应忽略
let _practiceBusyStep = 0;   // 正在加载的步骤（防止重复提交/自动重复触发）

function practiceGoto(ctx, draft, step) {
  if (draft.step === step) return;
  const result = ctx.store.update((s) => ({ ...s, draft: { ...s.draft, step, updatedAt: new Date().toISOString() } }));
  if (!result.ok) { toast(result.error, 'error'); return; }
  ctx.rerender();
}

function saveDraftPatch(ctx, draft, patch) {
  const result = ctx.store.update((s) => ({ ...s, draft: { ...s.draft, ...patch, updatedAt: new Date().toISOString() } }));
  if (!result.ok) toast(result.error, 'error');
  return result.ok;
}

// 发起某步的请求；成功写入缓存并重渲染；过期/取消的响应被忽略。
function runPracticeStep(ctx, draft, step) {
  if (_practiceBusyStep === step && _practiceAbort) return; // 已在加载
  _practiceBusyStep = step;
  _practiceGen += 1;
  const myGen = _practiceGen;
  const controller = new AbortController();
  _practiceAbort = controller;
  callPractice({ draft, step, signal: controller.signal, generation: myGen, onStale: { stale: () => myGen !== _practiceGen } })
    .then((json) => {
      if (myGen !== _practiceGen) return; // 过期
      if (json && json.data) cacheResult(draft, step, json.data);
      _practiceBusyStep = 0; _practiceAbort = null;
      ctx.rerender();
    })
    .catch((err) => {
      if (myGen !== _practiceGen) return; // 过期或已取消
      _practiceBusyStep = 0; _practiceAbort = null;
      if (err && err.code === 'STALE') return;
      draft._lastError = { step, code: err && err.code, message: humanError(err && err.code, err && err.message) };
      ctx.rerender();
    });
}

function cancelPractice() {
  _practiceGen += 1; // 让任何在途响应失效
  if (_practiceAbort) _practiceAbort.abort();
  _practiceAbort = null; _practiceBusyStep = 0;
}

// 步骤一：输入场景 → 点击「分析并继续」才请求；展示场景理解，允许纠正。
function renderAiStep1(ctx, draft) {
  const { store } = ctx;
  const wrap = el('section', { class: 'card' }, [
    el('h3', { class: 'card__title', text: '步骤一 · 描述你的真实情境' }),
    el('p', { class: 'card__text', text: '用你自己的话描述正在发生的事。点击「分析并继续」后才会发送；这里输入时不会调用任何模型。' }),
  ]);

  if (draft.sceneSummary) {
    const sum = el('div', { class: 'ref' }, [
      el('p', { class: 'ref__why', text: '场景理解：' + draft.sceneSummary }),
    ]);
    wrap.append(sum);
    wrap.append(el('div', { class: 'row' }, [
      el('button', { class: 'btn btn--primary', type: 'button', onclick: () => { draft.sceneSummary = ''; saveDraftPatch(ctx, draft, { sceneSummary: '' }); ctx.rerender(); } }, ['纠正 / 重新描述']),
      el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => practiceGoto(ctx, draft, 2) }, ['继续 →']),
    ]));
    return wrap;
  }

  const scene = el('textarea', { id: 'p-scene', rows: '5', class: 'field__input', placeholder: '例如：同事总是把额外的工作丢给我，我不想每次都答应，又怕关系变差。' });
  scene.value = draft.scene || '';
  const counter = el('span', { class: 'field__hint', text: `${scene.value.length}/1000` });
  scene.addEventListener('input', () => {
    counter.textContent = `${scene.value.length}/1000`;
    if (scene.value.length <= 1000) saveDraftPatch(ctx, draft, { scene: scene.value });
  });
  wrap.append(el('div', { class: 'field' }, [el('label', { class: 'field__label', for: 'p-scene', text: '你的真实情境（≤1000 字）' }), scene, counter]));

  // 主题倾向（仅用于挑选候选章节，可选）
  const themes = (ctx.data && ctx.data.guidance && ctx.data.guidance.themes) || [];
  const radios = el('div', { class: 'radio-row' });
  for (const t of themes) {
    const input = el('input', { type: 'radio', name: 'p-theme', value: t.id, id: `p-theme-${t.id}` });
    if (draft.theme === t.id) input.checked = true;
    input.addEventListener('change', () => { saveDraftPatch(ctx, draft, { theme: t.id }); });
    radios.append(el('div', { class: 'radio-item' }, [input, el('label', { for: input.id, text: t.name })]));
  }
  if (themes.length) wrap.append(el('fieldset', { class: 'field' }, [el('legend', { class: 'field__label', text: '主题倾向（可选）' }), radios]));

  const status = el('p', { class: 'notice', role: 'status' });
  const analyzeBtn = el('button', { class: 'btn btn--primary', type: 'button', text: '分析并继续' });
  const cancelBtn = el('button', { class: 'btn btn--ghost', type: 'button', text: '取消', disabled: true });
  analyzeBtn.addEventListener('click', () => {
    const text = scene.value.trim();
    if (text.length < 4) { toast('请把情境描述得更具体一些（至少 4 个字）', 'error'); return; }
    if (text.length > 1000) { toast('已超出 1000 字上限，请缩短', 'error'); return; }
    saveDraftPatch(ctx, draft, { scene: text });
    analyzeBtn.disabled = true; cancelBtn.disabled = false;
    status.textContent = '正在理解你的场景…';
    _practiceGen += 1; const myGen = _practiceGen;
    const controller = new AbortController(); _practiceAbort = controller; _practiceBusyStep = 1;
    callPractice({ draft, step: 1, signal: controller.signal, generation: myGen, onStale: { stale: () => myGen !== _practiceGen } })
      .then((json) => {
        if (myGen !== _practiceGen) return;
        _practiceAbort = null; _practiceBusyStep = 0; analyzeBtn.disabled = false; cancelBtn.disabled = true;
        const d = json && json.data;
        if (!d) { status.textContent = '未得到有效结果，请重试。'; return; }
        if (d.status === 'unsupported') {
          status.textContent = '这个请求不太适合用情境练习来处理。你可以改用「通用练习」，或描述一个你在关系 / 工作 / 成长中的真实摩擦。';
          return;
        }
        if (d.status === 'need_clarification') {
          draft._clarify = d.clarification_questions || [];
          draft.sceneSummary = d.scene_summary || '';
          saveDraftPatch(ctx, draft, { _clarify: draft._clarify, sceneSummary: draft.sceneSummary });
          ctx.rerender();
          return;
        }
        // ready
        saveDraftPatch(ctx, draft, { sceneSummary: d.scene_summary || '' });
        ctx.rerender();
      })
      .catch((err) => {
        if (myGen !== _practiceGen) return;
        _practiceAbort = null; _practiceBusyStep = 0; analyzeBtn.disabled = false; cancelBtn.disabled = true;
        if (err && err.code === 'STALE') return;
        status.textContent = humanError(err && err.code, err && err.message) || '请求失败，请重试。';
      });
  });
  cancelBtn.addEventListener('click', () => {
    cancelPractice(); analyzeBtn.disabled = false; cancelBtn.disabled = true; status.textContent = '已取消本次请求，未产生任何回答。';
  });
  wrap.append(el('div', { class: 'row' }, [analyzeBtn, cancelBtn]));
  wrap.append(status);

  // need_clarification：补问后再请求
  if (draft._clarify && draft._clarify.length) {
    const box = el('section', { class: 'card card--ai' }, [el('h4', { class: 'card__label', text: '为了更准确，请补充：' })]);
    draft._clarify.forEach((q) => box.append(el('p', { class: 'card__text', text: '· ' + q })));
    const ans = el('textarea', { id: 'p-clarify', rows: '3', class: 'field__input', placeholder: '你的补充回答' });
    ans.value = draft.clarificationAnswers || '';
    ans.addEventListener('input', () => saveDraftPatch(ctx, draft, { clarificationAnswers: ans.value }));
    box.append(el('div', { class: 'field' }, [el('label', { class: 'field__label', for: 'p-clarify', text: '你的补充' }), ans]));
    const again = el('button', { class: 'btn btn--primary', type: 'button', text: '提交补充并继续' });
    again.addEventListener('click', () => {
      if (!ans.value.trim()) { toast('请填写补充内容', 'error'); return; }
      saveDraftPatch(ctx, draft, { clarificationAnswers: ans.value.trim() });
      again.disabled = true; status.textContent = '正在理解你的场景…';
      _practiceGen += 1; const myGen = _practiceGen;
      const controller = new AbortController(); _practiceAbort = controller; _practiceBusyStep = 1;
      callPractice({ draft, step: 1, extra: { clarification_answers: ans.value.trim() }, signal: controller.signal, generation: myGen, onStale: { stale: () => myGen !== _practiceGen } })
        .then((json) => {
          if (myGen !== _practiceGen) return;
          _practiceAbort = null; _practiceBusyStep = 0; again.disabled = false;
          const d = json && json.data;
          if (d && (d.status === 'ready' || d.status === 'need_clarification')) {
            saveDraftPatch(ctx, draft, { sceneSummary: d.scene_summary || draft.sceneSummary, _clarify: d.status === 'need_clarification' ? (d.clarification_questions || []) : [] });
            ctx.rerender();
          } else if (d && d.status === 'unsupported') {
            status.textContent = '这个请求不太适合用情境练习处理，建议改用通用练习。';
          } else { status.textContent = '未得到有效结果，请重试。'; }
        })
        .catch((err) => {
          if (myGen !== _practiceGen) return;
          _practiceAbort = null; _practiceBusyStep = 0; again.disabled = false;
          if (err && err.code === 'STALE') return;
          status.textContent = humanError(err && err.code, err && err.message) || '请求失败，请重试。';
        });
    });
    box.append(el('div', { class: 'row' }, [again]));
    wrap.append(box);
  }
  return wrap;
}

// 步骤 2-5：渲染当前步（有缓存直接显示；无缓存自动加载）。
function renderAiStepK(ctx, draft, step) {
  const cached = draft.results && draft.results[step];
  const wrap = el('section', { class: 'card' }, [el('h3', { class: 'card__title', text: `步骤 ${step} · ${STEPS[step - 1].label}` })]);
  if (!cached) {
    wrap.append(el('p', { class: 'notice', role: 'status', text: '正在理解你的情境并生成这一步的内容…' }));
    runPracticeStep(ctx, draft, step);
    return wrap;
  }
  const err = draft._lastError && draft._lastError.step === step ? draft._lastError : null;
  if (err) {
    wrap.append(el('p', { class: 'notice notice--error', text: err.message }));
    const retry = el('button', { class: 'btn btn--primary', type: 'button', text: '重试' });
    retry.addEventListener('click', () => { draft._lastError = null; ctx.rerender(); });
    wrap.append(el('div', { class: 'row' }, [retry]));
    return wrap;
  }

  if (step === 5) return renderAiStep5(ctx, draft, cached, wrap);

  // 步骤三：展示服务端校验过的引用（AI 解读与原文分别显示）
  if (step === 3 && cached.references && cached.references.length) {
    wrap.append(el('h4', { class: 'card__label', text: '① 可取的原典（已校验真实原文）' }));
    for (const ref of cached.references) {
      wrap.append(el('div', { class: 'ref' }, [
        el('p', { class: 'ref__text', text: ref.quote }),
        el('p', { class: 'ref__meta', text: `第 ${ref.chapter_number} 章` }),
        ref.relevance ? el('p', { class: 'ref__why', text: '模型联系：' + ref.relevance }) : null,
      ]));
    }
  }

  wrap.append(el('p', { class: 'card__text', text: cached.question || '' }));

  // 选项（含「其他 / 自己填写」）
  const sel = (draft.selections || []).find((s) => s.step === step);
  const optsBox = el('div', { class: 'radio-stack' });
  const name = `ai-opt-${step}`;
  let chosen = null;
  const customArea = el('div', { class: 'sub-box' }, [el('p', { class: 'notice', text: '你也可以写下自己的考虑（不会被判对错，只用于后续生成）。' }) ]);
  const customInput = el('textarea', { id: 'p-custom', rows: '3', class: 'field__input', placeholder: '用自己的话描述你的考虑' });
  customInput.value = sel && sel.option_id === 'custom' ? sel.custom_text : '';
  customArea.append(el('div', { class: 'field' }, [el('label', { class: 'field__label', for: 'p-custom', text: '你的补充' }), customInput]));
  for (const o of cached.options || []) {
    const input = el('input', { type: 'radio', name, value: o.id, id: `${name}-${o.id}` });
    if (sel && sel.option_id === o.id) { input.checked = true; chosen = o; }
    input.addEventListener('change', () => { chosen = o; customArea.style.display = 'none'; });
    optsBox.append(el('div', { class: 'radio-item' }, [input, el('label', { for: input.id }, [el('strong', { text: o.title }), el('span', { class: 'opt-detail', text: o.detail ? '：' + o.detail : '' }) ])]));
  }
  // 其他
  const customRadio = el('input', { type: 'radio', name, value: 'custom', id: `${name}-custom` });
  if (sel && sel.option_id === 'custom') { customRadio.checked = true; customArea.style.display = 'block'; }
  customRadio.addEventListener('change', () => { chosen = { id: 'custom', title: '其他' }; customArea.style.display = 'block'; sceneScroll(); });
  optsBox.append(el('div', { class: 'radio-item' }, [customRadio, el('label', { for: `${name}-custom`, text: '其他 / 自己填写' })]));
  wrap.append(optsBox);
  wrap.append(customArea);
  function sceneScroll() { /* no-op placeholder for focus */ }

  const confirmBtn = el('button', { class: 'btn btn--primary', type: 'button', text: step < 5 ? '确认并继续' : '完成' });
  confirmBtn.addEventListener('click', () => {
    if (!chosen) { toast('请先选择一个方向', 'error'); return; }
    let optionId = chosen.id; let optionLabel = chosen.title; let customText = '';
    if (optionId === 'custom') {
      customText = customInput.value.trim();
      if (!customText) { toast('请填写你的考虑', 'error'); return; }
      optionLabel = '其他';
    }
    const others = (draft.selections || []).filter((s) => s.step !== step);
    others.push({ step, option_id: optionId, option_label: optionLabel, custom_text: customText });
    invalidateFrom(draft, step + 1);
    const ok = saveDraftPatch(ctx, draft, { selections: others, step: step + 1 });
    if (!ok) return;
    runPracticeStep(ctx, draft, step + 1);
  });
  const back = el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => practiceGoto(ctx, draft, step - 1) }, ['返回上一步']);
  wrap.append(el('div', { class: 'row' }, [back, confirmBtn]));
  return wrap;
}

// 步骤五：结合真实选择给出总结 + 用户自行写下行动。
function renderAiStep5(ctx, draft, cached, wrap) {
  const fs = cached.final_summary;
  if (fs) {
    if (fs.summary) wrap.append(el('div', { class: 'ref' }, [el('p', { class: 'card__label', text: '结合你的选择的总结' }), el('p', { class: 'card__text', text: fs.summary })]));
    if (fs.action) wrap.append(el('div', { class: 'ref' }, [el('p', { class: 'card__label', text: '一个可尝试的小行动' }), el('p', { class: 'card__text', text: fs.action })]));
    if (fs.reflection) wrap.append(el('div', { class: 'ref' }, [el('p', { class: 'card__label', text: '一个复盘问题' }), el('p', { class: 'card__text', text: fs.reflection })]));
    wrap.append(el('p', { class: 'field__hint', text: '以上由模型依据你的真实选择生成，不是标准答案，也不代表老子本人的判断。' }));
  }
  // 用户写入自己的行动并保存到行动清单
  const text = el('textarea', { id: 'p-action', rows: '3', class: 'field__input', placeholder: '写下你准备做的一件具体的事' });
  const when = el('textarea', { id: 'p-when', rows: '2', class: 'field__input', placeholder: '例如：明天上午开工前 10 分钟' });
  const observe = el('textarea', { id: 'p-observe', rows: '2', class: 'field__input', placeholder: '例如：他会不会主动说出自己的第一步' });
  text.value = draft.action?.text || ''; when.value = draft.action?.when || ''; observe.value = draft.action?.observe || '';
  const sync = () => saveDraftPatch(ctx, draft, { action: { text: text.value, when: when.value, observe: observe.value } });
  for (const node of [text, when, observe]) node.addEventListener('input', sync);
  wrap.append(el('div', { class: 'field' }, [el('label', { class: 'field__label', for: 'p-action', text: '你要做的行动' }), text]));
  wrap.append(el('div', { class: 'field' }, [el('label', { class: 'field__label', for: 'p-when', text: '实施时间或触发情境' }), when]));
  wrap.append(el('div', { class: 'field' }, [el('label', { class: 'field__label', for: 'p-observe', text: '预期观察到的现象' }), observe]));
  const saveBtn = el('button', { class: 'btn btn--primary', type: 'button', text: '保存到行动清单' });
  saveBtn.addEventListener('click', () => {
    const actionText = text.value.trim();
    if (actionText.length < 4) { toast('请把行动写得具体一些（至少 4 个字）', 'error'); return; }
    const now = new Date().toISOString();
    const record = {
      id: uid('act'), createdAt: now, updatedAt: now,
      question: draft.scene, theme: draft.theme, branchId: '',
      chapterRefs: (cached.references || []).map((r) => ({ chapter_id: r.chapter_id, quote: r.quote })),
      text: actionText, when: when.value.trim(), observe: observe.value.trim(), status: 'todo', doneAt: '',
      practice: { actual: '', diff: '', reason: '', next: '', reviewedAt: '' },
    };
    const result = ctx.store.update((s) => ({ ...s, actions: [record, ...s.actions], draft: { ...s.draft, action: { text: actionText, when: when.value.trim(), observe: observe.value.trim() }, updatedAt: now } }));
    if (!result.ok) { toast(result.error, 'error'); return; }
    toast('已保存到行动清单（状态：待实践）', 'success');
    ctx.navigate('#/actions');
  });
  wrap.append(el('div', { class: 'row' }, [
    el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => practiceGoto(ctx, draft, 4) }, ['返回上一步']),
    saveBtn,
  ]));
  return wrap;
}

function renderAiPractice(ctx, draft) {
  const root = el('div', { class: 'stack' });
  root.append(sceneBanner('practice', {
    kicker: '五步情境练习 · AI',
    title: '分步练习（AI 情境驱动）',
    desc: '由模型按你的真实场景动态生成每一步的问题与选项；问题只发送给你在服务端配置的模型，密钥只在服务端。',
  }));
  root.append(stepper(draft.step, (s) => practiceGoto(ctx, draft, s)));
  if (draft.step === 1) root.append(renderAiStep1(ctx, draft));
  else root.append(renderAiStepK(ctx, draft, draft.step));
  root.append(el('p', { class: 'field__hint', text: '每一步自动保存草稿；返回上一步查看不会重新调用模型，但修改上游场景或选择会使后续结果失效并重新生成。数据仅保存在当前浏览器。' }));
  root.append(el('p', { class: 'notice', text: '当前为 AI 练习：问题与选项由模型依据你的真实输入生成，不是固定题库。模型结果不构成医疗、法律或财务建议。' }));
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
