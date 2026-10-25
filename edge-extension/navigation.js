(() => {
  "use strict";
  const visible = el => !!el?.isConnected && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length > 0;
  const text = el => (el?.textContent || '').replace(/\s+/g, '').trim();
  function steps() {
    const candidates = [...document.querySelectorAll('.prev_white,.prev_blue,[role="tab"]')].filter(el => visible(el) && text(el).length < 35);
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
    const button = [...document.querySelectorAll('#prevNextFocusNext,#right1,.nextChapter,[data-action="next-chapter"]')].find(el => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
    const semantic = [...document.querySelectorAll('button,a,[role="button"],input[type="button"]')].find(el =>
      visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true' &&
      /^(下一节|下一小节|下一章节)$/.test(text(el) || el.value || '') &&
      !el.closest('.singleQuesId,.TiMu,[data-question-id],.question-item,[role="dialog"],.layui-layer,#xxt-player-assistant'));
    return button || semantic || catalog();
  }
  function videoStep() {
    const { tabs, current } = steps();
    const next=current>=0?tabs[current+1]:null;
    return next && /视频/.test(text(next))?next:null;
  }
  function practiceStep() {
    const {tabs,current}=steps();
    const candidate=current>=0?tabs[current+1]:null;
    return candidate && /^\d*(?:练习|章节测验|测验|章节测试|课后练习|课后测验)$/.test(text(candidate))?candidate:null;
  }
  const frameIds = new WeakMap();
  let sequence = 0;
  function signature() {
    const { tabs, current } = steps();
    const frames = [...document.querySelectorAll('iframe')].map(f => {
      if (!frameIds.has(f)) frameIds.set(f, ++sequence);
      return `${frameIds.get(f)}:${f.src}`;
    });
    const selected = document.querySelector('#coursetree .posCatalog_active .posCatalog_name');
    return XXTQuiz.hash(JSON.stringify([location.href, current, text(tabs[current]), selected?.title || text(selected), frames]));
  }
  globalThis.XXTNavigation = Object.freeze({ steps, next, videoStep, practiceStep, signature });
})();
