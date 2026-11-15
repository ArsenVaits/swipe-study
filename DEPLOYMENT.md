# Production deployment

## Verified architecture

Inspected over SSH on 2026-11-14:

| Component | Configuration |
| --- | --- |
| Repository / branch | `evgeniy1969lee-stack/scrolled`, `main` |
| Frontend | `frontend/`, Next.js 16.4.6, npm with `package-lock.json` |
| Frontend Node / npm | `/usr/bin/node` v22.22.1 / npm 9.2.0 |
| Backend Node / npm | `/home/arsenvaits/scrolled/runtime/node/bin/node` v24.22.3 / npm 11.19.1 |
| SSH | `ssh -p 2222 arsenvaits@89.126.195.129` → application host `vaits` |
| Gateway tunnel | `89.126.195.129:2222` → `10.8.0.2:22` |
| Nginx | Existing port 80 proxy to `http://127.0.0.1:3000` |
| Frontend service | `scrolled.service`, runs as `arsenvaits` |
| Service working directory | `/home/arsenvaits/scrolled/current` (existing symlink) |
| Service command | `/usr/bin/node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3000` |
| Existing baseline | `/home/arsenvaits/scrolled/releases/20261114-303d5a9/frontend` |
| New frontend releases | `/home/arsenvaits/scrolled/frontend-deploy/releases/<sha>-<run-id>-<attempt>` |
| Server deployment configuration | `/home/arsenvaits/.config/scrolled/deploy.conf` |
| Optional frontend environment file | `/home/arsenvaits/scrolled/.env.production` (already referenced by systemd) |
| Backend service / working directory | `scrolled-backend.service` / `/home/arsenvaits/scrolled/backend-current` |
| Backend command | `/home/arsenvaits/scrolled/runtime/node/bin/node src/server.ts` (native TypeScript) |
| Backend environment | `/home/arsenvaits/scrolled/backend.env` (existing systemd EnvironmentFile) |
| Persistent SQLite database | `/home/arsenvaits/scrolled/data/scrolled.db` (outside releases) |
| Backend baseline | `/home/arsenvaits/scrolled/releases/20261114-303d5a9/backend` |
| Backend releases / backups | `/home/arsenvaits/scrolled/backend-deploy/releases/` / `backend-deploy/backups/` |
| Backend deployment configuration | `/home/arsenvaits/.config/scrolled/backend-deploy.conf` |

Production has unpacked application source and compiled output, not a complete Git repository. The existing lockfile and Next.js configuration hashes match the repository. No production frontend `.env*` files were present at inspection. The API origin defaults to `http://127.0.0.1:3001`; backend credentials stay in the backend's existing environment file and are not deployed here.

The workflows preserve Nginx, systemd units, the gateway, WireGuard, NAT, SSH forwarding, persistent data, and all original releases. A dedicated SSH key uses the existing unprivileged application account. A separate Unix deployment account would require changing access to the existing application directory and symlink; this setup instead limits passwordless privilege to exact frontend and backend service restarts.

## Public domain

The canonical public origin is `https://swipestudy.duckdns.org`. Public deployment checks use HTTPS and validate the certificate for this hostname. SSH continues to use the existing IP address and forwarded port.

The migration was applied and publicly verified on 2026-11-15: DNS resolves to `89.126.195.129`, the homepage returns HTTP 200 with a valid TLS certificate, and `/api/health` reports `ok: true`. The old HTTPS domain and the new HTTP domain return HTTP 308 to the new HTTPS origin while preserving paths and query strings. Nginx, frontend, backend, and the Certbot renewal timer are active. Certificate renewal includes an Nginx reload hook.

The one-time migration uses `scripts/deploy/change-domain.sh` with `scripts/deploy/nginx.conf.example` alongside it. Both are staged in `/home/arsenvaits/.config/scrolled/`. To reapply the configuration as an administrator, run:

```sh
ssh -t -p 2222 arsenvaits@89.126.195.129 \
  'sudo bash /home/arsenvaits/.config/scrolled/change-domain.sh'
```

The script backs up the current Nginx vhost, expands the existing certificate to cover both domain names, installs and validates the new vhost, reloads Nginx, and checks frontend/API health over HTTPS. On failure it restores the previous vhost. After application, HTTP on both names and HTTPS on `scrolled.duckdns.org` redirect to `https://swipestudy.duckdns.org`, preserving paths and query strings. IP and loopback HTTP checks remain available. The existing Certbot account and certificate lineage stay in use, with an Nginx reload hook for renewal.

## Automatic deployment

Every push to `main`, including documentation-only pushes, runs both `.github/workflows/deploy.yml` (**Deploy frontend**) and `.github/workflows/deploy-backend.yml` (**Deploy backend**). Each also supports manual runs on `main`. They use separate concurrency groups and server locks, so one component cannot cancel the other's pending run. The workflows deploy independently; a failure in one does not undo a successful deployment of the other.

