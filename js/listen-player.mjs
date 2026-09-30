// 听书播放器（全站单例）：基于浏览器 Web Speech API（SpeechSynthesis）。
// 设计要点：
//  - 全站共用一个播放器实例与一条语音队列，绝不多个组件各自创建并发朗读。
//  - 语音列表异步加载，优先中文声音；多中文声音可试听/选择并记住，设备无原声时回退。
//  - 无中文声音或不支持时明确提示，绝不假装正在播放。
//  - 文本按合理标点切句，逐句用真实播放事件（utterance.onstart）高亮，不用固定计时器猜测进度。
//  - 任务令牌（taskId）确保快速切换章节/模式/语速时取消旧任务、忽略旧事件，不叠音、不串章。
//  - 进度（章节/模式/句序/语速/音色/连续）仅存当前设备，刷新后提供「继续上次收听」，由用户点击恢复，不自动出声。
//  - 播放器出现/收起/尺寸变化时，设置 --listen-player-h 并派发 listen:playerchange，供道家宇宙重新计算图谱安全区。

import { el, splitLines } from './util.mjs';

const STORAGE_KEY = 'ddj-practice-room/listen/v1';
const SPEEDS = [0.75, 1, 1.25, 1.5];
const SUPPORTED = (typeof window !== 'undefined') && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

// ---------- 单例状态 ----------
const player = {
  root: null, els: {},
  store: null, data: null, navigate: null,
  // 会话：一次连续朗读的上下文
  session: null,           // { chapterId, mode, segs:[{text,lang}], origLen, segIndex }
  playState: 'idle',       // idle | playing | paused | error
  speed: 1,
  continuous: false,
  voiceURI: null,          // 用户记住的中文声音（优先）
  taskId: 0,
  follow: true,
  programmaticScroll: false,
  saved: null,             // 上次收听进度
  pendingUtterance: null,
};

// ---------- 句子切分 ----------
// 与正文渲染保持一致：先按「行」（中文用 splitLines，英文按换行）分组，
// 再在每行内按合理标点拆成句段。这样 DOM 高亮下标与引擎朗读下标严格对齐。
export function splitLineSentences(line, lang) {
  if (!line || !line.trim()) return [];
  const re = lang === 'en' ? /(?<=[.!?])/ : /(?<=[。！？；，])/;
  const parts = String(line).split(re).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : [String(line).trim()];
}
export function segmentChapter(text, lang) {
  if (!text || !text.trim()) return [];
  const lines = lang === 'en'
    ? String(text).split(/\n+/).map((s) => s.trim()).filter(Boolean)
    : splitLines(String(text));
  const out = [];
  for (const line of lines) out.push(...splitLineSentences(line, lang));
  return out.length ? out : [String(text).trim()];
}

function getChapterById(id) {
  if (!player.data) return null;
  return player.data.chapters.find((c) => c.chapter_id === id) || null;
}
function chapterTitle(ch) {
  return ch ? `第 ${ch.chapter_number} 章 · ${ch.title_hint}` : '';
}
function modeLabel(m) {
  return m === 'english' ? '译文' : m === 'both' ? '先原文再译文' : '原文';
}

// ---------- 进度存储 ----------
function loadSaved() {
  try {
    const raw = (player.store && player.store.storage) ? player.store.storage.getItem(STORAGE_KEY) : null;
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || typeof p.chapterId !== 'string') return null;
    return p;
  } catch { return null; }
}
function saveProgress() {
  if (!player.session) return;
  const payload = {
    chapterId: player.session.chapterId,
    mode: player.session.mode,
    sentence: player.session.segIndex,
    speed: player.speed,
    voiceURI: player.voiceURI,
    continuous: player.continuous,
    updatedAt: new Date().toISOString(),
  };
  try {
    if (player.store && player.store.storage) player.store.storage.setItem(STORAGE_KEY, JSON.stringify(payload));
    player.saved = payload;
  } catch (e) { /* 存储失败时静默：听书进度非关键数据 */ }
}
function clearSaved() {
  try {
    if (player.store && player.store.storage) player.store.storage.removeItem(STORAGE_KEY);
  } catch {}
  player.saved = null;
}

