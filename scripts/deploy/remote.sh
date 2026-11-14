#!/usr/bin/env bash
# Executed through SSH as the unprivileged deployment account, never as root.
set -Eeuo pipefail
umask 022
fail() { echo "Deployment error: $*" >&2; exit 1; }
log() { printf '%s\n' "$*"; }
component=frontend
config_name=deploy.conf
health_path=/
revision_path=/__deployment.txt
if [[ ${1:-} == backend ]]; then
  component=backend
  config_name=backend-deploy.conf
  health_path=/api/health
  revision_path=/api/deployment
  shift
fi
config=${SCROLLED_DEPLOY_CONFIG:-$HOME/.config/scrolled/$config_name}
[[ -f $config ]] || fail "Missing server configuration: $config"
# shellcheck source=/dev/null
source "$config"
for name in DEPLOY_ROOT CURRENT_PATH SERVICE NODE_BIN_DIR NODE_VERSION ENV_DIR HEALTH_URL; do
  [[ -n ${!name:-} ]] || fail "Configure $name in $config"
done
[[ $DEPLOY_ROOT =~ ^/[a-zA-Z0-9_./-]+$ && $DEPLOY_ROOT != / ]] || fail 'Invalid DEPLOY_ROOT'
[[ $CURRENT_PATH =~ ^/[a-zA-Z0-9_./-]+$ && $CURRENT_PATH != / ]] || fail 'Invalid CURRENT_PATH'
[[ $SERVICE =~ ^[a-zA-Z0-9_.@-]+\.service$ ]] || fail 'Use the exact systemd .service name'
[[ $ENV_DIR == /* && -d $ENV_DIR ]] || fail 'ENV_DIR must be an existing absolute directory'
ENV_DIR=$(realpath -e "$ENV_DIR")
[[ $HEALTH_URL =~ ^http://(127\.0\.0\.1|localhost|10\.8\.0\.2)(:[0-9]+)?$ ]] || fail 'Use the verified local application HTTP origin for HEALTH_URL'
[[ -d $DEPLOY_ROOT && -w $DEPLOY_ROOT ]] || fail 'Provision a writable, dedicated DEPLOY_ROOT first'
DEPLOY_ROOT=$(realpath -e "$DEPLOY_ROOT")
export PATH="$NODE_BIN_DIR:$PATH"
[[ $(node --version) == "$NODE_VERSION" ]] || fail 'Node version differs from the inspected server configuration'
for command in npm curl flock tar sha256sum systemctl python3; do command -v "$command" > /dev/null || fail "Missing $command"; done
systemctl_bin=$(command -v systemctl)
# Listing a command alone can succeed for a password-required ALL rule. Require
# the exact dedicated NOPASSWD rule, without restarting a healthy service to test.
restart_allowed=0
sudo_policy=$(LC_ALL=C sudo -n -l) || fail 'Cannot inspect service restart permission'
while IFS= read -r rule; do
  if [[ $rule == *"(root) NOPASSWD: $systemctl_bin restart $SERVICE" ]]; then restart_allowed=1; fi
done <<< "$sudo_policy"
(( restart_allowed )) || fail 'Configure the exact passwordless sudo rule for this application service restart'
if [[ $component == backend ]]; then
  [[ -n ${ENV_FILE:-} && -f $ENV_FILE && -r $ENV_FILE ]] || fail 'Configure the existing backend ENV_FILE'
  [[ -n ${DATABASE_PATH:-} && $DATABASE_PATH == /* && -f $DATABASE_PATH ]] || fail 'Configure the existing absolute DATABASE_PATH'
  [[ $(env -u DATABASE_PATH node --env-file="$ENV_FILE" -p 'process.env.DATABASE_PATH || ""') == "$DATABASE_PATH" ]] || fail 'Backend environment does not reference the preserved database'
  [[ $(systemctl show "$SERVICE" --property=EnvironmentFiles --value) == "$ENV_FILE (ignore_errors=no)" ]] || fail 'Backend service EnvironmentFile differs from ENV_FILE'
fi

# Also serializes manual rollbacks and deployments from other clients.
exec 9> "$DEPLOY_ROOT/.deploy.lock"
flock -w 1200 9 || fail 'Timed out waiting for the server deployment lock'
[[ -L $CURRENT_PATH && -d $CURRENT_PATH ]] || fail 'CURRENT_PATH must already be a working symlink; bootstrap requires inspection'
[[ $(systemctl show "$SERVICE" --property=LoadState --value) == loaded ]] || fail 'Service does not exist'
[[ $(systemctl show "$SERVICE" --property=WorkingDirectory --value) == "$CURRENT_PATH" ]] || fail 'Configured service WorkingDirectory does not match CURRENT_PATH'
previous=$(readlink -f "$CURRENT_PATH")
[[ -d $previous ]] || fail 'Cannot resolve existing deployment'
if [[ $component == backend ]]; then
  database_real=$(realpath -e "$DATABASE_PATH")
  [[ $database_real != "$DEPLOY_ROOT/"* && $database_real != "$previous/"* ]] || fail 'Production database must remain outside application releases'
fi
mkdir -p "$DEPLOY_ROOT/releases"

curl_opts=(--silent --show-error --fail --connect-timeout 3 --max-time 5)
if [[ -n ${HEALTH_HOST:-} ]]; then curl_opts+=(-H "Host: $HEALTH_HOST"); fi
root_healthy() {
  local status
  status=$(curl "${curl_opts[@]}" --output /dev/null --write-out '%{http_code}' "$HEALTH_URL$health_path") || return 1
  [[ $status == 200 ]] || return 1
  if [[ $component == backend ]]; then
    local body
    body=$(curl "${curl_opts[@]}" "$HEALTH_URL$health_path") || return 1
    python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("ok") is True else 1)' <<< "$body" || return 1
  fi
}

switch_link() {
  local target=$1 link=$2 temporary
  temporary="${link}.pending.$$"
  [[ ! -e $temporary && ! -L $temporary ]] || fail "Temporary symlink already exists: $temporary"
  ln -s "$target" "$temporary" || return 1
  mv -Tf "$temporary" "$link" || return 1
}
restart() { sudo -n "$systemctl_bin" restart "$SERVICE"; }
healthy() {
  local directory=$1 expected='' body attempt
  if [[ -f $directory/.deployment-revision ]]; then expected=$(cat "$directory/.deployment-revision"); fi
  for attempt in {1..30}; do
    if systemctl is-active --quiet "$SERVICE" && root_healthy; then
      if [[ -z $expected ]]; then return 0; fi # Inspected legacy baseline.
      body=$(curl "${curl_opts[@]}" "$HEALTH_URL$revision_path?attempt=$attempt") || body=''
      [[ $body == "$expected" ]] && return 0
    fi
    sleep 2
  done
  return 1
}

switched=0
restore_on_failure() {
  local result=$?
  trap - EXIT INT TERM HUP
  if (( switched )); then
    log "Activation failed; restoring $previous"
    if switch_link "$previous" "$CURRENT_PATH" && restart && healthy "$previous"; then
      log 'Previous deployment restored and healthy'
    else
      log 'CRITICAL: rollback failed; inspect the application service immediately'
    fi
  fi
  exit "$result"
}
trap restore_on_failure EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

action=${1:-}
case "$action" in
  deploy)
    systemctl is-active --quiet "$SERVICE" || fail 'Existing application service must be healthy before deployment'
    root_healthy || fail 'Existing application HTTP health check failed'
    if git -C "$previous" rev-parse --is-inside-work-tree > /dev/null 2>&1; then
      changes=$(git -C "$previous" status --porcelain)
      [[ -z $changes ]] || fail "Existing Git deployment has uncommitted changes; inspect them before deploying: $changes"
    fi
    release=${2:-}; revision=${3:-}; archive=${4:-}; checksum=${5:-}
    [[ $release =~ ^[a-f0-9]{40}-[0-9]+-[0-9]+$ && $revision =~ ^[a-f0-9]{40}$ && $release == "$revision-"* ]] || fail 'Invalid release identity'
    [[ $archive =~ ^/tmp/scrolled-upload\.[a-zA-Z0-9]+/(frontend|backend)\.tar\.gz$ && $archive == */"$component.tar.gz" && -f $archive ]] || fail 'Invalid upload path'
    [[ $checksum =~ ^[a-f0-9]{64}$ ]] || fail 'Invalid archive checksum'
    printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check --status || fail 'Upload checksum mismatch'
    destination="$DEPLOY_ROOT/releases/$release"
    [[ ! -e $destination && ! -L $destination ]] || fail 'Release already exists; use a new workflow attempt'
    # git archive supplies only tracked component source. Never extract .env files,
    # symlinks or traversal paths from even an accidentally mispackaged archive.
    python3 - "$archive" <<'PY'
