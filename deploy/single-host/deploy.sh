#!/usr/bin/env bash
set -euo pipefail
umask 077
DEPLOY_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ENV_FILE="$DEPLOY_DIR/.env"
STATE_DIR="$DEPLOY_DIR/.state"
BACKUP_DIR="$DEPLOY_DIR/backups"
RUNTIME=/opt/new-api-runtime
CONFIG_DIR=/etc/new-api

usage() {
  cat <<'HELP'
new-api 单机部署：仅 PostgreSQL / Redis 使用 Docker，应用使用 systemd，HTTPS 由腾讯云 CLB 提供
  ./build.sh                         普通账号在服务器编译，输出独立发布目录
  ./deploy.sh init ADMIN_DOMAIN PORTAL_DOMAIN API_DOMAIN BACKEND_IP 'ADMIN_IP/CIDR ...' 'TRUSTED_PROXY_CIDRS|none'
  ./deploy.sh check                   校验输入和 Compose（不输出密钥）
  sudo ./deploy.sh up RELEASE_DIR     安装已编译产物并启动；首次先初始化管理员
  sudo ./deploy.sh update RELEASE_DIR 备份后切换发布目录，有短暂中断
  sudo ./deploy.sh start              使用当前发布版本重启并应用新配置
  sudo ./deploy.sh activate           管理员初始化完成后启用用户门户
  sudo ./deploy.sh infra              仅安装并启动 PG / Redis
  sudo ./deploy.sh import-db FILE.dump 仅向无业务表的数据库导入
  sudo ./deploy.sh backup             备份数据库、配置、应用数据及当前发布目录信息
  sudo ./deploy.sh stop-apps          停止并禁用两个应用的开机启动
  sudo ./deploy.sh status             查看容器与 systemd 服务状态
  sudo ./deploy.sh logs [management|portal|postgres|redis]
  sudo ./deploy.sh stop               停止并禁用整套服务的开机启动，保留数据
HELP
}

command -v python3 >/dev/null || { echo "需要 Python 3。" >&2; exit 1; }
action=${1:-help}
shift || true
case "$action" in
  help|-h|--help) usage; exit 0 ;;
  init) exec python3 "$DEPLOY_DIR/config.py" init "$ENV_FILE" "$@" ;;
  check|up|activate|infra|import-db|start|update|backup|stop-apps|status|logs|stop) ;;
  *) usage >&2; exit 1 ;;
esac
python3 "$DEPLOY_DIR/config.py" validate "$ENV_FILE"
while IFS= read -r config_key; do unset "$config_key"; done < <(python3 "$DEPLOY_DIR/config.py" keys "$ENV_FILE")
compose=(docker compose --project-name new-api --project-directory "$DEPLOY_DIR" --env-file "$ENV_FILE" -f "$DEPLOY_DIR/compose.yaml")
"${compose[@]}" config --quiet
if [[ "$action" == check ]]; then
  echo "输入及 Compose 校验通过；尚未验证 Linux 服务、DNS 或 HTTPS。"
  exit 0
fi
[[ $(uname -s) == Linux && $EUID -eq 0 ]] || { echo "请在 Linux 服务器使用 sudo 执行部署操作。" >&2; exit 1; }
for tool in systemctl curl install useradd getent; do command -v "$tool" >/dev/null || { echo "缺少 $tool。" >&2; exit 1; }; done
[[ -x /usr/bin/docker ]] || { echo "systemd 模板要求 Docker CLI 位于 /usr/bin/docker。" >&2; exit 1; }
docker info >/dev/null
"${compose[@]}" up --help | grep -q -- '--wait-timeout' || { echo "请升级 Docker Compose 插件（建议 2.20+）。" >&2; exit 1; }
# Do not silently leave the old public app/ingress containers running as orphans.
legacy=$(docker ps -a --filter label=com.docker.compose.project=new-api --format '{{.Label "com.docker.compose.service"}}')
if grep -Eq '^(management-gateway|portal|caddy|caddy-check)$' <<< "$legacy"; then
  echo "发现旧版应用容器。请按文档迁移并移除旧应用容器（保留 PG / Redis 数据卷）后重试。" >&2
  exit 1