### Frontend

1. GitHub checks out the triggering commit with read-only repository permission. Official actions are pinned to immutable SHAs. Node is pinned to the discovered production version in `frontend/.node-version`.
2. Validate shell scripts, workflow deployment tests, and dependencies with `npm ci`; run `npm test`, a lint script if one exists, `npm run typecheck`, and `npm run build`. The project currently has no lint script. Any failure stops deployment.
3. Archive only tracked `frontend/` source from the exact triggering SHA and transfer it over SSH with strict host-key verification. No production Git credentials are needed. Verify the archive SHA-256 before extracting it into a new release directory.
4. Under a server-side `flock`, verify the configured Node version, restart permission, exact service working directory, and current service/HTTP health. If the previous deployment contains a Git checkout, refuse to proceed when it has uncommitted changes.
5. Link existing frontend `.env`, `.env.local`, `.env.production`, and `.env.production.local` files from the configured environment directory. Never copy, print, replace, or delete them. Run `npm ci` and `npm run build` on the server using production environment files and the verified Node runtime. Building again avoids moving native dependencies between different hosts and preserves production-specific Next.js rewrites.
6. Record `<sha> <release-id>` in `.deployment-revision` and `public/__deployment.txt`. Preserve the old target in `frontend-deploy/previous`, atomically switch `current`, and execute only `sudo -n /usr/bin/systemctl restart scrolled.service`.
7. Wait for systemd to be active, Nginx `/` to return exactly HTTP 200, and `/__deployment.txt` to return the expected release identity. Then check both endpoints through the public gateway from GitHub Actions.

Local activation failure restores the old symlink, restarts the frontend service, and checks recovery. Public verification failure invokes a guarded rollback only if this deployment is still current. Failed deployment jobs remain failures even when rollback succeeds. Builds do not interrupt the running site; the existing single-instance service has a brief restart window during activation. There is no promise of zero downtime.

Workflow concurrency queues production runs without cancelling an active deployment. The server lock also serializes manual rollback and other deployment clients. GitHub may coalesce pending pushes; the next run deploys its exact recorded SHA. Releases are not automatically pruned, preserving rollback targets and the original baseline. Monitor disk usage and remove obsolete releases only after confirming neither `current` nor `frontend-deploy/previous` references them.

### Backend

1. Use the exact backend runtime pinned in `backend/.node-version` (v24.22.3), `npm ci`, optional lint, `npm run typecheck`, and `npm test`. The existing backend executes TypeScript natively and has no compilation/build step. API tests spawn the real server against a temporary SQLite database, clear AI credentials, and never contact paid providers or production.
2. Transfer only the triggering SHA's tracked `backend/` source over the same verified SSH connection. Validate its checksum and reject environment files, runtime data, dependencies, and unsafe archive entries.
3. Load the separate backend deployment configuration. Check the exact service, working directory, runtime, NOPASSWD restart rule, environment-file path, existing absolute database path, and current `/api/health`. Reinstall locked dependencies and repeat type checking and isolated API tests using the service's actual Node runtime before switching.
4. Create a consistent SQLite online backup in `backend-deploy/backups/<release-id>.sqlite3` with mode 600, using SQLite's backup API while the original service continues handling requests. Verify database integrity. This includes committed WAL data; do not use a raw copy of a live `.db` file.
5. Write `.deployment-revision` in the new release, preserve `backend-deploy/previous`, atomically switch only `backend-current`, and restart only `scrolled-backend.service`. The unchanged unit continues reading the existing `backend.env`, including the absolute persistent database path. Environment files and production data are never copied into or replaced by a release.
6. Verify the service, HTTP 200 and `{ "ok": true }` at `http://127.0.0.1:3001/api/health`, and the exact identity at `/api/deployment`. Repeat health and revision checks through `https://swipestudy.duckdns.org/api/...`, exercising the existing Nginx → Next.js → backend route. `/api/health` also reports the running `revision`.

Failures restore the previous backend code and recheck health. Public-check rollback is guarded against undoing a newer release. Rollback never restores the database automatically, because that could discard requests completed after the snapshot. Database schema changes must remain compatible with the previous application release; destructive migrations require a separately reviewed migration/restore plan. The current backend uses additive `CREATE TABLE/INDEX IF NOT EXISTS` initialization and this deployment adds no migration.

The bundled demo file was verified against production before enabling deployment and is included in each source release. Backend release/backup retention is manual; preserve both `backend-current` and `backend-deploy/previous` targets and keep required backups outside public directories. The existing single-instance API can have a brief interruption during restart.

## GitHub Secrets and server setup

