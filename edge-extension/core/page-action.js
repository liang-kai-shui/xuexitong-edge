/* Serialized by chrome.scripting and executed in the page's MAIN world, so it
 * must not depend on any extension global. Keep every helper inside the function. */
globalThis.XXTPageAction = async function ({ kind, token, text }) {
  const root = [...document.querySelectorAll("[data-xxt-action]")].find(el => el.getAttribute("data-xxt-action") === token);
  if (!root) return { ok: false, error: "目标页面已变化" };

  if (kind === "foreground") {
    const key = Symbol.for("xxt-player.foregroundCompat");
    if (text === "off") { window[key]?.restore(); return { ok: true, enabled: false }; }
    if (text !== "on") return { ok: false, error: "无效兼容设置" };
    if (window[key]) return { ok: true, enabled: true };
    const saved = new Map(["hidden", "visibilityState", "hasFocus"].map(name => [name, Object.getOwnPropertyDescriptor(document, name)]));
    const restore = () => {
      for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(document, name, descriptor); else delete document[name]; }
      delete window[key];
    };
    try {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      Object.defineProperty(document, "hasFocus", { configurable: true, value: () => true });
      window[key] = { restore };
      return { ok: true, enabled: true };
    } catch { restore(); return { ok: false, error: "页面不允许修改可见性读取" }; }
  }

  if (kind === "editor") {
    const normalize = value => String(value ?? "").normalize("NFC").replace(/[\u200B\uFEFF]/g, "").replace(/\s+/g, "");
    /* 1) UEditor (超星 and other Chinese LMS rich editors) */
    const editors = Object.values(window.UE?.instants || {});
    const inRoot = editors.find(editor => [editor.container, editor.iframe, editor.textarea].some(el => el && typeof el === "object" && el.nodeType && (root === el || root.contains(el))));
    /* 新版作业页可能把整页共用的 UEditor 实例放在题目容器之外：只有一个实例时直接使用。 */
    const ueditor = inRoot || (editors.length === 1 ? editors[0] : null);
    if (ueditor?.setContent && ueditor?.sync && ueditor?.getContentTxt) {
      const escaped = document.createElement("div");
      escaped.textContent = text;
      ueditor.setContent("<p>" + escaped.innerHTML.replace(/\r?\n/g, "</p><p>") + "</p>");
      ueditor.fireEvent?.("contentchange");
      ueditor.sync();
      ueditor.blur?.();
      ueditor.sync();
      const body = ueditor.body || ueditor.iframe?.contentDocument?.body;
      let field = typeof ueditor.textarea === "object" && ueditor.textarea?.tagName === "TEXTAREA" ? ueditor.textarea : null;
      if (!field && ueditor.options?.textarea) field = document.getElementById("ueditor_textarea_" + ueditor.options.textarea);
      if (!field) { const fields = root.querySelectorAll("textarea"); if (fields.length === 1) field = fields[0]; }
      let fieldText = field?.value;
      if (field && /<\/?(?:p|div|span|br|strong|em|ol|ul|li)\b/i.test(fieldText || "")) {
        const template = document.createElement("template");
        template.innerHTML = fieldText;
        fieldText = template.content.textContent;
      }
      return { ok: true, text: ueditor.getContentTxt(), domText: body?.innerText || body?.textContent || "", fieldFound: !!field, fieldText };
    }
    /* 2) Plain textarea / input */
    const readTarget = target => target.tagName === "TEXTAREA" || target.tagName === "INPUT" ? String(target.value || "") : String(target.innerText || target.textContent || "");
    const target = root.matches?.("textarea,[contenteditable],[role='textbox'],input[type='text']")
      ? root
      : root.querySelector?.("textarea,[contenteditable],[role='textbox'],input[type='text']");
    if (!target) return { ok: false, unavailable: true };
    const view = target.ownerDocument.defaultView;
    if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") {
      const proto = target.tagName === "TEXTAREA" ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(target, text);
    } else {
      target.focus?.();
      let inserted = false;
      try {
        const selection = view.getSelection();
        const range = target.ownerDocument.createRange();
        range.selectNodeContents(target);
        selection.removeAllRanges();
        selection.addRange(range);
        inserted = target.ownerDocument.execCommand?.("insertText", false, text) === true;
      } catch { /* Fall back to direct DOM replacement. */ }
      if (!inserted) target.textContent = text;
      target.blur?.();
    }
    for (const type of ["input", "change", "blur"]) {
      try { target.dispatchEvent(new view.Event(type, { bubbles: true, composed: true })); } catch { /* ignore */ }
    }
    const readback = readTarget(target);
    return { ok: true, text: readback, domText: readback, fieldFound: target.tagName === "TEXTAREA" || target.tagName === "INPUT", fieldText: readTarget(target), normalized: normalize(readback) };
  }

  if (kind === "submit" || kind === "confirm") {
    const original = window.confirm;
    window.confirm = function (message) {
      const value = String(message || "");
      if (/提交/.test(value) && /确定|确认|是否|不能修改|不可修改/.test(value) && !/未答|未完成|验证码|人脸/.test(value)) return true;
      return original.call(window, message);
    };
    try { root.click(); return { ok: true }; }
    finally { window.confirm = original; }
  }
  return { ok: false, error: "未知页面操作" };
};
