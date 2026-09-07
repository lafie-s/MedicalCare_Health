# 界面行为约定

业务依据：`docs/technical-design.md`、`docs/local-development.md`、`src/auth-routes.ts`。视觉依据：`DESIGN.md`。

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| Form | web/components/login-form.tsx、web/components/service-panel.tsx | 登录与服务配置 API | credentials / service | 浏览器必填与失败路径 |
| Select/Listbox | web/components/service-panel.tsx | DESIGN.md | native | 原生弹层及键盘选择 |
| Dialog | web/components/dialog.tsx | 当前约定 | form / confirmation | 焦点、Escape 和放弃修改 |
| Scrollbar | web/app/globals.css | DESIGN.md | 全局标准与引擎回退 | 浏览器计算样式 |
| Feedback | web/components/ui.tsx | 当前约定 | error / status | 浏览器 live region |

登录成功留在工作台，查询身份与授权环境；密码不持久化，失败保留邮箱、清空密码并聚焦。没有注册、密码重置或创建管理员入口，员工账号维护沿用 MedicalCareWeb。

数据查询拥有 loading、ready、empty、error、unauthorized 状态。查询失败隐藏旧权限数据，给出重试；401/403 清除受保护内容并返回登录。刷新、页面重新可见及会话到期重新验证，超时显示可恢复文本，不无限加载。并发查询取消旧请求，退出前取消查询，防止旧身份覆盖新状态。

环境 ID 存入 URL 的 environment 参数，仅接收授权集合中的值；不使用敏感信息作为 URL 状态。环境最多 100 个，采用完整列表，不需要分页或搜索。空列表明确提示联系管理员；未接入运行数据不显示模拟数字。

当前不提供有副作用的维护功能。退出为可重新登录的普通操作，无需确认；失败必须显示重试，不声称会话已撤销。

服务目录：仅管理员新增、修改、启停；管理员和运维人员可立即探测，只读角色不能发起。原生 select 用于白名单目标与采集间隔，接受系统弹层外观，不自定义 popup 几何。列表最多 100 项，与后端硬上限一致，完整渲染并显示总数。创建和修改成功关闭对话框、刷新当前环境列表、显示保存结果；失败保留输入，409 要求刷新后重新打开配置。

探测结果由 service-panel.tsx 统一展示状态原因、最近响应头耗时、5 分钟成功率、有效样本数和北京时间采集时间。无数据、过期及配置失效显示未知和破折号，不能展示为零或正常。可见页面每 30 秒刷新服务，弹窗和手动探测期间暂停；每秒本地检查过期。探测按钮执行期间禁用，失败明确提示原因，网络不确定时保留幂等键用于重试。停用及撤销目标禁用探测按钮，服务端独立校验。

服务启停会改变监测覆盖，使用同一 Dialog 确认并说明历史保留；停用不删除数据。表单取消与 Escape 在有修改时先询问是否放弃，关闭页面使用原生 beforeunload 生命周期提示。对话框开启时暂停页面可见性触发的全页刷新，服务端仍逐请求鉴权。会话到期按安全规则清除表单，不持久化未保存配置。

默认 zh-CN 与 Asia/Shanghai，技术品牌名保持原名；日期使用 Intl。界面目标 WCAG 2.2 AA，首错焦点、按钮键盘操作、loading live region、窄屏和减少动画状态必须验证。登录表单无额外导航，密码不可恢复，不做持久化草稿。
