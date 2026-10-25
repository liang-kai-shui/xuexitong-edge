/* Site adapter: 中国大学 MOOC（icourse163.org）。 */
(() => {
  XXTSites.register({
    id: "icourse163",
    name: "中国大学 MOOC",
    hosts: ["icourse163.org"],
    urlHints: [/\/learn\//i, /\/mooc-ans\//i],
    capabilities: { quiz: "assist", autoSubmit: false, lesson: false, practiceStep: false, catalog: false, blockerDialogs: false },
    hints: {
      quizRoots: [".u-questionItem", ".j-question", ".question", ".u-question"],
      nextSelectors: [".j-next", ".u-btn-next", ".next-btn"],
      nextText: /^(下一节|下一单元|下一课|下一个|下一章)$/
    },
    messages: { nextHint: "未找到中国大学 MOOC 的下一步按钮，请手动点击" }
  });
})();
