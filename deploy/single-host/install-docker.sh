#!/usr/bin/env bash
# Optional installer for a fresh Ubuntu/Debian server. Does not remove packages.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "请使用 sudo bash install-docker.sh" >&2; exit 1; }
[[ -f /etc/os-release ]] || { echo "无法识别系统。" >&2; exit 1; }
. /etc/os-release
case "$ID:${VERSION_ID:-}" in
  ubuntu:22.04|ubuntu:24.04|debian:12|debian:13) ;;
  *) echo "安装脚本仅支持 Ubuntu 22.04/24.04、Debian 12/13。" >&2; exit 1 ;;
esac
if command -v docker >/dev/null; then
  docker compose version
  docker info >/dev/null
  command -v python3 >/dev/null || { apt-get update; apt-get install -y python3; }
  echo "已有 Docker 和 Compose，保留现有安装。"
  exit 0
fi
for package in docker.io docker-compose docker-doc docker-buildx podman-docker containerd runc; do
  if dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q '^install ok installed$'; then
    echo "检测到已有 $package，请按 Docker 官方文档处理兼容性；脚本不会卸载现有软件。" >&2
    exit 1
  fi
done
if [[ -e /etc/apt/sources.list.d/docker.sources || -e /etc/apt/sources.list.d/docker.list ]]; then
  echo "已存在 Docker 软件源，请先人工检查，脚本不会覆盖。" >&2
  exit 1
fi
apt-get update
apt-get install -y ca-certificates curl python3
install -m 0755 -d /etc/apt/keyrings
curl --fail --silent --show-error --location "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/$ID
Suites: $VERSION_CODENAME
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
docker compose version
docker info >/dev/null
echo "Docker 安装完成。脚本未修改防火墙，也未把普通用户加入 docker 组。"
