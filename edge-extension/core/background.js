/* 通用网课助手 — MV3 service worker.
 * 负责：会话协调、站点/偏好配置、动态站点注册、AI 答题任务、页面交互。 */
"use strict";
importScripts("files.js", "policy.js", "text.js", "sites.js",
  "adapters/chaoxing.js", "adapters/zhihuishu.js", "adapters/icourse163.js", "adapters/xuetangx.js",
  "adapters/yuketang.js", "adapters/icve.js", "adapters/ulearning.js", "adapters/generic.js",
  "deepseek.js", "page-action.js");

const sessions = new Map();
const aiJobs = new Map();
const confirmingTabs = new Set();
const SCRIPT_PREFIX = "xxt-custom-";
const DEFAULT_SETTINGS = Object.freeze({ autoNext: true, muted: false, resume: true, playbackRate: 0, foregroundCompat: false });
const config = { defaults: { ...DEFAULT_SETTINGS }, sitePrefs: {}, customSites: [] };

const pendingSubmission = record => XXTPolicy.pendingSubmission(record);

/* ---------------- configuration ---------------- */
function siteById(id) { return XXTSites.byId(id) || XXTSites.generic(); }
function prefsFor(siteId) {
  const adapter = siteById(siteId);
  const caps = adapter?.capabilities || {};
  const saved = config.sitePrefs[siteId] || (siteId.startsWith("custom:") ? config.sitePrefs.generic : null) || {};
  return {
    enabled: saved.enabled !== false,
    autoQuiz: typeof saved.autoQuiz === "boolean" ? saved.autoQuiz : caps.quiz === "full",
    autoSubmit: !!saved.autoSubmit && caps.quiz === "assist",
    caps
  };
}
function defaultsForNewSession() {
  return {
    autoNext: config.defaults.autoNext !== false,
    muted: !!config.defaults.muted,
    resume: config.defaults.resume !== false,
    playbackRate: XXTPolicy.validRate(config.defaults.playbackRate) ? config.defaults.playbackRate : 0,
    foregroundCompat: !!config.defaults.foregroundCompat
  };
}
function normalizeHost(raw) {
  const text = String(raw || "").trim().toLowerCase();
  if (!text) return "";
  try {
    const url = new URL(/^https?:\/\//.test(text) ? text : "https://" + text);
    return url.hostname.replace(/^www\./, "");
  } catch { return ""; }
}
function validHost(host) {
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host);
}
function siteForUrl(url) {
  const resolved = XXTSites.resolve(url);
  if (resolved) {
    return { uri: resolved.adapter.id, adapter: resolved.adapter, strong: resolved.strong, name: resolved.adapter.name, caps: resolved.adapter.capabilities };
  }
  const host = XXTSites.hostOf(url);
  if (host && XXTSites.customHostAllowed(host, config.customSites)) {
    const adapter = XXTSites.generic();
    return { uri: "custom:" + host, adapter, strong: false, name: host, caps: adapter.capabilities, custom: true, customHost: host };
  }
  return null;
}
function allowedFor(url, signals) {
  const site = siteForUrl(url);
  if (!site) return null;
  const prefs = prefsFor(site.uri);
  /* 弱匹配页面（如平台首页）必须真正出现媒体或题目后才激活，避免在非课程页弹面板；
     用户主动启用的自定义站点额外接受“课程步骤页”信号。 */
  const active = site.strong || !!(signals?.hasMedia || signals?.hasQuiz || site.custom && signals?.hasSteps);
  return { ...site, prefs, allowed: active && prefs.enabled, disabled: active && !prefs.enabled };
}
function applySiteDefaults(session, site, prefs) {
  const defaults = defaultsForNewSession();
  session.autoNext = defaults.autoNext;
  session.muted = defaults.muted;
  session.resume = defaults.resume;
  session.playbackRate = defaults.playbackRate;
  session.foregroundCompat = defaults.foregroundCompat;
  session.autoQuiz = prefs.autoQuiz;
  session.autoSubmit = prefs.autoSubmit;
}
async function saveConfig() {
  await chrome.storage.local.set({ defaults: config.defaults, sitePrefs: config.sitePrefs, customSites: config.customSites });
}
async function saveSessions() {
  const saved = {};
  for (const [key, session] of sessions) {
    saved[key] = { allowed: session.allowed, running: session.running, autoNext: session.autoNext, autoQuiz: session.autoQuiz,
      autoSubmit: session.autoSubmit, muted: session.muted, resume: session.resume, playbackRate: session.playbackRate,
      foregroundCompat: session.foregroundCompat, reason: session.reason, page: session.page, epoch: session.epoch,
      mode: session.mode, context: session.context, generation: session.generation, siteId: session.siteId, siteName: session.siteName,
      capabilities: session.caps || {}, automation: session.automation };
  }
  await chrome.storage.session.set({ sessions: saved });
}
const ready = (async () => {
  const data = await chrome.storage.local.get(["defaults", "sitePrefs", "customSites", "deepseek"]);
  Object.assign(config.defaults, data.defaults || {});
  config.sitePrefs = data.sitePrefs && typeof data.sitePrefs === "object" ? data.sitePrefs : {};
  config.customSites = (Array.isArray(data.customSites) ? data.customSites : []).map(site => typeof site === "string" ? { host: normalizeHost(site) } : { host: normalizeHost(site.host) }).filter(site => validHost(site.host));
  const restored = await chrome.storage.session.get("sessions");
  let recoveredRunning = false;
  for (const [key, saved] of Object.entries(restored.sessions || {})) {
    if (saved.allowed && saved.running) {
      if (recoveredRunning) { saved.running = false; saved.mode = "attention"; saved.reason = "恢复时发现其他课程标签页正在运行；本页已暂停"; }
      else recoveredRunning = true;
    }
    if (saved.automation?.status === "submitted" && !saved.automation.submitPhase) {
      saved.automation = { ...saved.automation, status: "error", message: "旧版仅点击首次提交，需重新核验提交状态" };
    }
    sessions.set(Number(key), { ...defaultsForNewSession(), allowed: false, running: false, mode: "idle", autoQuiz: false, autoSubmit: false,
      automation: null, reason: "点击开始后启动学习助手", page: "", epoch: 0, generation: 0, context: "", siteId: "", siteName: "",
      reports: new Map(), changedAt: Date.now(), caps: {}, ...saved, playbackRate: XXTPolicy.validRate(saved.playbackRate) ? saved.playbackRate : 0 });
  }
  await syncDynamicScripts();
})();