// ---------- 语音 ----------
let voices = [];
function refreshVoices() {
  if (!SUPPORTED) return;
  try { voices = window.speechSynthesis.getVoices() || []; } catch { voices = []; }
  renderVoiceOptions();
}
function isZh(v) {
  if (!v || !v.lang) return false;
  const l = v.lang.toLowerCase();
  if (l.startsWith('zh')) return true;
  const n = (v.name || '').toLowerCase();
  return /中文|普通话|国语|chinese|mandarin|yue|粤|cantonese|taiwan|hong kong/.test(n);
}
function isEn(v) {
  if (!v || !v.lang) return false;
  return v.lang.toLowerCase().startsWith('en');
}
function candidateVoices(lang) {
  const pool = lang === 'zh' ? voices.filter(isZh) : voices.filter(isEn);
  return pool;
}
// 选择最合适的声音：记住的优先，否则首个可用
function pickVoice(lang) {
  const pool = candidateVoices(lang);
  if (!pool.length) return null;
  if (player.voiceURI) {
    const hit = pool.find((v) => v.voiceURI === player.voiceURI);
    if (hit) return hit;
  }
  // 优先精确匹配地区（zh-CN / en-US），否则首个
  const exact = pool.find((v) => v.lang.toLowerCase() === (lang === 'zh' ? 'zh-cn' : 'en-us'));
  return exact || pool[0];
}
function noVoiceReason(lang) {
  if (!SUPPORTED) return '当前浏览器不支持语音合成（Web Speech API），无法听书。请使用较新版本的 Chrome / Edge / Safari。';
  return lang === 'zh'
    ? '未找到中文语音。请到系统设置开启中文语音（如 macOS：系统设置 → 辅助功能 → 语音内容；Windows：设置 → 时间和语言 → 语音），或更换已安装中文语音的浏览器。'
    : '未找到英文语音。请到系统设置开启英文语音，或更换浏览器。';
}

// ---------- 高亮 + 跟随 ----------
function clearHighlight() {
  document.querySelectorAll('.listen-seg.is-speaking').forEach((e) => e.classList.remove('is-speaking'));
}
function highlightSegment(chapterId, mode, idx) {
  clearHighlight();
  const sel = `[data-listen-chapter="${chapterId}"][data-listen-mode="${mode}"][data-listen-idx="${idx}"]`;
  const span = document.querySelector(sel);
  if (span) {
    span.classList.add('is-speaking');
    if (player.follow && player.playState === 'playing') {
      player.programmaticScroll = true;
      span.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setTimeout(() => { player.programmaticScroll = false; }, 650);
    }
  }
}
function maybeStopFollow() {
  if (!player.follow) return;
  player.follow = false;
  if (player.els.followback) player.els.followback.hidden = false;
}

// ---------- 朗读引擎 ----------
function buildSegments(chapter, mode) {
  const orig = segmentChapter(chapter.original_text, 'zh').map((t) => ({ text: t, lang: 'zh' }));
  const hasEn = !!(chapter.english_text && chapter.english_text.trim());
  const eng = hasEn ? segmentChapter(chapter.english_text, 'en').map((t) => ({ text: t, lang: 'en' })) : [];
  let segs;
  if (mode === 'english') segs = eng;
  else if (mode === 'both') segs = orig.concat(eng);
  else segs = orig;
  return { segs, origLen: orig.length, hasEn };
}

// 开始一个新的会话（取消旧的）
function startSession({ chapterId, mode = 'original', sentence = 0 }) {
  const ch = getChapterById(chapterId);
  if (!ch) { setStatus(`未找到章节 ${chapterId}`); return; }
  if (!SUPPORTED) { setStatus(noVoiceReason('zh')); setPlayState('error'); showPlayer(true); return; }

  const built = buildSegments(ch, mode);
  if (mode === 'english' && built.segs.length === 0) {
    setStatus(`本章暂无译文（英译），无法朗读译文。可改为朗读原文。`);
    setPlayState('error'); showPlayer(true); updateMeta();
    return;
  }
  player.session = { chapterId, mode, segs: built.segs, origLen: built.origLen, segIndex: Math.max(0, Math.min(sentence, built.segs.length - 1)) };
  player.continuous = player.saved?.chapterId === chapterId && player.saved?.mode === mode ? !!player.saved.continuous : player.continuous;
  setPlayState('playing');
  showPlayer(true);
  updateMeta();
  clearHighlight();
  saveProgress();   // 会话一开始就落盘，确保「继续上次收听」即使首句未真正发声也能恢复
  speakCurrent();
}

