# new-api 单台 Linux + 腾讯云 CLB 部署

仅 PostgreSQL、Redis 使用 Docker。管理网关和独立用户门户在服务器上编译，通过 systemd 运行。HTTPS、证书和域名转发由腾讯云 CLB 提供；本方案不部署 Caddy 或 Nginx。

## 1. 架构及 CLB 转发规则

以 CVM 内网 IP `10.0.1.10` 为例，三个域名均解析到 **CLB 地址**，不直接解析到 CVM 公网地址：

| CLB HTTPS:443 域名 | URL 路径 | 后端协议与地址 |
| --- | --- | --- |
| `admin.example.com` | `/` | HTTP `10.0.1.10:3000` 管理网关 |
| `console.example.com` | `/` | HTTP `10.0.1.10:3001` 用户门户 |
| `api.example.com` | `/` | HTTP `10.0.1.10:3000` 管理网关中的模型接口 |

CVM 与 CLB 部署在可互通的同一 VPC。CLB 配置 HTTPS 监听器、三个域名的证书（多证书时使用 SNI）和上述转发规则，保留原始 Host，不要把所有域名改写成管理域名。客户端只使用 HTTPS；需要 HTTP 时，在 CLB 侧配置跳转。证书续期与绑定更新由腾讯云侧管理。

两个后端的健康检查均使用 **HTTP GET `/healthz`，预期 200**。此路径不需要登录，仅返回存活状态，不返回配置或密钥。不要用管理登录页做健康检查。首次初始化前门户尚未启动，其后端暂时不健康属于预期情况。流式输出及长任务应在 CLB 设置合适的连接 / 空闲超时，并通过实际调用验证。

