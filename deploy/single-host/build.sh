#!/usr/bin/env bash
# Compile on the target Linux server as the source owner, without sudo or Docker.
set -euo pipefail
DEPLOY_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SOURCE_DIR=$(cd -- "$DEPLOY_DIR/../.." && pwd)
[[ $(uname -s) == Linux ]] || { echo "请在目标 Linux 服务器编译。" >&2; exit 1; }
[[ $EUID -ne 0 ]] || { echo "请使用普通构建账号执行 build.sh，不要 sudo。" >&2; exit 1; }
for tool in go bun python3; do command -v "$tool" >/dev/null || { echo "缺少 $tool，请按文档安装。" >&2; exit 1; }; done
[[ $(bun --version) == 1.4.4 ]] || { echo "本版本请使用 Bun 1.4.4（与 Dockerfile 一致）。" >&2; exit 1; }
# Force native builds and keep local workspace wiring out of production artifacts.
unset GOOS GOARCH GOARM GOBIN
export GOWORK=off CGO_ENABLED=0 GOEXPERIMENT=greenteagc
mkdir -p "$DEPLOY_DIR/.build"
mkdir "$DEPLOY_DIR/.build/lock" 2>/dev/null || { echo "已有构建锁，请确认没有并发构建。" >&2; exit 1; }
trap 'rmdir "$DEPLOY_DIR/.build/lock"' EXIT
release=$(mktemp -d "$DEPLOY_DIR/.build/$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
cd "$SOURCE_DIR"
version=$(cat VERSION)
[[ "$version" =~ ^[A-Za-z0-9._+-]+$ ]] || { echo "VERSION 格式不合法。" >&2; exit 1; }
(
  cd web
  bun install --frozen-lockfile
  VITE_REACT_APP_VERSION="$version" bun run build
  VITE_REACT_APP_VERSION="$version" bun run build:portal
)
go build -trimpath -pgo="$(go list -m -f '{{.Dir}}' github.com/Calcium-Ion/moejs)/default.pgo" \
  -ldflags "-s -w -X github.com/QuantumNous/new-api/common.Version=$version" -o "$release/new-api" .
cp -R web/dist-portal "$release/portal"
mkdir "$release/licenses"
cp LICENSE NOTICE THIRD-PARTY-LICENSES.md "$release/licenses/"
python3 "$DEPLOY_DIR/config.py" seal-release "$release"
printf '\n编译完成（未启动服务）：%s\n下一步：sudo ./deploy.sh up %s\n' "$release" "$release"