// 朗读当前句
function speakCurrent() {
  if (!player.session) return;
  const idx = player.session.segIndex;
  if (idx >= player.session.segs.length) { onSequenceEnd(); return; }
  const seg = player.session.segs[idx];
  const voice = pickVoice(seg.lang);
  if (!voice) {
    setStatus(noVoiceReason(seg.lang));
    setPlayState('error');
    return;
  }
  const token = ++player.taskId;
  const u = new SpeechSynthesisUtterance(seg.text);
  u.voice = voice; u.lang = voice.lang; u.rate = player.speed; u.pitch = 1;
  u.onstart = () => {
    if (token !== player.taskId) return;
    onSentenceStart(idx);
  };
  u.onend = () => {
    if (token !== player.taskId) return;
    onSentenceEnd(idx);
  };
  u.onerror = (e) => {
    if (token !== player.taskId) return;
    const code = e && e.error;
    if (code === 'canceled' || code === 'interrupted') return; // 取消/打断：忽略
    // 真实朗读失败（如无可用音频输出、语音被系统拒绝）：如实提示并停止，绝不假装已读完
    setStatus('朗读出错：' + (code || '未知错误') + '（请检查设备语音或浏览器权限）');
    stop();
  };
  player.pendingUtterance = u;
  try { window.speechSynthesis.speak(u); }
  catch (err) { setStatus('朗读出错：' + (err && err.message ? err.message : err)); }
}

function onSentenceStart(idx) {
  player.session.segIndex = idx;
  saveProgress();
  updatePos();
  // 高亮映射（both 模式下原文在前、译文在后）
  let hlMode, hlIdx;
  if (idx < player.session.origLen) { hlMode = 'original'; hlIdx = idx; }
  else { hlMode = 'english'; hlIdx = idx - player.session.origLen; }
  highlightSegment(player.session.chapterId, hlMode, hlIdx);
  setStatus('');
}

function onSentenceEnd(idx) {
  if (!player.session) return;
  const next = idx + 1;
  if (next < player.session.segs.length) {
    player.session.segIndex = next;
    // 自然衔接下一句（cancel 后的小延迟，规避个别浏览器忽略紧随其后的 speak）
    setTimeout(() => { if (player.taskId && player.playState === 'playing') speakCurrent(); }, 40);
    return;
  }
  onSequenceEnd();
}

function onSequenceEnd() {
  // 当前章/模式朗读完毕
  if (player.continuous && player.session) {
    const ch = getChapterById(player.session.chapterId);
    if (ch && ch.chapter_number < 81) {
      const nextCh = getChapterById(`ddj-${String(ch.chapter_number + 1).padStart(2, '0')}`);
      if (nextCh) {
        setStatus('连续播放：下一章');
        startSession({ chapterId: nextCh.chapter_id, mode: player.session.mode, sentence: 0 });
        return;
      }
    }
  }
  // 结束（不循环）
  clearHighlight();
  setPlayState('idle');
  setStatus('已播完本章' + (player.continuous ? '（连续播放已到末章，停止）' : ''));
}

