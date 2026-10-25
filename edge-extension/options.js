"use strict";
const send = data => chrome.runtime.sendMessage({ channel: "xxt-player-v1", ...data });
const $ = id => document.getElementById(id);
const EFFORT_LABEL = { none: "关闭（最快）", low: "低", medium: "中", high: "高（默认）", max: "最高" };
let state = { catalog: null, defaults: null };

function setStatus(element, text, error = false) {
  element.textContent = text;
  element.classList.toggle("error", !!error);
}
async function call(action) {
  const result = await send(action);
  if (result?.error) throw new Error(result.error);
  return result;
}
function hostFromInput(raw) {
  const text = String(raw || "").trim().toLowerCase();
  if (!text) return "";
  try {
    const url = new URL(/^https?:\/\//.test(text) ? text : "https://" + text);
    return url.hostname.replace(/^www\./, "");
  } catch { return ""; }
}
async function ensureOriginPermission(baseUrl) {
  let origin;
  try {
    const url = new URL(baseUrl);
    if (!/^https?:$/.test(url.protocol)) throw new Error();
    origin = url.origin + "/*";
  } catch { throw new Error("接口地址必须是 http(s) URL"); }
  if (await chrome.permissions.contains({ origins: [origin] })) return true;
  try { return await chrome.permissions.request({ origins: [origin] }); } catch { return false; }
}

/* ---------------- AI settings ---------------- */
async function loadAi() {
  const data = await call({ type: "OPTIONS_GET" });
  $("baseUrl").value = data.baseUrl || "";
  $("model").value = data.model || "";
  $("models").innerHTML = (data.suggestedModels || []).map(model => `<option value="${model}"></option>`).join("");
  $("baseUrls").innerHTML = (data.suggestedBaseUrls || []).map(url => `<option value="${url}"></option>`).join("");
  $("effort").innerHTML = (data.efforts || []).map(effort => `<option value="${effort}">${EFFORT_LABEL[effort] || effort}</option>`).join("");
  $("effort").value = data.effort || "high";
  $("apiKey").value = "";
  setStatus($("aiStatus"), data.hasKey ? "已保存密钥。如需修改请填写后保存。" : "尚未保存密钥，AI 答题暂不可用。");
}
async function saveAi() {
  const baseUrl = $("baseUrl").value.trim();
  if (!baseUrl) throw new Error("请填写接口地址");
  if (!await ensureOriginPermission(baseUrl)) throw new Error("未授权访问该接口域名，无法保存");
  await call({ type: "OPTIONS_SAVE", apiKey: $("apiKey").value, baseUrl, model: $("model").value, effort: $("effort").value });
  await loadAi();
  setStatus($("aiStatus"), "设置已保存。");
}
$("saveAi").onclick = async () => {
  try { await saveAi(); } catch (error) { setStatus($("aiStatus"), error.message || "保存失败", true); }
};
$("testAi").onclick = async () => {
  const button = $("testAi");
  button.disabled = true;
  setStatus($("aiStatus"), "正在测试…");
  try {
    await saveAi();
    const result = await call({ type: "TEST_AI" });
    setStatus($("aiStatus"), `连接成功：模型返回「${result.text}」`);
  } catch (error) { setStatus($("aiStatus"), error.message || "测试失败", true); }
  finally { button.disabled = false; }
};
$("clearKey").onclick = async () => {
  try {
    await call({ type: "OPTIONS_SAVE", clear: true, baseUrl: $("baseUrl").value.trim() || undefined, model: $("model").value, effort: $("effort").value });
    await loadAi();
    setStatus($("aiStatus"), "密钥已清除。");
  } catch (error) { setStatus($("aiStatus"), error.message || "清除失败", true); }
};
$("import").onchange = async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 8192) throw new Error("配置文件过大");
    let config;
    try { config = JSON.parse(await file.text()); } catch { throw new Error("配置文件不是有效 JSON"); }
    if (typeof config.apiKey !== "string" || !config.apiKey.trim()) throw new Error("配置缺少 apiKey");
    $("apiKey").value = config.apiKey.trim();
    if (typeof config.model === "string") $("model").value = config.model;
    if (typeof config.effort === "string" && EFFORT_LABEL[config.effort]) $("effort").value = config.effort;
    await saveAi();
    setStatus($("aiStatus"), "旧版配置已导入并保存。");
  } catch (error) { setStatus($("aiStatus"), error.message || "导入失败", true); }
  finally { event.target.value = ""; }
};

