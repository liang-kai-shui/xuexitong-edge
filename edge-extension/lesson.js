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
      if(attachment?.classList.contains('ans-job-finished')) {counts.ignoredCompleted++;continue;}
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
    const pendingTasks=[...document.querySelectorAll('.ans-attach-ct')].some(root=>rendered(root.querySelector('.ans-job-icon')) && !root.classList.contains('ans-job-finished'));
    const loadingImages=images.some(image=>!image.complete || image.naturalWidth===0);
    const ready=detected && !mediaPending && !pendingTasks && !loadingImages;
    return {detected,ready,chars:content.length,images:images.length,pendingTasks,mediaPending,loadingImages,
      mediaBlockers:media.blockers.slice(0,20),resourceCounts:media.counts,
      signature:globalThis.XXTQuiz?.hash(JSON.stringify([content,images.map(img=>img.currentSrc || img.src),ready])) || ''};
  }
  globalThis.XXTLesson=Object.freeze({scan});
})();