/* ---------------- per-tab state & snapshots ---------------- */
function stateFor(tabId) {
  if (!sessions.has(tabId)) {
    sessions.set(tabId, { ...defaultsForNewSession(), allowed: false, running: false, mode: "idle", autoQuiz: false, autoSubmit: false,
      automation: null, reason: "点击开始后启动学习助手", page: "", epoch: 0, generation: 0, context: "", siteId: "", siteName: "",
      reports: new Map(), changedAt: Date.now() });
  }
  return sessions.get(tabId);
}
function snapshot(session) {
  const result = XXTPolicy.select([...session.reports.values()], Date.now());
  const quizzes = result.fresh.filter(report => report.quiz?.detected);
  const quizDone = quizzes.length > 0 && quizzes.every(report => report.quiz.completed);
  const lessons = result.fresh.filter(report => report.lesson?.detected);
  const lessonPendingTasks = result.fresh.some(report => report.lesson?.pendingTasks);
  const lessonMediaPending = result.fresh.some(report => report.lesson?.mediaPending);
  const caps = session.caps || {};
  return {
    allowed: session.allowed, running: session.running, mode: session.mode, epoch: session.epoch, generation: session.generation,
    autoNext: session.autoNext, autoQuiz: session.autoQuiz, autoSubmit: session.autoSubmit, muted: session.muted, resume: session.resume,
    playbackRate: session.playbackRate, foregroundCompat: session.foregroundCompat, reason: session.reason,
    automation: session.automation || null, siteId: session.siteId, siteName: session.siteName, capabilities: caps,
    quizDetected: quizzes.length > 0, quizDone,
    quizCount: quizzes.reduce((sum, report) => sum + report.quiz.count, 0),
    quizUnsupported: quizzes.reduce((sum, report) => sum + report.quiz.unsupported, 0),
    lessonDetected: lessons.length > 0,
    lessonReady: !!caps.lesson && lessons.length > 0 && lessons.every(report => report.lesson.ready) && !lessonPendingTasks && !lessonMediaPending && !result.blocked && result.count === 0 && !quizzes.length && Date.now() - session.changedAt >= 4000,
    lessonChars: lessons.reduce((sum, report) => sum + report.lesson.chars, 0),
    lessonImages: lessons.reduce((sum, report) => sum + report.lesson.images, 0),
    lessonPendingTasks, lessonMediaPending,
    lessonLoadingImages: lessons.some(report => report.lesson.loadingImages),
    lessonMediaReasons: [...new Set(result.fresh.flatMap(report => (report.lesson?.mediaBlockers || []).map(blocker => `${report.frameId}:${blocker.kind}`)))].slice(0, 20),
    lessonKey: lessons.map(report => `${report.frameId}:${report.page}:${report.lesson.signature}:${report.lesson.ready}`).join("|"),
    activeFrame: result.activeFrame, count: result.count, mediaDone: result.allDone,
    allDone: (result.allDone || (result.count === 0 && quizDone)) && (!quizzes.length || quizDone) && Date.now() - session.changedAt >= 4000,
    reports: result.fresh
  };
}
function cancelJob(tabId) {
  aiJobs.get(tabId)?.controller.abort();
  aiJobs.delete(tabId);
}
function canAutoSubmit(session) {
  const caps = session.caps || {};
  return caps.autoSubmit === true || caps.quiz === "assist" && !!session.autoSubmit;
}

