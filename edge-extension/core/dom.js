/* DOM helpers shared by all content-script modules. Loaded before adapters. */
(() => {
  "use strict";
  const compact = value => String(value ?? "").replace(/\s+/g, " ").trim();
  const normalize = value => String(value ?? "").normalize("NFC").replace(/[\u200B\uFEFF]/g, "").replace(/\s+/g, "");
  function visible(el) {
    if (!el || !el.isConnected || el.nodeType !== 1) return false;
    const css = getComputedStyle(el);
    return css.display !== "none" && css.visibility !== "hidden" && css.opacity !== "0" && el.getClientRects().length > 0;
  }
  function rendered(el) {
    if (!visible(el)) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const win = el.ownerDocument.defaultView;
    for (let node = el; node; node = node.parentElement) {
      const css = win.getComputedStyle(node);
      if (node.hidden || node.getAttribute("aria-hidden") === "true" || css.display === "none" || css.visibility === "hidden" || css.opacity === "0") return false;
    }
    return true;
  }
  function hash(text) {
    let value = 2166136261;
    for (const char of String(text)) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
    return (value >>> 0).toString(16);
  }
  function queryAll(selector, root = document, limit = 400) {
    const list = root.querySelectorAll ? [...root.querySelectorAll(selector)] : [];
    return limit > 0 ? list.slice(0, limit) : list;
  }
  /* Light-DOM query is the default; traverse open shadow roots only when the
     normal query finds nothing (some players mount inside web components). */
  function queryAllDeep(selector, root = document, budget = 8000) {
    const found = [];
    const queue = [root];
    let visited = 0;
    while (queue.length) {
      const node = queue.shift();
      if (node?.querySelectorAll) found.push(...node.querySelectorAll(selector));
      if (found.length > 500) break;
      const elements = node?.querySelectorAll ? node.querySelectorAll("*") : [];
      for (const el of elements) {
        if (++visited > budget) return found;
        if (el.shadowRoot) queue.push(el.shadowRoot);
      }
    }
    return found;
  }
  function isDisabled(el) {
    if (!el) return true;
    if (el.disabled === true) return true;
    if (el.getAttribute?.("disabled") != null) return true;
    if (el.getAttribute?.("aria-disabled") === "true") return true;
    return el.matches?.(".disabled,.btnDisabled") === true;
  }
  function isEditable(el) {
    if (!el || !visible(el)) return false;
    const tag = el.tagName?.toLowerCase();
    if (tag === "textarea") return !el.disabled && !el.readOnly;
    if (tag === "input") return /^(?:text|search|url|tel)$/i.test(el.type || "text") && !el.disabled && !el.readOnly;
    return el.isContentEditable === true || el.getAttribute?.("contenteditable") === "true" || el.ownerDocument?.designMode === "on";
  }
  /* Find one question's rich-text editor. 学习通新版作业页的简答编辑器
   * 可能是 UEditor iframe、contenteditable、隐藏后再展开的 textarea，
   * 因此这里返回全部候选，由调用方决定可见/隐藏版本。 */
  function editorCandidates(root) {
    if (!root) return [];
    const list = [];
    const push = (kind, el, extra = {}) => {
      if (!el || list.some(item => item.el === el)) return;
      list.push({ kind, el, visible: visible(el), ...extra });
    };
    for (const el of root.querySelectorAll('[contenteditable="true"],[contenteditable=""],.edui-body-container')) push("rich", el);
    for (const frame of root.querySelectorAll('iframe')) {
      const editorLike = frame.closest(".edui-editor,.cke,.tox-tinymce") || /ueditor|editor/i.test(frame.id || "") || /edui|cke|tox|wysiwyg/i.test(frame.className || "");
      try {
        const doc = frame.contentDocument;
        const body = doc?.body;
        if (!body) continue;
        const editableBody = body.isContentEditable || doc.designMode === "on" || body.getAttribute("contenteditable") === "true";
        if (editableBody || editorLike) push("rich", body, { frame, iframe: frame });
      } catch { /* A cross-origin editor needs the MAIN-world fill path. */ }
    }
    for (const el of root.querySelectorAll("textarea")) if (!isDisabled(el)) push("textarea", el);
    for (const el of root.querySelectorAll('input[type="text"],input:not([type])')) if (!isDisabled(el) && !el.readOnly) push("input", el);
    for (const el of root.querySelectorAll('[role="textbox"]')) {
      if (isDisabled(el)) continue;
      if (el.matches("textarea,input")) push("textarea", el);
      else if (el.isContentEditable || el.getAttribute("contenteditable") === "true") push("rich", el);
    }
    return list;
  }
  function editorFor(root, options = {}) {
    const candidates = editorCandidates(root);
    const chosen = candidates.find(candidate => candidate.visible) || (options.includeHidden ? candidates[0] : null) || null;
    return chosen ? { kind: chosen.kind, el: chosen.el, frame: chosen.frame || null, visible: chosen.visible, hidden: !chosen.visible } : null;
  }
  function readEditor(editor) {
    if (!editor) return "";
    return String(editor.kind === "textarea" ? editor.el.value : editor.el.innerText || editor.el.textContent || "");
  }
  function dispatch(el, types) {
    if (!el?.isConnected) return;
    const win = el.ownerDocument.defaultView;
    for (const type of types || ["input", "change", "blur"]) {
      try { el.dispatchEvent(new win.Event(type, { bubbles: true, composed: true })); } catch { /* Detached window. */ }
    }
  }
  globalThis.XXTDom = Object.freeze({ compact, normalize, visible, rendered, hash, queryAll, queryAllDeep, isDisabled, isEditable, editorCandidates, editorFor, readEditor, dispatch });
})();
