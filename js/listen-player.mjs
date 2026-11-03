// 固定两种云端合成音源；音频预生成，无浏览器系统音色。
import { el, splitLines } from './util.mjs';

const STORAGE_KEY = 'ddj-practice-room/listen/v1';
const SPEEDS = [0.75, 1, 1.25, 1.5];
const SUPPORTED = typeof Audio !== 'undefined';
let audio = null;
let manifestPromise = null;
const VOICES = [{voiceURI:'male', name:'云舟 · 男声', lang:'zh-CN'}, {voiceURI:'female', name:'小何 · 女声', lang:'zh-CN'}];
function audioManifest() {
  if (!manifestPromise) manifestPromise = fetch(new URL('../data/audio-manifest.json', import.meta.url)).then(r => { if (!r.ok) throw new Error('音频目录尚未发布'); return r.json(); }).catch(e => { manifestPromise = null; throw e; });
  return manifestPromise;
}
function cancelAudio() { if (audio) { audio.onended = null; audio.ontimeupdate = null; audio.onerror = null; audio.pause(); audio.removeAttribute('src'); audio.load(); audio = null; } }


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
  return m === 'chinese' ? '中文释义' : m === 'both' ? '原文与中文释义' : '原文';
}

// ---------- 进度存储 ----------
function loadSaved() {
  try {
    const raw = (player.store && player.store.storage) ? player.store.storage.getItem(STORAGE_KEY) : null;
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || typeof p.chapterId !== 'string') return null;
    if (!['original', 'chinese', 'both'].includes(p.mode)) { p.mode = 'original'; p.sentence = 0; }
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
let voices = VOICES;
function refreshVoices() { renderVoiceOptions(); }
function noVoiceReason() { return '当前浏览器无法播放音频，请更换较新版本浏览器。'; }

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
  const chinese = segmentChapter(chapter.plain_explanation, 'zh').map(text => ({ text, lang: 'zh' }));
  let segs;
  if (mode === 'chinese') segs = chinese;
  else if (mode === 'both') segs = orig.concat(chinese);
  else segs = orig;
  return { segs, origLen: orig.length };
}

