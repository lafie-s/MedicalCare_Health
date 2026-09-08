# 网站维护访问控制

## 使用

首页「网站维护」→ 选择服务 → 配置维护模式、IP / 网段白名单和变更原因 → 二次确认。管理员可修改，其他授权角色只读。页面显示配置版本与读取时间，超过 30 秒显示状态过期；保存使用服务端版本冲突检查。运维平台不受网站维护规则影响，避免管理员被锁在外面。

- 关闭维护：允许正常访问。
- 立即开启维护：立即按白名单检查，直到管理员关闭。
- 跟随维护窗口：存在本服务未取消且 startsAt <= 当前服务端时间 < endsAt 的窗口时生效。取消、到期后恢复。
- 白名单支持 IPv4、IPv6 和 CIDR（最多 100 条），不接受域名、端口、Zone ID、请求头列表、任意配置文本或 /0。IPv4 映射 IPv6 地址也按 IPv4 网段匹配。留空意味着维护期间阻止所有访客，确认页明确提醒。

原维护窗口仍不停止采集或静默告警；当管理员选择跟随窗口时，运维人员登记/取消窗口会影响访问控制。手动维护不会随窗口到期关闭。

## 接口与持久化

GET /api/v1/services/:id/maintenance-access 返回当前模式、白名单、版本、状态、最近修改和读取时间、入口模式。POST 同路径需要管理员、环境授权和合法 Origin；接受 mode、allowlist、reason、version、idempotencyKey。没有配置入口的服务拒绝修改。最大请求体 16 KiB、列表最多 100 条，SQLite 忙等待 3 秒，浏览器请求 15 秒超时。

maintenance_access 保存当前配置，maintenance_access_changes 保存操作人、前后快照和幂等输入。配置、历史与 maintenance.access_saved 审计同事务；重复请求不重新应用旧配置，跨用户/不同输入复用键拒绝，陈旧版本返回 409。真实部署使用持久化平台数据库；公开演示重启清空。

GET /internal/maintenance-check 仅供入口鉴权：X-Maintenance-Key 为环境注入的至少 32 字符秘密，X-Maintenance-IP 为入口获取的访客 IP。成功返回 204，阻止返回 403，读取配置失败返回 503。入口将拒绝/故障转为 HTTP 503 维护页面并发送 Retry-After: 60、Cache-Control: no-store；不返回患者或内部配置。员工 Cookie、前端按钮隐藏不能替代入口鉴权。

## 腾讯云隔离演示

/MedicalCareHealth/site-preview/ 为独立 Nginx 访客演示，不代理真实 MedicalCareWeb。网站维护面板的链接可打开此页面。规则关闭/白名单命中显示访问已放行，未命中显示网站维护中（503）。所有子路径同样受控，包含模拟接口和连接握手请求。

外层 Nginx 覆盖 X-MC-Client-IP 为 $remote_addr；隔离 Nginx 仅信任已核实的外层容器 IP，不信任访客提供的 X-Forwarded-For / X-Real-IP。仅内部网络访问鉴权 API，不发布新端口。演示响应 X-Visitor-IP 仅返回访问者自己的地址，便于验证网段；不会返回完整白名单。

启动示例：`docker compose --env-file /受控路径/preview.env -p medicalcare-health-preview -f deploy/preview.yaml up -d --build`。API 容器重建后重载访客网关与外层 Nginx，刷新上游 DNS。

新增 Compose 设置 MAINTENANCE_GATE_KEY、TRUSTED_INGRESS_IP、MAINTENANCE_NGINX_IMAGE 从部署环境注入；密钥和渲染后的配置不得提交。外层 Nginx 容器 IP 变化时需同步信任地址。网关启动后执行 nginx -t，并用允许、拒绝、伪造头和依赖失联请求验收。

## 正式 MedicalCareWeb 接入边界

真实网站目前没有启用此拦截。正式 server.ts 配置 MAINTENANCE_GATE_SERVICE_ID 和 MAINTENANCE_GATE_KEY，绑定一个已登记服务。deploy/maintenance/production.conf.template 提供入口模板，maintenance.html 提供独立维护页，不依赖正在维护的业务容器。

部署时覆盖 /MedicalCare、/MedicalCare/、语言页面、staff、静态文件、chat-api、chat-socket 的全部访问入口；保留其他站点。既有精确路径 return 302 在鉴权前执行，必须改成受保护的代理 location。仅在公网入口直接使用 $remote_addr；若有 CDN/LB，只信任明确上游并禁止旁路端口。内网 Docker 健康检查可保持直连，外部监控可配置明确白名单。

重要边界：Nginx auth_request 检查每个新 HTTP 请求及 WebSocket 握手，不能撤销已经返回给浏览器的页面，也不能持续复查已经建立的 WebSocket。正式切换到维护时需要在业务入口设置 worker_shutdown_timeout 5s 并 reload，排空既有连接；当前平台配置 API 不执行此排空。真实生产验收必须包括旧连接关闭、重连拦截和旁路检查，不能只凭界面保存成功宣称生产全面封锁。

参考：[Nginx auth_request](https://nginx.org/en/docs/http/ngx_http_auth_request_module.html)、[可信真实 IP](https://nginx.org/en/docs/http/ngx_http_realip_module.html)。
