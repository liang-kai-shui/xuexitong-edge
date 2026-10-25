/* Site adapter: 雨课堂（yuketang.cn）。页面结构变化较快，按需激活。 */
(() => {
  XXTSites.register({
    id: "yuketang",
    name: "雨课堂",
    hosts: ["yuketang.cn"],
    urlHints: null,
    capabilities: { quiz: "assist", autoSubmit: false, lesson: false, practiceStep: false, catalog: false, blockerDialogs: false },
    hints: {
      quizRoots: [".question-item", ".problem-item", ".exercise", ".question"],
      nextSelectors: [".next-btn", ".next-slide", ".btn-next"],
      nextText: /^(下一节|下一单元|下一课|下一章|下一页|下一个)$/
    },
    messages: { nextHint: "未找到雨课堂的下一步按钮，请手动点击" }
  });
})();