fi
if systemctl is-active --quiet new-api-caddy.service || systemctl is-enabled --quiet new-api-caddy.service 2>/dev/null; then
  echo "请先停用旧入口：systemctl disable --now new-api-caddy.service；证书现由 CLB 管理。" >&2
  exit 1
fi
mkdir -p "$STATE_DIR" "$BACKUP_DIR"
mkdir "$STATE_DIR/lock" 2>/dev/null || { echo "部署锁已存在，请先确认没有部署进程。" >&2; exit 1; }
trap 'rmdir "$STATE_DIR/lock"' EXIT
backend_ip=$(python3 "$DEPLOY_DIR/config.py" get "$ENV_FILE" BACKEND_IP)
management_port=$(python3 "$DEPLOY_DIR/config.py" get "$ENV_FILE" MANAGEMENT_PORT)
portal_port=$(python3 "$DEPLOY_DIR/config.py" get "$ENV_FILE" PORTAL_PORT)

setup_complete() {
  curl --noproxy '*' --fail --silent --show-error --max-time 10 "http://$backend_ip:$management_port/api/setup" |
    python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("success") is True and d.get("data",{}).get("status") is True else 1)'
}

wait_app() {
  local port=$1 service=$2
  for ((attempt=0; attempt<60; attempt++)); do
    if systemctl is-active --quiet "$service" && curl --noproxy '*' --fail --silent --max-time 2 "http://$backend_ip:$port/healthz" > /dev/null; then return; fi
    sleep 2
  done
  echo "服务未就绪：$service，请用 journalctl -u $service 检查。" >&2
  return 1
}

install_config() {
  local candidate=${1:-} staged
  staged=$(mktemp -d "$STATE_DIR/config-XXXXXX")
  python3 "$DEPLOY_DIR/config.py" render "$ENV_FILE" "$staged"
  install -d -o root -g root -m 0755 "$CONFIG_DIR"
  install -d -o root -g root -m 0700 "$CONFIG_DIR/infra"
  install -m 0600 "$staged/infra/.env" "$CONFIG_DIR/infra/.env"
  install -m 0644 "$DEPLOY_DIR/compose.yaml" "$CONFIG_DIR/infra/compose.yaml"
  install -m 0755 "$DEPLOY_DIR/init-db.sh" "$CONFIG_DIR/infra/init-db.sh"
  install -m 0644 "$DEPLOY_DIR/systemd/new-api-infra.service" /etc/systemd/system/
  if [[ -n "$candidate" ]]; then
    for name in management portal; do
      if ! id "new-api-$name" >/dev/null 2>&1; then
        useradd --system --user-group --home-dir "/var/lib/new-api-$name" --no-create-home --shell /usr/sbin/nologin "new-api-$name"
      elif [[ $(id -u "new-api-$name") == 0 || $(getent passwd "new-api-$name" | cut -d: -f7) != /usr/sbin/nologin ]]; then
        echo "已有 new-api-$name 不是预期的服务账号，请人工检查。" >&2; return 1
      fi
    done
    install -m 0600 "$staged/management.env" "$staged/portal.env" "$CONFIG_DIR/"
    install -m 0644 "$DEPLOY_DIR/systemd/new-api@.service" /etc/systemd/system/
  fi
  # Files are now installed; remove only the temporary directory created above.
  rm -rf -- "$staged"
  systemctl daemon-reload
}

start_infra() {
  "${compose[@]}" up -d --wait --wait-timeout 180 postgres redis
  systemctl enable --now new-api-infra.service
}

