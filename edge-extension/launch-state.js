/* Launch navigation only; credentials and login tokens are never read or saved. */
(() => {
  'use strict';
  const LOGIN='https://v8.chaoxing.com/',PORTAL='https://i.chaoxing.com/base?vflag=true&fid=&backUrl=';
  const active=f=>f && ['login','portal','course','study','starting'].includes(f.phase);
  const flows=new Map();
  const ready=chrome.storage.session.get('launchFlows').then(data=>{for(const [key,value] of Object.entries(data.launchFlows || {}))flows.set(key,value);});
  const save=()=>chrome.storage.session.set({launchFlows:Object.fromEntries(flows)});
  const scope=sender=>sender.tab?.incognito===true?'private':'normal';
  const trusted=sender=>{try{const u=new URL(sender.url),expected=new URL(chrome.runtime.getURL('launcher.html'));return (u.protocol===expected.protocol || (u.protocol==='extension:' && expected.protocol==='chrome-extension:')) && u.host===expected.host && u.pathname===expected.pathname;}catch{return false;}};
  const source=sender=>{try{const u=new URL(sender.url);return u.protocol==='https:' && !u.username && !u.password && /(^|\.)chaoxing\.com$/.test(u.hostname)?u:null;}catch{return null;}};
  const loginLanding=raw=>{try{const u=new URL(raw);return u.protocol==='https:' && !u.username && !u.password && u.hostname==='v1.chaoxing.com' && /^\/manage\/?$/.test(u.pathname);}catch{return false;}};
  const clean=text=>String(text || '').replace(/\s+/g,' ').trim().slice(0,120);
  function view(f){const meta={protocol:'xxt-launch-v1',version:chrome.runtime.getManifest?.().version || ''};if(!f)return {...meta,active:false,phase:'idle',message:'准备启动'};return {...meta,active:!!active(f),id:f.id,phase:f.phase,courseId:f.courseId || '',courseKey:f.courseKey || '',chapterId:f.chapterId || '',loginMode:f.loginMode,loginSeen:!!f.loginSeen,message:f.message,choices:f.choices || []};}
  async function status(sender){
    const f=flows.get(scope(sender));if(!f)return null;
    if(active(f) && Date.now()-f.createdAt>1800000){f.phase='attention';f.message='启动等待已超过 30 分钟，请重新启动';await save();}
    if(active(f) && f.stepAt && ['course','study','starting'].includes(f.phase) && Date.now()-f.stepAt>30000){f.phase='attention';f.message='页面未确认切换，请检查当前课程窗口后重新启动';await save();}
    if(active(f) && sender.frameId===0 && sender.tab?.id!==f.tabId && sender.tab?.openerTabId===f.tabId){
      const info=XXTPolicy.courseEntry(sender.url || '') || XXTPolicy.courseInfo(sender.url || '');
      if((info && (!f.courseId || info.courseId===f.courseId) && (!f.courseKey || info.key===f.courseKey)) || (!f.courseKey && ['login','portal'].includes(f.phase) && loginLanding(sender.url))){f.tabId=sender.tab.id;await save();}
    }
    return f;
  }
  async function handle(msg,sender){
    await ready;const key=scope(sender),ui=trusted(sender);
    if(msg.type==='LAUNCH_BEGIN'){
      if(!ui)return {error:'启动入口无效'};
      if(msg.courseId && !/^[1-9]\d{0,19}$/.test(msg.courseId))return {error:'课程编号需为数字，可留空自动识别'};
      const old=await status(sender);if(active(old))return {error:'已有启动流程正在等待，请先停止该流程'};
      const f={id:crypto.randomUUID(),phase:'portal',courseId:msg.courseId || '',courseKey:'',loginMode:msg.loginMode==='account'?'account':'qr',createdAt:Date.now(),message:'正在检查登录状态，需要时会打开扫码登录页',tabId:null,choices:[]};
      flows.set(key,f);await save();
      try{const tab=await chrome.tabs.create({url:PORTAL,active:true});if(!Number.isInteger(tab?.id))throw Error('missing tab');f.tabId=tab.id;await save();return view(f);}catch{f.phase='attention';f.message='无法打开登录窗口，请检查扩展与浏览器';await save();return {error:f.message};}
    }
    const f=await status(sender);
    if(msg.type==='LAUNCH_VIEW')return ui?view(f):{error:'启动入口无效'};
    if(msg.type==='LAUNCH_DIAGNOSTIC'){
      if(!ui)return {error:'启动入口无效'};
      const state=view(f);return {...state,diagnostic:{version:state.version,phase:state.phase,courseId:state.courseId || '',message:state.message,frames:Object.values(f?.portalScans || {}).map(({frameId,links,candidates,recognized})=>({frameId,links,candidates,recognized}))}};
    }
    if(msg.type==='LAUNCH_CANCEL'){
      if(!ui)return {error:'启动入口无效'};if(f){f.phase='cancelled';f.message='启动导航已停止；已启动的课程请在课程浮窗中暂停';await save();}return view(f);
    }
    if(msg.type==='LAUNCH_SELECT'){
      if(!ui || !active(f) || !f.choices?.some(item=>item.key===msg.courseKey))return {error:'请从当前列出的课程中选择'};
      f.courseKey=msg.courseKey;f.courseId=msg.courseKey.split(':')[0];f.choices=[];f.message='已选择课程，正在进入';await save();return view(f);
    }
    if(msg.type==='LAUNCH_PORTAL' && ui){
      if(!active(f) || !Number.isInteger(f.tabId))return {error:'请先启动登录窗口'};
      f.phase='portal';f.message='正在打开课程列表';await save();await chrome.tabs.update(f.tabId,{url:PORTAL,active:true});return view(f);
    }
    const u=source(sender);
    if(!u || !sender.tab || !Number.isInteger(sender.frameId) || !active(f) || f.tabId!==sender.tab.id)return {active:false,start:false};
    if(msg.type==='LAUNCH_STATUS')return {...view(f),loginOwner:f.loginFrameId===sender.frameId};
    if(msg.type!=='LAUNCH_AUTOSTART' && msg.id!==f.id)return {error:'启动流程已变化'};
    if(msg.type==='LAUNCH_PORTAL_LANDING' && sender.frameId===0 && ['login','portal'].includes(f.phase) && loginLanding(sender.url)){
      const documentId=typeof sender.documentId==='string'?sender.documentId:'';
      if(f.landingRedirected){
        if(documentId && f.landingDocument===documentId)return {ok:false};
        f.phase='attention';f.message='进入个人空间后又返回了管理页，请检查登录状态，手动进入个人空间后重新启动';await save();return {ok:false};
      }
      f.landingRedirected=true;f.landingDocument=documentId;f.phase='portal';f.message='扫码登录已进入管理页，正在转到个人空间课程列表';await save();
      if(!active(f))return {ok:false};
      await chrome.tabs.update(f.tabId,{url:PORTAL,active:true});return {ok:true};
    }
    if(msg.type==='LAUNCH_LOGIN_SEEN' && ['v8.chaoxing.com','passport2.chaoxing.com'].includes(u.hostname)){
      f.loginSeen=true;f.loginFrameId=sender.frameId;f.phase='login';f.message='请在 Edge 窗口扫码或手动登录';await save();return {ok:true};
    }
    if(msg.type==='LAUNCH_LOGIN_READY' && f.phase==='login' && f.loginSeen && f.loginFrameId===sender.frameId && ['v8.chaoxing.com','passport2.chaoxing.com'].includes(u.hostname)){
      f.phase='portal';f.message='登录页面已退出，正在打开课程列表';await save();await chrome.tabs.update(f.tabId,{url:PORTAL});return {ok:true};
    }
    if(msg.type==='LAUNCH_LOGIN_PAGE' && ['passport2.chaoxing.com'].includes(u.hostname)){
      if(f.loginRedirected)return {ok:false};f.loginRedirected=true;f.phase='login';f.message='请扫码或手动登录';await save();await chrome.tabs.update(f.tabId,{url:LOGIN});return {ok:true};
    }
    if(msg.type==='LAUNCH_PORTAL_SCAN' && ['login','portal'].includes(f.phase)){
      const count=value=>Number.isInteger(value) && value>=0?Math.min(value,10000):0;
      f.portalScans ||= {};
      if(Object.keys(f.portalScans).length<32 || f.portalScans[sender.frameId])f.portalScans[sender.frameId]={frameId:sender.frameId,links:count(msg.links),candidates:count(msg.candidates),recognized:count(msg.recognized)};
      const frames=Object.values(f.portalScans);
      if(!f.choices?.length)f.message=frames.some(r=>r.recognized>0)?'已识别课程入口，正在匹配目标课程':frames.some(r=>r.candidates>0)?'已看到课程卡片，但尚未识别入口；请复制启动诊断':'正在等待课程列表加载；可复制启动诊断';
      await save();return {ok:true};
    }
    if(msg.type==='LAUNCH_CHOICES' && ['login','portal'].includes(f.phase) && /(^|\.)chaoxing\.com$/.test(u.hostname)){
      f.choices=(Array.isArray(msg.courses)?msg.courses:[]).filter(c=>/^\d{1,20}:\d{0,20}$/.test(c?.key)).slice(0,30).map(c=>({key:c.key,title:clean(c.title)}));f.message='检测到多门课程，请回启动面板选择一门';await save();return {ok:true};
    }
    if(msg.type==='LAUNCH_OPEN_COURSE' && ['login','portal'].includes(f.phase)){
      const info=XXTPolicy.courseEntry(msg.url || '');
      if(!info || /\/studentstudy\/?$/.test(new URL(msg.url).pathname) || (f.courseId && f.courseId!==info.courseId) || (f.courseKey && f.courseKey!==info.key))return {error:'课程链接与所选目标不匹配'};
      f.courseId=info.courseId;f.courseKey=info.key;f.phase='course';f.message='正在打开课程并查找章节';f.stepAt=Date.now();f.choices=[];await save();await chrome.tabs.update(f.tabId,{url:msg.url,active:true});return {ok:true};
    }
    const info=XXTPolicy.courseInfo(sender.tab.url || sender.url || '');
    const sameCourse=info && info.key===f.courseKey;
    // Chapter frames can have a different URL from the owning course tab.
    const chapterFrame=/\/mycourse\/studentcourse\/?$/.test(u.pathname) && u.searchParams.get('courseid')===f.courseId;
    if(msg.type==='LAUNCH_MENU' && f.phase==='course' && (sameCourse || chapterFrame)){
      if(f.menuClicked)return {ok:false};f.menuClicked=true;f.stepAt=Date.now();f.message='正在打开章节目录';await save();return {ok:true};
    }
    if(msg.type==='LAUNCH_CHAPTER' && f.phase==='course' && (sameCourse || chapterFrame)){
      if(!Number.isInteger(msg.pending) || msg.pending<1 || msg.pending>10000)return {error:'章节没有明确的待完成任务标记'};
      f.chapterId=/^[1-9]\d{0,19}$/.test(msg.chapterId || '')?msg.chapterId:'';f.phase='study';f.stepAt=Date.now();f.message='正在进入第一个未完成章节';await save();return {ok:true};
    }
    if(msg.type==='LAUNCH_FINISHED' && ['portal','course'].includes(f.phase)){
      if(!Number.isInteger(msg.total) || msg.total<1 || msg.total>10000 || msg.pending!==0 || msg.unknown!==0 || (f.phase==='course' && !sameCourse && !chapterFrame))return {error:'完成状态不确定'};
      f.phase='done';f.message='当前列表没有未完成任务，未启动课程播放';await save();return {ok:true};
    }
    if(msg.type==='LAUNCH_AUTOSTART' && sender.frameId===0 && f.phase==='study' && sameCourse && /\/studentstudy\/?$/.test(u.pathname)){
      const chapter=u.searchParams.get('chapterId') || u.searchParams.get('chapterid') || '';
      if(f.chapterId && chapter!==f.chapterId)return {start:false};
      f.phase='starting';f.startTab=sender.tab.id;f.stepAt=Date.now();f.message='章节已打开，正在启动学习助手';await save();return {start:true,id:f.id};
    }
    if(msg.type==='LAUNCH_STARTED' && sender.frameId===0 && f.phase==='starting' && f.startTab===sender.tab.id){
      f.phase=msg.ok===true?'started':'attention';f.message=msg.ok===true?'助手已启动，后续进度请看课程浮窗':'章节已打开，但助手未启动；请检查课程浮窗提示';await save();return {ok:true};
    }
    return {ok:false,start:false};
  }
  async function cancelForTab(tabId,incognito){
    await ready;const f=flows.get(incognito?'private':'normal');
    if(active(f) && f.tabId===tabId){f.phase='cancelled';f.message='课程已手动暂停，启动导航已停止';await save();}
  }
  function canStart(sender,id){const f=flows.get(scope(sender));return !!f && f.id===id && f.phase==='starting' && f.startTab===sender.tab?.id && sender.frameId===0 && Date.now()-f.stepAt<=30000;}
  async function closedTab(tabId){await ready;let changed=false;for(const f of flows.values()){if(active(f) && f.tabId===tabId){f.phase='cancelled';f.message='启动窗口已关闭，请重新启动';changed=true;}}if(changed)await save();}
  globalThis.XXTLaunch=Object.freeze({handle,cancelForTab,canStart,closedTab});
})();
