#!/usr/bin/env python3
"""Generate/validate Compose input without evaluating shell code or printing secrets."""
import ipaddress
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
import sys
import platform

SECRET_KEYS = (
    "POSTGRES_PASSWORD", "APP_DB_PASSWORD", "REDIS_PASSWORD",
    "MANAGEMENT_SESSION_SECRET", "PORTAL_SESSION_SECRET", "CRYPTO_SECRET",
)
PUBLIC_KEYS = (
    "ADMIN_DOMAIN", "PORTAL_DOMAIN", "API_DOMAIN", "BACKEND_IP",
    "ADMIN_ALLOW_CIDRS", "TRUSTED_PROXY_CIDRS", "PG_PORT", "REDIS_PORT", "MANAGEMENT_PORT", "PORTAL_PORT",
)
PORT_DEFAULTS = dict(PG_PORT="15432", REDIS_PORT="16379", MANAGEMENT_PORT="3000", PORTAL_PORT="3001")


def validate(values):
    if set(values) != set(SECRET_KEYS + PUBLIC_KEYS):
        raise ValueError("配置字段缺失或存在未知字段，请对照 .env.example")
    domains = [values[key] for key in PUBLIC_KEYS[:3]]
    for domain in domains:
        labels = domain.split(".")
        if len(domain) > 253 or len(labels) < 2 or any(
            not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label)
            for label in labels
        ) or labels[-1].isdigit():
            raise ValueError("域名必须是完整的小写 DNS 名称，不含协议、端口和路径")
    if len(set(domains)) != 3:
        raise ValueError("管理端、用户端、API 必须使用三个不同域名")
    backend = ipaddress.IPv4Address(values["BACKEND_IP"])
    if not any(backend in ipaddress.IPv4Network(block) for block in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")):
        raise ValueError("BACKEND_IP 必须是服务器实际的 RFC1918 内网 IPv4 地址")
    if values["TRUSTED_PROXY_CIDRS"] != "none":
        for raw in values["TRUSTED_PROXY_CIDRS"].split(","):
            network = ipaddress.ip_network(raw, strict=False)
            if network.prefixlen == 0:
                raise ValueError("不得信任全网代理")
    cidrs = values["ADMIN_ALLOW_CIDRS"].split()
    if not cidrs:
        raise ValueError("管理员 IP 白名单不能为空")
    for cidr in cidrs:
        network = ipaddress.ip_network(cidr, strict=False)
        if network.prefixlen == 0:
            raise ValueError("管理员 IP 白名单不得允许整个互联网")
    for key in PORT_DEFAULTS:
        if not re.fullmatch(r"[1-9][0-9]{3,4}", values[key]) or not 1024 <= int(values[key]) <= 65535:
            raise ValueError("本机端口必须在 1024–65535 之间")
    if len({values[key] for key in PORT_DEFAULTS}) != 4:
        raise ValueError("四个本机端口必须不同")
    for key in SECRET_KEYS[:3]:
        if not re.fullmatch(r"[a-f0-9]{64}", values[key]):
            raise ValueError(key + " 必须为 64 位小写十六进制随机值")
    for key in SECRET_KEYS[3:]:
        minimum = 1 if key == "CRYPTO_SECRET" else 32
        if not re.fullmatch(r"[A-Za-z0-9_+/=-]{%d,256}" % minimum, values[key]):
            raise ValueError("会话或加密密钥格式无效；迁移时不得更换现有加密密钥")
    if len({values[key] for key in SECRET_KEYS}) != len(SECRET_KEYS):
        raise ValueError("数据库、缓存、会话和加密密钥必须分别独立生成")


def read_config(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError("配置文件必须为普通文件，请先运行 init")
    if stat.S_IMODE(path.stat().st_mode) & 0o077:
        raise ValueError("配置包含密钥，请先 chmod 600 配置文件")
    values = {}
    for line in path.read_text().splitlines():
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or key in values:
            raise ValueError("配置行无效或字段重复")
        values[key] = value
    # Preserve secrets from the earlier container-only template. These two
    # retired fields have no effect on the host deployment.
    values.pop("APP_IMAGE", None)
    values.pop("EDGE_PREFIX", None)
    values.pop("ACME_EMAIL", None)
    for key, value in PORT_DEFAULTS.items():
        values.setdefault(key, value)
    validate(values)
    return values


def write_private(path, content):
    temporary = path.with_name(path.name + ".tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as stream:
        stream.write(content)
    os.replace(temporary, path)


def render_host(values, target):
    target.mkdir(parents=True, exist_ok=True)
    shared = dict(
        LISTEN_ADDRESS=values["BACKEND_IP"], TZ="Asia/Shanghai",
        SQL_DSN=f"postgres://newapi:{values['APP_DB_PASSWORD']}@127.0.0.1:{values['PG_PORT']}/newapi?sslmode=disable",
        REDIS_CONN_STRING=f"redis://:{values['REDIS_PASSWORD']}@127.0.0.1:{values['REDIS_PORT']}/0",
        SQL_MAX_IDLE_CONNS="10", SQL_MAX_OPEN_CONNS="40", SQL_MAX_LIFETIME="300",
        CRYPTO_SECRET=values["CRYPTO_SECRET"], PORTAL_SESSION_SECRET=values["PORTAL_SESSION_SECRET"],
        SESSION_COOKIE_SECURE="true", TRUSTED_PROXIES=values["TRUSTED_PROXY_CIDRS"],
        CLB_INGRESS_ENABLED="true", INGRESS_INTERNAL_IP=values["BACKEND_IP"],
        INGRESS_ADMIN_HOST=values["ADMIN_DOMAIN"], INGRESS_API_HOST=values["API_DOMAIN"],
        INGRESS_PORTAL_HOST=values["PORTAL_DOMAIN"], INGRESS_ADMIN_CIDRS=values["ADMIN_ALLOW_CIDRS"],
    )
    management = dict(shared, SERVICE_ROLE="full", NODE_NAME="management-gateway",
                      PORT=values["MANAGEMENT_PORT"], SESSION_SECRET=values["MANAGEMENT_SESSION_SECRET"],
                      SESSION_COOKIE_TRUSTED_URL="https://" + values["ADMIN_DOMAIN"])
    portal = dict(shared, SERVICE_ROLE="portal", NODE_TYPE="slave", NODE_NAME="user-portal",
                  PORT=values["PORTAL_PORT"], PORTAL_WEB_DIR="/opt/new-api-runtime/current/portal",
                  PORTAL_PUBLIC_URL="https://" + values["PORTAL_DOMAIN"],
                  PORTAL_GATEWAY_URL="https://" + values["API_DOMAIN"],
                  PORTAL_GATEWAY_INTERNAL_URL="http://" + values["BACKEND_IP"] + ":" + values["MANAGEMENT_PORT"],
                  SESSION_COOKIE_TRUSTED_URL="https://" + values["PORTAL_DOMAIN"])
    for name, environment in (("management", management), ("portal", portal)):
        write_private(target / (name + ".env"), "".join(f"{key}={value}\n" for key, value in environment.items()))
    infra = target / "infra"
    infra.mkdir(mode=0o700, exist_ok=True)
    infra_keys = ("POSTGRES_PASSWORD", "APP_DB_PASSWORD", "REDIS_PASSWORD", "PG_PORT", "REDIS_PORT")
    write_private(infra / ".env", "".join(f"{key}={values[key]}\n" for key in infra_keys))


def release_manifest(directory):
    files = {}
    for path in sorted(directory.rglob("*")):
        if path.is_symlink():
            raise ValueError("发布目录不能包含符号链接")
        if path.is_file() and path != directory / "release.json":
            digest = hashlib.sha256()
            with path.open("rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
            files[str(path.relative_to(directory))] = digest.hexdigest()
    if not {"new-api", "portal/index.html"} <= files.keys():
        raise ValueError("缺少发布产物")
    if 'name="new-api-surface" content="portal"' not in (directory / "portal/index.html").read_text():
        raise ValueError("用户端构建标记不匹配")
    return dict(os=platform.system().lower(), arch=platform.machine(), files=files)


def main():
    action, filename, *args = sys.argv[1:]
    path = Path(filename)
    if action in ("seal-release", "verify-release"):
        actual = release_manifest(path)
        if action == "seal-release":
            write_private(path / "release.json", json.dumps(actual, indent=2) + "\n")
        elif json.loads((path / "release.json").read_text()) != actual:
            raise ValueError("发布产物校验失败或操作系统/架构不匹配")
        return
    if action == "init":
        if len(args) != 6:
            raise ValueError("init 需要：管理员域名 用户域名 API域名 CVM内网IP '管理员IP列表' '可信代理CIDR或none'")
        values = dict(zip(PUBLIC_KEYS[:6], args))
        values.update(PORT_DEFAULTS)
        values.update({key: secrets.token_hex(32) for key in SECRET_KEYS})
        validate(values)
        # O_EXCL also rejects existing symlinks; never overwrite deployment keys.
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as stream:
            stream.write("# new-api single-host configuration; keep private and backed up.\n")
            stream.writelines(key + "=" + value + "\n" for key, value in values.items())
        print("配置已创建（0600），密钥未输出；重复 init 不会覆盖现有配置。")
    else:
        values = read_config(path)
        if action == "keys":
            print("\n".join(values))
        elif action == "get" and len(args) == 1 and args[0] in PUBLIC_KEYS:
            print(values[args[0]])
        elif action == "render" and len(args) == 1:
            render_host(values, Path(args[0]))
        elif action != "validate":
            raise ValueError("未知配置操作；不允许打印密钥")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError) as error:
        # Invalid values may contain credentials or injection payloads: never echo them.
        if isinstance(error, FileExistsError):
            print("配置已存在，未覆盖。修改前请备份。", file=sys.stderr)
        else:
            print("配置操作失败，请检查命令参数、字段格式、文件权限及文档。", file=sys.stderr)
        sys.exit(1)
