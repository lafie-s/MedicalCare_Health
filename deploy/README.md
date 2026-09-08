# 腾讯云单实例部署

此配置为本平台独立部署，不更改 MedicalCareWeb PostgreSQL/Redis。需要 Docker Compose、至少 Node 22 构建环境（镜像内提供）、可访问的真实身份 HTTPS 地址、平台 HTTPS 域名及现有 Nginx 入口。当前公网纯 IP HTTP 部署不能直接满足本平台生产认证要求，不应为预览关闭鉴权或使用生产员工明文登录。

1. 在独立工程目录检出当前提交，复制 deploy/.env.example 为 deploy/.env；生成并安全注入 SESSION_KEY，填写两项 HTTPS 地址。
2. 复制 config/access-policy.example.json 为 deploy/access-policy.json，填写已授权员工 userId 和环境；示例无默认管理员。按实际目标白名单配置探测，勿把本机 fixture 当真实服务。
3. env 文件仅部署管理员读取；授权文件须允许容器 node 用户读取、限制其他账户。确认 shengren_default 是实际入口网络，否则配置 HEALTH_EDGE_NETWORK。部署前核实服务器资源、4321 端口和 DNS/TLS。
4. 从工程根目录执行 docker compose -p medicalcare-health --env-file deploy/.env -f deploy/compose.yaml config --quiet，随后执行同一命令前缀的 up -d --build。不要输出展开后的配置，以免泄露密钥。
5. 现有入口 Nginx 加独立平台域名 HTTPS server，代理到 http://medicalcare-health-web:4320；保留 Host、X-Forwarded-Proto 与 X-Forwarded-For。入口容器须在 edge 网络内。不要覆盖 MedicalCareWeb 的 location 或整个 Nginx 配置，变更后先 nginx -t 再 reload。
6. 验证首页、API 未登录 401、授权登录、环境隔离、/health/ready 以及真实探测。容器 healthcheck 只检查进程存活，不能代替身份依赖/权限验收。

后端无宿主机端口；前端仅绑定宿主机回环 4321 并接入现有代理网络。无需向公网开放 4310、4321 或数据库端口。持久化使用独立 health_state 卷，不能执行 down -v。回退须保留数据卷和同一 SESSION_KEY，并按备份手册核实版本兼容。

部署机访问条件未提供时，只能准备配置，不能宣称部署成功。Docker 镜像构建和 Compose 运行须在具备 Docker 的环境验证。本机无 Docker；当前尚无在线地址或生产验收结果。

## 腾讯云隔离预览

preview.yaml 是独立的公开演示配置，使用 /MedicalCareHealth 子路径、独立 preview-server 入口和内存示例数据。公开演示身份只访问这份示例数据，不转发真实登录。后端仅加入 internal 网络，无持久卷、无真实身份服务、无 ProbeRunner、无业务数据库或 Docker socket。页面显示演示标记，一键进入，重启重置。此入口不能用于生产员工或真实数据。正式部署使用 compose.yaml 与 HTTPS 配置，不设置 NEXT_PUBLIC_PREVIEW。

2026-09-08 隔离预览已实际部署并完成公网浏览器验证：http://124.221.179.162/MedicalCareHealth。使用 nginx-preview.conf 中 Cookie Path 映射，nginx 配置位于宿主机 /opt/shengren/deploy/nginx.conf，变更前已保留备份。容器重建导致地址变化时先验证代理可达性，必要时 nginx -t 后 reload。正式 Compose 仅完成模板准备，未进行真实身份部署验收。
