/* A readable article is a navigation hint, never proof of platform completion. */
(() => {
  'use strict';
  const visible=el=>!!el?.isConnected && getComputedStyle(el).display!=='none' && getComputedStyle(el).visibility!=='hidden' && el.getClientRects().length>0;
  function rendered(el) {
    if(!visible(el))return false;
    const rect=el.getBoundingClientRect();
    if(rect.width<2 || rect.height<2)return false;
    for(let node=el;node;node=node.parentElement) {
      const css=node.ownerDocument.defaultView.getComputedStyle(node);
      if(node.hidden || node.getAttribute('aria-hidden')==='true' || css.display==='none' || css.visibility==='hidden' || css.opacity==='0')return false;
    }
    return true;
  }
  function taskState(root,icons) {
    const labels=icons.flatMap(icon=>[icon.textContent,icon.getAttribute('title'),icon.getAttribute('aria-label')]).map(value=>(value || '').replace(/\s+/g,''));
    const explicitPending=labels.some(value=>/^(?:任务点未完成|任务点尚未完成|未完成|待完成)$/.test(value));
    const nativeFinished=root.classList.contains('ans-job-finished') || icons.some(icon=>icon.classList.contains('ans-job-finished'));
    const labelFinished=labels.some(value=>/^任务点(?:已|已经)完成$/.test(value));
    const status=explicitPending?'pending':nativeFinished||labelFinished?'completed':labels.includes('任务点')?'pending':'unknown';
    return {status,evidence:status==='completed'?(nativeFinished?'native-finished':'task-label'):''};
  }
  function frameShown() {
    try {
      let view=window;
      while(view!==view.top) {
        const frame=view.frameElement;
        if(!frame)break;
        if(!rendered(frame))return false;
        view=frame.ownerDocument.defaultView;
      }
    } catch { /* Cross-origin ancestors cannot be inspected here. */ }
    return true;
  }
  function tasks() {
    const excluded='nav,#coursetree,#xxt-player-assistant,.xxt-ai-explanation,.singleQuesId,.TiMu,[data-question-id],.question-item,[role="dialog"]';
    const groups=new Map();
    for(const icon of frameShown()?document.querySelectorAll('.ans-job-icon'):[]) {
      if(!rendered(icon) || icon.closest(excluded))continue;
      const root=icon.closest('.ans-attach-ct') || icon.parentElement;
      if(!root || root.closest(excluded))continue;
      if(!groups.has(root))groups.set(root,[]);
      groups.get(root).push(icon);
    }
    for(const root of frameShown()?document.querySelectorAll('.ans-attach-ct.ans-job-finished'):[]) {
      if(rendered(root) && !root.closest(excluded) && !groups.has(root) && root.querySelector('video,iframe,.ans-cc,.ans-richtext'))groups.set(root,[]);
    }
    const states=[];
    for(const [root,icons] of groups) {
      const {status,evidence}=taskState(root,icons);
      const video=!!root.querySelector('video,iframe[src*="/ananas/modules/video/"]');
      states.push({status,video,evidence});
    }
    const done=states.filter(item=>item.status==='completed').length;
    return {detected:states.length>0,completed:states.length>0 && done===states.length,total:states.length,done,
      pending:states.filter(item=>item.status==='pending').length,unknown:states.filter(item=>item.status==='unknown').length,
      videoTasks:states.filter(item=>item.video).length,evidence:[...new Set(states.map(item=>item.evidence).filter(Boolean))],
      signature:globalThis.XXTQuiz?.hash(JSON.stringify(states)) || ''};
  }
  function resources(roots) {
    const counts={inspected:0,ignoredHidden:0,ignoredEmpty:0,ignoredImages:0,ignoredOutside:0,ignoredUnclassified:0,ignoredCompleted:0};
    const blockers=[];
    for(const el of document.querySelectorAll('video,audio,object,embed,iframe')) {
      const tag=el.tagName.toLowerCase(),type=(el.getAttribute('type') || '').toLowerCase();
      const source=(el.getAttribute(tag==='object'?'data':'src') || (tag==='object'?el.querySelector('param[name="movie"]')?.getAttribute('value'):'') || '').trim();
      let path='';try{path=new URL(source,document.baseURI).pathname;}catch{ /* No usable path. */ }
      const module=/\/ananas\/modules\/(video|audio|pdf|ppt|book)\//i.exec(path)?.[1]?.toLowerCase();
      const pdf=type==='application/pdf' || /\.pdf$/i.test(path);
      if(tag==='iframe' && !module && !pdf && el.id!=='panView')continue;
      counts.inspected++;
      const attachment=el.closest('.ans-attach-ct');
      const icons=attachment?[...attachment.querySelectorAll('.ans-job-icon')].filter(icon=>icon.closest('.ans-attach-ct')===attachment && rendered(icon)):[];
      if(attachment && taskState(attachment,icons).status==='completed') {counts.ignoredCompleted++;continue;}
      if(!rendered(el)) {counts.ignoredHidden++;continue;}
      if(!pdf && (/^image\//.test(type) || /^data:image\//i.test(source) || /\.(?:png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i.test(path))) {counts.ignoredImages++;continue;}
      if(!['video','audio'].includes(tag) && (!source || /^(?:about:blank(?:[#?].*)?|javascript:.*)$/i.test(source))) {counts.ignoredEmpty++;continue;}
      const inLesson=roots.some(root=>root===el || root.contains(el));
      if(['object','embed'].includes(tag) && !pdf && !module && !inLesson && !attachment?.querySelector('.ans-job-icon')) {counts.ignoredOutside++;continue;}
      const typedMedia=/^(?:video|audio)\//.test(type) || /flash|shockwave/.test(type) || /\.(?:mp4|webm|mp3|wav|m4a|ogg|swf)$/i.test(path);
      if(['object','embed'].includes(tag) && !pdf && !module && !typedMedia && !attachment?.querySelector('.ans-job-icon')) {counts.ignoredUnclassified++;continue;}
      const kind=module?`${module}-frame`:pdf?`pdf-${tag}`:tag==='iframe'?'document-frame':tag==='video'||tag==='audio'?tag:'embedded-content';
      blockers.push({tag,kind});
    }
    return {counts,blockers};
  }
  function scan() {
    const candidates=[...document.querySelectorAll('.ans-cc,.ans-richtext,.chapter-content,[data-content-type="richtext"]')].filter(visible);
    if(!candidates.length && /\/knowledge\/cards\/?$/.test(location.pathname) && document.body)candidates.push(document.body);
    const roots=candidates.filter(el=>!candidates.some(parent=>parent!==el && parent.contains(el)));
    let content='',images=[];
    for(const root of roots) {
      if(root.querySelector('.singleQuesId,.TiMu,[data-question-id],.question-item,form,textarea,input[type="radio"],input[type="checkbox"],[contenteditable="true"]'))continue;
      const copy=root.cloneNode(true);
      copy.querySelectorAll('script,style,nav,#coursetree,#xxt-player-assistant,.xxt-ai-explanation').forEach(el=>el.remove());
      content+=(copy.textContent || '').replace(/\s+/g,' ').trim();
      images.push(...[...root.querySelectorAll('img')].filter(visible));
    }
    const detected=content.length>=80 || content.length>=40 && images.length>0;
    const media=resources(roots);
    const mediaPending=media.blockers.length>0;
    const task=tasks();
    const pendingTasks=task.detected && !task.completed;
    const imageCounts={loaded:0,loading:0,failed:0,deferred:0};
    for(const image of images) {
      const kind=image.complete?(image.naturalWidth>0?'loaded':'failed'):image.loading==='lazy'?'deferred':'loading';
      imageCounts[kind]++;
    }
    const loadingImages=imageCounts.loading+imageCounts.failed+imageCounts.deferred>0;
    // Article illustrations are not task completion evidence or prerequisites.
    // Quiz images use the separate strict question renderer.
    const ready=detected && !mediaPending && !pendingTasks;
    return {detected,ready,chars:content.length,images:images.length,pendingTasks,mediaPending,loadingImages,imageCounts,
      mediaBlockers:media.blockers.slice(0,20),resourceCounts:media.counts,
      signature:globalThis.XXTQuiz?.hash(JSON.stringify([content,images.map(img=>img.currentSrc || img.src),ready])) || ''};
  }
  globalThis.XXTLesson=Object.freeze({scan,tasks});
})();
