# MedicalCare Health

面向 MedicalCareWeb 运维人员的健康指标监测及维护平台。

## 项目文档

- [项目技术文档](docs/technical-design.md)：范围、架构、功能、指标、数据模型、接口、安全与验收。
- [开发计划与甘特图](docs/project-plan.md)：阶段依赖、暂定排期、交付与验收。
- [工程协作规则](AGENTS.md)：功能完成标准、Git 提交及推送要求。
- [本地开发与身份接入](docs/local-development.md)：运行配置、授权、接口和当前限制。
- [服务目录与探测接入](docs/service-monitoring.md)：服务配置、目标白名单和接入边界。

## 当前状态

已实现后端基础、员工账号登录页面、可撤销的平台会话及授权环境工作台。前端为 Next.js / React，后端为 Fastify / TypeScript，与 MedicalCareWeb 对齐。真实员工联调、监控数据和生产环境尚未接入。详见 [实施记录](docs/implementation-log.md)。

## 本地启动

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