import pathlib, sys, tarfile
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    for member in archive.getmembers():
        path = pathlib.PurePosixPath(member.name)
        if path.is_absolute() or '..' in path.parts or not (member.isfile() or member.isdir()):
            raise SystemExit('Unsafe archive entry: ' + member.name)
        if any(part.startswith('.env') and part != '.env.example' for part in path.parts):
            raise SystemExit('Environment file in source archive: ' + member.name)
        if path.parts[0] in ('data', 'node_modules', '.next') or path.suffix in ('.db', '.sqlite', '.sqlite3'):
            raise SystemExit('Runtime data or dependencies in source archive: ' + member.name)
PY
    mkdir "$destination"
    tar -xzf "$archive" --no-same-owner --no-same-permissions -C "$destination"
    [[ -f $destination/.node-version && $(cat "$destination/.node-version") == "${NODE_VERSION#v}" ]] || fail 'Release Node pin differs from the production runtime'
    if [[ $component == frontend ]]; then
      # Never copy, print, overwrite or remove production environment files.
      for name in .env .env.local .env.production .env.production.local; do
        if [[ -f $ENV_DIR/$name ]]; then ln -s "$(realpath -e "$ENV_DIR/$name")" "$destination/$name"; fi
      done
    fi
    log "Building exact source commit $revision using $(node --version) / npm $(npm --version)"
    (
      cd "$destination"
      unset NODE_ENV
      npm ci --no-audit --no-fund
      if [[ $component == backend ]]; then
        # Native TypeScript: validate on the existing service runtime; no emit.
        npm run typecheck
        npm test
      else
        NODE_ENV=production npm run build
      fi
    )
    if [[ $component == frontend ]]; then
      [[ -s $destination/.next/BUILD_ID ]] || fail 'Next.js build did not produce BUILD_ID'
      mkdir -p "$destination/public"
    else
      # SQLite online backup preserves a consistent WAL-backed snapshot while
      # requests continue. Rollbacks change code only and never restore this DB.
      mkdir -p "$DEPLOY_ROOT/backups"
      chmod 700 "$DEPLOY_ROOT/backups"
      python3 - "$DATABASE_PATH" "$DEPLOY_ROOT/backups/$release.sqlite3" <<'PY'
