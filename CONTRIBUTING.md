# 贡献指南

使用 Node.js 22 或更高版本，无需 npm 依赖：

```sh
npm run check        # 语法 + manifest 一致性
npm test             # 单元测试
npm run test:dom     # DOM 语义测试（需要本机 Edge/Chrome）
npm run test:e2e     # 端到端测试（无头浏览器，约 1～2 分钟）
```

Windows 已安装 Edge，或 Linux 已安装 Chrome 时，可运行浏览器测试；`BROWSER_PATH` 可指定浏览器路径。真实 API 检查不作为普通回归或 CI 的一部分。

## 报告问题

请提供扩展版本、Edge 版本、复现步骤，以及期望和实际行为。尽可能附上脱敏诊断（面板「复制诊断」）与最小页面结构示例。

不要上传 API Key、Cookie、课程签名链接、个人资料或完整登录页。截图应遮挡姓名、学号等信息，不要提供登录账号。

## 提交改动

- 一次改动解决一个明确问题，说明触发条件和验证方式。
- 修改识别或流程逻辑时补充故障复现测试；界面小改动可记录操作检查。
- 保持暂停、停止、跨课程隔离及提交去重行为。
- 新增站点适配时同步更新 `manifest.json`、`core/files.js`、README 平台表与测试。
- 不引入远程执行代码、遥测、隐式 API 请求或真实凭据。
- 引用第三方实现时说明来源与许可证，不合并许可证不明的代码。

发布版本时同步更新 `edge-extension/manifest.json`、`core/content.js` 面板版本、`package.json`、README 与 CHANGELOG；`npm run check` 会校验 manifest 与 package 版本一致。
