"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const dir = path.join(__dirname, "..", "edge-extension");
function fixture(initialStore = {}, options = {}) {
  let listener, removed, time = 100000;
  const store = structuredClone(initialStore);
  const local = structuredClone(options.local || {});
  const context = vm.createContext({ URL, Map, AbortController, AbortSignal, setTimeout, clearTimeout,
    fetch: options.fetch || (async () => { throw new Error('unexpected network request'); }),
    Date: class extends Date { static now() { return time; } },
    chrome: {
      storage: { session: { get: async () => store, set: async value => Object.assign(store, value) },
        local: { get: async () => local, set: async value => Object.assign(local, value), setAccessLevel: async () => {} } },
      runtime: { id: 'test', getURL: name => `chrome-extension://test/${name}`, openOptionsPage: async () => {}, onMessage: { addListener(fn) { listener = fn; } } },
      tabs: { onRemoved: { addListener(fn) { removed = fn; } }, sendMessage: options.onTabMessage || (async () => ({ error: 'no fixture' })) }
      ,scripting:{executeScript:options.executeScript || (async()=>[{result:{ok:false,unavailable:true}}])}
    },
    importScripts(...names) { for (const name of names) vm.runInContext(fs.readFileSync(path.join(dir, name), "utf8"), context); }
  });
  vm.runInContext(fs.readFileSync(path.join(dir, "background.js"), "utf8"), context);
  const send = (msg, frameId = 0, tab = 1, url = "https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu?courseid=212800861") =>
    new Promise(resolve => listener({ channel: "xxt-player-v1", page: "top", ...msg }, { tab: { id: tab,incognito:options.incognitoTabs?.includes(tab)===true }, frameId, url }, resolve));
  const sendOptions = msg => new Promise(resolve => listener({ channel: 'xxt-player-v1', ...msg }, { url: 'chrome-extension://test/options.html' }, resolve));
  return { send, sendOptions, context, store, local, removed: id => removed(id), advance: ms => { time += ms; } };
}
test("valid Chaoxing learning pages accept different courses and reject unrelated or ambiguous URLs", () => {
  const { context } = fixture();
  const check = context.XXTPolicy.coursePage;
  for(const u of ['https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=212800861','https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=267029719&clazzid=154529975','https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu?courseid=266209950&clazzid=152323616&v=2&hideHead=0','https://mooc1.chaoxing.com/mooc-ans/mycourse/studentstudy?COURSEID=1'])assert.equal(check(u),true);
  for (const u of ["https://evilchaoxing.com/mycourse/stu?courseid=212800861", "https://mooc1.chaoxing.com/mycourse/stu?courseid=0", "https://mooc1.chaoxing.com/login", "http://mooc1.chaoxing.com/mycourse/stu?courseid=212800861",'https://mooc1.chaoxing.com/exam?courseid=267029719','https://mooc1.chaoxing.com/mycourse/stu?courseid=x','https://mooc1.chaoxing.com/mycourse/stu','https://mooc1.chaoxing.com/mycourse/stu?courseid=1&courseId=2','https://mooc1.chaoxing.com/mycourse/stu?courseid=1&clazzid=2&clazzid=3']) assert.equal(check(u), false);
});

test('course or class change clears old progress and stops automation; same-course chapter navigation continues',async()=>{
  const f=fixture();await f.send({type:'HELLO'});await f.send({type:'CONTROL',action:'start',playbackRate:2});
  await f.send({type:'REPORT',videos:[{completed:true}]},2);
  let s=await f.send({type:'HELLO',page:'chapter-next'});assert.equal(s.running,true);assert.equal(s.count,0);
  const url='https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=267029719&clazzid=154529975';
  s=await f.send({type:'HELLO',page:'different-course'},0,1,url);
  assert.equal(s.allowed,true);assert.equal(s.courseId,'267029719');assert.equal(s.running,false);assert.equal(s.count,0);assert.equal(s.automation,null);assert.equal(s.playbackRate,2);
  await f.send({type:'CONTROL',page:'different-course',action:'start'},0,1,url);
  const changedClass=await f.send({type:'HELLO',page:'different-course'},0,1,url.replace('154529975','154529976'));
  assert.equal(changedClass.running,false);assert.equal(changedClass.courseId,'267029719');
});
test("only the top frame can start and settings remain isolated between tabs", async () => {
  const f = fixture();
  await f.send({ type: "HELLO" });
  assert.equal((await f.send({ type: "CONTROL", action: "start" }, 2)).running, false);
  assert.equal((await f.send({ type: "CONTROL", action: "start" })).running, true);
  assert.equal((await f.send({ type: "HELLO" }, 0, 2)).running, false);
});

test('one course tab owns automation; pausing or closing it releases the guard',async()=>{
  const f=fixture();await f.send({type:'HELLO'});await f.send({type:'HELLO'},0,2);
  await f.send({type:'CONTROL',action:'start'});
  let second=await f.send({type:'CONTROL',action:'start'},0,2);
  assert.equal(second.running,false);assert.match(second.reason,/已有课程标签页/);
  assert.equal((await f.send({type:'REPORT',videos:[]})).running,true);
  await f.send({type:'CONTROL',action:'pause'});
  assert.equal((await f.send({type:'CONTROL',action:'start'},0,2)).running,true);
  f.removed(2);await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal((await f.send({type:'CONTROL',action:'start'})).running,true);
});

test('upgrade restores at most one previously running course tab',async()=>{
  const f=fixture({sessions:{1:{allowed:true,running:true,page:'top'},2:{allowed:true,running:true,page:'top'}}});
  assert.equal((await f.send({type:'HELLO'})).running,true);
  const second=await f.send({type:'HELLO'},0,2);
  assert.equal(second.running,false);assert.match(second.reason,/恢复.*其他课程标签页/);
});

test('hidden playback wait requires fresh hidden and paused evidence with bounded visibility diagnostics',async()=>{
  const f=fixture();await f.send({type:'HELLO'});await f.send({type:'CONTROL',action:'start'});
  const report=extra=>f.send({type:'REPORT',videos:[{paused:true,completed:false,waitingForVisible:true}],visibility:'hidden',...extra},2);
  let s=await report();assert.equal(s.running,true);assert.equal(s.waitingForVisible,true);assert.equal(s.reports[0].visibility,'hidden');
  s=await report({visibility:'visible'});assert.equal(s.waitingForVisible,false);
  s=await report({visibility:'private untrusted value'});assert.equal(s.waitingForVisible,false);assert.equal(s.reports[0].visibility,'unknown');
  s=await report({videos:[{paused:false,waitingForVisible:true}]});assert.equal(s.waitingForVisible,false);
  s=await report({videos:[{paused:true,waitingForVisible:'true'}]});assert.equal(s.waitingForVisible,false);
  await report();f.advance(6000);s=await f.send({type:'REPORT',videos:[]});assert.equal(s.waitingForVisible,false);
});

test('normal and InPrivate may each run one tab; page-supplied context cannot evade the guard',async()=>{
  const f=fixture({}, {incognitoTabs:[2,4]});
  for(const tab of [1,2,3,4])await f.send({type:'HELLO'},0,tab);
  assert.equal((await f.send({type:'CONTROL',action:'start'})).running,true);
  const privateState=await f.send({type:'CONTROL',action:'start'},0,2);
  assert.equal(privateState.running,true);assert.equal(privateState.incognito,true);
  const normalConflict=await f.send({type:'CONTROL',action:'start',incognito:true},0,3);
  assert.equal(normalConflict.running,false);assert.equal(normalConflict.incognito,false);assert.match(normalConflict.reason,/普通环境/);
  const privateConflict=await f.send({type:'CONTROL',action:'start',incognito:false},0,4);
  assert.equal(privateConflict.running,false);assert.equal(privateConflict.incognito,true);assert.match(privateConflict.reason,/InPrivate环境/);
  assert.equal((await f.send({type:'REPORT',videos:[]})).running,true);
  assert.equal((await f.send({type:'REPORT',videos:[]},0,2)).running,true);
});

test('pause and close release only their context; settings and reports stay within each tab',async()=>{
  const f=fixture({}, {incognitoTabs:[2,4]});
  for(const tab of [1,2,3,4])await f.send({type:'HELLO'},0,tab);
  await f.send({type:'CONTROL',action:'start',playbackRate:2,randomFallback:false});
  await f.send({type:'CONTROL',action:'start',playbackRate:1.25},0,2);
  await f.send({type:'REPORT',page:'private-player',videos:[{currentTime:7,duration:10}]},2,2);
  const normal=await f.send({type:'REPORT',videos:[]});
  assert.equal(normal.reports.some(r=>r.page==='private-player'),false);assert.equal(normal.randomFallback,false);assert.equal(normal.playbackRate,2);
  await f.send({type:'CONTROL',action:'pause'});
  const privateState=await f.send({type:'REPORT',videos:[]},0,2);
  assert.equal(privateState.running,true);assert.equal(privateState.randomFallback,true);assert.equal(privateState.playbackRate,1.25);
  assert.equal((await f.send({type:'CONTROL',action:'start'},0,3)).running,true);
  assert.equal((await f.send({type:'CONTROL',action:'start'},0,4)).running,false);
  f.removed(2);await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await f.send({type:'CONTROL',action:'start'},0,4)).running,true);
  assert.equal((await f.send({type:'REPORT',videos:[]},0,3)).running,true);
});