操作说明：[腾讯云 HTTPS 监听器](https://cloud.tencent.com/document/product/214/36385)。脚本只配置 CVM 应用，不会自动创建或修改云上的 CLB、DNS、证书和安全组。

## 2. 网络和权限边界

- `new-api@management.service` 监听指定 CVM 内网 IP 的 3000 端口；`new-api@portal.service` 监听同一 IP 的 3001 端口。
- PostgreSQL 映射为 `127.0.0.1:15432 → 5432`，Redis 为 `127.0.0.1:16379 → 6379`，不提供给 CLB。
- 公网业务入口仅为 CLB 的 443。CVM 安全组不要对公网放通应用 / 数据库端口，SSH 仅允许运维来源；监听内网 IP 本身不能代替安全组，因为 CVM 公网映射仍可能到达该地址。
- 对支持的同 VPC CLB / CVM 场景，可采用腾讯云“安全组默认放通”：CLB 配置入口安全组，CVM 不对公网开放业务端口。关闭该功能时必须按实际源 IP 模式配置 CVM 和健康检查规则，不能简单假定后端源地址永远是 CLB VIP。规则以当前实例能力及腾讯云说明为准。[安全组官方说明](https://cloud.tencent.com/document/product/214/14733)
- 应用额外执行 Host / 路径限制：API 域名仅允许 `/v1`、`/tencentmps`、`/tencenttokenhub` 及携带合法格式 `X-TC-Action` 的根路径 POST；管理接口、后台页面及 `/pg` 均不能从 API 域名进入。未知 Host 返回 404，健康检查除外。
- 管理域名由应用按实际客户端 IP 执行 `ADMIN_ALLOW_CIDRS` 白名单。管理端仍需正常登录和权限检查。不要用共用 CLB 的全局安全组只放办公 IP，否则公开 API 和用户门户也会被阻断。
- 门户仅接受门户域名，保留独立前端、进程、系统账号及会话密钥。只有本机直接连接内网 IP 的请求可用于内部测试转发 / 初始化探测，该例外不读取转发头；这些接口原有鉴权仍然保留。

**可信代理配置必须与 CLB 模式一致：**

- CLB 保留客户端连接源 IP 时，设置 `TRUSTED_PROXY_CIDRS=none`，不信任客户端自行提供的 X-Forwarded-For。
- CLB 使用 SNAT / 后端连接复用时，填写经实例配置或网络观测确认的代理连接来源 IP / CIDR，以英文逗号分隔，让应用从 CLB 的转发链获取真实客户端地址。不能盲目填写 CLB 公网 VIP、全部内网或 `0.0.0.0/0`。确认 CLB 正确追加 / 覆盖转发头，不能让调用者冒充白名单 IP。
- 参数未填时拒绝启动 CLB 模式，避免落入原网关默认信任私网代理的兼容行为。`none` 在 SNAT 模式下可能导致管理入口 403，需要修正配置，不能扩大管理白名单规避。

**边界说明：**管理与模型转发仍在同一个网关进程内；两套应用共用 PG、Redis、应用数据库账号和数据加密密钥，没有数据库表级隔离。本机进程可访问内部端口，因此不要部署不可信程序。CLB 到 CVM 的 HTTP 仅在受控 VPC 使用；需要端到端加密时应另行配置后端 TLS。单台 CVM 仍是单点，不属于高可用部署。

## 3. 服务器准备和本机编译

支持 Ubuntu 22.04 / 24.04、Debian 12 / 13，必须使用 systemd。运行容量可从 4 核 / 8 GB / 80 GB SSD 起评估，本机编译建议预留 8–16 GB 可用内存；按实际并发和日志增长调整。出站需要访问依赖源、Docker 镜像仓库及腾讯上游。

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl unzip python3 git tzdata libasan8
```

### 安装编译工具

当前源码 `go.mod` 要求 **Go 1.26.10**，构建脚本使用 **Bun 1.4.4**（与根 Dockerfile 一致）。Go 安装可按[官方指南](https://go.dev/doc/install)操作；以下示例将经过 SHA-256 校验的官方 Go 包安装到当前普通账号目录，不覆盖系统已有 Go：

```bash
python3 - <<'PY'
import hashlib, json, pathlib, platform, subprocess, tempfile, urllib.request
arch = {'x86_64': 'amd64', 'aarch64': 'arm64'}[platform.machine()]
target = pathlib.Path.home() / '.local/share/new-api-tools'
if (target / 'go').exists():
    raise SystemExit('目标 Go 目录已存在，请先检查，不会覆盖')
releases = json.load(urllib.request.urlopen('https://go.dev/dl/?mode=json&include=all'))
release = next(r for r in releases if r['version'] == 'go1.26.10')
item = next(f for f in release['files'] if f['os'] == 'linux' and f['arch'] == arch and f['kind'] == 'archive')
with tempfile.TemporaryDirectory() as temp:
    archive = pathlib.Path(temp) / item['filename']
    urllib.request.urlretrieve('https://go.dev/dl/' + item['filename'], archive)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != item['sha256']:
        raise SystemExit('校验失败')
    target.mkdir(parents=True, exist_ok=True)
    subprocess.run(['tar', '-xzf', str(archive), '-C', str(target)], check=True)
PY

curl --fail --silent --show-error --location https://bun.sh/install -o /tmp/new-api-install-bun.sh
bash /tmp/new-api-install-bun.sh bun-v1.4.4
export PATH="$HOME/.local/share/new-api-tools/go/bin:$HOME/.bun/bin:$PATH"
go version
bun --version
```

把上述 `export PATH=...` 加入构建账号的 shell 配置，或每次构建前执行。Bun 指定版本安装方式见[官方安装说明](https://bun.sh/docs/installation)。这些工具只用于编译，运行服务不依赖构建账号的 HOME 或 PATH。

### 上传代码与编译

把**本次修改后的完整源码**上传到服务器 `/opt/new-api`，该目录应由普通构建账号拥有。直接克隆官方上游仓库不包含本次拆分与腾讯适配代码。从开发机项目根目录上传，例如：

```bash
rsync -az \
  --exclude='.git' --exclude='node_modules' --exclude='web/dist' \
  --exclude='web/dist-portal' --include='.env.example' \
  --exclude='.env' --exclude='.env.*' --exclude='.local-tests' \
  --exclude='.build' --exclude='.state' --exclude='backups' \
  --exclude='data' --exclude='logs' \
  ./ deploy@YOUR_SERVER:/opt/new-api/
```

在服务器执行：

```bash
cd /opt/new-api/deploy/single-host
sudo bash install-docker.sh
./build.sh
```

`build.sh` **不要使用 sudo**。它在服务器上执行 Bun 安装及两个前端构建、Go 网关编译，生成独立的应用发布产物。HTTPS 由腾讯云 CLB 提供，服务器不安装本地反向代理。

成功后输出 `.build/时间-随机后缀/`，包括 `new-api`、用户前端 `portal/`、许可证和 SHA-256 发布清单。管理前端嵌入 Go 可执行文件。发布目录缺失、内容被修改、包含符号链接或操作系统 / 架构不一致时，部署脚本拒绝安装。只使用自己编译且信任的产物；清单用于完整性检查，不是发布签名。

编译失败不会切换正在运行的版本。不要并发构建同一份源码；构建依赖下载失败时先检查网络，禁止删除业务数据卷来解决构建问题。

## 4. 首次部署

在服务器执行，替换域名、CVM 内网 IP、管理员真实公网出口 IP 和代理模式：

```bash
cd /opt/new-api/deploy/single-host
sudo ./deploy.sh init \
  admin.example.com console.example.com api.example.com \
  10.0.1.10 '203.0.113.10/32' none
sudo ./deploy.sh check
sudo ./deploy.sh up /完整路径/.build/成功编译的发布目录
```

最后的 `none` 适用于保留客户端源 IP 的 CLB；SNAT 模式须替换为已核实的代理来源列表。`BACKEND_IP` 必须是 CVM 实际拥有且 CLB 可达的内网 IPv4 地址，不允许用 `0.0.0.0`、回环地址或公网 IP 代替。

`init` 生成独立随机密钥，保存在源码部署目录的 `.env`（0600），不打印到终端；已有文件时拒绝覆盖。格式为不加引号的 `KEY=value`，不要 `source .env`。配置中的四个端口必须不同。

`up` 校验发布产物，安装 root 管理的版本、环境文件与 systemd 单元，启动 PG / Redis，再启动管理网关。CLB 监听器和安全组就绪后，从管理白名单 IP 访问 `https://admin.example.com/setup` 创建管理员，然后执行：

```bash
sudo ./deploy.sh activate
sudo ./deploy.sh status
```

门户首次启用前，CLB 对其请求可能返回后端不可用。后台服务器地址设为管理域名，核对注册策略、OAuth / 邮件 / 支付回调配置。浏览器会话仍使用 Secure Cookie 和对应的 HTTPS 可信域名，不能因为 CLB 到 CVM 使用 HTTP 就关闭安全 Cookie。

| 路径 | 内容 |
| --- | --- |
| `/opt/new-api` | 源码，普通构建账号拥有 |
| `/opt/new-api-runtime/releases/` | root 管理的已安装发布目录 |
| `/opt/new-api-runtime/current` | 当前版本符号链接 |
| `/etc/new-api/management.env` | 管理服务环境，0600 |
| `/etc/new-api/portal.env` | 门户环境，0600，不含管理员会话签名密钥 |
| `/etc/new-api/infra/` | systemd 使用的 PG / Redis Compose 和配置 |
| `/var/lib/new-api-management` | 管理网关工作数据 |
| `/var/lib/new-api-portal` | 门户工作数据 |

修改源 `.env` 后执行 `sudo ./deploy.sh start`，应用配置会重新生成。不要只编辑 `/etc/new-api/` 下的生成文件。更改 DB 密码需同步库内角色；`CRYPTO_SECRET` 不可随意轮换，否则可能无法读取已有加密数据。

## 5. 腾讯上游与下游配置

腾讯上游凭证在管理员后台的渠道配置中填写，不提交到源码或发送给下游：MPS 使用 `SecretId|SecretKey` 或 `SecretId|SecretKey|Region`，TokenHub 使用上游 API Key。下游使用 new-api 令牌和 `api.example.com`，保留兼容协议路径和鉴权方式。

脚本不自动开通腾讯后付费、填入渠道、抓取模型价格或覆盖计费设置。已有两个渠道、A/B/C 的 0.9 / 0.8 / 0.7 倍率及余额需通过数据库迁移保留，或在后台重新配置。MPS WAND 按 TokenHub 折合价属于当前项目约定，不是公开 MPS 官方报价。

## 6. 验收和日常运维

```bash
sudo ./deploy.sh status
sudo ./deploy.sh logs management
sudo ./deploy.sh logs portal
sudo ./deploy.sh logs postgres
sudo ss -lntp
```

确认应用只绑定配置的内网 IP，PG / Redis 仅映射回环地址；分别在 CLB 检查两个 `/healthz` 后端状态。从外部验证：

```bash
curl --fail --silent --show-error https://console.example.com/api/status
curl -s -o /dev/null -w '%{http_code}\n' https://console.example.com/api/channel/
curl -s -o /dev/null -w '%{http_code}\n' https://api.example.com/api/status
curl -s -o /dev/null -w '%{http_code}\n' https://api.example.com/
```

预期依次为 200、404、404、404。还需验证：非管理白名单出口访问管理域名返回 403；伪造 X-Forwarded-For / X-Forwarded-Host 无法绕过；管理员不能登录门户；不同站点会话不能互换；公网无法绕过 CLB 直连 CVM 业务端口。最后用授权的小额任务分别验证 MPS / TokenHub 的创建、轮询、结果权限、流式响应及计费。

```bash
sudo ./deploy.sh backup
sudo ./deploy.sh stop-apps   # 停止两个应用，并禁用它们的开机启动
sudo ./deploy.sh start       # 恢复当前版本及开机启动
sudo ./deploy.sh stop        # 停止并禁用应用和基础服务，保留所有数据
```

应用使用 journald，日志保留量按宿主机策略设置。Docker 日志单文件 20 MB、最多 3 份。Redis 开启 AOF、每秒刷盘、256 MB 上限和 noeviction；达到上限需排查或扩容。

## 7. 升级、备份、迁移和恢复

普通账号执行 `./build.sh`，成功后执行 `sudo ./deploy.sh update /新发布目录`。更新先备份，再停止应用、切换版本并等待健康，有短暂中断。旧发布目录保留；不会自动降级数据库或修改 CLB。需要维护窗口时先在 CLB 摘除后端，等任务结束再停应用。

`backup` 输出到 `deploy/single-host/backups/`，包括 PostgreSQL 自定义格式 dump、源配置、已安装配置、管理 / 门户工作数据和当前发布清单。含 `COMPLETE` 才算完成。目录 0700、文件默认 0600；含密钥，必须加密异机保存。备份不包含 Redis、发布二进制或云端 CLB / DNS / 证书设置，需另行保存可恢复的源码 / 发布目录及云配置。在线数据库与文件不保证同一时刻一致，严格恢复点应等待任务结束后先 `stop-apps`。

在新服务器 / 空数据库恢复：

1. 生成新配置，写入目标 CVM 的内网 IP、CLB 可信来源和白名单，保留源实例实际 `CRYPTO_SECRET`。会话密钥可保留，或有计划地更换并要求用户重新登录；数据库 / Redis 使用新实例密码。
2. `sudo ./deploy.sh infra` 后执行 `sudo ./deploy.sh import-db /secure-backup/database.dump`。仅允许无业务表的目标库，单事务导入；不要先 `up` 创建表。
3. 在目标服务器编译与备份兼容的代码并部署，维护窗口内恢复对应 `/var/lib/new-api-*` 工作数据，修正为各自系统账号所有权后启动。在恢复验收前不要向下游开放新实例。
4. 核对渠道、令牌、余额、A/B/C 倍率及新域名回调配置，验证 CLB 后端后切换业务。禁止新旧实例同时写入。

若存在独立日志数据库，应单独规划迁移；本模板默认业务与日志同库。旧加密密钥含不受支持字符时需先适配安全配置读取，不能为通过校验而更换原密钥。回滚须考虑数据库兼容性，禁止执行 `docker compose down -v` 或 `docker volume prune` 删除生产数据。

## 8. 旧方案切换

已有 `.env` 必须新增 `BACKEND_IP` 和 `TRUSTED_PROXY_CIDRS`，保留所有原密钥、域名和管理白名单。旧 `ACME_EMAIL`、`APP_IMAGE`、`EDGE_PREFIX` 被忽略。没有实际部署时，更新配置并重新编译即可。

若旧 Caddy 已运行，先在维护窗口配置好 CLB，执行 `sudo systemctl disable --now new-api-caddy.service`，再部署本方案；脚本检测到旧服务仍活动或启用时会停止。旧证书和文件不自动删除。若旧应用运行在 Docker，先备份并停止 / 移除明确的旧应用、Caddy 容器，保留 PG / Redis 数据卷和项目名 `new-api`，然后迁移工作目录。不要用带 `-v` 的删除操作。

## 9. 验证范围与安全参考

本地验证覆盖 Shell 语法、Python 部署配置和发布完整性、Go 入口 Host / 路径过滤、管理员来源限制、伪造转发头、可信代理链、内部测试入口及健康检查。原 PostgreSQL 初始化 SQL 未修改，沿用之前独立 PostgreSQL 16.10 临时实例的备份恢复验证。

当前开发环境为 macOS，无运行中的 Docker daemon 和 Linux systemd；尚未完成云端 CLB 配置、实际 Linux 编译 / 启停、证书和源 IP 模式验收。脚本与单元测试通过不等于云环境已经部署完成。

```bash
bash -n deploy/single-host/*.sh
python3 -m unittest discover -s deploy/single-host -p 'test_*.py' -v
GOCACHE=/tmp/new-api-go-cache go test ./router ./middleware -run 'Test(CLBIngress|Portal|SplitDeployment|ConfigureTrustedProxies)' -count=1
```

入口变更参考 [OWASP ASVS 5.0.0](https://asvs.owasp.org/)、[认证指南](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)和[会话管理指南](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)：保持 HTTPS / Secure Cookie、服务端权限检查、默认拒绝和明确的代理信任边界。未改变密码、MFA、刷新会话或恢复流程，不宣称完成整体 ASVS 合规认证。

常见问题：管理端 403 应核对真实出口 IP 和 CLB 源 IP 模式；后端不健康检查绑定 IP、端口、安全组及 `/healthz`；门户不可用检查初始化 / activate；修改证书在 CLB 侧处理。构建或部署强制中断后，确认无进程再移除对应锁目录。不要扩大白名单或关闭 Secure Cookie 来绕过配置问题。
