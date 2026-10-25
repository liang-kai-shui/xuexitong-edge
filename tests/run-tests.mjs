/* 单元测试：语法检查 + manifest 一致性 + 纯逻辑（站点识别/策略/文本/AI 校验）。
 * 运行：npm test 或 node tests/run-tests.mjs（任意 Node 18+） */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/* 仓库布局：扩展位于 edge-extension/；独立解压布局：扩展就在仓库根目录。 */
const EXT = existsSync(join(ROOT, "edge-extension", "manifest.json")) ? join(ROOT, "edge-extension") : ROOT;
const PASS = "\u2713", FAIL = "\u2717";
let passed = 0, failed = 0;
const failures = [];
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const assert = (condition, message) => { if (!condition) throw new Error(message || "断言失败"); };
const equal = (actual, expected, message) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message || "值不相等"}：期望 ${e}，实际 ${a}`);
};
const readExt = relative => readFileSync(join(EXT, relative), "utf8");
const readRoot = relative => readFileSync(join(ROOT, relative), "utf8");

/* ---------------- 加载可测试模块（无 DOM） ---------------- */
const CHROME_STUB = {
  storage: { local: { get: async () => ({}), set: async () => {} }, session: { get: async () => ({}), set: async () => {} } },
  runtime: { id: "test-extension", getManifest: () => ({ version: "2.0.1" }) }
};
const sandbox = { console, URL, URLSearchParams, AbortController, AbortSignal, fetch: async () => { throw new Error("测试环境不联网"); }, setTimeout, clearTimeout, chrome: CHROME_STUB };
vm.createContext(sandbox);
const LOAD_ORDER = [
  "core/dom.js", "core/policy.js", "core/text.js", "core/question-image.js", "core/sites.js",
  "core/adapters/chaoxing.js", "core/adapters/zhihuishu.js", "core/adapters/icourse163.js", "core/adapters/xuetangx.js",
  "core/adapters/yuketang.js", "core/adapters/icve.js", "core/adapters/ulearning.js", "core/adapters/generic.js",
  "core/quiz.js", "core/lesson.js", "core/navigation.js", "core/deepseek.js", "core/page-action.js",
  "core/files.js"
];
for (const file of LOAD_ORDER) {
  try { vm.runInContext(readExt(file), sandbox, { filename: join(EXT, file) }); }
  catch (error) { throw new Error(`加载 ${file} 失败：${error.message}`); }
}
const { XXTSites, XXTPolicy, XXTText, XXTDeepSeek } = sandbox;

/* ---------------- 语法检查 ---------------- */
const JS_FILES = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".e2e-ext" || entry === ".git") continue;
    const absolute = join(dir, entry);
    if (statSync(absolute).isDirectory()) walk(absolute);
    else if (/\.(?:js|cjs|mjs)$/.test(entry)) JS_FILES.push(absolute);
  }
}
for (const dir of [EXT, join(ROOT, "tests"), join(ROOT, "scripts")].filter(existsSync)) walk(dir);
test("所有 JS 文件语法正确", () => {
  assert(JS_FILES.length >= 15, "JS 文件数量异常：" + JS_FILES.length);
  for (const file of JS_FILES) {
    try {
      if (file.endsWith(".mjs")) { execFileSync(process.execPath, ["--check", file], { stdio: "ignore" }); continue; }
      new vm.Script(readFileSync(file, "utf8"), { filename: file });
    } catch (error) { throw new Error(`${file} 语法错误：${error.message}`); }
  }
});

/* ---------------- manifest 一致性 ---------------- */
const manifest = JSON.parse(readExt("manifest.json"));
const contentJs = manifest.content_scripts?.[0]?.js || [];
test("manifest 内容脚本与 files.js 清单一致", () => {
  equal(contentJs, [...sandbox.XXT_CONTENT_FILES], "内容脚本顺序不一致");
  assert(contentJs.at(-1) === "core/content.js", "content.js 必须最后加载");
  for (const file of contentJs) assert(existsSync(join(EXT, file)), `缺少文件 ${file}`);
});
test("manifest 引用文件与图标齐全", () => {
  const referenced = [manifest.background?.service_worker, manifest.options_ui?.page, manifest.action?.default_popup, ...Object.values(manifest.icons || {})].filter(Boolean);
  for (const file of referenced) assert(existsSync(join(EXT, file)), `缺少文件 ${file}`);
  assert(manifest.manifest_version === 3, "必须为 MV3");
  assert(manifest.permissions.includes("storage") && manifest.permissions.includes("scripting"), "缺少基础权限");
  assert((manifest.optional_host_permissions || []).some(item => item.includes("*")), "缺少可选站点权限");
  assert(manifest.host_permissions.includes("https://api.deepseek.com/*"), "缺少 DeepSeek 接口权限");
});
test("扩展版本与 package.json 一致", () => {
  if (!existsSync(join(ROOT, "package.json"))) return;
  const pkg = JSON.parse(readRoot("package.json"));
  equal(manifest.version, pkg.version, "manifest 与 package.json 版本不一致");
});
test("每个内置平台都有内容脚本匹配规则", () => {
  const matches = manifest.content_scripts?.[0]?.matches || [];
  for (const adapter of XXTSites.list()) {
    for (const host of adapter.hosts) {
      const hit = matches.some(pattern => pattern.includes(`*.${host}/`) || pattern.includes(`://${host}/`));
      assert(hit, `平台 ${adapter.id} 的域名 ${host} 未出现在 content_scripts.matches`);
    }
  }
});
test("旧版硬编码课程 ID 已移除", () => {
  for (const file of contentJs) assert(!readExt(file).includes("212800861"), `${file} 仍包含旧课程 ID`);
});

