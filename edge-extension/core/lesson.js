/* Lesson/reading-page detection. Platform adapters can provide an exact
 * scanner (学习通 does); other sites get a conservative read-only heuristic.
 * A readable article is a navigation hint, never proof of platform completion. */
(() => {
  "use strict";
  const site = () => XXTSites.current();
  function genericScan() {
    const quizInside = el => !!el.querySelector(".singleQuesId,.TiMu,[data-question-id],.question-item,[class*='question'],form textarea,form input[type='radio'],form input[type='checkbox']");
    const candidates = [...document.querySelectorAll('article,main,[class*="article"],[class*="richtext"],[class*="rich-text"],[class*="content-body"],[class*="markdown-body"],[data-content-type="richtext"]')]
      .filter(el => XXTDom.visible(el) && !el.closest('#xxt-player-assistant') && !el.querySelector('video,audio') && !quizInside(el));
    const roots = candidates.filter(el => !candidates.some(other => other !== el && el.contains(other)));
    let best = null, bestChars = 0;
    for (const root of roots) {
      const copy = root.cloneNode(true);
      copy.querySelectorAll("script,style,nav,header,footer,#xxt-player-assistant").forEach(node => node.remove());
      const chars = (copy.textContent || "").replace(/\s+/g, " ").trim().length;
      if (chars > bestChars) { bestChars = chars; best = root; }
    }
    const images = best ? [...best.querySelectorAll("img")].filter(XXTDom.visible) : [];
    const detected = bestChars >= 80 || bestChars >= 40 && images.length > 0;
    const loadingImages = images.some(image => !image.complete || image.naturalWidth === 0);
    return { detected, ready: false, chars: bestChars, images: images.length, pendingTasks: false, mediaPending: false,
      loadingImages, mediaBlockers: [], resourceCounts: {},
      signature: XXTDom.hash(JSON.stringify([location.href, bestChars, images.length])) };
  }
  function scan() {
    const adapter = site();
    if (typeof adapter?.lesson?.scan === "function") return adapter.lesson.scan();
    return genericScan();
  }
  globalThis.XXTLesson = Object.freeze({ scan });
})();
