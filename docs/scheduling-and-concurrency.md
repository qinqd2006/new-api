# 任务调度、并发控制与限流

本文记录 new-api 后端在**任务调度**、**并发控制**、**限流**三个方向上的实现现状：每一层用什么机制、哪些开关可配、以及哪些控制项**不存在**。所有结论均来自源码阅读与本地实测，文中的 `文件:行号` 可直接定位。

阅读顺序建议：先看 [2. 结论摘要](#2-结论摘要) 建立整体印象，再按需跳转。

---

## 1. 范围与术语

| 术语 | 含义 |
| --- | --- |
| 系统任务 | 由 `service/system_task.go` 框架驱动、写 `system_tasks` 表、有运行历史的周期性作业 |
| 裸循环 | 进程内的 `for { time.Sleep(...) }` / `time.NewTicker` goroutine，无跨节点协调 |
| 在途并发 | 同时正在执行的请求数（区别于单位时间内的请求数） |
| 固定窗口 | 限流器在一个时间窗内计数，窗口边界可突发至 2 倍额度 |
| 滑动窗口 | 限流器保留窗口内全部时间戳，判定更严格 |

---

## 2. 结论摘要

调度侧做得完整，**并发侧基本是空白**，两者本该配套但没有对齐。

| 维度 | 状态 |
| --- | --- |
| 任务调度 | 有，且分三层：DB 租约的系统任务框架（5 类任务，仅 master 节点，跨节点去重）+ 17 个裸循环（每节点都跑，无协调）+ 请求级 goroutine |
| 每渠道在途并发上限 | **不存在**。无信号量、无计数器、无 Redis 键、无 DB 租约 |
| 全局 relay 并发上限 | **不存在**。`common/gopool.go:13` 的池容量为 `math.MaxInt32` |
| 请求排队 / 背压队列 | **不存在** |
| 单请求总超时 | **不存在**。`http.Server` 未设 ReadTimeout/WriteTimeout，relay 路径无 `context.WithTimeout` |
| 渠道健康检查并发 | **存在**。worker pool，1–32，默认 1 |
| 全局资源过载熔断 | **存在**。CPU/内存/磁盘连续 3 次采样超阈值才拒绝 |
| 限流器 | 18 个，但**只有 5 个 `ModelRequestRateLimit*` 选项**可在管理后台配置，其余为环境变量或硬编码 |
| Token 吞吐（TPM）限制 | **不存在**。定价页展示的 RPM/TPM 表是前端 mock 数据 |

### 实际影响

某上游变慢时，因为既无在途上限也无请求级 deadline，慢请求会与客户端请求数 **1:1** 累积 goroutine 和响应体缓冲，直到触发全局熔断器（默认 CPU/内存阈值 90%，来得相当晚）。详见 [6. 缺口清单](#6-缺口清单)。

---

## 3. 任务调度

### 3.1 三套体系并存

**A. 系统任务框架** —— 唯一具备跨节点协调的体系，详见 [3.2](#32-系统任务框架db-租约)。

**B. 裸循环** —— 较早引入的作业，每个节点都独立运行，详见 [3.3](#33-裸循环)。

**C. 请求级 goroutine** —— SSE 保活、插件协议观察器、通知发送等，随请求生命周期存在，不在本文展开。

### 3.2 系统任务框架（DB 租约）

入口 `service.StartSystemTaskRunner`（`service/system_task.go:123`），由 `main.go:158` 启动。

#### 3.2.1 单 goroutine 驱动两趟

```
ticker 15s ──► runPass()
                 ├─ 陈旧租约清扫  (≥30s 才跑一次)
                 ├─ 调度趟        (≥15s 才跑一次) → 建 system_tasks 行
                 └─ 认领趟        (每次都跑)     → 认领 + 分发
```

- ticker 间隔 `systemTaskRunnerIdleInterval = 15s`（`service/system_task.go:20`）
- 调度趟节流 `systemTaskSchedulerInterval = 15s`（`:26`）、陈旧租约清扫 `systemTaskStaleLockInterval = 30s`（`:27`）
- 调度趟与认领趟**共用同一个 goroutine**（`:138-154`），任一处的慢查询会拖慢另一处
- 另有 `systemTaskWakeup`（容量 1 的 buffered channel，`:110`）用于即时唤醒；唤醒时若已有待处理信号则合并，下一轮统一处理

#### 3.2.2 两道跨节点去重

| 环节 | 机制 | 位置 |
| --- | --- | --- |
| **创建**去重 | `system_tasks.active_key` 唯一索引（值为任务类型） | `model/system_task.go:33`，写入于 `:107` |
| **执行**去重 | `system_task_locks` 每类型一行租约 | `model/system_task.go:313` `acquireSystemTaskLock` |

租约语义（`model/system_task.go:313-352`）：

1. 尝试插入 `system_task_locks` 行（主键 = 类型），成功即获得租约。
2. 插入失败说明该类型已被占用，读取现有行：若 `locked_until >= now` 则放弃。
3. 若已过期，用条件更新 `WHERE type = ? AND locked_until < ?` 抢占（`:337-341`），`RowsAffected == 0` 表示被他人抢先。

认领流程 `ClaimSystemTask`（`:270`）：先取租约，再以条件更新 `WHERE id = ? AND type = ? AND status = pending` 置为 `running`（`:291-297`），`RowsAffected == 0` 表示认领失败并释放租约（`:302-305`）。

#### 3.2.3 租约心跳

`runWithLeaseHeartbeat`（`service/system_task.go:308`）：

- handler 的 context **派生自 `context.Background()`**，与任何请求 context 无关（`:309`）
- 每 `TTL/3 = 20s` 续租一次（`:312-315`）
- **续租失败即 `cancel()` handler 的 ctx 并退出心跳**（`:326-329`）——这是失去租约的 runner 停止其 handler 的机制
- TTL 是**崩溃检测窗口，不是任务时限**；只要心跳成功，任意长的 handler 都可继续运行

#### 3.2.4 已注册的任务

注册于 `controller.RegisterScheduledSystemTasks`（`controller/system_task_handlers.go:19`），另有 `logCleanupHandler` 在 `service/system_task.go:86` 的 `init()` 中注册。

| 类型 | 周期 | `Enabled()` 条件 | 内部并发 | 位置 |
| --- | --- | --- | --- | --- |
| `channel_test` | `auto_test_channel_minutes` 分钟，下限 10 | `monitor_setting.auto_test_channel_enabled`（默认 **false**） | worker pool **1–32，默认 1** | `controller/system_task_handlers.go:29` |
| `model_update` | env `CHANNEL_UPSTREAM_MODEL_UPDATE_TASK_INTERVAL_MINUTES`，默认 **30 分** | env，默认 **true** | **串行**，每批 100 渠道 | `:72` |
| `midjourney_poll` | **15s** | `constant.UpdateTask && HasUnfinishedMidjourneyTasks()` | 串行，每渠道 15s HTTP 超时 | `:117` |
| `async_task_poll` | **15s** | `constant.UpdateTask && HasUnfinishedSyncTasks()` | 视频路径**每渠道一个 goroutine，无上限** | `:137` |
| `log_cleanup` | 仅手动（`POST /api/system-task/log-cleanup`） | — | 批 100 | `service/system_task.go:78` |

两个轮询 handler 把"是否有待办"折进了 `Enabled()`，因此系统空闲时**不产生任何行**（`HasUnfinishedSyncTasks` 是 `LIMIT 1` 探测，`model/task.go:395`）。

#### 3.2.5 调度趟与认领趟的细节

调度趟 `runSystemTaskScheduler`（`service/system_task.go:263`）：

- 只处理实现了 `ScheduledSystemTaskHandler` 且 `Enabled()` 为真的 handler（`:267-276`）
- 间隔判定用 `now - latest.UpdatedAt < Interval().Seconds()`（`:287`）。`UpdatedAt` 是**上次运行结束时**的时间戳（`FinishSystemTask` 写入，`model/system_task.go:455`），因此实际周期为 `间隔 + 运行时长`
- handler 遍历顺序来自 **map 迭代**，每趟随机（`:266`）

认领趟 `runSystemTaskClaimPass`（`:225`）：

- 通过 `FindEarliestPendingSystemTasks` 取每类型最早的一行 pending 任务（`model/system_task.go:158`）
- **每类型每趟只认领一个任务**
- 认领成功后每个任务分派到**独立 goroutine**（`:251` `gopool.Go`），因此长时间运行的渠道测试不会阻塞 15s 轮询

#### 3.2.6 运行历史与可观测性

`system_tasks` 表就是历史。`FinishSystemTask`（`model/system_task.go:444`）的条件更新带 `EXISTS` 子查询，要求租约仍属当前 runner 且未过期；进度写入 `UpdateSystemTaskState`（`:354`）额外做了 MySQL "changed rows vs matched rows" 修正（`:377-390`）。

进度节流由 `NewSystemTaskProgressReporter`（`service/system_task.go:478`）实现：最多每 2 秒写一次（`:479`），首次更新和最终 100% 必发。

管理接口（均需 root）：`GET /api/system-task/list`、`/current`、`/:task_id`、`POST /log-cleanup`、`DELETE /history`（`router/api-router.go:334-341`）。

> **注意**：`Enabled()` 为 false 时不建行、不打日志，因此**"任务被禁用"与"任务无活干"在接口上无法区分**。`GET /api/status` 也不含任何调度器字段。

### 3.3 裸循环

以下作业是进程内 goroutine，**每个节点都独立运行**，无跨节点协调。

| 作业 | 周期 | 启动位置 | 执行位置 | master 限定 |
| --- | --- | --- | --- | --- |
| 选项热加载 | `SYNC_FREQUENCY`，默认 60s | `main.go:114` | `model/option.go:226` | 否 |
| 渠道缓存同步 | 60s | `main.go:105` | `model/channel_cache.go:109` | 否 |
| Casbin 策略同步 | 60s | `main.go:118` | `service/authz/enforcer.go:84` | 否 |
| 任务插件注册表同步 | 30s | `main.go:115` | `controller/task_plugin.go:1001` | 否 |
| 看板数据导出 | `DataExportInterval` 分钟，默认 5 | `main.go:121` | `model/usedata.go:45` | 否 |
| **批量写入器** | `BATCH_UPDATE_INTERVAL`，默认 5s | `main.go:163` | `model/utils.go:34` | 否（env 开关） |
| 渠道余额轮询 | env `CHANNEL_UPDATE_FREQUENCY`（分钟） | `main.go:128` | `controller/channel-billing.go:781` | 否（env 开关） |
| Codex 凭据刷新 | 10min | `main.go:132` | `service/codex_credential_refresh_task.go:34` | **是** |
| 订阅额度重置 / 过期 | 1min | `main.go:135` | `service/subscription_reset_task.go:28` | **是** |
| 系统实例上报 | 30s | `main.go:139` | `service/system_instance.go:65` | 否（设计如此） |
| 认证产物清理 | 1h | `main.go:367` | `service/auth_cleanup.go:15` | **是** |
| 通知限流内存清理 | 1h | 惰性 `sync.Once` | `service/notify-limit.go:31` | 否 |
| 性能指标 flush | 默认 5min | `main.go:344` | `pkg/perf_metrics/flush.go:12` | 否 |
| 系统监控采样 | 5s | `main.go:347` | `common/system_monitor.go:64` | 否 |
| pprof CPU 采样 | 30s | `main.go:167` | `common/pprof.go:13` | 否 |
| 内存限流器 LRU 清理 | 20min | 惰性 | `common/rate-limit.go:100` | 否 |
| 日志导出锁续租 | 20s（每次导出一个） | 每次导出 | `service/log_export.go:50` | 否 |

`Codex 凭据刷新` 与 `订阅重置` 虽然限定 master，但仍用进程内 `atomic.Bool` 做 CAS（`service/codex_credential_refresh_task.go:27`、`:55`；`service/subscription_reset_task.go:24`），而非 DB 租约。

### 3.4 批量写入器

`model.InitBatchUpdater`（`model/utils.go:34`）由 env `BATCH_UPDATE_ENABLED=true` 开启（`main.go:160`），每 5 秒 flush 一次。

合并 5 类额度 delta（`model/utils.go:15-22`），每类一个 `map[int]int` + 一个 `sync.Mutex`：

| 常量 | 含义 |
| --- | --- |
| `BatchUpdateTypeUserQuota` | 用户钱包 delta |
| `BatchUpdateTypeTokenQuota` | 令牌 `remain_quota` delta |
| `BatchUpdateTypeUsedQuota` | 用户 `used_quota` delta |
| `BatchUpdateTypeChannelUsedQuota` | 渠道 `used_quota` delta |
| `BatchUpdateTypeRequestCount` | 用户 `request_count` delta |

Flush 采用 **swap-and-flush**（`model/utils.go:82-88`）：锁内换上新 map，生产者继续写入新 map，不被 DB 写阻塞。用户类的 3 种 delta 会**合并成单条 UPDATE**（`model/user.go:1472`）；令牌和渠道仍逐 id 一条 UPDATE（`model/utils.go:94-104`）——即只合并了 delta，没有合并 SQL。

**关键语义**：

- **Redis 缓存立即更新，DB 最多滞后 5 秒**。`model/user.go:1349-1352` 在入队的同时 `gopool.Go` 更新缓存；读路径走缓存，读 DB 的代码在批量窗口内看到的是批次前的值
- 溢出保护：`addNewRecord`（`model/utils.go:43`）检测加法溢出并钳制到 `math.MaxInt`/`math.MinInt`（`:53-60`）
- **不是 master 限定**：N 个节点各有独立 flusher，但写入的都是加法表达式，并发安全

### 3.5 异步任务轮询

`service.RunTaskPollingOnce`（`service/task_polling.go:135`）是 `async_task_poll` 的执行体。

流程：

1. `sweepTimedOutTasks`（`:145`）—— **超时清扫，只在这个 handler 内部**
2. `GetAllUnFinishSyncTasks(TASK_QUERY_LIMIT)`（`:146`），默认上限 1000
3. 按 `task.Platform` 分组（`:149-151`），**map 迭代 → 平台顺序随机**
4. 上游 ID 为空的任务批量标记失败（`:177-190`）
5. `DispatchPlatformUpdate`（`:196`）按平台分派

三种轮询路径的并发特征：

| 路径 | 并发方式 | 位置 |
| --- | --- | --- |
| 批量 | **串行**，逐渠道一次请求带全部任务 ID | `service/task_polling.go:226` |
| 视频 | **每渠道一个 goroutine，无上限** | `:396`，`gopool.Go` 于 `:412` |
| Midjourney | 串行，每渠道 15s HTTP 超时 | `controller/midjourney.go:80` |

视频路径内，渠道内部的任务**逐个串行**且每个任务之间 sleep 1 秒（`:474-482`），除非渠道设置了 `disable_task_polling_sleep`（`relaykit/dto/channel_settings.go:125`）。

#### 幂等与计费只结算一次

终态迁移全部走 **status 列 CAS**：`Task.UpdateWithStatus(fromStatus)`（`model/task.go:557`）、`Midjourney.UpdateWithStatus`（`model/midjourney.go:194`）。CAS 失败者跳过计费（`service/task_polling.go:601-604`），因此**只有 CAS 赢家执行结算或退款**。

结算优先级（`settleTaskBillingOnComplete`，`service/task_polling.go:697`）：① 表达式快照 → ② 适配器 `AdjustBillingOnComplete` → ③ token 重算。

#### 超时与失败阈值

| 阈值 | 值 | 位置 |
| --- | --- | --- |
| 任务硬超时 | `TASK_TIMEOUT_MINUTES`，默认 **4320**（72h），0 关闭 | `service/task_polling.go:71-120` |
| 超时清扫批量 | **100 条/趟** | `:76` |
| 连续轮询失败上限 | `TASK_POLL_MAX_FAILURES`，默认 **20** | `:786-806` |
| 轮询查询上限 | `TASK_QUERY_LIMIT`，默认 **1000** | `common/init.go:209` |

连续失败计数在**成功的非终态轮询后清零**（`:357`、`:576`）。

Midjourney 另有一条**硬编码 1 小时**超时（`controller/midjourney.go:165-169`），与 `TASK_TIMEOUT_MINUTES` 无关。

---

## 4. 并发控制

### 4.1 不存在的控制项

| 控制项 | 存在？ | 证据 |
| --- | --- | --- |
| 每渠道在途请求上限 | **否** | `http.Transport.MaxConnsPerHost` 全仓库 **0 处匹配**（保持零值 = 不限）；`dto.ChannelSettings`（`relaykit/dto/channel_settings.go:13-37`）与 `model.Channel`（`model/channel.go:24-62`）均无并发/限流字段 |
| 全局 relay 并发上限 | **否** | 唯一的信号量在 JS 插件运行时（`pkg/jsplugin/engine.go:183`，默认 8），不治理上游 HTTP；`common/gopool.go:13` 池容量 `math.MaxInt32` |
| 请求排队 / 背压队列 | **否** | relay 路径无队列；`service/system_task.go` 的队列只服务管理任务 |
| HTTP Server 读写/空闲超时 | **否** | `main.go:205-208` 只设 `Addr` 与 `Handler` |
| 单请求总超时 | **否** | relay 路径无 `context.WithTimeout`；上游请求用无 ctx 的 `http.NewRequest`（`relay/channel/api_request.go:329`、`:357`），仅任务路径绑定客户端 ctx（`:553`） |
| 非流式响应体读取超时 | **否**（除非显式设 `RELAY_TIMEOUT`） | 适配器用 `io.ReadAll(resp.Body)`（如 `relay/channel/openai/relay_responses.go:25`），而 `http.Client.Timeout` 默认为 0 |
| **按渠道**分片连接池 | **否** | 客户端按 `(proxy, policy)` 缓存（`service/http_client.go:143-145`），同设置渠道**共享连接池**；分片在客户端内部按 origin 轮询（`service/http_transport_sharded.go:47-54`） |

`model/channel.go:650-659` 的 `GetChannelPollingLock` 是每渠道 `sync.Mutex`，但只用于**多 Key 选取**的线程安全，持有时间不覆盖上游调用，不构成并发闸门。

`pkg/wsmanager/wsmanager.go:47-81` 统计每渠道的**存活 WebSocket 会话数**，用于渠道禁用时关闭连接，不限制数量。

### 4.2 存在的控制项

#### 渠道健康检查并发（唯一的有界并发）

`runChannelTestWorkers`（`controller/channel-test.go:975`）：

- worker 数 `min(NormalizeChannelTestConcurrency(concurrency), total)`（`:993`）
- N 个 goroutine 从**无缓冲** `jobs` channel 拉取（`:994`），结果写入无缓冲 `results` 由调用方串行归约（`:995`、`:1055-1062`）
- 每次测试后按 `common.RequestInterval`（env `POLLING_INTERVAL`）间隔（`:1021-1027`）
- 响应 `ctx.Done()` 取消（`:1005`、`:1023`、`:1036`）

配置项：

| 项 | 值 |
| --- | --- |
| 选项键 | `monitor_setting.channel_test_concurrency` |
| Getter | `operation_setting.GetMonitorSetting().ChannelTestConcurrency` |
| 默认 | **1**（`setting/operation_setting/monitor_setting.go:24`） |
| 上限 | **32**（`:25`） |
| 钳制 | `NormalizeChannelTestConcurrency`（`:65-73`） |
| 写入校验 | `ValidateChannelTestConcurrency`（`:75-81`） |

#### 全局资源过载熔断

`middleware.SystemPerformanceCheck()`（`middleware/performance.go:14`）→ `common.CheckSystemOverload`（`common/system_monitor.go:146`）：

- CPU / 内存 / 磁盘任一超阈值即拒绝，返回 **503**
- 需要**连续 3 次采样**都超阈值才判定过载（`overloadConsecutiveSamples = 3`，`:56`），单次尖峰不会熔断
- 采样间隔 5s（`:53`）；采样超过 30s 未刷新则不据此熔断（`systemStatusMaxAge`，`:57`）

配置项 `performance_setting`（`setting/performance_setting/config.go`）：`monitor_enabled`（默认 true）、`monitor_cpu_threshold`（90）、`monitor_memory_threshold`（90）、`monitor_disk_threshold`（95）。

挂在 relay 路由上（`router/relay-router.go:73`、`:191`、`:206`）。

> 该熔断器是**资源型**，不是并发型：它限制的是"系统是否已经过载"，不是"同时允许多少请求"。

### 4.3 渠道选择与重试

#### 选择算法：优先级分层 + 权重随机

内存缓存路径 `model.GetRandomSatisfiedChannel`（`model/channel_cache.go:117`）：

1. 从 `group2model2channels[group][model]` 取候选（`:132`），经 `filterCandidateIDs`（`model/channel_constraint.go:41`）过滤
2. 无候选则退回归一化模型名（`:136-137`）
3. 收集所有 distinct priority 并**降序排序**（`:151-163`）
4. `retry` 索引该分层列表，超界则钳到最低层（`:165-168`）
5. 在目标层内按**权重比例随机**：累加 `GetWeight()`（`:176`）；全为 0 时每个渠道等效权重 100（`:192-196`）；平均权重 < 10 时平滑因子置 100（`:197-200`）；`rand.Intn(totalWeight)` 后线性递减命中（`:206-213`）

数据库路径（内存缓存关闭）`model.GetChannel`（`model/ability.go:108`），权重按 `weight + 10`（`:149-161`）。

#### 重试循环

`controller/relay.go:177`：

```go
for ; retryParam.GetRetry() <= common.RetryTimes; retryParam.IncreaseRetry()
```

因此**上游尝试次数 ≤ RetryTimes + 1**。

`RetryTimes` 运行时全局默认 **0**（`common/constants.go:143`），由 DB 选项 `"RetryTimes"` 覆盖（`model/option.go:171`、`:656-657`），校验见 `model/request_policy.go:129-132`。**无对应环境变量**。默认 0 = 只尝试一次，不重试。

任务路径同一预算（`controller/relay.go:542`），Responses WebSocket 同（`relay/responses_websocket.go:298`）。

重试决策 `service.DecideRelayRetry`（`service/relay_error.go:20`）优先级：

1. 亲和 strict 模式失败 → 停（`:24`）
2. 渠道约束抑制重试（pin）→ 停（`:31`）
3. 渠道级错误 → 重试（`:34`）
4. 标记为不可重试的错误 → 停（`:37`）
5. 预算耗尽 → 停（`:40`）
6. 2xx → 停（`:44`）
7. 状态码越界 → 重试（`:47`）
8. 管理员"永不重试"名单 → 停（`:50`）
9. 命中状态码区间 → 重试（`:53`）
10. 否则 → 停

可重试状态码区间默认 `100-199, 300-399, 401-407, 409-499, 500-503, 505-523, 525-599`（`setting/operation_setting/status_code_ranges.go:21-29`），**504 与 524 硬编码为永不重试**（`:31-34`）。配置项 `"AutomaticRetryStatusCodes"`。

#### 跨分组重试（"auto" 分组）

`service.CacheGetRandomSatisfiedChannel`（`service/channel_select.go:114`）：

- auto 分组列表来自 `GetRequestAutoGroups`（`service/group.go:98`）：优先取令牌快照（`ContextKeyTokenAutoGroups`），否则用全局 Auto 列表按用户可选分组过滤，上限 `MaxTokenAutoGroups`（默认 **5**，`setting/auto_group.go:12`）
- 分组游标存在 context 的 `ContextKeyAutoGroupIndex`（`service/channel_select.go:133-137`）
- 跨组重试由**每个令牌**的 `token.CrossGroupRetry` 决定（`middleware/auth.go:692` → `service/channel_select.go:131`）
- 当前分组耗尽时切到下一分组，重置重试计数与亲和偏移（`:157-170`）
- `crossGroupRetry && groupRetry >= RetryTimes` 时，**安排**下一次重试切组（`:177-189`）


#### 渠道亲和（粘性会话）

- 配置 `operation_setting.ChannelAffinitySetting`（`setting/operation_setting/channel_affinity_setting.go:33`），选项前缀 `channel_affinity_setting.`
- 默认：`Enabled: true`、`SwitchOnSuccess: true`、`KeepOnChannelDisabled: false`、`MaxEntries: 100000`、`DefaultTTLSeconds: 3600`，并内置 "codex cli trace" 与 "claude cli trace" 两条规则（`:117-155`）
- 查询 `GetPreferredChannelByAffinity`（`service/channel_affinity.go:550`）；写回 `RecordChannelAffinity`（`:729`），成功渠道在 `SwitchOnSuccess` 下胜出
- 缓存为 `cachex.HybridCache[int]`：有 Redis 用 Redis，否则内存 LRU + TTL + janitor（`service/channel_affinity.go:83-110`）
- 会话模式 `off` / `prefer` / `strict`（`service/request_policy.go:149`）；strict 模式下绑定渠道不可用时返回 503 `strict_session_binding_unavailable`（`service/channel_select.go:369-371`）
- 亲和**只在第 0 次尝试生效**（`service/channel_select.go:337`）

### 4.4 HTTP 客户端与超时

`newRelayHTTPTransport`（`service/http_client.go:79`）：

| 设置 | 环境变量 | 默认 | 位置 |
| --- | --- | --- | --- |
| `MaxIdleConns` | `RELAY_MAX_IDLE_CONNS` | **500** | `common/init.go:119` |
| `MaxIdleConnsPerHost` | `RELAY_MAX_IDLE_CONNS_PER_HOST` | **100** | `:120` |
| `MaxConnsPerHost` | — | **不设置 = 不限** | — |
| `IdleConnTimeout` | `RELAY_IDLE_CONN_TIMEOUT` | **90s** | `:115` |
| `ResponseHeaderTimeout` | `RELAY_RESPONSE_HEADER_TIMEOUT` | **1800s**（0 关闭） | `:118` |
| `http.Client.Timeout` | `RELAY_TIMEOUT` | **0 = 不限** | `:114`、`service/http_client.go:137-139` |
| HTTP/2 ping | `RELAY_HTTP2_PING_IDLE_TIMEOUT` / `RELAY_HTTP2_PING_TIMEOUT` | **0**（关闭）/ **15s** | `:116-117` |
| `TLSHandshakeTimeout` | — | 10s（仅手建 fallback transport） | `service/http_client.go:92` |

`ResponseHeaderTimeout` 只约束**等待响应头**的时间；头到达后的流式传输不受影响（注释见 `common/constants.go:179-186`）。流式响应另有空闲超时 `STREAMING_TIMEOUT`（默认 **300s**，`common/init.go:187`），每收到一个 chunk 重置（`relay/helper/stream_scanner.go:137`、`:142`）。

分片传输 `shardedRoundTripper`（`service/http_transport_sharded.go:17`）：

- N = `policy.Shards`（1–8，`relaykit/dto/channel_settings.go:68`），每个分片一个独立 `*http.Transport`（`:24-37`）
- 每分片平分 `MaxIdleConns` / `MaxIdleConnsPerHost`（`:29-30`）
- 分片按 **origin**（`scheme://host`）轮询，用 per-origin `atomic.Uint32` 计数（`:41-54`）
- 客户端缓存键是 `(proxy, protocol|shards|tlsInsecureSkipVerify)`（`service/http_client.go:143-145`）——**不是按渠道**

策略归一与钳制见 `service.NormalizeHTTPTransportPolicy`（`service/http_transport_policy.go:33`）：未知协议回落 auto 并告警一次；`shards` 为 0 或 <1 归 1，>8 归 8；强制 http1 时 `Shards = 1`。

---

## 5. 限流

### 5.1 限流器总表

| # | 限流器 | 维度 | 窗口/额度 | 后端 | 可配来源 | 默认 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `GlobalAPIRateLimit` | IP | 360 / 180s | Redis 固定窗口 / 内存滑动 | env | true / 360 / 180 |
| 2 | `GlobalWebRateLimit` | IP | 120 / 180s | 同上 | env | true / 120 / 180 |
| 3 | `GlobalStaticRateLimit` | IP | 1000 / 180s | 同上 | env | **false** / 1000 / 180 |
| 4 | `CriticalRateLimit` | IP | 20 / 1200s | 同上 | env | true / 20 / 1200 |
| 5 | `UserCriticalRateLimit(scope)` | **用户 ID** | 20 / 1200s | 同上 | env | 同 #4 |
| 6 | `EmailVerificationRateLimit` | IP | 2 / 30s | 同上 | **硬编码** | — |
| 7 | `SearchRateLimit` | **用户 ID** | 10 / 60s | 同上 | env | true / 10 / 60 |
| 8 | `ModelRequestRateLimit` 成功计数 | 用户(+分组) | 1000 / 1min | Redis 时间戳 list / 内存滑动+预留 | **DB 选项** | false / 1000 / 1min |
| 9 | `ModelRequestRateLimit` 总计数 | 用户(+分组) | 0（不限） | Redis 令牌桶 / 内存滑动 | **DB 选项** | 0 |
| 10 | `DownloadRateLimit` | IP | 10 / 60s | — | **无，且未挂任何路由** | — |
| 11 | `UploadRateLimit` | IP | 10 / 60s | — | **无，且未挂任何路由** | — |
| 12 | `CheckNotificationLimit` | 用户+通知类型 | 2 / 10min | Redis pipeline / `sync.Map` | env | 2 / 10min |
| 13 | 任务产物非法访问 | IP | 60 / 60s | 进程内 | env | 60 |
| 14 | 任务产物并发 | 全局/IP/对象 | 128 / 64 / 16 在途 | 进程内 | env | 128/64/16 |
| 15 | 插件协议观察准入 | 全局/插件/用户/令牌 | 128 / 32 / 4 / 2 在途 | 进程内 | **硬编码** | — |
| 16 | 登录会话活跃上限 | 用户 ID | 50 并发 | DB 计数 | env | 50 |
| 17 | 登录会话签发上限 | 用户 ID | 100 / 24h | DB 计数 | env | 100 / 86400 |
| 18 | 匿名请求体上限 | — | 512KB | 直接 413 | env | 512KB |

env 变量与默认值集中于 `common/init.go:126-146`、`:150-152`、`:193`、`:202-203`。

**只有 #8、#9 能在管理后台配置**（`model/option.go:152-155`），其余全部是环境变量或硬编码。

### 5.2 机制细节

**Redis 固定窗口**（#1–#7）：单个 Lua 脚本 `redisFixedWindowScript`（`middleware/rate-limit.go:23-36`）把 INCR + EXPIRE + 判定合并为一次原子调用。键格式 `rateLimit:v2:ip:<mark>:<ip>` 与 `rateLimit:v2:user:<mark>:<id>`（`:45-51`）。**窗口边界可突发至 2 倍额度**，这是有意为之（`:18-22`）。

**内存滑动窗口**（#1–#7、#9 的内存路径）：`common.InMemoryRateLimiter`（`common/rate-limit.go:70`），每键一个时间戳队列 + LRU 淘汰，与 Redis 固定窗口的边界行为不同。

**Redis 令牌桶**（#9 总计数）：`common/limiter/lua/rate_limit.lua`，用 Redis 服务端 `TIME` 补充令牌，容量 `count × duration`、补充速率 `count`/秒、每请求扣 `duration`。Lua 中的 `EXPIRE` 被注释掉（`:42`），桶键不会过期。

**预留机制**（内存路径的成功计数）：`RateLimitReservation`（`common/rate-limit.go:170`）在**准入时**占用一个槽位，`Complete(true)` 才记入滑动窗口，`Complete(false)` 仅释放槽位。这避免了并发请求同时穿透窗口。

### 5.3 `ModelRequestRateLimit` 详解

选项键（`setting/rate_limit.go:21-25`）：

| 选项 | 默认 | 含义 |
| --- | --- | --- |
| `ModelRequestRateLimitEnabled` | **false** | 总开关 |
| `ModelRequestRateLimitDurationMinutes` | 1 | 窗口（分钟） |
| `ModelRequestRateLimitCount` | 0 | 总请求数上限，**0 = 不限** |
| `ModelRequestRateLimitSuccessCount` | 1000 | 成功请求数上限 |
| `ModelRequestRateLimitGroup` | `{}` | 分组独立限额 |

**命名与语义不符**：subject 是 `userID` 或 `userID:group`（`middleware/model-rate-limit.go:194`、`:198`），**不含模型**。全仓库没有 per-model 请求限流。

分组优先级：**令牌分组优先，用户分组兜底**（`:187-190`）。分组只有在 `ModelRequestRateLimitGroup` 中有条目时才使用独立限额并把分组拼进 subject（`:195-199`）；未配置的分组共享裸 `userID` 桶。

**成功的判定**（`:167-170`）：HTTP 状态码 < 400 **且** 流状态未标记失败。200 但流中途失败（`server_error`）**不消耗**成功额度。

**计数的时机差异**：

- Redis 路径：成功时间戳在 `c.Next()` **之后**才记录（`:129-131`），因此 N 个并发成功请求可在任何一条被记录前全部通过
- 内存路径：`Reserve` 在准入时占位（`:151`），并发安全

**总计数两种后端语义不同**：Redis 是令牌桶（突发容量 `count × duration`），内存是滑动窗口（突发 `count`）。同一配置在两种后端下的实际放行量差别显著。

### 5.4 路由挂载

| 路由面 | 限流器 |
| --- | --- |
| `/api/**` 全组 | `GlobalAPIRateLimit`（`router/api-router.go:23`） |
| 登录 / 注册 / 密码重置 / OAuth / 2FA / 访问令牌 / 支付发起 / 令牌密钥导出 | `CriticalRateLimit`（`api-router.go:47-139`、`:291`、`:296`） |
| 账户安全 / 安全验证 / 访问令牌 / 邀请额度转移 | `UserCriticalRateLimit(scope)`（`:51-53`、`:73`、`:110-113`、`:134`、`:139`） |
| 令牌搜索、日志搜索 | `SearchRateLimit`（`:288`、`:332`） |
| 邮箱验证码 | `EmailVerificationRateLimit`（`:46`） |
| `/v1/**`（chat / responses / messages / embeddings / audio / rerank / moderations 等） | `ModelRequestRateLimit`（`router/relay-router.go:80`） |
| `GET /v1/realtime` | 同上（`:80`） |
| `/v1beta/**`（Gemini） | 同上（`:214`） |
| 插件生产路由 | 同上（`router/plugin-router.go:153`） |
| 任务插件协议 create 路由 | 同上（`router/task-plugin-protocol-router.go:32`、`:40`、`:48`） |

**未被限流覆盖的 relay 路由**：

| 路由 | 说明 |
| --- | --- |
| `GET /v1/responses`（WebSocket） | 路由注册在限流中间件**之前**（`relay-router.go:78` vs `:80`）；HTTP 握手不受限，仅每个 `response.create` 事件单独计数（`controller/responses_websocket.go:41`），**无并发连接数上限** |
| `GET /v1/models`、`GET /v1beta/models` | 仅 `TokenAuth` |
| `/mj/**` | 仅 `TokenAuth` + `Distribute`，而该路径会产生上游计费 |
| `POST /pg/chat/completions`（playground） | 仅 `UserAuth` |
| `POST /v1/tasks/:key`（任务提交） | 无 `ModelRequestRateLimit` |
| `GET /v1/tasks/:key` 等读路径 | 无 |
| `GET /v1/video/generations/:task_id`、`POST /v1/videos/:id/remix` | 无；`remix` 是写路径 |
| 支付 webhook（Stripe / Creem / Waffo / Waffo-Pancake） | **完全无限流**，外部可达且免鉴权（`api-router.go:64-69`） |
| 订阅支付回调 | 无（`api-router.go:208-211`） |
| `FRONTEND_BASE_URL` 重定向分支 | 绕过 `GlobalWebRateLimit`（`router/main.go:35-42`） |

### 5.5 Redis 故障行为

`common/redis.go:24-53`：`REDIS_CONN_STRING` 未设置时 `RedisEnabled = false`（`:25-29`），此后**运行期不再翻转**。启动时 ping 失败是**致命**的——`FatalLog` 调用 `os.Exit(1)`（`:46-48`），因此"Redis 启动即挂"意味着进程根本起不来。

| 限流器 | Redis 故障 | 证据 |
| --- | --- | --- |
| IP 维度（#1–#4） | **Fail closed** → HTTP 500 空体 | `middleware/rate-limit.go:117-122` |
| 用户维度（#5、#7） | **Fail closed** → HTTP 500 | `middleware/rate-limit.go:252-257` |
| 邮箱验证（#6） | **Fail open** → 回落内存限流器 | `middleware/email-verification-rate-limit.go:24-27` |
| 模型限流成功计数（#8 Redis） | **Fail closed** → HTTP 500 `rate_limit_check_failed` | `middleware/model-rate-limit.go:89-94` |
| 模型限流总计数（#9 Redis） | **Fail closed** → HTTP 500 | `middleware/model-rate-limit.go:111-117` |
| 通知限流（#12） | **Fail closed** → 放弃发送 | `service/notify-limit.go:65-67` |

### 5.6 多节点一致性注意事项

1. **后端选择在路由注册时冻结**。`rateLimitFactory`（`middleware/rate-limit.go:148`）在路由构建时读取 `common.RedisEnabled`，不是逐请求判断。启动时无 Redis 的节点会永远使用内存限流器，各节点可能同时执行**不同**的限额。
2. **内存限流按进程计数**。N 个节点在负载均衡后合计放行 N × 阈值。
3. **Redis 与内存的算法不同**（固定窗口 vs 滑动窗口），切换后端会改变边界行为与实际吞吐。
4. **`common/limiter` 绑定第一个 Redis 客户端**。`New` 用 `sync.Once`（`common/limiter/limiter.go:27-42`），若 `common.RDB` 被替换，限流器仍对旧客户端求值。
5. **模型限流的成功计数有跨节点滞后**。成功时间戳在请求结束后才记录，N 个节点可各自放行至 `successMaxCount` 个在途请求。
6. **`InMemoryRateLimiter.Init` 先写先赢**（`common/rate-limit.go:86-88`）。`rateLimitFactory` 传 20 分钟（`common/constants.go:250`），`memoryRateLimitHandler` 传模型限流窗口（`middleware/model-rate-limit.go:137`），**谁先跑谁决定 LRU 淘汰间隔**——1 分钟的模型限流与 20 分钟的关键限流共用一个 LRU。
7. **`UpdateModelRequestRateLimitGroupByJSONString` 取的是读锁而非写锁**（`setting/rate_limit.go:40-45`），而该 map 在别处也以读锁读取（`:48-49`），管理员更新与请求读取之间存在竞态。

---

## 6. 缺口清单

### 6.1 已调度但无并发控制

1. **视频任务轮询每渠道一个 goroutine，无上限**（`service/task_polling.go:396-424`，`gopool.Go` 于 `:412`）。200 渠道 × 1000 任务即 200 个并发上游轮询。
2. **系统任务 handler 无全局上限**，直接进入容量为 `math.MaxInt32` 的 gopool（`service/system_task.go:251`）。唯一上界是已注册类型数（5）。
3. **渠道健康检查默认并发为 1**（`setting/operation_setting/monitor_setting.go:24`），上限 32。
4. `model_update`、`midjourney_poll`、Codex 凭据刷新、订阅重置均为**完全串行**。
5. **渠道余额轮询串行且无速率上限**——`POLLING_INTERVAL` 默认为 **0**（无延迟）（`common/init.go:108-109`）。
6. **超时清扫每趟最多 100 条**（`service/task_polling.go:76`），积压超过 100 需多趟。

### 6.2 有并发控制但不可观测

1. **任务产物并发计数无任何指标**（`middleware/task_artifact_access.go:79-113`），拒绝时返回 429 + `Retry-After: 60`，但无计数器、无日志。
2. **插件协议准入限流只有 debug 日志**（`controller/plugin_protocol.go:235`），无指标，且不进入性能指标管线。
3. **模型限流的拒绝在健康指标中不可见**——本地 429 被分类为 `OutcomeIgnored`（`pkg/perf_metrics/metrics_test.go:34`）。
4. **登录会话上限只有 429/409 响应**，无内存 gauge。
5. **每渠道在途数完全无指标**——`middleware.GetStats()`（`middleware/stats.go:37-41`）只有全局 `ActiveConnections`。

### 6.3 未挂载或死代码

1. **`DownloadRateLimit`（`middleware/rate-limit.go:208`）与 `UploadRateLimit`（`:212`）从未被任何路由使用**，其 env 变量也不存在，值硬编码在 `common/constants.go:238-242`，运维无法修改。
2. `setting/operation_setting/` 下**没有任何限流设置**——全部限流配置要么在 `common/constants.go` + `common/init.go`（env），要么在 `setting/rate_limit.go`（DB 选项）。

### 6.4 跨体系交互缺口

1. **超时清扫只存在于 `async_task_poll` 内部**（`service/task_polling.go:145`）。`UPDATE_TASK=false` 会连带关闭**超时清扫与超时任务退款**。
2. **Midjourney 任务没有 `TASK_TIMEOUT_MINUTES` 清扫**，只有轮询 handler 里硬编码的 1 小时规则（`controller/midjourney.go:165-169`）。上游永不响应的 MJ 任务不会被清扫失败。
3. **上游 ID 为空的任务失败时不退款**。`model.TaskBulkUpdateByID`（`model/task.go:570`）无 CAS，该路径也未调用 `RefundTaskQuota`（`service/task_polling.go:181-187`；同类路径 `:255`、`:441`）。Midjourney 侧同样存在（`controller/midjourney.go:61-67`）。
4. **17 个裸循环在每个节点都跑**，各自产生独立的 DB 写入负载（N 节点 × 60s 一次选项同步与渠道缓存全表读取）。
5. **批量写入器是 env 开关而非 master 开关**，N 节点各跑各的（写入均为加法，安全，但 UPDATE 次数翻倍）。

### 6.5 调度与限流的语义错配

1. **`ModelRequestRateLimit` 名为 model 实为 user(+group)**，全仓库无 per-model 请求限流。
2. **无任何限流器限制 token 吞吐（TPM）**。唯一的后端 TPM 计算是只读统计（`model/log.go:693`，统计最近 60s 的 `count(*) rpm` 与 `sum(prompt_tokens)+sum(completion_tokens) tpm`）。定价页展示的 RPM/TPM 表是**前端 mock 数据**（`web/src/features/pricing/lib/mock-stats.ts:809-832`，由模型名与分组哈希派生伪随机值），后端不执行——UI 宣传的限额网关并未强制。
3. **总计数两种后端突发行为不同**（令牌桶 vs 滑动窗口），见 [5.2](#52-机制细节)。
4. **`duration` 逐请求实时读取**（`middleware/model-rate-limit.go:182`），而 Redis 成功键的 TTL 是记录时写入的（`:61`、`:78`），运行中修改窗口长度会追溯性地重设 TTL。
5. **`GlobalAPIRateLimit` 作用于整个 `/api/**` 且按 IP 计数**（`router/api-router.go:23`），同一 NAT 下的所有用户共享一份额度，包含开销较大的管理端点。
6. **`CriticalRateLimit` 即使在已鉴权路由上仍按 IP 计数**（`router/api-router.go:110-113`、`:116-119`、`:139`）；`UserCriticalRateLimit` 的存在正是为了修正这一点，但两者同时挂载，IP 维度依然生效，NAT 出口可能被整体锁死。

---

## 7. 配置速查

### 7.1 调度

| 环境变量 / 选项 | 默认 | 作用 |
| --- | --- | --- |
| `NODE_TYPE` | — | `master` 才启动系统任务 runner、Codex 刷新、订阅重置、认证清理 |
| `SYNC_FREQUENCY` | 60 | 选项热加载、渠道缓存、策略同步周期（秒） |
| `BATCH_UPDATE_ENABLED` | false | 开启额度批量写入 |
| `BATCH_UPDATE_INTERVAL` | 5 | 批量写入 flush 间隔（秒） |
| `POLLING_INTERVAL` | 0 | 串行作业的渠道间间隔（秒），0 = 无延迟 |
| `UPDATE_TASK` | true | 启用任务轮询（**同时控制超时清扫**） |
| `TASK_QUERY_LIMIT` | 1000 | 单趟轮询查询上限 |
| `TASK_TIMEOUT_MINUTES` | 4320 | 任务硬超时（分钟），0 = 关闭 |
| `TASK_POLL_MAX_FAILURES` | 20 | 连续轮询失败上限 |
| `CHANNEL_UPDATE_FREQUENCY` | 未设置 | 渠道余额轮询周期（分钟） |
| `CHANNEL_UPSTREAM_MODEL_UPDATE_TASK_ENABLED` | true | 上游模型检测任务开关 |
| `CHANNEL_UPSTREAM_MODEL_UPDATE_TASK_INTERVAL_MINUTES` | 30 | 同上周期 |
| `monitor_setting.auto_test_channel_enabled` | false | 渠道健康检查定时任务 |
| `monitor_setting.auto_test_channel_minutes` | 10 | 同上周期（分钟） |
| `monitor_setting.channel_test_concurrency` | 1 | 渠道健康检查并发（1–32） |

### 7.2 relay 传输

| 环境变量 | 默认 | 作用 |
| --- | --- | --- |
| `RELAY_TIMEOUT` | 0 | `http.Client.Timeout`，覆盖整个响应读取；0 = 不限。**设置过小会截断正常长流式调用** |
| `RELAY_RESPONSE_HEADER_TIMEOUT` | 1800 | 等待响应头的上限（秒），0 = 不限；不影响头之后的流式 |
| `RELAY_IDLE_CONN_TIMEOUT` | 90 | 空闲连接回收（秒） |
| `RELAY_MAX_IDLE_CONNS` | 500 | 全局空闲连接池上限 |
| `RELAY_MAX_IDLE_CONNS_PER_HOST` | 100 | 每主机空闲连接池上限（**不是并发上限**） |
| `RELAY_HTTP2_PING_IDLE_TIMEOUT` | 0 | HTTP/2 保活探测间隔（秒），0 = 关闭 |
| `RELAY_HTTP2_PING_TIMEOUT` | 15 | HTTP/2 PING 等待（秒） |
| `STREAMING_TIMEOUT` | 300 | 流式响应空闲超时（秒） |
| `RetryTimes`（DB 选项） | 0 | 单请求上游尝试次数 = RetryTimes + 1 |
| `AutomaticRetryStatusCodes`（DB 选项） | 见 [4.3](#43-渠道选择与重试) | 可重试状态码区间 |

### 7.3 限流

| 环境变量 | 默认 | 作用 |
| --- | --- | --- |
| `GLOBAL_API_RATE_LIMIT_ENABLE` / `_RATE_LIMIT` / `_RATE_LIMIT_DURATION` | true / 360 / 180 | `/api/**` 每 IP |
| `GLOBAL_WEB_RATE_LIMIT_ENABLE` / `_RATE_LIMIT` / `_RATE_LIMIT_DURATION` | true / 120 / 180 | 面板页面每 IP |
| `GLOBAL_STATIC_RATE_LIMIT_ENABLE` / `_RATE_LIMIT` / `_RATE_LIMIT_DURATION` | **false** / 1000 / 180 | 静态资源每 IP |
| `CRITICAL_RATE_LIMIT_ENABLE` / `_RATE_LIMIT` / `_RATE_LIMIT_DURATION` | true / 20 / 1200 | 敏感接口每 IP |
| `SEARCH_RATE_LIMIT_ENABLE` / `_RATE_LIMIT` / `_RATE_LIMIT_DURATION` | true / 10 / 60 | 搜索接口每用户 |
| `NOTIFY_LIMIT_COUNT` / `NOTIFICATION_LIMIT_DURATION_MINUTE` | 2 / 10 | 通知频次 |
| `USER_SESSION_ACTIVE_LIMIT` | 50 | 账号级并发会话数 |
| `USER_SESSION_ISSUANCE_LIMIT` / `_WINDOW_SECONDS` | 100 / 86400 | 账号级会话签发窗口 |
| `TASK_ARTIFACT_GLOBAL_CONCURRENCY` / `_IP_CONCURRENCY` / `_OBJECT_CONCURRENCY` | 128 / 64 / 16 | 任务产物下载并发 |
| `TASK_ARTIFACT_INVALID_RATE_LIMIT_PER_MINUTE` | 60 | 任务产物非法访问 |

后台可配（DB 选项）：`ModelRequestRateLimitEnabled`、`ModelRequestRateLimitDurationMinutes`、`ModelRequestRateLimitCount`、`ModelRequestRateLimitSuccessCount`、`ModelRequestRateLimitGroup`。

---

## 8. 本地实测记录

以下为在本地 SQLite 实例上实际执行的验证（后端 `:13000`，假上游 `:18080`）：

**任务调度可观测性**——`GET /api/system-task/list?scope=history` 仅返回 2 行 `type: "model_update"`，`status: "succeeded"`，`locked_by` 为 runner ID，`state` 为 `{"processed":1,"progress":100,"total":1}`。两行 `created_at` 相差 **1800s = 30 分**，与 `model_update` 默认间隔一致，且证明间隔是从上次运行的 `updated_at` 起算。`channel_test`（默认禁用）与两个轮询 handler（无未完成任务）**未产生任何行**——印证 [3.2.6](#326-运行历史与可观测性) 中"禁用与空闲不可区分"的缺口。`GET /api/status` 不含任何调度器字段。

**扣费并发**——同一令牌连续 3 次调用，令牌 `remain_quota` 由 100000 依次降至 99000 / 98000 / 97000，每次恰好扣 1000（= (1000 prompt + 500 completion × 2) × ModelRatio 1 × GroupRatio 0.5），确认计费与并发无耦合。

**失败退款**——停掉假上游后调用返回 `do_request_failed`，钱包余额与令牌额度**零变化**，预扣已全额退回。

**熔断器实测**——本机数据卷使用率 98%，超过默认磁盘阈值 95%，请求被 `system_disk_overloaded` 拒绝（连续 3 次采样判定）。关闭 `performance_setting.monitor_enabled` 后恢复。**该熔断是资源型而非并发型**：它保护的是系统不被压垮，不能替代并发上限。

**计费与折扣实测**——`GroupRatio[vip]=0.8` 且 `GroupGroupRatio[default][vip]=0.5` 时扣 1000；移除 `GroupGroupRatio` 后扣 1600；`GroupRatio[vip]=1` 时扣 2000。确认 `GroupGroupRatio` **覆盖** `GroupRatio` 而非与之相乘。

---

## 9. 相关文件索引

| 领域 | 文件 |
| --- | --- |
| 系统任务框架 | `service/system_task.go`、`model/system_task.go`、`controller/system_task_handlers.go`、`controller/system_task.go` |
| 异步任务轮询 | `service/task_polling.go`、`model/task.go`、`model/midjourney.go`、`controller/midjourney.go` |
| 批量写入 | `model/utils.go`、`model/quota_reserve.go` |
| 渠道选择与重试 | `service/channel_select.go`、`model/channel_cache.go`、`model/ability.go`、`service/relay_error.go`、`controller/relay.go` |
| 渠道亲和 | `service/channel_affinity.go`、`setting/operation_setting/channel_affinity_setting.go` |
| HTTP 传输 | `service/http_client.go`、`service/http_transport_sharded.go`、`service/http_transport_policy.go`、`relay/channel/api_request.go` |
| 限流 | `middleware/rate-limit.go`、`middleware/model-rate-limit.go`、`middleware/email-verification-rate-limit.go`、`common/rate-limit.go`、`common/limiter/`、`setting/rate_limit.go` |
| 并发准入 | `middleware/task_artifact_access.go`、`controller/plugin_protocol_limiter.go`、`pkg/jsplugin/engine.go` |
| 资源熔断 | `middleware/performance.go`、`common/system_monitor.go`、`setting/performance_setting/config.go` |
| 路由挂载 | `router/relay-router.go`、`router/api-router.go`、`router/task-router.go`、`router/video-router.go`、`router/plugin-router.go`、`router/task-plugin-protocol-router.go` |