test('worker restart restores at most one running tab per browser context',async()=>{
  const state={sessions:{1:{allowed:true,running:true,page:'top',incognito:false},2:{allowed:true,running:true,page:'top',incognito:true},3:{allowed:true,running:true,page:'top',incognito:false},4:{allowed:true,running:true,page:'top',incognito:true}}};
  const f=fixture(state,{incognitoTabs:[2,4]});
  assert.equal((await f.send({type:'HELLO'})).running,true);
  assert.equal((await f.send({type:'HELLO'},0,2)).running,true);
  assert.equal((await f.send({type:'HELLO'},0,3)).running,false);
  assert.equal((await f.send({type:'HELLO'},0,4)).running,false);
  assert.equal(f.store.sessions[2].incognito,true);
  const restored=fixture(f.store,{incognitoTabs:[2,4]});
  assert.equal((await restored.send({type:'HELLO'})).running,true);
  assert.equal((await restored.send({type:'HELLO'},0,2)).running,true);
});

test('legacy InPrivate session is classified from the browser sender rather than page data',async()=>{
  const f=fixture({sessions:{2:{allowed:true,running:false,page:'top',courseId:'212800861',courseKey:'212800861:'}}},{incognitoTabs:[2]});
  const state=await f.send({type:'HELLO',incognito:false},0,2);
  assert.equal(state.incognito,true);assert.equal(state.running,false);
  assert.equal(f.store.sessions[2].incognito,true,'classification persists even without page or course changes');
  await f.send({type:'CONTROL',action:'start'},0,2);
  assert.equal(f.store.sessions[2].incognito,true);
});

test("playback rate defaults to following the player, validates choices and reaches child frames", async () => {
  const f = fixture();
  assert.equal((await f.send({ type: "HELLO" })).playbackRate, 0);
  for (const playbackRate of [1, 1.25, 1.5, 1.75, 2, 0, 2]) {
    assert.equal((await f.send({ type: "CONTROL", playbackRate })).playbackRate, playbackRate);
  }
  for (const playbackRate of [-1, 0.5, 3, 16, null, "2"]) {
    assert.equal((await f.send({ type: "CONTROL", playbackRate })).playbackRate, 2);
  }
  assert.equal((await f.send({ type: "CONTROL", playbackRate: 1 }, 2)).playbackRate, 2);
  assert.equal((await f.send({ type: "REPORT", videos: [] }, 2)).playbackRate, 2);
  assert.equal((await f.send({ type: "HELLO" }, 0, 2)).playbackRate, 0);
});
test("playback rate survives chapter navigation and service worker restart; old sessions migrate", async () => {
  const f = fixture();
  await f.send({ type: "HELLO" });
  await f.send({ type: "CONTROL", playbackRate: 2 });
  assert.equal((await f.send({ type: "HELLO", page: "next-chapter" })).playbackRate, 2);
  const restored = fixture(f.store);
  assert.equal((await restored.send({ type: "HELLO", page: "next-chapter" })).playbackRate, 2);
  delete f.store.sessions[1].playbackRate;
  const oldVersion = fixture(f.store);
  assert.equal((await oldVersion.send({ type: "HELLO", page: "next-chapter" })).playbackRate, 0);
});
test("multiple frames play sequentially; finishing one video cannot finish the page", async () => {
  const f = fixture();
  await f.send({ type: "HELLO" });
  await f.send({ type: "REPORT", videos: [{ completed: false }] }, 3);
  let s = await f.send({ type: "REPORT", videos: [{ completed: false }] }, 2);
  assert.equal(s.activeFrame, 2);
  s = await f.send({ type: "REPORT", videos: [{ completed: true }] }, 2);
  assert.equal(s.activeFrame, 3);
  assert.equal(s.allDone, false);
  await f.send({ type: "REPORT", videos: [{ completed: true }] }, 3);
  f.advance(4100);
  s = await f.send({ type: "REPORT", videos: [{ completed: true }] }, 3);
  assert.equal(s.allDone, true);
});
test("empty pages and expired reports never trigger automatic next", async () => {
  const f = fixture();
  await f.send({ type: "HELLO" });
  assert.equal((await f.send({ type: "REPORT", videos: [] })).allDone, false);
  await f.send({ type: "REPORT", videos: [{ completed: true }] }, 2);
  f.advance(6000);
  assert.equal((await f.send({ type: "REPORT", videos: [] })).allDone, false);
});

test('ready text lessons are navigation hints and never platform completion',async()=>{
  const f=fixture();await f.send({type:'HELLO'});
  await f.send({type:'REPORT',videos:[]});
  const lesson={detected:true,ready:true,chars:300,images:2,signature:'article'};
  await f.send({type:'REPORT',page:'article',videos:[],lesson},2);f.advance(4100);
  let state=await f.send({type:'REPORT',videos:[]});
  assert.equal(state.lessonReady,true);assert.equal(state.allDone,false);assert.equal(state.quizDetected,false);
  assert.equal(state.lessonChars,300);assert.equal(state.lessonImages,2);
  state=await f.send({type:'REPORT',videos:[{completed:false}]},3);assert.equal(state.lessonReady,false);
  await f.send({type:'REPORT',videos:[]},3);
  state=await f.send({type:'REPORT',videos:[],lesson:{detected:false,mediaPending:true}},3);assert.equal(state.lessonReady,false,'a viewer in another frame still blocks lecture navigation');
  await f.send({type:'REPORT',videos:[]},3);
  state=await f.send({type:'REPORT',page:'article',videos:[],lesson:{...lesson,ready:false,pendingTasks:true}},2);
  assert.equal(state.lessonReady,false);assert.equal(state.lessonPendingTasks,true);
  f.advance(6000);state=await f.send({type:'REPORT',videos:[]});assert.equal(state.lessonDetected,false);
});

test('lecture blocker diagnostics retain only bounded resource types and counts',async()=>{
  const f=fixture();await f.send({type:'HELLO'});
  const state=await f.send({type:'REPORT',videos:[],lesson:{detected:true,ready:false,mediaPending:true,
    mediaBlockers:[{kind:'pdf-object',tag:'object',source:'secret-query'},{kind:'arbitrary-url',tag:'secret'}],
    resourceCounts:{inspected:999999,ignoredHidden:2,ignoredEmpty:-9,token:'secret-query'}}},2);
  assert.deepEqual(Array.from(state.lessonMediaReasons),['2:pdf-object']);
  const lesson=state.reports.find(r=>r.frameId===2).lesson;
  assert.equal(lesson.resourceCounts.inspected,1000);assert.equal(lesson.resourceCounts.ignoredEmpty,0);
  assert.equal(JSON.stringify(lesson).includes('secret-query'),false);
});
const completedTask={detected:true,completed:true,total:1,done:1,pending:0,unknown:0,videoTasks:1,evidence:['task-label'],signature:'task-completed'};
test('native completed task in a card frame can open practice without claiming an ended video',async()=>{
  const f=fixture();await f.send({type:'HELLO'});
  await f.send({type:'REPORT',videos:[],task:completedTask},2);
  const media={videos:[{completed:false,time:230,duration:491}],lesson:{mediaPending:true,mediaBlockers:[{kind:'video',tag:'video'}]}};
  await f.send({type:'REPORT',...media},3);f.advance(4100);
  let state=await f.send({type:'REPORT',...media},3);
  assert.equal(state.taskReady,true);assert.equal(state.taskCompleted,true);assert.equal(state.mediaDone,false);assert.equal(state.allDone,false);
  assert.equal(state.taskDone,1);assert.equal(state.taskTotal,1);
  f.advance(1000);state=await f.send({type:'REPORT',...media},3);
  assert.equal(state.taskReady,false,'expired native markers cannot authorize navigation');
});

test('pending or unknown native tasks veto completion even when every video ended',async()=>{
  for(const override of [{completed:false,done:0,pending:1},{completed:true,pending:1},{completed:true,unknown:1},{completed:true,evidence:['untrusted text']}]) {
    const f=fixture();await f.send({type:'HELLO'});
    const report={videos:[{completed:true}],task:{...completedTask,...override}};
    await f.send({type:'REPORT',...report},2);f.advance(4100);
    const state=await f.send({type:'REPORT',...report},2);
    assert.equal(state.mediaDone,true);assert.equal(state.taskCompleted,false);assert.equal(state.taskReady,false);assert.equal(state.allDone,false);
  }
});

test('completed task navigation holds for extra resources, pending frames, quizzes and verification',async()=>{
  const f=fixture();await f.send({type:'HELLO'});
  const taskReport={videos:[],task:{...completedTask,videoTasks:0}};
  await f.send({type:'REPORT',...taskReport},2);f.advance(4100);
  assert.equal((await f.send({type:'REPORT',...taskReport},2)).taskReady,true);
  for(const extra of [
    {videos:[{completed:false}]},
    {videos:[],task:{...completedTask,completed:false,done:0,pending:1}},
    {videos:[],lesson:{mediaPending:true,mediaBlockers:[{kind:'pdf-object',tag:'object'}]}},
    {videos:[],lesson:{mediaPending:true,mediaBlockers:[{kind:'video-frame',tag:'iframe'}]}},
    {videos:[],lesson:{mediaPending:true}},
    {videos:[],quiz:{detected:true,count:1}},
    {videos:[],blocked:'请完成验证码'}
  ]) {
    const state=await f.send({type:'REPORT',...extra},3);
    assert.equal(state.taskReady,false);
    await f.send({type:'REPORT',videos:[]},3);
  }
  const state=await f.send({type:'REPORT',...taskReport,task:{...taskReport.task,evidence:['task-label','secret-url'],source:'secret-url'}},2);
  assert.equal(JSON.stringify(state.reports.find(r=>r.frameId===2).task).includes('secret-url'),false);
});

