/* Site adapter: 优学院（ulearning.cn）。 */
(() => {
  XXTSites.register({
    id: "ulearning",
    name: "优学院",
    hosts: ["ulearning.cn"],
    urlHints: null,
    capabilities: { quiz: "assist", autoSubmit: false, lesson: false, practiceStep: false, catalog: false, blockerDialogs: false },
    hints: {
      quizRoots: [".question-item", ".que-item", ".question"],
      nextSelectors: [".next-btn", ".btn-next"],
      nextText: /^(下一节|下一单元|下一课|下一章|下一个)$/
    },
    messages: { nextHint: "未找到优学院的下一步按钮，请手动点击" }
  });
})();