// ---------- 控制 ----------
function togglePlay() {
  if (!player.session) {
    // 无会话：从已存进度恢复，否则第 1 章
    if (player.saved && getChapterById(player.saved.chapterId)) resumeSaved();
    else startSession({ chapterId: 'ddj-01', mode: 'original', sentence: 0 });
    return;
  }
  if (player.playState === 'playing') {
    pause();
  } else if (player.playState === 'paused') {
    resume();
  } else {
    // error/idle 但有会话：从当前句重读
    setPlayState('playing');
    speakCurrent();
  }
}
function pause() {
  if (!SUPPORTED) return;
  try { window.speechSynthesis.pause(); } catch {}
  setPlayState('paused');
}
function resume() {
  if (!SUPPORTED) return;
  if (player.playState === 'playing') return;
  setPlayState('playing');
  // 若当前没有正在朗读（被 cancel 或未起播），从当前句开始
  let speaking = false;
  try { speaking = window.speechSynthesis.speaking; } catch {}
  if (speaking) { try { window.speechSynthesis.resume(); } catch {} }
  else speakCurrent();
}
function stop() {
  player.taskId++; // 作废所有挂起事件的令牌
  if (SUPPORTED) { try { window.speechSynthesis.cancel(); } catch {} }
  clearHighlight();
  setPlayState('idle');
  setStatus('已停止');
}
function changeChapter(delta) {
  if (!player.session) return;
  const ch = getChapterById(player.session.chapterId);
  if (!ch) return;
  const n = ch.chapter_number + delta;
  if (n < 1 || n > 81) { setStatus(delta < 0 ? '已经是第 1 章' : '已经是第 81 章'); return; }
  const nc = getChapterById(`ddj-${String(n).padStart(2, '0')}`);
  if (!nc) return;
  startSession({ chapterId: nc.chapter_id, mode: player.session.mode, sentence: 0 });
}
function setMode(mode) {
  if (!player.session) { startSession({ chapterId: player.saved?.chapterId || 'ddj-01', mode, sentence: 0 }); return; }
  startSession({ chapterId: player.session.chapterId, mode, sentence: 0 });
}
function setSpeed(sp) {
  player.speed = sp;
  saveProgress();
  syncSettingsUI();
  // 立即以新语速重读当前句，获得即时反馈
  if (player.session && (player.playState === 'playing' || player.playState === 'paused')) {
    if (SUPPORTED) { try { window.speechSynthesis.cancel(); } catch {} }
    player.taskId++;
    setPlayState('playing');
    speakCurrent();
  }
}
function toggleContinuous() {
  player.continuous = !player.continuous;
  saveProgress();
  syncSettingsUI();
}

// ---------- 公开 API ----------
export const Listen = {
  init({ store, data, navigate }) {
    player.store = store; player.data = data; player.navigate = navigate;
    buildUI();
    player.saved = loadSaved();
    refreshVoices();
    if (SUPPORTED) {
      window.speechSynthesis.addEventListener?.('voiceschanged', refreshVoices);
      // 部分浏览器首次 getVoices 为空，延时补读
      setTimeout(refreshVoices, 250);
      setTimeout(refreshVoices, 1000);
    }
    setupFollowGuard();
    if (player.saved) showResumeBar();
  },
  // 从某章某模式某句开始（默认第 0 句）
  play({ chapterId, mode = 'original', sentence = 0 } = {}) {
    if (!chapterId) return;
    startSession({ chapterId, mode, sentence });
  },
  playOriginal(chapterId) { this.play({ chapterId, mode: 'original', sentence: 0 }); },
  playFromSegment(chapterId, mode, idx) { this.play({ chapterId, mode, sentence: idx }); },
  resumeSaved() {
    if (!player.saved) return;
    const ch = getChapterById(player.saved.chapterId);
    if (!ch) { showResumeBar(); return; }
    player.speed = SPEEDS.includes(player.saved.speed) ? player.saved.speed : 1;
    player.voiceURI = player.saved.voiceURI || null;
    player.continuous = !!player.saved.continuous;
    startSession({ chapterId: player.saved.chapterId, mode: player.saved.mode || 'original', sentence: player.saved.sentence || 0 });
  },
  hasSavedProgress() { return !!player.saved; },
};

