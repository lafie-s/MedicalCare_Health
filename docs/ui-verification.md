# F01b 界面验证记录

日期：2026-09-07。测试对象为本平台 Next.js 页面和 Fastify API，使用隔离测试身份服务，不代表已完成 MedicalCareWeb 真实员工联调。

## 已执行

- Playwright CLI / Chromium 检查桌面 1440×960 与窄屏 390×844，页面无横向溢出，内容可自然滚动。
- 空表单提交：展示字段错误，首错聚焦邮箱；密码默认隐藏、显示切换及键盘 Enter 登录可用。
- 错误密码：通用错误提示，保留邮箱、清空密码并聚焦；未授权员工明确拒绝访问。
- 成功登录：显示测试身份及平台角色，仅列出授权环境；切换环境更新 URL，缺少指标显示未知。
- 退出：服务端会话被撤销，页面返回登录。浏览器验证发现空请求错误附带 JSON 类型头的问题，已修复并重新验证。
- 空环境集合、身份服务 503、重试恢复及 401 会话失效：使用浏览器路由注入验证对应状态，错误时不保留旧权限内容。
- reduced-motion 下检查窄屏登录与必填焦点；computed scrollbar-color 使用项目令牌；localStorage / sessionStorage 均为空。
- `npm run check`：22 项后端测试、严格类型检查、构建和进程启动冒烟检查。
- `npm run check:web`：令牌漂移检查、Next.js 生产构建和前端类型检查。
- DESIGN.md lint：0 errors；组件令牌引用提示属于文档 linter 无法识别 CSS 消费者的 warnings，CSS 通过生成与漂移检查覆盖。
- Premium strict audit：0 violations，静态报告为 `docs/premium-audit.json`。

## 范围限制

F02 增量验证：生产构建下通过服务登记、必填聚焦、编辑、停用/启用确认、原生目标 select 弹层及键盘选择、409 保留草稿、Escape 放弃保护、390px 模态框和桌面列表检查。截图为 `output/playwright/service-form-mobile.png` 与 `service-directory.png`，均为测试数据。

浏览器中的空环境、503、401 场景通过路由注入测试；真实上游异常由独立 HTTP 适配器测试覆盖。尚未进行真实员工账号、生产代理、多实例、完整屏幕阅读器或生产部署验收。测试截图位于被 Git 忽略的 `output/playwright/`，不包含真实凭据。
