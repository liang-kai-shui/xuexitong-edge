/* Site adapter: 智慧职教 / 职教云（icve.com.cn）。 */
(() => {
  XXTSites.register({
    id: "icve",
    name: "智慧职教",
    hosts: ["icve.com.cn"],
    urlHints: null,
    capabilities: { quiz: "assist", autoSubmit: false, lesson: false, practiceStep: false, catalog: false, blockerDialogs: false },
    hints: {
      quizRoots: [".question-item", ".e-q-body", ".que-item", ".question"],
      nextSelectors: [".next-btn", ".btn-next", ".nextChapter"],
      nextText: /^(下一节|下一单元|下一课|下一章|下一任务)$/
    },
    messages: { nextHint: "未找到智慧职教的下一步按钮，请手动点击" }
  });
})();
