# 实施与验证记录

## 2026-09-07 / F00 可运行后端基础

- 已只读检查 `F:\MedicalCareWeb`：主站为 Next.js / React，chat-service 为 Fastify 5 / TypeScript，已有 `/auth/me`、`/health/live`、`/health/ready`。
- 本平台后端采用相同 Fastify / TypeScript 技术栈，依赖版本与现有服务对齐；不采用初稿中的 .NET 候选方案。前端后续采用 Next.js / React 对齐主站。
- 建立严格 TypeScript 检查、独立测试目录、构建与启动命令、仅监听本机的默认配置、统一错误格式和存活探测。
- 未配置身份和状态存储时就绪探测返回 503，不将空工程标记为运行就绪。
- 没有读取现有工程的生产凭据，没有修改 MedicalCareWeb 文件。

验证：`npm run check` 通过，包含严格类型检查、2 项接口/配置测试及生产构建；`git diff --check` 通过。Git 上传结果随每批交付说明记录。