Repository Actions secrets have been configured; they may instead be moved to the `production` environment without renaming them:

| Secret | Value / purpose |
| --- | --- |
| `DEPLOY_HOST` | `89.126.195.129` |
| `DEPLOY_PORT` | `2222` |
| `DEPLOY_USER` | `arsenvaits` |
| `DEPLOY_SSH_KEY` | Dedicated Ed25519 deployment private key, stored only as a GitHub secret after setup |
| `DEPLOY_KNOWN_HOSTS` | Previously trusted `[89.126.195.129]:2222` Ed25519 host-key entry |

Never upload a personal private key or put secrets in this repository. The dedicated public key is installed with the `restrict` option in the application account's `authorized_keys`, preserving existing entries. Forwarding and PTY access are disabled. It retains shell/SFTP access as the application user because deployment uploads and builds source. Only trusted maintainers should be able to modify `main`, workflows, or deployment secrets. Configure branch/environment protection in repository settings as appropriate; required environment reviewers would make deployment require approval.

Host-key verification uses the saved, trusted host key; it never disables checking or trusts an unverified `ssh-keyscan` result. After legitimate host-key rotation, verify the new fingerprint through an independent trusted channel before replacing the secret. Do not use the gateway's port-22 host key: the forwarded port 2222 belongs to the application server.

The verified configurations are installed at `~/.config/scrolled/deploy.conf` and `~/.config/scrolled/backend-deploy.conf`. Non-secret references are in `scripts/deploy/server.conf.example` and `scripts/deploy/backend-server.conf.example`. Each release root is separate from the existing baseline. The frontend links only its `.env*` files. The backend retains the existing systemd EnvironmentFile; its path and DATABASE_PATH are checked without printing any API keys.

One-time administrator setup is needed if the exact restart rules are not installed. Syntax-checked files are staged at `~/.config/scrolled/scrolled-deploy.sudoers` and `~/.config/scrolled/scrolled-backend-deploy.sudoers`, containing respectively:

```sudoers
arsenvaits ALL=(root) NOPASSWD: /usr/bin/systemctl restart scrolled.service
arsenvaits ALL=(root) NOPASSWD: /usr/bin/systemctl restart scrolled-backend.service
```

Install it from an authenticated administrative SSH session:

```sh
sudo install -o root -g root -m 0440 \
  /home/arsenvaits/.config/scrolled/scrolled-deploy.sudoers \
  /etc/sudoers.d/scrolled-deploy
sudo visudo -cf /etc/sudoers.d/scrolled-deploy
sudo install -o root -g root -m 0440 \
  /home/arsenvaits/.config/scrolled/scrolled-backend-deploy.sudoers \
  /etc/sudoers.d/scrolled-backend-deploy
sudo visudo -cf /etc/sudoers.d/scrolled-backend-deploy
sudo -n -l
```

Do not grant unrestricted sudo or allow Nginx, network, or gateway services to be restarted by this key. The script requires the exact dedicated NOPASSWD rule before changing a release. Merely listing a command with `sudo -l COMMAND` is insufficient: a password-required ALL rule can also allow the listing.

If adding frontend configuration later, create it securely on the server, outside releases. Never commit production environment values. `SCROLLED_API_ORIGIN` is evaluated by `next.config.ts` at build time: set it in the preserved frontend environment file, or explicitly export the verified origin in the private server deployment configuration if systemd supplies it only as an inline environment setting. Rebuild after changing it. No frontend secrets are required by the current CI build.

## Manual runs and logs

In GitHub: **Actions → Deploy frontend** or **Deploy backend → Run workflow → main**. Or:

```sh
gh workflow run deploy.yml --repo evgeniy1969lee-stack/scrolled --ref main
gh workflow run deploy-backend.yml --repo evgeniy1969lee-stack/scrolled --ref main
gh run list --repo evgeniy1969lee-stack/scrolled --workflow deploy.yml --limit 5
gh run list --repo evgeniy1969lee-stack/scrolled --workflow deploy-backend.yml --limit 5
gh run view RUN_ID --repo evgeniy1969lee-stack/scrolled --log
```

Each run reports the SHA, runtime, build output, release target, health result, rollback result when applicable, and a job summary. Avoid enabling shell tracing around credentials or environment files.

Server diagnostics (read-only):

```sh
ssh -p 2222 arsenvaits@89.126.195.129
systemctl status scrolled.service --no-pager
journalctl -u scrolled.service -n 100 --no-pager
readlink -f /home/arsenvaits/scrolled/current
cat /home/arsenvaits/scrolled/current/.deployment-revision
curl -f http://127.0.0.1/
curl -f http://127.0.0.1/__deployment.txt
systemctl status scrolled-backend.service --no-pager
journalctl -u scrolled-backend.service -n 100 --no-pager
readlink -f /home/arsenvaits/scrolled/backend-current
curl -f http://127.0.0.1:3001/api/health
curl -f http://127.0.0.1:3001/api/deployment
```