// ---------- UI 构建 ----------
function buildUI() {
  const root = el('div', { class: 'listen-player is-hidden', role: 'region', 'aria-label': '听书播放器' });

  // 续听条（空闲且有进度时）
  const resume = el('div', { class: 'listen-player__resume', hidden: true }, [
    el('span', { class: 'listen-player__resume-text' }),
    el('button', { type: 'button', class: 'btn btn--sm btn--primary', 'data-act': 'resume', text: '继续收听' }),
    el('button', { type: 'button', class: 'btn btn--sm btn--ghost', 'data-act': 'dismiss-resume', 'aria-label': '忽略', text: '×' }),
  ]);

  // 主控制条
  const main = el('div', { class: 'listen-player__main' }, [
    el('div', { class: 'listen-player__row' }, [
      el('button', { type: 'button', class: 'listen-player__btn', 'data-act': 'playpause', 'aria-label': '播放或暂停' }, [iconPlay()]),
      el('button', { type: 'button', class: 'listen-player__btn', 'data-act': 'stop', 'aria-label': '停止' }, [iconStop()]),
      el('div', { class: 'listen-player__meta' }, [
        el('div', { class: 'listen-player__chapter' }),
        el('div', { class: 'listen-player__sub' }, [
          el('span', { class: 'listen-player__modebadge' }),
          el('span', { class: 'listen-player__pos' }),
        ]),
      ]),
      el('button', { type: 'button', class: 'listen-player__btn', 'data-act': 'prev', 'aria-label': '上一章' }, [iconPrev()]),
      el('button', { type: 'button', class: 'listen-player__btn', 'data-act': 'next', 'aria-label': '下一章' }, [iconNext()]),
      el('button', { type: 'button', class: 'listen-player__btn', 'data-act': 'view', 'aria-label': '查看本章' }, [iconBook()]),
      el('button', { type: 'button', class: 'listen-player__btn', 'data-act': 'settings', 'aria-label': '设置' }, [iconGear()]),
      el('button', { type: 'button', class: 'listen-player__btn', 'data-act': 'close', 'aria-label': '关闭' }, [iconClose()]),
    ]),
    el('div', { class: 'listen-player__status', role: 'status', 'aria-live': 'polite' }),
    el('button', { type: 'button', class: 'listen-player__followback', hidden: true, 'data-act': 'followback' }, ['回到朗读位置']),
    el('div', { class: 'listen-player__settings', hidden: true }, [
      settingGroup('朗读内容', el('div', { class: 'seg' }, [
        segBtn('original', '原文'),
        segBtn('english', '译文'),
        segBtn('both', '先原文再译文'),
      ])),
      settingGroup('语速', el('div', { class: 'seg' }, SPEEDS.map((s) => segBtn('speed:' + s, s + '×')))),
      settingGroup('连续播放', el('button', { type: 'button', class: 'btn btn--sm', 'data-act': 'toggle-continuous', text: '关闭' })),
      settingGroup('声音', el('div', { class: 'listen-player__voices' })),
      el('button', { type: 'button', class: 'btn btn--sm btn--ghost listen-player__followtoggle', 'data-act': 'toggle-follow', text: '跟随朗读：开' }),
      el('p', { class: 'listen-player__note', text: '使用设备语音，不同设备音色可能不同。' }),
    ]),
  ]);

  root.append(resume, main);
  document.body.append(root);
  player.root = root;
  player.els = {
    resume, resumeText: resume.querySelector('.listen-player__resume-text'),
    main,
    chapter: main.querySelector('.listen-player__chapter'),
    modebadge: main.querySelector('.listen-player__modebadge'),
    pos: main.querySelector('.listen-player__pos'),
    status: main.querySelector('.listen-player__status'),
    settings: main.querySelector('.listen-player__settings'),
    voices: main.querySelector('.listen-player__voices'),
    followback: main.querySelector('.listen-player__followback'),
    followToggle: main.querySelector('.listen-player__followtoggle'),
    playpause: main.querySelector('[data-act="playpause"]'),
  };

  // 事件委托
  root.addEventListener('click', onRootClick);

  // 尺寸变化通知（安全区）
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => emitChange()).observe(root);
  }
  emitChange();
}

function settingGroup(label, control) {
  return el('div', { class: 'listen-player__group' }, [
    el('span', { class: 'listen-player__glabel', text: label }),
    control,
  ]);
}
function segBtn(value, text) {
  return el('button', { type: 'button', class: 'seg__btn', 'data-seg': value, text });
}

