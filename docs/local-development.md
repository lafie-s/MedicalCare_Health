# 本地开发与身份接入

## 已实现边界

当前交付 F00 后端基础、F01a 员工身份交换与环境授权 API、F01b 员工登录页面及授权环境工作台。尚未实现指标采集、告警或维护动作，也未连接真实员工账号。身份适配器已按 MedicalCareWeb 本机源码的协议实现，并通过独立 HTTP 测试验证。

默认 `npm run dev` 只启动进程健康接口；配置完成后启用身份和环境查询接口。平台就绪表示身份依赖和会话存储可用，不代表目标 MedicalCareWeb 的全部监控能力就绪。

## 依赖与命令

Node.js 至少 22.13；当前本机已验证版本为 22.14.0。使用仓库锁文件执行 `npm ci`，验证执行 `npm run check`，构建和运行分别为 `npm run build`、`npm start`。

当前会话和安全审计保存在本机 SQLite，使用 Node 内置 `node:sqlite`。Node 22.14 会发出 experimental 提示；此存储仅作为当前单实例实现，生产及多实例存储方案尚待验证，不用于大规模指标数据。

## 配置开发环境

1. 将 `config/access-policy.example.json` 复制为 `data/access-policy.json`，保留实际需要的环境。
2. 由管理员填入已获授权的 MedicalCareWeb 员工 `userId`，配置平台角色及 `environmentIds`；示例默认没有授权用户，不自建默认管理员。
3. 使用环境变量设置身份服务地址、平台来源、授权文件位置及加密密钥。`.env.example` 仅是说明文件，应用不会自动加载。

```powershell
New-Item -ItemType Directory -Force data
Copy-Item config/access-policy.example.json data/access-policy.json
$env:MEDICALCARE_AUTH_URL = 'http://127.0.0.1:<实际 chat-service 端口>'
$env:PLATFORM_ORIGIN = 'http://127.0.0.1:4320'
$env:ACCESS_POLICY_PATH = 'data/access-policy.json'
$env:SESSION_KEY = node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))"
npm run dev
```

密钥生成结果仅赋给环境变量，不要打印、上传或放入前端。跨重启保留原密钥；换密钥会使已有会话不能解密，需要按计划停机清理会话或实现迁移，不能把密钥轮换视为无损操作。`data/` 和本地环境文件已被 Git 忽略。

授权条目结构如下，`userId` 必须替换为真实授权用户标识：

```json
{ "userId": "<员工 userId>", "role": "viewer", "environmentIds": ["local"] }
```

平台角色为 `viewer`、`operator`、`admin`，均仅能查看分配的环境。当前只有身份及环境只读接口，未来写操作必须继续校验动作权限。上游 `ADMIN` 不会自动获得平台管理员权限。

授权文件逐请求重新读取，移除用户授权会在下次请求时撤销会话，环境和角色变更也立即生效。修改文件请采用同目录临时文件加原子替换，防止写入中断；文件损坏时服务拒绝授权并返回 503。

## 身份流程与接口

当前采用员工访问令牌交换平台会话，不复制上游密码库，也不读取其 JWT 签名密钥。

1. 已通过 MedicalCareWeb 认证的客户端将访问令牌作为 `Authorization: Bearer <token>`，发送 `POST /api/v1/auth/session`；同时设置与配置一致的 `Origin` 请求头。
2. 服务端调用上游 `/auth/me` 验证令牌，核对本平台授权文件，创建 15 分钟会话，返回 HttpOnly、SameSite=Strict cookie；HTTPS 配置会附加 Secure。
3. 客户端用 cookie 请求 `/api/v1/me`、`/api/v1/environments` 和 `/api/v1/environments/:id`。所有请求重查上游令牌和本地授权，不将数据写入客户端持久存储。
4. `POST /api/v1/auth/logout` 携带同源 Origin，立即删除平台会话。上游不可用时也可退出。

