/* 端到端测试：把真实扩展加载进无头 Edge/Chrome，先在浏览器内用 canvas+MediaRecorder
 * 生成一段短视频，再访问本地假课程页，通过 CDP 点真实面板按钮，验证：
 * 注入 → 面板 → 开始 → 倍速 → 真实播放进度 → 播完自动下一节；
 * 并验证选项页/弹窗页可正常加载、AI 答题消息链路可用。
 * 运行：node tests/run-e2e.mjs（可用 BROWSER_PATH 指定浏览器，XXT_E2E_LOG 输出调试日志） */
import { appendFileSync, cpSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SOURCE = existsSync(join(ROOT, "edge-extension", "manifest.json")) ? join(ROOT, "edge-extension") : ROOT;
const EXT = join(HERE, ".e2e-ext");
const BROWSERS = [
  process.env.BROWSER_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/microsoft-edge", "/usr/bin/google-chrome", "/usr/bin/chromium"
].filter(Boolean);
const browser = BROWSERS.find(path => existsSync(path));
const TRACE_LOG = process.env.XXT_E2E_LOG || "";
const trace = message => {
  if (TRACE_LOG) { try { appendFileSync(TRACE_LOG, `[${new Date().toISOString()}] ${message}\n`); } catch { /* ignore */ } }
};
const logLine = message => { trace(message); if (process.env.XXT_E2E_QUIET) return; console.log(message); };
if (!browser) { console.error("未找到 Edge/Chrome，可设置 BROWSER_PATH"); process.exit(2); }
const results = [];
let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; results.push("PASS " + name); }
  catch (error) { fail++; results.push("FAIL " + name + " — " + (error.message || error)); }
};
const assert = (condition, message) => { if (!condition) throw new Error(message || "断言失败"); };
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
let browserChild = null;
const hardTimeout = setTimeout(() => {
  trace("HARD TIMEOUT");
  try { if (browserChild) execFileSync("taskkill", ["/pid", String(browserChild.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* ignore */ }
  process.exit(2);
}, 180000);

const RECORD_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>record</title></head>
<body><canvas id="c" width="320" height="180"></canvas>
<script>
(async () => {
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const stream = canvas.captureStream(30);
  let recorder;
  try { recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' }); }
  catch (error) { recorder = new MediaRecorder(stream); }
  const chunks = [];
  recorder.ondataavailable = event => { if (event.data && event.data.size) chunks.push(event.data); };
  recorder.onstop = async () => {
    const blob = new Blob(chunks, { type: 'video/webm' });
    const buffer = await blob.arrayBuffer();
    await fetch('/save', { method: 'POST', body: buffer });
    window.__recorded = buffer.byteLength;
  };
  recorder.start();
  const start = performance.now();
  (function draw() {
    ctx.fillStyle = 'hsl(' + ((performance.now() / 8) % 360) + ',85%,50%)';
    ctx.fillRect(0, 0, 320, 180);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText('E2E VIDEO', 90, 95);
    if (performance.now() - start < 1600) requestAnimationFrame(draw); else recorder.stop();
  })();
})();
</script></body></html>`;

const COURSE_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>E2E 测试课程</title>
<style>body{font-family:sans-serif;margin:20px}.course-nav button{padding:6px 14px}</style></head>
<body>
  <div class="course-nav"><button id="next">下一节</button><span id="chapter">第 1 节 · 测试课程</span></div>
  <video id="video" src="/course.webm" preload="auto" style="width:640px;height:360px;background:#111"></video>
<script>
  const v = document.getElementById('video');
  v.addEventListener('loadedmetadata', () => { if (v.duration === Infinity) v.currentTime = 1e101; });
  v.addEventListener('durationchange', () => { if (Number.isFinite(v.duration) && v.currentTime > 100) v.currentTime = 0; });
  document.getElementById('next').onclick = () => { window.__nextClicked = true; document.getElementById('chapter').textContent = '第 2 节 · 测试课程'; };
  window.__probe = () => {
    const panel = document.querySelector('#xxt-player-assistant');
    const shadow = panel?.shadowRoot;
    return {
      panel: !!panel, site: shadow?.querySelector('#site')?.textContent || '',
      status: shadow?.querySelector('#status')?.textContent || '', detail: shadow?.querySelector('#detail')?.textContent || '',
      autoQuiz: !!shadow?.querySelector('#autoQuiz')?.checked, autoQuizVisible: !shadow?.querySelector('#autoQuizRow')?.classList.contains('hidden'),
      rate: v.playbackRate, paused: v.paused, time: v.currentTime, duration: v.duration, ended: v.ended,
      readyState: v.readyState, nextClicked: !!window.__nextClicked
    };
  };
</script>
</body></html>`;

const QUIZ_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>E2E 章节测验</title>
<style>body{font-family:sans-serif;margin:20px}.question{margin:16px 0;padding:10px;border:1px solid #ddd}</style></head>
<body>
  <h2>章节测验</h2>
  <div class="question">
    <div class="stem">1. 下列哪些属于水果（ ）（多选）</div>
    <div class="options">
      <label><input type="checkbox" name="q1" value="A"> A. 苹果</label>
      <label><input type="checkbox" name="q1" value="B"> B. 萝卜</label>
      <label><input type="checkbox" name="q1" value="C"> C. 香蕉</label>
    </div>
  </div>
  <button id="submitQuiz">提交答案</button>
<script>
  window.__probe = () => {
    const panel = document.querySelector('#xxt-player-assistant');
    const shadow = panel?.shadowRoot;
    return {
      panel: !!panel, site: shadow?.querySelector('#site')?.textContent || '',
      status: shadow?.querySelector('#status')?.textContent || '', detail: shadow?.querySelector('#detail')?.textContent || '',
      autoQuiz: !!shadow?.querySelector('#autoQuiz')?.checked,
      answers: shadow?.querySelector('#answers')?.textContent || '',
      quizPanelOpen: !!shadow?.querySelector('#quizPanel')?.open
    };
  };
</script>
</body></html>`;

function buildTestExtension() {
  rmSync(EXT, { recursive: true, force: true });
  for (const entry of ["manifest.json", "core", "assets", "options.html", "options.js", "popup.html", "popup.js"]) {
    cpSync(join(SOURCE, entry), join(EXT, entry), { recursive: true });
  }
  const manifestPath = join(EXT, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.content_scripts[0].matches.push("http://127.0.0.1/*", "http://localhost/*");
  manifest.host_permissions.push("http://127.0.0.1/*", "http://localhost/*");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const backgroundPath = join(EXT, "core", "background.js");
  let background = readFileSync(backgroundPath, "utf8");
  const marker = "function siteForUrl(url) {";
  if (!background.includes(marker)) throw new Error("测试补丁锚点不存在，background.js 结构已变化");
  background = background.replace(marker, `${marker}
  /* E2E TEST BUILD ONLY: 本地假课程页作为自定义通用站点。 */
  if (/^https?:\\/\\/(127\\.0\\.0\\.1|localhost)(?::\\d+)?\\//.test(String(url))) {
    const adapter = XXTSites.generic();
    return { uri: "custom:127.0.0.1", adapter, strong: false, name: "127.0.0.1", caps: adapter.capabilities, custom: true, customHost: "127.0.0.1" };
  }`);
  /* E2E TEST BUILD ONLY: 暴露内部状态用于失败诊断。 */
  background = background.replace("async function handle(msg, sender) {", "async function handle(msg, sender) {\n  (globalThis.__xxtMsgLog ||= []).push(String(msg.type) + \" frame:\" + sender.frameId + \" tab:\" + (sender.tab?.id) + \" ext:\" + isExtensionPage(sender));");
  background += `
globalThis.__xxtBgDebug = () => ({
  msgLog: globalThis.__xxtMsgLog || [],
  jobs: [...aiJobs.entries()].map(([tab, job]) => ({ tab, busy: job.busy, page: job.page, hasResult: !!job.result, progress: job.progress?.phase })),
  sessions: [...sessions.entries()].map(([tab, s]) => ({ tab, allowed: s.allowed, running: s.running, mode: s.mode, page: s.page, siteId: s.siteId, reports: [...s.reports.keys()] }))
});`;
  writeFileSync(backgroundPath, background);
  const contentPath = join(EXT, "core", "content.js");
  let content = readFileSync(contentPath, "utf8");
  content = content.replace("  void init();", `  globalThis.__xxtContentDebug = () => ({ aiBusy, errorReported, quizResultReady: !!quizResult, logs: [...logs], page, state: state && { allowed: state.allowed, running: state.running, mode: state.mode, reason: state.reason, automation: state.automation, generation: state.generation } });\n  void init();`);
  writeFileSync(contentPath, content);
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.exceptions = [];
    this.contexts = [];
    ws.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.method === "Runtime.exceptionThrown") this.exceptions.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || "unknown");
      if (message.method === "Runtime.executionContextCreated") this.contexts.push(message.params.context);
      if (message.id && this.pending.has(message.id)) {
        const { resolve: ok, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error))); else ok(message.result);
      }
    };
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
    return new CDP(ws);
  }
  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((ok, bad) => { this.pending.set(id, { resolve: ok, reject: bad }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "页面脚本异常");
    return result.result?.value;
  }
  async evaluateInContext(expression, contextId) {
    const result = await this.send("Runtime.evaluate", { expression, contextId, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "上下文脚本异常");
    return result.result?.value;
  }
  isolatedContext() {
    return this.contexts.find(context => context.auxData?.isDefault === false) || null;
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

async function main() {
  trace("main start");
  buildTestExtension();
  let videoBytes = null;
  const server = createServer((request, response) => {
    if (request.url === "/save") {
      const chunks = [];
      request.on("data", chunk => chunks.push(chunk));
      request.on("end", () => {
        videoBytes = Buffer.concat(chunks);
        response.writeHead(200, { "Content-Type": "text/plain" });
        response.end("ok");
      });
      return;
    }
    if (request.url === "/course.webm") {
      if (!videoBytes) { response.writeHead(404); response.end("not recorded"); return; }
      response.writeHead(200, { "Content-Type": "video/webm", "Content-Length": videoBytes.length, "Accept-Ranges": "none", "Cache-Control": "no-store" });
      response.end(videoBytes);
      return;
    }
    const html = request.url === "/record.html" ? RECORD_HTML : request.url === "/quiz.html" ? QUIZ_HTML : COURSE_HTML;
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(html);
  });
  await new Promise(ok => server.listen(0, "127.0.0.1", ok));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const profile = mkdtempSync(join(tmpdir(), "xxt-e2e-"));
  const logPath = join(profile, "browser.log");
  const logFd = openSync(logPath, "a");
  const args = [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-features=Translate,MediaRouter,OptimizationHints",
    `--user-data-dir=${profile}`, `--load-extension=${EXT}`, `--disable-extensions-except=${EXT}`,
    "--autoplay-policy=no-user-gesture-required", "--remote-debugging-port=0", `${base}/record.html`
  ];
  const child = spawn(browser, args, { stdio: ["ignore", logFd, logFd], windowsHide: true });
  browserChild = child;
  trace("browser pid " + child.pid);
  child.on("error", error => trace("browser spawn error: " + error.message));
  child.on("exit", (code, signal) => trace("browser exited code=" + code + " signal=" + signal));
  let cdp = null, browserCdp = null;
  const openTarget = async url => {
    trace("openTarget " + url);
    const { targetId } = await browserCdp.send("Target.createTarget", { url });
    trace("created target " + targetId);
    let target = null;
    for (let attempt = 0; attempt < 100; attempt++) {
      const list = await (await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`)).json();
      target = list.find(item => item.type === "page" && item.id === targetId);
      if (target?.webSocketDebuggerUrl) break;
      await sleep(150);
    }
    assert(target?.webSocketDebuggerUrl, "无法打开扩展页面：" + url);
    const page = await CDP.connect(target.webSocketDebuggerUrl);
    trace("connected target " + url);
    await page.send("Runtime.enable");
    return page;
  };
  let devtoolsPort = 0;
  try {
    const devtoolsFile = join(profile, "DevToolsActivePort");
    for (let attempt = 0; attempt < 150; attempt++) {
      if (existsSync(devtoolsFile)) {
        const lines = readFileSync(devtoolsFile, "utf8").trim().split(/\r?\n/);
        devtoolsPort = Number(lines[0]);
        if (devtoolsPort) break;
      }
      await sleep(200);
    }
    trace("devtools port=" + devtoolsPort);
    assert(devtoolsPort, "浏览器未开启远程调试端口");
    let target = null;
    for (let attempt = 0; attempt < 150; attempt++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`)).json();
        target = list.find(item => item.type === "page" && item.url.includes("127.0.0.1"));
        if (target) break;
      } catch { /* DevTools endpoint not ready yet. */ }
      await sleep(200);
    }
    assert(target, "未找到页面调试目标");
    cdp = await CDP.connect(target.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");

    /* 1) 浏览器内生成真实可播放短视频 */
    let recorded = 0;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { recorded = (await cdp.evaluate("window.__recorded || 0")) || 0; } catch { recorded = 0; }
      if (recorded && videoBytes) break;
      await sleep(200);
    }
    trace("recorded=" + recorded + " serverBytes=" + (videoBytes ? videoBytes.length : 0));
    check("无头浏览器可生成测试视频", () => assert(recorded > 0 && videoBytes && videoBytes.length > 1000, "MediaRecorder 未能生成视频"));

    /* 2) 假课程页：面板 → 开始 → 倍速 → 播完自动下一节 */
    await cdp.send("Page.navigate", { url: `${base}/course.html` });
    let probe = null;
    for (let attempt = 0; attempt < 150; attempt++) {
      try { probe = await cdp.evaluate("window.__probe ? window.__probe() : null"); } catch { probe = null; }
      if (probe?.panel && probe.readyState >= 1) break;
      await sleep(200);
    }
    trace("course probe=" + JSON.stringify(probe));
    check("扩展加载并注入页面面板", () => {
      assert(probe?.panel, "面板未出现（内容脚本或 Service Worker 未工作）");
      assert(/127\.0\.0\.1|通用模式/.test(probe.site), "站点标识异常：" + probe.site);
    });
    if (!probe?.panel) throw new Error("面板未出现，后续用例跳过");

    const rateResult = await cdp.evaluate(`(() => {
      const shadow = document.querySelector('#xxt-player-assistant').shadowRoot;
      const select = shadow.querySelector('#playbackRate');
      select.value = '1.5';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return select.value;
    })()`);
    check("面板倍速控件可用", () => assert(rateResult === "1.5", "倍速选择失败"));

    await cdp.evaluate("(() => { document.querySelector('#xxt-player-assistant').shadowRoot.querySelector('#start').click(); return true; })()");
    let playing = null;
    for (let attempt = 0; attempt < 60; attempt++) {
      playing = await cdp.evaluate("window.__probe()");
      if (playing.paused === false && playing.time > 0.1 && playing.rate === 1.5) break;
      await sleep(250);
    }
    trace("playing=" + JSON.stringify(playing));
    check("开始后视频真实播放且应用倍速", () => {
      assert(playing && playing.paused === false, "视频未开始播放：" + playing?.status + " / " + playing?.detail);
      assert(playing.rate === 1.5, "倍速未生效：" + playing?.rate);
      assert(playing.time > 0.1, "播放时间未推进：" + playing?.time);
    });

    let next = null;
    for (let attempt = 0; attempt < 160; attempt++) {
      next = await cdp.evaluate("window.__probe()");
      if (next.nextClicked) break;
      await sleep(250);
    }
    trace("next=" + JSON.stringify(next));
    check("视频播完后自动点击下一节", () => assert(next?.nextClicked, "等待 40 秒仍未自动下一节；状态：" + (next?.status || "") + " / " + (next?.detail || "")));
    check("完成判定基于真实播放结束", () => {
      assert(next.ended === true, "视频未自然结束");
      assert(Number.isFinite(next.duration) && next.duration > 0, "视频时长异常：" + next.duration);
    });

    /* 3) 扩展页与服务 Worker 基础信息 */
    let targets = [];
    let worker = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      targets = await (await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`)).json();
      worker = targets.find(item => item.type === "service_worker" && /\/core\/background\.js$/.test(item.url));
      if (worker) break;
      await sleep(250);
    }
    trace("extension targets=" + JSON.stringify(targets.filter(item => item.url.startsWith("chrome-extension://")).map(item => item.type + ":" + item.url)));
    check("Service Worker 已启动", () => assert(worker, "未找到扩展 Service Worker（core/background.js）"));
    const extensionId = worker ? new URL(worker.url).hostname : "";
    trace("extensionId=" + extensionId);
    if (!worker) throw new Error("Service Worker 未找到，跳过扩展页面测试");
    let workerCdp = null;
    if (worker.webSocketDebuggerUrl) {
      try {
        workerCdp = await CDP.connect(worker.webSocketDebuggerUrl);
        await workerCdp.send("Runtime.enable");
        trace("worker cdp connected");
      } catch (error) { trace("worker cdp failed: " + error.message); }
    }
    const versionInfo = await (await fetch(`http://127.0.0.1:${devtoolsPort}/json/version`)).json();
    trace("browser ws=" + versionInfo.webSocketDebuggerUrl);
    browserCdp = await CDP.connect(versionInfo.webSocketDebuggerUrl);
    trace("browser cdp connected");

    /* 4) 选项页：SITES_GET / OPTIONS_GET / OPTIONS_SAVE 真实渲染 */
    const optionsPage = await openTarget(`chrome-extension://${extensionId}/options.html`);
    let optionsProbe = null;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        optionsProbe = await optionsPage.evaluate(`({
          title: document.title, ready: document.readyState,
          version: document.getElementById('version')?.textContent || '',
          siteRows: document.querySelectorAll('#siteList .site-row').length,
          aiStatus: document.getElementById('aiStatus')?.textContent || '',
          rateOptions: document.querySelectorAll('#dRate option').length
        })`);
      } catch { optionsProbe = null; }
      if (optionsProbe?.siteRows > 0) break;
      await sleep(200);
    }
    trace("optionsProbe=" + JSON.stringify(optionsProbe));
    check("选项页渲染平台列表与 AI 设置", () => {
      assert(optionsProbe?.title.includes("通用网课助手"), "标题异常：" + optionsProbe?.title);
      assert(optionsProbe?.siteRows >= 7, "平台列表未渲染：" + optionsProbe?.siteRows);
      assert(/已保存|尚未保存/.test(optionsProbe?.aiStatus || ""), "AI 状态异常：" + optionsProbe?.aiStatus);
      assert(optionsProbe?.rateOptions >= 6, "默认倍速选项未渲染");
    });
    const saveResult = await optionsPage.evaluate(`(async () => {
      document.getElementById('baseUrl').value = 'https://api.deepseek.com';
      document.getElementById('model').value = 'deepseek-flash';
      document.getElementById('saveAi').click();
      await new Promise(resolve => setTimeout(resolve, 800));
      return { status: document.getElementById('aiStatus').textContent, errors: window.__errors || [] };
    })()`);
    trace("options save=" + JSON.stringify(saveResult));
    check("选项页可保存 AI 设置", () => assert(/已保存/.test(saveResult?.status || ""), "保存失败：" + saveResult?.status));
    check("选项页无脚本异常", () => assert(optionsPage.exceptions.length === 0, "异常：" + optionsPage.exceptions.join("; ")));

    /* 5) 弹窗页可加载 */
    const popupPage = await openTarget(`chrome-extension://${extensionId}/popup.html`);
    let popupProbe = null;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        popupProbe = await popupPage.evaluate(`({
          title: document.title,
          version: document.getElementById('version')?.textContent || '',
          aiState: document.getElementById('aiState')?.textContent || '',
          siteName: document.getElementById('siteName')?.textContent || ''
        })`);
      } catch { popupProbe = null; }
      if (popupProbe?.version) break;
      await sleep(200);
    }
    trace("popupProbe=" + JSON.stringify(popupProbe));
    check("弹窗页正常加载", () => {
      assert(/^v\d+\.\d+\.\d+$/.test(popupProbe?.version || ""), "版本号异常：" + popupProbe?.version);
      assert(/AI (已配置|未配置|状态读取中)/.test(popupProbe?.aiState || ""), "AI 状态异常：" + popupProbe?.aiState);
    });
    check("弹窗页无脚本异常", () => assert(popupPage.exceptions.length === 0, "异常：" + popupPage.exceptions.join("; ")));

    /* 6) 测验页：面板识别题目、AI 消息链路在无密钥时给出明确错误 */
    await cdp.send("Page.navigate", { url: `${base}/quiz.html` });
    let quizProbe = null;
    for (let attempt = 0; attempt < 150; attempt++) {
      try { quizProbe = await cdp.evaluate("window.__probe ? window.__probe() : null"); } catch { quizProbe = null; }
      if (quizProbe?.panel && /测验|答题/.test(quizProbe.status || "")) break;
      await sleep(200);
    }
    trace("quiz probe initial=" + JSON.stringify(quizProbe));
    if (!/测验|答题/.test(quizProbe?.status || "")) {
      /* 上一个页面的“页面未确认切换”提示会保留，点一次开始重置自动化状态。 */
      await cdp.evaluate("(() => { const shadow = document.querySelector('#xxt-player-assistant')?.shadowRoot; shadow?.querySelector('#start')?.click(); return true; })()");
      for (let attempt = 0; attempt < 60; attempt++) {
        quizProbe = await cdp.evaluate("window.__probe()");
        if (/测验|答题/.test(quizProbe.status || "")) break;
        await sleep(250);
      }
    }
    trace("quiz probe=" + JSON.stringify(quizProbe));
    check("测验页识别题目并显示提示", () => {
      assert(quizProbe?.panel, "测验页面板未出现");
      assert(/测验|答题/.test(quizProbe?.status || ""), "状态未提示答题：" + quizProbe?.status);
      assert(quizProbe?.autoQuiz === false, "自定义站点默认不应开启自动答题");
      assert(quizProbe?.quizPanelOpen === true, "答题面板应自动展开");
    });
    await cdp.evaluate("(() => { document.querySelector('#xxt-player-assistant').shadowRoot.querySelector('#aiSolve').click(); return true; })()");
    let aiProbe = null;
    for (let attempt = 0; attempt < 60; attempt++) {
      aiProbe = await cdp.evaluate("window.__probe()");
      if (aiProbe.answers && !aiProbe.answers.includes("正在识别")) break;
      await sleep(250);
    }
    trace("ai probe=" + JSON.stringify(aiProbe));
    if (!aiProbe?.answers || aiProbe.answers.includes("正在识别")) {
      try {
        const contentContext = cdp.isolatedContext();
        const contentDebug = contentContext ? await cdp.evaluateInContext("typeof __xxtContentDebug === 'function' ? JSON.stringify(__xxtContentDebug()) : 'no-debug'", contentContext.id) : "no-context";
        trace("contentDebug=" + contentDebug);
      } catch (error) { trace("contentDebug failed: " + error.message); }
      try {
        const bgDebug = workerCdp ? await workerCdp.evaluate("typeof __xxtBgDebug === 'function' ? JSON.stringify(__xxtBgDebug()) : 'no-debug'") : "no-worker-cdp";
        trace("bgDebug=" + bgDebug);
      } catch (error) { trace("bgDebug failed: " + error.message); }
    }
    check("AI 答题消息链路可用（无密钥时明确报错）", () => {
      assert(aiProbe?.answers, "未收到答题结果/错误信息");
      assert(!aiProbe.answers.includes("正在识别"), "AI 请求超时未返回");
      assert(/API Key|密钥|设置/.test(aiProbe.answers), "错误提示不明确：" + aiProbe.answers);
    });
    check("测验页无脚本异常", () => assert(cdp.exceptions.length === 0, "异常：" + cdp.exceptions.join("; ")));
    try { workerCdp?.close(); } catch { /* ignore */ }
  } finally {
    cdp?.close();
    browserCdp?.close();
    try { execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch { try { child.kill("SIGKILL"); } catch { /* ignore */ } }
    server.close();
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(EXT, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  trace("done");
  clearTimeout(hardTimeout);
  logLine(results.join("\n"));
  logLine(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
  trace(`RESULT pass=${pass} fail=${fail}`);
  process.exitCode = fail ? 1 : 0;
}

main().catch(error => {
  trace("E2E error: " + (error && error.message));
  clearTimeout(hardTimeout);
  logLine(results.join("\n"));
  console.error("\nE2E 失败：" + (error.message || error));
  trace(`RESULT pass=${pass} fail=${fail}`);
  process.exitCode = 1;
});