test("visible verification stops every frame and preserves the reason", async () => {
  const f = fixture();
  await f.send({ type: "HELLO" });
  await f.send({ type: "CONTROL", action: "start" });
  const s = await f.send({ type: "REPORT", videos: [], blocked: "检测到验证提示" }, 2);
  assert.equal(s.running, false);
  assert.equal(s.mode, "attention");
  assert.match(s.reason, /验证/);
});
test("a new top document drops old completion reports but continues the session", async () => {
  const f = fixture();
  await f.send({ type: "HELLO" });
  await f.send({ type: "CONTROL", action: "start" });
  await f.send({ type: "REPORT", videos: [{ completed: true }] }, 2);
  const s = await f.send({ type: "HELLO", page: "new-document" });
  assert.equal(s.count, 0);
  assert.equal(s.allDone, false);
  assert.equal(s.running, true);
  assert.equal((await f.send({ type: "CONTROL", action: "stop", page: "top" })).running, true);
});
test("navigation away disables control and closing a tab clears its saved session", async () => {
  const f = fixture();
  await f.send({ type: "HELLO" });
  await f.send({ type: "CONTROL", action: "start" });
  assert.equal((await f.send({ type: "HELLO", page: "other" }, 0, 1, "https://mooc1.chaoxing.com/login")).allowed, false);
  await f.removed(1);
  assert.equal(Object.hasOwn(f.store.sessions, "1"), false);
});
test("pending quizzes block advance; a submitted quiz can continue without a video", async () => {
  const f = fixture();
  await f.send({ type: 'HELLO' });
  await f.send({ type: 'REPORT', videos: [{completed:true}] }, 2);
  await f.send({ type: 'REPORT', videos: [], quiz: {detected:true,count:6,completed:false} }, 3);
  await f.send({type:'REPORT',videos:[]});
  f.advance(4100);
  let s=await f.send({type:'REPORT',videos:[]});
  assert.equal(s.quizDetected,true);
  assert.equal(s.quizCount,6);
  assert.equal(s.allDone,false);
  s=await f.send({type:'REPORT',videos:[],quiz:{detected:true,count:6,completed:true}},3);
  assert.equal(s.allDone,true);
  f.advance(1000);
  s=await f.send({type:'REPORT',videos:[],quiz:{detected:true,count:0,completed:true}},3);
  assert.equal(s.count,0);
  assert.equal(s.allDone,true);
});
test("step context changes invalidate old iframe reports and late generations", async () => {
  const f=fixture(); await f.send({type:'HELLO'});
  let s=await f.send({type:'CONTEXT',context:'video'});
  const old=s.generation;
  await f.send({type:'REPORT',generation:old,videos:[{completed:true}]},2);
  s=await f.send({type:'CONTEXT',context:'exercise'});
  assert.equal(s.count,0);
  s=await f.send({type:'REPORT',generation:old,videos:[{completed:true}]},2);
  assert.equal(s.count,0);
  assert.equal(s.allDone,false);
});
test("only the extension settings page can save keys; responses never include a key", async () => {
  const f=fixture(); await f.send({type:'HELLO'});
  const key='sk-test-key-not-a-real-credential';
  await f.send({type:'OPTIONS_SAVE',apiKey:key});
  assert.equal(f.local.deepseek,undefined);
  const result=await f.sendOptions({type:'OPTIONS_SAVE',apiKey:key,model:'deepseek-flash'});
  assert.equal(result.hasKey,true);
  assert.equal(JSON.stringify(result).includes(key),false);
  assert.equal(f.local.deepseek.apiKey,key);
  await f.sendOptions({type:'OPTIONS_SAVE',model:'deepseek-v4-pro'});
  assert.equal(f.local.deepseek.apiKey,key);
  assert.equal((await f.sendOptions({type:'OPTIONS_SAVE',clear:true})).hasKey,false);
});
const exampleQuestions=[{id:'q1',type:'single',stem:'1+1 等于多少？',options:[{key:'A',text:'2'},{key:'B',text:'3'}]}];
test("AI payload strips hidden fields and rejects ambiguous or invalid answers", () => {
  const api=fixture().context.XXTDeepSeek;
  const sanitized=api.questions([{...exampleQuestions[0],hiddenAnswer:'B',cookie:'private'}]);
  assert.equal(JSON.stringify(sanitized).includes('private'),false);
  for(const raw of ['not JSON','{"answers":[]}',JSON.stringify({answers:[{id:'q1',answer:['C']}]}),JSON.stringify({answers:[{id:'q1',answer:['A','B']}]})]) assert.throws(()=>api.answers(raw,exampleQuestions));
  assert.equal(api.answers(JSON.stringify({answers:[{id:'q1',answer:['A'],reason:'2'}]}),exampleQuestions)[0].answer[0],'A');
});
test("DeepSeek request and fill are bound to the current quiz and never send course cookies", async () => {
  let requests=0, filled=0;
  const f=fixture({}, {local:{deepseek:{apiKey:'sk-test-key-not-a-real-credential',model:'deepseek-flash'}},
    onTabMessage:async (tab,msg,options)=>{
      assert.equal(tab,1);assert.equal(options.frameId,2);
      if(msg.type==='QUIZ_READ') return {page:'quiz-frame',fingerprint:'abc',questions:exampleQuestions};
      filled++;assert.equal(msg.fingerprint,'abc');return {applied:1,failed:[]};
    },
    fetch:async (url,request)=>{
      requests++;assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(request.credentials,'omit');
      const body=JSON.parse(request.body);assert.equal(body.model,'deepseek-flash');assert.equal(body.response_format.type,'json_object');
      return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({answers:[{id:'q1',answer:['A'],reason:'加法'}]})}}]})};
    }});
  await f.send({type:'HELLO'});
  await f.send({type:'REPORT',page:'quiz-frame',videos:[],quiz:{detected:true,count:1}},2);
  const result=await f.send({type:'AI_SOLVE'});
  assert.equal(requests,1);assert.equal(result.result.answers[0].answer[0],'A');
  assert.equal((await f.send({type:'AI_APPLY'})).applied,1);assert.equal(filled,1);
  await f.send({type:'CONTEXT',context:'next-chapter'});
  assert.match((await f.send({type:'AI_APPLY'})).error,/先生成/);
});
const shortQuestion={id:'q2',type:'short',stem:'计算机的硬件系统由哪五大部分组成？',options:[]};
const shortAnswer='运算器、控制器、存储器、输入设备和输出设备。';

test('thinking effort defaults to high and can be saved without replacing the key',async()=>{
  const f=fixture({}, {local:{deepseek:{apiKey:'sk-test-key-not-a-real-credential',model:'deepseek-flash'}}});
  assert.equal((await f.sendOptions({type:'OPTIONS_GET'})).effort,'high');
  for(const effort of ['max','none','low','high'])assert.equal((await f.sendOptions({type:'OPTIONS_SAVE',effort})).effort,effort);
  assert.equal((await f.sendOptions({type:'OPTIONS_SAVE',effort:'ultra'})).effort,'high');
  assert.equal(f.local.deepseek.apiKey,'sk-test-key-not-a-real-credential');
});

test('ordinary CJK codepoints with an encrypted-font flag are never sent as plain questions',()=>{
  const api=fixture().context.XXTDeepSeek;
  assert.throws(()=>api.questions([{id:'q1',type:'short',stem:'简懿指攋与懻序的悬别',options:[],encrypted:true}]),/混淆字体/);
});

test('image-only questions without encrypted fonts must be visually transcribed before solving',async()=>{
  let calls=0;
  const f=fixture({}, {local:{deepseek:{apiKey:'sk-test-key-not-a-real-credential'}},fetch:async(url,request)=>{
    calls++;const body=JSON.parse(request.body);assert.ok(Array.isArray(body.messages[1].content));
    return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({id:'q1',readable:true,stem:'递归计算 f(n)=n*f(n-1), f(0)=1。',options:[]})}}]})};
  }});
  const input=[{id:'q1',type:'short',stem:'[图片题，等待视觉转录]',options:[],visual:true,image:'data:image/png;base64,AAAA'}],api=f.context.XXTDeepSeek;
  assert.throws(()=>api.questions(input),/图片题/);
  const prepared=await api.prepare(input,new AbortController().signal);
  assert.equal(calls,1);assert.match(prepared[0].stem,/f\(0\)=1/);assert.equal(Object.hasOwn(prepared[0],'visual'),false);assert.equal(Object.hasOwn(prepared[0],'image'),false);
});

test('visual transcription excludes encrypted DOM text and answering uses high thinking',async()=>{
  const requests=[];
  const f=fixture({}, {local:{deepseek:{apiKey:'sk-test-key-not-a-real-credential',model:'deepseek-v4-pro'}},fetch:async(url,request)=>{
    const body=JSON.parse(request.body);requests.push(body);
    const visual=Array.isArray(body.messages[1].content);
    if(visual){assert.equal(body.model,'deepseek-flash');assert.equal(body.thinking.type,'disabled');assert.equal(JSON.stringify(body).includes('简懿指攋'),false);}
    else {assert.equal(body.model,'deepseek-v4-pro');assert.equal(body.thinking.type,'enabled');assert.equal(body.reasoning_effort,'high');assert.match(body.messages[1].content,/简述指令和程序的区别/);}
    return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(visual?{id:'q1',readable:true,stem:'简述指令和程序的区别？',options:[]}:{answers:[{id:'q1',answer:['指令规定一次基本操作，程序是完成任务的有序指令集合。']}]})}}]})};
  }});
  const signal=new AbortController().signal;
  const qs=await f.context.XXTDeepSeek.prepare([{id:'q1',type:'short',stem:'简懿指攋与懻序的悬别',options:[],encrypted:true,image:'data:image/png;base64,AAAA'}],signal);
  assert.equal(qs[0].stem,'简述指令和程序的区别？');
  const answers=await f.context.XXTDeepSeek.solve(qs,signal);
  assert.match(answers[0].answer[0],/有序指令集合/);assert.equal(requests.length,2);
  assert.equal(JSON.stringify(qs).includes('image'),false);
});

