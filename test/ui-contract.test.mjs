import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {parseHTML} = await import(process.env.TEST_DOM_MODULE || 'linkedom');
const {window,document} = parseHTML('<html><body></body></html>');
Object.assign(globalThis,{window,document,CustomEvent:window.CustomEvent,requestAnimationFrame:fn=>setTimeout(fn,0)});
window.matchMedia=()=>({matches:false});
window.HTMLElement.prototype.scrollIntoView=()=>{};
let instances=[];
class FakeAudio {
 constructor(src){this.src=src;this.currentTime=0;this.paused=true;instances.push(this);}
 async play(){this.paused=false;this.onloadedmetadata?.();}
 pause(){this.paused=true;}
 removeAttribute(){this.src='';}
 load(){}
}
globalThis.Audio=FakeAudio;
const dataFile=n=>readFile(new URL('../data/'+n,import.meta.url),'utf8').then(JSON.parse);
const {chapters}=await dataFile('chapters.json');
const data={chapters,chapterById:new Map(chapters.map(c=>[c.chapter_id,c])),design:await dataFile('chapter-design.json'),guidance:await dataFile('guidance.json')};
const {defaultState,sanitizeState,createMemoryStorage}=await import('../js/store.mjs');
const store={state:defaultState(),storage:createMemoryStorage(),update(fn){this.state=sanitizeState(fn(this.state));return {ok:true};}};
const ctx={data,store,navigate(){},rerender(){}};
const {renderChapters}=await import('../js/chapters.mjs');
const {renderPractice}=await import('../js/practice.mjs');
const {Listen,segmentChapter}=await import('../js/listen-player.mjs');
const manifest={tracks:{}};
for(const voice of ['male','female']) for(const mode of ['original','chinese']) manifest.tracks[`ddj-01/${mode}/${voice}`]={url:'assets/audio/mock.mp3',cues:[{start:0},{start:2}]};
globalThis.fetch=async u=>String(u).includes('audio-manifest')?Response.json(manifest):Response.json({practiceConfigured:true});
test('81章释义可以渲染；中文听书分段与显示索引数量一致',()=>{
 for(const c of chapters){document.body.replaceChildren(renderChapters(ctx,{id:c.chapter_id}));assert.ok(document.body.textContent.includes('完整中文白话释义'));assert.equal(document.querySelectorAll('[data-listen-mode="chinese"]').length,segmentChapter(c.plain_explanation,'zh').length);}
});
test('选择答案后保留历史问题与未选项，返回下一步状态不丢失',()=>{
 store.state={...defaultState(),draft:{mode:'ai',sessionId:'session-001',revision:1,step:2,scene:'同事在会上抢了我的方案署名，明天要分奖金。',sceneSummary:'贡献归属待澄清',selections:[],results:{2:{status:'ready',question:'领导看过哪些贡献记录？',options:[{id:'a',title:'看过记录',detail:'已发给领导'},{id:'b',title:'只听到同事介绍',detail:'未发材料'},{id:'c',title:'不清楚',detail:'需要确认'}],references:[]}}}};
 document.body.replaceChildren(renderPractice(ctx));
 const radio=document.querySelector('input[type="radio"]');radio.checked=true;radio.dispatchEvent(new window.Event('change'));
 const button=[...document.querySelectorAll('button')].find(x=>x.textContent==='确认并继续');button.click();
 assert.equal(store.state.draft.step,3);assert.equal(store.state.draft.selections[0].question,'领导看过哪些贡献记录？');assert.equal(store.state.draft.selections[0].offered_options.length,3);
});
test('固定两声线，暂停/续播/换声线取消旧音频，缺音频如实显示错误',async()=>{
 document.body.replaceChildren();Listen.init(ctx);
 assert.equal(document.querySelector('.listen-player__voices').children.length,2);
 Listen.play({chapterId:'ddj-01'});await new Promise(r=>setTimeout(r,0));
 let a=instances.at(-1);assert.equal(a.paused,false);
 document.querySelector('[data-act="playpause"]').click();assert.equal(a.paused,true);
 document.querySelector('[data-act="playpause"]').click();await new Promise(r=>setTimeout(r,0));assert.equal(a.paused,false);
 document.querySelector('.listen-player__voices').children[1].click();await new Promise(r=>setTimeout(r,0));assert.equal(a.paused,true);assert.equal(instances.at(-1).paused,false);
 Listen.play({chapterId:'ddj-02'});await new Promise(r=>setTimeout(r,0));assert.ok(document.querySelector('.listen-player__status').textContent.includes('尚未发布'));
});
