'use strict';
// Real extension-page smoke test in a new temporary profile; remote sites mapped to localhost.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process'),assert=require('node:assert/strict');
const extension=path.resolve(__dirname,'..','edge-extension'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'xxt-launch-page-')),edge='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const delay=ms=>new Promise(r=>setTimeout(r,ms));let child,ws;
async function main(){
 child=spawn(edge,['--headless=new','--no-first-run','--no-default-browser-check','--disable-gpu','--no-proxy-server','--host-resolver-rules=MAP *.chaoxing.com 127.0.0.1,MAP api.deepseek.com 127.0.0.1','--disable-extensions-except='+extension,'--load-extension='+extension,'--enable-unsafe-extension-debugging','--remote-debugging-port=0','--remote-allow-origins=*','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
 const endpoint=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Edge timed out')),15000);child.stderr.on('data',b=>{output+=b;const m=output.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.once('error',reject);});
 ws=new WebSocket(endpoint.replace('localhost','127.0.0.1'));await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});let id=0;const pending=new Map(),errors=[];let handleFetch;
 ws.onmessage=e=>{const msg=JSON.parse(e.data);if(msg.method==='Fetch.requestPaused'){void handleFetch(msg).catch(error=>errors.push('Mock response: '+error.message));return;}if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);const item=pending.get(msg.id);if(!item)return;pending.delete(msg.id);msg.error?item.reject(Error(JSON.stringify(msg.error))):item.resolve(msg.result);};
 const command=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params,...(sessionId?{sessionId}:{})}));});
 await delay(1200);let targets=(await command('Target.getTargets')).targetInfos;let worker=targets.find(t=>t.type==='service_worker'&&t.url.endsWith('/background.js'));
 if(!worker){const loaded=await command('Extensions.loadUnpacked',{path:extension});await delay(600);targets=(await command('Target.getTargets')).targetInfos;worker=targets.find(t=>t.type==='service_worker'&&t.url.includes(loaded.id));}
 assert.ok(worker,'real unpacked extension worker must load');const extensionId=new URL(worker.url).host;
 const {targetId}=await command('Target.createTarget',{url:'chrome-extension://'+extensionId+'/launcher.html'}),{sessionId}=await command('Target.attachToTarget',{targetId,flatten:true});
 await command('Runtime.enable',{},sessionId);const evaluate=async expression=>{const r=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);return r.result.value;};

 const wait=async(expression,run=evaluate)=>{const end=Date.now()+7000;do{if(await run(expression))return;await delay(100);}while(Date.now()<end);throw Error('Timed out: '+expression+'; status='+await run('document.querySelector("#status")?.textContent'));};
 await wait('document.querySelector("#begin")?.disabled===false');
 const previousTargets=new Set((await command('Target.getTargets')).targetInfos.map(t=>t.targetId));
 await evaluate('document.querySelector("#begin").click()');await wait('document.querySelector("#status").textContent.includes("正在检查登录状态")');
 assert.equal(await evaluate('document.querySelector("#begin").disabled'),true);

 // Replay the reported QR -> v1/manage landing using mock responses at real HTTPS origins.
 const pages={"v8.chaoxing.com/":"<h1>模拟登录</h1><button id=\"qr-tab\" onclick=\"window.qrSelected=true\">扫码登录</button><input type=\"password\"><button id=\"scan-success\" onclick=\"location.href='https://v1.chaoxing.com/manage?ws=1'\">模拟扫码成功</button>","v1.chaoxing.com/manage":"<p>您暂无权限使用该后台，<a href=\"https://i.chaoxing.com/base?vflag=true&fid=&backUrl=\">点击这里进入个人空间</a></p>","i.chaoxing.com/base":"<h1>我学的课</h1><article class=\"course\"><a href=\"https://mooc1.chaoxing.com/visit/stucoursemiddle?courseid=42&clazzid=7&cpi=fixture-only&ismooc2=1&v=2\"><div style=\"width:200px;height:100px\">课程封面</div></a><span class=\"course-name\" title=\"C language\">C language</span><span>任务点进度:1/2</span></article>","mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu":"<button id=\"chapter-menu\">章节</button><div id=\"chapters\"></div><script>document.getElementById(\"chapter-menu\").onclick=()=>{document.getElementById(\"chapters\").innerHTML=\"<div class=\\\"chapter_item\\\" data-knowledgeid=\\\"8\\\"><span class=\\\"catalog_task\\\"><i class=\\\"icon_yiwanc\\\"></i></span><a class=\\\"catalog_name\\\">已完成</a></div><div class=\\\"chapter_item\\\" data-knowledgeid=\\\"9\\\"><span class=\\\"catalog_task\\\"><i class=\\\"catalog_points_yi\\\">1</i></span><a class=\\\"catalog_name\\\" href=\\\"https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=42&clazzid=7&chapterId=9\\\">待完成</a></div>\";};</script>","mooc1.chaoxing.com/mycourse/studentstudy":"<h1>本地模拟学习页</h1>","mooc1.chaoxing.com/visit/stucoursemiddle":"REDIRECT"},routes=[];
 handleFetch=async msg=>{const u=new URL(msg.params.request.url),key=u.hostname+u.pathname,html=pages[key];if(msg.params.resourceType==='Document')routes.push(key);if(key==='mooc1.chaoxing.com/visit/stucoursemiddle'){await command('Fetch.fulfillRequest',{requestId:msg.params.requestId,responseCode:302,responseHeaders:[{name:'location',value:"https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu?courseid=42&clazzid=7"}],body:''},msg.sessionId);return;}await command('Fetch.fulfillRequest',{requestId:msg.params.requestId,responseCode:html?200:404,responseHeaders:[{name:'content-type',value:'text/html; charset=utf-8'}],body:Buffer.from('<!doctype html><meta charset="utf-8">'+(html || '')).toString('base64')},msg.sessionId);};
 const owned=(await command('Target.getTargets')).targetInfos.find(t=>!previousTargets.has(t.targetId) && t.type==='page' && t.url.startsWith('https://i.chaoxing.com/'));
 assert.ok(owned,'launcher must create its own portal tab');const studySession=(await command('Target.attachToTarget',{targetId:owned.targetId,flatten:true})).sessionId;
 const studyEval=async expression=>{const r=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},studySession);if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);return r.result.value;};
 await command('Runtime.enable',{},studySession);await command('Fetch.enable',{patterns:[{urlPattern:'https://*.chaoxing.com/*'}]},studySession);
 await command('Page.navigate',{url:'https://v8.chaoxing.com/'},studySession);await wait('window.qrSelected===true',studyEval);
 await studyEval('document.querySelector("#scan-success").click()');
 await wait('location.hostname==="mooc1.chaoxing.com" && location.pathname==="/mycourse/studentstudy" && !!document.querySelector("#xxt-player-assistant")',studyEval);
 await wait('chrome.storage.session.get("launchFlows").then(s=>s.launchFlows.normal.phase==="started")');
 assert.deepEqual(routes.filter(key=>key in pages),['v8.chaoxing.com/','v1.chaoxing.com/manage','i.chaoxing.com/base','mooc1.chaoxing.com/visit/stucoursemiddle','mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu','mooc1.chaoxing.com/mycourse/studentstudy']);
 assert.equal(await studyEval('new URL(location.href).searchParams.get("chapterId")'),'9');
 await studyEval('document.querySelector("#xxt-player-assistant").shadowRoot.querySelector("#pause").click()');
 await evaluate('document.querySelector("#diagnostic").click()');await wait('!!document.querySelector("#diagnosticText").value');
 const diagnostic=JSON.parse(await evaluate('document.querySelector("#diagnosticText").value'));assert.equal(diagnostic.frames.some(frame=>frame.recognized===1),true);assert.equal(JSON.stringify(diagnostic).includes('fixture-only'),false);
 console.log('PASS: real extension content scripts follow simulated QR success -> v1/manage -> personal space -> native middle entry HTTP 302 -> course -> pending chapter and automatically start; no live account or API');
 await evaluate('document.querySelector("#cancel").click()');await wait('document.querySelector("#status").textContent.includes("启动导航已停止")');
 await evaluate('window.nativeSend=chrome.runtime.sendMessage.bind(chrome.runtime);chrome.runtime.sendMessage=async()=>({allowed:false});document.querySelector("#retry").click()');
 await wait('document.querySelector("#status").textContent.includes("后台未更新")');assert.equal(await evaluate('document.querySelector("#begin").disabled'),true);
 await evaluate('chrome.runtime.sendMessage=async()=>({protocol:"xxt-launch-v1",phase:"idle",active:false,version:"0.0.0"});document.querySelector("#retry").click()');await wait('document.querySelector("#status").textContent.includes("版本不一致")');
 await evaluate('chrome.runtime.sendMessage=window.nativeSend;document.querySelector("#retry").click()');await wait('document.querySelector("#begin").disabled===false');
 console.log('PASS: real extension page connects to its worker, starts/cancels, rejects a legacy reply and wrong version, reconnects without unhandled errors');
 const auto=await command('Target.createTarget',{url:'chrome-extension://'+extensionId+'/launcher.html?autorun=1'}),autoSession=(await command('Target.attachToTarget',{targetId:auto.targetId,flatten:true})).sessionId;
 const autoEval=async expression=>{const r=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},autoSession);if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;};
 await wait('document.querySelector("#status")?.textContent.includes("正在检查登录状态")',autoEval);assert.equal(await autoEval('document.querySelector("#begin").disabled'),true);await autoEval('document.querySelector("#cancel").click()');
 console.log('PASS: actual ?autorun=1 launch verifies worker then opens the launch flow');
 const file=require('node:url').pathToFileURL(path.join(extension,'launcher.html')).href;await command('Page.navigate',{url:file},sessionId);await wait('document.querySelector("#status")?.textContent.includes("没有扩展权限")');assert.equal(await evaluate('document.querySelector("#begin").disabled'),true);
 assert.equal(errors.length,0,JSON.stringify(errors));console.log('PASS: opening launcher.html as a file shows instructions and disables unsupported actions');
 await command('Browser.close');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{ws?.close();child?.kill();});
