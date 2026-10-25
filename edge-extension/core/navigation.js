/* Navigation engine. Uses the active site adapter when it provides a
 * platform-specific implementation, otherwise falls back to semantic detection
 * ("下一节/下一课/下一页", step tabs, chapter tree) so new platforms work
 * without code changes. */
(() => {
  "use strict";
  const site = () => XXTSites.current();
  const hints = () => site()?.hints || {};
  const has = name => typeof site()?.nav?.[name] === "function";
  const label = el => XXTDom.compact(el?.value || el?.textContent || el?.getAttribute?.("aria-label") || el?.getAttribute?.("title") || "");
  const ACTIVE = ".active,.current,.on,.selected,[aria-selected='true']";

  function steps() {
    if (has("steps")) return site().nav.steps();
    const selectors = [...(hints().stepSelectors || []), '[role="tab"]', ".nav-tabs a", ".tabs > li > a", ".step-tabs > li", ".steps > li"];
    const candidates = [];
    for (const selector of selectors) {
      try { candidates.push(...document.querySelectorAll(selector)); } catch { /* Invalid selector from adapter. */ }
    }
    const tabs = candidates.filter((el, i) => el && XXTDom.visible(el) && label(el).length > 0 && label(el).length < 40 &&
      !candidates.some((other, j) => j !== i && other !== el && other.contains(el)));
    const current = tabs.findIndex(el => el.matches(ACTIVE) || el.parentElement?.matches(ACTIVE) || !!el.closest(ACTIVE) && el.closest(ACTIVE) === el.parentElement);
    return { tabs: [...new Set(tabs)], current };
  }

  function catalog() {
    if (has("catalog")) return site().nav.catalog();
    const selectors = hints().catalogSelectors || [];
    for (const selector of selectors) {
      let nodes = [];
      try { nodes = [...document.querySelectorAll(selector)]; } catch { continue; }
      const visibleNodes = nodes.filter(node => node?.isConnected);
      const current = visibleNodes.findIndex(node => node.matches(ACTIVE) || node.closest(ACTIVE));
      const next = current >= 0 ? visibleNodes[current + 1] : null;
      if (next) return next.querySelector("a,button") || next;
    }
    return null;
  }

  function unsafeTarget(el) {
    return !!el.closest("#xxt-player-assistant,.xxt-ai-explanation,.singleQuesId,.TiMu,[data-question-id],.question-item,[role='dialog'],[role='alertdialog'],.layui-layer,form,article,.article-content,.post-body,.markdown-body");
  }

  function next(catalogOnly = false) {
    if (has("next")) return site().nav.next(catalogOnly);
    if (catalogOnly) return catalog();
    const { tabs, current } = steps();
    if (current >= 0 && current + 1 < tabs.length) return tabs[current + 1];
    for (const selector of hints().nextSelectors || []) {
      let nodes = [];
      try { nodes = [...document.querySelectorAll(selector)]; } catch { continue; }
      const button = nodes.find(el => XXTDom.visible(el) && !XXTDom.isDisabled(el) && label(el).length < 30 && !unsafeTarget(el));
      if (button) return button;
    }
    const pattern = hints().nextText || /^(下一节|下一小节|下一单元|下一课|下一章|下一讲|下一集|下一页|下一个|下一步|继续学习|next)$/i;
    const semantic = [...document.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"]')].find(el =>
      XXTDom.visible(el) && !XXTDom.isDisabled(el) && pattern.test(label(el).replace(/\s/g, "")) && !unsafeTarget(el));
    return semantic || catalog();
  }

  function videoStep() {
    if (has("videoStep")) return site().nav.videoStep();
    const { tabs, current } = steps();
    const candidate = current >= 0 ? tabs[current + 1] : null;
    return candidate && /视频|录像|video|第.{1,3}[讲节集课]/i.test(label(candidate)) ? candidate : null;
  }

  function practiceStep() {
    if (has("practiceStep")) return site().nav.practiceStep();
    if (!site()?.capabilities?.practiceStep) return null;
    const { tabs, current } = steps();
    const candidate = current >= 0 ? tabs[current + 1] : null;
    return candidate && /^(?:\d*)(?:练习|章节测验|测验|章节测试|课后练习|课后测验|作业|测试)$/.test(label(candidate)) ? candidate : null;
  }

  function isCatalogTarget(el) {
    if (has("isCatalogTarget")) return !!site().nav.isCatalogTarget(el);
    return false;
  }

  function signature() {
    if (has("signature")) return site().nav.signature();
    const { tabs, current } = steps();
    const media = [...document.querySelectorAll("video,audio")].slice(0, 6).map(node => node.currentSrc || node.src || "");
    const selected = document.querySelector(`[class*="catalog"] ${ACTIVE},[class*="catalog"]${ACTIVE},[class*="tree"] ${ACTIVE}`);
    return XXTDom.hash(JSON.stringify([location.href, document.title, tabs.slice(0, 40).map(label), current, selected ? label(selected) : "", media]));
  }

  globalThis.XXTNavigation = Object.freeze({ steps, next, videoStep, practiceStep, signature, catalog, isCatalogTarget, label });
})();
