"use strict";
const send = data => chrome.runtime.sendMessage({ channel: "xxt-player-v1", ...data });
const $ = id => document.getElementById(id);
let tabId = null;
let info = null;
const setStatus = (text, error = false) => { $("status").textContent = text; $("status").classList.toggle("error", !!error); };
function isHttp(url) { return /^https?:/i.test(url || ""); }
async function refresh() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  if (!tabId) { setStatus("无法读取当前标签页", true); return; }
  try { info = await send({ type: "TAB_INFO", tabId }); }
  catch (error) { setStatus(error.message || "读取失败，请刷新页面后重试", true); return; }
  render();
}
function render() {
  const infoSite = info?.site;
  $("version").textContent = "v" + chrome.runtime.getManifest().version;
  $("aiState").textContent = info?.hasKey ? "AI 已配置" : "AI 未配置（答题不可用）";
  const siteName = infoSite?.name || (isHttp(info?.url) ? new URL(info.url).hostname : "");
  $("siteName").textContent = siteName || "当前页面不支持";
  if (infoSite) {
    $("siteMeta").textContent = infoSite.custom ? "自定义网站 · 通用模式" : "内置适配平台";
    $("enabledRow").style.display = "";
    $("enabled").checked = infoSite.prefs.enabled !== false;
    $("unknownRow").style.display = "none";
  } else if (isHttp(info?.url)) {
    $("siteMeta").textContent = "未内置适配，可使用通用模式（需要授权）";
    $("enabledRow").style.display = "none";
    $("unknownRow").style.display = "";
  } else {
    $("siteMeta").textContent = "请在课程网站页面使用";
    $("enabledRow").style.display = "none";
    $("unknownRow").style.display = "none";
  }
  const live = info?.session?.allowed;
  $("controlRow").style.display = live ? "" : "none";
  $("hint").textContent = infoSite
    ? "打开课程学习页后，点击页面右下角面板的“开始/继续”；也可用这里的按钮控制。"
    : "扩展未在该页面运行。若这是视频课程网站，可启用通用模式。";
}
$("enabled").onchange = async () => {
  try {
    await send({ type: "SITE_PREF_SET", siteId: info.site.uri, enabled: $("enabled").checked });
    setStatus(`已${$("enabled").checked ? "启用" : "停用"}，正在刷新页面…`);
    setTimeout(() => chrome.tabs.reload(tabId), 300);
  } catch (error) { setStatus(error.message || "保存失败", true); }
};
$("enableCustom").onclick = async () => {
  const button = $("enableCustom");
  button.disabled = true;
  try {
    const url = new URL(info.url);
    const host = url.hostname.replace(/^www\./, "");
    const patterns = [`https://${host}/*`, `https://*.${host}/*`];
    const granted = await chrome.permissions.request({ origins: patterns });
    if (!granted) throw new Error("未获得该网站访问权限");
    await send({ type: "CUSTOM_SITE_ADD", host });
    await send({ type: "INJECT_TAB", tabId });
    setStatus(`已启用通用模式：${host}，页面面板稍后出现`);
    setTimeout(refresh, 800);
  } catch (error) { setStatus(error.message || "启用失败", true); }
  finally { button.disabled = false; }
};
async function command(action) {
  try {
    await chrome.tabs.sendMessage(tabId, { channel: "xxt-player-v1", type: "CONTENT_COMMAND", action });
    setStatus(action === "start" ? "已发送开始指令" : action === "pause" ? "已发送暂停指令" : "已切换面板显示");
    setTimeout(refresh, 300);
  } catch { setStatus("助手脚本尚未注入，请刷新课程页面后再试", true); }
}
$("start").onclick = () => command("start");
$("pause").onclick = () => command("pause");
$("togglePanel").onclick = () => command("toggle-panel");
$("reload").onclick = () => chrome.tabs.reload(tabId);
$("openOptions").onclick = () => chrome.runtime.openOptionsPage();
$("openOptions2").onclick = () => chrome.runtime.openOptionsPage();
void refresh();