function onRootClick(e) {
  const btn = e.target.closest('[data-act],[data-seg]');
  if (!btn) return;
  const act = btn.getAttribute('data-act');
  const seg = btn.getAttribute('data-seg');
  if (seg) {
    if (seg.startsWith('speed:')) setSpeed(parseFloat(seg.slice(6)));
    else setMode(seg);
    return;
  }
  switch (act) {
    case 'playpause': togglePlay(); break;
    case 'stop': stop(); break;
    case 'prev': changeChapter(-1); break;
    case 'next': changeChapter(1); break;
    case 'view': if (player.session) player.navigate?.(`#/chapters/${player.session.chapterId}`); break;
    case 'settings': toggleSettings(); break;
    case 'close': stop(); showPlayer(false); break;
    case 'resume': Listen.resumeSaved(); break;
    case 'dismiss-resume': hideResumeBar(); break;
    case 'toggle-continuous': toggleContinuous(); break;
    case 'toggle-follow': player.follow = !player.follow; if (player.follow) player.els.followback.hidden = true; syncSettingsUI(); break;
    case 'followback': player.follow = true; player.els.followback.hidden = true; if (player.session) highlightSegment(player.session.chapterId, 'original', player.session.segIndex); break;
  }
}

function toggleSettings() {
  const s = player.els.settings;
  s.hidden = !s.hidden;
  if (!s.hidden) { renderVoiceOptions(); syncSettingsUI(); }
}

// ---------- 渲染辅助 ----------
function setStatus(msg) { if (player.els.status) player.els.status.textContent = msg || ''; }
function setPlayState(s) {
  player.playState = s;
  if (player.els.playpause) {
    player.els.playpause.innerHTML = '';
    player.els.playpause.append(s === 'playing' ? iconPause() : iconPlay());
  }
  // 播放/暂停时收起续听条
  if (s === 'playing' || s === 'paused') hideResumeBar();
  if (s === 'idle' && player.saved) showResumeBar();
}
function updateMeta() {
  if (!player.session) return;
  const ch = getChapterById(player.session.chapterId);
  if (player.els.chapter) player.els.chapter.textContent = chapterTitle(ch);
  if (player.els.modebadge) player.els.modebadge.textContent = modeLabel(player.session.mode);
  updatePos();
}
function updatePos() {
  if (!player.session) return;
  const n = player.session.segs.length;
  const i = player.session.segIndex + 1;
  if (player.els.pos) player.els.pos.textContent = `第 ${i} / ${n} 句`;
}
function showPlayer(show) {
  if (!player.root) return;
  player.root.classList.toggle('is-hidden', !show);
  if (show) document.body.classList.add('has-listen-player');
  else document.body.classList.remove('has-listen-player');
  emitChange();
}
function showResumeBar() {
  if (!player.saved) return;
  const ch = getChapterById(player.saved.chapterId);
  if (player.els.resumeText && ch) {
    player.els.resumeText.textContent = `继续上次收听 · ${chapterTitle(ch)} · ${modeLabel(player.saved.mode || 'original')} 第 ${(player.saved.sentence || 0) + 1} 句`;
  }
  if (player.els.resume) player.els.resume.hidden = false;
  player.root.classList.remove('is-hidden');
  document.body.classList.add('has-listen-player');
  emitChange();
}
function hideResumeBar() {
  if (player.els.resume) player.els.resume.hidden = true;
  if (player.playState === 'idle') showPlayer(false);
}

function syncSettingsUI() {
  if (!player.root) return;
  player.root.querySelectorAll('.seg__btn').forEach((b) => {
    const v = b.getAttribute('data-seg');
    let active = false;
    if (v.startsWith('speed:')) active = Math.abs(parseFloat(v.slice(6)) - player.speed) < 1e-6;
    else if (player.session) active = (v === player.session.mode);
    b.classList.toggle('seg__btn--active', active);
  });
  const cont = player.root.querySelector('[data-act="toggle-continuous"]');
  if (cont) cont.textContent = player.continuous ? '开启' : '关闭';
  if (player.els.followToggle) player.els.followToggle.textContent = '跟随朗读：' + (player.follow ? '开' : '关');
}

