#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
component=${1:-frontend}
[[ $component == frontend || $component == backend ]] || { echo 'Use frontend or backend' >&2; exit 1; }
remote_component=''
public_origin='https://swipestudy.duckdns.org'
health_path=/
revision_path=/__deployment.txt
if [[ $component == backend ]]; then
  remote_component=backend
  health_path=/api/health
  revision_path=/api/deployment
fi

for name in DEPLOY_HOST DEPLOY_PORT DEPLOY_USER DEPLOY_SSH_KEY DEPLOY_KNOWN_HOSTS GITHUB_SHA GITHUB_RUN_ID GITHUB_RUN_ATTEMPT; do
  [[ -n ${!name:-} ]] || { echo "::error::Missing $name" >&2; exit 1; }
done
[[ $DEPLOY_HOST == 89.126.195.129 && $DEPLOY_PORT == 2222 ]] || {
  echo '::error::Deployment must use the existing gateway 89.126.195.129:2222' >&2; exit 1;
}
[[ $DEPLOY_USER =~ ^[a-z_][a-z0-9_-]*$ && $GITHUB_SHA =~ ^[a-f0-9]{40}$ ]]
[[ $GITHUB_RUN_ID =~ ^[0-9]+$ && $GITHUB_RUN_ATTEMPT =~ ^[0-9]+$ ]]
[[ $(git rev-parse HEAD) == "$GITHUB_SHA" ]] || { echo 'Checkout revision mismatch' >&2; exit 1; }

release="$GITHUB_SHA-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
local_tmp=$(mktemp -d)
remote_tmp=''
ssh_opts=(-p "$DEPLOY_PORT" -i "$local_tmp/key" -o IdentitiesOnly=yes -o BatchMode=yes
  -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$local_tmp/known_hosts"
  -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)
target="$DEPLOY_USER@$DEPLOY_HOST"
cleanup() {
  local result=$?
  trap - EXIT
  if [[ $remote_tmp =~ ^/tmp/scrolled-upload\.[a-zA-Z0-9]+$ ]]; then
    # Path is deliberately expanded locally and restricted by the regex above.
    # shellcheck disable=SC2029
    ssh "${ssh_opts[@]}" "$target" "rm -rf -- '$remote_tmp'" || true
  fi
  rm -rf -- "$local_tmp"
  exit "$result"
}
trap cleanup EXIT
printf '%s\n' "$DEPLOY_SSH_KEY" > "$local_tmp/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$local_tmp/known_hosts"
unset DEPLOY_SSH_KEY DEPLOY_KNOWN_HOSTS
ssh-keygen -y -P '' -f "$local_tmp/key" > /dev/null
ssh-keygen -F "[$DEPLOY_HOST]:$DEPLOY_PORT" -f "$local_tmp/known_hosts" > /dev/null

# No git credentials or production env files are needed on the server.
git archive --format=tar "$GITHUB_SHA:$component" | gzip > "$local_tmp/$component.tar.gz"
checksum=$(sha256sum "$local_tmp/$component.tar.gz")
checksum=${checksum%% *}
remote_tmp=$(ssh "${ssh_opts[@]}" "$target" 'umask 077; mktemp -d /tmp/scrolled-upload.XXXXXXXXXX')
[[ $remote_tmp =~ ^/tmp/scrolled-upload\.[a-zA-Z0-9]+$ ]]
scp -P "$DEPLOY_PORT" -i "$local_tmp/key" -o IdentitiesOnly=yes -o BatchMode=yes \
  -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$local_tmp/known_hosts" \
  -o ConnectTimeout=15 "$local_tmp/$component.tar.gz" "$target:$remote_tmp/$component.tar.gz"
# All remote arguments have been restricted to safe characters above.
# shellcheck disable=SC2029
ssh "${ssh_opts[@]}" "$target" \
  "bash -s -- $remote_component deploy '$release' '$GITHUB_SHA' '$remote_tmp/$component.tar.gz' '$checksum'" \
  < scripts/deploy/remote.sh

# A failed public check invokes the same locked rollback operation, conditional
# on this release still being current. A later release is never rolled back.
public_ok=0
for attempt in {1..12}; do
  body=$(curl --silent --show-error --fail --connect-timeout 5 --max-time 10 \
    "$public_origin$revision_path?release=$release&attempt=$attempt") || body=''
  if [[ $body == "$GITHUB_SHA $release" ]] && \
      [[ $(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
        --connect-timeout 5 --max-time 10 "$public_origin$health_path") == 200 ]]; then
    if [[ $component == frontend ]] || \
        curl --silent --show-error --fail --connect-timeout 5 --max-time 10 \
          "$public_origin$health_path" | \
          python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("ok") is True else 1)'; then
      public_ok=1; break
    fi
  fi
  sleep 5
done
if [[ $public_ok != 1 ]]; then
  echo '::error::Public health/revision check failed; restoring previous release' >&2
  # shellcheck disable=SC2029
  ssh "${ssh_opts[@]}" "$target" "bash -s -- $remote_component rollback '$release'" < scripts/deploy/remote.sh
  exit 1
fi
echo "Successfully deployed and publicly verified $component $GITHUB_SHA ($release)"
