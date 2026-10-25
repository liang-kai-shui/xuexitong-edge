/* DOM 语义识别测试：用无头 Edge/Chrome 打开 dom-harness.html。
 * 运行：node tests/run-dom-tests.mjs（可用 BROWSER_PATH 指定浏览器路径） */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const HARNESS = join(HERE, "dom-harness.html");
const ROOT = join(HERE, "..");
/* 仓库布局下扩展位于 edge-extension/，独立解压布局下就在根目录。 */
const BASE = existsSync(join(ROOT, "edge-extension", "manifest.json")) ? "../edge-extension" : "..";
const CANDIDATES = [
  process.env.BROWSER_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/microsoft-edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
].filter(Boolean);
const browser = CANDIDATES.find(path => existsSync(path));
if (!browser) {
  console.log("SKIP: 未找到 Edge/Chrome，可设置环境变量 BROWSER_PATH 后运行 DOM 测试");
  process.exit(0);
}
const profile = mkdtempSync(join(tmpdir(), "xxt-dom-"));
const args = [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--no-default-browser-check",
  "--disable-extensions", "--disable-features=Translate,MediaRouter",
  `--user-data-dir=${profile}`, "--allow-file-access-from-files",
  "--virtual-time-budget=20000", "--dump-dom", pathToFileURL(HARNESS).href + "?base=" + encodeURIComponent(BASE)
];
let result;
try {
  result = spawnSync(browser, args, { encoding: "utf8", timeout: 120000, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
} finally {
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
}
const output = `${result?.stdout || ""}\n${(result?.stderr || "").split(/\r?\n/).filter(line => !/ERROR|WARNING|DevTools|crashpad/i.test(line)).join("\n")}`;
const summary = /SUMMARY pass=(\d+) fail=(\d+)/.exec(output);
if (!summary) {
  console.error("未获取到测试结果（浏览器可能启动失败）。输出片段：\n" + output.slice(0, 5000));
  process.exit(1);
}
const pass = Number(summary[1]), fail = Number(summary[2]);
const lines = output.split(/\r?\n/).filter(line => /^(PASS|FAIL) /.test(line));
for (const line of lines) console.log(line);
console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exitCode = fail ? 1 : 0;