import os, pathlib, sqlite3, sys
source_path = pathlib.Path(sys.argv[1]).resolve()
os.umask(0o077)
with sqlite3.connect(source_path.as_uri() + '?mode=ro', uri=True) as source:
    if source.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
        raise SystemExit('Production database integrity check failed')
    with sqlite3.connect(sys.argv[2]) as backup:
        source.backup(backup)
        if backup.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise SystemExit('Database backup integrity check failed')
print('Consistent database backup created; production database preserved')
PY
    fi
    printf '%s %s\n' "$revision" "$release" > "$destination/.deployment-revision"
    if [[ $component == frontend ]]; then cp "$destination/.deployment-revision" "$destination/public/__deployment.txt"; fi
    ;;
  rollback)
    expected=${2:-}
    if [[ -n $expected ]]; then
      [[ $expected =~ ^[a-f0-9]{40}-[0-9]+-[0-9]+$ ]] || fail 'Invalid rollback guard'
      [[ $previous == "$DEPLOY_ROOT/releases/$expected" ]] || fail 'Current release changed; refusing rollback'
    fi
    [[ -L $DEPLOY_ROOT/previous ]] || fail 'No previous release recorded'
    destination=$(readlink -f "$DEPLOY_ROOT/previous")
    [[ -d $destination && $destination != "$previous" ]] || fail 'Previous release is missing or already current'
    log "Rolling back to $destination"
    ;;
  *) fail 'Usage: remote.sh [backend] deploy RELEASE SHA ARCHIVE CHECKSUM | [backend] rollback [CURRENT_RELEASE]' ;;
esac

# Persist the rollback target before switching. All builds happen before restart.
switch_link "$previous" "$DEPLOY_ROOT/previous"
switched=1
switch_link "$destination" "$CURRENT_PATH"
restart
healthy "$destination" || fail 'Application failed HTTP/service/revision checks after restart'
switched=0
log "Healthy deployment: $destination"
# No automatic pruning: the baseline, rollback target and environment stay intact.
