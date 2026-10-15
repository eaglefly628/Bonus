#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "用法: scripts/create-production-env.sh points.example.com" >&2
  exit 1
fi

domain="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
if [[ "$domain" != *.* || ${#domain} -gt 253 ]]; then
  echo "请输入有效的域名，例如 points.example.com" >&2
  exit 1
fi
IFS='.' read -r -a labels <<< "$domain"
for label in "${labels[@]}"; do
  if [[ ! "$label" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ || ${#label} -gt 63 ]]; then
    echo "域名格式无效" >&2
    exit 1
  fi
done

command -v openssl >/dev/null || { echo "需要 openssl 生成随机密钥" >&2; exit 1; }
root="$(cd "$(dirname "$0")/.." && pwd)"
target="$root/.env"
if [[ -e "$target" ]]; then
  echo "$target 已存在；为避免覆盖现有密码，本脚本不会修改它。" >&2
  exit 1
fi

umask 077
db_password="$(openssl rand -hex 24)"
admin_password="$(openssl rand -hex 24)"
cron_secret="$(openssl rand -hex 32)"
cat > "$target" <<EOF
DATABASE_URL=postgresql://actionpoints:$db_password@db:5432/actionpoints?schema=public
POSTGRES_PASSWORD=$db_password
APP_ORIGIN=https://$domain
APP_TIMEZONE=Asia/Shanghai
INITIAL_ADMIN_USERNAME=admin
INITIAL_ADMIN_PASSWORD=$admin_password
CRON_SECRET=$cron_secret
DOMAIN=$domain
EOF
chmod 600 "$target"
echo "已生成仅服务器本地可读的 ${target}。管理员初始密码保存在该文件中，请妥善保管。"
