/* Quiz engine. Platform adapters can supply an exact question profile
 * (学习通 does); every other site falls back to conservative structural
 * detection (radio/checkbox groups + text editors) with the same
 * solve → fill → verify → (optionally) submit pipeline. */
(() => {
  "use strict";
  const compact = value => XXTDom.compact(value);
  const site = () => XXTSites.current();
  const profile = () => site()?.quiz || null;
  const hash = text => XXTDom.hash(text);

  /* ---------------- generic question collection ---------------- */
  const OPTION_INPUTS = 'input[type="radio"],input[type="checkbox"],[role="radio"],[role="checkbox"]';
  const QUESTION_MARK = /[?？]|（\s*）|\(\s*\)|题|分|正确|错误|下列|以下|单选|多选|判断|简答|填空/;

  function optionText(input) {
    if (input.tagName !== "INPUT") {
      const own = compact(input.getAttribute("aria-label") || input.textContent);
      if (own) return own;
    }
    const labels = input.labels ? [...input.labels] : [];
    const label = labels[0] || (input.id && document.querySelector(`label[for="${CSS.escape(input.id)}"]`)) || input.closest("label");
    if (label) return compact(label.textContent);
    let node = input.parentElement;
    for (let depth = 0; node && depth < 3; depth++, node = node.parentElement) {
      if (node.querySelectorAll(OPTION_INPUTS).length > 1) break;
      const text = compact(node.textContent);
      if (text) return text;
    }
    return compact(input.getAttribute("aria-label") || input.value || "");
  }
  function commonAncestor(a, b) {
    let node = a;
    while (node && !(node.contains(b) && node !== b)) node = node.parentElement;
    return node;
  }
  function choiceRoot(inputs) {
    let root = inputs.reduce((acc, input) => acc ? commonAncestor(acc, input) : input, null) || inputs[0].parentElement;
    if (!root || root === document.body) root = inputs[0].parentElement;
    return root;
  }
  function questionRoot(optionContainer, optionTexts) {
    const optionLength = optionTexts.join("").length;
    let root = optionContainer;
    for (let depth = 0; depth < 4 && root.parentElement && root.parentElement !== document.body; depth++) {
      const parent = root.parentElement;
      const text = compact(parent.textContent);
      if (text.length > 4000) break;
      root = parent;
      if (text.length >= optionLength + 6) break;
    }
    return root;
  }
  function stripOptions(text, optionTexts) {
    let stem = text;
    for (const option of optionTexts) {
      if (!option) continue;
      stem = stem.split(option).join(" ").replace(/\s+/g, " ");
    }
    return compact(stem).replace(/^\d+\s*[.、．)]\s*/, "").replace(/^[（(]\s*\d+\s*[)）]\s*/, "").trim();
  }
  function keyOf(text, index, used) {
    const match = /^\s*([A-L])\s*[.、．)）:：]/.exec(text);
    let key = match ? match[1] : String.fromCharCode(65 + index);
    if (used.has(key)) key = String.fromCharCode(65 + index);
    let guard = 0;
    while (used.has(key) && guard++ < 30) key = String.fromCharCode(65 + index + guard);
    used.add(key);
    return key;
  }
  function judgeLike(texts) {
    return texts.length === 2 && texts.every(text => /^(?:正确|错误|对|错|是|否|true|false|t|f)\.?$/i.test(text.replace(/^[A-L][.、．)）:：]\s*/i, "").trim()));
  }
  function buildChoiceItem(root, inputs, titleEl) {
    const texts = inputs.map(optionText);
    const used = new Set();
    const options = inputs.map((el, index) => ({
      key: keyOf(texts[index], index, used),
      text: compact(texts[index].replace(/^[A-L]\s*[.、．)）:：]\s*/i, "")) || texts[index],
      el: el.closest("label") || el
    }));
    let stem = stripOptions(compact(root.textContent), texts);
    if (stem.length < 4) {
      const previous = root.previousElementSibling;
      const heading = root.querySelector("h1,h2,h3,h4,h5,.title,.question-title,.stem");
      const candidate = titleEl && titleEl !== root ? compact(titleEl.textContent) : previous ? compact(previous.textContent) : heading ? compact(heading.textContent) : "";
      if (candidate.length >= 2 && candidate.length < 1200) stem = stripOptions(candidate, texts);
    }
    const tag = inputs[0].tagName.toLowerCase();
    const role = inputs[0].getAttribute("role");
    const multiple = tag === "input" ? inputs[0].type === "checkbox" : role === "checkbox" || inputs[0].getAttribute("aria-multiselectable") === "true";
    const type = multiple ? "multiple" : judgeLike(options.map(option => option.text)) ? "judge" : "single";
    return { root, title: titleEl || root, id: "", type, stem, options, editor: null, encrypted: false };
  }
  function looksLikeQuestion(stem) {
    return QUESTION_MARK.test(stem) || /^\s*\d+\s*[.、．)]/.test(stem);
  }
  function collectFromHints(items) {
    const hints = site()?.hints || {};
    const covered = root => items.some(item => item.root === root || item.root.contains(root) || root.contains(item.root));
    for (const selector of hints.quizRoots || []) {
      let roots = [];
      try { roots = [...document.querySelectorAll(selector)]; } catch { continue; }
      for (const root of roots) {
        if (!XXTDom.visible(root) || covered(root) || root.closest("#xxt-player-assistant,.xxt-ai-explanation")) continue;
        const inputs = [...root.querySelectorAll(OPTION_INPUTS)].filter(XXTDom.visible);
        if (inputs.length >= 2) {
          const titleEl = (hints.quizTitle ? root.querySelector(hints.quizTitle) : null) || root.querySelector(".title,.question-title,h3,h4") || root;
          items.push(buildChoiceItem(root, inputs, titleEl));
          continue;
        }
        const editor = XXTDom.editorFor(root);
        if (editor) items.push({ root, title: root, id: "", type: "short", stem: compact(root.textContent).slice(0, 4000), options: [], editor, encrypted: false });
      }
    }
    return items;
  }
  function collectGeneric() {
    const items = collectFromHints([]);
    const covered = root => items.some(item => item.root === root || item.root.contains(root) || root.contains(item.root));
    /* 1) radio/checkbox groups grouped by name, then by nearest question-like container */
    const inputs = [...document.querySelectorAll(OPTION_INPUTS)]
      .filter(el => XXTDom.visible(el) && !XXTDom.isDisabled(el) && !el.closest("#xxt-player-assistant,.xxt-ai-explanation"));
    const groups = new Map();
    const anonymous = [];
    inputs.forEach(input => {
      if (input.name) {
        const key = `name:${input.name}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(input);
      } else anonymous.push(input);
    });
    const anonymousGroups = new Map();
    for (const input of anonymous) {
      const box = input.closest(".question,.question-item,.que-item,[class*='question'],[class*='ques'],.problem,fieldset,li") || input.parentElement;
      if (!box) continue;
      if (!anonymousGroups.has(box)) anonymousGroups.set(box, []);
      anonymousGroups.get(box).push(input);
    }
    const allGroups = [...groups.values(), ...anonymousGroups.values()].filter(group => group.length >= 2 && group.length <= 12);
    for (const group of allGroups) {
      if (group.some(input => covered(input))) continue;
      const container = choiceRoot(group);
      if (!container) continue;
      const texts = group.map(optionText);
      const root = questionRoot(container, texts);
      const item = buildChoiceItem(root, group, root);
      if (!item.stem || !looksLikeQuestion(item.stem)) {
        /* Allow hint-provided platforms and very short explicit stems. */
        if (site()?.id !== "generic" && item.stem.length >= 2) items.push(item);
        continue;
      }
      items.push(item);
    }
    /* 2) free-text answers */
    for (const editor of [...document.querySelectorAll('textarea,[contenteditable="true"]')]) {
      if (!XXTDom.visible(editor) || XXTDom.isDisabled(editor) || editor.closest("#xxt-player-assistant")) continue;
      if (editor.closest("input,select")) continue;
      if (items.some(item => item.root.contains(editor)) || editor.closest(".xxt-ai-explanation")) continue;
      let root = editor.parentElement;
      for (let depth = 0; depth < 3 && root?.parentElement && root.parentElement !== document.body; depth++) {
        const text = compact(root.textContent);
        if (text.length >= 8) break;
        root = root.parentElement;
      }
      if (!root) continue;
      const stem = stripOptions(compact(root.textContent), [compact(editor.value || editor.textContent || "")]);
      if (!looksLikeQuestion(stem) && stem.length < 8) continue;
      const wrapped = XXTDom.editorFor(root);
      if (!wrapped) continue;
      items.push({ root, title: root, id: "", type: "short", stem: stem.slice(0, 4000), options: [], editor: wrapped, encrypted: false });
    }
    /* 3) stable document order + ids */
    items.sort((a, b) => {
      if (a.root === b.root) return 0;
      return a.root.compareDocumentPosition(b.root) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    items.forEach((item, index) => {
      item.id = `q${index + 1}`;
      item.encrypted = !!globalThis.XXTQuestionImage && [item.title, ...item.options.map(option => option.el)].some(el => XXTQuestionImage.encrypted(el));
    });
    return items;
  }

  function collect() {
    const current = profile();
    return typeof current?.collect === "function" ? current.collect() : collectGeneric();
  }
  function genericExtras(items) {
    const body = document.body?.innerText || "";
    const completion = items.length === 0 && /你已完成|本次(?:练习|测验|作业|测试)(?:已提交|已完成)|(?:作业|试卷|测验)(?:已提交|提交成功)|提交成功/.test(body);
    return { review: false, nativeStatus: false, marker: false, completion, detectedExtra: false };
  }
  function extras(items) {
    const current = profile();
    return typeof current?.extras === "function" ? current.extras(items) : genericExtras(items);
  }
  function scan() {
    const items = collect();
    const ext = extras(items);
    const review = !!ext.review;
    const questions = review ? [] : items.filter(q => q.stem && (q.type === "short" || q.options.length >= 2)).map(q => ({
      id: q.id, type: q.type, stem: q.stem, options: q.options.map(({ key, text }) => ({ key, text })), ...(q.encrypted ? { encrypted: true } : {})
    }));
    const detected = items.length > 0 || !!ext.detectedExtra || !!ext.completion;
    return { detected, count: questions.length, total: items.length, unsupported: review ? 0 : items.length - questions.length,
      completed: detected && !!(ext.marker || ext.completion || review),
      evidence: review ? "answer-review" : ext.marker ? "status-marker" : ext.completion ? "completion-message" : "",
      fingerprint: hash(JSON.stringify(questions)), questions, items };
  }

  async function read() {
    const current = scan();
    for (const q of current.questions) {
      if (!q.encrypted) continue;
      const item = current.items.find(candidate => candidate.id === q.id);
      if (!item?.title) throw new Error("混淆字体题目的题干节点不完整，已停止作答");
      q.image = await XXTQuestionImage.render([{ label: `题目 ${q.id}（${q.type}）`, el: item.title }, ...item.options.map(option => ({ label: `选项 ${option.key}`, el: option.el }))]);
    }
    if (scan().fingerprint !== current.fingerprint) throw new Error("生成题目图像期间页面已变化，请重新识别");
    return { fingerprint: current.fingerprint, questions: current.questions, total: current.total, unsupported: current.unsupported };
  }

  /* ---------------- selection / fill / verification ---------------- */
  function selected(item, option) {
    const current = profile();
    const hidden = typeof current?.hiddenAnswer === "function" ? current.hiddenAnswer(item, option) : null;
    /* 非空的隐藏提交字段视为权威状态；空值由适配器返回 null，回退到视觉状态。 */
    if (hidden !== null && hidden !== undefined) return hidden;
    if (option.el?.matches?.('input[type="radio"],input[type="checkbox"]')) return !!option.el.checked;
    const input = option.el?.querySelector?.('input[type="radio"],input[type="checkbox"]');
    if (input && input.checked) return true;
    if (option.el?.matches?.("label") && option.el.control) return !!option.el.control.checked;
    const aria = option.el?.getAttribute?.("aria-checked");
    if (aria === "true") return true;
    if (option.el?.matches?.(".check_answer,.check_answer_dx,.checked,.selected,.active")) return true;
    if (option.el?.querySelector?.(".check_answer,.check_answer_dx,.checked,.selected")) return true;
    /* 部分新版页面把选中类名放在选项的父级/子级（例如 <li class="active"><a>） */
    if (option.el?.parentElement?.matches?.(".active,.selected,.checked")) return true;
    if (option.el?.querySelector?.('[aria-checked="true"]')) return true;
    return false;
  }
  function matches(item, answer) {
    if (!item || !Array.isArray(answer?.answer) || !answer.answer.length) return false;
    if (item.type === "short") {
      return answer.answer.length === 1 && typeof answer.answer[0] === "string" && !!answer.answer[0].trim() &&
        XXTText.normalize(XXTDom.readEditor(XXTDom.editorFor(item.root))) === XXTText.normalize(answer.answer[0]);
    }
    return answer.answer.every(key => item.options.some(option => option.key === key)) && item.options.every(option => selected(item, option) === answer.answer.includes(option.key));
  }
  async function fillEditor(item, answer, pageAction) {
    if (answer.answer.length !== 1 || typeof answer.answer[0] !== "string" || !answer.answer[0].trim()) return { ok: false, code: "EMPTY_ANSWER" };
    const text = answer.answer[0];
    let editor = XXTDom.editorFor(item.root);
    /* 新版作业页的编辑器可能先隐藏、点击“作答”后才出现，先尝试展开。 */
    if (!editor) {
      const hidden = XXTDom.editorFor(item.root, { includeHidden: true });
      if (hidden) {
        revealEditor(item.root, hidden);
        await new Promise(resolve => setTimeout(resolve, 180));
        editor = XXTDom.editorFor(item.root) || hidden;
      }
    }
    if (!editor) return { ok: false, code: "EDITOR_NOT_FOUND" };
    if (pageAction) {
      const result = await pageAction("editor", item.root, text);
      if (result.ok) {
        const local = XXTDom.editorFor(item.root);
        const verification = XXTText.verify(text, { editorText: result.text, domText: local ? XXTDom.readEditor(local) : result.domText, fieldFound: result.fieldFound, fieldText: result.fieldText });
        if (verification.ok) return verification;
      } else if (!result.unavailable) {
        return { ok: false, code: "EDITOR_API_ERROR" };
      }
    }
    editor = XXTDom.editorFor(item.root) || editor;
    const win = editor.el.ownerDocument.defaultView;
    if (editor.kind === "textarea" || editor.kind === "input") {
      if (XXTDom.visible(editor.el)) editor.el.focus?.();
      const proto = editor.el.tagName === "TEXTAREA" ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      setter?.call(editor.el, text);
    } else {
      try { editor.el.focus?.(); } catch { /* hidden editor */ }
      let inserted = false;
      try {
        const selection = win.getSelection();
        const range = editor.el.ownerDocument.createRange();
        range.selectNodeContents(editor.el);
        selection.removeAllRanges();
        selection.addRange(range);
        inserted = editor.el.ownerDocument.execCommand?.("insertText", false, text) === true;
      } catch { /* Fall back to direct DOM replacement. */ }
      if (!inserted) {
        editor.el.replaceChildren(...text.split(/\r?\n/).map(line => {
          const paragraph = editor.el.ownerDocument.createElement("p");
          paragraph.textContent = line;
          return paragraph;
        }));
      }
      try { editor.el.blur?.(); } catch { /* ignore */ }
    }
    XXTDom.dispatch(editor.el, ["input", "change", "blur"]);
    await new Promise(resolve => setTimeout(resolve, 150));
    const current = XXTDom.readEditor(XXTDom.editorFor(item.root) || editor);
    const verified = XXTText.verify(text, { editorText: current, domText: current, fieldFound: editor.kind === "textarea" || editor.kind === "input", fieldText: (editor.kind === "textarea" || editor.kind === "input") ? editor.el.value : current });
    if (!verified.ok) {
      /* 有些编辑器把内容同步到外层隐藏字段后才算完成，再等一轮读取。 */
      await new Promise(resolve => setTimeout(resolve, 250));
      const late = XXTDom.readEditor(XXTDom.editorFor(item.root, { includeHidden: true }) || editor);
      return XXTText.verify(text, { editorText: late, domText: late, fieldFound: false, fieldText: late });
    }
    return verified;
  }
  function revealEditor(root, editor) {
    const targets = [
      editor.el,
      editor.el?.parentElement,
      editor.el?.closest?.(".edui-editor,.cke,.tox-tinymce,.answer-box,.answerBox,[class*='editor'],[class*='answer'],[class*='textarea']"),
      root?.querySelector?.("button,[role='button'],.edui-btn,.btn")
    ].filter(Boolean);
    for (const target of targets.slice(0, 3)) {
      try { target.click(); } catch { /* ignore */ }
    }
  }

  /* ---------------- choice filling with re-scan & multiple click strategies ---------------- */
  function optionClickTargets(option) {
    const el = option.el;
    const targets = [];
    const push = node => { if (node && !targets.includes(node)) targets.push(node); };
    if (el?.matches?.('input[type="radio"],input[type="checkbox"]')) push(el);
    const input = el?.querySelector?.('input[type="radio"],input[type="checkbox"]');
    if (input) push(input);
    push(el?.closest?.("label"));
    if (el?.matches?.("label")) push(el);
    const role = el?.matches?.('[role="radio"],[role="checkbox"]') ? el : el?.querySelector?.('[role="radio"],[role="checkbox"]');
    push(role);
    const clickable = el?.matches?.("a,button,[onclick]") ? el : el?.querySelector?.("a,button,[onclick]");
    push(clickable);
    const letter = el?.querySelector?.('[class*="num"],[class*="letter"],[class*="option"],[class*="check"],[class*="select"],[class*="active"]');
    push(letter);
    push(el);
    return targets;
  }
  function dispatchMouseSequence(target) {
    const win = target?.ownerDocument?.defaultView;
    if (!win || !target?.dispatchEvent) return;
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      try {
        const EventCtor = type.startsWith("pointer") && typeof win.PointerEvent === "function" ? win.PointerEvent : win.MouseEvent;
        target.dispatchEvent(new EventCtor(type, { bubbles: true, cancelable: true, view: win, button: 0 }));
      } catch { /* ignore */ }
    }
  }
  function clickChoice(option, round = 0) {
    const targets = optionClickTargets(option);
    const target = targets[Math.min(round, targets.length - 1)] || option.el;
    if (round >= 2) { dispatchMouseSequence(target); return; }
    try { target.click(); } catch { /* detached or no click handler */ }
  }
  function refreshItem(item) {
    const snapshot = scan();
    return snapshot.items.find(candidate => candidate.id === item.id) || snapshot.items.find(candidate => candidate.stem && candidate.stem === item.stem) || null;
  }
  async function fillChoice(item, answer, fingerprint) {
    const desired = answer.answer;
    let working = item;
    for (let round = 0; round < 3; round++) {
      const snapshot = scan();
      if (snapshot.fingerprint !== fingerprint) return { ok: false, code: "CHOICE_STATE_MISMATCH", pageChanged: true };
      const fresh = snapshot.items.find(candidate => candidate.id === working.id) || snapshot.items.find(candidate => candidate.stem === working.stem);
      if (!fresh) return { ok: false, code: "CHOICE_STATE_MISMATCH" };
      working = fresh;
      let changed = false;
      for (const option of working.options) {
        const wanted = desired.includes(option.key);
        if (selected(working, option) !== wanted) {
          clickChoice(option, round);
          changed = true;
          await new Promise(resolve => setTimeout(resolve, round === 0 ? 45 : 90));
        }
      }
      await new Promise(resolve => setTimeout(resolve, round === 0 ? 160 : 240));
      if (matches(working, answer)) return { ok: true, code: "OK", rounds: round + 1 };
      if (!changed) break;
    }
    return { ok: false, code: "CHOICE_STATE_MISMATCH" };
  }
  function describeDom(item) {
    const attrs = node => {
      if (!node?.attributes) return "";
      return [...node.attributes]
        .filter(attr => /^(class|id|data|qid|name|type|role|aria-)/i.test(attr.name))
        .slice(0, 5)
        .map(attr => `${attr.name}=${String(attr.value).slice(0, 30)}`)
        .join(" ");
    };
    const root = item.root;
    const options = item.options.slice(0, 10).map(option => {
      const el = option.el;
      const input = el?.matches?.('input[type="radio"],input[type="checkbox"]') ? el : el?.querySelector?.('input[type="radio"],input[type="checkbox"]');
      return {
        key: option.key,
        tag: String(el?.tagName || "").toLowerCase(),
        attrs: attrs(el),
        input: input ? `${String(input.tagName).toLowerCase()}${input.type ? `[${input.type}]` : ""}` : "",
        inputVisible: input ? XXTDom.visible(input) : false,
        checked: input ? !!input.checked : null,
        aria: el?.getAttribute?.("aria-checked") ?? null
      };
    });
    const contenteditables = [...(root?.querySelectorAll?.('[contenteditable="true"],[contenteditable=""],.edui-body-container') || [])]
      .slice(0, 4).map(el => ({ tag: String(el.tagName).toLowerCase(), cls: String(el.className || "").slice(0, 60), visible: XXTDom.visible(el) }));
    const textareas = [...(root?.querySelectorAll?.("textarea") || [])].slice(0, 4).map(el => ({ cls: String(el.className || "").slice(0, 60), visible: XXTDom.visible(el) }));
    const iframes = [...(root?.querySelectorAll?.("iframe") || [])].slice(0, 4).map(frame => ({ id: frame.id, cls: String(frame.className || "").slice(0, 60), visible: XXTDom.visible(frame) }));
    const siteInfo = typeof profile()?.diagnose === "function" ? profile().diagnose(item) : null;
    return {
      root: `${String(root?.tagName || "").toLowerCase()} ${attrs(root)}`.slice(0, 160),
      options,
      editors: { contenteditables, textareas, iframes },
      site: siteInfo
    };
  }

  async function apply(fingerprint, answers, pageAction) {
    const current = scan();
    if (current.fingerprint !== fingerprint || current.completed) throw new Error("题目已变化或已提交，请重新识别");
    let applied = 0;
    const failed = [];
    const details = [];
    const notes = [];
    const reasons = { EMPTY_ANSWER: "简答答案为空", EDITOR_API_ERROR: "编辑器接口调用失败", EDITOR_NOT_FOUND: "未找到可读取的简答编辑器", EDITOR_CONTENT_MISMATCH: "编辑器接口读回的正文与答案不一致", EDITOR_DOM_MISMATCH: "编辑区正文缺失或不一致", SYNC_FIELD_MISMATCH: "简答提交字段尚未同步", CHOICE_STATE_MISMATCH: "选项提交状态未通过校验", ANSWER_SHAPE_MISMATCH: "题目或答案结构不匹配" };
    for (const answer of answers) {
      const item = current.items.find(candidate => candidate.id === answer.id);
      if (!item || !Array.isArray(answer.answer) || !answer.answer.length || (item.type !== "short" && answer.answer.some(key => !item.options.some(option => option.key === key))) || (item.type !== "multiple" && answer.answer.length !== 1)) {
        failed.push(answer.id);
        details.push({ id: answer.id, ok: false, code: "ANSWER_SHAPE_MISMATCH", reason: reasons.ANSWER_SHAPE_MISMATCH });
        continue;
      }
      let verification;
      if (item.type === "short") {
        try { verification = await fillEditor(item, answer, pageAction); }
        catch { verification = { ok: false, code: "EDITOR_API_ERROR" }; }
      } else {
        verification = await fillChoice(item, answer, fingerprint);
      }
      if (verification.ok) applied++; else failed.push(item.id);
      const detail = { id: item.id, type: item.type, ...verification, reason: verification.ok ? "已通过" : reasons[verification.code] || "填写状态未通过校验" };
      if (!verification.ok) detail.dom = describeDom(item);
      details.push(detail);
      notes.push({ root: item.root, answer });
    }
    /* AI 答案提示放在全部校验之后追加，避免影响通用题目的题干/指纹识别。 */
    for (const { root, answer } of notes) {
      if (!root?.isConnected) continue;
      let note = root.querySelector(".xxt-ai-explanation");
      if (!note) {
        note = document.createElement("p");
        note.className = "xxt-ai-explanation";
        note.style.cssText = "padding:10px;color:#204477;background:#eef4fc;white-space:pre-wrap";
        root.append(note);
      }
      note.textContent = `AI 答案：${answer.answer.join("、")}。${answer.reason || ""}`;
      note.style.fontFamily = '"Microsoft YaHei",sans-serif';
    }
    return { applied, failed, details, total: current.total, unsupported: current.unsupported };
  }

  /* ---------------- page-level evidence ---------------- */
  function confirmation() {
    const candidates = document.querySelectorAll('#popok,button,a,input[type="button"],input[type="submit"],[role="button"],[onclick],span,div');
    for (const leaf of candidates) {
      const label = compact(leaf.value || leaf.textContent).replace(/\s/g, "");
      if (!/^(确定|确认|提交|确认提交|确定提交)$/.test(label) || !XXTDom.visible(leaf) || leaf.closest(".singleQuesId,.TiMu,.xxt-ai-explanation,#xxt-player-assistant")) continue;
      const button = leaf.closest('button,a,input,[role="button"],[onclick]') || leaf;
      if (!XXTDom.visible(button)) continue;
      let dialog = button.parentElement;
      for (let depth = 0; dialog && depth < 7; depth++, dialog = dialog.parentElement) {
        if (dialog === document.body || dialog === document.documentElement) break;
        if (!XXTDom.visible(dialog)) continue;
        const text = compact(dialog.innerText);
        if (text.length > 600 || dialog.querySelector(".singleQuesId,.TiMu,video")) break;
        if (!/提交/.test(text) || !/确认|确定|是否|不可修改|不能修改/.test(text) || /未答|未完成|验证码|滑块|人脸/.test(text)) continue;
        const ready = !XXTDom.isDisabled(button) && getComputedStyle(button).pointerEvents !== "none";
        return { dialog, button, ready };
      }
    }
    return null;
  }
  function continuation() {
    const media = [...document.querySelectorAll('video,iframe[src*="/ananas/modules/video/"]')].filter(XXTDom.visible);
    if (!media.length) return null;
    const controls = 'button,a,[role="button"],input[type="button"],span,div';
    const label = el => compact(el.value || el.textContent || el.getAttribute("aria-label")).replace(/\s/g, "");
    for (const el of document.querySelectorAll(controls)) {
      if (!XXTDom.visible(el) || el.closest("#xxt-player-assistant,#coursetree,.singleQuesId,.TiMu,.xxt-ai-explanation")) continue;
      if (!/^(继续学习|继续播放|继续观看|继续)$/.test(label(el)) || [...el.querySelectorAll(controls)].some(child => /^(继续学习|继续播放|继续观看|继续)$/.test(label(child)))) continue;
      let hidden = false;
      for (let parent = el; parent; parent = parent.parentElement) {
        if (parent.hidden || parent.getAttribute("aria-hidden") === "true" || getComputedStyle(parent).opacity === "0") { hidden = true; break; }
      }
      if (hidden) continue;
      const wrapper = el.closest(".video-js,.ans-video-player,[data-vjs-player]");
      const rect = el.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      if (media.some(video => {
        if (wrapper?.contains(video)) return true;
        const box = video.getBoundingClientRect();
        return x >= box.left - 24 && x <= box.right + 24 && y >= box.top - 24 && y <= box.bottom + 24;
      })) return el;
    }
    return null;
  }
  function blocker(allowConfirmation = false) {
    const caps = site()?.capabilities || {};
    if (continuation()) return "播放器要求确认继续学习；请先手动点击原播放器的“继续学习”，再点助手开始";
    for (const el of document.querySelectorAll('[role="alert"],.risk-warning,.study-warning,.error-message,.alert-danger,.warnTip')) {
      if (!XXTDom.visible(el) || el.closest(".singleQuesId,.TiMu,.xxt-ai-explanation,#xxt-player-assistant")) continue;
      const text = compact(el.innerText);
      if (text.length < 500 && /违规学习|异常学习|账号.{0,12}冻结|手动完成当前任务|检测到.{0,20}脚本|禁止使用.{0,20}插件/.test(text)) return "检测到平台风险提示，请手动处理";
    }
    const captchaSelector = '[role="dialog"],.layui-layer,.maskDiv.jobFinishTip,.vjs-modal-dialog,.ans-videoquiz,.ans-quiz,.yidun_popup,.geetest_panel,.validateBox,#validate,#captcha,[class*="captcha"],[class*="slider-verify"],[class*="verify-box"]';
    const confirm = allowConfirmation ? confirmation() : null;
    for (const el of document.querySelectorAll(captchaSelector)) {
      if (!XXTDom.visible(el)) continue;
      const text = compact(el.innerText);
      if (el.matches('.yidun_popup,.geetest_panel,.validateBox,#validate,#captcha,[class*="captcha"],[class*="slider-verify"],[class*="verify-box"]') || text.length < 800 && /验证码|滑块|人脸|身份验证|安全验证|异常学习/.test(text)) return "检测到验证提示";
      if (!caps.blockerDialogs) continue;
      if (confirm && (el === confirm.dialog || el.contains(confirm.dialog) || confirm.dialog.contains(el))) continue;
      if (!el.matches(".ans-videoquiz,.maskDiv.jobFinishTip") && el.querySelector(".singleQuesId,.TiMu,[data-question-id],.question-item")) continue;
      if (el.matches(".maskDiv.jobFinishTip") || text.length < 1000 && /任务.*未完成|未完成.*任务|尚未作答|还有.*未答/.test(text)) return "检测到未完成任务提示";
      if (el.matches(".ans-videoquiz") || el.matches(".ans-quiz") && document.querySelector("video")) return "检测到视频互动题";
      if (el.matches('.layui-layer,[role="dialog"]') && text) return "检测到弹窗，请先处理";
    }
    return "";
  }

  function submitButton() {
    const current = profile();
    if (typeof current?.submitButtons === "function") {
      const list = current.submitButtons();
      if (list.length) return list[0];
    }
    const pattern = /^(提交|提交作业|提交答案|提交试卷|交卷|保存并提交|确认提交|提交测试)$/;
    const label = el => compact(el.value || el.textContent);
    const candidates = [...document.querySelectorAll('button,a,input[type="button"],input[type="submit"],[role="button"],.btn,.button')]
      .filter(el => XXTDom.visible(el) && !XXTDom.isDisabled(el) && pattern.test(label(el)) && !el.closest("#xxt-player-assistant,.xxt-ai-explanation"));
    const outside = candidates.filter(el => !el.closest(".singleQuesId,.TiMu,[data-question-id],.question-item,[class*='question']"));
    const pool = outside.length ? outside : candidates;
    if (pool.length === 1) return pool[0];
    if (pool.length > 1) {
      const exact = pool.filter(el => /^(提交|交卷)$/.test(label(el)) && !el.closest('[role="dialog"],.layui-layer'));
      if (exact.length) return exact[0];
      throw new Error("找到多个可能的提交按钮，请手动提交");
    }
    throw new Error("未找到章节测验提交按钮");
  }
  async function submit(fingerprint, answers, pageAction, canContinue) {
    const current = scan();
    if (current.completed) return { alreadySubmitted: true };
    if (current.fingerprint !== fingerprint || current.unsupported || current.total !== answers.length || !current.items.every(item => matches(item, answers.find(answer => answer.id === item.id)))) {
      throw new Error("仍有题目未填写或填写未验证，已停止提交");
    }
    const button = submitButton();
    if (!canContinue()) throw new Error("自动流程已暂停");
    const result = await pageAction("submit", button, "");
    if (!result.ok) throw new Error(result.error || "提交动作未执行");
    const completed = scan().completed;
    return { clicked: true, completed, awaitingConfirmation: !completed, paused: !canContinue() };
  }
  async function confirmPending(pageAction, canContinue) {
    const confirm = confirmation();
    if (!confirm || !confirm.ready) return { confirmed: false, pending: !!confirm };
    if (!canContinue()) return { confirmed: false, paused: true };
    const result = await pageAction("confirm", confirm.button, "");
    if (!result.ok) throw new Error(result.error || "确认提交未执行");
    return { confirmed: true, alreadyHandled: !!result.alreadyHandled };
  }

  globalThis.XXTQuiz = Object.freeze({ scan, read, apply, submit, confirmPending, confirmation, continuation, blocker, hash });
})();