test('uncertain visual text and truncated output stop without guessing or additional answer calls',async()=>{
  for(const mode of ['uncertain','truncated']) {
    let calls=0;
    const f=fixture({}, {local:{deepseek:{apiKey:'sk-test-key-not-a-real-credential'}},fetch:async()=>{calls++;return {ok:true,json:async()=>({choices:[{finish_reason:mode==='truncated'?'length':'stop',message:{content:JSON.stringify({id:'q1',readable:false,stem:'猜测内容',options:[]})}}]})};}});
    await assert.rejects(()=>f.context.XXTDeepSeek.prepare([{id:'q1',type:'short',stem:'乱码',options:[],encrypted:true,image:'data:image/png;base64,AAAA'}],new AbortController().signal));
    assert.equal(calls,1);
  }
});

test('visual JSON fences are accepted without changing C operators, quotes or backslashes',async()=>{
  let calls=0;
  const transcription={id:'q4',readable:true,stem:'设 I、J 和 K 为 int 型，选出表达式。',options:[
    {key:'A',text:"'I' && 'J'"},{key:'B',text:'I <= J'},
    {key:'C',text:'I || J+K - J-K'},{key:'D',text:'!((I < J) && !K || 1); printf("x\\n")'}
  ]};
  const f=fixture({}, {local:{deepseek:{apiKey:'sk-test-key-not-a-real-credential'}},fetch:async(url,request)=>{
    calls++;const body=JSON.parse(request.body);
    assert.equal(body.response_format.type,'json_object');assert.match(body.messages[0].content,/"id":"q4"/);
    assert.equal(JSON.stringify(body).includes('混淆原文'),false);
    return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'\uFEFF  ```JSON\n'+JSON.stringify(transcription)+'\n```  '}}]})};
  }});
  const qs=await f.context.XXTDeepSeek.prepare([{id:'q4',type:'single',stem:'混淆原文',options:transcription.options.map(o=>({key:o.key,text:'混淆原文'})),encrypted:true,image:'data:image/png;base64,AAAA'}],new AbortController().signal);
  assert.equal(calls,1);assert.deepEqual(JSON.parse(JSON.stringify(qs[0].options)),transcription.options);
  assert.equal(qs[0].stem,transcription.stem);
});

test('empty or invalid visual JSON retries that image once without repeating earlier questions or leaking raw text',async()=>{
  for(const malformed of ['', '{private-model-response', '解释文字\n{"id":"q4"}']) {
    const calls=[],progress=[];
    const f=fixture({}, {local:{deepseek:{apiKey:'sk-test-key-not-a-real-credential'}},fetch:async(url,request)=>{
      const body=JSON.parse(request.body),meta=JSON.parse(body.messages[1].content[0].text);
      calls.push({id:meta.id,image:body.messages[1].content[1].image_url.url});
      assert.equal(body.messages[0].content.includes('private-model-response'),false);
      const count=calls.filter(c=>c.id===meta.id).length;
      const content=meta.id==='q4'&&count===1?malformed:JSON.stringify({id:meta.id,readable:true,stem:'已读取的题干 '+meta.id,options:[]});
      return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content}}]})};
    }});
    const input=['q3','q4','q5'].map(id=>({id,type:'short',stem:'不得使用的原文',options:[],encrypted:true,image:'data:image/png;base64,AAAA'}));
    const qs=await f.context.XXTDeepSeek.prepare(input,new AbortController().signal,event=>progress.push(event));
    assert.deepEqual(calls.map(c=>c.id),['q3','q4','q4','q5']);assert.equal(calls[1].image,calls[2].image);
    assert.deepEqual(Array.from(qs,q=>q.id),['q3','q4','q5']);
    assert.equal(progress.filter(p=>p.phase==='transcription-retry').length,1);
    const diagnostic=progress.find(p=>p.phase==='transcription-format').diagnostic;
    assert.deepEqual(Object.keys(diagnostic).sort(),['chars','fenced','kind']);
    assert.equal(JSON.stringify(progress).includes('private-model-response'),false);
  }
});

test('invalid visual JSON has a strict retry limit and ambiguous parsed content remains rejected',async()=>{
  const cases=[['not JSON',2,/连续 2 次/],['null',1,/未能完整确认/],['[]',1,/未能完整确认/],
    [JSON.stringify({id:'q4',readable:false,stem:'不确定',options:[]}),1,/未能完整确认/],
    [JSON.stringify({id:'q1',readable:true,stem:'错题号',options:[]}),1,/未能完整确认/],
    [JSON.stringify({id:'q4',readable:true,stem:'选项缺失',options:[{key:'A',text:'部分内容'}]}),1,/未能完整确认/]];
  for(const [content,expectedCalls,message] of cases) {
    let calls=0;
    const f=fixture({}, {local:{deepseek:{apiKey:'sk-test-key-not-a-real-credential'}},fetch:async()=>{
      calls++;return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content}}]})};
    }});
    await assert.rejects(()=>f.context.XXTDeepSeek.prepare([{id:'q4',type:'short',stem:'不得猜测',options:[],encrypted:true,image:'data:image/png;base64,AAAA'}],new AbortController().signal),message);
    assert.equal(calls,expectedCalls);
  }
});

test('cancellation after malformed visual output prevents the retry request',async()=>{
  let calls=0;const controller=new AbortController();
  const f=fixture({}, {local:{deepseek:{apiKey:'sk-test-key-not-a-real-credential'}},fetch:async()=>{
    calls++;return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:''}}]})};
  }});
  await assert.rejects(()=>f.context.XXTDeepSeek.prepare([{id:'q4',type:'short',stem:'原文',options:[],encrypted:true,image:'data:image/png;base64,AAAA'}],controller.signal,event=>{
    if(event.phase==='transcription-format')controller.abort();
  }));
  assert.equal(calls,1);
});

test('automatic visual format failure records bounded diagnostics and never fills or submits',async()=>{
  const counts={visual:0,apply:0,submit:0};
  const f=fixture({}, {local:{deepseek:{apiKey:'sk-test-key-not-a-real-credential'}},fetch:async(url,request)=>{
    assert.ok(Array.isArray(JSON.parse(request.body).messages[1].content));counts.visual++;
    return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'private-model-response'}}]})};
  },onTabMessage:async(tab,msg)=>{
    if(msg.type==='QUIZ_READ')return {page:'quiz',fingerprint:'glyph-failure',questions:[{id:'q4',type:'short',stem:'混淆原文',options:[],encrypted:true,image:'data:image/png;base64,AAAA'}]};
    if(msg.type==='QUIZ_APPLY')counts.apply++;
    if(msg.type==='QUIZ_SUBMIT')counts.submit++;
    return {};
  }});
  await f.send({type:'HELLO'});await f.send({type:'CONTROL',action:'start'});
  await f.send({type:'REPORT',page:'quiz',videos:[],quiz:{detected:true,count:1,total:1,unsupported:0,fingerprint:'glyph-failure'}},2);
  const result=await f.send({type:'AUTO_QUIZ'});
  assert.match(result.error,/字形读题 q4 连续 2 次/);
  assert.deepEqual(counts,{visual:2,apply:0,submit:0});
  const state=await f.send({type:'HELLO'});assert.equal(state.running,false);
  assert.equal(state.automation.diagnostic.kind,'json');assert.equal(state.automation.diagnostic.attempt,2);
  assert.equal(JSON.stringify(state.automation).includes('private-model-response'),false);
});

test('foreground compatibility needs an active reported player and explicit setting; restoration remains allowed',async()=>{
  let calls=0;
  const f=fixture({}, {executeScript:async()=>{calls++;return [{result:{ok:true}}];}});
  await f.send({type:'HELLO'});await f.send({type:'REPORT',page:'player',videos:[{completed:false}]},2);
  const action=text=>f.send({type:'PAGE_ACTION',page:'player',kind:'foreground',token:'test-token',text},2);
  assert.equal((await action('on')).ok,false);assert.equal(calls,0);
  await f.send({type:'CONTROL',action:'start',foregroundCompat:true});assert.equal((await action('on')).ok,true);
  await f.send({type:'CONTROL',action:'pause'});assert.equal((await action('on')).ok,false);assert.equal((await action('off')).ok,true);
  assert.equal((await action('arbitrary-code')).ok,false);assert.equal(calls,2);
});

test('mouse leave guard preference defaults on and opt-out survives worker restart',async()=>{
  const f=fixture();assert.equal((await f.send({type:'HELLO'})).mouseGuard,true);
  assert.equal((await f.send({type:'CONTROL',mouseGuard:false},2)).mouseGuard,true);
  await f.send({type:'CONTROL',mouseGuard:false});
  assert.equal((await fixture(f.store).send({type:'HELLO'})).mouseGuard,false);
  let state=await f.send({type:'REPORT',videos:[],pauseSignal:'viewport-exit'});
  assert.equal(state.reports.find(r=>r.frameId===0).pauseSignal,'viewport-exit');
  state=await f.send({type:'REPORT',videos:[],pauseSignal:'private-url-or-coordinate'});
  assert.equal(state.reports.find(r=>r.frameId===0).pauseSignal,'');
});