/* ---------------- AI quiz pipeline ---------------- */
async function solveQuiz(session, sender) {
  const existing = aiJobs.get(sender.tab.id);
  if (existing?.busy) return { error: "已有答题请求正在进行，请等待" };
  const report = snapshot(session).reports.find(item => item.quiz?.detected && item.quiz.count > 0 && !item.quiz.completed);
  if (!report) return { error: "当前没有识别到可答的章节题目" };
  const job = { controller: new AbortController(), busy: true, page: session.page, generation: session.generation };
  aiJobs.set(sender.tab.id, job);
  const timeout = setTimeout(() => job.controller.abort(), 240000);
  try {
    const extracted = await chrome.tabs.sendMessage(sender.tab.id, { channel: "xxt-player-v1", type: "QUIZ_READ" }, { frameId: report.frameId });
    if (extracted?.error) throw new Error(extracted.error);
    if (extracted?.page !== report.page) throw new Error("题目页面已经变化，请重新识别");
    if (extracted.unsupported) throw new Error(`存在 ${extracted.unsupported} 道未支持的题目，已停止自动作答`);
    const progressHandler = progress => {
      job.progress = progress;
      const record = session.automation;
      if (!record || record.status !== "working" || session.generation !== job.generation) return;
      if (progress.phase === "batch") record.message = `正在请求第 ${progress.batch}/${progress.batches} 批答案`;
      if (progress.phase === "transcribing") record.message = `检测到混淆字体，正在按页面字形读取 ${progress.id}`;
      if (progress.phase === "schema") record.diagnostic = progress;
      if (progress.phase === "retry") {
        record.message = `返回题号或格式不匹配，正在自动重试 ${progress.id}（${progress.attempt}/2）`;
        record.diagnostic = progress.diagnostic;
      }
    };
    const questions = await XXTDeepSeek.prepare(extracted.questions, job.controller.signal, progressHandler);
    const answers = await XXTDeepSeek.solve(questions, job.controller.signal, progressHandler);
    if (session.page !== job.page || session.generation !== job.generation || aiJobs.get(sender.tab.id) !== job) throw new Error("章节已经切换，已丢弃旧题答案");
    job.result = { frameId: report.frameId, page: report.page, fingerprint: extracted.fingerprint, questions, answers };
    return { result: job.result };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "答题请求失败" };
  } finally {
    clearTimeout(timeout);
    job.busy = false;
  }
}
async function autoQuiz(session, sender) {
  if (!session.running || !session.autoQuiz || session.caps?.quiz === "none") return { automation: session.automation };
  const snap = snapshot(session);
  if (!snap.quizDetected || snap.quizDone || snap.reports.some(report => report.blocked)) return { automation: session.automation };
  const report = snap.reports.find(item => item.quiz?.detected && !item.quiz.completed && item.quiz.count);
  if (!report) return { automation: session.automation };
  const key = `${session.context}:${report.quiz.fingerprint}`;
  if (pendingSubmission(session.automation) && session.automation.fingerprint === report.quiz.fingerprint) return confirmQuiz(session, sender);
  if (session.automation?.key === key && ["working", "submitting", "error", "assist_filled"].includes(session.automation.status)) {
    if (["working", "submitting"].includes(session.automation.status) && !aiJobs.get(sender.tab.id)?.busy && Date.now() - session.automation.at > 5000) {
      session.running = false;
      session.mode = "attention";
      session.reason = "自动答题流程已中断；点击开始重试";
      await saveSessions();
    }
    return { automation: session.automation };
  }
  if (aiJobs.get(sender.tab.id)?.busy) return { automation: session.automation };
  const record = { key, page: session.page, generation: session.generation, fingerprint: report.quiz.fingerprint, status: "working", at: Date.now(), message: "正在自动生成整页答案（含简答题）" };
  session.automation = record;
  await saveSessions();
  try {
    if (report.quiz.unsupported) throw new Error("存在未识别题型，已停止自动作答");
    let job = aiJobs.get(sender.tab.id);
    if (!job?.result || job.generation !== session.generation || job.result.page !== report.page || job.result.fingerprint !== report.quiz.fingerprint) {
      const solved = await solveQuiz(session, sender);
      if (solved.error) throw new Error(solved.error);
      job = aiJobs.get(sender.tab.id);
    }
    if (!session.running || !session.autoQuiz || !job?.result || job.controller.signal.aborted) throw new Error("自动流程已暂停");
    job.busy = true;
    record.message = "正在自动填入并校验全部答案";
    await saveSessions();
    const applied = await chrome.tabs.sendMessage(sender.tab.id, { channel: "xxt-player-v1", type: "QUIZ_APPLY", ...job.result }, { frameId: job.result.frameId });
    record.fillDiagnostic = Array.isArray(applied?.details) ? applied.details : [];
    if (applied?.error || applied?.failed?.length || applied?.unsupported || applied?.applied !== job.result.answers.length || applied?.total !== job.result.answers.length) {
      const failed = (applied?.failed || []).map(id => {
        const detail = record.fillDiagnostic.find(item => item.id === id);
        return `${id}：${detail?.reason || "填写状态未通过校验"}`;
      }).join("；");
      throw new Error(applied?.error || (failed ? `填写校验失败（${failed}），已停止提交` : "题数或填写数量不一致，已停止提交"));
    }
    if (!session.running || !session.autoQuiz || job.controller.signal.aborted || session.generation !== job.generation) throw new Error("自动流程已暂停或章节已变化");
    if (!canAutoSubmit(session)) {
      record.status = "assist_filled";
      record.submitPhase = "manual";
      record.message = "答案已全部填入并校验，请核对后手动提交";
      await saveSessions();
      return { automation: record };
    }
    record.status = "submitting";
    record.message = "答案已全部校验，正在提交章节练习";
    await saveSessions();
    const submitted = await chrome.tabs.sendMessage(sender.tab.id, { channel: "xxt-player-v1", type: "QUIZ_SUBMIT", ...job.result }, { frameId: job.result.frameId });
    if (submitted?.error) throw new Error(submitted.error);
    if (submitted?.completed || submitted?.alreadySubmitted || snapshot(session).quizDone) {
      record.status = "done";
      record.submitPhase = "verified";
      record.message = "平台已确认练习提交成功";
    } else if (submitted?.confirmed || record.submitPhase === "confirmation_clicked") {
      record.status = "submitted";
      record.message = "已点击确认提交，等待平台成功标记";
    } else {
      record.status = "awaiting_confirmation";
      record.message = "已点首次提交，正在等待并查找确认弹窗";
    }
    await saveSessions();
    return { automation: record };
  } catch (error) {
    if (session.automation !== record || session.page !== record.page || session.generation !== record.generation) return { error: "章节已切换，旧流程已取消" };
    if (pendingSubmission(record)) {
      record.message = record.submitPhase === "confirmation_clicked" ? "已点击确认，等待平台结果；不会重复提交" : "首次提交已点击，继续查找确认弹窗";
      await saveSessions();
      return { automation: record };
    }
    record.status = "error";
    const hint = Array.isArray(record.fillDiagnostic) && record.fillDiagnostic.length
      ? "；AI 答案已显示在每道题下方，可照着手动选择，或复制诊断反馈兼容问题"
      : "";
    record.message = (error.message || "自动答题失败") + hint;
    session.running = false;
    session.mode = "attention";
    session.reason = record.message + "；处理后点击开始重试";
    await saveSessions();
    return { error: record.message, automation: record };
  } finally {
    const job = aiJobs.get(sender.tab.id);
    if (job) job.busy = false;
  }
}
async function confirmQuiz(session, sender) {
  const record = session.automation;
  if (!session.running || !session.autoQuiz || !pendingSubmission(record)) return { automation: record };
  const snap = snapshot(session);
  if (snap.quizDone) {
    record.status = "done";
    record.submitPhase = "verified";
    record.message = "平台已确认练习提交成功";
    await saveSessions();
    return { automation: record };
  }
  if (Date.now() - record.at > 30000) {
    session.running = false;
    session.mode = "attention";
    session.reason = record.submitPhase === "confirmation_clicked" ? "确认提交已点击，但平台尚未确认成功；不会重复提交" : "首次提交后未能完成确认，请检查页面弹窗；不会重复点击首次提交";
    await saveSessions();
    return { automation: record };
  }
  if (record.submitPhase === "confirmation_clicked" || confirmingTabs.has(sender.tab.id)) return { automation: record };
  const report = snap.reports.find(item => item.confirmation && !item.blocked);
  if (!report) return { automation: record };
  confirmingTabs.add(sender.tab.id);
  try {
    const confirmed = await chrome.tabs.sendMessage(sender.tab.id, { channel: "xxt-player-v1", type: "QUIZ_CONFIRM", page: report.page }, { frameId: report.frameId });
    if (confirmed?.confirmed) {
      record.status = "submitted";
      record.message = "已点击确认提交，等待平台成功标记";
      await saveSessions();
    }
    return { automation: record };
  } catch { return { automation: record }; }
  finally { confirmingTabs.delete(sender.tab.id); }
}

