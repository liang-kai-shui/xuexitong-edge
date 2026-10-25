/* Site adapter: 智慧树（zhihuishu.com）。识别与默认策略；
 * 具体播放器/目录/题目细节由通用语义引擎兜底。 */
(() => {
  XXTSites.register({
    id: "zhihuishu",
    name: "智慧树",
    hosts: ["zhihuishu.com"],
    urlHints: [/\/shareCourse\//i, /studyvideoh5/i, /\/onlineweb\/(?:.*course|.*study)/i, /\/course\//i],
    capabilities: { quiz: "assist", autoSubmit: false, lesson: false, practiceStep: false, catalog: false, blockerDialogs: false },
    hints: {
      quizRoots: [".subject_describe", ".examPaper_subject", ".question-item", ".subject_node"],
      nextSelectors: [".next-btn", ".video-next", ".btn-next"],
      nextText: /^(下一节|下一集|下一章|下一课|继续学习|下一个)$/
    },
    messages: { nextHint: "未找到智慧树的下一步按钮，请手动点击" }
  });
})();