test('mouse leave interception is limited to active player frames or their reported course surface',async()=>{
  let calls=0;
  const f=fixture({}, {executeScript:async request=>{calls++;assert.equal(request.world,'MAIN');return [{result:{ok:true}}];}});
  await f.send({type:'HELLO'});await f.send({type:'CONTROL',action:'start'});
  await f.send({type:'REPORT',videos:[],playerSurface:true});
  const action=(text='on',frameId=0,page='top')=>f.send({type:'PAGE_ACTION',kind:'mouse',token:'test-token',text,page},frameId);
  assert.equal((await action()).ok,false,'a blank course iframe alone does not authorize interception');
  await f.send({type:'REPORT',page:'player',videos:[{completed:false}]},2);
  assert.equal((await action()).ok,true,'the outer course surface can guard the playing child frame');
  assert.equal((await action('on',2,'player')).ok,true);
  await f.send({type:'REPORT',page:'quiz',videos:[],quiz:{detected:true,count:1}},3);
  assert.equal((await action()).ok,false,'chapter exercises disable interception');
  await f.send({type:'CONTROL',action:'pause'});
  assert.equal((await action('off')).ok,true);
  assert.equal((await action('arbitrary-code')).ok,false);assert.equal(calls,3);
});
test('short-answer schema accepts complete text and rejects empty, multiple or option-shaped input',()=>{
  const api=fixture().context.XXTDeepSeek;
  assert.equal(api.questions([shortQuestion])[0].type,'short');
  const parsed=api.answers(JSON.stringify({answers:[{id:'q2',answer:[shortAnswer]}]}),[shortQuestion]);
  assert.equal(parsed[0].answer[0],shortAnswer);
  for(const answer of [[],[''],['a','b'],[5]])assert.throws(()=>api.answers(JSON.stringify({answers:[{id:'q2',answer}]}),[shortQuestion]));
  assert.throws(()=>api.questions([{...shortQuestion,options:[{key:'A',text:'wrong schema'}]}]));
});
function automaticFixture({failed=false,unsupported=0,fetchOverride}={}) {
  const counts={api:0,apply:0,submit:0,click:0};let f;
  const qs=[...exampleQuestions,shortQuestion];
  const options={local:{deepseek:{apiKey:'sk-test-key-not-a-real-credential',model:'deepseek-flash'}},
    fetch:fetchOverride || (async()=>{counts.api++;return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({answers:[{id:'q1',answer:['A']},{id:'q2',answer:[shortAnswer]}]})}}]})};}),
    executeScript:async request=>{assert.equal(request.world,'MAIN');assert.equal(request.target.frameIds[0],2);counts.click++;return [{result:{ok:true}}];},
    onTabMessage:async(tab,msg)=>{
      if(msg.type==='QUIZ_READ')return {page:'quiz',fingerprint:'short-fingerprint',questions:qs,total:2,unsupported};
      if(msg.type==='QUIZ_APPLY'){counts.apply++;return {applied:failed?1:2,total:2,unsupported:0,failed:failed?['q2']:[]};}
      if(msg.type==='QUIZ_SUBMIT'){counts.submit++;const result=await f.send({type:'PAGE_ACTION',page:'quiz',kind:'submit',token:'test-token'},2);return result.ok?{clicked:true}:{error:result.error};}
    }};
  f=fixture({},options);
  return {f,counts,options,report:()=>f.send({type:'REPORT',page:'quiz',videos:[],quiz:{detected:true,count:2,total:2,unsupported,fingerprint:'short-fingerprint'}},2)};
}

test('switching courses while DeepSeek is working discards old answers before fill or submission',async()=>{
  let release,started;
  const fetching=new Promise(resolve=>{started=resolve;});
  const {f,counts,report}=automaticFixture({fetchOverride:async()=>{started();return new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({answers:[{id:'q1',answer:['A']},{id:'q2',answer:[shortAnswer]}]})}}]})});});}});
  await f.send({type:'HELLO'});await f.send({type:'CONTROL',action:'start'});await report();
  const pending=f.send({type:'AUTO_QUIZ'});await fetching;
  const url='https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu?courseid=266209950&clazzid=152323616';
  let state=await f.send({type:'HELLO',page:'new-course'},0,1,url);
  assert.equal(state.running,false);assert.equal(state.automation,null);release();await pending;
  assert.equal(counts.apply,0);assert.equal(counts.submit,0);
  state=await f.send({type:'REPORT',page:'new-course',videos:[]},0,1,url);assert.equal(state.courseId,'266209950');assert.equal(state.automation,null);
});

test('submitted form transitions to a result with a different fingerprint without resubmission',async()=>{
  const {f,counts,report}=automaticFixture();await f.send({type:'HELLO'});await f.send({type:'CONTROL',action:'start'});
  await report();await f.send({type:'AUTO_QUIZ'});
  await f.send({type:'REPORT',page:'quiz',videos:[],quiz:{detected:true,count:0,total:2,completed:true,evidence:'answer-review',fingerprint:'review-fingerprint'}},2);
  let state=await f.send({type:'REPORT',videos:[]});
  assert.equal(state.automation.status,'done');assert.equal(state.quizDone,true);
  f.advance(4100);
  state=await f.send({type:'REPORT',videos:[]});assert.equal(state.allDone,true);
  await f.send({type:'AUTO_QUIZ'});assert.equal(counts.api,1);assert.equal(counts.submit,1);
});
test('automatic mode persists and sends one whole-quiz fill and submit, including a short answer',async()=>{
  const {f,counts,options,report}=automaticFixture();
  assert.equal((await f.send({type:'HELLO'})).autoQuiz,true);
  await f.send({type:'CONTEXT',context:'chapter-1'});
  await f.send({type:'CONTROL',action:'start'});await report();
  assert.equal((await f.send({type:'AUTO_QUIZ'})).automation.status,'awaiting_confirmation');
  await f.send({type:'AUTO_QUIZ'});
  assert.deepEqual(counts,{api:1,apply:1,submit:1,click:1});
  const restored=fixture(f.store,options);
  await restored.send({type:'HELLO'});
  await restored.send({type:'REPORT',page:'quiz',videos:[],quiz:{detected:true,count:2,fingerprint:'short-fingerprint'}},2);
  await restored.send({type:'AUTO_QUIZ'});
  assert.equal(counts.submit,1,'a worker restart must not repeat an uncertain submission');
  assert.equal((await f.send({type:'CONTROL',autoQuiz:false})).autoQuiz,false);
  assert.equal((await fixture(f.store,options).send({type:'HELLO'})).autoQuiz,false);
});
test('unfilled short answer and unsupported questions stop automatic submission',async()=>{
  for(const params of [{failed:true},{unsupported:1}]){
    const {f,counts,report}=automaticFixture(params);await f.send({type:'HELLO'});await f.send({type:'CONTROL',action:'start'});await report();
    const result=await f.send({type:'AUTO_QUIZ'});assert.ok(result.error);
    assert.equal(counts.submit,0);assert.equal(counts.click,0);
    assert.equal((await f.send({type:'REPORT',videos:[]})).running,false);
  }
});
test('pause during an API request prevents subsequent fill and submit',async()=>{
  let release,started;
  const fetching=new Promise(resolve=>{started=resolve;});
  const {f,counts,report}=automaticFixture({fetchOverride:async()=>{started();return new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({answers:[{id:'q1',answer:['A']},{id:'q2',answer:[shortAnswer]}]})}}]})});});}});
  await f.send({type:'HELLO'});await f.send({type:'CONTROL',action:'start'});await report();
  const pending=f.send({type:'AUTO_QUIZ'});await fetching;
  await f.send({type:'CONTROL',action:'pause'});release();await pending;
  assert.equal(counts.apply,0);assert.equal(counts.submit,0);
});

test('unsupported question reports identify the question using bounded diagnostic fields only',async()=>{
  const {f,counts}=automaticFixture();await f.send({type:'HELLO'});await f.send({type:'CONTROL',action:'start'});
  const response=await f.send({type:'REPORT',page:'quiz',videos:[],quiz:{detected:true,count:9,total:10,unsupported:1,fingerprint:'structure-failure',unsupportedDetails:[
    {id:'q10',code:'missing-answer-control',optionCount:0,stem:'private question text'},
    {id:'private-id',code:'missing-answer-control'},
    {id:'q2',code:'private reason'}
  ]}},2);
  const details=response.reports.find(r=>r.frameId===2).quiz.unsupportedDetails;
  assert.deepEqual(JSON.parse(JSON.stringify(details)),[{id:'q10',code:'missing-answer-control',optionCount:0}]);
  const result=await f.send({type:'AUTO_QUIZ'});
  assert.match(result.error,/q10/);assert.equal(result.automation.diagnostic.phase,'question-structure');
  assert.equal(JSON.stringify(result).includes('private question text'),false);
  assert.equal(counts.api,0);assert.equal(counts.submit,0);
});

