/* Site adapter registry and URL detection. Shared by the service worker and
 * every content script; adapters register themselves by calling XXTSites.register. */
(() => {
  "use strict";
  const adapters = [];
  const index = new Map();
  function register(adapter) {
    if (!adapter || typeof adapter.id !== "string" || !adapter.id) throw new Error("站点适配器缺少 id");
    if (index.has(adapter.id)) throw new Error("站点适配器重复注册：" + adapter.id);
    index.set(adapter.id, adapter);
    adapters.push(adapter);
  }
  const generic = () => index.get("generic") || null;
  const byId = id => index.get(id) || null;
  const list = () => adapters.filter(a => !a.generic);
  function hostOf(raw) {
    try { return new URL(String(raw || "")).hostname.toLowerCase(); } catch { return ""; }
  }
  function hostMatches(host, pattern) {
    const p = String(pattern || "").toLowerCase().replace(/^\.+/, "");
    if (!host || !p) return false;
    return host === p || host.endsWith("." + p);
  }
  function hostsMatch(host, adapter) {
    return (adapter.hosts || []).some(pattern => hostMatches(host, pattern));
  }
  /* Returns null when the URL does not belong to a known platform.
   * "strong" means the URL is a recognised course/learning page; otherwise the
   * content script must first see real media/quiz signals before activating. */
  function resolve(raw) {
    let url;
    try { url = new URL(String(raw || "")); } catch { return null; }
    if (!/^https?:$/.test(url.protocol)) return null;
    const host = url.hostname.toLowerCase();
    for (const adapter of adapters) {
      if (adapter.generic || !hostsMatch(host, adapter)) continue;
      const hints = adapter.urlHints;
      /* urlHints === null  => 整站弱匹配：只有页面真正出现媒体/题目时才激活。
         urlHints 缺省或空数组 => 整站强匹配。 */
      const strong = hints === null ? false
        : !Array.isArray(hints) || hints.length === 0 ? true
        : hints.some(hint => hint.test(String(raw)));
      return { adapter, strong, host };
    }
    return null;
  }
  function customHostAllowed(host, customSites) {
    if (!host || !Array.isArray(customSites)) return false;
    return customSites.some(site => hostMatches(host, typeof site === "string" ? site : site?.host));
  }
  let active = null;
  function use(adapter) { active = adapter || generic(); return active; }
  function current() { return active || generic(); }
  globalThis.XXTSites = Object.freeze({ register, byId, list, generic, hostOf, hostMatches, hostsMatch, resolve, customHostAllowed, use, current });
})();
