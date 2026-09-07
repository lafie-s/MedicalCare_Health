# 界面行为约定

业务依据：`docs/technical-design.md`、`docs/local-development.md`、`src/auth-routes.ts`。视觉依据：`DESIGN.md`。

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| Form | web/components/login-form.tsx | 员工登录 API | credentials | 浏览器必填与失败路径 |
| Scrollbar | web/app/globals.css | DESIGN.md | 全局标准与引擎回退 | 浏览器计算样式 |
| Feedback | web/components/ui.tsx | 当前约定 | error / status | 浏览器 live region |

登录成功留在工作台，查询身份与授权环境；密码不持久化，失败保留邮箱、清空密码并聚焦。没有注册、密码重置或创建管理员入口，员工账号维护沿用 MedicalCareWeb。

数据查询拥有 loading、ready、empty、error、unauthorized 状态。查询失败隐藏旧权限数据，给出重试；401/403 清除受保护内容并返回登录。刷新、页面重新可见及会话到期重新验证，超时显示可恢复文本，不无限加载。并发查询取消旧请求，退出前取消查询，防止旧身份覆盖新状态。

环境 ID 存入 URL 的 environment 参数，仅接收授权集合中的值；不使用敏感信息作为 URL 状态。环境最多 100 个，采用完整列表，不需要分页或搜索。空列表明确提示联系管理员；未接入运行数据不显示模拟数字。

当前不提供有副作用的维护功能。退出为可重新登录的普通操作，无需确认；失败必须显示重试，不声称会话已撤销。

默认 zh-CN 与 Asia/Shanghai，技术品牌名保持原名；日期使用 Intl。界面目标 WCAG 2.2 AA，首错焦点、按钮键盘操作、loading live region、窄屏和减少动画状态必须验证。登录表单无额外导航，密码不可恢复，不做持久化草稿。