Public verification:

```sh
curl -f https://swipestudy.duckdns.org/
curl -f "https://swipestudy.duckdns.org/__deployment.txt?check=$(date +%s)"
curl -f https://swipestudy.duckdns.org/api/health
curl -f "https://swipestudy.duckdns.org/api/deployment?check=$(date +%s)"
```

The marker contains public commit/release identifiers only. The legacy baseline has no marker; its fallback rollback check uses service state and HTTP 200.

## Rollback

To restore the previous deployment, run from a trusted checkout on your workstation using your normal authorized SSH key:

```sh
ssh -p 2222 arsenvaits@89.126.195.129 'bash -s -- rollback' \
  < scripts/deploy/remote.sh
```

This uses the same lock, exact service check, atomic switch, restart, and health verification as deployment. It also supports recovery when the current service is unhealthy. If recovery fails, it attempts to restore the starting target and reports failure. Inspect the logs immediately if both targets fail.

For the backend, select its configuration explicitly:

```sh
ssh -p 2222 arsenvaits@89.126.195.129 'bash -s -- backend rollback' \
  < scripts/deploy/remote.sh
```

This changes backend code only and preserves the live database and environment. Append `FULL_SHA-RUN_ID-ATTEMPT` after `rollback` to guard against reverting a newer backend release. The frontend is unaffected.

For automation, add the current release ID to guard against rolling back a newer run:

```sh
ssh -p 2222 arsenvaits@89.126.195.129 \
  'bash -s -- rollback FULL_SHA-RUN_ID-ATTEMPT' < scripts/deploy/remote.sh
```

The previous link is updated to the target being left, so repeating an unguarded rollback toggles releases. Failed activation keeps the old deployment as the rollback target. Rollback does not revert GitHub `main`: revert the faulty source commit and push, or the next deployment will build that source again. Never reset or delete production application directories to roll back.

## Troubleshooting

| Failure | Check |
| --- | --- |
| `Permission denied (publickey)` | Verify `DEPLOY_USER`, the dedicated key in `authorized_keys`, permissions on `.ssh`, and that the GitHub secret contains the full private key. Do not print it. |
| Host-key mismatch | Independently verify the application's forwarded SSH host key; update only `DEPLOY_KNOWN_HOSTS`. |
| SSH timeout | Check reachability of the existing public port 2222. This pipeline does not change gateway networking. |
| Passwordless restart denied | Validate the exact root-owned mode-0440 sudoers rule above; do not add wildcard service names. |
| Node version mismatch | Frontend uses `/usr/bin/node` and `frontend/.node-version`; backend uses `runtime/node/bin/node` and `backend/.node-version`. Compare the corresponding private deployment configuration. Update each set together after a planned runtime change. |
| Dependency/build failure | Read the failed npm step; verify registry connectivity, disk space, the committed lockfile, and preserved build environment. The current release is untouched. |
| Working directory mismatch | Reinspect the existing unit with `systemctl show scrolled.service --property=WorkingDirectory,ExecStart`. Correct the deployment configuration; do not silently rewrite the unit. |
| Health/revision failure | Inspect frontend logs, Nginx reachability, current/previous links, and the marker. A backend `/api/health` response alone cannot verify frontend revision, so it is not used as this health check. |
| Backend database mismatch | Verify the unchanged absolute DATABASE_PATH in backend.env and backend-deploy.conf. Do not create a fresh database in a release to bypass this check. |
| Archive or environment rejection | The upload must be the workflow's tracked component source archive, without secrets, databases, runtime dependencies, symlinks, or traversal paths. |
| Run waiting | Check the active production workflow, environment protection rules, and server deployment lock. Do not cancel a run during activation. |

Local validation commands:

```sh
actionlint .github/workflows/deploy.yml .github/workflows/deploy-backend.yml
bash -n scripts/deploy/*.sh
shellcheck scripts/deploy/*.sh
python3 -m unittest discover -s scripts/deploy/tests -v
cd frontend
npm ci
npm test
npm run typecheck
npm run build
cd ../backend
# Use the backend's pinned Node version.
npm ci
npm run typecheck
npm test
```

Deployment tests use isolated fake service/npm/HTTP commands for both components and verify success, rollback, failed health/build/restart, archive checks, environment/data protection, consistent database backups, restart permissions, stale rollback guards, and service targeting. Backend API tests additionally start the real server, test health/revision/validation/static responses, and verify SQLite records survive restart. They do not establish that production deployment works; only a completed GitHub Actions run with public SHA verification establishes that.