/* ---------------- custom sites / dynamic content scripts ---------------- */
async function registeredScripts() {
  try { return await chrome.scripting.getRegisteredContentScripts(); } catch { return []; }
}
async function registerCustomSite(host) {
  const id = SCRIPT_PREFIX + host;
  const matches = [`https://${host}/*`, `https://*.${host}/*`];
  const existing = (await registeredScripts()).find(script => script.id === id);
  if (existing) {
    try { await chrome.scripting.updateContentScripts([{ id, matches }]); } catch { /* keep existing registration */ }
    return;
  }
  await chrome.scripting.registerContentScripts([{ id, matches, js: XXT_CONTENT_FILES, allFrames: true, matchAboutBlank: true, runAt: "document_idle" }]);
}
async function unregisterCustomSite(host) {
  try { await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_PREFIX + host] }); } catch { /* not registered */ }
}
async function syncDynamicScripts() {
  const registered = new Set((await registeredScripts()).map(script => script.id));
  for (const site of config.customSites) {
    const patterns = [`https://${site.host}/*`, `https://*.${site.host}/*`];
    let granted = false;
    try { granted = await chrome.permissions.contains({ origins: patterns }); } catch { granted = false; }
    if (!granted) continue;
    if (!registered.has(SCRIPT_PREFIX + site.host)) await registerCustomSite(site.host).catch(() => {});
  }
}
async function customSiteAdd(hostRaw) {
  const host = normalizeHost(hostRaw);
  if (!validHost(host)) return { error: "域名格式不正确，例如 course.example.com" };
  if (siteForUrl("https://" + host)) return { error: "该网站已有内置适配，无需手动添加" };
  if (config.customSites.some(site => site.host === host)) return { ok: true, host, already: true };
  const patterns = [`https://${host}/*`, `https://*.${host}/*`];
  let granted = false;
  try { granted = await chrome.permissions.contains({ origins: patterns }); } catch { granted = false; }
  if (!granted) return { error: "缺少该网站的访问授权，请重试并在弹窗中允许" };
  if (!config.customSites.some(site => site.host === host)) config.customSites.push({ host, addedAt: Date.now() });
  config.sitePrefs["custom:" + host] = { ...(config.sitePrefs["custom:" + host] || {}), enabled: true };
  await Promise.all([saveConfig(), registerCustomSite(host).catch(error => ({ error: error.message }))]);
  return { ok: true, host };
}
async function customSiteRemove(hostRaw) {
  const host = normalizeHost(hostRaw);
  config.customSites = config.customSites.filter(site => site.host !== host);
  delete config.sitePrefs["custom:" + host];
  await unregisterCustomSite(host);
  try { await chrome.permissions.remove({ origins: [`https://${host}/*`, `https://*.${host}/*`] }); } catch { /* ignore */ }
  await saveConfig();
  return { ok: true };
}
async function injectTab(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: XXT_CONTENT_FILES });
    return { ok: true };
  } catch (error) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: XXT_CONTENT_FILES });
      return { ok: true, topOnly: true };
    } catch { return { error: error.message || "注入失败" }; }
  }
}

