(() => {
  "use strict";
  const compact = text => String(text || "").replace(/\s+/g, " ").trim();
  const visible = el => !!el?.isConnected && getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden" && el.getClientRects().length > 0;
  function hash(text) {
    let value = 2166136261;
    for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
    return (value >>> 0).toString(16);
  }
  function editorFor(root) {
    const editable = [...root.querySelectorAll('[contenteditable="true"]')].find(visible);
    if (editable) return { kind:'rich', el:editable };
    for (const frame of root.querySelectorAll('iframe')) {
      if (!visible(frame)) continue;
      try {
        const doc = frame.contentDocument;
        const body = doc?.body;
        if (body && (body.isContentEditable || doc.designMode === 'on' || frame.closest('.edui-editor,.cke,.tox-tinymce') || /ueditor|editor/i.test(frame.id))) return {kind:'rich',el:body};
      } catch { /* A cross-origin editor requires separate adaptation. */ }
    }
    const textarea = [...root.querySelectorAll('textarea')].find(el => visible(el) && !el.disabled && !el.readOnly);
    return textarea ? {kind:'textarea',el:textarea} : null;
  }
  const readEditor = editor => String(editor ? editor.kind === 'textarea' ? editor.el.value : editor.el.innerText || editor.el.textContent : '');
  function collect() {
    const candidates = [...document.querySelectorAll('.singleQuesId,.TiMu,[data-question-id],.question-item')];
    const roots = candidates.filter(el => visible(el) && !candidates.some(parent => parent !== el && parent.contains(el)));
    return roots.map((root, index) => {
      const title = root.querySelector('.Zy_TItle .fontLabel,.Zy_TItle,.newZy_TItle .fontLabel,.newZy_TItle,.question-title,.stem,h3');
      const stem = compact(title?.innerText);
      const candidates = [...root.querySelectorAll('.Zy_ulTop > li,[role="radio"],[role="checkbox"],.options > label')];
      const choices = candidates.filter(el => visible(el) && !candidates.some(parent => parent !== el && parent.contains(el)));
      const used = new Set();
      const options = choices.map((el, i) => {
        const label = el.querySelector('.num_option');
        const raw = compact(label?.getAttribute('data') || label?.textContent || el.getAttribute('data-option')).replace(/[.、．]/g, "");
        const key = /^[A-L]$/.test(raw) ? raw : String.fromCharCode(65 + i);
        const text = compact(el.querySelector('.after,.option-text')?.innerText || el.innerText).replace(new RegExp(`^${key}[.、．\\s]+`), "");
        if (used.has(key)) return null;
        used.add(key);
        return { key, text, el };
      }).filter(Boolean);
      const qtype = choices[0]?.getAttribute('qtype');
      const editor = editorFor(root);
      const type = /简答|论述|问答|名词解释/.test(stem) && !options.length ? 'short'
        : /填空|编程|上传|连线|排序/.test(stem) && !options.length ? 'unsupported'
        : !options.length && editor ? 'short'
        : /多选/.test(stem) || qtype === "1" || choices.some(el => el.matches('[role="checkbox"]') || el.querySelector('input[type="checkbox"]')) ? "multiple"
        : /判断/.test(stem) || qtype === "3" ? "judge" : "single";
      const encrypted=!!globalThis.XXTQuestionImage && [title,...choices].some(el=>XXTQuestionImage.encrypted(el));
      return { root, title, id: `q${index + 1}`, type, stem, options, editor, encrypted };
    });
  }
  function scan() {
    const items = collect();
    // A graded review keeps the same question classes as an editable exercise.
    // Require native answer labels, grading evidence and no writable answers;
    // model explanations and selected choices are not submission evidence.
    const nativeText = root => {
      const copy = root.cloneNode(true);
      copy.querySelectorAll('.xxt-ai-explanation,script,style').forEach(el => el.remove());
      return compact(copy.textContent);
    };
    const answerLabel = item => [...item.root.querySelectorAll('b,strong,span,dt,p,div')].some(el =>
      visible(el) && !el.closest('.xxt-ai-explanation') && /^(?:我的答案[：:]|我的答案$)/.test(compact(el.textContent)));
    const writable = item => !!item.editor || [...item.root.querySelectorAll('input:not([type="hidden"]),[role="radio"],[role="checkbox"]')].some(el =>
      visible(el) && !el.disabled && !el.readOnly && el.getAttribute('aria-disabled') !== 'true');
    const review = items.length > 0 && items.every(item => answerLabel(item) && !writable(item)) &&
      items.some(item => /(?:\d+(?:\.\d+)?\s*分|得分|待批阅|待评分|批阅中)/.test(nativeText(item.root))) &&
      ![...document.querySelectorAll('button,a,input[type="submit"],input[type="button"]')].some(el =>
        visible(el) && !el.disabled && /^(提交|提交作业|提交答案|重新提交)$/.test(compact(el.value || el.textContent)));
    const nativeStatus = [...document.querySelectorAll('.testTit_status_complete')].some(visible);
    const marker = nativeStatus || [...document.querySelectorAll('.work-status,.workStatus,.statusLabel,.mark_info,.task-status,.ans-job-finished')].some(el => visible(el) && /已完成|已提交|提交成功|作业已交/.test(el.innerText || el.getAttribute('title') || ""));
    const body = document.body?.innerText || "";
    const completion = items.length === 0 && /(?:你已完成本次作业|作业已提交|已完成该测验|本次作业已完成|提交成功)/.test(body);
    const detected = items.length > 0 || !!document.querySelector('form#form1[action*="StudentWork"],#ZyBottom,.ans-insertwork-online') || completion || nativeStatus;
    const questions = review ? [] : items.filter(q => q.stem && (q.type === 'short' || q.options.length >= 2)).map(q => ({ id: q.id, type: q.type, stem: q.stem, options: q.options.map(({key, text}) => ({key, text})),...(q.encrypted?{encrypted:true}:{}) }));
    return { detected, count: questions.length, total:items.length, unsupported: review ? 0 : items.length - questions.length,
      completed: detected && (marker || completion || review), evidence: review ? 'answer-review' : marker ? 'status-marker' : completion ? 'completion-message' : '',
      fingerprint: hash(JSON.stringify(questions)), questions, items };
  }
  async function read() {
    const current=scan();
    for(const q of current.questions) {
      if(!q.encrypted)continue;
      const item=current.items.find(item=>item.id===q.id);
      if(!item?.title)throw new Error('混淆字体题目的题干节点不完整，已停止作答');
      q.image=await XXTQuestionImage.render([{label:`题目 ${q.id}（${q.type}）`,el:item.title},...item.options.map(o=>({label:`选项 ${o.key}`,el:o.el}))]);
    }
    if(scan().fingerprint!==current.fingerprint)throw new Error('生成题目图像期间页面已变化，请重新识别');
    return {fingerprint:current.fingerprint,questions:current.questions,total:current.total,unsupported:current.unsupported};
  }
  function matches(item, answer) {
    if (!item || !Array.isArray(answer?.answer) || !answer.answer.length) return false;
    if (item.type === 'short') return answer.answer.length === 1 && typeof answer.answer[0] === 'string' && !!answer.answer[0].trim() && XXTText.normalize(readEditor(editorFor(item.root))) === XXTText.normalize(answer.answer[0]);
    return answer.answer.every(key => item.options.some(o => o.key === key)) && item.options.every(option => selected(item, option) === answer.answer.includes(option.key));
  }
  async function fillEditor(item, answer, pageAction) {
    if (answer.answer.length !== 1 || typeof answer.answer[0] !== 'string' || !answer.answer[0].trim()) return {ok:false,code:'EMPTY_ANSWER'};
    const text = answer.answer[0];
    if (pageAction) {
      const result = await pageAction('editor', item.root, text);
      if (result.ok) {
        const local=editorFor(item.root);
        return XXTText.verify(text,{editorText:result.text,domText:local?readEditor(local):result.domText,fieldFound:result.fieldFound,fieldText:result.fieldText});
      }
      if(!result.unavailable) return {ok:false,code:'EDITOR_API_ERROR'};
    }
    const editor = editorFor(item.root);
    if (!editor) return {ok:false,code:'EDITOR_NOT_FOUND'};
    if (editor.kind === 'textarea') {
      const setter = Object.getOwnPropertyDescriptor(editor.el.ownerDocument.defaultView.HTMLTextAreaElement.prototype, 'value')?.set;
      setter.call(editor.el, text);
    } else {
      editor.el.replaceChildren(...text.split(/\r?\n/).map(line => {
        const p = editor.el.ownerDocument.createElement('p'); p.textContent = line; return p;
      }));
    }
    const ViewEvent = editor.el.ownerDocument.defaultView.Event;
    for (const type of ['input','change','blur']) editor.el.dispatchEvent(new ViewEvent(type,{bubbles:true}));
    editor.el.blur();
    await new Promise(resolve => setTimeout(resolve, 100));
    const current=readEditor(editorFor(item.root));
    return XXTText.verify(text,{editorText:current,domText:current,fieldFound:editor.kind==='textarea',fieldText:editor.el.value});
  }
  function selected(item, option) {
    const qid = option.el.getAttribute('qid') || item.root.getAttribute('data') || item.root.id.replace(/^question/, "");
    const hidden = qid && document.getElementById(`answer${qid}`);
    const stored=String(hidden?.value || '').toUpperCase();
    if (hidden && /^[A-L\s,，、]*$/.test(stored)) return stored.includes(option.key);
    const input = option.el.matches('input') ? option.el : option.el.querySelector('input[type="radio"],input[type="checkbox"]');
    if (input && (visible(input) || input.checked)) return input.checked;
    if (option.el.getAttribute('aria-checked') != null) return option.el.getAttribute('aria-checked') === 'true';
    return option.el.matches('.check_answer,.check_answer_dx,.checked,.selected') || !!option.el.querySelector('.check_answer,.check_answer_dx');
  }
  async function apply(fingerprint, answers, pageAction) {
    const current = scan();
    if (current.fingerprint !== fingerprint || current.completed) throw new Error("题目已变化或已提交，请重新识别");
    let applied = 0;
    const failed = [];
    const details=[];
    const reasons={EMPTY_ANSWER:'简答答案为空',EDITOR_API_ERROR:'编辑器接口调用失败',EDITOR_NOT_FOUND:'未找到可读取的简答编辑器',EDITOR_CONTENT_MISMATCH:'编辑器接口读回的正文与答案不一致',EDITOR_DOM_MISMATCH:'编辑区正文缺失或不一致',SYNC_FIELD_MISMATCH:'简答提交字段尚未同步',CHOICE_STATE_MISMATCH:'选项提交状态未通过校验',ANSWER_SHAPE_MISMATCH:'题目或答案结构不匹配'};
    for (const answer of answers) {
      const item = current.items.find(q => q.id === answer.id);
      if (!item || !Array.isArray(answer.answer) || !answer.answer.length || (item.type !== 'short' && answer.answer.some(key => !item.options.some(o => o.key === key))) || (item.type !== 'multiple' && answer.answer.length !== 1)) { failed.push(answer.id);details.push({id:answer.id,ok:false,code:'ANSWER_SHAPE_MISMATCH',reason:reasons.ANSWER_SHAPE_MISMATCH});continue; }
      let verification;
      if (item.type === 'short') {
        try { verification=await fillEditor(item, answer, pageAction); }
        catch { verification={ok:false,code:'EDITOR_API_ERROR'}; }
      } else {
      for (const option of item.options) {
        const wanted = answer.answer.includes(option.key);
        if ((item.type === 'multiple' && wanted !== selected(item, option)) || (item.type !== 'multiple' && wanted && !selected(item, option))) {
          const input = option.el.querySelector('input[type="radio"],input[type="checkbox"]');
          (input && visible(input) ? input : option.el).click();
          await new Promise(resolve => setTimeout(resolve, 40));
        }
      }
      if(!matches(item,answer)) await new Promise(resolve=>setTimeout(resolve,150));
      verification={ok:matches(item,answer),code:matches(item,answer)?'OK':'CHOICE_STATE_MISMATCH'};
      }
      if(verification.ok) applied++;else failed.push(item.id);
      details.push({id:item.id,type:item.type,...verification,reason:verification.ok?'已通过':reasons[verification.code] || '填写状态未通过校验'});
      let note = item.root.querySelector('.xxt-ai-explanation');
      if (!note) { note = document.createElement('p'); note.className = 'xxt-ai-explanation'; note.style.cssText = 'padding:10px;color:#204477;background:#eef4fc;white-space:pre-wrap'; item.root.append(note); }
      note.textContent = `DeepSeek 答案：${answer.answer.join('、')}。${answer.reason || ''}`;
      note.style.fontFamily='"Microsoft YaHei",sans-serif';
    }
    return { applied, failed, details, total:current.total, unsupported:current.unsupported };
  }
  function confirmation() {
    // Chaoxing also renders unlabelled dialogs in the outer course frame.
    // Find an exact affirmative label, then a small nearby confirmation context;
    // never search a whole chapter or infer a button from array position.
    const candidates = document.querySelectorAll('#popok,button,a,input[type="button"],input[type="submit"],[role="button"],[onclick],span,div');
    for (const leaf of candidates) {
      const label=compact(leaf.value || leaf.textContent).replace(/\s/g,'');
      if (!/^(确定|确认|提交|确认提交|确定提交)$/.test(label) || !visible(leaf) || leaf.closest('.singleQuesId,.TiMu,.xxt-ai-explanation,#xxt-player-assistant')) continue;
      const button=leaf.closest('button,a,input,[role="button"],[onclick]') || leaf;
      if (!visible(button)) continue;
      let dialog=button.parentElement;
      for(let depth=0;dialog && depth<7;depth++,dialog=dialog.parentElement) {
        if(dialog===document.body || dialog===document.documentElement) break;
        if(!visible(dialog)) continue;
        const text=compact(dialog.innerText);
        if(text.length>600 || dialog.querySelector('.singleQuesId,.TiMu,video')) break;
        if(!/提交/.test(text) || !/确认|确定|是否|不可修改|不能修改/.test(text) || /未答|未完成|验证码|滑块|人脸/.test(text)) continue;
        const ready=!button.disabled && !button.hasAttribute('disabled') && button.getAttribute('aria-disabled')!=='true' && !button.matches('.disabled,.btnDisabled') && getComputedStyle(button).pointerEvents!=='none';
        return {dialog,button,ready};
      }
    }
    return null;
  }
  function continuation() {
    const media = [...document.querySelectorAll('video,iframe[src*="/ananas/modules/video/"]')].filter(visible);
    if (!media.length) return null;
    const controls='button,a,[role="button"],input[type="button"],span,div';
    const label=el=>compact(el.value || el.textContent || el.getAttribute('aria-label')).replace(/\s/g,'');
    for (const el of document.querySelectorAll(controls)) {
      if (!visible(el) || el.closest('#xxt-player-assistant,#coursetree,.singleQuesId,.TiMu,.xxt-ai-explanation')) continue;
      if (label(el) !== '继续学习' || [...el.querySelectorAll(controls)].some(child=>label(child)==='继续学习')) continue;
      let hidden=false;
      for(let parent=el;parent;parent=parent.parentElement) {
        if(parent.hidden || parent.getAttribute('aria-hidden')==='true' || getComputedStyle(parent).opacity==='0') {hidden=true;break;}
      }
      if(hidden) continue;
      // A similarly named course link is not the player's acknowledgement.
      // Associate the control with a known player or its visible media bounds.
      const wrapper=el.closest('.video-js,.ans-video-player,[data-vjs-player]');
      const rect=el.getBoundingClientRect(),x=rect.left+rect.width/2,y=rect.top+rect.height/2;
      if(media.some(video=>{
        if(wrapper?.contains(video)) return true;
        const box=video.getBoundingClientRect();
        return x>=box.left-24 && x<=box.right+24 && y>=box.top-24 && y<=box.bottom+24;
      })) return el;
    }
    return null;
  }
  function blocker(allowConfirmation = false) {
    if(continuation()) return '播放器要求确认继续学习；请先手动点击原播放器的“继续学习”，再点助手开始';
    for (const el of document.querySelectorAll('[role="alert"],.risk-warning,.study-warning,.error-message,.alert-danger,.warnTip')) {
      if (!visible(el) || el.closest('.singleQuesId,.TiMu,.xxt-ai-explanation')) continue;
      const text=compact(el.innerText);
      if(text.length < 500 && /违规学习|异常学习|账号.{0,12}冻结|手动完成当前任务|检测到.{0,20}脚本|禁止使用.{0,20}插件/.test(text)) return '检测到平台风险提示，请手动处理';
    }
    const selector = '[role="dialog"],.layui-layer,.maskDiv.jobFinishTip,.vjs-modal-dialog,.ans-videoquiz,.ans-quiz,.yidun_popup,.geetest_panel,.validateBox,#validate,#captcha';
    const confirm = allowConfirmation ? confirmation() : null;
    for (const el of document.querySelectorAll(selector)) {
      if (!visible(el)) continue;
      const text = compact(el.innerText);
      if (el.matches('.yidun_popup,.geetest_panel,.validateBox,#validate,#captcha') || text.length < 800 && /验证码|滑块|人脸|身份验证|安全验证|异常学习/.test(text)) return '检测到验证提示';
      if (confirm && (el === confirm.dialog || el.contains(confirm.dialog) || confirm.dialog.contains(el))) continue;
      // A normal chapter quiz is not a popup, even if its wrapper is named ans-quiz.
      if (!el.matches('.ans-videoquiz,.maskDiv.jobFinishTip') && el.querySelector('.singleQuesId,.TiMu,[data-question-id],.question-item')) continue;
      if (el.matches('.maskDiv.jobFinishTip') || text.length < 1000 && /任务.*未完成|未完成.*任务|尚未作答|还有.*未答/.test(text)) return '检测到未完成任务提示';
      if (el.matches('.ans-videoquiz') || el.matches('.ans-quiz') && document.querySelector('video')) return '检测到视频互动题';
      if (el.matches('.layui-layer,[role="dialog"]') && text) return '检测到弹窗，请先处理';
    }
    return '';
  }
  async function submit(fingerprint, answers, pageAction, canContinue) {
    const current = scan();
    if (current.completed) return {alreadySubmitted:true};
    if (current.fingerprint !== fingerprint || current.unsupported || current.total !== answers.length || !current.items.every(item => matches(item,answers.find(a => a.id === item.id)))) throw new Error('仍有题目未填写或填写未验证，已停止提交');
    const button = [...document.querySelectorAll('#ZyBottom button,#ZyBottom a,[onclick*="btnBlueSubmit"],button,a,input[type="button"],input[type="submit"]')].find(el => visible(el) && !el.disabled && /^(提交|提交作业|提交答案)$/.test(compact(el.value || el.textContent)) && !el.closest('.xxt-ai-explanation'));
    if (!button) throw new Error('未找到章节测验提交按钮');
    if (!canContinue()) throw new Error('自动流程已暂停');
    const result = await pageAction('submit',button,'');
    if (!result.ok) throw new Error(result.error || '提交动作未执行');
    // Return immediately: timers can be clamped in background tabs. The normal
    // per-frame reports and coordinator own all subsequent confirmation checks.
    const completed=scan().completed;
    return {clicked:true,completed,awaitingConfirmation:!completed,paused:!canContinue()};
  }
  async function confirmPending(pageAction,canContinue) {
    const confirm=confirmation();
    if(!confirm || !confirm.ready) return {confirmed:false,pending:!!confirm};
    if(!canContinue()) return {confirmed:false,paused:true};
    const result=await pageAction('confirm',confirm.button,'');
    if(!result.ok) throw new Error(result.error || '确认提交未执行');
    return {confirmed:true,alreadyHandled:!!result.alreadyHandled};
  }
  globalThis.XXTQuiz = Object.freeze({ scan, read, apply, submit, confirmPending, confirmation, continuation, blocker, hash });
})();
