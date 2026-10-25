/* 通用网课助手 — content script.
 * 播放/倍速/续播/自动下一节尽量与站点无关；平台差异由 core/sites.js 中的
 * 适配器提供，未适配的站点走语义识别与通用模式。 */
(() => {
  "use strict";
  const VERSION = "2.0.1";
  if (globalThis.__xxtPlayerLoaded) return;
  globalThis.__xxtPlayerLoaded = true;
  const topFrame = window === window.top;
  const page = crypto.randomUUID();
  const tracked = new Map();
  let seq = 0, state = null, busy = false;
  let panel = null, root = null, statusEl = null, detailEl = null, logBox = null, siteEl = null, hintEl = null;
  let candidateSince = 0, nextAttempted = false, lastLocation = location.href;
  let lastUserInput = -Infinity, lastEpoch = -1, errorReported = false, wasRunning = false;
  let context = "", contextAt = Date.now(), pendingNav = null, lastReportShape = "";
  let aiBusy = false, quizResult = null;
  let autoPending = false, submissionInProgress = false;
  let foregroundApplied = false;
  let lessonSince = 0, lessonKey = "";
  let mounted = false, allowed = false, stopped = false, siteId = "", siteName = "", caps = {};
  let lastHelloKey = "", helloInFlight = false, deepQueryAt = 0, lastQuizSignalAt = 0;
  let timer = null;
  const logs = [];
  const CAP_LABEL = { full: "自动答题", assist: "辅助答题", none: "仅播放" };

  function send(data) { return chrome.runtime.sendMessage({ channel: "xxt-player-v1", page, ...data }); }
  function log(text) {
    if (logs.at(-1)?.text === text) return;
    logs.push({ time: new Date().toLocaleTimeString(), text });
    if (logs.length > 20) logs.shift();
    if (logBox) logBox.textContent = logs.map(item => `${item.time} ${item.text}`).join("\n");
  }
  const blocker = () => XXTQuiz.blocker(submissionInProgress || state?.autoQuiz && state?.running);
  const label = el => XXTDom.compact(el?.value || el?.textContent || el?.getAttribute?.("aria-label") || el?.getAttribute?.("title") || "");

  /* ---------------- site detection & connection ---------------- */
  function resolveLocal() {
    const result = XXTSites.resolve(location.href);
    XXTSites.use(result?.adapter || XXTSites.generic());
    return result;
  }
  function pageSignals() {
    const hasMedia = [...document.querySelectorAll("video,audio")].length > 0;
    let hasSteps = false;
    try { const { tabs, current } = XXTNavigation.steps(); hasSteps = tabs.length > 0 && current >= 0; } catch { /* ignore */ }
    let hasQuiz = false;
    /* 弱匹配页面（平台首页等）才需要探测题目；节流避免大页面反复扫描。 */
    if (!hasMedia && document.readyState === "complete" && Date.now() - lastQuizSignalAt > 2500) {
      lastQuizSignalAt = Date.now();
      try { hasQuiz = XXTQuiz.scan().detected; } catch { /* ignore */ }
    }
    return { hasMedia, hasQuiz, hasSteps };
  }
  async function connect(force = false) {
    const resolved = XXTSites.resolve(location.href);
    const strong = !!resolved?.strong;
    const signals = strong ? { hasMedia: false, hasQuiz: false, hasSteps: false } : pageSignals();
    const key = JSON.stringify([location.href, resolved?.adapter?.id || "", strong, signals]);
    if (!force && key === lastHelloKey) return state;
    lastHelloKey = key;
    if (helloInFlight) return state;
    helloInFlight = true;
    try {
      state = await send({ type: "HELLO", url: location.href, site: resolved?.adapter?.id || "", strong, signals });
    } finally { helloInFlight = false; }
    if (!state || state.error) return state;
    allowed = !!state.allowed;
    siteId = state.siteId || resolved?.adapter?.id || "generic";
    siteName = state.siteName || resolved?.adapter?.name || "通用模式";
    caps = state.capabilities || {};
    XXTSites.use(XXTSites.byId(siteId) || XXTSites.generic());
    if (state.disabled) { stopped = true; return state; }
    if (!allowed) return state;
    if (!mounted) mount();
    render();
    log(`已连接：${siteName}（${CAP_LABEL[caps.quiz] || "仅播放"}）`);
    return state;
  }

  /* ---------------- video tracking & playback ---------------- */
  function mediaElements() {
    let list = [...document.querySelectorAll("video,audio")];
    if (!list.length && Date.now() - deepQueryAt > 5000) {
      deepQueryAt = Date.now();
      list = XXTDom.queryAllDeep("video,audio");
    }
    return list;
  }
  function userTouchedPlayer(target) {
    if (!target?.closest) return false;
    return !!target.closest("video,audio,.video-js,.vjs-control,.ans-video-player,[data-vjs-player],[class*='player'],[class*='video']");
  }
  function track() {
    for (const [video] of tracked) if (!video.isConnected) tracked.delete(video);
    for (const video of mediaElements()) {
      if (tracked.has(video)) continue;
      const info = { id: ++seq, completed: false, lastTry: 0, attempts: [], pending: false,
        src: video.currentSrc, lastTime: video.currentTime, progressed: false,
        seenPlaying: !video.paused && !video.ended, manual: false, owned: false, note: "等待播放" };
      tracked.set(video, info);
      video.addEventListener("timeupdate", () => {
        const now = video.currentTime;
        if (!video.paused && now > info.lastTime && now - info.lastTime < 3) info.progressed = true;
        info.lastTime = now;
      });
      video.addEventListener("ended", () => {
        if (blocker()) { info.completed = false; void tick(); return; }
        if ((info.progressed || info.seenPlaying) && Number.isFinite(video.duration) && video.duration > 0 && video.currentTime >= video.duration - 1) {
          info.completed = true;
          info.note = "已正常播放结束";
          void tick();
        }
      });
      video.addEventListener("pause", () => {
        if (state?.running && !video.ended && performance.now() - lastUserInput < 600) {
          info.manual = true;
          info.note = "已手动暂停；点击助手开始继续";
          void send({ type: "ATTENTION", reason: info.note });
        }
      });
      video.addEventListener("playing", () => { info.seenPlaying = true; info.note = "播放中"; });
      video.addEventListener("ratechange", () => {
        if (state?.running && state.playbackRate > 0 && video.playbackRate !== state.playbackRate) {
          try { video.playbackRate = state.playbackRate; } catch { /* Player refused. */ }
        }
      });
      video.addEventListener("volumechange", () => {
        if (state?.running && state.muted && !video.muted) video.muted = true;
      });
      video.addEventListener("error", () => { info.note = "视频加载错误，请检查网络后重试"; });
    }
  }
  document.addEventListener("pointerdown", event => {
    if (event.isTrusted && !event.composedPath().includes(panel) && userTouchedPlayer(event.target)) lastUserInput = performance.now();
  }, true);
  document.addEventListener("keydown", event => {
    if (event.isTrusted && [" ", "k", "K", "MediaPlayPause"].includes(event.key)) lastUserInput = performance.now();
  }, true);
  async function play(video, info) {
    if (info.pending || performance.now() - info.lastTry < 2200) return;
    const now = Date.now();
    info.attempts = info.attempts.filter(time => now - time < 60000);
    if (info.attempts.length >= 6) {
      info.note = "一分钟内反复暂停，已停止重试";
      await send({ type: "ATTENTION", reason: info.note + "；检查弹题、验证或其他脚本" });
      return;
    }
    info.pending = true;
    info.lastTry = performance.now();
    info.attempts.push(now);
    try {
      await video.play();
      if (!state?.running || blocker()) { video.pause(); return; }
      info.owned = true;
      info.note = "播放中";
    } catch (error) {
      if (error.name === "NotAllowedError") {
        info.note = "浏览器拦截了自动播放：请先手动点一下播放键，再点助手“开始/继续”";
        await send({ type: "ATTENTION", reason: info.note });
      } else if (error.name !== "AbortError") {
        info.note = `播放失败：${error.name}`;
      }
    } finally { info.pending = false; }
  }
  function pauseAll(reason) {
    for (const [video, info] of tracked) {
      if (!video.paused) video.pause();
      info.completed = false;
      info.note = reason;
    }
  }
  function reportVideos() {
    return [...tracked].map(([video, info]) => {
      if (video.currentSrc && info.src !== video.currentSrc) {
        info.src = video.currentSrc;
        info.completed = false;
        info.progressed = false;
        info.seenPlaying = !video.paused && !video.ended;
        info.lastTime = video.currentTime;
        info.attempts = [];
        nextAttempted = false;
      }
      return { id: info.id, time: Number.isFinite(video.currentTime) ? video.currentTime : 0,
        duration: Number.isFinite(video.duration) ? video.duration : 0, completed: info.completed,
        paused: video.paused, playbackRate: video.playbackRate };
    });
  }

  /* ---------------- page actions & navigation ---------------- */
  async function pageAction(kind, target, text) {
    const token = crypto.randomUUID();
    target.setAttribute("data-xxt-action", token);
    try { return await send({ type: "PAGE_ACTION", kind, token, text }); }
    finally { target.removeAttribute("data-xxt-action"); }
  }
  function resetPage() {
    lessonSince = 0;
    lessonKey = "";
    candidateSince = 0;
    nextAttempted = false;
    lastLocation = location.href;
    pendingNav = null;
    contextAt = Date.now();
    quizResult = null;
    if (root) {
      const answers = root.querySelector("#answers");
      const applyButton = root.querySelector("#aiApply");
      if (answers) answers.textContent = "";
      if (applyButton) applyButton.disabled = true;
    }
  }
  async function attention(reason) {
    state = await send({ type: "CONTROL", action: "attention", reason });
    log(reason);
    render();
  }
  async function performNavigation(target, labelText, allowCatalogFallback = true) {
    const blocked = blocker() || state?.reports?.find(report => report.blocked)?.blocked;
    if (blocked) { await attention(blocked); return; }
    if (!target || (!XXTDom.visible(target) && !XXTNavigation.isCatalogTarget(target)) || XXTDom.isDisabled(target)) {
      await attention(XXTSites.current()?.messages?.nextHint || "未找到可用的“下一节/下一步”按钮，请手动切换");
      return;
    }
    nextAttempted = true;
    pendingNav = { target, until: Date.now() + 12000, fallback: false, allowCatalogFallback, reports: lastReportShape, context };
    target.click();
    log(labelText + "；等待页面切换");
  }
  async function navigate() {
    if (!state?.running || !state.autoNext || aiBusy || autoPending) { candidateSince = 0; lessonSince = 0; return; }
    if (pendingNav) {
      if (Date.now() < pendingNav.until) return;
      const fallback = pendingNav.allowCatalogFallback && (!state.quizDetected || state.quizDone) && XXTNavigation.next(true);
      if (!pendingNav.fallback && fallback && fallback !== pendingNav.target) {
        pendingNav.fallback = true;
        pendingNav.until = Date.now() + 12000;
        fallback.click();
        log("步骤按钮未确认切换，改用章节目录进入下一节");
      } else {
        pendingNav = null;
        await attention("页面未确认切换，请检查未完成任务提示，或手动点击目录");
      }
      return;
    }
    if (state.quizDetected && !state.quizDone) { candidateSince = 0; return; }
    if (!state.count && !state.quizDetected && Date.now() - contextAt > 4000 && !nextAttempted) {
      const videoTab = XXTNavigation.videoStep();
      if (videoTab) { await performNavigation(videoTab, "进入顶部视频步骤"); return; }
    }
    if (caps.lesson && state.lessonReady && !nextAttempted) {
      const practice = XXTNavigation.practiceStep();
      if (practice) {
        if (lessonKey !== state.lessonKey || !lessonSince) { lessonKey = state.lessonKey; lessonSince = Date.now(); log("识别图文讲义，等待页面稳定后进入紧接的练习页签"); }
        if (Date.now() - lessonSince >= 5000) await performNavigation(practice, "图文讲义进入顶部练习步骤", false);
        return;
      }
    } else lessonSince = 0;
    if (!state.allDone) { candidateSince = 0; return; }
    if (nextAttempted) return;
    if (!candidateSince) { candidateSince = Date.now(); log(state.quizDone ? "测验已提交，等待 5 秒后继续" : "本节完成，等待 5 秒后进入下一步"); }
    if (Date.now() - candidateSince < 5000) return;
    await performNavigation(XXTNavigation.next(), "进入下一步 / 下一节");
  }
  async function runAutomation() {
    if (autoPending || aiBusy) return;
    autoPending = true;
    try {
      const pending = ["awaiting_confirmation", "confirming", "submitted"].includes(state?.automation?.status);
      if (!pending && state?.automation?.status === "assist_filled") return;
      const result = await send({ type: pending ? "CONFIRM_PENDING" : "AUTO_QUIZ" });
      if (result.error) log(result.error);
      else if (result.automation?.message) log(result.automation.message);
    } catch { log("自动答题连接中断，正在等待扩展状态"); }
    finally { autoPending = false; }
  }

  /* ---------------- panel UI ---------------- */
  function mount() {
    if (panel) { mounted = true; return; }
    panel = document.createElement("div");
    panel.id = "xxt-player-assistant";
    panel.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:2147483647;max-width:92vw";
    root = panel.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      :host{all:initial}
      section{font:13px/1.55 'Microsoft YaHei',system-ui,sans-serif;background:#fff;color:#182335;border:1px solid #c6d2e1;border-radius:12px;padding:12px;box-shadow:0 5px 25px #0003;width:340px;max-height:82vh;overflow:auto}
      header{display:flex;align-items:center;gap:6px;cursor:move;user-select:none;margin:-2px 0 8px}
      h3{font-size:15px;margin:0;flex:1;white-space:nowrap}
      .badge{font-size:11px;color:#235de4;background:#eaf0ff;border-radius:999px;padding:1px 7px;white-space:nowrap}
      .mini{border:0;background:transparent;font-size:16px;line-height:1;cursor:pointer;padding:0 4px;color:#5b6b82}
      p{margin:6px 0;overflow-wrap:anywhere}button{cursor:pointer;padding:6px 10px;margin:0 4px 4px 0;border:1px solid #bccbdc;border-radius:6px;background:#eef3fa;color:#182335;font:inherit}
      button:disabled{opacity:.5;cursor:default}#start{background:#235de4;color:#fff;border-color:#235de4}
      label{display:block;margin:5px 0}input{vertical-align:middle;margin-right:4px}select{margin-left:4px}
      details{margin-top:8px;border-top:1px dashed #dbe3ee;padding-top:6px}summary{cursor:pointer}
      pre{font:11px/1.5 monospace;max-height:130px;overflow:auto;white-space:pre-wrap;margin:4px 0}
      .muted{color:#627086;font-size:12px}.row{display:flex;flex-wrap:wrap}
      .hidden{display:none!important}
      </style>
      <section>
        <header id="bar"><h3>网课助手 <small>v${VERSION}</small></h3><span id="site" class="badge">…</span><button id="collapse" class="mini" title="收起/展开">–</button></header>
        <div id="body">
          <p id="status" role="status">正在连接扩展…</p><p id="detail" class="muted"></p>
          <div class="row"><button id="start">开始 / 继续</button><button id="pause">暂停</button><button id="stop">停止</button><button id="next">下一步 / 下一节</button></div>
          <label>播放倍速 <select id="playbackRate" aria-label="播放倍速"></select></label>
          <label><input id="resume" type="checkbox" checked> 意外暂停后续播（含鼠标移出）</label>
          <label><input id="foregroundCompat" type="checkbox"> 后台播放兼容（实验）</label>
          <label><input id="autoNext" type="checkbox" checked> 自动进入后续步骤 / 下一节</label>
          <label id="autoQuizRow"><input id="autoQuiz" type="checkbox"> 自动作答（AI 生成并填写）</label>
          <label id="autoSubmitRow" class="hidden"><input id="autoSubmit" type="checkbox"> 自动提交答案（实验，需自行确认风险）</label>
          <label><input id="muted" type="checkbox"> 静音</label>
          <p class="muted" id="hint"></p>
          <details id="quizPanel"><summary>AI 章节答题</summary>
            <p class="muted">全自动模式会调用 AI、填写并提交整页练习，产生 API 用量。取消勾选可改用手动生成与填写。</p>
            <div class="row"><button id="settings">密钥与模型设置</button><button id="aiSolve">生成答案与解析</button><button id="aiApply" disabled>填入建议答案</button></div>
            <pre id="answers" role="status"></pre>
          </details>
          <details><summary>诊断日志</summary><pre id="logs"></pre><button id="copy">复制诊断</button></details>
        </div>
      </section>`;
    statusEl = root.querySelector("#status");
    detailEl = root.querySelector("#detail");
    logBox = root.querySelector("#logs");
    siteEl = root.querySelector("#site");
    hintEl = root.querySelector("#hint");
    const rates = XXTPolicy.PLAYBACK_RATES;
    root.querySelector("#playbackRate").innerHTML = rates.map(rate => `<option value="${rate}">${rate === 0 ? "跟随播放器" : rate + " 倍"}</option>`).join("");
    root.querySelector("#collapse").onclick = () => {
      const body = root.querySelector("#body");
      const collapsed = body.classList.toggle("hidden");
      root.querySelector("#collapse").textContent = collapsed ? "+" : "–";
      saveUi({ collapsed });
    };
    root.querySelector("#next").onclick = async () => { await performNavigation(XXTNavigation.next(), "手动进入下一步 / 下一节"); };
    root.querySelector("#settings").onclick = async () => { await send({ type: "OPEN_SETTINGS" }); };
    root.querySelector("#aiSolve").onclick = async () => {
      if (aiBusy) return;
      aiBusy = true;
      quizResult = null;
      const solveButton = root.querySelector("#aiSolve");
      const applyButton = root.querySelector("#aiApply");
      solveButton.disabled = true;
      applyButton.disabled = true;
      root.querySelector("#answers").textContent = "正在识别题目并请求 AI…";
      const originalContext = context;
      try {
        const response = await send({ type: "AI_SOLVE" });
        if (originalContext !== context) return;
        if (response.error) throw new Error(response.error);
        quizResult = response.result;
        root.querySelector("#answers").textContent = quizResult.answers.map(answer => {
          const stem = quizResult.questions.find(question => question.id === answer.id)?.stem || "";
          return `${answer.id} 读取题干：${stem}\n答案：${answer.answer.join("、")}\n${answer.reason}`;
        }).join("\n\n");
        applyButton.disabled = false;
        log(`AI 已生成 ${quizResult.answers.length} 题建议，请核对后填入`);
      } catch (error) { root.querySelector("#answers").textContent = error.message || "生成失败，请重试"; }
      finally { aiBusy = false; solveButton.disabled = false; }
    };
    root.querySelector("#aiApply").onclick = async () => {
      if (!quizResult) return;
      const applyButton = root.querySelector("#aiApply");
      applyButton.disabled = true;
      try {
        const response = await send({ type: "AI_APPLY" });
        if (response.error) throw new Error(response.error);
        const failed = response.failed.length ? response.failed.join("、") + " 需手动选择；" : "";
        log(`已填入并验证 ${response.applied} 题；${failed}请核对后在原页面提交`);
        root.querySelector("#answers").textContent += `\n\n已填入 ${response.applied} 题。${failed ? "未验证通过：" + failed : ""}请核对后手动提交。`;
      } catch (error) { root.querySelector("#answers").textContent += "\n" + (error.message || "填入失败"); }
    };
    for (const action of ["start", "pause", "stop"]) {
      root.querySelector(`#${action}`).onclick = async () => {
        if (action === "start" && blocker()) { await attention(blocker()); render(); void tick(); return; }
        state = await send({ type: "CONTROL", action });
        if (action === "start") { nextAttempted = false; candidateSince = 0; }
        log(action === "start" ? "开始真实播放" : action === "pause" ? "已暂停播放控制" : "已停止");
        render();
        void tick();
      };
    }
    for (const key of ["resume", "autoNext", "muted", "autoQuiz", "foregroundCompat", "autoSubmit"]) {
      root.querySelector(`#${key}`).onchange = async event => {
        state = await send({ type: "CONTROL", [key]: event.target.checked });
        render();
      };
    }
    root.querySelector("#playbackRate").onchange = async event => {
      const playbackRate = Number(event.target.value);
      state = await send({ type: "CONTROL", playbackRate });
      log(playbackRate === 0 ? "倍速改为跟随播放器" : `倍速改为 ${playbackRate} 倍`);
      render();
      void tick();
    };
    root.querySelector("#copy").onclick = async () => {
      const clean = {
        version: VERSION, site: siteName, capabilities: caps, running: state?.running, autoQuiz: state?.autoQuiz,
        autoSubmit: state?.autoSubmit, automation: state?.automation, playbackRate: state?.playbackRate, reason: state?.reason,
        reports: state?.reports?.map(({ frameId, path, videos, quiz, lesson, confirmation, blocked, note }) => ({ frameId, path, videos, quiz, lesson, confirmation, blocked, note })),
        logs
      };
      try { await navigator.clipboard.writeText(JSON.stringify(clean, null, 2)); log("诊断已复制，不含链接参数或 Cookie"); }
      catch { log("复制失败，请手动选取日志文字"); }
    };
    enableDrag();
    document.documentElement.append(panel);
    mounted = true;
    chrome.storage.local.get("ui").then(data => {
      const ui = data?.ui?.[siteId];
      if (ui?.left != null && ui?.top != null) {
        panel.style.right = "auto";
        panel.style.bottom = "auto";
        panel.style.left = Math.max(0, Math.min(ui.left, innerWidth - 80)) + "px";
        panel.style.top = Math.max(0, Math.min(ui.top, innerHeight - 60)) + "px";
      }
      if (ui?.collapsed) {
        root.querySelector("#body").classList.add("hidden");
        root.querySelector("#collapse").textContent = "+";
      }
    }).catch(() => {});
    log("面板已就绪");
  }
  function enableDrag() {
    const bar = root.querySelector("#bar");
    let drag = null;
    bar.addEventListener("pointerdown", event => {
      if (event.target.closest("button")) return;
      const rect = panel.getBoundingClientRect();
      drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
      bar.setPointerCapture(event.pointerId);
    });
    bar.addEventListener("pointermove", event => {
      if (!drag) return;
      const left = Math.max(0, Math.min(event.clientX - drag.dx, innerWidth - 100));
      const top = Math.max(0, Math.min(event.clientY - drag.dy, innerHeight - 60));
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      panel.style.left = left + "px";
      panel.style.top = top + "px";
    });
    bar.addEventListener("pointerup", () => {
      if (!drag) return;
      drag = null;
      saveUi({ left: panel.offsetLeft, top: panel.offsetTop });
    });
  }
  let uiSaveTimer = null;
  function saveUi(patch) {
    clearTimeout(uiSaveTimer);
    uiSaveTimer = setTimeout(async () => {
      try {
        const data = await chrome.storage.local.get("ui");
        const ui = data?.ui || {};
        if (!ui[siteId]) ui[siteId] = {};
        Object.assign(ui[siteId], patch);
        await chrome.storage.local.set({ ui });
      } catch { /* UI state is best-effort. */ }
    }, 300);
  }
  function teardownPanel() {
    if (foregroundApplied) { void pageAction("foreground", document.documentElement, "off"); foregroundApplied = false; }
    for (const [video] of tracked) { try { video.pause(); } catch { /* ignore */ } }
    panel?.remove();
    panel = null;
    root = null;
    mounted = false;
    statusEl = detailEl = logBox = siteEl = hintEl = null;
  }
  function render() {
    if (!mounted || !statusEl || !state) return;
    siteEl.textContent = siteName || "通用模式";
    let text = state.reason || "等待开始";
    if (state.running && state.quizDetected && !state.quizDone) text = state.autoQuiz ? state.automation?.message || "章节测验：即将自动答题" : "章节测验：可生成答案后核对提交";
    if (state.running && state.quizDone) text = "已识别平台提交结果，准备进入下一节";
    if (state.running && caps.lesson && state.lessonDetected && !state.quizDetected && !state.count) {
      text = state.lessonReady && XXTNavigation.practiceStep() ? "已识别图文讲义，准备进入后续练习" : "图文讲义：等待页面资源或任务状态";
    }
    statusEl.textContent = text;
    const videos = (state.reports || []).flatMap(report => report.videos);
    const current = videos.find(video => !video.completed);
    if (state.quizDetected) {
      detailEl.textContent = state.quizDone ? "检测到平台完成标记或已提交的答案回顾页；不会重复作答。"
        : `已识别章节测验，可处理 ${state.quizCount} 道题。${state.quizUnsupported ? `另有 ${state.quizUnsupported} 道未支持题目，不能自动提交。` : ""}${caps.quiz === "full" && state.autoQuiz ? "全部校验后自动提交。" : "填写后请在原页面提交。"}`;
    } else if (state.count) {
      detailEl.textContent = `识别 ${state.count} 个媒体；已结束 ${videos.filter(video => video.completed).length} 个。${current ? `${Math.floor(current.time)} / ${Math.floor(current.duration || 0)} 秒` : ""}`;
    } else if (state.lessonDetected) {
      detailEl.textContent = caps.lesson ? `图文讲义约 ${state.lessonChars} 字、${state.lessonImages} 张图片。` : `检测到图文/文档页面（约 ${state.lessonChars} 字）。通用模式不自动判定图文完成，请手动学习后点“下一步”。`;
    } else {
      detailEl.textContent = "当前没有识别到视频或测验，等待页面加载；也可手动点击“下一步”。";
    }
    const notes = (state.reports || []).map(report => report.note).filter(Boolean);
    if (notes.length) detailEl.textContent += " " + [...new Set(notes)].join("；");
    if (state.quizDetected) root.querySelector("#quizPanel").open = true;
    for (const key of ["resume", "autoNext", "muted", "autoQuiz", "foregroundCompat", "autoSubmit"]) {
      root.querySelector(`#${key}`).checked = !!state[key];
    }
    root.querySelector("#playbackRate").value = String(state.playbackRate || 0);
    root.querySelector("#autoQuizRow").classList.toggle("hidden", caps.quiz === "none");
    root.querySelector("#autoSubmitRow").classList.toggle("hidden", caps.quiz !== "assist");
    hintEl.textContent = caps.quiz === "full"
      ? "AI 生成、填写并校验后自动提交；验证码、弹题需手动处理。"
      : caps.quiz === "assist"
        ? "辅助答题：AI 生成并填写，默认由你核对后手动提交。"
        : "该网站仅启用播放、倍速与自动下一节。";
  }

  /* ---------------- main tick ---------------- */
  async function childTick() {
    track();
    const blocked = blocker();
    if (blocked && state?.allowed) pauseAll(blocked);
    const videos = reportVideos();
    if (!state?.allowed) {
      state = await send({ type: "REPORT", videos, blocked: "", confirmation: false,
        lesson: { detected: false, ready: false }, quiz: {} });
      return;
    }
    const quiz = XXTQuiz.scan();
    const confirm = XXTQuiz.confirmation();
    state = await send({ type: "REPORT", generation: state?.generation, videos, blocked, confirmation: !!confirm,
      lesson: XXTLesson.scan(),
      quiz: { detected: quiz.detected, count: quiz.count, completed: quiz.completed, evidence: quiz.evidence, total: quiz.total, unsupported: quiz.unsupported, fingerprint: quiz.fingerprint },
      note: [...tracked.values()].map(info => info.note).join("；") });
  }
  async function tick() {
    if (busy || stopped) return;
    busy = true;
    try {
      if (!topFrame) { await childTick(); return; }
      if (lastLocation !== location.href) {
        lastLocation = location.href;
        resetPage();
        lastHelloKey = "";
        await connect(true);
        if (!allowed) { teardownPanel(); return; }
        track();
        render();
        return;
      }
      if (!allowed) {
        await connect(false);
        if (!allowed) { teardownPanel(); return; }
        track();
        render();
        return;
      }
      const nextContext = XXTNavigation.signature();
      if (nextContext !== context) {
        context = nextContext;
        resetPage();
        state = await send({ type: "CONTEXT", context });
      }
      track();
      const blocked = blocker();
      if (blocked && state?.allowed) pauseAll("已暂停：" + blocked);
      const quiz = XXTQuiz.scan();
      const lesson = XXTLesson.scan();
      const confirm = XXTQuiz.confirmation();
      const videos = reportVideos();
      state = await send({ type: "REPORT", generation: state?.generation, videos, blocked,
        lesson, confirmation: !!confirm,
        quiz: { detected: quiz.detected, count: quiz.count, completed: quiz.completed, evidence: quiz.evidence, total: quiz.total, unsupported: quiz.unsupported, fingerprint: quiz.fingerprint },
        note: [...tracked.values()].map(info => info.note).join("；") });
      if (!state) return;
      if (!state.allowed) {
        allowed = false;
        lastHelloKey = "";
        teardownPanel();
        state = null;
        return;
      }
      const wantForeground = !!(state.running && state.foregroundCompat && videos.length && !blocked && !state.quizDetected);
      if (wantForeground !== foregroundApplied) {
        const result = await pageAction("foreground", document.documentElement, wantForeground ? "on" : "off");
        if (result.ok) foregroundApplied = wantForeground;
        else log(result.error || "后台播放兼容未生效");
      }
      const reportShape = JSON.stringify((state.reports || []).filter(report => report.videos.length || report.quiz?.detected).map(report => [report.frameId, report.page, report.videos.map(video => video.id), report.quiz?.detected]));
      if (pendingNav && pendingNav.reports !== reportShape && (state.count || state.quizDetected)) resetPage();
      lastReportShape = reportShape;
      if (lastEpoch !== state.epoch) {
        lastEpoch = state.epoch;
        for (const info of tracked.values()) { info.manual = false; info.attempts = []; }
      }
      const eligible = [...tracked].find(([, info]) => !info.completed);
      for (const [video, info] of tracked) {
        if (!state.running || blocked || state.quizDetected) {
          if (!video.paused && (blocked || wasRunning || state.mode === "paused" || state.mode === "attention")) video.pause();
          continue;
        }
        if (state.thisFrame !== state.activeFrame || eligible?.[0] !== video || info.completed) {
          if (info.owned && !video.paused) video.pause();
          continue;
        }
        video.muted = !!state.muted;
        if (state.playbackRate > 0 && video.playbackRate !== state.playbackRate) video.playbackRate = state.playbackRate;
        if (video.error) { info.note = "视频加载错误，请手动检查网络"; continue; }
        if (video.paused && !video.ended && !info.manual && (state.resume || info.attempts.length === 0)) await play(video, info);
      }
      wasRunning = state.running;
      render();
      if (state.running && state.autoQuiz && caps.quiz !== "none" && state.quizDetected && !state.quizDone && Date.now() - contextAt > 2500) void runAutomation();
      await navigate();
    } catch (error) {
      const invalidated = /Extension context invalidated|message port closed|Receiving end does not exist/i.test(error?.message || "");
      if (invalidated && !chrome?.runtime?.id) stopped = true;
      if (statusEl) statusEl.textContent = "扩展连接已失效，请刷新课程页面";
      if (!errorReported) { log("扩展更新或重载后需要刷新课程页面"); errorReported = true; }
    } finally { busy = false; }
  }
  function loop() {
    if (stopped) return;
    const delay = mounted || allowed ? 900 : 1800;
    timer = setTimeout(async () => {
      try { await tick(); } catch { /* tick reports its own state. */ }
      loop();
    }, delay);
  }

  /* ---------------- cross-context messaging ---------------- */
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.channel !== "xxt-player-v1") return false;
    if (message.type === "QUIZ_READ") {
      XXTQuiz.read().then(quiz => respond({ page, ...quiz }), error => respond({ error: error.message }));
      return true;
    }
    if (message.type === "QUIZ_APPLY") {
      if (message.page !== page) { respond({ error: "测验页面已变化，请重新生成" }); return false; }
      XXTQuiz.apply(message.fingerprint, message.answers, pageAction).then(respond, error => respond({ error: error.message }));
      return true;
    }
    if (message.type === "QUIZ_SUBMIT") {
      if (message.page !== page) { respond({ error: "测验页面已变化" }); return false; }
      submissionInProgress = true;
      XXTQuiz.submit(message.fingerprint, message.answers, pageAction, () => state?.running && state?.autoQuiz)
        .then(respond, error => respond({ error: error.message })).finally(() => { submissionInProgress = false; });
      return true;
    }
    if (message.type === "QUIZ_CONFIRM") {
      if (message.page !== page) { respond({ error: "弹窗所在页面已变化" }); return false; }
      submissionInProgress = true;
      XXTQuiz.confirmPending(pageAction, () => state?.running && state?.autoQuiz)
        .then(respond, error => respond({ error: error.message })).finally(() => { submissionInProgress = false; });
      return true;
    }
    if (message.type === "CONTENT_COMMAND" && topFrame) {
      (async () => {
        try {
          if (message.action === "start" || message.action === "pause" || message.action === "stop") {
            state = await send({ type: "CONTROL", action: message.action });
            if (message.action === "start") { nextAttempted = false; candidateSince = 0; }
            render();
            void tick();
          } else if (message.action === "toggle-panel") {
            if (mounted) {
              const collapsed = root.querySelector("#body").classList.toggle("hidden");
              root.querySelector("#collapse").textContent = collapsed ? "+" : "–";
            }
          } else if (message.action === "ping") { /* liveness probe */ }
          respond({ ok: true, mounted, siteId });
        } catch (error) { respond({ ok: false, error: error.message }); }
      })();
      return true;
    }
    return false;
  });

  async function init() {
    if (topFrame) {
      resolveLocal();
      await connect(true);
      if (allowed) { if (!mounted) mount(); render(); await tick(); }
    } else {
      resolveLocal();
      await tick();
    }
    loop();
  }
  void init();
})();