/* ---------------- extension pages (options / popup) ---------------- */
function siteCatalog() {
  return {
    adapters: XXTSites.list().map(adapter => ({ id: adapter.id, name: adapter.name, hosts: adapter.hosts, capabilities: adapter.capabilities, prefs: prefsFor(adapter.id) })),
    genericPrefs: prefsFor("generic"),
    customSites: config.customSites.map(site => ({ host: site.host, prefs: prefsFor("custom:" + site.host) })),
    defaults: { ...config.defaults },
    rates: [...XXTPolicy.PLAYBACK_RATES]
  };
}
async function aiSettingsView() {
  const current = await XXTDeepSeek.settings();
  return { hasKey: !!current.apiKey, baseUrl: current.baseUrl, model: current.model, effort: current.effort,
    suggestedModels: XXTDeepSeek.SUGGESTED_MODELS, suggestedBaseUrls: XXTDeepSeek.SUGGESTED_BASE_URLS, efforts: XXTDeepSeek.EFFORTS };
}
async function extensionMessage(msg) {
  if (msg.type === "OPTIONS_GET") return aiSettingsView();
  if (msg.type === "OPTIONS_SAVE") {
    const previous = await XXTDeepSeek.settings();
    const apiKey = typeof msg.apiKey === "string" ? msg.apiKey.trim() : "";
    if (apiKey && !/^[A-Za-z0-9._\-]{8,300}$/.test(apiKey)) return { ...(await aiSettingsView()), error: "API Key 格式不正确" };
    const baseUrl = typeof msg.baseUrl === "string" && msg.baseUrl.trim() ? msg.baseUrl.trim() : previous.baseUrl;
    try { const url = new URL(baseUrl); if (!/^https?:$/.test(url.protocol)) throw new Error(); } catch { return { ...(await aiSettingsView()), error: "接口地址必须是 http(s) URL" }; }
    const model = typeof msg.model === "string" && /^[A-Za-z0-9._:\/-]{1,120}$/.test(msg.model.trim()) ? msg.model.trim() : previous.model;
    const effort = XXTDeepSeek.EFFORTS.includes(msg.effort) ? msg.effort : previous.effort;
    await chrome.storage.local.set({ deepseek: { apiKey: msg.clear ? "" : apiKey || previous.apiKey, baseUrl, model, effort } });
    return aiSettingsView();
  }
  if (msg.type === "TEST_AI") {
    try {
      const current = await XXTDeepSeek.settings();
      if (!current.apiKey) return { error: "请先保存 API Key" };
      const result = await XXTDeepSeek.test(current);
      return { ok: true, text: result.text };
    } catch (error) { return { error: error.message || "测试失败" }; }
  }
  if (msg.type === "SITES_GET") return siteCatalog();
  if (msg.type === "SITE_PREF_SET") {
    const siteId = String(msg.siteId || "");
    if (siteId !== "generic" && !siteId.startsWith("custom:") && !XXTSites.byId(siteId)) return { error: "未知站点" };
    const prefs = { ...(config.sitePrefs[siteId] || {}) };
    if (typeof msg.enabled === "boolean") prefs.enabled = msg.enabled;
    if (typeof msg.autoQuiz === "boolean") prefs.autoQuiz = msg.autoQuiz;
    if (typeof msg.autoSubmit === "boolean") prefs.autoSubmit = msg.autoSubmit;
    config.sitePrefs[siteId] = prefs;
    await saveConfig();
    return { ok: true, siteId, prefs };
  }
  if (msg.type === "DEFAULTS_SET") {
    for (const key of ["autoNext", "muted", "resume", "foregroundCompat"]) if (typeof msg[key] === "boolean") config.defaults[key] = msg[key];
    if (XXTPolicy.validRate(msg.playbackRate)) config.defaults.playbackRate = msg.playbackRate;
    await saveConfig();
    return { ok: true, defaults: { ...config.defaults } };
  }
  if (msg.type === "CUSTOM_SITE_ADD") return customSiteAdd(msg.host);
  if (msg.type === "CUSTOM_SITE_REMOVE") return customSiteRemove(msg.host);
  if (msg.type === "INJECT_TAB") {
    const tabId = Number(msg.tabId);
    if (!Number.isInteger(tabId)) return { error: "无效标签页" };
    return injectTab(tabId);
  }
  if (msg.type === "TAB_INFO") {
    const tabId = Number(msg.tabId);
    if (!Number.isInteger(tabId)) return { error: "无效标签页" };
    let tab;
    try { tab = await chrome.tabs.get(tabId); } catch { return { error: "无法读取标签页" }; }
    const url = tab.url || "";
    const site = siteForUrl(url);
    const session = sessions.get(tabId);
    return { tabId, url, site: site ? { uri: site.uri, name: site.name, strong: site.strong, custom: !!site.custom, prefs: prefsFor(site.uri) } : null,
      session: session ? { running: session.running, allowed: session.allowed, siteId: session.siteId, siteName: session.siteName, mode: session.mode, reason: session.reason } : null,
      hasKey: !!(await XXTDeepSeek.settings()).apiKey, catalog: siteCatalog() };
  }
  return { error: "未知请求" };
}

