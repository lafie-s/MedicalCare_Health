# MedicalCare Health

面向 MedicalCareWeb 运维人员的健康指标监测及维护平台。

## 项目文档

- [项目技术文档](docs/technical-design.md)：范围、架构、功能、指标、数据模型、接口、安全与验收。
- [开发计划与甘特图](docs/project-plan.md)：阶段依赖、暂定排期、交付与验收。
- [工程协作规则](AGENTS.md)：功能完成标准、Git 提交及推送要求。
- [本地开发与身份接入](docs/local-development.md)：运行配置、授权、接口和当前限制。
- [服务目录与探测接入](docs/service-monitoring.md)：服务配置、目标白名单和接入边界。
- [HTTP 告警规则与事件](docs/http-alerts.md)：连续失败规则、自动恢复、确认/关闭和权限边界。

- [维护窗口记录](docs/maintenance-windows.md)：登记、取消、时间边界与权限。

## 当前状态

已实现后端基础、员工登录与环境授权、服务目录配置，以及自动和手动 HTTP 健康探测。服务列表展示响应耗时、5 分钟探测成功率、采集时间及过期状态。前端为 Next.js / React，后端为 Fastify / TypeScript，与 MedicalCareWeb 对齐。当前通过隔离身份和本机 HTTP 验证，真实员工、运行环境和生产环境尚未联调。详见 [实施记录](docs/implementation-log.md)。

## 本地启动

新增 HTTP 健康概览：当前环境状态分布、过期数量和需要关注的服务，可直接跳到服务明细。概览暂按探测状态汇总；告警等级在服务告警面板显示，服务条目显示维护记录标记。

服务支持查看最近 1、6、24 小时的 HTTP 探测趋势，包括平均响应头耗时、成功率、空值断点与分段数据表。

管理员可为服务配置连续失败告警，运维人员可确认事件和关闭已恢复事件。当前仅在平台内展示，不发送外部通知。

环境告警中心提供活动/严重/待确认汇总、状态筛选、分页及服务处理入口，筛选和页码可在刷新后恢复。

运维人员可登记、取消维护窗口并查询历史。当前仅记录计划，采集和告警继续运行，不执行远程操作。

需要 Node.js 22.13 或更高版本。

```powershell
npm ci
npm run check
npm run dev
```

默认监听 `http://127.0.0.1:4310`。`GET /health/live` 检查进程存活；未完成配置时 `GET /health/ready` 返回 503。发布构建使用 `npm run build`，启动构建产物使用 `npm start`。

前端：先执行 `npm ci --prefix web`，在另一终端运行 `npm run dev:web`，打开 `http://127.0.0.1:4320`。按接入说明将后端 `PLATFORM_ORIGIN` 设置为该前端地址，并配置身份服务及运维授权。前端检查执行 `npm run check:web`。

已确认：本项目中的“健康指标”指 MedicalCareWeb 系统运行指标，包括服务可用性、接口延迟与错误率、资源使用情况及依赖状态。患者健康指标、医疗诊断及医疗设备业务数据不在本项目范围内。

## 工作方式

直接在当前工程目录及当前分支工作，不创建或使用 Git worktree。每完成一个可独立验收的功能，完成必要验证并更新文档后，立即提交并推送到当前分支对应的 Git 远程分支。详见 [AGENTS.md](AGENTS.md)。