/* ---------------- sites ---------------- */
function makeRow({ title, detail, siteId, prefs, caps, removable = false }) {
  const row = document.createElement("div");
  row.className = "site-row";
  const main = document.createElement("label");
  main.className = "grow";
  const enabled = document.createElement("input");
  enabled.type = "checkbox";
  enabled.checked = prefs.enabled !== false;
  enabled.onchange = async () => {
    try { await call({ type: "SITE_PREF_SET", siteId, enabled: enabled.checked }); setStatus($("siteStatus"), `${title} 已${enabled.checked ? "启用" : "停用"}，刷新课程页面后生效。`); }
    catch (error) { enabled.checked = !enabled.checked; setStatus($("siteStatus"), error.message || "保存失败", true); }
  };
  const name = document.createElement("b");
  name.textContent = title;
  main.append(enabled, name);
  if (detail) {
    const small = document.createElement("small");
    small.textContent = detail;
    main.append(small);
  }
  row.append(main);
  if (caps && caps.quiz !== "none") {
    const quizLabel = document.createElement("label");
    quizLabel.className = "mini";
    quizLabel.title = caps.quiz === "full" ? "AI 生成、填写、校验并自动提交" : "AI 生成并填入，由你核对后手动提交";
    const quiz = document.createElement("input");
    quiz.type = "checkbox";
    quiz.checked = !!prefs.autoQuiz;
    quiz.onchange = async () => {
      try { await call({ type: "SITE_PREF_SET", siteId, autoQuiz: quiz.checked }); setStatus($("siteStatus"), `${title} 自动答题已${quiz.checked ? "开启" : "关闭"}。`); }
      catch (error) { quiz.checked = !quiz.checked; setStatus($("siteStatus"), error.message || "保存失败", true); }
    };
    quizLabel.append(quiz, document.createTextNode(caps.quiz === "full" ? "自动答题" : "辅助答题"));
    row.append(quizLabel);
    if (caps.quiz === "assist") {
      const submitLabel = document.createElement("label");
      submitLabel.className = "mini";
      submitLabel.title = "实验性：AI 填写校验后自动点击提交";
      const submit = document.createElement("input");
      submit.type = "checkbox";
      submit.checked = !!prefs.autoSubmit;
      submit.onchange = async () => {
        try { await call({ type: "SITE_PREF_SET", siteId, autoSubmit: submit.checked }); setStatus($("siteStatus"), `${title} 自动提交已${submit.checked ? "开启（实验）" : "关闭"}。`); }
        catch (error) { submit.checked = !submit.checked; setStatus($("siteStatus"), error.message || "保存失败", true); }
      };
      submitLabel.append(submit, document.createTextNode("自动提交"));
      row.append(submitLabel);
    }
  }
  if (removable) {
    const remove = document.createElement("button");
    remove.className = "danger";
    remove.textContent = "移除";
    remove.onclick = async () => {
      if (!confirm(`移除自定义网站 ${title}？`)) return;
      try {
        await call({ type: "CUSTOM_SITE_REMOVE", host: siteId.replace(/^custom:/, "") });
        await loadSites();
        setStatus($("siteStatus"), `已移除 ${title}。`);
      } catch (error) { setStatus($("siteStatus"), error.message || "移除失败", true); }
    };
    row.append(remove);
  }
  return row;
}
function renderSites(catalog) {
  const list = $("siteList");
  list.textContent = "";
  for (const adapter of catalog.adapters) {
    list.append(makeRow({
      title: adapter.name,
      detail: adapter.hosts.join(" / "),
      siteId: adapter.id,
      prefs: adapter.prefs,
      caps: adapter.capabilities
    }));
  }
  const custom = $("customList");
  custom.textContent = "";
  if (!catalog.customSites.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "尚未添加自定义网站。";
    custom.append(empty);
  }
  for (const site of catalog.customSites) {
    const row = makeRow({ title: site.host, detail: "通用模式", siteId: "custom:" + site.host, prefs: site.prefs, caps: { quiz: "assist" }, removable: true });
    row.querySelector("small").textContent = "通用模式 · 需要该域名的访问权限";
    custom.append(row);
  }
}
async function loadSites() {
  const catalog = await call({ type: "SITES_GET" });
  state.catalog = catalog;
  renderSites(catalog);
  renderDefaults(catalog);
}
$("addCustom").onclick = async () => {
  const button = $("addCustom");
  button.disabled = true;
  try {
    const host = hostFromInput($("customHost").value);
    if (!host) throw new Error("请输入有效域名，例如 course.example.com");
    const patterns = [`https://${host}/*`, `https://*.${host}/*`];
    const granted = await chrome.permissions.request({ origins: patterns });
    if (!granted) throw new Error("未获得该网站访问权限");
    await call({ type: "CUSTOM_SITE_ADD", host });
    $("customHost").value = "";
    await loadSites();
    setStatus($("siteStatus"), `已添加 ${host}。打开该网站的视频课程页即可看到助手面板。`);
  } catch (error) { setStatus($("siteStatus"), error.message || "添加失败", true); }
  finally { button.disabled = false; }
};

/* ---------------- defaults ---------------- */
function renderDefaults(catalog) {
  const defaults = catalog.defaults || {};
  state.defaults = defaults;
  $("dAutoNext").checked = defaults.autoNext !== false;
  $("dResume").checked = defaults.resume !== false;
  $("dMuted").checked = !!defaults.muted;
  $("dForeground").checked = !!defaults.foregroundCompat;
  $("dRate").innerHTML = (catalog.rates || [0, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]).map(rate => `<option value="${rate}">${rate === 0 ? "跟随播放器" : rate + " 倍"}</option>`).join("");
  $("dRate").value = String(defaults.playbackRate || 0);
}
async function saveDefaults(patch) {
  try {
    await call({ type: "DEFAULTS_SET", ...patch });
    setStatus($("defaultsStatus"), "已保存，对新打开的课程页生效。");
  } catch (error) { setStatus($("defaultsStatus"), error.message || "保存失败", true); }
}
const DEFAULT_FIELDS = { dAutoNext: "autoNext", dResume: "resume", dMuted: "muted", dForeground: "foregroundCompat" };
for (const id of Object.keys(DEFAULT_FIELDS)) {
  $(id).onchange = () => saveDefaults({ [DEFAULT_FIELDS[id]]: $(id).checked });
}
$("dRate").onchange = () => saveDefaults({ playbackRate: Number($("dRate").value) });

/* ---------------- boot ---------------- */
$("version").textContent = "v" + chrome.runtime.getManifest().version;
(async () => {
  try {
    await Promise.all([loadAi(), loadSites()]);
  } catch (error) {
    setStatus($("aiStatus"), error.message || "读取设置失败，请重新打开本页", true);
  }
})();
