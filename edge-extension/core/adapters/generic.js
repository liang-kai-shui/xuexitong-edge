/* 通用站点适配器：任意视频/课程网站。核心能力为播放、倍速、续播、自动下一节；
 * 题目识别与填写为实验性辅助能力，默认不自动提交。 */
(() => {
  XXTSites.register({
    id: "generic",
    name: "通用模式",
    generic: true,
    hosts: [],
    urlHints: null,
    capabilities: { quiz: "assist", autoSubmit: false, lesson: false, practiceStep: false, catalog: false, blockerDialogs: false },
    hints: {
      quizRoots: [],
      nextSelectors: [],
      nextText: /^(下一节|下一小节|下一单元|下一课|下一章|下一讲|下一集|下一页|下一个|继续|下一步|next)$/i
    },
    messages: { nextHint: "未找到可用的“下一节/下一步”按钮，请手动切换章节" }
  });
})();
