#!/usr/bin/env bash
# Run on the application host with sudo; keep nginx.conf.example alongside it.
set -Eeuo pipefail
umask 077
[[ $EUID == 0 ]] || { echo 'Run this script with sudo on the application host.' >&2; exit 1; }
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
config=/etc/nginx/sites-available/scrolled
[[ -f $config && -f $script_dir/nginx.conf.example ]]
nginx -t
backup=$(mktemp /etc/nginx/scrolled-domain-backup.XXXXXXXX)
cp -p -- "$config" "$backup"
restore() {
  local result=$?
  trap - ERR
  cp -p -- "$backup" "$config"
  nginx -t && systemctl reload nginx
  echo "Domain change failed; restored Nginx configuration from $backup" >&2
  exit "$result"
}
trap restore ERR

# Keep the existing certificate lineage and renewal account; add the new name.
certbot certonly --nginx --non-interactive --agree-tos \
  --cert-name scrolled.duckdns.org --expand \
  -d scrolled.duckdns.org -d swipestudy.duckdns.org \
  --deploy-hook 'systemctl reload nginx'
install -o root -g root -m 0644 -- "$script_dir/nginx.conf.example" "$config"
nginx -t
systemctl reload nginx
curl --fail --silent --show-error --connect-timeout 5 --max-time 20 \
  --resolve swipestudy.duckdns.org:443:127.0.0.1 \
  https://swipestudy.duckdns.org/ > /dev/null
curl --fail --silent --show-error --connect-timeout 5 --max-time 20 \
  --resolve swipestudy.duckdns.org:443:127.0.0.1 \
  https://swipestudy.duckdns.org/api/health | \
  python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("ok") is True else 1)'
trap - ERR
echo "Domain active: https://swipestudy.duckdns.org (previous Nginx config: $backup)"