test('concurrent normal and InPrivate model jobs remain independent when one tab pauses',async()=>{
  const requests=[],applied=[];
  const f=fixture({}, {incognitoTabs:[2],local:{deepseek:{apiKey:'sk-test-key-not-a-real-credential'}},
    fetch:async(url,request)=>new Promise((resolve,reject)=>{
      const question=JSON.parse(request.body).messages[1];const q=JSON.parse(question.content).questions[0];
      let done=false;
      const abort=()=>{if(done)return;done=true;reject(new DOMException('cancelled','AbortError'));};
      request.signal.addEventListener('abort',abort,{once:true});
      requests.push({tab:Number(q.stem.split('-')[1]),signal:request.signal,finish(){if(done)return;done=true;request.signal.removeEventListener('abort',abort);resolve({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({answers:[{id:'q1',answer:['B']}]})}}]})});}});
    }),
    onTabMessage:async(tab,msg)=>{
      if(msg.type==='QUIZ_READ')return {page:'quiz',fingerprint:'same-ids',questions:[{id:'q1',type:'single',stem:'tab-'+tab,options:[{key:'A',text:'one'},{key:'B',text:'two'}]}],total:1,unsupported:0};
      if(msg.type==='QUIZ_APPLY'){applied.push({tab,answers:msg.answers});return {applied:1,total:1,unsupported:0,failed:[]};}
    }});
  for(const tab of [1,2]){
    await f.send({type:'HELLO'},0,tab);assert.equal((await f.send({type:'CONTROL',action:'start'},0,tab)).running,true);
    await f.send({type:'REPORT',page:'quiz',videos:[],quiz:{detected:true,count:1,total:1,unsupported:0,fingerprint:'same-ids'}},2,tab);
  }
  const normalJob=f.send({type:'AI_SOLVE'}),privateJob=f.send({type:'AI_SOLVE'},0,2);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(requests.length,2);
  await f.send({type:'CONTROL',action:'pause'});
  assert.ok((await normalJob).error);assert.equal(requests.find(r=>r.tab===1).signal.aborted,true);
  const privateRequest=requests.find(r=>r.tab===2);assert.equal(privateRequest.signal.aborted,false);privateRequest.finish();
  assert.equal((await privateJob).result.answers[0].answer[0],'B');
  assert.ok((await f.send({type:'AI_APPLY'})).error);
  assert.equal((await f.send({type:'AI_APPLY'},0,2)).applied,1);
  assert.equal(applied.length,1);assert.equal(applied[0].tab,2);
  assert.equal((await f.send({type:'REPORT',videos:[]},0,2)).running,true);
});
test('a submitted quiz times out without retrying the submit action',async()=>{
  const {f,counts,report}=automaticFixture();await f.send({type:'HELLO'});await f.send({type:'CONTROL',action:'start'});await report();await f.send({type:'AUTO_QUIZ'});
  f.advance(31000);await report();await f.send({type:'AUTO_QUIZ'});
  const state=await f.send({type:'REPORT',videos:[]});assert.equal(state.running,false);assert.match(state.reason,/不会重复/);assert.equal(counts.submit,1);
});
test('an interrupted worker resumes its navigation context but does not repeat an unfinished automation job',async()=>{
  const {f,counts,options}=automaticFixture();await f.send({type:'HELLO'});await f.send({type:'CONTROL',action:'start'});await f.send({type:'CONTEXT',context:'chapter-context'});
  f.store.sessions[1].automation={key:'chapter-context:short-fingerprint',status:'working',at:100000};
  const restored=fixture(f.store,options);restored.advance(6000);await restored.send({type:'HELLO'});
  await restored.send({type:'REPORT',page:'quiz',videos:[],quiz:{detected:true,count:2,fingerprint:'short-fingerprint'}},2);
  await restored.send({type:'AUTO_QUIZ'});
  const state=await restored.send({type:'REPORT',videos:[]});assert.equal(state.running,false);assert.match(state.reason,/中断/);assert.equal(state.generation,1);assert.equal(counts.api,0);assert.equal(counts.submit,0);
});
test('model IDs normalize case, numeric IDs and whitespace without changing question identity',()=>{
  const api=fixture().context.XXTDeepSeek;
  const batch=[exampleQuestions[0],{...exampleQuestions[0],id:'q2'}];
  const result=api.answers(JSON.stringify({answers:[{id:' Q02 ',answer:'b'},{id:1,answer:['A']}]}),batch);
  assert.deepEqual(JSON.parse(JSON.stringify(result.map(a=>[a.id,a.answer]))),[['q1',['A']],['q2',['B']]]);
});
test('a one-question response is bound locally even when q6 is renumbered as q1',()=>{
  const api=fixture().context.XXTDeepSeek;
  const result=api.answers(JSON.stringify({answers:[{id:'q1',answer:shortAnswer}]}),[{...shortQuestion,id:'q6'}]);
  assert.equal(result[0].id,'q6');assert.equal(result[0].answer[0],shortAnswer);
});
function schemaFixture(responder){
  const calls=[],progress=[];
  const f=fixture({}, {local:{deepseek:{apiKey:'sk-test-key-not-a-real-credential',model:'deepseek-flash'}},fetch:async(_url,request)=>{
    const payload=JSON.parse(request.body);const data=JSON.parse(payload.messages[1].content);calls.push(data);
    const body=await responder(data,calls.length);
    return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:typeof body==='string'?body:JSON.stringify(body)}}]})};
  }});
  return {api:f.context.XXTDeepSeek,calls,progress,track:event=>progress.push(JSON.parse(JSON.stringify(event)))};
}
test('duplicate IDs are retried per question instead of assigning answers by array position',async()=>{
  const {api,calls,track,progress}=schemaFixture((data,n)=>n===1?{answers:[{id:'q1',answer:['A']},{id:'q1',answer:['B']}]}:{answers:[{id:'1',answer:[data.questions[0].id==='q2'?'B':'A']}]});
  const result=await api.solve([exampleQuestions[0],{...exampleQuestions[0],id:'q2'}],new AbortController().signal,track);
  assert.equal(calls.length,3);
  assert.deepEqual(calls.map(c=>c.requested_ids),[['q1','q2'],['q1'],['q2']]);
  assert.equal(result[0].answer[0],'A');assert.equal(result[1].answer[0],'B');
  assert.ok(progress.some(p=>p.phase==='retry'));
});
test('only an invalid question is retried; already-valid answers are not requested again',async()=>{
  const {api,calls,track}=schemaFixture((data,n)=>n===1?{answers:[{id:'Q1',answer:'A'},{id:'q2',answer:['Z']}]}:{answers:[{id:'q2',answer:'B'}]});
  const result=await api.solve([exampleQuestions[0],{...exampleQuestions[0],id:'q2'}],new AbortController().signal,track);
  assert.equal(calls.length,2);assert.deepEqual(calls[1].requested_ids,['q2']);assert.equal(result[0].answer[0],'A');
});
test('six questions with five choices and a separately renumbered short answer succeed',async()=>{
  const {api,calls}=schemaFixture(data=>({answers:data.questions.map((q,i)=>({id:q.type==='short'?'q1':i+1,answer:q.type==='short'?shortAnswer:'A'}))}));
  const qs=Array.from({length:5},(_,i)=>({...exampleQuestions[0],id:`q${i+1}`}));qs.push({...shortQuestion,id:'q6'});
  const result=await api.solve(qs,new AbortController().signal);
  assert.equal(calls.length,2);assert.deepEqual(calls[1].requested_ids,['q6']);assert.equal(result.length,6);assert.equal(result[5].id,'q6');assert.equal(result[5].answer[0],shortAnswer);
});
test('malformed answers stop after two per-question retries and diagnostics omit arbitrary response text',async()=>{
  const {api,calls,track,progress}=schemaFixture(()=>({answers:[{id:'private arbitrary text',answer:['Z']}]}));
  await assert.rejects(()=>api.solve(exampleQuestions,new AbortController().signal,track),/2 次逐题重试/);
  assert.equal(calls.length,3);assert.equal(JSON.stringify(progress).includes('private arbitrary text'),false);
});

test('numeric option values map only to a unique exact choice and diagnostics classify invalid arrays',()=>{
  const api=fixture().context.XXTDeepSeek;
  const q={id:'q1',type:'single',stem:'计算表达式的值',options:['0','2','4','8'].map((text,i)=>({key:String.fromCharCode(65+i),text}))};
  for(const answer of [[4],['4'],'4',['C. 4']])assert.equal(api.answers(JSON.stringify({answers:[{id:'q1',answer}]}),[q])[0].answer[0],'C');
  const ambiguous={...q,options:[{key:'A',text:'4'},{key:'B',text:'4'}]};
  assert.equal(api.inspect(JSON.stringify({answers:[{id:'q1',answer:[4]}]}),[ambiguous]).diagnostic.invalid[0].code,'ambiguous-option');
  for(const [answer,code] of [[[],'empty-answer'],[[99],'unknown-option'],[['A','B'],'answer-count'],[[{}],'answer-type']]){
    const result=api.inspect(JSON.stringify({answers:[{id:'q1',answer}]}),[q]);assert.equal(result.byId.size,0);assert.equal(result.diagnostic.invalid[0].code,code);
  }
  const caseSensitive={...q,options:[{key:'A',text:'value'},{key:'B',text:'VALUE'}]};
  assert.equal(api.answers(JSON.stringify({answers:[{id:'q1',answer:'value'}]}),[caseSensitive])[0].answer[0],'A');
});

test('random fallback handles empty objective answers immediately and preserves valid answers',async()=>{
  const {api,calls,track,progress}=schemaFixture(data=>({answers:data.questions.map(q=>({id:q.id,answer:q.id==='q1'?[]:['B']}))}));
  const qs=[exampleQuestions[0],{...exampleQuestions[0],id:'q2'}];
  const result=await api.solve(qs,new AbortController().signal,track,{randomFallback:true});
  assert.equal(calls.length,1);assert.equal(result[0].source,'random');assert.match(result[0].reason,/随机兜底/);
  assert.ok(['A','B'].includes(result[0].answer[0]));assert.equal(result[1].answer[0],'B');assert.equal(result[1].source,undefined);
  assert.equal(progress.filter(p=>p.phase==='random-fallback').length,1);
});

test('random fallback is bounded to valid nonempty choice sets after format or request errors',async()=>{
  for(const mode of ['invalid','http']) {
    let calls=0;
    const f=fixture({}, {local:{deepseek:{apiKey:'sk-test-key-not-a-real-credential'}},fetch:async()=>{calls++;return mode==='http'?{ok:false,status:429}:{ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'private arbitrary output'}}]})};}});
    const qs=[{...exampleQuestions[0],type:'multiple'},{...exampleQuestions[0],id:'q2',type:'judge'}];
    const result=await f.context.XXTDeepSeek.solve(qs,new AbortController().signal,()=>{},{randomFallback:true});
    assert.equal(result.length,2);
    for(const a of result){assert.equal(a.source,'random');assert.ok(a.answer.length>0);assert.ok(a.answer.every(key=>['A','B'].includes(key)));assert.equal(JSON.stringify(a).includes('private arbitrary output'),false);}
    assert.equal(result[1].answer.length,1);
    assert.equal(calls,1,'enabled random fallback must not spend two more requests on invalid choices');
  }
});

