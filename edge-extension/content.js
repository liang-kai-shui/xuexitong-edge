(() => {
  "use strict";
  if (globalThis.__xxtPlayerLoaded) return;
  globalThis.__xxtPlayerLoaded = true;
  const topFrame = window === window.top;
  if (topFrame && !XXTPolicy.coursePage(location.href)) return;
  const page = crypto.randomUUID();
  const tracked = new Map();
  let seq = 0, state = null, busy = false, panel, status, detail, logBox;
  let candidateSince = 0, nextAttempted = false, lastLocation = location.href;
  let lastUserInput = -Infinity, lastEpoch = -1, errorReported = false, wasRunning = false;
  let context = "", contextAt = Date.now(), pendingNav = null, lastReportShape = "";
  let aiBusy = false, quizResult = null;
  let autoPending = false, submissionInProgress = false;
  let foregroundApplied=false;
  let mouseApplied=false;
  let recentPageEvent={type:'unknown',at:-Infinity},pauseSignal='';
  let lessonSince=0,lessonKey='';
  let panelUiCleanup=null;
  const logs = [];
  const send = data => chrome.runtime.sendMessage({ channel: "xxt-player-v1", page, ...data });
  const notePageEvent=type=>{recentPageEvent={type,at:performance.now()};};
  window.addEventListener('blur',()=>notePageEvent('window-blur'),true);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')notePageEvent('document-hidden');},true);
  for(const type of ['mouseout','mouseleave','pointerout','pointerleave'])window.addEventListener(type,event=>{if(event.relatedTarget===null)notePageEvent('viewport-exit');},true);
  function log(text) {
    if (logs.at(-1)?.text === text) return;
    logs.push({ time: new Date().toLocaleTimeString(), text });
    if (logs.length > 15) logs.shift();
    if (logBox) logBox.textContent = logs.map(l => `${l.time} ${l.text}`).join("\n");
  }
  function visible(el) {
    if (!el || !el.isConnected) return false;
    const css = getComputedStyle(el);
    return css.display !== "none" && css.visibility !== "hidden" && css.opacity !== "0" && el.getClientRects().length > 0;
  }
  function blocker() {
    return XXTQuiz.blocker(submissionInProgress || state?.autoQuiz && state?.running);
  }
  async function pageAction(kind,target,text) {
    const token=crypto.randomUUID();
    target.setAttribute('data-xxt-action',token);
    try { return await send({type:'PAGE_ACTION',kind,token,text}); }
    finally { target.removeAttribute('data-xxt-action'); }
  }
  async function runAutomation() {
    if(autoPending || aiBusy) return;
    autoPending=true;
    try {
      const result=await send({type:['awaiting_confirmation','confirming','submitted'].includes(state?.automation?.status)?'CONFIRM_PENDING':'AUTO_QUIZ'});
      if(result.error) log(result.error);
      else if(result.automation?.message) log(result.automation.message);
    } catch { log('自动答题连接中断，正在等待扩展状态'); }
    finally { autoPending=false; }
  }
  function track() {
    for (const [v] of tracked) if (!v.isConnected) tracked.delete(v);
    for (const v of document.querySelectorAll("video")) {
      if (tracked.has(v)) continue;
      const info = { id: ++seq, completed: false, lastTry: 0, attempts: [], pending: false,
        src: v.currentSrc, lastTime: v.currentTime, progressed: false, seenPlaying: !v.paused && !v.ended, manual: false, owned: false, note: "等待播放" };
      tracked.set(v, info);
      v.addEventListener("timeupdate", () => {
        const now = v.currentTime;
        if (!v.paused && now > info.lastTime && now - info.lastTime < 3) info.progressed = true;
        info.lastTime = now;
      });
      v.addEventListener("ended", () => {
        if(blocker()) { info.completed=false;void tick();return; }
        if ((info.progressed || info.seenPlaying) && Number.isFinite(v.duration) && v.duration > 0 && v.currentTime >= v.duration - 1) {
          info.completed = true;
          info.note = "已正常播放结束";
          void tick();
        }
      });
      v.addEventListener("pause", () => {
        if(state?.running && !v.ended)pauseSignal=performance.now()-lastUserInput<600?'manual':performance.now()-recentPageEvent.at<1500?recentPageEvent.type:'unknown';
        if (state?.running && !v.ended && performance.now() - lastUserInput < 600) {
          info.manual = true;
          info.note = "已手动暂停；点击助手开始继续";
          void send({ type: "ATTENTION", reason: info.note });
        }
      });
      v.addEventListener("playing", () => { info.seenPlaying = true; info.note = "播放中"; });
      v.addEventListener("error", () => { info.note = "视频加载错误，请检查网络后重试"; });
    }
  }
  // Capture genuine player interactions so auto-resume respects a manual pause.
  document.addEventListener("pointerdown", e => {
    if (e.isTrusted && !e.composedPath().includes(panel)
      && e.target.closest?.("video,.video-js,.vjs-control,.ans-video-player")) lastUserInput = performance.now();
  }, true);
  document.addEventListener("keydown", e => {
    if (e.isTrusted && [" ", "k", "K", "MediaPlayPause"].includes(e.key)) lastUserInput = performance.now();
  }, true);
  async function play(v, info) {
    if (info.pending || performance.now() - info.lastTry < 2200) return;
    const now = Date.now();
    info.attempts = info.attempts.filter(t => now - t < 60000);
    if (info.attempts.length >= 6) {
      info.note = "一分钟内反复暂停，已停止重试";
      await send({ type: "ATTENTION", reason: info.note + "；检查弹题、验证或其他脚本" });
      return;
    }
    info.pending = true;
    info.lastTry = performance.now();
    info.attempts.push(now);
    try {
      await v.play();
      if(!state?.running || blocker()) {v.pause();return;}
      info.owned = true;
      info.note = "播放中";
    } catch (error) {
      if (error.name === "NotAllowedError") {
        info.note = "浏览器要求手动播放：请点击视频播放键，再点助手开始";
        await send({ type: "ATTENTION", reason: info.note });
      } else if (error.name !== "AbortError") {
        info.note = `播放失败：${error.name}`;
      }
    } finally { info.pending = false; }
  }
  function resetPage() {
    lessonSince=0;lessonKey='';
    candidateSince = 0;
    nextAttempted = false;
    lastLocation = location.href;
    pendingNav = null;
    contextAt = Date.now();
    quizResult = null;
    if (panel) { panel.shadowRoot.querySelector('#answers').textContent = ''; panel.shadowRoot.querySelector('#aiApply').disabled = true; }
  }
  async function attention(reason) {
    state = await send({ type: "CONTROL", action: "attention", reason });
    log(reason);
  }
  async function performNavigation(target, label,allowCatalogFallback=true) {
    const blocked=blocker() || state?.reports?.find(r=>r.blocked)?.blocked;
    if(blocked) {await attention(blocked);return;}
    const catalogTarget = target?.matches('#coursetree .posCatalog_name');
    if (!target || (!visible(target) && !catalogTarget) || target.disabled || target.getAttribute('aria-disabled') === 'true') {
      await attention("未找到可用的下一步或下一节按钮，请手动选择目录");
      return;
    }
    nextAttempted = true;
    pendingNav = { target, until: Date.now() + 12000, fallback: false, reports: lastReportShape,allowCatalogFallback };
    target.click();
    log(label + "；等待页面切换");
  }
  async function navigate() {
    if (!state.running || !state.autoNext || aiBusy || autoPending) { candidateSince = 0;lessonSince=0;return; }
    if (pendingNav) {
      if (Date.now() < pendingNav.until) return;
      const fallback = pendingNav.allowCatalogFallback && (!state.quizDetected || state.quizDone) && XXTNavigation.next(true);
      if (!pendingNav.fallback && fallback && fallback !== pendingNav.target) {
        pendingNav.fallback = true;
        pendingNav.until = Date.now() + 12000;
        fallback.click();
        log("步骤按钮未确认切换，改用右侧目录进入下一节");
      } else {
        pendingNav = null;
        await attention("页面未确认切换，请检查未完成任务提示，或手动点击目录");
      }
      return;
    }
    if (!state.count && !state.quizDetected && Date.now() - contextAt > 4000 && !nextAttempted) {
      const videoTab = XXTNavigation.videoStep();
      if (videoTab) { await performNavigation(videoTab, "进入顶部视频步骤"); return; }
    }
    if(state.lessonReady && !nextAttempted) {
      const practice=XXTNavigation.practiceStep();
      if(practice) {
        if(lessonKey!==state.lessonKey || !lessonSince) {lessonKey=state.lessonKey;lessonSince=Date.now();log('识别图文讲义，等待页面稳定后进入紧接的练习页签');}
        if(Date.now()-lessonSince>=5000)await performNavigation(practice,'图文讲义进入顶部练习步骤',false);
        return;
      }
    } else lessonSince=0;
    if (!state.allDone) {
      candidateSince = 0;
      return;
    }
    if (nextAttempted) return;
    if (!candidateSince) { candidateSince = Date.now(); log(state.quizDone ? "测验已提交，等待 5 秒后继续" : "视频播完，等待 5 秒后进入下一学习步骤"); }
    if (Date.now() - candidateSince < 5000) return;
    await performNavigation(XXTNavigation.next(), "进入下一步 / 下一节");
  }
  function mount() {
    panel = document.createElement("div");
    panel.id = "xxt-player-assistant";
    panel.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:2147483647;width:330px;max-width:calc(100vw - 16px)";
    const root = panel.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      :host{all:initial}section{font:13px/1.55 'Microsoft YaHei',sans-serif;background:#fff;color:#182335;border:1px solid #c6d2e1;border-radius:12px;box-shadow:0 5px 25px #0003;display:flex;flex-direction:column;max-height:min(85vh,calc(100vh - 16px));overflow:hidden;box-sizing:border-box}
      #panelHeader{display:flex;align-items:center;gap:6px;padding:10px 12px;cursor:grab;touch-action:none;user-select:none;flex-shrink:0} :host([data-dragging]) #panelHeader{cursor:grabbing}
      h3{font-size:15px;margin:0;min-width:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.shortTitle{display:none}:host([data-minimized="true"]) .fullTitle{display:none}:host([data-minimized="true"]) .shortTitle{display:inline}
      #panelBody{padding:0 15px 15px;overflow:auto;min-height:0}#panelBody[hidden]{display:none}#minimize{margin:0;padding:2px;width:28px;height:28px;flex-shrink:0;font-size:18px;line-height:1}
      p{margin:6px 0;overflow-wrap:anywhere}button{cursor:pointer;padding:7px 11px;margin:4px 4px 4px 0;border:1px solid #bccbdc;border-radius:6px;background:#eef3fa;color:#182335}#start{background:#235de4;color:#fff}label{display:block;margin:4px 0}input{vertical-align:middle}details{margin-top:8px}pre{font:11px/1.5 monospace;max-height:130px;overflow:auto;white-space:pre-wrap}.muted{color:#627086;font-size:12px}
      </style><section><header id="panelHeader" title="拖动标题栏移动助手"><h3><span class="fullTitle">学习通视频播放助手</span><span class="shortTitle">学习通助手</span> <small>v1.7.1</small></h3><button id="minimize" type="button" aria-label="最小化助手" aria-expanded="true" aria-controls="panelBody" title="最小化">−</button></header><div id="panelBody"><p id="status" role="status">正在连接扩展…</p><p id="detail" class="muted"></p>
      <div><button id="start">开始 / 继续</button><button id="pause">暂停</button><button id="stop">停止</button></div>
      <button id="next">下一步 / 下一节</button>
      <label>播放倍速 <select id="playbackRate" aria-label="播放倍速"><option value="0">跟随播放器</option><option value="1">1 倍</option><option value="1.25">1.25 倍</option><option value="1.5">1.5 倍</option><option value="1.75">1.75 倍</option><option value="2">2 倍</option></select></label>
      <label><input id="resume" type="checkbox" checked> 意外暂停后续播（包含鼠标移出）</label>
      <label><input id="mouseGuard" type="checkbox" checked> 拦截播放器鼠标离开暂停（实验）</label><p class="muted">可能影响控制栏自动隐藏；关闭此项即可恢复。</p>
      <label><input id="foregroundCompat" type="checkbox"> 前台读取兼容（实验）</label><p class="muted">仅兼容播放器的部分可见性／焦点读取；不置顶窗口，学习确认提示仍需手动处理。</p>
      <label><input id="autoNext" type="checkbox" checked> 自动进入后续步骤 / 下一节</label>
      <label><input id="autoQuiz" type="checkbox" checked> 全自动答题并提交（含简答题）</label>
      <label><input id="muted" type="checkbox"> 静音</label>
      <p class="muted">默认跟随播放器倍速。验证码、弹题和未完成提示需手动处理。</p>
      <details id="quizPanel"><summary>DeepSeek 章节答题</summary><p class="muted">全自动模式会调用 DeepSeek、填写并提交整页练习，产生 API 用量。取消勾选可改用手动生成与填写。</p><button id="settings">密钥与模型设置</button><button id="aiSolve">生成答案与解析</button><button id="aiApply" disabled>填入建议答案</button><pre id="answers" role="status"></pre></details>
      <details><summary>诊断日志</summary><pre id="logs"></pre><button id="copy">复制诊断</button></details></div></section>`;
    status = root.querySelector("#status");
    detail = root.querySelector("#detail");
    logBox = root.querySelector("#logs");
    root.querySelector('#next').onclick = async () => { await performNavigation(XXTNavigation.next(), "手动进入下一步 / 下一节"); };
    root.querySelector('#settings').onclick = async () => { await send({ type: 'OPEN_SETTINGS' }); };
    root.querySelector('#aiSolve').onclick = async () => {
      if (aiBusy) return;
      aiBusy = true;
      quizResult = null;
      root.querySelector('#aiSolve').disabled = true;
      root.querySelector('#aiApply').disabled = true;
      root.querySelector('#answers').textContent = '正在识别题目并请求 DeepSeek…';
      const originalContext = context;
      try {
        const response = await send({ type: 'AI_SOLVE' });
        if (originalContext !== context) return;
        if (response.error) throw new Error(response.error);
        quizResult = response.result;
        root.querySelector('#answers').textContent = quizResult.answers.map(a => `${a.id} 读取题干：${quizResult.questions.find(q=>q.id===a.id)?.stem || ''}\n答案：${a.answer.join('、')}\n${a.reason}`).join('\n\n');
        root.querySelector('#aiApply').disabled = false;
        log(`DeepSeek 已生成 ${quizResult.answers.length} 题建议，请核对后填入`);
      } catch (error) { root.querySelector('#answers').textContent = error.message || '生成失败，请重试'; }
      finally { aiBusy = false; root.querySelector('#aiSolve').disabled = false; }
    };
    root.querySelector('#aiApply').onclick = async () => {
      if (!quizResult) return;
      root.querySelector('#aiApply').disabled = true;
      try {
        const response = await send({ type: 'AI_APPLY' });
        if (response.error) throw new Error(response.error);
        log(`已填入并验证 ${response.applied} 题；${response.failed.length ? response.failed.join('、') + ' 需手动选择；' : ''}请核对后在原页面提交`);
        root.querySelector('#answers').textContent += `\n\n已填入 ${response.applied} 题。${response.failed.length ? '未验证通过：' + response.failed.join('、') + '。' : ''}请核对后手动提交。`;
      } catch (error) { root.querySelector('#answers').textContent += '\n' + (error.message || '填入失败'); }
    };
    for (const action of ["start", "pause", "stop"]) root.querySelector(`#${action}`).onclick = async () => {
      if(action==='start' && blocker()) {await attention(blocker());render();void tick();return;}
      state = await send({ type: "CONTROL", action });
      if (action === "start") { nextAttempted = false; candidateSince = 0; }
      log(action === "start" ? "开始真实播放" : "已暂停播放控制");
      render();
      void tick();
    };
    for (const key of ["resume", "autoNext", "muted", "autoQuiz", "foregroundCompat", "mouseGuard"]) root.querySelector(`#${key}`).onchange = async e => {
      state = await send({ type: "CONTROL", [key]: e.target.checked });
      render();
    };
    root.querySelector("#playbackRate").onchange = async e => {
      const playbackRate = Number(e.target.value);
      state = await send({ type: "CONTROL", playbackRate });
      log(playbackRate === 0 ? "倍速改为跟随播放器" : `倍速改为 ${playbackRate} 倍`);
      render();
      void tick();
    };
    root.querySelector("#copy").onclick = async () => {
      const clean = { version: "1.7.1",courseId:state?.courseId, running: state?.running, autoQuiz:state?.autoQuiz, mouseGuard:state?.mouseGuard,mouseApplied, automation:state?.automation, playbackRate: state?.playbackRate, reason: state?.reason,
        reports: state?.reports?.map(({ frameId, path, videos, quiz, lesson, mouseApplied, pauseSignal, confirmation, blocked, note }) => ({ frameId, path, videos, quiz, lesson, mouseApplied, pauseSignal, confirmation, blocked, note })), logs };
      try { await navigator.clipboard.writeText(JSON.stringify(clean, null, 2)); log("诊断已复制，不含链接参数或 Cookie"); }
      catch { log("复制失败，请手动选取日志文字"); }
    };
    document.documentElement.append(panel);
    panelUiCleanup=XXTPanelUi.attach(panel,send);
  }
  function render() {
    if (!status || !state) return;
    status.textContent = state.reason || "等待开始";
    if (state.running && state.quizDetected && !state.quizDone) status.textContent = state.autoQuiz ? state.automation?.message || '章节测验：即将自动答题并提交' : "章节测验：请生成答案，核对并提交";
    if (state.running && state.quizDone) status.textContent = '已识别平台提交结果，准备进入下一节';
    if(state.running && state.lessonDetected && !state.quizDetected && !state.count)status.textContent=state.lessonReady && XXTNavigation.practiceStep()?'已识别图文讲义，准备进入后续练习':'图文讲义：等待页面资源或任务状态';
    const videos = (state.reports || []).flatMap(r => r.videos);
    const current = videos.find(v => !v.completed);
    detail.textContent = state.quizDone ? '检测到原生完成标记或已提交的答案回顾页；不会再次生成答案或重复提交。' : state.quizDetected ? `已识别章节测验，可处理 ${state.quizCount} 道题（含简答）。${state.quizUnsupported ? `另有 ${state.quizUnsupported} 道未支持题目，不能自动提交。` : ''}${state.autoQuiz ? '全部填写并校验后自动提交。' : '填入答案后请在原页面提交。'}` : state.count ? `识别 ${state.count} 个视频；已结束 ${videos.filter(v => v.completed).length} 个。${current ? `${Math.floor(current.time)} / ${Math.floor(current.duration || 0)} 秒` : ""}` : "当前没有识别到视频或测验，等待加载；也可手动选择视频步骤。";
    if (state.quizDetected) panel.shadowRoot.querySelector('#quizPanel').open = true;
    const resourceNames={'video':'视频','audio':'音频','video-frame':'视频页面','audio-frame':'音频页面','pdf-frame':'PDF 页面','ppt-frame':'演示文稿页面','book-frame':'电子书页面','pdf-object':'PDF 文档','pdf-embed':'PDF 文档','pdf-iframe':'PDF 页面','document-frame':'文档阅读器','embedded-content':'讲义内嵌内容'};
    const resourceText=[...new Set((state.lessonMediaReasons || []).map(reason=>resourceNames[reason.split(':').pop()] || '未分类资源'))].join('、') || '未分类资源（请刷新课程页更新识别）';
    if(state.lessonDetected && !state.quizDetected && !state.count)detail.textContent=`图文讲义约 ${state.lessonChars} 字、${state.lessonImages} 张图片。${state.lessonPendingTasks?'存在未完成任务点，等待原页面完成。':state.lessonMediaPending?`检测到仍需处理的资源：${resourceText}。`:state.lessonLoadingImages?'图片尚未加载完整。':XXTNavigation.practiceStep()?'页面稳定后进入紧接的练习页签；不会将讲义标记为已完成。':'没有紧接的练习页签，请手动选择学习步骤。'}`;
    const notes = (state.reports || []).map(r => r.note).filter(Boolean);
    if (notes.length) detail.textContent += " " + [...new Set(notes)].join("；");
    for (const key of ["resume", "autoNext", "muted", "autoQuiz", "foregroundCompat", "mouseGuard"]) panel.shadowRoot.querySelector(`#${key}`).checked = state[key];
    panel.shadowRoot.querySelector("#playbackRate").value = String(state.playbackRate);
  }
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      if (topFrame && !XXTPolicy.coursePage(location.href)) {
        if(mouseApplied) {await pageAction('mouse',document.documentElement,'off');mouseApplied=false;}
        if(foregroundApplied) {await pageAction('foreground',document.documentElement,'off');foregroundApplied=false;}
        await send({ type: "HELLO" });
        for (const [v] of tracked) v.pause();
        panelUiCleanup?.();panelUiCleanup=null;panel?.remove();
        clearInterval(timer);
        return;
      }
      if (topFrame && lastLocation !== location.href) resetPage();
      if (topFrame) {
        const course=XXTPolicy.courseInfo(location.href);
        if(course && state?.courseKey!==course.key)state=await send({type:'HELLO'});
        const nextContext = XXTNavigation.signature();
        if (nextContext !== context) {
          context = nextContext;
          resetPage();
          state = await send({ type: 'CONTEXT', context });
        }
      }
      track();
      const blocked = blocker();
      if(blocked && state?.allowed) {
        // Stop locally before waiting for the coordinator. Acknowledgement
        // overlays must not be counteracted by repeated play() calls.
        for(const [v,info] of tracked) {
          if(!v.paused) v.pause();
          info.completed=false;info.note='已暂停：'+blocked;
        }
      }
      const quiz = XXTQuiz.scan();
      const lesson=XXTLesson.scan();
      const confirm=XXTQuiz.confirmation();
      const videos = [...tracked].map(([v, info]) => {
        if (v.currentSrc && info.src !== v.currentSrc) {
          info.src = v.currentSrc; info.completed = false; info.progressed = false; info.seenPlaying = !v.paused && !v.ended;
          info.lastTime = v.currentTime; info.attempts = []; nextAttempted = false;
        }
        return { id: info.id, time: Number.isFinite(v.currentTime) ? v.currentTime : 0,
          duration: Number.isFinite(v.duration) ? v.duration : 0, completed: info.completed, paused: v.paused,
          playbackRate: v.playbackRate };
      });
      const playerSurface=videos.length>0 || !!document.querySelector('iframe[src*="/ananas/modules/video/"],iframe[src*="/knowledge/cards"]');
      state = await send({ type: "REPORT", generation: state?.generation, videos, blocked,
        playerSurface,
        mouseApplied,
        pauseSignal,
        lesson,
        confirmation:!!confirm,
        quiz: { detected: quiz.detected, count: quiz.count, completed: quiz.completed, evidence:quiz.evidence, total:quiz.total, unsupported:quiz.unsupported, fingerprint:quiz.fingerprint },
        note: [...tracked.values()].map(v => v.note).join("；") });
      const wantForeground=!!(state?.allowed && state.running && state.foregroundCompat && videos.length && !state.quizDetected && !blocked);
      if(wantForeground!==foregroundApplied) {
        const result=await pageAction('foreground',document.documentElement,wantForeground?'on':'off');
        if(result.ok)foregroundApplied=wantForeground;
        else log(result.error || '前台读取兼容未生效');
      }
      const wantMouse=!!(state?.allowed && state.running && state.mouseGuard && playerSurface && state.activeFrame>=0 && !state.quizDetected && !blocked);
      if(wantMouse!==mouseApplied) {
        const result=await pageAction('mouse',document.documentElement,wantMouse?'on':'off');
        if(result.ok) {mouseApplied=wantMouse;log(wantMouse?'已启用播放器鼠标离开拦截':'已恢复播放器鼠标离开事件');}
        else log(result.error || '鼠标离开拦截未生效');
      }
      if (!state?.allowed) return;
      if (topFrame) {
        const reportShape = JSON.stringify((state.reports || []).filter(r => r.videos.length || r.quiz?.detected).map(r => [r.frameId, r.page, r.videos.map(v => v.id), r.quiz?.detected]));
        if (pendingNav && pendingNav.reports !== reportShape && (state.count || state.quizDetected)) resetPage();
        lastReportShape = reportShape;
      }
      if (lastEpoch !== state.epoch) {
        lastEpoch = state.epoch;
        for (const info of tracked.values()) { info.manual = false; info.attempts = []; }
      }
      const eligible = [...tracked].find(([, info]) => !info.completed);
      for (const [v, info] of tracked) {
        if (!state.running || blocked || state.quizDetected) {
          if (!v.paused && (blocked || wasRunning || state.mode === "paused" || state.mode === "attention")) v.pause();
          continue;
        }
        if (state.thisFrame !== state.activeFrame || eligible?.[0] !== v || info.completed) {
          if (info.owned && !v.paused) v.pause();
          continue;
        }
        v.muted = state.muted;
        if (state.playbackRate > 0 && v.playbackRate !== state.playbackRate) v.playbackRate = state.playbackRate;
        if (v.error) { info.note = "视频加载错误，请手动检查网络"; continue; }
        if (v.paused && !v.ended && !info.manual && (state.resume || info.attempts.length === 0)) await play(v, info);
      }
      wasRunning = state.running;
      if (topFrame) {
        render();
        if(state.running && state.autoQuiz && state.quizDetected && !state.quizDone && Date.now()-contextAt>2500) void runAutomation();
        await navigate();
      }
    } catch {
      if (status) status.textContent = "扩展连接已失效，请刷新课程页面";
      if (!errorReported) { log("扩展更新或重载后需要刷新课程页面"); errorReported = true; }
    } finally { busy = false; }
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.channel !== 'xxt-player-v1') return false;
    if (message.type === 'QUIZ_READ') {
      XXTQuiz.read().then(quiz=>respond({page,...quiz}),error=>respond({error:error.message}));
      return true;
    }
    if (message.type === 'QUIZ_APPLY') {
      if (message.page !== page) { respond({ error: '测验页面已变化，请重新生成' }); return false; }
      XXTQuiz.apply(message.fingerprint, message.answers, pageAction).then(respond, error => respond({ error: error.message }));
      return true;
    }
    if (message.type === 'QUIZ_SUBMIT') {
      if(message.page!==page) {respond({error:'测验页面已变化'});return false;}
      submissionInProgress=true;
      XXTQuiz.submit(message.fingerprint,message.answers,pageAction,()=>state?.running && state?.autoQuiz)
        .then(respond,error=>respond({error:error.message})).finally(()=>{submissionInProgress=false;});
      return true;
    }
    if(message.type==='QUIZ_CONFIRM') {
      if(message.page!==page){respond({error:'弹窗所在页面已变化'});return false;}
      submissionInProgress=true;
      XXTQuiz.confirmPending(pageAction,()=>state?.running && state?.autoQuiz)
        .then(respond,error=>respond({error:error.message})).finally(()=>{submissionInProgress=false;});
      return true;
    }
    return false;
  });
  const timer = setInterval(() => void tick(), 1000);
  async function init() {
    if (topFrame) {
      state = await send({ type: "HELLO" });
      if (!state?.allowed) return;
      mount();
      log(`已就绪；当前课程 ${state.courseId || XXTPolicy.courseInfo(location.href)?.courseId || '学习页面'}`);
    }
    await tick();
  }
  void init();
})();
