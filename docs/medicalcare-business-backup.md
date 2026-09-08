# MedicalCareWeb 业务备份与恢复接入

## 核实范围（2026-09-08）

只读检查 F:/MedicalCareWeb：Prisma schema 使用 PostgreSQL，部署声明 postgres:17-alpine（medicalcare-postgres / medicalcare_chat / medicalcare）和 redis:7.4-alpine AOF，数据库不发布宿主机端口。RedisPresenceStore 存放 chat:presence 在线状态和 socket 集合，TTL 300 秒；当前源码未发现其他非测试 Redis 数据用途。以上不是对实际部署版本和 Redis 全部 key 的现场确认。

PostgreSQL 为业务备份主对象；本平台 db:snapshot 只备份自己的 SQLite，不能处理此业务库。

## 已实现：部署主机 PostgreSQL 导出命令

在有授权的 Docker 部署主机安装本工程 Node.js 依赖并构建，准备仅运维/备份账户可读写的备份父目录，然后运行：

```text
npm ci
npm run build
npm run backup:medicalcare -- /protected-backups/medicalcare-20260908
```

目标目录必须不存在。程序固定通过无 Shell 的 docker exec 执行 medicalcare-postgres 内的 pg_dump，固定数据库 medicalcare_chat、用户 medicalcare；使用容器内客户端和本地连接，不读取部署 .env，不把口令放入参数或日志。如果部署改变容器名、认证或数据库名，当前命令会失败，必须先审核适配，不提供任意命令或 URL 参数。当前复用部署账户，并非已完成独立最小权限备份账户配置。

导出为 custom 二进制归档 medicalcare.dump，直接文件描述符传输避免 PowerShell 文本管道破坏；检查 PGDMP 头并以同容器 pg_restore --list 检查目录，然后生成含 SHA-256 的 manifest.json。清单 archiveListChecked=true、restoreVerified=false；只说明导出与归档目录检查通过，不说明数据已成功恢复。命令最长等待 30 分钟，表锁等待 10 秒；Docker 客户端超时后容器内任务可能尚在运行，须由部署人员检查后再重试。失败不生成成功清单，残留目录保留；换新目录重试。原始数据库错误不写控制台，失败在部署机受控排查。

方法依据：[PostgreSQL 17 pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html) 支持并发使用期间的一致性逻辑导出；[pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html) 的 --list 只列归档目录。

备份包含真实业务数据时须加密存储、限制 ACL、按组织要求保留及异地保存。SHA-256 仅检测意外变化，不代表签名、防篡改或加密。本工具不导出集群角色/口令、其他数据库、授权文件、应用资源或服务配置，不提供 PITR；恢复前需单独重建角色映射并核实扩展、配置、代码版本和缺失数据时间窗口。

## 待执行：隔离 PostgreSQL 17 恢复演练

仅在独立演练主机/容器和全新数据库验证，不连接生产应用，不运行 schema push/seed，不覆盖生产库。先核对清单 SHA-256。部署人员准备全新的 PostgreSQL 17 容器 medicalcare-restore-check（禁止宿主机端口暴露，隔离网络，使用独立凭据和数据卷），等待其就绪，再执行：

```text
docker cp /protected-backups/medicalcare-20260908/medicalcare.dump medicalcare-restore-check:/tmp/medicalcare.dump
docker exec medicalcare-restore-check createdb -U postgres -T template0 medicalcare_drill
docker exec medicalcare-restore-check pg_restore -U postgres --dbname=medicalcare_drill --exit-on-error --single-transaction --no-owner --no-privileges /tmp/medicalcare.dump
```

示例假设隔离容器已配置 postgres 本地授权。恢复仅接受可信来源归档；--no-owner/--no-privileges 是隔离演练角色映射，不代表生产权限已还原。createdb 失败（包括名称已存在）须停止，不能继续执行恢复。命令应逐条核对退出码。

验收记录包括源版本/备份时间、哈希、退出码、表/关键业务记录数量、约束索引、Prisma 读取及关联完整性、附件/外部资源引用、耗时和可接受的数据缺口。把应用接向恢复库前隔离通知等外部副作用，并评估恢复的认证会话撤销。没有这些记录，保持“归档已生成，恢复未验收”；不得把 --list 成功当成演练通过。

## Redis 决策

当前 presence 是短期连接状态，不应把旧 ONLINE/socket 状态当作灾难恢复后的真实在线连接；应用重连应重建状态。先在部署现场只读核实 Redis 用途、key 前缀和持久化配置；若发现业务队列/其他持久数据，重新制定一致性恢复顺序。当前不自动清空 Redis、不关停或复制生产卷。

如确需保留 Redis 7 AOF，必须处理多文件 AOF 和 manifest 的一致性，不能只复制一个 appendonly.aof。具体停写/停止实例或受控快照方案依实际部署决定，参考 [Redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)。AOF 持久化本身不是异地备份，本阶段没有交付 Redis 备份执行器。

## 验证与接入限制

本机未发现 Docker、pg_dump、pg_restore，未连接真实服务器，也未读取业务数据或凭据。57 项后端测试及构建/启动 smoke 通过；新增模拟执行器测试覆盖二进制保真、固定参数、目录拒绝和导出/归档失败不生成成功清单。真实客户端、备份权限、容量、恢复演练、RPO/RTO、保留清理与平台受控任务接口仍待接入。