test('short answers never receive random text and opt-out still stops on an empty answer',async()=>{
  for(const q of [exampleQuestions[0],shortQuestion]) {
    const {api,calls}=schemaFixture(()=>({answers:[{id:q.id,answer:[]}]}));
    await assert.rejects(()=>api.solve([q],new AbortController().signal,()=>{},{randomFallback:q.type==='short'}),/空答案/);
    assert.equal(calls.length,1);
  }
});

test('failed glyph reading can select only known choices without sending encrypted or placeholder text to the answer model',async()=>{
  let calls=0;
  const f=fixture({}, {local:{deepseek:{apiKey:'sk-test-key-not-a-real-credential'}},fetch:async(url,request)=>{
    calls++;const body=JSON.parse(request.body);assert.ok(Array.isArray(body.messages[1].content));assert.equal(JSON.stringify(body).includes('混淆秘密'),false);
    return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({id:'q1',readable:false,stem:'无法确认',options:[]})}}]})};
  }});
  const opts={randomFallback:true},signal=new AbortController().signal;
  const prepared=await f.context.XXTDeepSeek.prepare([{...exampleQuestions[0],stem:'混淆秘密',encrypted:true,image:'data:image/png;base64,AAAA'}],signal,()=>{},opts);
  assert.equal(prepared[0].randomOnly,true);assert.equal(JSON.stringify(prepared).includes('混淆秘密'),false);
  const result=await f.context.XXTDeepSeek.solve(prepared,signal,()=>{},opts);
  assert.equal(result[0].source,'random');assert.equal(calls,1);
  await assert.rejects(()=>f.context.XXTDeepSeek.solve(prepared,signal,()=>{},{randomFallback:false}),/随机兜底已关闭/);
});

test('random fallback preference defaults on, is top-frame only and survives worker restart',async()=>{
  const f=fixture();await f.send({type:'HELLO'});assert.equal((await f.send({type:'CONTROL',randomFallback:false},2)).randomFallback,true);
  await f.send({type:'CONTROL',randomFallback:false});assert.equal((await fixture(f.store).send({type:'HELLO'})).randomFallback,false);
});

test('automatic fallback continues filling with a marked random answer and does not repeat it during submission wait',async()=>{
  const {f,counts,report}=automaticFixture({fetchOverride:async()=>({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({answers:[{id:'q1',answer:[]},{id:'q2',answer:[shortAnswer]}]})}}]})})});
  await f.send({type:'HELLO'});await f.send({type:'CONTROL',action:'start'});await report();
  const result=await f.send({type:'AUTO_QUIZ'});assert.equal(result.automation.status,'awaiting_confirmation');assert.equal(result.automation.randomCount,1);
  await f.send({type:'AUTO_QUIZ'});assert.equal(counts.submit,1);assert.equal(counts.apply,1);
  assert.ok(Object.hasOwn(result.automation.timings,'answerMs'));
  await f.send({type:'CONTROL',randomFallback:false});assert.match((await f.send({type:'AI_APPLY'})).error,/随机兜底已关闭/);
});
const flushRequests=()=>new Promise(resolve=>setImmediate(resolve));
function queuedFixture() {
  const queued=[],calls=[];let active=0,maxActive=0,aborted=0;
  const f=fixture({}, {local:{deepseek:{apiKey:'sk-test-key-not-a-real-credential'}},fetch:async(url,request)=>{
    const body=JSON.parse(request.body);calls.push(body);active++;maxActive=Math.max(maxActive,active);
    return new Promise((resolve,reject)=>{
      let done=false;
      const onAbort=()=>{if(done)return;done=true;active--;aborted++;reject(new DOMException('aborted','AbortError'));};
      request.signal.addEventListener('abort',onAbort,{once:true});
      queued.push({body,finish(content){if(done)return;done=true;active--;request.signal.removeEventListener('abort',onAbort);resolve({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}]})});}});
    });
  }});
  return {f,queued,calls,stats:()=>({active,maxActive,aborted})};
}

test('six glyph requests run in three bounded waves and keep question order after reversed responses',async()=>{
  const t=queuedFixture();
  const input=Array.from({length:6},(_,i)=>({id:`q${i+1}`,type:'short',stem:'混淆原文',options:[],encrypted:true,image:'data:image/png;base64,AAAA'}));
  const result=t.f.context.XXTDeepSeek.prepare(input,new AbortController().signal);
  for(let wave=0;wave<3;wave++){
    await flushRequests();assert.equal(t.queued.length,2);
    const group=t.queued.splice(0,2);
    for(const pending of group.reverse()){
      const meta=JSON.parse(pending.body.messages[1].content[0].text);
      pending.finish({id:meta.id,readable:true,stem:'题干 '+meta.id,options:[]});
    }
  }
  const prepared=await result;assert.equal(t.stats().maxActive,2);assert.equal(t.calls.length,6);
  assert.deepEqual(Array.from(prepared,q=>q.id),input.map(q=>q.id));
});

test('answer batches overlap with at most two requests and keep original order',async()=>{
  const t=queuedFixture(),qs=Array.from({length:12},(_,i)=>({...exampleQuestions[0],id:`q${i+1}`}));
  const result=t.f.context.XXTDeepSeek.solve(qs,new AbortController().signal);
  const finish=pending=>{const data=JSON.parse(pending.body.messages[1].content);pending.finish({answers:data.questions.map(q=>({id:q.id,answer:['A']}))});};
  await flushRequests();assert.equal(t.queued.length,2);const first=t.queued.shift();finish(t.queued.shift());
  await flushRequests();assert.equal(t.queued.length,1);finish(t.queued.shift());finish(first);
  const answers=await result;assert.equal(t.stats().maxActive,2);assert.equal(t.calls.length,3);
  assert.deepEqual(Array.from(answers,a=>a.id),qs.map(q=>q.id));
});

test('a fatal short transcription cancels the sibling and never starts queued questions',async()=>{
  const t=queuedFixture(),input=Array.from({length:3},(_,i)=>({id:`q${i+1}`,type:'short',stem:'原文',options:[],encrypted:true,image:'data:image/png;base64,AAAA'}));
  const result=t.f.context.XXTDeepSeek.prepare(input,new AbortController().signal,()=>{},{randomFallback:true});
  const rejected=assert.rejects(()=>result,/未能完整确认/);
  await flushRequests();assert.equal(t.queued.length,2);
  t.queued.shift().finish({id:'q1',readable:false,stem:'未知',options:[]});await rejected;await flushRequests();
  assert.equal(t.calls.length,2);assert.equal(t.stats().aborted,1);assert.equal(t.stats().active,0);
});

test('pausing concurrent answer requests never substitutes random choices',async()=>{
  const t=queuedFixture(),controller=new AbortController(),progress=[];
  const result=t.f.context.XXTDeepSeek.solve(Array.from({length:6},(_,i)=>({...exampleQuestions[0],id:`q${i+1}`})),controller.signal,event=>progress.push(event),{randomFallback:true});
  const rejected=assert.rejects(()=>result);await flushRequests();assert.equal(t.calls.length,2);controller.abort();await rejected;await flushRequests();
  assert.equal(t.stats().aborted,2);assert.equal(progress.some(p=>p.phase==='random-fallback'),false);
});

test('turning off fallback while a model request completes prevents a random answer',async()=>{
  let enabled=true;const {api}=schemaFixture(()=>({answers:[{id:'q1',answer:[]}]}));
  await assert.rejects(()=>api.solve(exampleQuestions,new AbortController().signal,event=>{if(event.phase==='schema')enabled=false;},{randomFallback:()=>enabled}),/空答案/);
});

