/* Site adapter: 超星学习通 / 泛雅 / 学银在线 (Chaoxing). */
(() => {
  "use strict";
  const compact = value => XXTDom.compact(value);
  const text = el => (el?.textContent || "").replace(/\s+/g, "").trim();

  /* ---------- navigation ---------- */
  function steps() {
    const candidates = [...document.querySelectorAll('.prev_white,.prev_blue,[role="tab"]')].filter(el => XXTDom.visible(el) && text(el).length < 35);
    const tabs = candidates.filter(el => !candidates.some(parent => parent !== el && parent.contains(el)));
    let current = tabs.findIndex(el => el.matches('.prev_blue,.active,.current,.on,[aria-selected="true"]') || el.parentElement?.matches('.active,.current,.on'));
    const title = document.querySelector('.prev_title')?.getAttribute('title') || text(document.querySelector('.prev_title'));
    if (current < 0 && title) current = tabs.findIndex(el => text(el).includes(title) || (/章节测验/.test(title) && /练习|测验/.test(text(el))));
    return { tabs, current };
  }
  function catalog() {
    const nodes = [...document.querySelectorAll('#coursetree .posCatalog_select:not(.firstLayer)')];
    const current = nodes.findIndex(el => el.matches('.posCatalog_active,.active,[aria-current="true"]'));
    const node = current >= 0 ? nodes[current + 1] : null;
    return node?.querySelector('.posCatalog_name') || null;
  }
  function next(catalogOnly = false) {
    if (catalogOnly) return catalog();
    const { tabs, current } = steps();
    if (current >= 0 && current + 1 < tabs.length) return tabs[current + 1];
    const button = [...document.querySelectorAll('#prevNextFocusNext,#right1,.nextChapter,[data-action="next-chapter"]')]
      .find(el => XXTDom.visible(el) && !XXTDom.isDisabled(el));
    const semantic = [...document.querySelectorAll('button,a,[role="button"],input[type="button"]')].find(el =>
      XXTDom.visible(el) && !XXTDom.isDisabled(el) &&
      /^(下一节|下一小节|下一章节)$/.test(text(el) || el.value || '') &&
      !el.closest('.singleQuesId,.TiMu,[data-question-id],.question-item,[role="dialog"],.layui-layer,#xxt-player-assistant'));
    return button || semantic || catalog();
  }
  function videoStep() {
    const { tabs, current } = steps();
    const candidate = current >= 0 ? tabs[current + 1] : null;
    return candidate && /视频/.test(text(candidate)) ? candidate : null;
  }
  function practiceStep() {
    const { tabs, current } = steps();
    const candidate = current >= 0 ? tabs[current + 1] : null;
    return candidate && /^\d*(?:练习|章节测验|测验|章节测试|课后练习|课后测验)$/.test(text(candidate)) ? candidate : null;
  }
  const frameIds = new WeakMap();
  let sequence = 0;
  function signature() {
    const { tabs, current } = steps();
    const frames = [...document.querySelectorAll('iframe')].map(frame => {
      if (!frameIds.has(frame)) frameIds.set(frame, ++sequence);
      return `${frameIds.get(frame)}:${frame.src}`;
    });
    const selected = document.querySelector('#coursetree .posCatalog_active .posCatalog_name');
    return XXTDom.hash(JSON.stringify([location.href, current, text(tabs[current]), selected?.title || text(selected), frames]));
  }

  /* ---------- rich-text lesson (port of the original 学习通 scanner) ---------- */
  function lessonResources(roots) {
    const counts = { inspected: 0, ignoredHidden: 0, ignoredEmpty: 0, ignoredImages: 0, ignoredOutside: 0, ignoredUnclassified: 0, ignoredCompleted: 0 };
    const blockers = [];
    for (const el of document.querySelectorAll('video,audio,object,embed,iframe')) {
      const tag = el.tagName.toLowerCase(), type = (el.getAttribute('type') || '').toLowerCase();
      const source = (el.getAttribute(tag === 'object' ? 'data' : 'src') || (tag === 'object' ? el.querySelector('param[name="movie"]')?.getAttribute('value') : '') || '').trim();
      let path = ''; try { path = new URL(source, document.baseURI).pathname; } catch { /* No usable path. */ }
      const module = /\/ananas\/modules\/(video|audio|pdf|ppt|book)\//i.exec(path)?.[1]?.toLowerCase();
      const pdf = type === 'application/pdf' || /\.pdf$/i.test(path);
      if (tag === 'iframe' && !module && !pdf && el.id !== 'panView') continue;
      counts.inspected++;
      const attachment = el.closest('.ans-attach-ct');
      if (attachment?.classList.contains('ans-job-finished')) { counts.ignoredCompleted++; continue; }
      if (!XXTDom.rendered(el)) { counts.ignoredHidden++; continue; }
      if (!pdf && (/^image\//.test(type) || /^data:image\//i.test(source) || /\.(?:png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i.test(path))) { counts.ignoredImages++; continue; }
      if (!['video', 'audio'].includes(tag) && (!source || /^(?:about:blank(?:[#?].*)?|javascript:.*)$/i.test(source))) { counts.ignoredEmpty++; continue; }
      const inLesson = roots.some(root => root === el || root.contains(el));
      if (['object', 'embed'].includes(tag) && !pdf && !module && !inLesson && !attachment?.querySelector('.ans-job-icon')) { counts.ignoredOutside++; continue; }
      const typedMedia = /^(?:video|audio)\//.test(type) || /flash|shockwave/.test(type) || /\.(?:mp4|webm|mp3|wav|m4a|ogg|swf)$/i.test(path);
      if (['object', 'embed'].includes(tag) && !pdf && !module && !typedMedia && !attachment?.querySelector('.ans-job-icon')) { counts.ignoredUnclassified++; continue; }
      const kind = module ? `${module}-frame` : pdf ? `pdf-${tag}` : tag === 'iframe' ? 'document-frame' : tag === 'video' || tag === 'audio' ? tag : 'embedded-content';
      blockers.push({ tag, kind });
    }
    return { counts, blockers };
  }
  function lessonScan() {
    const candidates = [...document.querySelectorAll('.ans-cc,.ans-richtext,.chapter-content,[data-content-type="richtext"]')].filter(XXTDom.visible);
    if (!candidates.length && /\/knowledge\/cards\/?$/.test(location.pathname) && document.body) candidates.push(document.body);
    const roots = candidates.filter(el => !candidates.some(parent => parent !== el && parent.contains(el)));
    let content = '', images = [];
    for (const root of roots) {
      if (root.querySelector('.singleQuesId,.TiMu,[data-question-id],.question-item,form,textarea,input[type="radio"],input[type="checkbox"],[contenteditable="true"]')) continue;
      const copy = root.cloneNode(true);
      copy.querySelectorAll('script,style,nav,#coursetree,#xxt-player-assistant,.xxt-ai-explanation').forEach(el => el.remove());
      content += (copy.textContent || '').replace(/\s+/g, ' ').trim();
      images.push(...[...root.querySelectorAll('img')].filter(XXTDom.visible));
    }
    const detected = content.length >= 80 || content.length >= 40 && images.length > 0;
    const media = lessonResources(roots);
    const mediaPending = media.blockers.length > 0;
    const pendingTasks = [...document.querySelectorAll('.ans-attach-ct')].some(root => XXTDom.rendered(root.querySelector('.ans-job-icon')) && !root.classList.contains('ans-job-finished'));
    const loadingImages = images.some(image => !image.complete || image.naturalWidth === 0);
    const ready = detected && !mediaPending && !pendingTasks && !loadingImages;
    return { detected, ready, chars: content.length, images: images.length, pendingTasks, mediaPending, loadingImages,
      mediaBlockers: media.blockers.slice(0, 20), resourceCounts: media.counts,
      signature: XXTDom.hash(JSON.stringify([content, images.map(img => img.currentSrc || img.src), ready])) };
  }

  /* ---------- chapter quiz (port of the original 学习通 scanner) ---------- */
  function collect() {
    const candidates = [...document.querySelectorAll('.singleQuesId,.TiMu,[data-question-id],.question-item')];
    const roots = candidates.filter(el => XXTDom.visible(el) && !candidates.some(parent => parent !== el && parent.contains(el)));
    return roots.map((root, index) => {
      const title = root.querySelector('.Zy_TItle .fontLabel,.Zy_TItle,.newZy_TItle .fontLabel,.newZy_TItle,.question-title,.stem,h3');
      const stem = compact(title?.innerText);
      const candidates = [...root.querySelectorAll('.Zy_ulTop > li,[role="radio"],[role="checkbox"],.options > label')];
      const choices = candidates.filter(el => XXTDom.visible(el) && !candidates.some(parent => parent !== el && parent.contains(el)));
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
      const editor = XXTDom.editorFor(root);
      const type = /简答|论述|问答|名词解释/.test(stem) && !options.length ? 'short'
        : /填空|编程|上传|连线|排序/.test(stem) && !options.length ? 'unsupported'
        : !options.length && editor ? 'short'
        : /多选/.test(stem) || qtype === "1" || choices.some(el => el.matches('[role="checkbox"]') || el.querySelector('input[type="checkbox"]')) ? "multiple"
        : /判断/.test(stem) || qtype === "3" ? "judge" : "single";
      const encrypted = !!globalThis.XXTQuestionImage && [title, ...choices].some(el => XXTQuestionImage.encrypted(el));
      return { root, title, id: `q${index + 1}`, type, stem, options, editor, encrypted };
    });
  }
  function extras(items) {
    const nativeText = root => {
      const copy = root.cloneNode(true);
      copy.querySelectorAll('.xxt-ai-explanation,script,style').forEach(el => el.remove());
      return compact(copy.textContent);
    };
    const answerLabel = item => [...item.root.querySelectorAll('b,strong,span,dt,p,div')].some(el =>
      XXTDom.visible(el) && !el.closest('.xxt-ai-explanation') && /^(?:我的答案[：:]|我的答案$)/.test(compact(el.textContent)));
    const writable = item => !!item.editor || [...item.root.querySelectorAll('input:not([type="hidden"]),[role="radio"],[role="checkbox"]')].some(el =>
      XXTDom.visible(el) && !el.disabled && !el.readOnly && el.getAttribute('aria-disabled') !== 'true');
    const review = items.length > 0 && items.every(item => answerLabel(item) && !writable(item)) &&
      items.some(item => /(?:\d+(?:\.\d+)?\s*分|得分|待批阅|待评分|批阅中)/.test(nativeText(item.root))) &&
      ![...document.querySelectorAll('button,a,input[type="submit"],input[type="button"]')].some(el =>
        XXTDom.visible(el) && !el.disabled && /^(提交|提交作业|提交答案|重新提交)$/.test(compact(el.value || el.textContent)));
    const nativeStatus = [...document.querySelectorAll('.testTit_status_complete')].some(XXTDom.visible);
    const marker = nativeStatus || [...document.querySelectorAll('.work-status,.workStatus,.statusLabel,.mark_info,.task-status,.ans-job-finished')].some(el => XXTDom.visible(el) && /已完成|已提交|提交成功|作业已交/.test(el.innerText || el.getAttribute('title') || ""));
    const body = document.body?.innerText || "";
    const completion = items.length === 0 && /(?:你已完成本次作业|作业已提交|已完成该测验|本次作业已完成|提交成功)/.test(body);
    const detectedExtra = !!document.querySelector('form#form1[action*="StudentWork"],#ZyBottom,.ans-insertwork-online') || nativeStatus;
    return { review, nativeStatus, marker, completion, detectedExtra };
  }
  function submitButtons() {
    const buttons = [...document.querySelectorAll('#ZyBottom button,#ZyBottom a,[onclick*="btnBlueSubmit"]')]
      .filter(el => XXTDom.visible(el) && !XXTDom.isDisabled(el) && /^(提交|提交作业|提交答案)$/.test(compact(el.value || el.textContent)));
    if (buttons.length) return buttons;
    return [...document.querySelectorAll('button,a,input[type="button"],input[type="submit"]')]
      .filter(el => XXTDom.visible(el) && !XXTDom.isDisabled(el) &&
        /^(提交|提交作业|提交答案)$/.test(compact(el.value || el.textContent)) &&
        !el.closest('.xxt-ai-explanation') &&
        !el.closest('.singleQuesId,.TiMu,[data-question-id],.question-item'));
  }
  function hiddenAnswer(item, option) {
    const qid = option.el.getAttribute('qid') || item.root.getAttribute('data') || item.root.id.replace(/^question/, "");
    const hidden = qid && document.getElementById(`answer${qid}`);
    if (!hidden) return null;
    const stored = String(hidden.value || '').toUpperCase();
    if (!/^[A-L\s,，、]*$/.test(stored)) return null;
    /* 新版作业页的 #answer 输入框可能只在提交时同步，选择过程中一直是空值；
       空值不能当作“未选中”的权威结论，交给输入框/类名等视觉状态判断。 */
    if (!stored.trim()) return null;
    return stored.includes(option.key);
  }
  /* 填写失败时附带精简的站点结构信息，便于复制诊断后定位新版 DOM。 */
  function diagnose(item) {
    const qid = item.root?.getAttribute?.('data') || item.root?.id?.replace(/^question/, '') || '';
    const hidden = qid ? document.getElementById(`answer${qid}`) : null;
    return {
      qid: String(qid).slice(0, 30),
      rootId: String(item.root?.id || '').slice(0, 40),
      rootClass: String(item.root?.className || '').slice(0, 80),
      hiddenAnswer: hidden ? String(hidden.value || '').slice(0, 20) : null,
      hiddenFound: !!hidden
    };
  }

  XXTSites.register({
    id: "chaoxing",
    name: "超星学习通",
    hosts: ["chaoxing.com", "chaoxing.cn", "xueyinonline.com"],
    urlHints: [/\/mycourse\//i, /\/knowledge\/cards\b/i, /\/visit\/interaction\b/i, /[?&](?:courseId|courseid|clazzid)=\d+/i],
    capabilities: { quiz: "full", autoSubmit: true, lesson: true, practiceStep: true, catalog: true, blockerDialogs: true },
    nav: { steps, next, videoStep, practiceStep, signature, catalog, isCatalogTarget: el => !!el?.matches("#coursetree .posCatalog_name") },
    lesson: { scan: lessonScan },
    quiz: { id: "chaoxing", collect, extras, submitButtons, hiddenAnswer, diagnose },
    messages: { catalogHint: "请手动选择目录", nextHint: "未找到可用的下一步或下一节按钮，请手动选择目录" }
  });
})();