/* ---------------- 站点识别 ---------------- */
test("超星课程页识别为强匹配", () => {
  const result = XXTSites.resolve("https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=123&clazzid=456");
  equal(result?.adapter.id, "chaoxing");
  assert(result.strong, "课程页应为强匹配");
  equal(XXTSites.resolve("https://mooc1.chaoxing.com/mycourse/stu?courseid=9")?.adapter.id, "chaoxing");
});
test("超星非课程页为弱匹配（需媒体/题目信号）", () => {
  const result = XXTSites.resolve("https://mooc1.chaoxing.com/");
  equal(result?.adapter.id, "chaoxing");
  assert(!result.strong, "首页应为弱匹配");
  equal(XXTSites.resolve("https://i.chaoxing.com/base")?.adapter.id, "chaoxing");
});
test("学银在线复用超星适配器", () => {
  equal(XXTSites.resolve("https://www.xueyinonline.com/detail/123")?.adapter.id, "chaoxing");
});
test("各平台域名识别", () => {
  equal(XXTSites.resolve("https://studyvideoh5.zhihuishu.com/abc")?.adapter.id, "zhihuishu");
  assert(XXTSites.resolve("https://studyvideoh5.zhihuishu.com/abc").strong, "智慧树视频页应为强匹配");
  equal(XXTSites.resolve("https://www.zhihuishu.com/")?.adapter.id, "zhihuishu");
  assert(!XXTSites.resolve("https://www.zhihuishu.com/").strong, "智慧树首页应为弱匹配");
  assert(XXTSites.resolve("https://www.icourse163.org/learn/WHU-1001?tid=1").strong, "中国大学 MOOC 学习页应为强匹配");
  assert(XXTSites.resolve("https://www.xuetangx.com/courseware/abc").strong, "学堂在线 courseware 应为强匹配");
  equal(XXTSites.resolve("https://pro.yuketang.cn/x")?.adapter.id, "yuketang");
  equal(XXTSites.resolve("https://zjy2.icve.com.cn/x")?.adapter.id, "icve");
  equal(XXTSites.resolve("https://www.ulearning.cn/x")?.adapter.id, "ulearning");
});
test("未知网站不命中内置平台", () => {
  equal(XXTSites.resolve("https://www.example.com/course/1"), null);
  equal(XXTSites.resolve("chrome://extensions"), null);
  equal(XXTSites.resolve("not a url"), null);
});
test("自定义站点域名匹配", () => {
  assert(XXTSites.customHostAllowed("course.example.com", [{ host: "example.com" }]), "子域名应匹配");
  assert(XXTSites.customHostAllowed("example.com", ["example.com"]), "主域名应匹配");
  assert(!XXTSites.customHostAllowed("badexample.com", [{ host: "example.com" }]), "不同域名不应匹配");
});
test("适配器能力值合法且通用适配器兜底", () => {
  const ids = new Set();
  for (const adapter of XXTSites.list()) {
    assert(!ids.has(adapter.id), `重复适配器 ${adapter.id}`);
    ids.add(adapter.id);
    assert(["full", "assist", "none"].includes(adapter.capabilities?.quiz), `${adapter.id} 能力值非法`);
    assert(adapter.hosts.length > 0, `${adapter.id} 缺少 hosts`);
  }
  equal(XXTSites.generic()?.id, "generic");
  assert(XXTSites.generic().capabilities.quiz === "assist", "通用模式应为辅助答题");
});

/* ---------------- 播放策略 ---------------- */
test("倍速白名单", () => {
  for (const rate of [0, 1, 1.5, 2, 3]) assert(XXTPolicy.validRate(rate), `${rate} 应为合法倍速`);
  for (const rate of [0.5, 2.2, -1, NaN, "2"]) assert(!XXTPolicy.validRate(rate), `${rate} 不应合法`);
});
test("报告合并与完成判定", () => {
  const now = Date.now();
  const reports = [
    { frameId: 3, at: now, blocked: "", videos: [{ id: 1, completed: true }], quiz: { detected: false } },
    { frameId: 7, at: now, blocked: "", videos: [{ id: 2, completed: false }], quiz: { detected: false } }
  ];
  const result = XXTPolicy.select(reports, now);
  equal(result.count, 2);
  equal(result.activeFrame, 7, "未完成视频所在 frame 应激活");
  assert(!result.allDone, "仍有未完成视频");
  const done = XXTPolicy.select(reports.map(report => ({ ...report, videos: report.videos.map(video => ({ ...video, completed: true })) })), now);
  assert(done.allDone, "全部完成");
  const blocked = XXTPolicy.select([{ ...reports[0], blocked: "检测到验证提示" }], now);
  equal(blocked.blocked, "检测到验证提示");
  const stale = XXTPolicy.select([{ ...reports[0], at: now - 60000 }], now);
  equal(stale.count, 0, "过期报告应被丢弃");
});
test("提交状态判定", () => {
  for (const status of ["awaiting_confirmation", "confirming", "submitted"]) assert(XXTPolicy.pendingSubmission({ status }), status);
  assert(!XXTPolicy.pendingSubmission({ status: "done" }));
  assert(!XXTPolicy.pendingSubmission(null));
});