// 开始一个新的会话（取消旧的）
function startSession({ chapterId, mode = 'original', sentence = 0 }) {
  if (!['original', 'chinese', 'both'].includes(mode)) { mode = 'original'; sentence = 0; }
  const ch = getChapterById(chapterId);
  if (!ch) { setStatus(`未找到章节 ${chapterId}`); return; }
  if (!SUPPORTED) { setStatus(noVoiceReason('zh')); setPlayState('error'); showPlayer(true); return; }

  const built = buildSegments(ch, mode);
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
async function speakCurrent() {
  if (!player.session) return;
  const token = ++player.taskId;
  cancelAudio();
  const session = player.session;
  const mode = session.mode === 'both' ? (session.segIndex < session.origLen ? 'original' : 'chinese') : session.mode;
  const offset = session.mode === 'both' && mode === 'chinese' ? session.origLen : 0;
  const voice = player.voiceURI === 'female' ? 'female' : 'male';
  setStatus('正在载入音频…');
  try {
    const manifest = await audioManifest();
    if (token !== player.taskId) return;
    const track = manifest.tracks?.[`${session.chapterId}/${mode}/${voice}`];
    if (!track) throw new Error('本章音频尚未发布，请稍后再试');
    const a = new Audio(new URL(track.url, new URL('../', import.meta.url)).href);
    audio = a;
    a.playbackRate = player.speed;
    const index = Math.max(0, session.segIndex - offset);
    const seek = track.cues?.[index]?.start;
    if (index && seek === undefined) setStatus('本段尚无定位信息，从本章开头播放');
    a.onloadedmetadata = () => { if (token === player.taskId && seek !== undefined) a.currentTime = seek; };
    a.ontimeupdate = () => {
      if (token !== player.taskId || player.playState !== 'playing') return;
      let found = -1;
      for (let i = 0; i < (track.cues || []).length; i++) {
        if (track.cues[i] && a.currentTime >= track.cues[i].start) found = i;
        else break;
      }
      if (found >= 0 && session.segIndex !== offset + found) onSentenceStart(offset + found);
    };
    a.onended = () => {
      if (token !== player.taskId) return;
      if (session.mode === 'both' && mode === 'original') { session.segIndex = session.origLen; speakCurrent(); }
      else onSequenceEnd();
    };
    a.onerror = () => { if (token === player.taskId) { setPlayState('error'); setStatus('音频加载失败，请检查网络后重试'); } };
    await a.play();
    if (token !== player.taskId) return;
    setPlayState('playing');
    if (track.cues?.length) onSentenceStart(offset + (seek !== undefined ? index : 0));
    else { clearHighlight(); setStatus('AI 合成朗读 · 本章暂不支持逐句定位'); }
    if (track.cues?.length) setStatus('AI 合成朗读');
  } catch (e) {
    if (token !== player.taskId) return;
    setPlayState('error');
    setStatus(e.name === 'NotAllowedError' ? '请点击播放按钮开始收听' : e.message);
  }
}

function onSentenceStart(idx) {
  player.session.segIndex = idx;
  saveProgress();
  updatePos();
  // 高亮映射（both 模式下原文在前、译文在后）
  let hlMode, hlIdx;
  const mode = player.session.mode;
  if (mode === 'both') { hlMode = idx < player.session.origLen ? 'original' : 'chinese'; hlIdx = idx < player.session.origLen ? idx : idx - player.session.origLen; }
  else { hlMode = mode; hlIdx = idx; }
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
    if (player.saved && getChapterById(player.saved.chapterId)) Listen.resumeSaved();
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
  if (!audio) { player.taskId++; setPlayState('paused'); return; }
  audio.pause(); setPlayState('paused');
}
async function resume() {
  if (!audio) { speakCurrent(); return; }
  const token = player.taskId;
  try { await audio.play(); if (token === player.taskId) setPlayState('playing'); }
  catch { if (token === player.taskId) { setPlayState('error'); setStatus('播放失败，请点击重试'); } }
}
function stop() {
  player.taskId++; cancelAudio(); clearHighlight(); setPlayState('idle'); setStatus('已停止');
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
  player.speed = sp; saveProgress(); syncSettingsUI();
  if (audio) audio.playbackRate = sp;
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
    audioManifest().catch(() => {});
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
    player.voiceURI = player.saved.voiceURI === 'female' ? 'female' : 'male';
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
        segBtn('chinese', '中文释义'),
        segBtn('both', '原文与中文释义'),
      ])),
      settingGroup('语速', el('div', { class: 'seg' }, SPEEDS.map((s) => segBtn('speed:' + s, s + '×')))),
      settingGroup('连续播放', el('button', { type: 'button', class: 'btn btn--sm', 'data-act': 'toggle-continuous', text: '关闭' })),
      settingGroup('声音', el('div', { class: 'listen-player__voices' })),
      el('button', { type: 'button', class: 'btn btn--sm btn--ghost listen-player__followtoggle', 'data-act': 'toggle-follow', text: '跟随朗读：开' }),
      el('p', { class: 'listen-player__note', text: 'AI 合成朗读 · 云舟男声 / 小何女声 · 各设备统一音源。' }),
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
  wrap.replaceChildren();
  for (const v of VOICES) {
    const selected = (player.voiceURI || 'male') === v.voiceURI;
    const button = el('button', { type:'button', class:'btn btn--sm', 'aria-pressed': String(selected), text:v.name + (selected ? ' · 已选' : '') });
    button.addEventListener('click', () => {
      if ((player.voiceURI || 'male') === v.voiceURI) return;
      const playing = player.playState === 'playing';
      player.taskId++; cancelAudio();
      player.voiceURI = v.voiceURI; saveProgress(); renderVoiceOptions();
      if (playing) speakCurrent();
    });
    wrap.append(button);
  }
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