function renderVoiceOptions() {
  if (!player.els.voices) return;
  const wrap = player.els.voices;
  wrap.innerHTML = '';
  if (!SUPPORTED) {
    wrap.append(el('p', { class: 'listen-player__voicenote', text: '浏览器不支持语音合成。' }));
    return;
  }
  const zh = voices.filter(isZh);
  const en = voices.filter(isEn);
  if (!zh.length && !en.length) {
    wrap.append(el('p', { class: 'listen-player__voicenote', text: '暂未加载到任何声音，请确认系统已安装语音（中文/英文）。' }));
    return;
  }
  const mk = (v, label) => {
    const row = el('div', { class: 'listen-player__voice' }, [
      el('span', { class: 'listen-player__voicename', text: `${label}：${v.name}（${v.lang}）` }),
      el('button', { type: 'button', class: 'btn btn--sm btn--ghost', 'data-voice': v.voiceURI, text: '试听' }),
      el('button', { type: 'button', class: 'btn btn--sm', 'data-voice-select': v.voiceURI, text: player.voiceURI === v.voiceURI ? '已选' : '选择' }),
    ]);
    return row;
  };
  if (zh.length) {
    wrap.append(el('p', { class: 'listen-player__voicelabel', text: '中文声音' }));
    zh.forEach((v) => wrap.append(mk(v, '中')));
  }
  if (en.length) {
    wrap.append(el('p', { class: 'listen-player__voicelabel', text: '英文声音' }));
    en.forEach((v) => wrap.append(mk(v, '英')));
  }
  wrap.querySelectorAll('[data-voice]').forEach((b) => b.addEventListener('click', () => previewVoice(b.getAttribute('data-voice'))));
  wrap.querySelectorAll('[data-voice-select]').forEach((b) => b.addEventListener('click', () => {
    player.voiceURI = b.getAttribute('data-voice-select');
    saveProgress();
    renderVoiceOptions();
  }));
}
function previewVoice(voiceURI) {
  if (!SUPPORTED) return;
  const v = voices.find((x) => x.voiceURI === voiceURI);
  if (!v) return;
  const wasPlaying = player.playState === 'playing';
  try { window.speechSynthesis.cancel(); } catch {}
  player.taskId++;
  const u = new SpeechSynthesisUtterance('这是一段试听语音，用于确认音色是否合适。');
  u.voice = v; u.lang = v.lang; u.rate = player.speed;
  const token = ++player.taskId;
  u.onend = () => {
    if (token !== player.taskId) return;
    if (wasPlaying && player.session) speakCurrent();
    else setPlayState('idle');
  };
  try { window.speechSynthesis.speak(u); } catch {}
}

// ---------- 跟随滚动防护 ----------
function setupFollowGuard() {
  const events = ['wheel', 'touchmove', 'keydown'];
  const handler = (e) => {
    if (player.programmaticScroll) return;
    if (player.playState !== 'playing') return;
    if (e.type === 'keydown') {
      const k = e.key;
      if (!['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(k)) return;
    }
    maybeStopFollow();
  };
  events.forEach((ev) => window.addEventListener(ev, handler, { passive: true }));
}

// ---------- 安全区通知 ----------
function emitChange() {
  const h = player.root ? (player.root.classList.contains('is-hidden') ? 0 : (player.root.offsetHeight || 0)) : 0;
  document.documentElement.style.setProperty('--listen-player-h', h + 'px');
  window.dispatchEvent(new CustomEvent('listen:playerchange', { detail: { height: h } }));
}

// ---------- 图标（统一用系统字形，避免 CSS 形状在不同字体下的差异）----------
function icon(cls, glyph) { return el('span', { class: `lp-ico lp-ico--${cls}`, 'aria-hidden': 'true', text: glyph }); }
function iconPlay() { return icon('play', '▶'); }
function iconPause() { return icon('pause', '⏸'); }
function iconStop() { return icon('stop', '■'); }
function iconPrev() { return icon('prev', '⏮'); }
function iconNext() { return icon('next', '⏭'); }
function iconBook() { return icon('book', '📖'); }
function iconGear() { return icon('gear', '⚙'); }
function iconChevron() { return icon('chevron', '▾'); }
function iconClose() { return icon('close', '×'); }