backup() {
  local destination name
  destination=$(mktemp -d "$BACKUP_DIR/$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
  cp "$ENV_FILE" "$destination/.env"
  cp "$DEPLOY_DIR/compose.yaml" "$DEPLOY_DIR/init-db.sh" "$destination/"
  "${compose[@]}" exec -T postgres pg_dump -U postgres -d newapi -Fc > "$destination/database.dump"
  "${compose[@]}" exec -T postgres pg_restore --list < "$destination/database.dump" > /dev/null
  for name in management portal; do
    if [[ -d /var/lib/new-api-$name ]]; then
      tar -C "/var/lib/new-api-$name" -czf "$destination/$name-data.tar.gz" .
    fi
  done
  if [[ -d "$CONFIG_DIR" ]]; then tar -C "$CONFIG_DIR" -czf "$destination/installed-config.tar.gz" .; fi
  if [[ -L "$RUNTIME/current" ]]; then
    readlink "$RUNTIME/current" > "$destination/release-path.txt"
    cp "$RUNTIME/current/release.json" "$destination/release.json"
  fi
  touch "$destination/COMPLETE"
  echo "备份完成：$destination（含密钥，需加密异机保存；不包含发布二进制）"
}

activate_portal() {
  setup_complete || { echo "管理员尚未完成初始化或管理服务不可达。" >&2; return 1; }
  systemctl enable new-api@portal.service
  systemctl restart new-api@portal.service
  wait_app "$portal_port" new-api@portal.service
}

start_apps() {
  systemctl enable new-api@management.service
  systemctl restart new-api@management.service
  wait_app "$management_port" new-api@management.service
  if setup_complete; then
    activate_portal
  else
    systemctl disable new-api@portal.service
    printf '请从白名单 IP 访问 https://%s/setup 初始化，然后执行 sudo ./deploy.sh activate。\n' "$(python3 "$DEPLOY_DIR/config.py" get "$ENV_FILE" ADMIN_DOMAIN)"
  fi
}

case "$action" in
  up|update)
    [[ $# == 1 && -d "$1" ]] || { echo "请指定 build.sh 输出的发布目录。" >&2; exit 1; }
    python3 "$DEPLOY_DIR/config.py" verify-release "$1"
    [[ "$action" != update ]] || backup
    install -d -o root -g root -m 0755 "$RUNTIME" "$RUNTIME/releases"
    release=$(mktemp -d "$RUNTIME/releases/$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
    cp -a "$1/." "$release/"
    chown -R root:root "$release"
    find "$release" -type d -exec chmod 0755 {} +
    find "$release" -type f -exec chmod 0644 {} +
    chmod 0755 "$release/new-api"
    python3 "$DEPLOY_DIR/config.py" verify-release "$release"
    install_config "$release"
    # Stop the portal before any gateway restart/migrations.
    systemctl stop new-api@portal.service new-api@management.service
    if [[ -e "$RUNTIME/current" && ! -L "$RUNTIME/current" ]]; then echo "current 不是符号链接，拒绝覆盖。" >&2; exit 1; fi
    if [[ -L "$RUNTIME/current" ]]; then readlink "$RUNTIME/current" > "$STATE_DIR/previous-release"; fi
    ln -s "$release" "$RUNTIME/.current.$$"
    mv -Tf "$RUNTIME/.current.$$" "$RUNTIME/current"
    start_infra
    start_apps
    ;;
  start)
    python3 "$DEPLOY_DIR/config.py" verify-release "$RUNTIME/current"
    install_config "$RUNTIME/current"
    systemctl stop new-api@portal.service new-api@management.service
    start_infra
    start_apps
    ;;
  activate) activate_portal ;;
  infra) install_config; start_infra ;;
  import-db)
    [[ $# == 1 && -f "$1" ]] || { echo "请提供 pg_dump -Fc 文件。" >&2; exit 1; }
    table_count=$("${compose[@]}" exec -T postgres psql -U postgres -d newapi -Atc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")
    [[ "$table_count" == 0 ]] || { echo "目标已有业务表，拒绝覆盖。" >&2; exit 1; }
    "${compose[@]}" exec -T postgres pg_restore --list < "$1" > /dev/null
    "${compose[@]}" exec -T postgres pg_restore -U postgres -d newapi --role=newapi --no-owner --no-privileges --single-transaction --exit-on-error < "$1"
    echo "导入完成。启动前确认保留原 CRYPTO_SECRET。"
    ;;
  backup) backup ;;
  stop-apps) systemctl disable --now new-api@portal.service new-api@management.service ;;
  status)
    "${compose[@]}" ps -a
    systemctl --no-pager --full status new-api-infra.service new-api@management.service new-api@portal.service
    ;;
  logs)
    case "${1:-management}" in
      postgres|redis) "${compose[@]}" logs --tail 100 "$1" ;;
      management|portal) journalctl --no-pager -n 100 -u "new-api@${1:-management}.service" ;;
      *) echo "无效的服务名。" >&2; exit 1 ;;
    esac
    ;;
  stop)
    systemctl disable --now new-api@portal.service new-api@management.service new-api-infra.service
    ;;
esac