/* ---------------- 文本校验 ---------------- */
test("答案文本规范化校验", () => {
  const ok = XXTText.verify(" 你好\n世界 ", { editorText: "你好世界", domText: "你好 世界", fieldFound: true, fieldText: "你好世界" });
  assert(ok.ok, "空白差异应通过");
  equal(XXTText.verify("你好", { editorText: "你好", domText: "你好呀" }).code, "EDITOR_DOM_MISMATCH");
  equal(XXTText.verify("", { editorText: "" }).code, "EMPTY_ANSWER");
  equal(XXTText.verify("答案", { editorText: "答案", domText: "答案", fieldFound: true, fieldText: "答案不对" }).code, "SYNC_FIELD_MISMATCH");
});

/* ---------------- AI 客户端纯逻辑 ---------------- */
test("AI 题目结构校验", () => {
  const question = { id: "q1", type: "single", stem: "1+1=?（ ）", options: [{ key: "A", text: "1" }, { key: "B", text: "2" }] };
  const parsed = XXTDeepSeek.questions([question]);
  equal(parsed.length, 1);
  equal(parsed[0].id, "q1");
  const rejects = [
    [{ ...question, id: "q1" }, { ...question, id: "q1" }],
    [{ ...question, options: [] }],
    [{ ...question, options: [{ key: "A", text: "1" }] }],
    [{ ...question, options: [{ key: "a", text: "1" }, { key: "B", text: "2" }] }],
    [{ ...question, encrypted: true }],
    [{ id: "q1", type: "short", stem: "简答", options: [{ key: "A", text: "x" }] }]
  ];
  for (const input of rejects) {
    let threw = false;
    try { XXTDeepSeek.questions(input); } catch { threw = true; }
    assert(threw, "非法题目应被拒绝：" + JSON.stringify(input).slice(0, 80));
  }
});
test("AI 答案解析与题号归一化", () => {
  const batch = [
    { id: "q1", type: "single", stem: "题1（ ）", options: [{ key: "A", text: "1" }, { key: "B", text: "2" }] },
    { id: "q2", type: "multiple", stem: "题2（ ）", options: [{ key: "A", text: "1" }, { key: "B", text: "2" }, { key: "C", text: "3" }] },
    { id: "q3", type: "short", stem: "题3？", options: [] }
  ];
  const raw = JSON.stringify({ answers: [{ id: "1", answer: "B", reason: "解析" }, { id: "q02", answer: "A,C", reason: "解析" }, { id: "第3题", answer: "作答内容", reason: "解析" }] });
  const parsed = XXTDeepSeek.inspect(raw, batch);
  equal(parsed.pending.length, 0, "全部题目应有答案");
  equal(parsed.byId.get("q1").answer, ["B"]);
  equal(parsed.byId.get("q2").answer, ["A", "C"]);
  equal(parsed.byId.get("q3").answer, ["作答内容"]);
  equal(XXTDeepSeek.answers(raw, batch).length, 3);
  let threw = false;
  try { XXTDeepSeek.answers(JSON.stringify({ answers: [{ id: "q1", answer: "Z" }] }), batch); } catch { threw = true; }
  assert(threw, "无效选项字母应导致失败");
});
test("AI 接口地址规范化", () => {
  equal(XXTDeepSeek.endpoint("https://api.deepseek.com"), "https://api.deepseek.com/chat/completions");
  equal(XXTDeepSeek.endpoint("https://api.deepseek.com/"), "https://api.deepseek.com/chat/completions");
  equal(XXTDeepSeek.endpoint("https://api.openai.com/v1"), "https://api.openai.com/v1/chat/completions");
  equal(XXTDeepSeek.endpoint("https://x.com/v1/chat/completions"), "https://x.com/v1/chat/completions");
  assert(XXTDeepSeek.isDeepSeek({ baseUrl: "https://api.deepseek.com" }));
  assert(!XXTDeepSeek.isDeepSeek({ baseUrl: "https://api.openai.com/v1" }));
});

/* ---------------- 运行 ---------------- */
for (const { name, fn } of tests) {
  try { await fn(); passed++; console.log(`${PASS} ${name}`); }
  catch (error) { failed++; failures.push(`${name}\n    ${error.message}`); console.log(`${FAIL} ${name}`); }
}
console.log(`\n${passed} passed, ${failed} failed, ${tests.length} total`);
if (failures.length) { console.log("\n失败详情："); for (const detail of failures) console.log("  - " + detail); }
process.exitCode = failed ? 1 : 0;
