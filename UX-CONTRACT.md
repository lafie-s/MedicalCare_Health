# 界面行为约定

业务依据：`docs/technical-design.md`、`docs/local-development.md`、`src/auth-routes.ts`。视觉依据：`DESIGN.md`。

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| Form | web/components/login-form.tsx、web/components/service-panel.tsx | 登录与服务配置 API | credentials / service | 浏览器必填与失败路径 |
| Select/Listbox | web/components/service-panel.tsx | DESIGN.md | native | 原生弹层及键盘选择 |
| Date | web/components/maintenance-dialog.tsx | docs/maintenance-windows.md | native datetime-local | 北京时间、键盘分段、窄屏及服务端时间边界 |
| Dialog | web/components/dialog.tsx | 当前约定 | form / confirmation | 焦点、Escape 和放弃修改 |
| Scrollbar | web/app/globals.css | DESIGN.md | 全局标准与引擎回退 | 浏览器计算样式 |
| Feedback | web/components/ui.tsx | 当前约定 | error / status | 浏览器 live region |
| Health overview | web/components/health-overview.tsx | src/health-summary.ts、docs/service-monitoring.md | HTTP | 状态分布、未知/过期、键盘详情链接 |
| Trend chart/table | web/components/probe-trend.tsx | docs/service-monitoring.md | HTTP snapshot | 断点、最多 96 段、表格滚动及错误重试 |
| Alert workflow | web/components/alert-dialog.tsx | docs/http-alerts.md | rule / event | 保存确认、状态操作、分页、冲突草稿 |
| Alert center | web/components/alert-center.tsx | docs/http-alerts.md | environment | URL 筛选、20 条分页、处理回流、焦点回退 |

登录成功留在工作台，查询身份与授权环境；密码不持久化，失败保留邮箱、清空密码并聚焦。没有注册、密码重置或创建管理员入口，员工账号维护沿用 MedicalCareWeb。

数据查询拥有 loading、ready、empty、error、unauthorized 状态。查询失败隐藏旧权限数据，给出重试；401/403 清除受保护内容并返回登录。刷新、页面重新可见及会话到期重新验证，超时显示可恢复文本，不无限加载。并发查询取消旧请求，退出前取消查询，防止旧身份覆盖新状态。

环境 ID 存入 URL 的 environment 参数，仅接收授权集合中的值；不使用敏感信息作为 URL 状态。环境最多 100 个，采用完整列表，不需要分页或搜索。空列表明确提示联系管理员；未接入运行数据不显示模拟数字。

当前不提供有副作用的维护功能。退出为可重新登录的普通操作，无需确认；失败必须显示重试，不声称会话已撤销。

服务目录：仅管理员新增、修改、启停；管理员和运维人员可立即探测，只读角色不能发起。原生 select 用于白名单目标与采集间隔，接受系统弹层外观，不自定义 popup 几何。列表最多 100 项，与后端硬上限一致，完整渲染并显示总数。创建和修改成功关闭对话框、刷新当前环境列表、显示保存结果；失败保留输入，409 要求刷新后重新打开配置。

探测结果由 service-panel.tsx 统一展示状态原因、最近响应头耗时、5 分钟成功率、有效样本数和北京时间采集时间。无数据、过期及配置失效显示未知和破折号，不能展示为零或正常。可见页面每 30 秒刷新服务，弹窗和手动探测期间暂停；每秒本地检查过期。探测按钮执行期间禁用，失败明确提示原因，网络不确定时保留幂等键用于重试。停用及撤销目标禁用探测按钮，服务端独立校验。

服务启停会改变监测覆盖，使用同一 Dialog 确认并说明历史保留；停用不删除数据。表单取消与 Escape 在有修改时先询问是否放弃，关闭页面使用原生 beforeunload 生命周期提示。对话框开启时暂停页面可见性触发的全页刷新，服务端仍逐请求鉴权。会话到期按安全规则清除表单，不持久化未保存配置。

默认 zh-CN 与 Asia/Shanghai，技术品牌名保持原名；日期使用 Intl。界面目标 WCAG 2.2 AA，首错焦点、按钮键盘操作、loading live region、窄屏和减少动画状态必须验证。登录表单无额外导航，密码不可恢复，不做持久化草稿。

HTTP 概览复用服务目录查询、刷新和失败状态，加载期间隐藏汇总，失败时不沿用旧计数。状态与明细共用纯规则，每秒判定过期；注意清单异常优先，服务名称为原生锚点链接，目标服务可接受焦点。计数使用语义 dl，桌面四列、窄屏两列，异常文字与数字均有文字语义，不只靠颜色。环境选择继续保存在 URL，概览无独立筛选器。

趋势查看复用 Dialog、Button、Notice 和原生 select；1/6/24 小时为同页临时检查选项，每次打开默认 1 小时，不写 URL（避免关闭对话框后留下失效的弹窗筛选状态）。弹窗期间暂停服务后台刷新，趋势为带时间戳的手动刷新快照。无数据图表断线，details 内提供语义 table 精确值，最多 96 行；表格内部滚动，不限制外部页面高度。切换或关闭取消旧查询，失败隐藏旧图表，关闭与 Escape 恢复来源按钮焦点。

告警面板复用 Dialog、Button、Notice 及原生 select，规则保存确认在同一模态内显示，说明重置计数/终止活动事件。未保存草稿阻止刷新、分页与事件操作，取消先确认放弃，401/403 按安全要求清除。事件每页 20 条；页码作为临时弹窗状态，每次打开回到第一页，不污染页面 URL。确认、恢复与关闭使用不同文字，已恢复才提供关闭入口。面板是手动刷新快照，显示查询时间及采样未知/过期原因。

环境中心复用 Button、Notice、原生 select 和服务告警 Dialog。筛选/页码写入 URL，切环境重置，越界页码按服务器结果纠正。首次/筛选加载隐藏旧列表，后台刷新保留带时间的查询快照，失败清除。中心每 30 秒刷新，服务弹窗期间暂停；弹窗关闭后重读，来源行消失时焦点回退到中心。中心是自然高度分页列表，不新增嵌套滚动容器。

维护窗口由 MaintenanceDialog/MaintenanceForm 维护，复用 Dialog 模态与焦点恢复。日期使用浏览器原生 datetime-local（native owner），统一解析北京时间。表单 noValidate，应用负责首错聚焦、错误、等待、重试幂等与修改放弃确认，取消需原因。每页 20 条，列表为带时间的手动快照；异常清除旧数据。只读用户仅查询，401/403 清除受保护页面。
