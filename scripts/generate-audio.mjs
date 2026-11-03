// Node >=20. Default dry-run; only --execute spends money. Never put the key in source.
import { readFile, writeFile, mkdir, access, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { segmentChapter } from '../js/listen-player.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const execute = args.includes('--execute');
const all = args.includes('--all');
const budget = Number(args.find(x => x.startsWith('--budget-yuan='))?.split('=')[1]);
const { chapters } = JSON.parse(await readFile(resolve(root, 'data/chapters.json'), 'utf8'));
const voices = { male:'zh_male_m191_uranus_bigtts', female:'zh_female_xiaohe_uranus_bigtts' };
const modes = { original:'original_text', chinese:'plain_explanation' };
const manifestPath = resolve(root, 'data/audio-manifest.json');
let manifest;
try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch (e) { if(e.code !== 'ENOENT') throw e; manifest = {version:1, tracks:{}}; }
const tasks = [];
for(const c of chapters.filter(c => all || c.chapter_number === 1)) {
  for(const [mode, field] of Object.entries(modes)) {
    const text = c[field]?.trim(); if(!text) continue;
    for(const [voice, speaker] of Object.entries(voices)) {
      const hash = createHash('sha256').update(JSON.stringify({text,speaker,profile:'calm-reading-v1',rate:-8})).digest('hex').slice(0,24);
      const url = `assets/audio/${hash}.mp3`;
      const key = `${c.chapter_id}/${mode}/${voice}`;
      let exists=false; try { await access(resolve(root,url)); exists=true; } catch {}
      if(exists && manifest.tracks[key]?.hash===hash) continue;
      tasks.push({key,text,speaker,hash,url,mode});
    }
  }
}
const chars = tasks.reduce((n,t)=>n+[...t.text].length,0);
const estimate = chars * 3 / 10000;
console.log(JSON.stringify({dryRun:!execute,files:tasks.length,characters:chars,estimatedYuan:Number(estimate.toFixed(3)),rate:'3元/万字符，实际以供应商账单为准'},null,2));
if(!execute) process.exit(0);
if(!Number.isFinite(budget) || budget <= 0 || estimate > budget) throw new Error('需指定足够的正数 --budget-yuan；超预算不调用服务');
if(!process.env.VOLC_TTS_API_KEY) throw new Error('缺少服务端环境变量 VOLC_TTS_API_KEY');
await mkdir(resolve(root,'assets/audio'),{recursive:true});
for(const t of tasks) {
  const response = await fetch('https://openspeech.bytedance.com/api/v3/tts/unidirectional', {
    method:'POST', headers:{'Content-Type':'application/json','X-Api-Key':process.env.VOLC_TTS_API_KEY,'X-Api-Resource-Id':'seed-tts-2.0','X-Api-Request-Id':randomUUID(),'X-Control-Require-Usage-Tokens-Return':'*'},
    body:JSON.stringify({req_params:{text:t.text,speaker:t.speaker,audio_params:{format:'mp3',sample_rate:24000,bit_rate:160000,speech_rate:-8,enable_subtitle:true},additions:JSON.stringify({context_texts:['用自然、平和的有声书讲述语气朗读，吐字清晰，按语义停顿，克制情绪，不要广告腔，不要夸张表演。']})}}),
    signal:AbortSignal.timeout(120000)
  });
  if(!response.ok) throw new Error(`合成失败 HTTP ${response.status}；未自动重试，避免重复收费`);
  const chunks=[], words=[]; let pending=''; const decoder=new TextDecoder();
  function consume(line) {
    if(!line.trim()) return;
    const packet=JSON.parse(line);
    if(![0,20000000].includes(packet.code)) throw new Error(`合成服务错误 ${packet.code}；未自动重试`);
    if(packet.data) chunks.push(Buffer.from(packet.data,'base64'));
    if(Array.isArray(packet.sentence?.words)) words.push(...packet.sentence.words);
  }
  for await (const chunk of response.body) {
    pending+=decoder.decode(chunk,{stream:true});
    let i; while((i=pending.indexOf('\n'))>=0) { consume(pending.slice(0,i)); pending=pending.slice(i+1); }
  }
  pending+=decoder.decode(); if(pending.trim()) consume(pending);
  if(!chunks.length) throw new Error('接口没有返回音频；未写入空文件');
  // Match actual returned subtitle characters; never invent fixed timing intervals.
  const norm=x=>String(x).replace(/[\p{P}\p{S}\s]/gu,'').toLowerCase();
  const unique=[...new Map(words.filter(w=>Number.isFinite(w.startTime)&&Number.isFinite(w.endTime)).map(w=>[`${w.startTime}:${w.endTime}:${w.word}`,w])).values()].sort((a,b)=>a.startTime-b.startTime);
  let spoken='', timing=[];
  for(const w of unique) for(const ch of norm(w.word)) {spoken+=ch;timing.push(w.startTime);}
  let cursor=0, valid=true;
  const cues=segmentChapter(t.text,'zh').map(text=>{
    const needle=norm(text), at=needle?spoken.indexOf(needle,cursor):-1;
    if(at<0) {valid=false;return null;} cursor=at+needle.length; return {start:timing[at]};
  });
  const path=resolve(root,t.url); await writeFile(path+'.tmp',Buffer.concat(chunks)); await rename(path+'.tmp',path);
  manifest.tracks[t.key]={url:t.url,hash:t.hash,cues:valid?cues:[],timestampsVerified:valid,aiGenerated:true};
  await writeFile(manifestPath+'.tmp',JSON.stringify(manifest,null,2)+'\n'); await rename(manifestPath+'.tmp',manifestPath);
  console.log(`${t.key} ready; subtitle alignment: ${valid?'matched':'unavailable (no simulated highlight)'}`);
}