/* ---------------- content-script message handler ---------------- */
function isExtensionPage(sender) {
  const base = chrome.runtime.getURL?.("");
  return !!base && typeof sender.url === "string" && sender.url.startsWith(base);
}
async function handle(msg, sender) {
  await ready;
  /* 选项页 / 弹窗 / 新标签页里的扩展页面都带 sender.tab，必须先按扩展页面处理。 */
  if (!sender.tab || isExtensionPage(sender)) return extensionMessage(msg);
  if (!Number.isInteger(sender.frameId)) return { allowed: false };
  const session = stateFor(sender.tab.id);
  const fromTop = sender.frameId === 0 && msg.page === session.page;

  if (msg.type === "HELLO" && sender.frameId === 0) {
    const info = allowedFor(sender.url || msg.url || "", msg.signals);
    if (!info) {
      if (session.allowed || session.page !== msg.page) {
        session.page = msg.page;
        session.allowed = false;
        session.running = false;
        session.mode = "idle";
        session.siteId = "";
        session.siteName = "";
        session.caps = {};
        session.reports.clear();
        session.changedAt = Date.now();
        await saveSessions();
      }
      return { allowed: false, resolved: false, siteId: "", siteName: "", capabilities: {} };
    }
    const firstBind = session.siteId !== info.uri;
    if (firstBind || session.page !== msg.page || session.allowed !== info.allowed) {
      session.page = msg.page;
      cancelJob(sender.tab.id);
      session.reports.clear();
      session.allowed = info.allowed;
      session.siteId = info.uri;
      session.siteName = info.name;
      session.caps = info.caps;
      if (firstBind) {
        applySiteDefaults(session, info, info.prefs);
        session.automation = null;
      }
      if (!info.allowed) { session.running = false; session.mode = "idle"; }
      session.changedAt = Date.now();
      await saveSessions();
    }
    return { ...snapshot(session), resolved: true, disabled: !!info.disabled, siteId: info.uri, siteName: info.name, capabilities: info.caps };
  }
  if (!session.allowed) return { allowed: false };
  if (msg.type === "AUTO_QUIZ" && fromTop) return autoQuiz(session, sender);
  if (msg.type === "CONFIRM_PENDING" && fromTop) return confirmQuiz(session, sender);

  if (msg.type === "PAGE_ACTION") {
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(msg.token || "")) return { ok: false, error: "页面操作已过期" };
    if (msg.kind === "foreground") {
      if (!['on', 'off'].includes(msg.text)) return { ok: false, error: "无效页面操作" };
      const report = session.reports.get(sender.frameId);
      if (msg.text === "on" && (!session.allowed || !session.running || !session.foregroundCompat || !report || report.page !== msg.page || Date.now() - report.at >= 5000 || report.blocked || !report.videos.length || report.quiz?.detected)) return { ok: false, error: "当前播放器未开启后台播放兼容" };
      const execution = await chrome.scripting.executeScript({ target: { tabId: sender.tab.id, frameIds: [sender.frameId] }, world: "MAIN", func: XXTPageAction, args: [{ kind: "foreground", token: msg.token, text: msg.text }] });
      return execution[0]?.result || { ok: false, error: "兼容设置未返回结果" };
    }
    const job = aiJobs.get(sender.tab.id);
    const result = job?.result;
    if (msg.kind === "confirm") {
      const report = session.reports.get(sender.frameId), record = session.automation;
      if (!session.running || !session.autoQuiz || !pendingSubmission(record) || !report?.confirmation || report.page !== msg.page || Date.now() - report.at >= 5000) return { ok: false, error: "当前没有已核验的待提交确认弹窗" };
      if (record.submitPhase === "confirmation_clicked") return { ok: true, alreadyHandled: true };
      record.status = "confirming";
      record.submitPhase = "confirmation_clicked";
      record.at = Date.now();
      record.message = "正在点击确认提交";
      await saveSessions();
      if (!session.running || !session.autoQuiz) return { ok: false, error: "自动确认已暂停" };
    } else if (!result || result.frameId !== sender.frameId || result.page !== msg.page) return { ok: false, error: "页面操作已过期" };
    if (msg.kind === "editor" && !result.answers.some(answer => answer.answer.length === 1 && answer.answer[0] === msg.text && result.questions.find(question => question.id === answer.id)?.type === "short")) return { ok: false, error: "简答题内容不匹配" };
    if (msg.kind === "submit") {
      if (!session.running || !session.autoQuiz || session.automation?.status !== "submitting" || job.controller.signal.aborted) return { ok: false, error: "自动提交已暂停" };
      session.automation.status = "awaiting_confirmation";
      session.automation.submitPhase = "initial_clicked";
      session.automation.at = Date.now();
      session.automation.message = "已点首次提交，正在查找确认弹窗";
      await saveSessions();
      if (!session.running || !session.autoQuiz) return { ok: false, error: "自动提交已暂停" };
    } else if (!["editor", "confirm"].includes(msg.kind)) return { ok: false, error: "未知页面操作" };
    const execution = await chrome.scripting.executeScript({ target: { tabId: sender.tab.id, frameIds: [sender.frameId] }, world: "MAIN", func: XXTPageAction, args: [{ kind: msg.kind, token: msg.token, text: msg.text || "" }] });
    if (msg.kind === "confirm" && execution[0]?.result?.ok) {
      session.automation.status = "submitted";
      session.automation.message = "已点击确认提交，等待平台成功标记";
      await saveSessions();
    }
    return execution[0]?.result || { ok: false, error: "页面操作未返回结果" };
  }
  if (msg.type === "OPEN_SETTINGS" && fromTop) { await chrome.runtime.openOptionsPage(); return { ok: true }; }
  if (msg.type === "AI_SOLVE" && fromTop) return solveQuiz(session, sender);
  if (msg.type === "AI_APPLY" && fromTop) {
    const job = aiJobs.get(sender.tab.id);
    if (!job?.result || job.page !== session.page || job.generation !== session.generation) return { error: "没有可填入的当前题目答案，请先生成" };
    return chrome.tabs.sendMessage(sender.tab.id, { channel: "xxt-player-v1", type: "QUIZ_APPLY", ...job.result }, { frameId: job.result.frameId });
  }
  if (msg.type === "CONTEXT" && fromTop && session.context !== msg.context) {
    session.context = String(msg.context || "").slice(0, 80);
    session.generation++;
    session.reports.clear();
    session.changedAt = Date.now();
    cancelJob(sender.tab.id);
    await saveSessions();
  }
  if (msg.type === "REPORT") {
    if (sender.frameId === 0 && msg.page !== session.page) return { allowed: false };
    if (msg.generation !== undefined && msg.generation !== session.generation) return { ...snapshot(session), thisFrame: sender.frameId };
    const previous = session.reports.get(sender.frameId);
    const videos = Array.isArray(msg.videos) ? msg.videos.slice(0, 30) : [];
    if (!previous || previous.page !== msg.page || previous.videos.length !== videos.length) session.changedAt = Date.now();
    session.reports.set(sender.frameId, {
      frameId: sender.frameId, page: msg.page, at: Date.now(), videos,
      path: (() => { try { return new URL(sender.url).pathname; } catch { return ""; } })(),
      blocked: String(msg.blocked || "").slice(0, 120),
      confirmation: !!msg.confirmation,
      lesson: {
        detected: !!msg.lesson?.detected, ready: !!msg.lesson?.ready,
        chars: Math.min(100000, Math.max(0, Number(msg.lesson?.chars) || 0)),
        images: Math.min(1000, Math.max(0, Number(msg.lesson?.images) || 0)),
        pendingTasks: !!msg.lesson?.pendingTasks, mediaPending: !!msg.lesson?.mediaPending,
        loadingImages: !!msg.lesson?.loadingImages, signature: String(msg.lesson?.signature || "").slice(0, 80)
      },
      quiz: { detected: !!msg.quiz?.detected, count: Math.min(100, Math.max(0, Number(msg.quiz?.count) || 0)), completed: !!msg.quiz?.completed },
      note: String(msg.note || "").slice(0, 120)
    });
    const report = session.reports.get(sender.frameId);
    const kinds = ["video", "audio", "video-frame", "audio-frame", "pdf-frame", "ppt-frame", "book-frame", "pdf-object", "pdf-embed", "pdf-iframe", "document-frame", "embedded-content"];
    report.lesson.mediaBlockers = (Array.isArray(msg.lesson?.mediaBlockers) ? msg.lesson.mediaBlockers : []).slice(0, 20)
      .filter(item => kinds.includes(item?.kind))
      .map(item => ({ kind: item.kind, tag: ["video", "audio", "object", "embed", "iframe"].includes(item.tag) ? item.tag : "" }));
    report.lesson.resourceCounts = Object.fromEntries(["inspected", "ignoredHidden", "ignoredEmpty", "ignoredImages", "ignoredOutside", "ignoredUnclassified", "ignoredCompleted"].map(key => [key, Math.min(1000, Math.max(0, Number(msg.lesson?.resourceCounts?.[key]) || 0))]));
    report.quiz.total = Math.max(report.quiz.count, Number(msg.quiz?.total) || 0);
    report.quiz.unsupported = Math.max(0, Number(msg.quiz?.unsupported) || 0);
    report.quiz.fingerprint = String(msg.quiz?.fingerprint || "").slice(0, 80);
    report.quiz.evidence = ["answer-review", "status-marker", "completion-message"].includes(msg.quiz?.evidence) ? msg.quiz.evidence : "";
    if (report.quiz.completed && pendingSubmission(session.automation) && (report.quiz.fingerprint === session.automation.fingerprint || !report.quiz.count)) {
      session.automation.status = "done";
      session.automation.submitPhase = "verified";
      session.automation.message = "平台已确认练习提交成功";
      session.reason = "运行中";
      await saveSessions();
    }
    if (msg.blocked && session.running) {
      aiJobs.get(sender.tab.id)?.controller.abort();
      session.running = false;
      session.mode = "attention";
      session.reason = String(msg.blocked).slice(0, 120) + "；处理后点击开始";
      await saveSessions();
    }
  }
  if (msg.type === "CONTROL" && sender.frameId === 0 && msg.page === session.page) {
    if (msg.action === "start") {
      const other = [...sessions.entries()].find(([id, otherSession]) => id !== sender.tab.id && otherSession.allowed && otherSession.running);
      if (other) {
        session.running = false;
        session.mode = "attention";
        session.reason = "已有课程标签页正在运行；先暂停或停止该页，再在此开始";
        await saveSessions();
        return { ...snapshot(session), thisFrame: sender.frameId };
      }
      if (session.automation && ["error", "working", "submitting"].includes(session.automation.status)) session.automation = null;
      if (pendingSubmission(session.automation)) {
        session.automation.at = Date.now();
        session.automation.message = session.automation.submitPhase === "confirmation_clicked" ? "继续等待平台提交结果" : "继续查找确认提交弹窗";
      }
      session.running = true;
      session.mode = "running";
      session.epoch += 1;
      session.reason = "运行中";
    } else if (msg.action === "pause") {
      aiJobs.get(sender.tab.id)?.controller.abort();
      session.running = false;
      session.mode = "paused";
      session.reason = "已暂停；点击开始继续";
    } else if (msg.action === "stop") {
      cancelJob(sender.tab.id);
      session.running = false;
      session.mode = "stopped";
      session.reason = "已停止";
    } else if (msg.action === "attention") {
      session.running = false;
      session.mode = "attention";
      session.reason = String(msg.reason || "需要手动处理").slice(0, 120);
    }
    for (const key of ["autoNext", "muted", "resume", "autoQuiz", "autoSubmit", "foregroundCompat"]) {
      if (typeof msg[key] === "boolean") session[key] = msg[key];
    }
    if (msg.autoQuiz === false) aiJobs.get(sender.tab.id)?.controller.abort();
    if (XXTPolicy.validRate(msg.playbackRate)) session.playbackRate = msg.playbackRate;
    /* Persist user preferences for future sessions. */
    if (session.siteId) {
      const prefs = { ...(config.sitePrefs[session.siteId] || {}) };
      if (typeof msg.autoQuiz === "boolean") prefs.autoQuiz = msg.autoQuiz;
      if (typeof msg.autoSubmit === "boolean") prefs.autoSubmit = msg.autoSubmit;
      if (typeof msg.autoQuiz === "boolean" || typeof msg.autoSubmit === "boolean") config.sitePrefs[session.siteId] = prefs;
    }
    for (const key of ["autoNext", "muted", "resume", "foregroundCompat"]) {
      if (typeof msg[key] === "boolean") config.defaults[key] = msg[key];
    }
    if (XXTPolicy.validRate(msg.playbackRate)) config.defaults.playbackRate = msg.playbackRate;
    await Promise.all([saveSessions(), saveConfig()]);
  }
  if (msg.type === "ATTENTION") {
    session.running = false;
    session.mode = "attention";
    session.reason = String(msg.reason || "需要手动处理").slice(0, 120);
    await saveSessions();
  }
  const result = snapshot(session);
  result.thisFrame = sender.frameId;
  return result;
}

/* ---------------- listeners ---------------- */
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (!msg || msg.channel !== "xxt-player-v1") return false;
  handle(msg, sender).then(respond, error => {
    console.error("[netcourse-helper]", error);
    respond({ error: "扩展请求失败，请刷新页面后重试" });
  });
  return true;
});
chrome.tabs.onRemoved.addListener(async tabId => {
  await ready;
  sessions.delete(tabId);
  cancelJob(tabId);
  await saveSessions();
});
chrome.runtime.onInstalled.addListener(() => { void syncDynamicScripts(); });
chrome.runtime.onStartup.addListener(() => { void syncDynamicScripts(); });
