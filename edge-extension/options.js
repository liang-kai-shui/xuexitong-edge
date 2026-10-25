"use strict";
const status = document.querySelector("#status");
const keyInput = document.querySelector("#apiKey");
const model = document.querySelector("#model");
const effort = document.querySelector('#effort');
const send = data => chrome.runtime.sendMessage({ channel: "xxt-player-v1", ...data });
function render(result) {
  if (result.error) throw new Error(result.error);
  model.value = result.model;
  effort.value=result.effort || 'high';
  keyInput.value = "";
  status.textContent = result.hasKey ? "密钥已保存。返回课程页面，点击“生成答案与解析”。" : "尚未保存密钥。";
}
async function run(action) {
  try { await action(); } catch (error) { status.textContent = error.message || "设置失败，请重新加载扩展"; }
}
document.querySelector("#save").onclick = () => run(async () => render(await send({ type: "OPTIONS_SAVE", apiKey: keyInput.value, model: model.value,effort:effort.value })));
document.querySelector("#clear").onclick = () => run(async () => render(await send({ type: "OPTIONS_SAVE", clear: true, model: model.value,effort:effort.value })));
document.querySelector("#import").onchange = event => run(async () => {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 4096) throw new Error("配置文件过大，请选择密钥配置 JSON");
  let config;
  try { config = JSON.parse(await file.text()); } catch { throw new Error("配置文件不是有效 JSON"); }
  if (typeof config.apiKey !== "string" || !config.apiKey.trim()) throw new Error("配置缺少 apiKey 字段");
  render(await send({ type: "OPTIONS_SAVE", apiKey: config.apiKey, model: config.model,effort:config.effort }));
  event.target.value = "";
});
void run(async () => render(await send({ type: "OPTIONS_GET" })));
