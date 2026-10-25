"use strict";
importScripts("policy.js", "deepseek.js", "page-action.js");
const sessions = new Map();
const aiJobs = new Map();
const confirmingTabs=new Set();
const pendingSubmission=record=>['awaiting_confirmation','confirming','submitted'].includes(record?.status);
function panelSettings(value) {
  const position=value?.position;
  return {minimized:value?.minimized===true,position:position && Number.isFinite(position.x) && Number.isFinite(position.y)?{x:Math.max(0,Math.min(1,position.x)),y:Math.max(0,Math.min(1,position.y))}:null};
}
void chrome.storage.local?.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
const ready = chrome.storage.session.get("sessions").then(data => {
  let recoveredRunning=false;
  for (const [key, saved] of Object.entries(data.sessions || {})) {
    if(saved.allowed && saved.running) {
      if(recoveredRunning) {saved.running=false;saved.mode='attention';saved.reason='恢复时发现其他课程标签页正在运行；本页已暂停';}
      else recoveredRunning=true;
    }
    if(saved.automation?.status==='submitted' && !saved.automation.submitPhase) {
      saved.automation={...saved.automation,status:'error',message:'旧版仅点击首次提交，需重新核验提交状态'};
    }
    sessions.set(Number(key), { ...saved,
      playbackRate: XXTPolicy.validRate(saved.playbackRate) ? saved.playbackRate : 0,
      autoQuiz: saved.autoQuiz ?? true,
      randomFallback:saved.randomFallback ?? true,
      foregroundCompat:!!saved.foregroundCompat,
      mouseGuard:saved.mouseGuard ?? true,
      courseId:saved.courseId || '',courseKey:saved.courseKey || '',
      generation: Number(saved.generation) || 0, context: saved.context || "", reports: new Map(), changedAt: Date.now() });
  }
});
async function save() {
  const saved = {};
  for (const [key, s] of sessions) {
    saved[key] = { allowed: s.allowed, running: s.running, autoNext: s.autoNext,
      muted: s.muted, resume: s.resume, playbackRate: s.playbackRate,randomFallback:s.randomFallback,
      reason: s.reason, page: s.page, epoch: s.epoch, mode: s.mode, context:s.context, generation:s.generation, autoQuiz:s.autoQuiz, foregroundCompat:s.foregroundCompat, mouseGuard:s.mouseGuard,courseId:s.courseId,courseKey:s.courseKey, automation:s.automation };
  }
  await chrome.storage.session.set({ sessions: saved });
}
function stateFor(tabId) {
  if (!sessions.has(tabId)) sessions.set(tabId, {
    allowed: false, running: false, mode: "idle", autoNext: true, autoQuiz:true, randomFallback:true, foregroundCompat:false, mouseGuard:true, muted: false, resume: true, playbackRate: 0, automation:null,
    reason: "点击开始后启动学习助手",courseId:'',courseKey:'', page: "", epoch: 0, generation: 0, context: "", reports: new Map(), changedAt: Date.now()
  });
  return sessions.get(tabId);
}
function snapshot(s) {
  const result = XXTPolicy.select([...s.reports.values()], Date.now());
  const quizzes = result.fresh.filter(r => r.quiz?.detected);
  const quizDone = quizzes.length > 0 && quizzes.every(r => r.quiz.completed);
  const lessons=result.fresh.filter(r=>r.lesson?.detected);
  const lessonPendingTasks=result.fresh.some(r=>r.lesson?.pendingTasks);
  const lessonMediaPending=result.fresh.some(r=>r.lesson?.mediaPending);
  const tasks=result.fresh.filter(r=>r.task?.detected);
  const taskCompleted=tasks.length>0 && tasks.every(r=>r.task.completed);
  const taskVideoTasks=tasks.reduce((sum,r)=>sum+r.task.videoTasks,0);
  const taskResourcePending=result.count>taskVideoTasks || result.fresh.some(r=>r.lesson?.mediaPending && (!r.lesson.mediaBlockers.length || r.lesson.mediaBlockers.some(item=>item.kind!=='video')));
  const taskReady=taskCompleted && !result.blocked && !quizzes.length && !lessonPendingTasks && !taskResourcePending && !result.fresh.some(r=>r.lesson?.loadingImages) && Date.now()-s.changedAt>=4000;
  return { allowed: s.allowed, running: s.running, courseId:s.courseId,courseKey:s.courseKey,mode: s.mode, autoNext: s.autoNext,
    muted: s.muted, resume: s.resume, playbackRate: s.playbackRate, reason: s.reason, epoch: s.epoch,
    generation: s.generation, autoQuiz:s.autoQuiz, randomFallback:s.randomFallback, foregroundCompat:s.foregroundCompat, mouseGuard:s.mouseGuard, automation:s.automation || null, quizDetected: quizzes.length > 0, quizDone,
    quizCount: quizzes.reduce((sum, r) => sum + r.quiz.count, 0),
    quizUnsupported:quizzes.reduce((sum,r)=>sum+r.quiz.unsupported,0),
    lessonDetected:lessons.length>0,lessonReady:lessons.length>0 && lessons.every(r=>r.lesson.ready) && !lessonPendingTasks && !lessonMediaPending && !result.blocked && result.count===0 && !quizzes.length && Date.now()-s.changedAt>=4000,
    lessonChars:lessons.reduce((sum,r)=>sum+r.lesson.chars,0),lessonImages:lessons.reduce((sum,r)=>sum+r.lesson.images,0),
    lessonPendingTasks,lessonMediaPending,lessonLoadingImages:lessons.some(r=>r.lesson.loadingImages),
    lessonMediaReasons:[...new Set(result.fresh.flatMap(r=>(r.lesson?.mediaBlockers || []).map(b=>`${r.frameId}:${b.kind}`)))].slice(0,20),
    lessonKey:lessons.map(r=>`${r.frameId}:${r.page}:${r.lesson.signature}:${r.lesson.ready}`).join('|'),
    taskDetected:tasks.length>0,taskCompleted,taskReady,taskResourcePending,
    taskTotal:tasks.reduce((sum,r)=>sum+r.task.total,0),taskDone:tasks.reduce((sum,r)=>sum+r.task.done,0),
    taskKey:tasks.map(r=>`${r.frameId}:${r.page}:${r.task.signature}:${r.task.completed}`).join('|'),
    activeFrame: result.activeFrame, count: result.count,
    mediaDone: result.allDone,
    allDone: (result.allDone || (result.count === 0 && quizDone)) && (!tasks.length || taskCompleted) && (!quizzes.length || quizDone) && Date.now() - s.changedAt >= 4000,
    reports: result.fresh };
}
function cancelJob(tabId) {
  aiJobs.get(tabId)?.controller.abort();
  aiJobs.delete(tabId);
}
async function optionsMessage(msg) {
  const previous = await XXTDeepSeek.settings();
  if (msg.type === "OPTIONS_SAVE") {
    const apiKey = typeof msg.apiKey === "string" ? msg.apiKey.trim() : "";
    if (apiKey && !/^sk-[A-Za-z0-9_-]{10,200}$/.test(apiKey)) return { error: "API Key 格式不正确" };
    await chrome.storage.local.set({ deepseek: {
      apiKey: msg.clear ? "" : apiKey || previous.apiKey,
      model: XXTDeepSeek.MODELS.includes(msg.model) ? msg.model : previous.model,
      effort:XXTDeepSeek.EFFORTS.includes(msg.effort)?msg.effort:previous.effort
    } });
  }
  const current = await XXTDeepSeek.settings();
  return { hasKey: !!current.apiKey, model: current.model,effort:current.effort };
}
async function solveQuiz(s, sender) {
  const existing = aiJobs.get(sender.tab.id);
  if (existing?.busy) return { error: "已有答题请求正在进行，请等待" };
  const report = snapshot(s).reports.find(r => r.quiz?.detected && r.quiz.count > 0 && !r.quiz.completed);
  if (!report) return { error: "当前没有识别到可答的章节题目" };
  const job = { controller: new AbortController(), busy: true, page: s.page, generation: s.generation };
  aiJobs.set(sender.tab.id, job);
  const timeout = setTimeout(() => job.controller.abort(), 240000);
  const timings={},started=Date.now();let stage='read',stageAt=started;
  const nextStage=name=>{timings[stage+'Ms']=Date.now()-stageAt;stage=name;stageAt=Date.now();};
  try {
    const extracted = await chrome.tabs.sendMessage(sender.tab.id, { channel: "xxt-player-v1", type: "QUIZ_READ" }, { frameId: report.frameId });
    if(extracted?.error)throw new Error(extracted.error);
    if (extracted?.page !== report.page) throw new Error("题目页面已经变化，请重新识别");
    if (extracted.unsupported) throw new Error(`存在 ${extracted.unsupported} 道未支持的题目，已停止自动作答`);
    nextStage('transcribe');
    const progressHandler = progress => {
      job.progress=progress;
      const record=s.automation;
      if(!record || record.status!=='working' || s.generation!==job.generation) return;
      if(progress.phase==='batch') record.message=`正在请求第 ${progress.batch}/${progress.batches} 批答案`;
      if(progress.phase==='transcribing') record.message=`检测到混淆字体，正在按页面字形读取 ${progress.id}`;
      if(progress.phase==='prepared') record.message=`题干准备 ${progress.completed}/${progress.total}${progress.randomOnly?'（该题将随机兜底）':''}`;
      if(progress.phase==='batch-complete') record.message=`答案完成 ${progress.completed}/${progress.batches} 批`;
      if(progress.phase==='random-fallback' || progress.phase==='random-fallback-pending') {record.message=`${progress.id} 将使用随机兜底（非模型答案）`;record.diagnostic={phase:progress.phase,id:progress.id,cause:progress.cause};}
      if(progress.phase==='transcription-format') record.diagnostic={phase:progress.phase,id:progress.id,attempt:progress.attempt,...progress.diagnostic};
      if(progress.phase==='transcription-retry') {
        record.message=`字形读题 ${progress.id} 返回格式无效，正在重新读取图片（1/1）`;
        record.diagnostic={phase:progress.phase,id:progress.id,attempt:progress.attempt,...progress.diagnostic};
      }
      if(progress.phase==='schema') record.diagnostic=progress;
      if(progress.phase==='retry') {
        record.message=`返回题号或格式不匹配，正在自动重试 ${progress.id}（${progress.attempt}/2）`;
        record.diagnostic=progress.diagnostic;
      }
    };
    const fallbackOptions={randomFallback:()=>s.randomFallback};
    const qs=await XXTDeepSeek.prepare(extracted.questions,job.controller.signal,progressHandler,fallbackOptions);
    nextStage('answer');
    const answers = await XXTDeepSeek.solve(qs, job.controller.signal, progressHandler,fallbackOptions);
    nextStage('complete');
    if (s.page !== job.page || s.generation !== job.generation || aiJobs.get(sender.tab.id) !== job) throw new Error("章节已经切换，已丢弃旧题答案");
    job.result = { frameId: report.frameId, page: report.page, fingerprint: extracted.fingerprint, questions: qs, answers,timings };
    return { result: job.result };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "答题请求失败" };
  } finally {
    timings[stage+'Ms']=Date.now()-stageAt;timings.totalMs=Date.now()-started;
    if(s.page===job.page && s.generation===job.generation && aiJobs.get(sender.tab.id)===job && s.automation?.status==='working')s.automation.timings=timings;
    clearTimeout(timeout);job.busy = false;
  }
}
async function autoQuiz(s,sender) {
  if (!s.running || !s.autoQuiz) return {automation:s.automation};
  const snap=snapshot(s);
  if (!snap.quizDetected || snap.quizDone || snap.reports.some(r=>r.blocked)) return {automation:s.automation};
  const report=snap.reports.find(r=>r.quiz?.detected && !r.quiz.completed && r.quiz.count);
  if (!report) return {automation:s.automation};
  const key=`${s.context}:${report.quiz.fingerprint}`;
  if(pendingSubmission(s.automation) && s.automation.fingerprint===report.quiz.fingerprint) return confirmQuiz(s,sender);
  if (s.automation?.key===key && ['working','submitting','error'].includes(s.automation.status)) {
    if(['working','submitting'].includes(s.automation.status) && !aiJobs.get(sender.tab.id)?.busy && Date.now()-s.automation.at>5000) {
      s.running=false;s.mode='attention';s.reason='自动答题流程已中断；点击开始重试';await save();
    }
    return {automation:s.automation};
  }
  if (aiJobs.get(sender.tab.id)?.busy) return {automation:s.automation};
  const record={key,page:s.page,generation:s.generation,fingerprint:report.quiz.fingerprint,status:'working',at:Date.now(),message:'正在自动生成整页答案（含简答题）'};
  s.automation=record;
  await save();
  try {
    if(report.quiz.unsupported) throw new Error('存在未识别题型，已停止自动提交');
    let job=aiJobs.get(sender.tab.id);
    if(!job?.result || job.generation!==s.generation || job.result.page!==report.page || job.result.fingerprint!==report.quiz.fingerprint) {
      const solved=await solveQuiz(s,sender);
      if(solved.error) throw new Error(solved.error);
      job=aiJobs.get(sender.tab.id);
    }
    if(!s.running || !s.autoQuiz || !job?.result || job.controller.signal.aborted) throw new Error('自动流程已暂停');
    record.randomCount=job.result.answers.filter(answer=>answer.source==='random').length;
    if(record.randomCount && !s.randomFallback)throw new Error('随机兜底已关闭，请重新生成答案');
    job.busy=true;
    record.message='正在自动填入并校验全部答案'+(record.randomCount?`（含 ${record.randomCount} 道随机兜底）`:'');
    await save();
    const applied=await chrome.tabs.sendMessage(sender.tab.id,{channel:'xxt-player-v1',type:'QUIZ_APPLY',...job.result},{frameId:job.result.frameId});
    record.fillDiagnostic=Array.isArray(applied?.details)?applied.details:[];
    if(applied?.error || applied?.failed?.length || applied?.unsupported || applied?.applied!==job.result.answers.length || applied?.total!==job.result.answers.length) {
      const failed=(applied?.failed || []).map(id=>{const d=record.fillDiagnostic.find(d=>d.id===id);return `${id}：${d?.reason || '填写状态未通过校验'}`;}).join('；');
      throw new Error(applied?.error || (failed?`填写校验失败（${failed}），已停止提交`:'题数或填写数量不一致，已停止提交'));
    }
    if(!s.running || !s.autoQuiz || job.controller.signal.aborted || s.generation!==job.generation) throw new Error('自动流程已暂停或章节已变化');
    if(record.randomCount && !s.randomFallback)throw new Error('随机兜底已关闭，已停止提交');
    record.status='submitting';record.message='答案已全部校验，正在提交章节练习';
    await save();
    const submitted=await chrome.tabs.sendMessage(sender.tab.id,{channel:'xxt-player-v1',type:'QUIZ_SUBMIT',...job.result},{frameId:job.result.frameId});
    if(submitted?.error) throw new Error(submitted.error);
    if(submitted?.completed || submitted?.alreadySubmitted || snapshot(s).quizDone) {
      record.status='done';record.submitPhase='verified';record.message='平台已确认练习提交成功';
    } else if(submitted?.confirmed || record.submitPhase==='confirmation_clicked') {
      record.status='submitted';record.message='已点击确认提交，等待平台成功标记';
    } else {
      record.status='awaiting_confirmation';record.message='已点首次提交，正在等待并查找确认弹窗';
    }
    await save();
    return {automation:record};
  } catch(error) {
    if(s.automation!==record || s.page!==record.page || s.generation!==record.generation) return {error:'章节已切换，旧流程已取消'};
    if(pendingSubmission(record)) {
      record.message=record.submitPhase==='confirmation_clicked'?'已点击确认，等待平台结果；不会重复提交':'首次提交已点击，继续查找确认弹窗';await save();return {automation:record};
    }
    record.status='error';record.message=error.message || '自动答题失败';
    s.running=false;s.mode='attention';s.reason=record.message+'；处理后点击开始重试';await save();
    return {error:record.message,automation:record};
  } finally { const job=aiJobs.get(sender.tab.id);if(job?.page===record.page && job.generation===record.generation)job.busy=false; }
}
async function confirmQuiz(s,sender) {
  const record=s.automation;
  if(!s.running || !s.autoQuiz || !pendingSubmission(record)) return {automation:record};
  const snap=snapshot(s);
  if(snap.quizDone) {
    record.status='done';record.submitPhase='verified';record.message='平台已确认练习提交成功';await save();return {automation:record};
  }
  if(Date.now()-record.at>30000) {
    s.running=false;s.mode='attention';
    s.reason=record.submitPhase==='confirmation_clicked'?'确认提交已点击，但平台尚未确认成功；不会重复提交':'首次提交后未能完成确认，请检查页面弹窗；不会重复点击首次提交';
    await save();return {automation:record};
  }
  if(record.submitPhase==='confirmation_clicked' || confirmingTabs.has(sender.tab.id)) return {automation:record};
  const report=snap.reports.find(r=>r.confirmation && !r.blocked);
  if(!report) return {automation:record};
  confirmingTabs.add(sender.tab.id);
  try {
    const confirmed=await chrome.tabs.sendMessage(sender.tab.id,{channel:'xxt-player-v1',type:'QUIZ_CONFIRM',page:report.page},{frameId:report.frameId});
    if(confirmed?.confirmed) {
      record.status='submitted';record.message='已点击确认提交，等待平台成功标记';await save();
    }
    return {automation:record};
  } catch { return {automation:record}; }
  finally { confirmingTabs.delete(sender.tab.id); }
}
async function handle(msg, sender) {
  await ready;
  const optionsUrl = chrome.runtime.getURL?.("options.html");
  if (optionsUrl && sender.url === optionsUrl && ["OPTIONS_GET", "OPTIONS_SAVE"].includes(msg.type)) return optionsMessage(msg);
  if (!sender.tab || !Number.isInteger(sender.frameId)) return { allowed: false };
  const s = stateFor(sender.tab.id);
  if (msg.type === "HELLO" && sender.frameId === 0) {
    const course=XXTPolicy.courseInfo(sender.url || ''),allowed=!!course;
    const courseKey=course?.key || '';
    const courseChanged=!!s.courseKey && s.courseKey!==courseKey;
    const legacyNavigation=!s.courseKey && s.allowed && s.running && s.page!==msg.page;
    // A new top document invalidates every report, including old child frames.
    if (s.page !== msg.page || s.allowed !== allowed || s.courseKey!==courseKey) {
      s.page = msg.page;
      cancelJob(sender.tab.id);
      s.reports.clear();
      s.changedAt = Date.now();
      s.allowed = allowed;
      s.courseId=course?.courseId || '';s.courseKey=courseKey;
      if(courseChanged || legacyNavigation) {
        s.running=false;s.mode='idle';s.automation=null;s.generation++;s.context='';
        s.reason=allowed?`课程已切换为 ${s.courseId}；点击开始后运行`:'已离开课程学习页';
      }
      if (!allowed) { s.running = false; s.mode = "idle"; }
      await save();
    }
  }
  if(msg.type==='PAGE_ACTION' && msg.kind==='mouse') {
    if(!/^[a-zA-Z0-9-]{1,100}$/.test(msg.token || '')||!['on','off'].includes(msg.text))return {ok:false,error:'无效鼠标页面操作'};
    const report=s.reports.get(sender.frameId),snap=snapshot(s);
    if(msg.text==='on' && (!s.allowed||!s.running||!s.mouseGuard||!report||report.page!==msg.page||Date.now()-report.at>=5000||report.blocked||snap.quizDetected||snap.activeFrame<0||(!report.videos.length && !report.playerSurface)))return {ok:false,error:'当前页面没有启用鼠标离开拦截的播放器'};
    const execution=await chrome.scripting.executeScript({target:{tabId:sender.tab.id,frameIds:[sender.frameId]},world:'MAIN',func:XXTPageAction,args:[{kind:'mouse',token:msg.token,text:msg.text}]});
    return execution[0]?.result || {ok:false,error:'鼠标离开拦截未返回结果'};
  }
  if(msg.type==='PAGE_ACTION' && msg.kind==='foreground') {
    if(!/^[a-zA-Z0-9-]{1,100}$/.test(msg.token || '')||!['on','off'].includes(msg.text))return {ok:false,error:'无效页面操作'};
    const report=s.reports.get(sender.frameId);
    if(msg.text==='on' && (!s.allowed||!s.running||!s.foregroundCompat||!report||report.page!==msg.page||Date.now()-report.at>=5000||report.blocked||!report.videos.length||report.quiz?.detected))return {ok:false,error:'当前播放器未开启前台读取兼容'};
    const execution=await chrome.scripting.executeScript({target:{tabId:sender.tab.id,frameIds:[sender.frameId]},world:'MAIN',func:XXTPageAction,args:[{kind:'foreground',token:msg.token,text:msg.text}]});
    return execution[0]?.result || {ok:false,error:'兼容设置未返回结果'};
  }
  if (!s.allowed) return { allowed: false };
  const fromTop = sender.frameId === 0 && msg.page === s.page;
  if(msg.type==='PANEL_GET' && fromTop) {
    const data=await chrome.storage.local.get('panelUi');return {panelUi:panelSettings(data.panelUi)};
  }
  if(msg.type==='PANEL_SAVE' && fromTop) {
    await chrome.storage.local.set({panelUi:panelSettings(msg.panelUi)});return {ok:true};
  }
  if(msg.type==='AUTO_QUIZ' && fromTop) return autoQuiz(s,sender);
  if(msg.type==='CONFIRM_PENDING' && fromTop) return confirmQuiz(s,sender);
  if(msg.type==='PAGE_ACTION') {
    const job=aiJobs.get(sender.tab.id);
    const result=job?.result;
    if(!/^[a-zA-Z0-9-]{1,100}$/.test(msg.token || '')) return {ok:false,error:'页面操作已过期'};
    if(msg.kind==='confirm') {
      const report=s.reports.get(sender.frameId),record=s.automation;
      if(!s.running || !s.autoQuiz || !pendingSubmission(record) || !report?.confirmation || report.page!==msg.page || Date.now()-report.at>=5000) return {ok:false,error:'当前没有已核验的待提交确认弹窗'};
      if(record.submitPhase==='confirmation_clicked') return {ok:true,alreadyHandled:true};
      record.status='confirming';record.submitPhase='confirmation_clicked';record.at=Date.now();record.message='正在点击确认提交';await save();
      if(!s.running || !s.autoQuiz) return {ok:false,error:'自动确认已暂停'};
    } else if(!result || result.frameId!==sender.frameId || result.page!==msg.page) return {ok:false,error:'页面操作已过期'};
    if(msg.kind==='editor' && !result.answers.some(a=>a.answer.length===1 && a.answer[0]===msg.text && result.questions.find(q=>q.id===a.id)?.type==='short')) return {ok:false,error:'简答题内容不匹配'};
    if(msg.kind==='submit') {
      if(!s.running || !s.autoQuiz || s.automation?.status!=='submitting' || job.controller.signal.aborted) return {ok:false,error:'自动提交已暂停'};
      s.automation.status='awaiting_confirmation';s.automation.submitPhase='initial_clicked';s.automation.at=Date.now();s.automation.message='已点首次提交，正在查找确认弹窗';await save();
      if(!s.running || !s.autoQuiz) return {ok:false,error:'自动提交已暂停'};
    } else if(!['editor','confirm'].includes(msg.kind)) return {ok:false,error:'未知页面操作'};
    const execution=await chrome.scripting.executeScript({target:{tabId:sender.tab.id,frameIds:[sender.frameId]},world:'MAIN',func:XXTPageAction,args:[{kind:msg.kind,token:msg.token,text:msg.text || ''}]});
    if(msg.kind==='confirm' && execution[0]?.result?.ok) {
      s.automation.status='submitted';s.automation.message='已点击确认提交，等待平台成功标记';await save();
    }
    return execution[0]?.result || {ok:false,error:'页面操作未返回结果'};
  }
  if (msg.type === "OPEN_SETTINGS" && fromTop) { await chrome.runtime.openOptionsPage(); return { ok: true }; }
  if (msg.type === "AI_SOLVE" && fromTop) return solveQuiz(s, sender);
  if (msg.type === "AI_APPLY" && fromTop) {
    const job = aiJobs.get(sender.tab.id);
    if (!job?.result || job.page !== s.page || job.generation !== s.generation) return { error: "没有可填入的当前题目答案，请先生成" };
    if(!s.randomFallback && job.result.answers.some(answer=>answer.source==='random'))return {error:'随机兜底已关闭，请重新生成答案'};
    return chrome.tabs.sendMessage(sender.tab.id, { channel: "xxt-player-v1", type: "QUIZ_APPLY", ...job.result }, { frameId: job.result.frameId });
  }
  if (msg.type === "CONTEXT" && fromTop && s.context !== msg.context) {
    s.context = String(msg.context || "").slice(0, 80);
    s.generation++;
    s.reports.clear();
    s.changedAt = Date.now();
    cancelJob(sender.tab.id);
    await save();
  }
  if (msg.type === "REPORT") {
    if (sender.frameId === 0 && msg.page !== s.page) return { allowed: false };
    if (msg.generation !== undefined && msg.generation !== s.generation) return { ...snapshot(s), thisFrame: sender.frameId };
    const previous = s.reports.get(sender.frameId);
    const videos = Array.isArray(msg.videos) ? msg.videos.slice(0, 30) : [];
    if (!previous || previous.page !== msg.page || previous.videos.length !== videos.length) s.changedAt = Date.now();
    s.reports.set(sender.frameId, {
      frameId: sender.frameId, page: msg.page, at: Date.now(), videos,
      path: new URL(sender.url).pathname, blocked: String(msg.blocked || "").slice(0, 120),
      confirmation:!!msg.confirmation,
      playerSurface:!!msg.playerSurface,
      mouseApplied:!!msg.mouseApplied,
      pauseSignal:['manual','viewport-exit','window-blur','document-hidden','unknown'].includes(msg.pauseSignal)?msg.pauseSignal:'',
      lesson:{detected:!!msg.lesson?.detected,ready:!!msg.lesson?.ready,
        chars:Math.min(100000,Math.max(0,Number(msg.lesson?.chars)||0)),images:Math.min(1000,Math.max(0,Number(msg.lesson?.images)||0)),
        pendingTasks:!!msg.lesson?.pendingTasks,mediaPending:!!msg.lesson?.mediaPending,loadingImages:!!msg.lesson?.loadingImages,signature:String(msg.lesson?.signature || '').slice(0,80)},
      quiz: { detected: !!msg.quiz?.detected, count: Math.min(100, Math.max(0, Number(msg.quiz?.count) || 0)), completed: !!msg.quiz?.completed },
      note: String(msg.note || "").slice(0, 120)
    });
    const lesson=s.reports.get(sender.frameId).lesson;
    const number=value=>Math.min(100,Math.max(0,Math.floor(Number(value)||0)));
    const rawTask=msg.task || {};
    const task={detected:!!rawTask.detected,total:number(rawTask.total),done:number(rawTask.done),pending:number(rawTask.pending),unknown:number(rawTask.unknown),videoTasks:number(rawTask.videoTasks),
      evidence:(Array.isArray(rawTask.evidence)?rawTask.evidence:[]).filter(value=>['native-finished','task-label'].includes(value)).slice(0,2),signature:String(rawTask.signature || '').slice(0,80)};
    task.detected=task.detected && task.total>0;
    task.completed=task.detected && !!rawTask.completed && task.done===task.total && !task.pending && !task.unknown && task.evidence.length>0;
    s.reports.get(sender.frameId).task=task;
    const kinds=['video','audio','video-frame','audio-frame','pdf-frame','ppt-frame','book-frame','pdf-object','pdf-embed','pdf-iframe','document-frame','embedded-content'];
    lesson.mediaBlockers=(Array.isArray(msg.lesson?.mediaBlockers)?msg.lesson.mediaBlockers:[]).slice(0,20).filter(item=>kinds.includes(item?.kind)).map(item=>({kind:item.kind,tag:['video','audio','object','embed','iframe'].includes(item.tag)?item.tag:''}));
    lesson.resourceCounts=Object.fromEntries(['inspected','ignoredHidden','ignoredEmpty','ignoredImages','ignoredOutside','ignoredUnclassified','ignoredCompleted'].map(key=>[key,Math.min(1000,Math.max(0,Number(msg.lesson?.resourceCounts?.[key]) || 0))]));
    const quiz=s.reports.get(sender.frameId).quiz;
    quiz.total=Math.max(quiz.count,Number(msg.quiz?.total)||0);
    quiz.unsupported=Math.max(0,Number(msg.quiz?.unsupported)||0);
    quiz.fingerprint=String(msg.quiz?.fingerprint || '').slice(0,80);
    quiz.evidence=['answer-review','status-marker','completion-message'].includes(msg.quiz?.evidence)?msg.quiz.evidence:'';
    if(quiz.completed && pendingSubmission(s.automation) && (quiz.fingerprint===s.automation.fingerprint || !quiz.count)) {
      s.automation.status='done';s.automation.submitPhase='verified';s.automation.message='平台已确认练习提交成功';s.reason='运行中';await save();
    }
    if (msg.blocked && s.running) {
      aiJobs.get(sender.tab.id)?.controller.abort();
      s.running = false;
      s.mode = "attention";
      s.reason = String(msg.blocked).slice(0, 120) + "；处理后点击开始";
      await save();
    }
  }
  if (msg.type === "CONTROL" && sender.frameId === 0 && msg.page === s.page) {
    if (msg.action === "start") {
      const other = [...sessions.entries()].find(([id, session]) => id !== sender.tab.id && session.allowed && session.running);
      if (other) {
        s.running=false;s.mode='attention';
        s.reason='已有课程标签页正在运行；先暂停或停止该页，再在此开始';
        await save();return {...snapshot(s),thisFrame:sender.frameId};
      }
      if(s.automation && ['error','working','submitting'].includes(s.automation.status)) s.automation=null;
      if(pendingSubmission(s.automation)) {
        s.automation.at=Date.now();
        s.automation.message=s.automation.submitPhase==='confirmation_clicked'?'继续等待平台提交结果':'继续查找确认提交弹窗';
      }
      s.running = true;
      s.mode = "running";
      s.epoch += 1;
      s.reason = "运行中";
    } else if (msg.action === "pause") {
      aiJobs.get(sender.tab.id)?.controller.abort();
      s.running = false;
      s.mode = "paused";
      s.reason = "已暂停；点击开始继续";
    } else if (msg.action === "stop") {
      cancelJob(sender.tab.id);
      s.running = false;
      s.mode = "stopped";
      s.reason = "已停止";
    } else if (msg.action === "attention") {
      s.running = false;
      s.mode = "attention";
      s.reason = String(msg.reason || "需要手动处理").slice(0, 120);
    }
    for (const key of ["autoNext", "muted", "resume", "autoQuiz", "randomFallback", "foregroundCompat", "mouseGuard"]) {
      if (typeof msg[key] === "boolean") s[key] = msg[key];
    }
    if(msg.autoQuiz===false) aiJobs.get(sender.tab.id)?.controller.abort();
    if (XXTPolicy.validRate(msg.playbackRate)) s.playbackRate = msg.playbackRate;
    await save();
  }
  if (msg.type === "ATTENTION") {
    s.running = false;
    s.mode = "attention";
    s.reason = String(msg.reason || "需要手动处理").slice(0, 120);
    await save();
  }
  const result = snapshot(s);
  result.thisFrame = sender.frameId;
  return result;
}
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (!msg || msg.channel !== "xxt-player-v1") return false;
  handle(msg, sender).then(respond, () => respond({ error: "扩展请求失败，请刷新页面后重试" }));
  return true;
});
chrome.tabs.onRemoved.addListener(async tabId => {
  await ready;
  sessions.delete(tabId);
  cancelJob(tabId);
  await save();
});
chrome.action?.onClicked.addListener(() => chrome.runtime.openOptionsPage());