浏览器用户使用新增的 `POST /api/v1/auth/login`，输入 MedicalCareWeb 员工邮箱与密码。平台服务端转交上游 `/auth/login`，验证 `/auth/me` 及本地运维授权，返回本平台 cookie；上游 access token 不发送给浏览器，密码不入库。原令牌交换接口保留用于受控客户端接入，不要求浏览器用户粘贴令牌。

上游登录创建的 refresh cookie 仅在服务器内用于立即调用 `/auth/logout` 撤销该次 refresh session，随后只保留短期 access token。撤销失败则不建立本平台会话并返回 503；上游网络不确定结果仍需依其过期和清理策略处理。此操作只针对本次登录新建的 refresh session，不退出用户原有的 MedicalCareWeb 浏览器会话。

同一员工新建会话会替换旧会话。当前不提供刷新会话功能，有效期为 15 分钟且受上游访问令牌更早的失效时间约束。退出只撤销本平台会话，不退出 MedicalCareWeb；上游有效访问令牌仍可重新交换会话。

上游访问令牌在 SQLite 中以 AES-256-GCM 加密，平台 cookie 仅存储 SHA-256 摘要。会话创建、撤销及对应审计在同一事务提交，授权被拒绝也记录审计；审计暂无业务修改或查询 API。

## 错误与部署边界

- 401：未登录、访问令牌无效或会话过期，需要重新认证。
- 403：无授权环境或写请求来源不符，联系管理员检查授权与平台地址。
- 429：请求频率过高，稍后重试；当前限流为单进程内存实现。
- 503：身份依赖不可用、授权文件无法读取或会话存储异常；检查服务和部署配置，不放宽鉴权。

服务默认不启用跨源 CORS。前端通过 Next.js 同源代理访问 API，浏览器写操作必须携带配置的来源。生产模式要求身份 URL 和平台来源均为 HTTPS、身份配置完整；数据库文件与密钥只允许服务账户访问。当前仅支持单实例，尚未完成生产部署验收。

## 前端运行与验证

在第二个终端执行 `npm ci --prefix web`、`npm run dev:web`，访问 `http://127.0.0.1:4320`。`HEALTH_API_ORIGIN` 默认 `http://127.0.0.1:4310`，只在 Next.js 服务端用于代理；更改该变量后重新构建前端。生产前端使用 `npm run build:web` 和 `npm run start --prefix web`，外部 TLS 由部署入口提供。

前端仅显示实际授权环境；服务无采样或数据过期时显示未知。管理员配置服务后自动执行 HTTP 探测，管理员及运维人员也可手动触发；白名单、采样口径及存储限制见 `docs/service-monitoring.md`。身份查询失败会隐藏原先受保护内容，401/403 返回登录，503 提供重试。首次未配置后端时显示配置错误，不启用默认账号。

执行 `npm run check:web` 验证设计令牌、前端构建与类型。设计规范为 `DESIGN.md`，运行令牌由 `npm run tokens` 生成。浏览器验证记录见 `docs/ui-verification.md`。

隔离 UI 联调用 `NODE_ENV=test` 启动 `npx tsx tests/support/ui-fixture.ts`，只监听本机 4310 并使用内存会话；测试身份和环境明确为 fixture，不属于真实运维数据。不能与真实后端同时占用该端口，不在正常启动或生产构建入口中引用。正式联调必须使用实际身份服务和管理员授予的用户标识。

MedicalCareWeb 当前 `/auth/me` 仅验证已签发 JWT，尚不支持立即感知上游账号停用或退出。平台每次请求验证上游凭据，但无法突破这一上游限制；可通过本地授权撤销立即阻止平台访问，正式接入时需补充可撤销会话或账号状态检查接口。

告警 UI 隔离测试可额外设置 `UI_ALERT_FIXTURE=1`，种子服务生成已恢复和待确认事件，并暂停该 fixture 自动采集。此模式仍要求 `NODE_ENV=test`，仅使用内存数据库，正常启动入口不读取该开关。使用结束后停止测试进程，正常联调不使用种子事件。
