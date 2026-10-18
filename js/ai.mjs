// 纯前端 AI 客户端：多供应商、自填 Key、流式输出。
//
// 安全铁律：API Key 只存在「用户自己的浏览器」localStorage 里，从不写进仓库、
// 也不经过任何服务端。GitHub Pages 是公开仓库，硬编码 Key 会被脚本扫走刷爆额度。
//
// 方案 C（默认）：硅基流动免费模型（9B 以下永久免费，约 1000 RPM / 50K TPM）。
// 方案 A（一键切换）：DeepSeek 官方，按量付费（约 ¥2–10/月，个人用量）。
// 两家的 /v1/chat/completions 都兼容 OpenAI 格式，只是 baseUrl 与模型名不同。

const STORAGE_KEY = 'ddj-ai/v1';

// —— 游客免 Key 试聊（Cloudflare Worker 代理）——
// 部署方式见仓库 cloudflare/worker.js 与 wrangler.toml。本站把模型 Key 放在 Cloudflare 服务端，
// 游客无需填 Key 即可调用硅基流动免费模型；前端仅持有「公开但不保密」的 GUEST_SECRET 作为滥用防护。
// 部署 Worker 后，把下面 GUEST_WORKER_URL 改成你的 https://<子域>.workers.dev 地址（不含路径）。
const GUEST_WORKER_URL = 'https://ddj-guest.<你的workers子域>.workers.dev';
const GUEST_SECRET = 'ddj_trial_8f3a2c1b';
// 游客可选项（须与 Worker 端 GUEST_MODELS 白名单保持一致）
const GUEST_MODELS = [
  { id: 'THUDM/glm-4-9b-chat', label: 'GLM-4-9B（中文对话，推荐）' },
  { id: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B', label: 'DeepSeek-R1-Distill-Qwen-7B（推理）' },
  { id: 'Qwen/Qwen3-8B', label: 'Qwen3-8B（日常）' },
];

export const PROVIDERS = {
  siliconflow: {
    id: 'siliconflow',
    name: '硅基流动 · 免费模型',
    baseUrl: 'https://api.siliconflow.cn/v1',
    docsUrl: 'https://cloud.siliconflow.cn',
    keyHint: '在 cloud.siliconflow.cn 用手机号注册（实名后送 2000 万 token），进入「API 密钥」页创建。',
    models: [
      { id: 'THUDM/glm-4-9b-chat', label: 'GLM-4-9B（中文对话，推荐）' },
      { id: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B', label: 'DeepSeek-R1-Distill-Qwen-7B（推理·131K）' },
      { id: 'deepseek-ai/DeepSeek-R1-0528-Qwen3-8B', label: 'DeepSeek-R1-0528-Qwen3-8B（推理）' },
      { id: 'Qwen/Qwen3-8B', label: 'Qwen3-8B（日常）' },
    ],
    defaultModel: 'THUDM/glm-4-9b-chat',
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek · 官方（按量付费）',
    baseUrl: 'https://api.deepseek.com/v1',
    docsUrl: 'https://platform.deepseek.com',
    keyHint: '在 platform.deepseek.com 注册充值，进入「API keys」页创建。个人用量约 ¥2–10/月。',
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek-V3（deepseek-chat，推荐）' },
      { id: 'deepseek-reasoner', label: 'DeepSeek-R1（deepseek-reasoner，推理）' },
    ],
    defaultModel: 'deepseek-chat',
  },
  guest: {
    id: 'guest',
    name: '游客免 Key 试聊（站点代付·限免费模型）',
    baseUrl: GUEST_WORKER_URL,
    guest: true,
    needsKey: false,
    models: GUEST_MODELS,
    defaultModel: 'THUDM/glm-4-9b-chat',
    note: '由本站 Cloudflare Worker 代付少量免费额度，仅开放硅基流动免费模型，有速率限制，请勿滥用。',
  },
};

const DEFAULTS = {
  provider: 'siliconflow',
  apiKey: '',
  model: PROVIDERS.siliconflow.defaultModel,
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    const provider = PROVIDERS[parsed.provider] ? parsed.provider : 'siliconflow';
    const model = PROVIDERS[provider].models.some((m) => m.id === parsed.model)
      ? parsed.model
      : PROVIDERS[provider].defaultModel;
    return {
      provider,
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : '',
      model,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  if (!PROVIDERS[next.provider]) next.provider = 'siliconflow';
  if (!PROVIDERS[next.provider].models.some((m) => m.id === next.model)) {
    next.model = PROVIDERS[next.provider].defaultModel;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (error) {
    throw new Error('保存 AI 设置失败：' + (error && error.message ? error.message : error));
  }
  return next;
}

export function hasKey() {
  return !!loadSettings().apiKey;
}

// 是否可发起对话：已填 Key，或处于游客（guest）模式。
export function canChat() {
  const s = loadSettings();
  if (s.provider === 'guest') return true;
  return !!s.apiKey;
}

// 组装系统提示词（含可选章节上下文，做"有据可依"的接地解读，降低编造）。
export function buildSystemPrompt(chapter) {
  const base = [
    '你是《道德经》的阅读与处事辅助助手，服务于一个叫「道德经·处事练习室」的站点。请遵循：',
    '1. 紧扣用户选定的章节原文与本站释义作答，引用尽量用原文原句，不要杜撰章句或张冠李戴。',
    '2. 帮助用户把经典智慧落到现实的工作、协作、成长情境中，给出具体、可操作的理解，而非空泛口号。',
    '3. 不扮演老子、不给人生/投资/医疗等具体决策下绝对结论；把判断权留给读者。',
    '4. 用简体中文、平实清晰的语言。若问到原文没有的内容，坦诚说明边界。',
  ];
  if (chapter) {
    const parts = ['', '【当前章节上下文（优先依据此内容作答）】'];
    parts.push(`章号：第 ${chapter.chapter_number} 章`);
    if (chapter.title_hint) parts.push(`章名：${chapter.title_hint}`);
    if (chapter.original_text) parts.push(`原文：${chapter.original_text}`);
    if (chapter.plain_explanation) parts.push(`本站释义：${chapter.plain_explanation}`);
    if (chapter.application_boundary) parts.push(`应用边界：${chapter.application_boundary}`);
    return base.concat(parts).join('\n');
  }
  base.push('5. 若未提供章节上下文，可基于《道德经》通行理解泛泛而谈，并提示以原文为准。');
  return base.join('\n');
}

// 流式对话。返回 { abort } 供调用方中断。
// onDelta(text)、onDone({aborted?})、onError(Error)。
export function streamChat({ messages, onDelta, onDone, onError, signal }) {
  const settings = loadSettings();
  const provider = PROVIDERS[settings.provider];
  const isGuest = !!(provider && provider.guest);

  if (!settings.apiKey && !isGuest) {
    onError && onError(new Error('尚未配置 API Key。请在页面上方「设置」里填入你自己的 Key，或点「游客免 Key 试聊」。'));
    return { abort() {} };
  }
  if (isGuest) {
    if (!/^https:\/\//.test(GUEST_WORKER_URL) || GUEST_WORKER_URL.includes('你的workers子域')) {
      onError && onError(new Error('游客通道尚未在后台部署（站点管理员需配置 Cloudflare Worker）。你现在可以填入自己的 Key 免费使用。'));
      return { abort() {} };
    }
  }

  const url = provider.baseUrl + '/chat/completions';
  const headers = { 'Content-Type': 'application/json' };
  if (isGuest) headers['x-ddj-guest'] = GUEST_SECRET;
  else headers['Authorization'] = 'Bearer ' + settings.apiKey;

  const body = JSON.stringify({
    model: settings.model,
    messages,
    stream: true,
    temperature: 0.7,
    max_tokens: isGuest ? 800 : 1200,
  });

  const controller = new AbortController();
  const acSignal = signal || controller.signal;

  (async () => {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: acSignal,
        mode: 'cors',
      });

      if (!res.ok) {
        let detail = '';
        try {
          const j = await res.json();
          detail = (j.error && j.error.message) || j.message || '';
        } catch { /* 忽略解析失败 */ }
        if (res.status === 401) {
          onError && onError(new Error(isGuest
            ? '游客通道鉴权失败（站点管理员配置不一致）。请稍后重试，或填入你自己的 Key。'
            : 'API Key 无效或未授权（HTTP 401）。请到对应平台核对后重试。'));
        } else if (res.status === 429) {
          onError && onError(new Error(isGuest
            ? '游客试用过于频繁（HTTP 429）。请稍后再试，或填入你自己的 Key 免受限流。'
            : '触发限流（HTTP 429）。免费模型约 1000 次/分钟、5 万 token/分钟，请稍后再试。'));
        } else if (res.status === 402 || res.status === 403) {
          onError && onError(new Error(`账户额度/权限不足（HTTP ${res.status}）。${detail}`));
        } else {
          onError && onError(new Error(`请求失败（HTTP ${res.status}）。${detail}`));
        }
        return;
      }

      if (!res.body || !res.body.getReader) {
        onError && onError(new Error('当前浏览器不支持流式读取（缺少 ReadableStream）。'));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let finished = false;

      const flushLine = (line) => {
        const t = line.trim();
        if (!t || !t.startsWith('data:')) return;
        const data = t.slice(5).trim();
        if (data === '[DONE]') { finished = true; return; }
        try {
          const json = JSON.parse(data);
          const delta =
            (json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content) ||
            (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) ||
            '';
          if (delta) onDelta && onDelta(delta);
        } catch { /* 跳过无法解析的分片 */ }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          flushLine(buffer.slice(0, nl));
          buffer = buffer.slice(nl + 1);
          if (finished) break;
        }
        if (finished) break;
      }
      // 处理末尾残留
      if (buffer.trim()) flushLine(buffer);
      onDone && onDone({ aborted: false });
    } catch (err) {
      if (acSignal.aborted || (err && err.name === 'AbortError')) {
        onDone && onDone({ aborted: true });
        return;
      }
      onError && onError(new Error(describeNetworkError(err)));
    }
  })();

  return { abort: () => controller.abort() };
}

function describeNetworkError(err) {
  const msg = (err && err.message) || String(err);
  if (err && err.name === 'TypeError' && /Failed to fetch|NetworkError|Network request failed/i.test(msg)) {
    return '网络或跨域（CORS）被拦截：' + msg +
      '。若使用硅基流动仍失败，可在「设置」里切到 DeepSeek（已确认支持浏览器直连）；也请检查网络或代理。';
  }
  return msg;
}
