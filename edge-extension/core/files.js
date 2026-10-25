/* Content-script file list, shared by the manifest, the service worker
 * (dynamic registration for custom sites) and the popup. Keep this array in
 * sync with manifest.json — tests/run-tests.mjs enforces equality. */
globalThis.XXT_CONTENT_FILES = [
  "core/dom.js",
  "core/policy.js",
  "core/text.js",
  "core/question-image.js",
  "core/sites.js",
  "core/adapters/chaoxing.js",
  "core/adapters/zhihuishu.js",
  "core/adapters/icourse163.js",
  "core/adapters/xuetangx.js",
  "core/adapters/yuketang.js",
  "core/adapters/icve.js",
  "core/adapters/ulearning.js",
  "core/adapters/generic.js",
  "core/quiz.js",
  "core/lesson.js",
  "core/navigation.js",
  "core/content.js"
];
