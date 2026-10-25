/* Site adapter: 学堂在线（xuetangx.com）。 */
(() => {
  XXTSites.register({
    id: "xuetangx",
    name: "学堂在线",
    hosts: ["xuetangx.com"],
    urlHints: [/\/courseware\//i, /\/learn\//i, /\/course\//i],
    capabilities: { quiz: "assist", autoSubmit: false, lesson: false, practiceStep: false, catalog: false, blockerDialogs: false },
    hints: {
      quizRoots: [".problem", ".question-item", ".exercise-item", ".question"],
      nextSelectors: [".next-section", ".next-btn", ".btn-next"],
      nextText: /^(下一节|下一单元|下一课|下一章|下一讲)$/
    },
    messages: { nextHint: "未找到学堂在线的下一步按钮，请手动点击" }
  });
})();
