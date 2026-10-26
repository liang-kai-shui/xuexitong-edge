'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const dir=path.join(__dirname,'..','edge-extension');
const PORTAL='https://i.chaoxing.com/base?vflag=true&fid=&backUrl=',COURSE='https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu?courseid=42&clazzid=7&enc=private-fixture',STUDY='https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=42&clazzid=7&chapterId=9';
function fixture(initial={}){
 let time=100000,id=0;const store=structuredClone(initial),calls=[];
 const context=vm.createContext({URL,Map,crypto:{randomUUID:()=>`flow-${++id}`},Date:class extends Date{static now(){return time;}},chrome:{runtime:{getURL:name=>'chrome-extension://abcdefghijklmnop/'+name},storage:{session:{get:async()=>structuredClone(store),set:async value=>Object.assign(store,structuredClone(value))}},tabs:{create:async options=>{calls.push(['create',options]);return {id:10};},update:async(tab,options)=>{calls.push(['update',tab,options]);return {id:tab};}}}});
 for(const file of ['policy.js','launch-state.js'])vm.runInContext(fs.readFileSync(path.join(dir,file),'utf8'),context);
 const ui={url:'chrome-extension://abcdefghijklmnop/launcher.html?autorun=1'},page=(url=PORTAL,extra={})=>({url,frameId:0,tab:{id:10,url,...extra}});
 const send=(type,data={},sender=ui)=>context.XXTLaunch.handle({type,...data},sender);
 async function begin(){return send('LAUNCH_BEGIN',{courseId:'42'});}
 async function study(){const flow=await begin();await send('LAUNCH_OPEN_COURSE',{id:flow.id,url:COURSE},page());await send('LAUNCH_CHAPTER',{id:flow.id,chapterId:'9',pending:2},page(COURSE));return flow;}
 return {context,store,calls,send,page,ui,begin,study,advance:ms=>{time+=ms;}};
}
test('only trusted launcher can arm startup; reject malformed and credential arguments',async()=>{
 const f=fixture();for(const url of ['https://v8.chaoxing.com/','https://evil.test/launcher.html','chrome-extension://other/launcher.html','chrome-extension://abcdefghijklmnop/options.html'])assert.ok((await f.send('LAUNCH_BEGIN',{}, {url})).error);
 assert.ok((await f.send('LAUNCH_BEGIN',{courseId:'42;anything'})).error);assert.equal(f.calls.length,0);
 const flow=await f.begin();assert.equal(flow.phase,'portal');assert.equal(f.calls[0][1].url,PORTAL);assert.ok((await f.begin()).error);
});
test('QR/manual login progression only from auth host after login form was observed',async()=>{
 const f=fixture(),flow=await f.begin();const event={id:flow.id};
 assert.equal((await f.send('LAUNCH_LOGIN_READY',event,f.page('https://v8.chaoxing.com/'))).ok,false);
 assert.equal((await f.send('LAUNCH_LOGIN_SEEN',event,f.page('https://evil.test/'))).active,false);
 assert.equal((await f.send('LAUNCH_LOGIN_SEEN',event,f.page('https://passport2.chaoxing.com/login'))).ok,true);
 await f.send('LAUNCH_LOGIN_PAGE',event,f.page('https://passport2.chaoxing.com/login'));
 assert.equal(f.calls.at(-1)[2].url,'https://v8.chaoxing.com/');
 assert.equal((await f.send('LAUNCH_LOGIN_PAGE',event,f.page('https://passport2.chaoxing.com/login'))).ok,false);
 assert.equal((await f.send('LAUNCH_LOGIN_READY',event,f.page('https://v8.chaoxing.com/'))).ok,true);
 assert.equal(f.calls.at(-1)[2].url,PORTAL);
});
test('course choices are bounded and credential-free; target binding rejects other courses and unrelated routes',async()=>{
 const f=fixture(),flow=await f.send('LAUNCH_BEGIN');
 await f.send('LAUNCH_CHOICES',{id:flow.id,courses:[{key:'42:7',title:'C language',url:'secret',password:'secret'},{key:'43:8',title:'Math'}]},f.page());
 let view=await f.send('LAUNCH_VIEW');assert.equal(view.choices.length,2);assert.equal(JSON.stringify(f.store).includes('secret'),false);
 assert.ok((await f.send('LAUNCH_SELECT',{courseKey:'99:7'})).error);await f.send('LAUNCH_SELECT',{courseKey:'42:7'});
 for(const url of [COURSE.replace('42','43'),STUDY,'https://evil.test/mycourse/stu?courseid=42','https://mooc1.chaoxing.com/exam?courseid=42'])assert.ok((await f.send('LAUNCH_OPEN_COURSE',{id:flow.id,url},f.page())).error);
 assert.equal((await f.send('LAUNCH_OPEN_COURSE',{id:flow.id,url:COURSE},f.page())).ok,true);
 assert.equal(JSON.stringify(f.store).includes('private-fixture'),false);
});
test('chapter navigation requires current course, explicit pending marker, and one-time claim',async()=>{
 const f=fixture(),flow=await f.begin();await f.send('LAUNCH_OPEN_COURSE',{id:flow.id,url:COURSE},f.page());
 const msg={id:flow.id,chapterId:'9',pending:1};
 assert.equal((await f.send('LAUNCH_CHAPTER',msg,f.page(COURSE.replace('42','43')))).ok,false);
 assert.ok((await f.send('LAUNCH_CHAPTER',{...msg,pending:0},f.page(COURSE))).error);
 assert.equal((await f.send('LAUNCH_CHAPTER',msg,f.page(COURSE))).ok,true);
 assert.equal((await f.send('LAUNCH_CHAPTER',msg,f.page(COURSE))).ok,false);
 assert.equal((await f.send('LAUNCH_AUTOSTART',{},f.page(STUDY.replace('chapterId=9','chapterId=10')))).start,false);
 const start=await f.send('LAUNCH_AUTOSTART',{},f.page(STUDY));assert.equal(start.start,true);
 assert.equal((await f.send('LAUNCH_AUTOSTART',{},f.page(STUDY))).start,false);
 assert.equal(f.context.XXTLaunch.canStart(f.page(STUDY),start.id),true);
 await f.send('LAUNCH_STARTED',{id:start.id,ok:true},f.page(STUDY));assert.equal((await f.send('LAUNCH_VIEW')).phase,'started');
 assert.equal(f.context.XXTLaunch.canStart(f.page(STUDY),start.id),false);
});
test('explicit cancellation or manual pause invalidates startup token, other tabs cannot cancel',async()=>{
 const f=fixture(),flow=await f.study();await f.send('LAUNCH_AUTOSTART',{},f.page(STUDY));
 await f.context.XXTLaunch.cancelForTab(11,false);assert.equal(f.context.XXTLaunch.canStart(f.page(STUDY),flow.id),true);
 await f.send('LAUNCH_CANCEL');assert.equal(f.context.XXTLaunch.canStart(f.page(STUDY),flow.id),false);
 const g=fixture(),next=await g.study();await g.send('LAUNCH_AUTOSTART',{},g.page(STUDY));await g.context.XXTLaunch.cancelForTab(10,false);assert.equal(g.context.XXTLaunch.canStart(g.page(STUDY),next.id),false);
});
test('owner tabs, iframe owners and normal/private contexts remain isolated',async()=>{
 const f=fixture(),flow=await f.begin();
 assert.equal((await f.send('LAUNCH_STATUS',{},f.page(PORTAL,{id:11}))).active,false);
 assert.equal((await f.send('LAUNCH_STATUS',{},f.page(PORTAL,{incognito:true}))).active,false);
 await f.send('LAUNCH_OPEN_COURSE',{id:flow.id,url:COURSE},f.page());
 assert.equal((await f.send('LAUNCH_STATUS',{},f.page(COURSE,{id:11,openerTabId:10}))).active,true);
 assert.equal((await f.send('LAUNCH_STATUS',{},f.page(COURSE))).active,false);
 const sender={url:'https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/studentcourse?courseid=42',frameId:3,tab:{id:11,url:COURSE}};
 assert.equal((await f.send('LAUNCH_MENU',{id:flow.id},sender)).ok,true);
 assert.equal((await f.send('LAUNCH_MENU',{id:flow.id},sender)).ok,false);
});
test('session restoration, bounded waits and uncertain completion do not trigger navigation',async()=>{
 const f=fixture(),flow=await f.begin();
 assert.ok((await f.send('LAUNCH_FINISHED',{id:flow.id,total:2,pending:0,unknown:1},f.page())).error);
 const restored=fixture(f.store);assert.equal((await restored.send('LAUNCH_VIEW')).id,flow.id);
 f.advance(1800001);assert.equal((await f.send('LAUNCH_VIEW')).phase,'attention');
 const g=fixture();await g.study();g.advance(30001);assert.equal((await g.send('LAUNCH_VIEW')).phase,'attention');
 const done=fixture(),d=await done.begin();assert.equal((await done.send('LAUNCH_FINISHED',{id:d.id,total:1,pending:0,unknown:0},done.page())).ok,true);assert.equal((await done.send('LAUNCH_VIEW')).phase,'done');
});
test('startup runner is opt-in and clicks only a visible explicitly pending chapter',async()=>{
 let tick,active=false,phase='course',clicks=0;const messages=[],target={isConnected:true,click(){clicks++;}},rows=[{target,visible:false,done:false,pending:2,chapterId:'9'}];
 const context=vm.createContext({location:{hostname:'mooc2-ans.chaoxing.com'},Date,document:{readyState:'complete'},setInterval(fn){tick=fn;},chrome:{runtime:{async sendMessage(msg){messages.push(msg.type);if(msg.type==='LAUNCH_STATUS')return {active,id:'flow',phase};if(msg.type==='LAUNCH_CHAPTER'){phase='study';return {ok:true};}return {ok:false};}}},XXTStartupDOM:{verification:()=>false,login:()=>({present:false}),chapters:()=>rows,chapterMenu:()=>null,courses:()=>[]}});
 vm.runInContext(fs.readFileSync(path.join(dir,'startup.js'),'utf8'),context);await new Promise(resolve=>setImmediate(resolve));assert.equal(clicks,0);
 active=true;await tick();await new Promise(resolve=>setImmediate(resolve));assert.equal(clicks,0);assert.equal(messages.includes('LAUNCH_CHAPTER'),false);
 rows[0].visible=true;await tick();await new Promise(resolve=>setImmediate(resolve));assert.equal(clicks,1);assert.equal(phase,'study');await tick();await new Promise(resolve=>setImmediate(resolve));assert.equal(clicks,1);
});
test('closing the owning launch tab releases its flow without cancelling other tabs',async()=>{const f=fixture();await f.begin();await f.context.XXTLaunch.closedTab(11);assert.equal((await f.send('LAUNCH_VIEW')).active,true);await f.context.XXTLaunch.closedTab(10);assert.equal((await f.send('LAUNCH_VIEW')).phase,'cancelled');});
test('an auth wrapper never assumes login success from another frame observing a form',async()=>{let tick;const messages=[];const context=vm.createContext({location:{hostname:'v8.chaoxing.com'},Date,document:{readyState:'complete'},setInterval(fn){tick=fn;},chrome:{runtime:{async sendMessage(msg){messages.push(msg.type);return {active:true,id:'flow',phase:'login',loginSeen:true};}}},XXTStartupDOM:{verification:()=>false,login:()=>({present:false}),courses:()=>[],chapters:()=>[],chapterMenu:()=>null}});vm.runInContext(fs.readFileSync(path.join(dir,'startup.js'),'utf8'),context);await new Promise(resolve=>setImmediate(resolve));await tick();await new Promise(resolve=>setImmediate(resolve));assert.equal(messages.includes('LAUNCH_LOGIN_READY'),false);});
test('simulated QR login hands off through portal, chapter menu and pending section to study startup',async()=>{
 const f=fixture();await f.send('LAUNCH_BEGIN');let tick,url='https://v8.chaoxing.com/',form=true,menuClicks=0,chapterClicks=0,qrClicks=0,rows=[];
 const location={hostname:'v8.chaoxing.com'},menu={isConnected:true,click(){menuClicks++;rows=[{visible:true,done:false,pending:2,chapterId:'9',target:{isConnected:true,click(){chapterClicks++;}}}];}},qr={click(){qrClicks++;}};
 const context=vm.createContext({location,Date,document:{readyState:'complete'},setInterval(fn){tick=fn;},chrome:{runtime:{sendMessage:msg=>f.send(msg.type,msg,f.page(url))}},XXTStartupDOM:{verification:()=>false,login:()=>({present:form,qr}),courses:()=>url.includes('i.chaoxing.com')?[{key:'42:7',courseId:'42',title:'C language',complete:false,url:COURSE}]:[],chapters:()=>rows,chapterMenu:()=>menu}});
 const flush=()=>new Promise(resolve=>setImmediate(resolve)),navigate=next=>{url=next;location.hostname=new URL(next).hostname;};
 vm.runInContext(fs.readFileSync(path.join(dir,'startup.js'),'utf8'),context);await flush();assert.equal(qrClicks,1);assert.equal((await f.send('LAUNCH_VIEW')).phase,'login');
 form=false;navigate(PORTAL);tick();await flush();assert.equal(f.calls.at(-1)[2].url,COURSE);
 navigate(COURSE);tick();await flush();assert.equal(menuClicks,1);tick();await flush();assert.equal(chapterClicks,1);assert.equal((await f.send('LAUNCH_VIEW')).phase,'study');
 navigate(STUDY);const claim=await f.send('LAUNCH_AUTOSTART',{},f.page(url));assert.equal(claim.start,true);assert.equal(f.context.XXTLaunch.canStart(f.page(url),claim.id),true);
});
test('login form owner survives navigation while auth wrappers cannot falsely complete login',async()=>{const f=fixture(),flow=await f.begin(),child={url:'https://passport2.chaoxing.com/login',frameId:3,tab:{id:10,url:'https://v8.chaoxing.com/'}};await f.send('LAUNCH_LOGIN_SEEN',{id:flow.id},child);assert.equal((await f.send('LAUNCH_STATUS',{},child)).loginOwner,true);assert.equal((await f.send('LAUNCH_STATUS',{},f.page('https://v8.chaoxing.com/'))).loginOwner,false);assert.equal((await f.send('LAUNCH_LOGIN_READY',{id:flow.id},f.page('https://v8.chaoxing.com/'))).ok,false);assert.equal((await f.send('LAUNCH_LOGIN_READY',{id:flow.id},{...child,url:'https://passport2.chaoxing.com/success'})).ok,true);});
test('trusted launcher URL alias stays bound to this extension host',async()=>{const f=fixture();assert.ok((await f.send('LAUNCH_BEGIN',{}, {url:'extension://wrong/launcher.html'})).error);assert.equal((await f.send('LAUNCH_BEGIN',{}, {url:'extension://abcdefghijklmnop/launcher.html?autorun=1'})).phase,'portal');});
test('QR management landing redirects once to the fixed personal-space URL, not arbitrary URLs',async()=>{
 const f=fixture(),flow=await f.begin(),landing={...f.page('https://v1.chaoxing.com/manage?ws=1'),documentId:'landing-1'};
 await f.send('LAUNCH_LOGIN_SEEN',{id:flow.id},f.page('https://v8.chaoxing.com/'));
 for(const bad of [f.page('https://v1.chaoxing.com/not-manage'),f.page('https://evilchaoxing.com/manage'),{...landing,frameId:3},f.page(landing.url,{id:99})])assert.notEqual((await f.send('LAUNCH_PORTAL_LANDING',{id:flow.id},bad)).ok,true);
 const before=f.calls.length;assert.equal((await f.send('LAUNCH_PORTAL_LANDING',{id:flow.id,url:'https://evil.test/'},landing)).ok,true);assert.equal(f.calls.length,before+1);assert.equal(f.calls.at(-1)[2].url,PORTAL);
 assert.equal((await f.send('LAUNCH_PORTAL_LANDING',{id:flow.id},landing)).ok,false);assert.equal(f.calls.length,before+1);
 assert.equal((await f.send('LAUNCH_PORTAL_LANDING',{id:flow.id},{...landing,documentId:'landing-return'})).ok,false);assert.equal((await f.send('LAUNCH_VIEW')).phase,'attention');assert.equal(f.calls.length,before+1);
});
test('known management landing can adopt an auth-created child tab, while cancellation prevents navigation',async()=>{
 const f=fixture(),flow=await f.begin(),child={...f.page('https://v1.chaoxing.com/manage?ws=1',{id:11,openerTabId:10}),documentId:'landing'};
 assert.equal((await f.send('LAUNCH_STATUS',{},child)).active,true);assert.equal((await f.send('LAUNCH_PORTAL_LANDING',{id:flow.id},child)).ok,true);assert.equal(f.calls.at(-1)[1],11);
 const g=fixture(),cancelled=await g.begin();await g.send('LAUNCH_CANCEL');const before=g.calls.length;assert.equal((await g.send('LAUNCH_PORTAL_LANDING',{id:cancelled.id},g.page(child.url))).active,false);assert.equal(g.calls.length,before);
});
test('management-page runner sends one navigation request per flow and respects verification',async()=>{
 let tick,blocked=true;const messages=[];const context=vm.createContext({location:{hostname:'v1.chaoxing.com',pathname:'/manage'},Date,document:{readyState:'complete'},setInterval(fn){tick=fn;},chrome:{runtime:{async sendMessage(msg){messages.push(msg.type);return msg.type==='LAUNCH_STATUS'?{active:true,id:'flow',phase:'login'}:{ok:true};}}},XXTStartupDOM:{verification:()=>blocked}});
 vm.runInContext(fs.readFileSync(path.join(dir,'startup.js'),'utf8'),context);await new Promise(resolve=>setImmediate(resolve));assert.equal(messages.includes('LAUNCH_PORTAL_LANDING'),false);
 blocked=false;tick();await new Promise(resolve=>setImmediate(resolve));tick();await new Promise(resolve=>setImmediate(resolve));assert.equal(messages.filter(type=>type==='LAUNCH_PORTAL_LANDING').length,1);
});
test('course entry accepts stucoursemiddle without treating it as a learning page',()=>{
 const f=fixture(),url='https://mooc1.chaoxing.com/visit/stucoursemiddle?courseid=212800861&clazzid=155540401&cpi=fixture-only&ismooc2=1&v=2';
 assert.equal(f.context.XXTPolicy.courseEntry(url).key,'212800861:155540401');assert.equal(f.context.XXTPolicy.courseInfo(url),null);assert.equal(f.context.XXTPolicy.coursePage(url),false);assert.equal(f.context.XXTPolicy.courseEntry(STUDY),null);
 for(const bad of [url.replace('https:','http:'),url.replace('mooc1.chaoxing.com','evilchaoxing.com'),url+'&courseId=99',url+'&clazzid=99',url.replace('212800861','0'),url.replace('/visit/stucoursemiddle','/exam/stucoursemiddle')])assert.equal(f.context.XXTPolicy.courseEntry(bad),null);
});
test('middle entry preserves the native URL and binds the eventual course and study page',async()=>{
 const f=fixture(),flow=await f.begin(),middle='https://mooc1.chaoxing.com/visit/stucoursemiddle?courseid=42&clazzid=7&cpi=fixture-only&ismooc2=1&v=2';
 assert.ok((await f.send('LAUNCH_OPEN_COURSE',{id:flow.id,url:middle.replace('42','43')},f.page())).error);
 assert.equal((await f.send('LAUNCH_OPEN_COURSE',{id:flow.id,url:middle},f.page())).ok,true);assert.equal(f.calls.at(-1)[2].url,middle);assert.equal((await f.send('LAUNCH_AUTOSTART',{},f.page(middle))).start,false);
 assert.equal((await f.send('LAUNCH_MENU',{id:flow.id},f.page(COURSE))).ok,true);assert.equal((await f.send('LAUNCH_CHAPTER',{id:flow.id,pending:1,chapterId:'9'},f.page(COURSE))).ok,true);assert.equal((await f.send('LAUNCH_AUTOSTART',{},f.page(STUDY))).start,true);
 assert.equal(JSON.stringify(f.store).includes('fixture-only'),false);
});
test('middle entry opened in the owned tab child can continue while unrelated child courses cannot take over',async()=>{
 const f=fixture();await f.begin();const middle='https://mooc1.chaoxing.com/visit/stucoursemiddle?courseid=42&clazzid=7';
 assert.equal((await f.send('LAUNCH_STATUS',{},f.page(middle.replace('42','43'),{id:11,openerTabId:10}))).active,false);
 assert.equal((await f.send('LAUNCH_STATUS',{},f.page(middle,{id:11,openerTabId:10}))).active,true);
});
test('portal diagnostics report bounded counts only, and are readable only from launcher',async()=>{
 const f=fixture(),flow=await f.begin();
 for(let i=0;i<35;i++)await f.send('LAUNCH_PORTAL_SCAN',{id:flow.id,links:999999,candidates:1,recognized:0,url:'https://private.test/secret',password:'private-test-password'}, {...f.page(),frameId:i});
 const out=await f.send('LAUNCH_DIAGNOSTIC');assert.equal(out.diagnostic.frames.length,32);assert.equal(out.diagnostic.frames[0].links,10000);assert.match(out.message,/尚未识别入口/);assert.equal(JSON.stringify(out.diagnostic).includes('private'),false);assert.equal(JSON.stringify(f.store).includes('private-test-password'),false);
 assert.ok((await f.send('LAUNCH_DIAGNOSTIC',{},f.page())).error);
});
