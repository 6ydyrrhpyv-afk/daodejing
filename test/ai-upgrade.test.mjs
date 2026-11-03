import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import worker from '../server/worker.mjs';
const env={AI_PROVIDER:'deepseek',DEEPSEEK_API_KEY:'mock-not-real',PRACTICE_ACCESS_TOKEN:'mock-signing-secret-for-local-tests-only',PRACTICE_RPM:'100',PRACTICE_DAILY:'1000',ALLOWED_ORIGIN:'https://example.test'};
const originalFetch=globalThis.fetch;
const ip='192.0.2.17';
const request=(path,body,token)=>new Request('https://worker.test'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','Origin':'https://example.test','CF-Connecting-IP':ip,...(token?{'x-practice-token':token}:{})},...(body?{body:JSON.stringify(body)}:{})});
const ready=(step=2)=>({status:'ready',scene_summary:'同事在客户会上把你的方案说成自己的，明天将分奖金。',question:'明天分奖金前，领导目前能看到哪些关于这份方案的贡献记录？',options:[{id:'a',title:'已看到修改记录',detail:'领导已收到署名与修改时间记录。'},{id:'b',title:'只听到同事介绍',detail:'领导尚未看到你参与方案的记录。'},{id:'c',title:'尚不清楚',detail:'不确定领导目前知道哪些信息。'}],references:[],final_summary:step===5?{summary:'按你已选的方向推进。',action:'明天会前向领导出示修改记录。',reflection:'领导是否确认收到记录？'}:null});
const body=(step=2)=>({session_id:'session-001',request_id:crypto.randomUUID(),revision:1,theme:'collaboration',scene:'同事在客户会上把我独立完成的方案说成他的，明天按贡献分奖金，我有修改记录。',step,selections:[]});
let token;
test('自动会话使用DeepSeek配置，不需要浏览器提供供应商key',async()=>{
 const r=await worker.fetch(request('/api/practice/session',{}),env);assert.equal(r.status,200);const j=await r.json();token=j.token;assert.ok(token);
 const config=await (await worker.fetch(request('/api/config'),env)).json(); assert.equal(config.practiceProvider,'deepseek');assert.equal(config.practiceModel,'deepseek-v4-pro');assert.ok(!JSON.stringify(config).includes(env.DEEPSEEK_API_KEY));
});
test('真实场景和历史问题/未选项送入模型；质检拒绝后重生成；相同request_id不重复调用',async()=>{
 let calls=[];let reviews=0;
 globalThis.fetch=async(url,opts)=>{
  const b=JSON.parse(opts.body);calls.push(b);assert.equal(url,'https://api.deepseek.com/chat/completions');
  const review=b.messages[0].content.includes('质检员');
  return Response.json({choices:[{message:{content:JSON.stringify(review?{pass:++reviews>1,issues:reviews===1?['重复了第二步的决定']:[]}:ready())}}]});
 };
 const b=body(3);b.selections=[{step:2,option_id:'b',option_label:'领导只听到同事介绍',question:'领导已知哪些贡献记录？',offered_options:['已看到记录','只听到同事介绍','尚不清楚'],custom_text:''}];
 const r=await worker.fetch(request('/api/practice/next',b,token),env);const j=await r.json();assert.equal(r.status,200,JSON.stringify(j));assert.equal(calls.length,4);assert.equal(j.meta.quality_reviewed,true);assert.ok(calls[0].messages[1].content.includes(b.scene));assert.ok(calls[0].messages[1].content.includes(b.selections[0].question));assert.ok(calls[0].messages[1].content.includes('未选项不能当作用户决定'));
 const cached=await worker.fetch(request('/api/practice/next',b,token),env);assert.equal(cached.status,200);assert.equal(calls.length,4);
 b.scene='客户在签约后增加五张海报，要求免费完成，我不知道怎样回应。';const conflict=await worker.fetch(request('/api/practice/next',b,token),env);assert.equal(conflict.status,409);
});
test('质检持续不通过时返回错误，不把固定模板冒充AI',async()=>{
 globalThis.fetch=async(_,o)=>Response.json({choices:[{message:{content:JSON.stringify(JSON.parse(o.body).messages[0].content.includes('质检员')?{pass:false,issues:['不贴合场景']}:ready())}}]});
 const r=await worker.fetch(request('/api/practice/next',body(),token),env);assert.equal(r.status,502);assert.equal((await r.json()).ok,false);
});
test('缺API密钥/跳步拒绝；生成选项只允许3–4项',async()=>{
 assert.equal((await worker.fetch(request('/api/practice/session',{}),{...env,DEEPSEEK_API_KEY:''})).status,503);
 assert.equal((await worker.fetch(request('/api/practice/next',body(4),token),env)).status,400);
 globalThis.fetch=async()=>{const d=ready();d.options.push({...d.options[0],id:'d'},{...d.options[0],id:'e'});return Response.json({choices:[{message:{content:JSON.stringify(d)}}]});};
 assert.equal((await worker.fetch(request('/api/practice/next',body(),token),env)).status,502);
 globalThis.fetch=originalFetch;
});
test('81章完整覆盖，原有摘要保留，第81章没有混入跋文',async()=>{
 const {chapters}=JSON.parse(await readFile(new URL('../data/chapters.json',import.meta.url),'utf8'));
 assert.deepEqual(chapters.map(c=>c.chapter_number),Array.from({length:81},(_,i)=>i+1));
 assert.ok(chapters.every(c=>c.plain_explanation.length>25&&c.explanation_url&&c.chapter_summary));
 assert.ok(chapters[80].original_text.endsWith('为而不争。'));
 assert.ok(!chapters[80].original_text.includes('熊克'));
 assert.ok(chapters[44].plain_explanation.includes('活动能够抵御寒冷'));
});