test('pausing before a schema retry aborts without another API request',async()=>{
  const controller=new AbortController();const {api,calls}=schemaFixture(()=>({answers:[]}));
  await assert.rejects(()=>api.solve(exampleQuestions,controller.signal,event=>{if(event.phase==='schema')controller.abort();}));
  assert.equal(calls.length,1);
});
test('an outer-frame confirmation is routed to its owner and clicked once without re-solving',async()=>{
  const {f,counts,report}=automaticFixture();await f.send({type:'HELLO'});await f.send({type:'CONTROL',action:'start'});await report();
  const first=await f.send({type:'AUTO_QUIZ'});
  assert.equal(first.automation.submitPhase,'initial_clicked');
  assert.equal(first.automation.message.includes('已自动提交'),false);
  await f.send({type:'REPORT',videos:[],confirmation:true});
  let confirmations=0;
  f.context.chrome.tabs.sendMessage=async(tab,msg,target)=>{
    assert.equal(msg.type,'QUIZ_CONFIRM');assert.equal(target.frameId,0);assert.equal(msg.page,'top');
    const response=await f.send({type:'PAGE_ACTION',kind:'confirm',token:'outer-confirm'});
    if(response.ok)confirmations++;return {confirmed:response.ok};
  };
  f.context.chrome.scripting.executeScript=async request=>{
    assert.equal(request.target.frameIds[0],0);assert.equal(request.args[0].kind,'confirm');return [{result:{ok:true}}];
  };
  await Promise.all([f.send({type:'CONFIRM_PENDING'}),f.send({type:'CONFIRM_PENDING'})]);
  await f.send({type:'CONFIRM_PENDING'});
  assert.equal(confirmations,1);assert.equal(counts.api,1);assert.equal(counts.submit,1);
  const submitted=await f.send({type:'REPORT',videos:[]});assert.equal(submitted.automation.submitPhase,'confirmation_clicked');assert.equal(submitted.automation.status,'submitted');
  await f.send({type:'REPORT',page:'quiz',videos:[],quiz:{detected:true,count:2,completed:true,fingerprint:'short-fingerprint'}},2);
  assert.equal((await f.send({type:'REPORT',videos:[]})).automation.status,'done');
});
test('confirmation without a verified first submit, after pause or on an unreported frame is refused',async()=>{
  const {f,report}=automaticFixture();await f.send({type:'HELLO'});await f.send({type:'CONTROL',action:'start'});await report();
  await f.send({type:'REPORT',videos:[],confirmation:true});
  assert.equal((await f.send({type:'PAGE_ACTION',kind:'confirm',token:'invalid'})).ok,false);
  await f.send({type:'AUTO_QUIZ'});
  assert.equal((await f.send({type:'PAGE_ACTION',page:'unknown',kind:'confirm',token:'invalid'},5)).ok,false);
  await f.send({type:'CONTROL',action:'pause'});
  assert.equal((await f.send({type:'PAGE_ACTION',kind:'confirm',token:'invalid'})).ok,false);
});
test('legacy submitted state is migrated without treating it as platform success',async()=>{
  const f=fixture({sessions:{1:{allowed:true,running:true,page:'top',autoQuiz:true,automation:{key:'old',status:'submitted',at:100000}}}});
  const state=await f.send({type:'HELLO'});
  assert.equal(state.automation.status,'error');assert.match(state.automation.message,/旧版/);assert.equal(state.quizDone,false);
});
test('resume after a confirmation timeout renews the wait without repeating the first submit',async()=>{
  const {f,counts,report}=automaticFixture();await f.send({type:'HELLO'});await f.send({type:'CONTROL',action:'start'});await report();await f.send({type:'AUTO_QUIZ'});
  f.advance(31000);await report();await f.send({type:'CONFIRM_PENDING'});
  let state=await f.send({type:'REPORT',videos:[]});assert.equal(state.running,false);
  state=await f.send({type:'CONTROL',action:'start'});assert.equal(state.running,true);assert.equal(state.automation.at,131000);
  await f.send({type:'CONFIRM_PENDING'});
  assert.equal((await f.send({type:'REPORT',videos:[]})).running,true);assert.equal(counts.submit,1);
});
test('fill failures identify the question and cause instead of only a generic incomplete message',async()=>{
  const {f,report}=automaticFixture();await f.send({type:'HELLO'});await f.send({type:'CONTROL',action:'start'});await report();
  const original=f.context.chrome.tabs.sendMessage;
  f.context.chrome.tabs.sendMessage=async(tab,msg,target)=>msg.type==='QUIZ_APPLY'?{applied:1,total:2,failed:['q2'],details:[{id:'q2',ok:false,code:'SYNC_FIELD_MISMATCH',reason:'简答提交字段尚未同步',diagnostic:{expectedChars:10,fieldChars:0}}]}:original(tab,msg,target);
  const response=await f.send({type:'AUTO_QUIZ'});assert.match(response.error,/q2.*提交字段尚未同步/);assert.equal(response.automation.fillDiagnostic[0].code,'SYNC_FIELD_MISMATCH');
});


test('automatic continuation is default-on, top-frame-controlled and persisted across worker restart',async()=>{
  const f=fixture();assert.equal((await f.send({type:'HELLO'})).autoContinue,true);
  assert.equal((await f.send({type:'CONTROL',autoContinue:false},2)).autoContinue,true);
  await f.send({type:'CONTROL',autoContinue:false});assert.equal((await fixture(f.store).send({type:'HELLO'})).autoContinue,false);
});
test('continuation pending is isolated by tab and expires with its source report',async()=>{
  const f=fixture();await f.send({type:'HELLO'});await f.send({type:'HELLO'},0,2);
  assert.equal((await f.send({type:'REPORT',videos:[],continuation:true},2)).continuationPending,true);
  assert.equal((await f.send({type:'REPORT',videos:[]},0,2)).continuationPending,false);
  f.advance(6000);assert.equal((await f.send({type:'REPORT',videos:[]})).continuationPending,false);
});
test('a late completed review verifies submission without undoing an explicit stopped state',async()=>{
  const {f,counts,report}=automaticFixture();await f.send({type:'HELLO'});await f.send({type:'CONTROL',action:'start'});await report();await f.send({type:'AUTO_QUIZ'});
  f.advance(31000);await f.send({type:'CONFIRM_PENDING'});assert.equal((await f.send({type:'REPORT',videos:[]})).running,false);
  const state=await f.send({type:'REPORT',page:'quiz',videos:[],quiz:{detected:true,count:0,total:1,completed:true,fingerprint:'review',evidence:'answer-review'}},2);
  assert.equal(state.automation.status,'done');assert.equal(state.running,false);assert.match(state.reason,/点击开始/);assert.equal(counts.submit,1);
});

test('changed editable questions end stale submission waiting without automatically resubmitting',async()=>{
  const {f,counts,report}=automaticFixture();await f.send({type:'HELLO'});await f.send({type:'CONTROL',action:'start'});await report();await f.send({type:'AUTO_QUIZ'});
  await f.send({type:'CONTEXT',context:'another-lesson'});f.advance(4100);
  await f.send({type:'REPORT',page:'new-quiz',videos:[],quiz:{detected:true,count:5,total:5,completed:false,fingerprint:'different-questions'}},2);
  f.advance(4100);await f.send({type:'REPORT',page:'new-quiz',videos:[],quiz:{detected:true,count:5,total:5,completed:false,fingerprint:'different-questions'}},2);
  const result=await f.send({type:'CONFIRM_PENDING'});assert.equal(result.automation.status,'error');assert.match(result.automation.message,/题目已变化/);
  const state=await f.send({type:'REPORT',videos:[]});assert.equal(state.running,false);assert.equal(counts.submit,1);assert.equal(counts.api,1);
});


test('native completed zero-duration video can enter practice despite incomplete lecture illustrations',async()=>{
  const f=fixture();await f.send({type:'HELLO'});
  const card={videos:[],task:completedTask,lesson:{detected:true,ready:false,chars:1706,images:4,loadingImages:true,imageCounts:{loading:1,loaded:3},pendingTasks:false,mediaPending:false}};
  const player={videos:[{completed:false,time:0,duration:0,paused:true}],lesson:{mediaPending:true,mediaBlockers:[{kind:'video',tag:'video'}]}};
  await f.send({type:'REPORT',...card},2);await f.send({type:'REPORT',...player},3);f.advance(4100);
  await f.send({type:'REPORT',...card},2);const s=await f.send({type:'REPORT',...player},3);
  assert.equal(s.taskReady,true);assert.equal(s.taskCompleted,true);assert.equal(s.mediaDone,false);assert.equal(s.lessonLoadingImages,true);assert.equal(s.lessonImageCounts.loading,1);
});
test('lecture image counters are bounded and do not retain URLs or unknown fields',async()=>{
  const f=fixture();await f.send({type:'HELLO'});
  const s=await f.send({type:'REPORT',videos:[],lesson:{detected:true,ready:true,chars:1245,images:6,loadingImages:true,imageCounts:{loaded:9000,loading:-1,failed:2,deferred:1,source:'private-image-url'}}},2);
  const lesson=s.reports[0].lesson;assert.equal(lesson.imageCounts.loaded,1000);assert.equal(lesson.imageCounts.loading,0);assert.equal(s.lessonReady,false);
  assert.equal(JSON.stringify(lesson).includes('private-image-url'),false);
  f.advance(4100);const ready=await f.send({type:'REPORT',videos:[],lesson:{detected:true,ready:true,chars:1245,images:6,loadingImages:true,imageCounts:{loaded:3,failed:2,deferred:1}}},2);
  assert.equal(ready.lessonReady,true);assert.equal(ready.taskCompleted,false);
});
test('launcher handoff starts the existing worker only while its matching token is active',async()=>{
  const f=fixture();f.context.crypto={randomUUID:()=> 'test-launch-flow'};f.context.chrome.tabs.create=async()=>({id:1});f.context.chrome.tabs.update=async()=>({id:1});
  const ui={url:'chrome-extension://test/launcher.html'},course='https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu?courseid=212800861',study='https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=212800861&chapterId=9',actor=url=>({url,frameId:0,tab:{id:1,url}});
  let flow=await f.context.XXTLaunch.handle({type:'LAUNCH_BEGIN'},ui);
  await f.context.XXTLaunch.handle({type:'LAUNCH_OPEN_COURSE',id:flow.id,url:course},actor('https://i.chaoxing.com/base'));
  await f.context.XXTLaunch.handle({type:'LAUNCH_CHAPTER',id:flow.id,pending:2,chapterId:'9'},actor(course));
  await f.send({type:'HELLO'},0,1,study);let claim=await f.send({type:'LAUNCH_AUTOSTART'},0,1,study);assert.equal(claim.start,true);
  await f.context.XXTLaunch.handle({type:'LAUNCH_CANCEL'},ui);
  let result=await f.send({type:'CONTROL',action:'start',launchId:claim.id},0,1,study);assert.equal(result.running,false);assert.match(result.error,/启动流程已停止/);
  flow=await f.context.XXTLaunch.handle({type:'LAUNCH_BEGIN'},ui);await f.context.XXTLaunch.handle({type:'LAUNCH_OPEN_COURSE',id:flow.id,url:course},actor('https://i.chaoxing.com/base'));await f.context.XXTLaunch.handle({type:'LAUNCH_CHAPTER',id:flow.id,pending:1,chapterId:'9'},actor(course));
  claim=await f.send({type:'LAUNCH_AUTOSTART'},0,1,study);result=await f.send({type:'CONTROL',action:'start',launchId:claim.id},0,1,study);assert.equal(result.running,true);
  await f.send({type:'CONTROL',action:'pause'},0,1,study);assert.equal((await f.send({type:'LAUNCH_AUTOSTART'},0,1,study)).start,false);
});
