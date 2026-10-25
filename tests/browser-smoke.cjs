"use strict";
// Runs only on localhost with simulated media; never opens a course or user profile.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { spawn } = require("node:child_process");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "xxt-edge-test-"));
function makePdfFixture() {
  let pdf='%PDF-1.4\n';const offsets=[0];
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>','<< /Length 4 >>\nstream\nq\nQ\nendstream'];
  objects.forEach((body,index)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${body}\nendobj\n`;});
  const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}
const fixture = `<!doctype html><meta charset="utf-8"><title>Local playback test</title>
<div id="steps"><button class="prev_blue" id="step-video">1 视频</button><button class="prev_white" id="step-quiz">2 练习</button></div>
<video id="video" style="width:320px;height:180px"></video>
<button class="vjs-control" id="manual">Manual pause</button>
<button id="prevNextFocusNext">Next</button>
<iframe id="popup-frame" src="/popup-frame" style="display:none;position:fixed;inset:0;width:100vw;height:100vh;border:0"></iframe>
<script>
window.fixture={courseId:'267029719',plays:0,next:0,paused:true,ended:false,time:0,step:'video',stepClicks:0,submits:0,apiCalls:0,synced:0,confirmations:0,useConfirmation:false,phases:[]};
if(${process.argv.includes('--visibility-only')}) {
  fixture.visibility='visible';
  Object.defineProperty(Document.prototype,'visibilityState',{configurable:true,get:()=>fixture.visibility});
}
let v=document.querySelector('video');
function installVideo(video){
v=video;fixture.paused=true;fixture.ended=false;fixture.time=0;
Object.defineProperties(v,{paused:{get:()=>fixture.paused},ended:{get:()=>fixture.ended},duration:{get:()=>10},currentTime:{get:()=>fixture.time}});
v.play=async()=>{fixture.plays++;fixture.paused=false;fixture.ended=false;v.dispatchEvent(new Event('playing'));};
v.pause=()=>{fixture.paused=true;v.dispatchEvent(new Event('pause'));};
}
installVideo(v);
document.querySelector('#manual').onclick=()=>v?.pause();
function showQuiz(){
if(fixture.step==='lesson'){document.querySelector('#popup-frame').contentDocument.body.replaceChildren();document.querySelector('#popup-frame').style.display='none';}
fixture.step='quiz';fixture.stepClicks++;v.remove();
document.querySelector('#step-video').className='prev_white';document.querySelector('#step-quiz').className='prev_blue';
const wrap=document.createElement('div');wrap.id='quiz';wrap.className='ans-quiz';wrap.setAttribute('role','dialog');
wrap.innerHTML=['single','multiple','judge','single','single'].map((type,i)=>'<div class="singleQuesId" data="'+i+'"><div class="TiMu"><div class="Zy_TItle"><div class="fontLabel">'+(type==='multiple'?'多选题：下列哪些是质数？':type==='judge'?'判断题：1+1=2。':'单选题：1+1 等于多少？')+'</div></div><ul class="Zy_ulTop">'+(type==='judge'?['正确','错误']:type==='multiple'?['2','3','4']:['2','3']).map((text,j)=>'<li qtype="'+(type==='multiple'?'1':type==='judge'?'3':'0')+'" role="'+(type==='multiple'?'checkbox':'radio')+'" aria-checked="false"><span class="num_option" data="'+String.fromCharCode(65+j)+'">'+String.fromCharCode(65+j)+'</span><a class="after">'+text+'</a></li>').join('')+'</ul></div></div>').join('')+'<button id="submit">提交</button><div class="work-status">待完成</div>';
document.body.append(wrap);
const short=document.createElement('div');short.className='singleQuesId';short.id='short-question';short.innerHTML='<div class="TiMu"><div class="Zy_TItle"><div class="fontLabel">简答题：计算机的硬件系统由哪五大部分组成？</div></div><div class="edui-editor" id="editor-container"><iframe id="ueditor_4" src="about:blank"></iframe><textarea id="answerEditor4" style="display:none"></textarea></div></div>';wrap.insertBefore(short,wrap.querySelector('#submit'));
const editorFrame=short.querySelector('iframe');editorFrame.contentDocument.body.contentEditable='true';
window.UE={instants:{shortEditor:{container:short.querySelector('.edui-editor'),iframe:editorFrame,textarea:short.querySelector('textarea'),setContent(html){editorFrame.contentDocument.body.innerHTML=html;},sync(){short.querySelector('textarea').value=editorFrame.contentDocument.body.innerHTML;fixture.synced++;},getContentTxt(){return editorFrame.contentDocument.body.textContent;},fireEvent(){},blur(){editorFrame.contentDocument.body.blur();}}}};
wrap.querySelectorAll('li').forEach(el=>el.onclick=()=>{const old=el.getAttribute('aria-checked')==='true';if(el.getAttribute('role')==='radio')el.parentElement.querySelectorAll('li').forEach(o=>o.setAttribute('aria-checked','false'));el.setAttribute('aria-checked',String(el.getAttribute('role')==='radio'||!old));});
const finish=()=>{fixture.submits++;fixture.lastSubmittedText=short.querySelector('textarea').value;showReview();};
wrap.querySelector('#submit').onclick=()=>{if(!fixture.useConfirmation){finish();return;}window.finishFixtureSubmission=finish;setTimeout(()=>{const frame=document.querySelector('#popup-frame');frame.style.display='block';frame.contentWindow.showSubmitConfirm();},4500);};
}
function showReview(){
const wrap=document.querySelector('#quiz');wrap.removeAttribute('role');wrap.className='';
wrap.innerHTML=Array.from({length:6},(_,i)=>'<div class="singleQuesId"><div class="TiMu"><div class="Zy_TItle"><div class="fontLabel">'+(i===5?'简答题：计算机的硬件系统由哪五大部分组成？':'单选题：1+1 等于多少？')+'</div></div>'+(i<5?'<ul class="Zy_ulTop"><li><span class="num_option">A</span><span class="after">2</span></li><li><span class="num_option">B</span><span class="after">3</span></li></ul>':'')+'<div class="answer-box"><strong>我的答案：'+(i===0?' A':'')+'</strong><p>'+(i===5?'运算器、控制器、存储器、输入设备和输出设备。':'A')+'</p><span>'+(i===5?'待批阅':i===0?'0 分':'16.6 分')+'</span></div></div></div>').join('');
// The result-page next button need not keep the edit page ID or class.
const next=document.querySelector('#prevNextFocusNext') || document.querySelector('#review-next');next.id='review-next';next.textContent='下一节';
}
document.querySelector('#step-quiz').onclick=showQuiz;
document.querySelector('#prevNextFocusNext').onclick=()=>{fixture.next++;fixture.step='next-video';document.querySelector('#quiz')?.remove();const next=document.querySelector('#review-next') || document.querySelector('#prevNextFocusNext');next.id='prevNextFocusNext';next.textContent='Next';document.querySelector('#step-video').className='prev_blue';document.querySelector('#step-quiz').className='prev_white';const video=document.createElement('video');video.id='video';video.style.cssText='width:320px;height:180px';document.body.prepend(video);installVideo(video);};
const listeners=[];
window.routeToWorker=(msg,frameId=0)=>new Promise(resolve=>listeners[0](msg,{tab:{id:1},frameId,url:frameId===0?'https://mooc1.chaoxing.com/mycourse/studentstudy?courseId='+fixture.courseId:'https://mooc1.chaoxing.com/popup-frame'},resolve));
const store={};
const localStore={deepseek:{apiKey:'sk-local-fixture-not-a-real-key',model:'deepseek-flash'}};
window.chrome={storage:{session:{get:async()=>store,set:async x=>{Object.assign(store,x);const r=x.sessions?.[1]?.automation;if(r)fixture.phases.push({status:r.status,message:r.message});}},local:{get:async()=>localStore,set:async x=>Object.assign(localStore,x),setAccessLevel:async()=>{}}},runtime:{id:'fixture',getURL:path=>'chrome-extension://fixture/'+path,openOptionsPage:async()=>{},
onMessage:{addListener:fn=>listeners.push(fn)},sendMessage:msg=>routeToWorker(msg)},tabs:{onRemoved:{addListener(){}},sendMessage:async(tab,msg,target)=>target?.frameId===77?document.querySelector('#popup-frame').contentWindow.receiveFixtureMessage(msg):new Promise(resolve=>listeners[1](msg,{id:'fixture'},resolve))},scripting:{executeScript:async request=>{const frameId=request.target.frameIds[0];if(request.args[0].kind==='confirm')fixture.lastConfirmFrame=frameId;const fn=frameId===77?document.querySelector('#popup-frame').contentWindow.Function('return ('+request.func.toString()+')')():request.func;return [{frameId,result:await fn(...request.args)}];}}};
const originalFetch=window.fetch.bind(window);
fixture.shortAnswer=['冯·诺依曼计算机硬件系统由五大部件组成：','1. 运算器：负责算术运算和逻辑运算。','2. 控制器：负责指挥和协调各部件工作，控制程序执行。','3. 存储器：存放程序和数据。','4. 输入设备：将外部信息输入计算机。','5. 输出设备：将计算机处理结果输出。'].join(String.fromCharCode(10));
window.fetch=async(url,options)=>{if(url!=='https://api.deepseek.com/chat/completions')return originalFetch(url,options);fixture.apiCalls++;const body=JSON.parse(options.body);const qs=JSON.parse(body.messages[1].content).questions;const malformed=fixture.injectBadIds&&!fixture.badInjected&&qs.length>1;if(malformed)fixture.badInjected=true;return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({answers:qs.map((q,i)=>({id:malformed&&i===qs.length-1?'q1':qs.length===1?'q1':Number(q.id.slice(1)),answer:q.type==='short'?fixture.shortAnswer:q.type==='multiple'?'AB':'A',reason:'本地模拟解析'}))})}}]}),{status:200,headers:{'Content-Type':'application/json'}});};
window.importScripts=()=>{};
</script>
<script src="/policy.js"></script><script src="/deepseek.js"></script><script src="/page-action.js"></script><script src="/background.js"></script>
<script>window.XXTPolicy={...XXTPolicy,coursePage:()=>true};</script>
<script src="/text.js"></script><script src="/question-image.js"></script><script src="/quiz.js"></script><script src="/lesson.js"></script><script src="/navigation.js"></script><script src="/panel-ui.js"></script>
<script src="/content.js"></script>`;
const popupFixture = `<!doctype html><meta charset="utf-8"><script src="/text.js"></script><script src="/quiz.js"></script><script src="/lesson.js"></script><script>
let lastState=null;
const send=data=>parent.routeToWorker({channel:'xxt-player-v1',page:'popup-frame',...data},77);
setInterval(async()=>{if(parent.routeToWorker)lastState=await send({type:'REPORT',videos:[],lesson:XXTLesson.scan(),task:XXTLesson.tasks(),blocked:XXTQuiz.blocker(true),confirmation:!!XXTQuiz.confirmation()});},250);
window.showRichTextLesson=()=>{document.body.innerHTML='<article class="ans-cc"><h2>计算机应用</h2><p>计算机对人类的发展和社会的进步产生了极为深刻的影响，并越来越广泛地应用到人类生活的各个领域。</p><h3>科学计算</h3><p>利用计算机完成科学研究与工程技术中的数学问题计算称为科学计算，是计算机应用最早的领域。</p><div class="ans-attach-ct"><span class="ans-job-icon">任务点</span></div></article>';};
window.showLearningGate=()=>{document.body.innerHTML='<div class="video-js"><video style="width:320px;height:180px"></video><button id="learning-gate">继续学习</button></div>';parent.fixture.gateClicks=parent.fixture.gateClicks||0;document.querySelector('#learning-gate').onclick=()=>{parent.fixture.gateClicks++;document.body.replaceChildren();};};
window.showSubmitConfirm=()=>{document.body.innerHTML='<div style="background:#0005;position:fixed;inset:0;display:grid;place-items:center"><div style="background:white;padding:30px;border-radius:12px"><h3>提示</h3><p>确认提交？</p><div><a href="#" id="cancel">取消</a><a href="#" id="affirm"><span>提交</span></a></div></div></div>';document.querySelector('#affirm').onclick=e=>{e.preventDefault();parent.fixture.confirmations++;document.body.replaceChildren();parent.document.querySelector('#popup-frame').style.display='none';parent.finishFixtureSubmission();};};
window.receiveFixtureMessage=async msg=>{
if(msg.type!=='QUIZ_CONFIRM'||msg.page!=='popup-frame')return {error:'wrong owner'};
return XXTQuiz.confirmPending(async(kind,target,text)=>{const token=crypto.randomUUID();target.setAttribute('data-xxt-action',token);try{return await send({type:'PAGE_ACTION',kind,token,text});}finally{target.removeAttribute('data-xxt-action');}},()=>lastState?.running&&lastState?.autoQuiz);
};
</script>`;
const server = http.createServer((req, res) => {
  if(req.url?.startsWith('/question-image.svg')) {res.setHeader('content-type','image/svg+xml');return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="100"><rect width="500" height="100" fill="white"/><text x="12" y="60" font-size="30" fill="blue">f(n)=n*f(n-1), f(0)=1</text></svg>');}
  if(req.url?.startsWith('/visible-resource.pdf')) {res.setHeader('content-type','application/pdf');return res.end(makePdfFixture());}
  if (req.url === "/") { res.setHeader("content-type", "text/html; charset=utf-8"); return res.end(fixture); }
  if (req.url === '/popup-frame') {res.setHeader('content-type','text/html; charset=utf-8');return res.end(popupFixture);}
  const name = req.url.slice(1);
  if (!["policy.js", "background.js", "content.js", "deepseek.js", "quiz.js", "lesson.js", "navigation.js", "panel-ui.js", "page-action.js", "text.js", "question-image.js"].includes(name)) { res.statusCode = 404; return res.end(); }
  res.setHeader("content-type", "application/javascript; charset=utf-8");
  res.end(fs.readFileSync(path.join(root, "edge-extension", name)));
});
const delay = ms => new Promise(r => setTimeout(r, ms));
let child, ws;
async function main() {
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const local = `http://127.0.0.1:${server.address().port}/`;
  child = spawn(edge, ["--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--remote-debugging-port=0", "--remote-allow-origins=*", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  const endpoint = await new Promise((resolve, reject) => {
    let stderr = "";
    const timeout = setTimeout(() => reject(new Error("Edge debugging endpoint timed out")), 15000);
    child.stderr.on("data", b => {
      stderr += b;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
    child.once("error", reject);
  });
  await delay(600);
  const base = new URL(endpoint); base.protocol = "http:"; base.pathname = "/json/version";
  const version = await (await fetch(base)).json();
  console.log("Testing", version.Browser);
  ws = new WebSocket(version.webSocketDebuggerUrl.replace("localhost", "127.0.0.1"));
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = e => reject(e.error || new Error(e.message || "WebSocket failed")); });
  let sequence = 0;
  const pending = new Map();
  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (!pending.has(msg.id)) return;
    const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  };
  const command = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await command("Target.createTarget", { url: local });
  const { sessionId } = await command("Target.attachToTarget", { targetId, flatten: true });
  // The general workflow tests assume a visible tab. Headless Edge can mark
  // it hidden after editor focus changes; lifecycle transitions are covered
  // separately by --visibility-only rather than depending on desktop focus.
  if(!process.argv.includes('--visibility-only'))await command('Emulation.setFocusEmulationEnabled',{enabled:true},sessionId);
  const evaluate = async expression => {
    const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor = async (expression, timeout = 7000) => {
    const until = Date.now() + timeout;
    do { if (await evaluate(expression)) return; await delay(150); } while (Date.now() < until);
    throw new Error(`Timed out: ${expression}\n${await evaluate("document.querySelector('#xxt-player-assistant')?.shadowRoot?.innerHTML")}\n${await evaluate("JSON.stringify(store.sessions)")}\n${await evaluate("JSON.stringify({step:fixture.step,next:fixture.next,submits:fixture.submits,target:XXTNavigation.next()?.id})")}`);
  };
  await waitFor("!!document.querySelector('#xxt-player-assistant')?.shadowRoot");
  const click = id => evaluate(`document.querySelector('#xxt-player-assistant').shadowRoot.querySelector('#${id}').click()`);
  const reason = text => `document.querySelector('#xxt-player-assistant').shadowRoot.querySelector('#status').textContent.includes(${JSON.stringify(text)})`;
  if(process.argv.includes('--image-only')) {
    await click('autoNext');
    await evaluate(`(()=>{
      showQuiz();[...document.querySelectorAll('.singleQuesId')].slice(1,5).forEach(q=>q.remove());
      const title=document.querySelector('#short-question .fontLabel');title.textContent='[其它] 用递归方法，求如下函数';title.classList.add('font-cxsecret');
      const img=document.createElement('img');img.id='formula';img.alt='fmal2.jpg';img.src='/missing-formula?token=private-resource-token';title.append(document.createElement('br'),img);
    })()`);
    await waitFor("document.querySelector('#formula').complete");
    const broken=await evaluate('XXTQuiz.scan().fingerprint');
    await click('start');await waitFor(reason('q2'));
    assert.equal(await evaluate('fixture.apiCalls'),0);assert.equal(await evaluate('fixture.submits'),0);
    assert.equal(await evaluate("document.querySelector('#xxt-player-assistant').shadowRoot.querySelector('#status').textContent.includes('图片未加载')"),true);
    await evaluate("document.querySelector('#formula').src=location.origin.replace('127.0.0.1','localhost')+'/question-image.svg?token=private-resource-token'");
    await waitFor("document.querySelector('#formula').complete && document.querySelector('#formula').naturalWidth>0");
    const blocked=await evaluate("XXTQuiz.read().then(()=>'',e=>e.message)");
    assert.match(blocked,/q2.*跨域/);assert.equal(blocked.includes('private-resource-token'),false);
    await evaluate("document.querySelector('#formula').src='/question-image.svg?token=private-resource-token'");
    await waitFor("document.querySelector('#formula').complete && document.querySelector('#formula').naturalWidth>0");
    assert.notEqual(await evaluate('XXTQuiz.scan().fingerprint'),broken);
    const pixels=await evaluate(`(async()=>{const q=(await XXTQuiz.read()).questions.find(q=>q.id==='q2'),img=new Image();img.src=q.image;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);const data=ctx.getImageData(0,0,c.width,c.height).data;let blue=0;for(let i=0;i<data.length;i+=4)if(data[i+2]>180 && data[i]<80 && data[i+1]<80)blue++;return blue;})()`);
    assert.ok(pixels>30,'the generated PNG must include the formula image pixels');
    await evaluate("(()=>{const img=document.querySelector('#formula'),title=img.parentElement;title.classList.remove('font-cxsecret');title.replaceChildren(img);})()");
    assert.equal(await evaluate("XXTQuiz.scan().questions.find(q=>q.id==='q2').visual"),true,'image-only questions without encrypted fonts still require vision');
    await evaluate(`(()=>{const base=window.fetch;fixture.visionCalls=0;fixture.answerCalls=0;window.fetch=async(url,options)=>{
      if(url!=='https://api.deepseek.com/chat/completions')return base(url,options);
      fixture.apiCalls++;const body=JSON.parse(options.body),visual=Array.isArray(body.messages[1].content);
      if(JSON.stringify(body).includes('private-resource-token'))throw new Error('image URL leaked');
      let payload;
      if(visual){fixture.visionCalls++;payload={id:'q2',readable:true,stem:'用递归方法求 f(n)=n*f(n-1), f(0)=1。',options:[]};}
      else {fixture.answerCalls++;const qs=JSON.parse(body.messages[1].content).questions;fixture.sentQuestions=qs;payload={answers:qs.map(q=>({id:q.id,answer:q.type==='short'?['int f(int n) { return n == 0 ? 1 : n * f(n - 1); }']:['A']}))};}
      return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(payload)}}]}),{status:200});
    };})()`);
    await click('start');await waitFor('fixture.submits===1',18000);
    assert.equal(await evaluate('fixture.visionCalls'),1);assert.equal(await evaluate('fixture.answerCalls'),1);
    assert.equal(await evaluate("fixture.sentQuestions.find(q=>q.id==='q2').stem.includes('f(0)=1')"),true);
    assert.equal(await evaluate("fixture.lastSubmittedText.includes('n * f(n - 1)')"),true);
    console.log('PASS: broken q2 image stops before API calls; cross-origin images report q2 without URLs; loaded formula pixels reach vision and the transcribed image-only short answer is synced and submitted');
    await command('Browser.close');return;
  }
  if(process.argv.includes('--visibility-only')) {
    await click('autoNext');await click('start');await waitFor('fixture.plays>=1');
    await click('foregroundCompat');await waitFor("Object.hasOwn(document,'visibilityState')");
    const started=await evaluate('fixture.plays');
    await evaluate("fixture.visibility='hidden';document.dispatchEvent(new Event('visibilitychange'))");await delay(1300);
    assert.equal(await evaluate('fixture.paused'),false,'hidden playback that is still progressing must not be paused by the controller');
    await evaluate("document.querySelector('video').pause()");
    await waitFor("document.querySelector('#xxt-player-assistant').shadowRoot.querySelector('#status').textContent.includes('后台')");
    const attempts=await evaluate("(async()=>{const s=await routeToWorker({channel:'xxt-player-v1',type:'HELLO',page:store.sessions[1].page});return s.reports.find(r=>r.frameId===0).videos[0].resumeAttempts;})()");
    assert.equal(await evaluate('document.visibilityState'),'visible','compatibility overrides do not hide the real lifecycle state from the controller');
    await delay(20000);
    assert.equal(await evaluate('fixture.plays'),started,'hidden pauses must not consume repeated play calls');
    const hidden=await evaluate("routeToWorker({channel:'xxt-player-v1',type:'HELLO',page:store.sessions[1].page})");
    assert.equal(hidden.running,true);assert.equal(hidden.waitingForVisible,true);
    const report=hidden.reports.find(r=>r.frameId===0);assert.equal(report.visibility,'hidden');assert.equal(report.pauseSignal,'document-hidden');assert.equal(report.videos[0].resumeAttempts,attempts);
    await evaluate("fixture.visibility='visible';document.dispatchEvent(new Event('visibilitychange'))");
    await waitFor('fixture.plays>'+started);assert.equal(await evaluate('fixture.paused'),false);
    await click('resume');
    const noResume=await evaluate('fixture.plays');
    await evaluate("fixture.visibility='hidden';document.dispatchEvent(new Event('visibilitychange'));document.querySelector('video').pause()");await delay(1200);
    await evaluate("fixture.visibility='visible';document.dispatchEvent(new Event('visibilitychange'))");await delay(2300);
    assert.equal(await evaluate('fixture.plays'),noResume,'resume-disabled remains respected after restoring visibility');
    await click('resume');await waitFor('fixture.plays>'+noResume);
    await click('pause');await waitFor('fixture.paused');const paused=await evaluate('fixture.plays');
    await evaluate("fixture.visibility='hidden';document.dispatchEvent(new Event('visibilitychange'));fixture.visibility='visible';document.dispatchEvent(new Event('visibilitychange'))");await delay(1200);
    assert.equal(await evaluate('fixture.plays'),paused,'an explicit pause cannot be undone by restoring visibility');
    await click('start');await waitFor('!fixture.paused');
    await evaluate("fixture.visibility='hidden';document.dispatchEvent(new Event('visibilitychange'));document.querySelector('video').pause();const el=document.createElement('div');el.id='captcha';el.textContent='安全验证';document.body.append(el)");
    await waitFor(reason('验证'));assert.equal(await evaluate('store.sessions[1].running'),false);
    await evaluate("document.querySelector('#captcha').remove();fixture.visibility='visible';document.dispatchEvent(new Event('visibilitychange'))");
    await click('start');await waitFor('!fixture.paused');
    // Advance only the mock clock: real page logic still enforces the original
    // visible-page retry cap, independently of the hidden waiting path.
    await evaluate("fixture.clock=0;const realNow=performance.now.bind(performance),realDateNow=Date.now.bind(Date);Object.defineProperty(performance,'now',{configurable:true,value:()=>realNow()+fixture.clock});Date.now=()=>realDateNow()+fixture.clock");
    for(let i=0;i<5;i++) {
      const plays=await evaluate('fixture.plays');
      await evaluate("fixture.clock+=4000;document.querySelector('video').pause()");await waitFor('fixture.plays>'+plays);
    }
    await evaluate("fixture.clock+=4000;document.querySelector('video').pause()");await waitFor(reason('反复暂停'));
    assert.equal(await evaluate('store.sessions[1].running'),false);assert.equal(await evaluate('fixture.apiCalls'),0);
    console.log('PASS: hidden pause waits without retries, restores playback when visible, respects disabled resume/manual pause/verification, and retains the visible-page retry cap');
    await command('Browser.close');return;
  }
  if(process.argv.includes('--question-types-only')) {
    await click('autoNext');
    await evaluate(`(()=>{
      showQuiz();
      const wrap=document.querySelector('#quiz'),first=wrap.querySelector('.singleQuesId'),short=document.querySelector('#short-question');
      // Match the report: eight choices, followed by two "other" UEditor answers.
      for(let i=0;i<3;i++)wrap.insertBefore(first.cloneNode(true),short);
      short.querySelector('.fontLabel').textContent='9 [其它] 将一个数组的值按逆序重新存放，例如原来顺序为 8、6、5、4、1，要求改为 1、4、5、6、8。';
      const second=short.cloneNode(true);second.id='second-short-question';
      second.querySelector('.fontLabel').textContent='10 [其它] 一个已按从小到大的顺序排好的数组，今输入一个数要求按原来排序的规律将它插入数组中。（假设数组有10元素）';
      fixture.sortingQuestion=second.querySelector('.fontLabel').textContent;
      second.querySelector('iframe').id='ueditor_5';second.querySelector('textarea').id='answerEditor5';
      wrap.insertBefore(second,document.querySelector('#submit'));
      const frame=second.querySelector('iframe');frame.contentDocument.body.contentEditable='true';
      UE.instants.secondEditor={container:second.querySelector('.edui-editor'),iframe:frame,textarea:second.querySelector('textarea'),setContent(html){frame.contentDocument.body.innerHTML=html;},sync(){second.querySelector('textarea').value=frame.contentDocument.body.innerHTML;fixture.synced++;},getContentTxt(){return frame.contentDocument.body.textContent;},fireEvent(){},blur(){frame.contentDocument.body.blur();}};
      wrap.querySelectorAll('li').forEach(el=>el.onclick=()=>{const old=el.getAttribute('aria-checked')==='true';if(el.getAttribute('role')==='radio')el.parentElement.querySelectorAll('li').forEach(o=>o.setAttribute('aria-checked','false'));el.setAttribute('aria-checked',String(el.getAttribute('role')==='radio'||!old));});
      const submit=document.querySelector('#submit'),original=submit.onclick;
      submit.onclick=()=>{fixture.extraSubmittedText=second.querySelector('textarea').value;original();};
    })()`);
    assert.deepEqual(await evaluate('(()=>{const s=XXTQuiz.scan();return {total:s.total,count:s.count,unsupported:s.unsupported,shortIds:s.questions.filter(q=>q.type===\'short\').map(q=>q.id)};})()'),{total:10,count:10,unsupported:0,shortIds:['q9','q10']});
    for(const word of ['排序','编程','填空','上传','连线']) {
      await evaluate(`document.querySelector('#second-short-question .fontLabel').textContent=${JSON.stringify('[其它] 请说明'+word+'的操作过程')}`);
      assert.equal(await evaluate("XXTQuiz.scan().questions.find(q=>q.id==='q10')?.type"),'short');
    }
    await evaluate("document.querySelector('#second-short-question .fontLabel').textContent=fixture.sortingQuestion");
    const unknown=await evaluate(`(()=>{const root=document.createElement('div');root.className='singleQuesId';root.innerHTML='<h3>排序题：将元素排序</h3>';document.querySelector('#quiz').append(root);const s=XXTQuiz.scan();root.remove();return {unsupported:s.unsupported,count:s.count,details:s.unsupportedDetails};})()`);
    assert.deepEqual(unknown,{unsupported:1,count:10,details:[{id:'q11',code:'missing-answer-control',optionCount:0}]},'missing controls must remain unsupported and identify the question');
    await click('start');await waitFor('fixture.submits===1',20000);
    assert.equal(await evaluate('fixture.apiCalls'),2);
    assert.equal(await evaluate("fixture.lastSubmittedText.includes('运算器') && fixture.extraSubmittedText.includes('运算器')"),true);
    console.log('PASS: eight choices and two other UEditor questions are recognized, filled, synced and submitted; task words do not override editor evidence; missing controls still block');
    await command('Browser.close');return;
  }
  if(process.argv.includes('--fallback-only')) {
    assert.equal(await evaluate("document.querySelector('#xxt-player-assistant').shadowRoot.querySelector('#randomFallback').checked"),true);
    await click('autoNext');
    await evaluate(`(()=>{
      showQuiz();const submit=document.querySelector('#submit'),originalSubmit=submit.onclick;
      submit.onclick=()=>{fixture.randomNote=document.querySelector('.xxt-ai-explanation')?.textContent || '';originalSubmit();};
      const base=window.fetch;window.fetch=async(url,options)=>{
        if(url!=='https://api.deepseek.com/chat/completions')return base(url,options);
        fixture.apiCalls++;const body=JSON.parse(options.body),qs=JSON.parse(body.messages[1].content).questions;
        return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({answers:qs.map(q=>({id:q.id,answer:q.id==='q1'?[]:q.type==='short'?[fixture.shortAnswer]:q.type==='multiple'?['A','B']:['A']}))})}}]}),{status:200});
      };
    })()`);
    await click('start');await waitFor('fixture.submits===1',18000);
    assert.equal(await evaluate('fixture.apiCalls'),2,'empty q1 must not cause two extra answer requests');
    assert.equal(await evaluate("fixture.randomNote.startsWith('随机兜底（非模型答案）')"),true);
    await waitFor("document.querySelector('#xxt-player-assistant').shadowRoot.querySelector('#detail').textContent.includes('1 道随机兜底')");
    await click('randomFallback');
    await evaluate("document.querySelector('#review-next').click();showQuiz()");await click('start');
    await waitFor(reason('空答案'),16000);assert.equal(await evaluate('fixture.submits'),1);
    console.log('PASS: empty objective answer becomes a labelled random choice and submits without extra retries; opting out stops without a second submission');
    await command('Browser.close');return;
  }
  if(process.argv.includes('--tasks-only')) {
    await click('autoQuiz');
    const checks=await evaluate(`(()=>{
      const video=document.querySelector('video'),card=document.createElement('div');card.id='task-card';card.className='ans-attach-ct';video.before(card);
      card.innerHTML='<span class="ans-job-icon" id="task-marker">任务点</span>';card.append(video);
      const ignored=document.createElement('div');ignored.id='ignored-markers';ignored.innerHTML='<nav id="coursetree"><span class="ans-job-icon">任务点已完成</span></nav><div class="TiMu"><span class="ans-job-icon">任务点已完成</span></div><div hidden><span class="ans-job-icon">任务点已完成</span></div>';document.body.append(ignored);
      const result=XXTLesson.tasks();ignored.remove();
      const marker=document.querySelector('#task-marker');marker.style.cssText='display:inline-block;min-width:20px;min-height:20px';marker.textContent='';marker.title='任务点已经完成';
      const mediaFrame=document.createElement('iframe');mediaFrame.src='/ananas/modules/video/index.html';card.append(mediaFrame);
      const completed=XXTLesson.tasks(),completedMedia=XXTLesson.scan();mediaFrame.remove();
      card.classList.add('ans-job-finished');marker.title='任务点未完成';const conflict=XXTLesson.tasks();
      card.classList.remove('ans-job-finished');marker.removeAttribute('title');marker.textContent='任务点';
      fixture.time=10;fixture.ended=true;fixture.paused=true;
      return {total:result.total,pending:result.pending,completed:result.completed,titleCompleted:completed.completed,completedMediaPending:completedMedia.mediaPending,conflictPending:conflict.pending};
    })()`);
    assert.deepEqual(checks,{total:1,pending:1,completed:false,titleCompleted:true,completedMediaPending:false,conflictPending:1});
    await click('start');await waitFor(reason('尚未完成'));await delay(6500);
    assert.equal(await evaluate('fixture.stepClicks'),0,'an orange native task must hold an already-ended player');
    assert.equal(await evaluate('fixture.plays'),0,'an already-ended player must not be replayed');
    await evaluate("document.querySelector('#task-marker').textContent='任务点已完成'");
    await waitFor(reason('任务点已完成'));
    await evaluate("document.querySelector('#task-marker').textContent='任务点'");
    await waitFor(reason('尚未完成'));await delay(2300);
    assert.equal(await evaluate('fixture.stepClicks'),0,'a transient completed marker must not click practice');
    await evaluate(`(()=>{const frame=document.querySelector('#popup-frame');frame.style.cssText='display:block;width:700px;height:260px';frame.contentWindow.showRichTextLesson();document.querySelector('#task-marker').textContent='任务点已经完成';})()`);
    await delay(3500);assert.equal(await evaluate('fixture.stepClicks'),0,'a pending native task in another frame vetoes advancement');
    await click('autoNext');
    await evaluate("document.querySelector('#popup-frame').contentDocument.querySelector('.ans-attach-ct').classList.add('ans-job-finished')");
    await waitFor(reason('自动继续已关闭'));await delay(2300);
    assert.equal(await evaluate('fixture.stepClicks'),0);assert.equal(await evaluate('fixture.plays'),0);
    await evaluate("(()=>{const d=document.createElement('div');d.id='task-verification';d.setAttribute('role','dialog');d.textContent='请完成验证码';document.body.append(d)})()");
    await waitFor(reason('验证'));assert.equal(await evaluate('fixture.stepClicks'),0);
    await evaluate("document.querySelector('#task-verification').remove()");await click('autoNext');await click('start');
    await waitFor("fixture.step==='quiz'",16000);
    assert.equal(await evaluate('fixture.stepClicks'),1);assert.equal(await evaluate('fixture.next'),0);assert.equal(await evaluate('fixture.apiCalls'),0);assert.equal(await evaluate('fixture.submits'),0);
    console.log('PASS: native completed markers enter immediate practice without an ended event or replay; pending/hidden/catalog/quiz markers, transient state, opt-out and verification are handled');
    await evaluate(`(()=>{
      document.querySelector('#prevNextFocusNext').click();document.querySelector('#task-card').remove();
      const frame=document.querySelector('#popup-frame');frame.contentDocument.body.replaceChildren();frame.style.display='none';
      const video=document.querySelector('video'),card=document.createElement('div');card.id='task-card';card.className='ans-attach-ct ans-job-finished';video.before(card);card.innerHTML='<span class="ans-job-icon">任务点</span>';card.append(video);
      fixture.time=10;fixture.ended=true;fixture.paused=true;fixture.practiceAttempts=0;fixture.catalogAttempts=0;
      document.querySelector('#step-quiz').onclick=()=>fixture.practiceAttempts++;
      const tree=document.createElement('div');tree.id='coursetree';tree.innerHTML='<div class="posCatalog_select posCatalog_active"><span class="posCatalog_name">当前节</span></div><div class="posCatalog_select"><span class="posCatalog_name" id="unsafe-task-catalog">下一节</span></div>';document.body.append(tree);document.querySelector('#unsafe-task-catalog').onclick=()=>fixture.catalogAttempts++;
    })()`);
    await click('start');await waitFor('fixture.practiceAttempts===1',16000);
    await evaluate("(()=>{const original=Date.now;Date.now=()=>original()+16000})()");
    await waitFor(reason('页面未确认切换'));assert.equal(await evaluate('fixture.catalogAttempts'),0);assert.equal(await evaluate('fixture.next'),1);
    await evaluate("document.querySelector('#step-quiz').style.display='none';history.replaceState({},'','#missing-practice')");
    await click('start');await delay(8000);
    assert.equal(await evaluate('fixture.next'),1);assert.equal(await evaluate('fixture.catalogAttempts'),0);assert.equal(await evaluate('fixture.practiceAttempts'),1);
    console.log('PASS: failed or missing practice tabs never fall back to skipping the chapter after native completion');
    await command('Browser.close');return;
  }
  if(process.argv.includes('--courses-only')) {
    assert.equal(await evaluate('store.sessions[1].courseId'),'267029719');
    assert.equal(await evaluate('store.sessions[1].running'),false);
    assert.equal(await evaluate("document.querySelector('#xxt-player-assistant').shadowRoot.querySelector('#logs').textContent.includes('267029719')"),true);
    await click('start');await waitFor('!fixture.paused');
    await evaluate("(async()=>{fixture.courseId='266209950';await routeToWorker({channel:'xxt-player-v1',type:'HELLO',page:store.sessions[1].page});})()");
    await waitFor(reason('课程已切换为 266209950'));await waitFor('fixture.paused');
    assert.equal(await evaluate('store.sessions[1].running'),false);assert.equal(await evaluate('store.sessions[1].automation'),null);
    const plays=await evaluate('fixture.plays');await delay(1300);assert.equal(await evaluate('fixture.plays'),plays);
    await click('start');await waitFor('!fixture.paused');assert.equal(await evaluate('store.sessions[1].courseId'),'266209950');
    console.log('PASS: new course IDs initialize normally; switching to another course clears old state and waits for explicit start');
    await command('Browser.close');return;
  }
  if(process.argv.includes('--mouse-only')) {
    await evaluate("(()=>{fixture.mousePauses=0;fixture.moves=0;fixture.normalExits=0;const v=document.querySelector('video');for(const type of ['mouseout','mouseleave','pointerout','pointerleave'])v.addEventListener(type,()=>{fixture.mousePauses++;v.pause()});v.addEventListener('mousemove',()=>fixture.moves++);const input=document.createElement('input');input.id='normal-input';input.style.cssText='position:absolute;left:350px;top:300px;width:70px;height:30px';input.addEventListener('mouseout',()=>fixture.normalExits++);document.body.append(input);})()");
    await click('start');await waitFor('!fixture.paused');
    await waitFor("!!window[Symbol.for('xxt-player.mouseLeaveGuard')]");
    const point=selector=>evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    const videoPoint=await point('video');
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',...videoPoint},sessionId);
    const outside=await point('#normal-input');
    assert.equal(await evaluate(`document.elementFromPoint(${outside.x},${outside.y})?.id`),'normal-input','ordinary input must not be covered by the assistant panel');
    const plays=await evaluate('fixture.plays');
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',...outside},sessionId);await delay(1300);
    assert.equal(await evaluate('fixture.mousePauses'),0);assert.equal(await evaluate('fixture.plays'),plays,'leaving the player must not rely on another play call');
    assert.equal(await evaluate('fixture.paused'),false);assert.equal(await evaluate('fixture.moves>0'),true,'mousemove is not suppressed');
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:outside.x+180,y:outside.y},sessionId);
    assert.equal(await evaluate('fixture.normalExits>0'),true,'ordinary input mouse events remain available');
    await evaluate("(()=>{fixture.headerExits=0;fixture.browserBlurEvents=0;const header=document.createElement('div');header.id='mouse-exit-header';header.textContent='课程页面顶栏';header.style.cssText='position:fixed;left:0;top:0;width:430px;height:24px;background:#ccc';for(const type of ['mouseout','mouseleave','pointerout','pointerleave'])header.addEventListener(type,()=>{fixture.headerExits++;document.querySelector('video').pause()});document.body.append(header);window.addEventListener('blur',()=>fixture.browserBlurEvents++);})()");
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:100,y:12},sessionId);
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:100,y:-12},sessionId);
    await delay(1200);
    assert.equal(await evaluate('fixture.headerExits'),0,'viewport exit from an ordinary header must be intercepted, not only exits whose target is body/html');
    assert.equal(await evaluate('fixture.paused'),false);assert.equal(await evaluate('fixture.plays'),plays);
    await evaluate("(()=>{const child=document.querySelector('#xxt-player-assistant').shadowRoot.querySelector('#status');fixture.assistantExit=0;child.addEventListener('mouseout',()=>fixture.assistantExit++);child.dispatchEvent(new MouseEvent('mouseout',{bubbles:true,composed:true,relatedTarget:null}));window.dispatchEvent(new Event('blur'));})()");
    assert.equal(await evaluate('fixture.assistantExit'),0,'leaving the viewport from an assistant child also uses the null relatedTarget path');
    assert.equal(await evaluate('fixture.browserBlurEvents'),1,'genuine window blur is not suppressed');
    await evaluate("(()=>{const frame=document.createElement('iframe');frame.id='guard-card';frame.src='/knowledge/cards';document.body.append(frame);fixture.parentExits=0;document.addEventListener('mouseout',e=>{if(e.target===frame)fixture.parentExits++});frame.dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:document.body}));})()");
    assert.equal(await evaluate('fixture.parentExits'),0,'the outer card surface is protected too');
    const manualPoint=await point('#manual');
    await command('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...manualPoint},sessionId);
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...manualPoint},sessionId);
    await waitFor(reason('手动暂停'));await waitFor("!window[Symbol.for('xxt-player.mouseLeaveGuard')]");
    assert.equal(await evaluate('fixture.paused'),true);
    await click('start');await waitFor("!!window[Symbol.for('xxt-player.mouseLeaveGuard')]");
    await evaluate("(()=>{const b=document.createElement('button');b.id='learning-gate';b.textContent='继续学习';const r=document.querySelector('video').getBoundingClientRect();b.style.cssText='position:absolute;left:'+(r.left+80)+'px;top:'+(r.top+70)+'px';document.body.append(b)})()");
    await waitFor(reason('播放器要求确认'));await waitFor("!window[Symbol.for('xxt-player.mouseLeaveGuard')] && fixture.paused");
    await evaluate("document.querySelector('#learning-gate').remove()");await click('start');await waitFor("!!window[Symbol.for('xxt-player.mouseLeaveGuard')]");
    await click('mouseGuard');await waitFor("!window[Symbol.for('xxt-player.mouseLeaveGuard')]");
    const before=await evaluate('fixture.mousePauses');
    await evaluate("document.querySelector('video').dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:document.body}))");
    assert.equal(await evaluate('fixture.mousePauses'),before+1,'turning the option off restores original listeners');
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:100,y:12},sessionId);
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:100,y:-12},sessionId);
    await delay(150);
    assert.equal(await evaluate('fixture.headerExits>0'),true,'the same real viewport exit must reach the original header listener after opt-out');
    console.log('PASS: trusted player/header viewport exit no longer pauses/replays, normal movement and blur remain, manual pause and learning gate work, and opt-out restores both paths');
    await command('Browser.close');return;
  }
  if(process.argv.includes('--lesson-resources-only')) {
    await click('autoQuiz');
    await evaluate("document.querySelector('video').remove();document.querySelector('#step-video').textContent='1';fixture.step='lesson'");
    await evaluate("(()=>{const f=document.querySelector('#popup-frame');f.style.cssText='display:block;width:700px;height:400px';f.contentWindow.showRichTextLesson();const doc=f.contentDocument;doc.querySelector('.ans-attach-ct').remove();const root=doc.querySelector('article');root.insertAdjacentHTML('beforeend','<object id=\"empty-object\" style=\"width:100px;height:80px\"></object><embed src=\"about:blank\" style=\"width:80px;height:60px\"><div id=\"panView\"></div><iframe src=\"/ananas/modules/video/index.html\" style=\"display:none\"></iframe>');const image=doc.createElement('object');image.type='image/png';const canvas=document.createElement('canvas');canvas.width=30;canvas.height=30;image.data=canvas.toDataURL();image.style.cssText='width:100px;height:80px';root.append(image);const aux=doc.createElement('embed');aux.src='/auxiliary-helper.bin';aux.style.cssText='width:40px;height:40px';doc.body.append(aux);})()");
    await evaluate("(()=>{const doc=document.querySelector('#popup-frame').contentDocument;const el=doc.createElement('object');el.data='/auxiliary-object.bin';el.style.cssText='width:80px;height:60px';doc.querySelector('article').append(el);})()");
    assert.equal(await evaluate("document.querySelector('#popup-frame').contentWindow.XXTLesson.scan().ready"),true,'hidden media, image objects, empty placeholders and unclassified helpers must not block a text lecture');
    assert.equal(await evaluate("document.querySelector('#popup-frame').contentWindow.XXTLesson.scan().resourceCounts.ignoredImages"),1);
    await evaluate("(()=>{const doc=document.querySelector('#popup-frame').contentDocument;const pdf=doc.createElement('object');pdf.id='actual-pdf';pdf.type='application/pdf';pdf.data='/visible-resource.pdf?token=do-not-log';pdf.style.cssText='width:240px;height:180px';doc.querySelector('article').append(pdf);})()");
    assert.equal(await evaluate("document.querySelector('#popup-frame').contentWindow.XXTLesson.scan().ready"),false,'a genuine visible PDF still requires handling');
    await waitFor("document.querySelector('#xxt-player-assistant').shadowRoot.querySelector('#detail').textContent.includes('PDF 文档')");
    const diagnostic=await evaluate("(async()=>{const s=await routeToWorker({channel:'xxt-player-v1',page:store.sessions[1].page,type:'REPORT',videos:[]});return s;})()");
    assert.equal(JSON.stringify(diagnostic).includes('do-not-log'),false);
    assert.equal(diagnostic.lessonMediaReasons.some(s=>s.endsWith(':pdf-object')),true);
    await evaluate("(()=>{const doc=document.querySelector('#popup-frame').contentDocument;const pdf=doc.querySelector('#actual-pdf'),wrap=doc.createElement('div');wrap.className='ans-attach-ct ans-job-finished';pdf.before(wrap);wrap.append(pdf);})()");
    assert.equal(await evaluate("document.querySelector('#popup-frame').contentWindow.XXTLesson.scan().ready"),true,'native completed attachment does not remain pending');
    await click('start');await waitFor("fixture.step==='quiz'",17000);
    assert.equal(await evaluate('fixture.apiCalls'),0);assert.equal(await evaluate('fixture.next'),0);
    console.log('PASS: lecture auxiliary resources reproduce the old false blocker, genuine visible PDF still blocks with safe diagnostics, completed resources allow the immediate exercise');
    await command('Browser.close');return;
  }
  if(process.argv.includes('--lesson-only')) {
    await click('autoQuiz');
    await evaluate("document.querySelector('video').remove();document.querySelector('#step-video').textContent='1';fixture.step='lesson'");
    await click('start');await delay(6500);
    assert.equal(await evaluate('fixture.stepClicks'),0,'an empty or unknown page must not enter exercises');
    await evaluate("(()=>{const f=document.querySelector('#popup-frame');f.style.cssText='display:block;width:700px;height:400px';f.contentWindow.showRichTextLesson()})()");
    await waitFor("document.querySelector('#xxt-player-assistant').shadowRoot.querySelector('#detail').textContent.includes('未完成任务点')");
    await delay(6000);assert.equal(await evaluate('fixture.stepClicks'),0);
    await evaluate("document.querySelector('#popup-frame').contentDocument.querySelector('.ans-attach-ct').classList.add('ans-job-finished')");
    assert.equal(await evaluate("document.querySelector('#popup-frame').contentWindow.XXTLesson.scan().ready"),true);
    await evaluate("(()=>{const doc=document.querySelector('#popup-frame').contentDocument;const frame=doc.createElement('iframe');frame.src='/ananas/modules/video/index.html';frame.id='pending-video';doc.querySelector('article').append(frame)})()");
    assert.equal(await evaluate("document.querySelector('#popup-frame').contentWindow.XXTLesson.scan().ready"),false,'a pending video iframe is not a plain article');
    await evaluate("document.querySelector('#popup-frame').contentDocument.querySelector('#pending-video').remove()");
    await evaluate("(()=>{const doc=document.querySelector('#popup-frame').contentDocument;const img=doc.createElement('img');img.id='lesson-image';img.style.cssText='width:40px;height:40px';img.src='data:image/png;base64,AAAA';doc.querySelector('article').append(img)})()");
    assert.equal(await evaluate("document.querySelector('#popup-frame').contentWindow.XXTLesson.scan().loadingImages"),true);
    await evaluate("(async()=>{const img=document.querySelector('#popup-frame').contentDocument.querySelector('#lesson-image');const canvas=document.createElement('canvas');canvas.width=40;canvas.height=40;img.src=canvas.toDataURL();await img.decode();})()");
    assert.equal(await evaluate("document.querySelector('#popup-frame').contentWindow.XXTLesson.scan().ready"),true);
    await click('autoNext');await delay(6000);assert.equal(await evaluate('fixture.stepClicks'),0,'auto next disabled must hold the lecture');
    await click('autoNext');
    await waitFor("fixture.step==='quiz'",15000);
    assert.equal(await evaluate('fixture.next'),0,'the lecture must enter exercises instead of the next chapter');
    assert.equal(await evaluate('fixture.apiCalls'),0,'the lecture itself must not be sent to the model');
    assert.equal(await evaluate('fixture.stepClicks'),1);
    await evaluate("(()=>{document.querySelector('#quiz').remove();fixture.step='lesson';document.querySelector('#step-video').className='prev_blue';document.querySelector('#step-quiz').className='prev_white';const frame=document.querySelector('#popup-frame');frame.style.cssText='display:block;width:700px;height:400px';frame.contentWindow.showRichTextLesson();frame.contentDocument.querySelector('.ans-attach-ct').classList.add('ans-job-finished');fixture.blockedPracticeClicks=0;document.querySelector('#step-quiz').onclick=()=>fixture.blockedPracticeClicks++;const tree=document.createElement('div');tree.id='coursetree';tree.innerHTML='<div class=\"posCatalog_select posCatalog_active\"><span class=\"posCatalog_name\">当前节</span></div><div class=\"posCatalog_select\"><span class=\"posCatalog_name\" id=\"unsafe-fallback\">下一节</span></div>';document.body.append(tree);fixture.catalogClicks=0;document.querySelector('#unsafe-fallback').onclick=()=>fixture.catalogClicks++;})()");
    await click('start');await waitFor('fixture.blockedPracticeClicks===1',18000);
    await evaluate("(()=>{const original=Date.now;Date.now=()=>original()+16000})()");
    await waitFor(reason('页面未确认切换'));
    assert.equal(await evaluate('fixture.catalogClicks'),0,'a failed practice tab must not fall back to skipping the chapter');
    console.log('PASS: cross-frame text lesson enters the immediate exercise tab only after readiness; empty pages, unfinished tasks, pending media and disabled auto-next are held');
    await command('Browser.close');return;
  }
  if(process.argv.includes('--font-only')) {
    await click('autoQuiz');await click('randomFallback');await evaluate('showQuiz()');
    await waitFor("document.querySelector('#xxt-player-assistant').shadowRoot.querySelector('#detail').textContent.includes('6 道')");
    await evaluate("(async()=>{const face=new FontFace('font-cxsecret','local(\"Wingdings\")');await face.load();document.fonts.add(face);const title=document.querySelector('.fontLabel');title.classList.add('font-cxsecret');title.style.fontFamily='font-cxsecret';title.textContent='ii';fixture.encryptedImage=(await XXTQuiz.read()).questions[0].image;title.style.fontFamily='sans-serif';fixture.plainImage=(await XXTQuiz.read()).questions[0].image;title.style.fontFamily='font-cxsecret';})()");
    assert.equal(await evaluate('fixture.encryptedImage===fixture.plainImage'),false,'question image must use actual page glyphs rather than raw text with a generic font');
    assert.equal(await evaluate('XXTQuiz.scan().questions[0].encrypted'),true);
    if(process.argv.includes('--capture-instruction')) {
      const image=await evaluate("(async()=>{const node=document.createElement('p');node.textContent='[简答题] 简述指令和程序的区别？';node.style.fontFamily='Microsoft YaHei';document.body.append(node);try{return await XXTQuestionImage.render([{label:'题目 q1（short）',el:node}]);}finally{node.remove();}})()");
      fs.mkdirSync(path.join(root,'.local'),{recursive:true});
      fs.writeFileSync(path.join(root,'.local','instruction-visual.json'),JSON.stringify([{id:'q1',type:'short',stem:'不可作为原文使用',options:[],encrypted:true,image}]));
    }
    await evaluate("(()=>{const base=window.fetch;fixture.visionCalls=0;window.fetch=async(url,options)=>{const body=JSON.parse(options.body);if(Array.isArray(body.messages?.[1]?.content)){fixture.visionCalls++;const meta=JSON.parse(body.messages[1].content[0].text);const json=JSON.stringify({id:meta.id,readable:!fixture.ocrFail,stem:'单选题：1+1 等于多少？',options:[{key:'A',text:'2'},{key:'B',text:'3'}]});const content=fixture.visionCalls===1?'':'```json\\n'+json+'\\n```';return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content}}]}),{status:200});}fixture.lastThinking=body.thinking;fixture.lastEffort=body.reasoning_effort;return base(url,options);};})()");
    await click('aiSolve');await waitFor("document.querySelector('#xxt-player-assistant').shadowRoot.querySelector('#answers').textContent.includes('q6')",15000);
    assert.equal(await evaluate('fixture.visionCalls'),2);assert.equal(await evaluate('fixture.apiCalls'),2);
    assert.equal(await evaluate('fixture.lastThinking.type'),'enabled');assert.equal(await evaluate('fixture.lastEffort'),'high');
    assert.equal(await evaluate("document.querySelector('#xxt-player-assistant').shadowRoot.querySelector('#answers').textContent.includes('读取题干：单选题：1+1 等于多少')"),true);
    await click('aiApply');await waitFor("document.querySelector('#xxt-player-assistant').shadowRoot.querySelector('#answers').textContent.includes('已填入 6 题')",12000);
    await evaluate('fixture.ocrFail=true');await click('aiSolve');await waitFor("document.querySelector('#xxt-player-assistant').shadowRoot.querySelector('#answers').textContent.includes('已停止作答')");
    assert.equal(await evaluate('fixture.visionCalls'),3,'readable=false must stop without another visual retry');
    assert.equal(await evaluate('fixture.apiCalls'),2);assert.equal(await evaluate('fixture.submits'),0);
    console.log('PASS: page glyphs change the image; empty visual content retries once, fenced JSON precedes high-thinking answers, uncertain OCR stops without answering or submitting');
    await command('Browser.close');return;
  }
  if(process.argv.includes('--foreground-only')) {
    assert.equal(await evaluate("Object.hasOwn(document,'hidden')"),false);
    await click('foregroundCompat');await click('start');await waitFor("Object.hasOwn(document,'hidden')");
    assert.equal(await evaluate('document.hidden'),false);assert.equal(await evaluate('document.visibilityState'),'visible');assert.equal(await evaluate('document.hasFocus()'),true);
    await click('pause');await waitFor("!Object.hasOwn(document,'hidden')");assert.equal(await evaluate("Object.hasOwn(document,'hasFocus')"),false);
    await click('start');await waitFor("Object.hasOwn(document,'hidden')");
    await evaluate("(()=>{const b=document.createElement('button');b.textContent='继续学习';const r=document.querySelector('video').getBoundingClientRect();b.style.cssText='position:absolute;left:'+(r.left+60)+'px;top:'+(r.top+60)+'px';document.body.append(b)})()");
    await waitFor(reason('播放器要求确认'));await waitFor("!Object.hasOwn(document,'hidden') && fixture.paused");
    console.log('PASS: optional visibility/focus reads are changed only while running; pause and learning acknowledgement restore native document properties');
    await command('Browser.close');return;
  }
  if(process.argv.includes('--continuation-only')) {
    await click('start');await waitFor('!fixture.paused');
    await evaluate("(()=>{const v=document.querySelector('video'),wrap=document.createElement('div');wrap.className='video-js';wrap.style.display='inline-block';v.before(wrap);wrap.append(v);const b=document.createElement('button');b.id='hidden-continue';b.textContent='继续学习';b.style.opacity='0';wrap.append(b)})()");
    assert.equal(await evaluate('XXTQuiz.blocker()'),'','a player wrapper cannot turn its hidden child button into a visible gate');
    await evaluate("document.querySelector('#hidden-continue').remove()");
    await evaluate("(()=>{const link=document.createElement('a');link.id='unrelated-continue';link.textContent='继续学习';link.style.cssText='position:absolute;left:700px;top:400px';document.body.append(link)})()");
    assert.equal(await evaluate('XXTQuiz.blocker()'),'','an unrelated course link is not a player overlay');
    await evaluate("(()=>{const gate=document.createElement('div');gate.id='learning-gate';gate.textContent='继续学习';const r=document.querySelector('video').getBoundingClientRect();gate.style.cssText='position:absolute;left:'+(r.left+100)+'px;top:'+(r.top+80)+'px;background:white;padding:8px';fixture.gateClicks=0;gate.onclick=()=>{fixture.gateClicks++;gate.remove()};document.body.append(gate)})()");
    await evaluate("document.querySelector('#learning-gate').style.opacity='0'");
    assert.equal(await evaluate('XXTQuiz.blocker()'),'','an invisible retained control must not block playback');
    await evaluate("document.querySelector('#learning-gate').style.opacity='1'");
    await waitFor(reason('播放器要求确认'));await waitFor('fixture.paused');
    const plays=await evaluate('fixture.plays');
    await click('start');await click('next');await delay(1800);
    assert.equal(await evaluate('fixture.plays'),plays,'start cannot override a still-present gate');
    assert.equal(await evaluate('fixture.next'),0,'navigation cannot skip the gate');
    assert.equal(await evaluate('fixture.gateClicks'),0,'assistant never clicks the presence acknowledgement');
    await evaluate("fixture.time=10;fixture.ended=true;document.querySelector('video').dispatchEvent(new Event('ended'))");
    await delay(1200);assert.equal(await evaluate('fixture.next'),0);
    assert.equal(await evaluate("store.sessions[1].running"),false);
    assert.equal(await evaluate("document.querySelector('#xxt-player-assistant').shadowRoot.querySelector('#detail').textContent.includes('已结束 0 个')"),true);
    const rect=await evaluate("(()=>{const r=document.querySelector('#learning-gate').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
    await command('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...rect},sessionId);
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...rect},sessionId);
    assert.equal(await evaluate('fixture.gateClicks'),1);await delay(1200);
    assert.equal(await evaluate('fixture.plays'),plays,'removing the gate alone does not resume automation');
    await evaluate('fixture.time=2;fixture.ended=false');await click('start');await waitFor('!fixture.paused');
    await evaluate("(()=>{const f=document.querySelector('#popup-frame');f.style.display='block';f.contentWindow.showLearningGate()})()");
    await waitFor(reason('播放器要求确认'));await waitFor('fixture.paused');
    assert.equal(await evaluate('fixture.gateClicks'),1,'a gate in another frame is not auto-clicked either');
    console.log('PASS: player continuation gate pauses real media state, blocks resume/navigation/completion, requires manual acknowledgement and coordinates across frames');
    await command('Browser.close');return;
  }
  if(process.argv.includes('--review-only')) {
    await evaluate("(()=>{const marker=document.createElement('div');marker.className='testTit_status testTit_status_complete';marker.id='native-complete';marker.textContent='✓';document.body.append(marker)})()");
    assert.equal(await evaluate('XXTQuiz.scan().completed'),true,'native completion class does not require status text');
    await evaluate("document.querySelector('#native-complete').remove()");
    await click('autoQuiz');await evaluate('showQuiz()');
    assert.equal(await evaluate('XXTQuiz.scan().completed'),false,'editable quiz is not a result');
    await evaluate("document.querySelectorAll('.singleQuesId').forEach(q=>{const p=document.createElement('p');p.className='xxt-ai-explanation';p.innerHTML='<strong>我的答案：</strong> A 100 分';q.append(p)})");
    assert.equal(await evaluate('XXTQuiz.scan().completed'),false,'AI explanations cannot prove completion');
    await evaluate('showReview()');
    assert.equal(await evaluate('XXTQuiz.scan().completed'),true);
    assert.equal(await evaluate('XXTQuiz.scan().count'),0,'read-only results must never become new API questions');
    assert.equal(await evaluate('XXTQuiz.scan().evidence'),'answer-review');
    assert.equal(await evaluate('XXTNavigation.next().id'),'review-next');
    await evaluate("(()=>{const d=document.createElement('button');d.textContent='下一节';document.querySelector('.TiMu').prepend(d);const q=document.createElement('button');q.textContent='下一题';document.body.prepend(q)})()");
    assert.equal(await evaluate('XXTNavigation.next().id'),'review-next','question content and next-question controls are not chapter navigation');
    await evaluate("(()=>{const b=document.createElement('button');b.id='edit-submit';b.textContent='提交';document.querySelector('#quiz').append(b)})()");
    assert.equal(await evaluate('XXTQuiz.scan().completed'),false,'an active submission form is not a completed review');
    await evaluate("document.querySelector('#edit-submit').remove();document.querySelectorAll('.answer-box span').forEach(el=>el.textContent='待批阅')");
    assert.equal(await evaluate('XXTQuiz.scan().completed'),true,'pending grading is still submitted');
    await click('start');await waitFor('fixture.next===1',18000);await waitFor('!fixture.paused');
    assert.equal(await evaluate('fixture.apiCalls'),0);assert.equal(await evaluate('fixture.submits'),0);
    await evaluate("(()=>{const warning=document.createElement('div');warning.setAttribute('role','alert');warning.textContent='检测到异常学习，请手动完成当前任务';document.body.append(warning)})()");
    await waitFor(reason('风险提示'));assert.equal(await evaluate('fixture.paused'),true);
    console.log('PASS: read-only graded/pending review advances with zero API calls or resubmissions; platform risk warning pauses');
    await command('Browser.close');return;
  }
  if(process.argv.includes('--editor-only')) {
    await click('autoQuiz');await evaluate('showQuiz()');
    await waitFor("document.querySelector('#xxt-player-assistant').shadowRoot.querySelector('#detail').textContent.includes('6 道')");
    await click('aiSolve');await waitFor("document.querySelector('#xxt-player-assistant').shadowRoot.querySelector('#answers').textContent.includes('q6')");
    await click('aiApply');await waitFor("document.querySelector('#xxt-player-assistant').shadowRoot.querySelector('#answers').textContent.includes('已填入 6 题')",12000);
    assert.equal(await evaluate("UE.instants.shortEditor.getContentTxt().includes(String.fromCharCode(10))"),false);
    assert.equal(await evaluate("fixture.shortAnswer.includes(String.fromCharCode(10))"),true);
    const valid=await evaluate("XXTQuiz.scan().items.find(q=>q.type==='short').id");assert.equal(valid,'q6');
    const negative=await evaluate("(async()=>{const scan=XXTQuiz.scan();const answers=scan.questions.map(q=>({id:q.id,answer:q.type==='short'?[fixture.shortAnswer]:q.type==='multiple'?['A','B']:['A']}));const result=await XXTQuiz.apply(scan.fingerprint,answers,async()=>({ok:true,text:fixture.shortAnswer,domText:fixture.shortAnswer,fieldFound:true,fieldText:''}));return result;})()");
    assert.deepEqual(negative.failed,['q6']);assert.equal(negative.details.find(d=>d.id==='q6').code,'SYNC_FIELD_MISMATCH');
    assert.equal(await evaluate('fixture.submits'),0);
    console.log('PASS: real UEditor textContent-style readback accepts multiline answers and rejects an unsynced field');
    await command('Browser.close');return;
  }
  if(process.argv.includes('--confirm-only')) {
    await click('start');await waitFor('!fixture.paused');
    await evaluate('fixture.useConfirmation=true;fixture.injectBadIds=true;showQuiz()');
    await waitFor('fixture.next===1',30000);
    assert.equal(await evaluate('fixture.confirmations'),1);assert.equal(await evaluate('fixture.lastConfirmFrame'),77);
    assert.equal(await evaluate("fixture.phases.some(p=>p.status==='awaiting_confirmation'&&p.message.includes('首次提交'))"),true);
    console.log('PASS: delayed cross-frame confirmation and next chapter');
    await command('Browser.close');return;
  }
  await click('autoQuiz');
  await click('randomFallback');
  await waitFor("!document.querySelector('#xxt-player-assistant').shadowRoot.querySelector('#autoQuiz').checked");
  await evaluate("document.querySelector('video').play()");
  await delay(1300);
  assert.equal(await evaluate("fixture.paused"), false, "idle assistant must not pause manual playback");
  await evaluate("document.querySelector('video').pause()");
  await evaluate("document.querySelector('video').playbackRate=2");
  await click("start");
  await waitFor("fixture.plays >= 2");
  assert.equal(await evaluate("document.querySelector('video').playbackRate"), 2, "default must preserve the native player's rate");
  console.log("PASS: panel mounts, idle respects playback, start plays");
  const rate = value => evaluate(`(()=>{const s=document.querySelector('#xxt-player-assistant').shadowRoot.querySelector('#playbackRate');s.value='${value}';s.dispatchEvent(new Event('change'))})()`);
  await rate(1.5);
  await waitFor("document.querySelector('video').playbackRate===1.5");
  await rate(0);
  await waitFor("document.querySelector('#xxt-player-assistant').shadowRoot.querySelector('#playbackRate').value==='0'");
  await evaluate("document.querySelector('video').playbackRate=1.25");
  await delay(1300);
  assert.equal(await evaluate("document.querySelector('video').playbackRate"), 1.25, "follow mode must preserve native speed changes");
  await rate(2);
  await waitFor("document.querySelector('video').playbackRate===2");
  console.log("PASS: native speed is preserved; 1.5x, follow player and 2x controls work");
  const plays = await evaluate("fixture.plays");
  await evaluate("document.querySelector('video').pause()");
  await waitFor(`fixture.plays > ${plays}`);
  assert.equal(await evaluate("document.querySelector('video').playbackRate"), 2, "resume must preserve the selected rate");
  console.log("PASS: unexpected pause resumes");
  await click("pause");
  await waitFor("fixture.paused");
  await delay(2400);
  assert.equal(await evaluate("fixture.paused"), true);
  await click("start");
  await waitFor("!fixture.paused");
  const rect = await evaluate("(()=>{const r=document.querySelector('#manual').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
  await command("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...rect }, sessionId);
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...rect }, sessionId);
  await waitFor(reason("手动暂停"));
  await delay(2400);
  assert.equal(await evaluate("fixture.paused"), true);
  console.log("PASS: assistant pause and trusted player pause are respected");
  await click("start");
  await waitFor("!fixture.paused");
  await evaluate("(()=>{const d=document.createElement('div');d.id='test-dialog';d.setAttribute('role','dialog');d.textContent='请完成验证码';document.body.append(d)})()");
  await waitFor(reason("验证"));
  await waitFor("fixture.paused");
  console.log("PASS: visible verification stops playback");
  await evaluate("document.querySelector('#test-dialog').remove()");
  await click("start");
  await waitFor("!fixture.paused");
  await evaluate("fixture.time=9;document.querySelector('video').dispatchEvent(new Event('timeupdate'));fixture.time=9.5;document.querySelector('video').dispatchEvent(new Event('timeupdate'));fixture.time=10;fixture.ended=true;fixture.paused=true;document.querySelector('video').dispatchEvent(new Event('ended'))");
  await waitFor("fixture.step === 'quiz'", 13000);
  assert.equal(await evaluate('fixture.next'),0,'video must enter its exercise before the next chapter');
  await waitFor("document.querySelector('#xxt-player-assistant').shadowRoot.querySelector('#detail').textContent.includes('6 道')");
  assert.equal(await evaluate('XXTQuiz.blocker()'),'','a regular quiz wrapper must not trigger the popup guard');
  console.log("PASS: ended video enters the exercise tab; quiz is recognized instead of reported as empty");
  await click('aiSolve');
  await waitFor("document.querySelector('#xxt-player-assistant').shadowRoot.querySelector('#answers').textContent.includes('q6')");
  assert.equal(await evaluate('fixture.apiCalls'),2);
  await click('aiApply');
  await waitFor("document.querySelector('#xxt-player-assistant').shadowRoot.querySelector('#answers').textContent.includes('已填入 6 题')");
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.singleQuesId')].slice(0,5).map(q=>[...q.querySelectorAll('li[aria-checked=true]')].map(o=>o.querySelector('.num_option').textContent).join(''))"),['A','AB','A','A','A']);
  assert.equal(await evaluate("document.querySelector('#answerEditor4').value.includes('运算器')"),true);
  assert.equal(await evaluate('fixture.synced > 0'),true,'rich text editor must sync its hidden backing field');
  assert.equal(await evaluate("UE.instants.shortEditor.getContentTxt().includes(String.fromCharCode(10))"),false);
  assert.equal(await evaluate("fixture.shortAnswer.includes(String.fromCharCode(10))"),true);
  assert.equal(await evaluate('fixture.submits'),0,'AI fill must not submit the exercise');
  assert.equal(await evaluate('fixture.next'),0,'unsubmitted exercises must not be skipped');
  console.log("PASS: choices and short-answer UEditor are filled and synced; manual mode does not submit");
  await evaluate("document.querySelector('#submit').click()");
  await waitFor('fixture.next === 1',20000);
  await waitFor("!fixture.paused && fixture.step === 'next-video'");
  assert.equal(await evaluate("document.querySelector('video').playbackRate"),2);
  console.log("PASS: submitted exercise advances to the next chapter and resumes its new video at 2x");
  await evaluate('fixture.useConfirmation=true;fixture.injectBadIds=true');
  await click('autoQuiz');
  await evaluate('showQuiz()');
  await waitFor('fixture.next === 2',30000);
  await waitFor("!fixture.paused && fixture.step === 'next-video'");
  assert.equal(await evaluate('fixture.submits'),2);
  assert.equal(await evaluate('fixture.confirmations'),1);
  assert.equal(await evaluate('fixture.lastConfirmFrame'),77,'confirmation must execute in the popup owner frame');
  assert.equal(await evaluate("fixture.phases.some(p=>p.status==='awaiting_confirmation'&&p.message.includes('首次提交'))"),true);
  assert.equal(await evaluate("fixture.phases.some(p=>p.message.includes('已自动提交'))"),false);
  assert.equal(await evaluate('fixture.apiCalls'),6,'only two ambiguous IDs should be retried, plus the separate q6 batch');
  assert.equal(await evaluate("fixture.lastSubmittedText.includes('运算器') && fixture.lastSubmittedText.includes('输出设备')"),true);
  await delay(1300);
  assert.equal(await evaluate('fixture.submits'),2);
  console.log('PASS: delayed unlabelled confirmation in a different frame is clicked once, status stays truthful and the next video starts');
  await click("stop");
  await delay(1200);
  await evaluate("document.querySelector('video').play()");
  await delay(1300);
  assert.equal(await evaluate("fixture.paused"), false, "stopped assistant must release control");
  console.log("PASS: stop releases control");
  await evaluate("document.querySelector('#steps').remove();document.querySelector('#prevNextFocusNext').remove();(()=>{const tree=document.createElement('div');tree.id='coursetree';tree.innerHTML='<div class=\"posCatalog_select posCatalog_active\"><span class=\"posCatalog_name\">当前节</span></div><div class=\"posCatalog_select\" style=\"display:none\"><span class=\"posCatalog_name\" id=\"next-catalog\">下一节</span></div>';document.body.append(tree);fixture.catalogClicks=0;document.querySelector('#next-catalog').onclick=()=>fixture.catalogClicks++})()");
  await click('next');
  await waitFor('fixture.catalogClicks === 1');
  console.log('PASS: navigation falls back to the next catalog entry, including collapsed groups');
  await click('start');
  await evaluate("(()=>{const dialog=document.createElement('div');dialog.className='maskDiv jobFinishTip';dialog.textContent='当前章节还有任务点未完成';document.body.append(dialog)})()");
  await waitFor(reason('未完成'));
  console.log('PASS: unfinished-task overlay stops automatic navigation');
  await command("Browser.close");
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (ws) ws.close();
  if (child && child.exitCode === null) child.kill();
  server.close();
  await delay(600);
  // Only the exact temporary profile created above is ever removed.
  if (path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith("xxt-edge-test-")) {
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Edge may still hold a lock. */ }
  }
});
