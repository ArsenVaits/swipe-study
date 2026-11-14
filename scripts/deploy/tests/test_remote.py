"""Exercise the real release script with isolated services and package commands.

These tests never connect to production, use sudo privileges, or install packages.
"""

import hashlib
import io
import os
from pathlib import Path
import secrets
import sqlite3
import subprocess
import tarfile
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "remote.sh"
SHA = "a" * 40
RELEASE = SHA + "-123-1"
MOCK = r'''#!/usr/bin/python3
import os, pathlib, subprocess, sys
root = pathlib.Path(os.environ["TEST_ROOT"])
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
current = (root / "current").resolve()
component = os.environ.get("TEST_COMPONENT", "frontend")
service = "existing-" + component + ".service"
if name == "node":
    if args == ["--version"]:
        print("v24.0.0")
    else:
        print((root / "backend.env").read_text().strip().split("=", 1)[1])
elif name == "npm":
    if args == ["--version"]:
        print("11.0.0")
    elif args == ["run", "build"]:
        if (root / "fail-build").exists():
            sys.exit(1)
        pathlib.Path(".next").mkdir()
        pathlib.Path(".next/BUILD_ID").write_text("test-build")
    elif args == ["run", "typecheck"] and (root / "fail-build").exists():
        sys.exit(1)
elif name == "sudo":
    if "-l" in args:
        if (root / "fail-sudo").exists():
            print("    (ALL : ALL) ALL")
        else:
            print("    (root) NOPASSWD: " + str(root / "bin/systemctl") + " restart " + service)
        sys.exit(0)
    sys.exit(subprocess.call(args[1:]))
elif name == "systemctl":
    if "--property=LoadState" in args:
        print("loaded")
    elif "--property=WorkingDirectory" in args:
        print(root / ("wrong" if (root / "wrong-service").exists() else "current"))
    elif "--property=EnvironmentFiles" in args:
        print(str(root / "backend.env") + " (ignore_errors=no)")
    elif args[0] == "restart":
        if args[1] != service:
            raise SystemExit("Wrong service restart")
        with (root / "restarts").open("a") as f:
            f.write(str(current) + "\n")
        if (current / "fail-restart").exists():
            sys.exit(1)
elif name == "curl":
    if (current / "fail-health").exists():
        sys.exit(22)
    if "--write-out" in args:
        print("200", end="")
    elif "/api/health" in args[-1]:
        print('{"ok": true}')
    else:
        marker = ".deployment-revision" if component == "backend" else "public/__deployment.txt"
        print((current / marker).read_text(), end="")
elif name == "sleep":
    pass
else:
    raise SystemExit("Unexpected mock command: " + name)
'''


class ReleaseTests(unittest.TestCase):
    component = "frontend"

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="scrolled-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.deploy = self.root / "deploy"
        self.deploy.mkdir()
        self.baseline = self.root / "baseline"
        self.baseline.mkdir()
        (self.baseline / "keep.txt").write_text("original production files")
        self.current = self.root / "current"
        self.current.symlink_to(self.baseline)
        self.env_dir = self.root / "environment"
        self.env_dir.mkdir()
        (self.env_dir / ".env.production").write_text("SECRET=preserved\n")
        self.bin = self.root / "bin"
        self.bin.mkdir()
        helper = self.bin / "mock"
        helper.write_text(MOCK)
        helper.chmod(0o755)
        for name in ("node", "npm", "sudo", "systemctl", "curl", "sleep"):
            (self.bin / name).symlink_to(helper)
        self.config = self.root / "deploy.conf"
        self.config.write_text(
            f"DEPLOY_ROOT='{self.deploy}'\nCURRENT_PATH='{self.current}'\n"
            f"ENV_DIR='{self.env_dir}'\nNODE_BIN_DIR='{self.bin}'\n"
            f"NODE_VERSION='v24.0.0'\nSERVICE='existing-{self.component}.service'\n"
            "HEALTH_URL='http://127.0.0.1'\n"
        )
        self.environment = dict(os.environ, TEST_ROOT=str(self.root), TEST_COMPONENT=self.component,
                                SCROLLED_DEPLOY_CONFIG=str(self.config))
        if self.component == "backend":
            self.database = self.root / "production.db"
            with sqlite3.connect(self.database) as connection:
                connection.execute("CREATE TABLE sentinel (value TEXT)")
                connection.execute("INSERT INTO sentinel VALUES ('preserved')")
            self.env_file = self.root / "backend.env"
            self.env_file.write_text(f"DATABASE_PATH={self.database}\n")
            with self.config.open("a") as config:
                config.write(f"ENV_FILE='{self.env_file}'\nDATABASE_PATH='{self.database}'\n")
        self.upload = Path("/tmp/scrolled-upload." + secrets.token_hex(12))
        self.upload.mkdir(mode=0o700)
        self.addCleanup(lambda: self.upload.rmdir())

    def archive(self, extra=None):
        archive = self.upload / f"{self.component}.tar.gz"
        self.addCleanup(lambda: archive.unlink(missing_ok=True))
        files = {"package.json": "{}", "package-lock.json": "{}", ".node-version": "24.0.0\n"}
        files.update(extra or {})
        with tarfile.open(archive, "w:gz") as bundle:
            for name, value in files.items():
                info = tarfile.TarInfo(name)
                data = value.encode()
                info.size = len(data)
                bundle.addfile(info, io.BytesIO(data))
        return str(archive), hashlib.sha256(archive.read_bytes()).hexdigest()

    def run_script(self, *args, success):
        component = ["backend"] if self.component == "backend" else []
        result = subprocess.run(["bash", str(SCRIPT), *component, *args], env=self.environment,
                                text=True, capture_output=True, timeout=15)
        self.assertEqual(result.returncode == 0, success, result.stdout + result.stderr)
        self.assertEqual((self.baseline / "keep.txt").read_text(), "original production files")
        self.assertEqual((self.env_dir / ".env.production").read_text(), "SECRET=preserved\n")
        if self.component == "backend":
            with sqlite3.connect(self.database) as connection:
                self.assertEqual(connection.execute("SELECT value FROM sentinel").fetchall(), [("preserved",)])
            self.assertEqual(self.env_file.read_text(), f"DATABASE_PATH={self.database}\n")
        return result

    def test_success_then_manual_rollback(self):
        self.run_script("deploy", RELEASE, SHA, *self.archive(), success=True)
        release = self.deploy / "releases" / RELEASE
        self.assertEqual(self.current.resolve(), release)
        self.assertEqual((self.deploy / "previous").resolve(), self.baseline)
        if self.component == "frontend":
            self.assertTrue((release / ".env.production").is_symlink())
            self.assertEqual((release / "public/__deployment.txt").read_text(), f"{SHA} {RELEASE}\n")
        else:
            backup = self.deploy / "backups" / f"{RELEASE}.sqlite3"
            with sqlite3.connect(backup) as connection:
                self.assertEqual(connection.execute("SELECT value FROM sentinel").fetchall(), [("preserved",)])
            self.assertEqual(backup.stat().st_mode & 0o777, 0o600)
        self.run_script("rollback", RELEASE, success=True)
        self.assertEqual(self.current.resolve(), self.baseline)

    def test_failed_health_restores_running_baseline(self):
        result = self.run_script("deploy", RELEASE, SHA,
                                 *self.archive({"fail-health": "yes"}), success=False)
        self.assertIn("Previous deployment restored and healthy", result.stdout)
        self.assertEqual(self.current.resolve(), self.baseline)
        self.assertEqual(len((self.root / "restarts").read_text().splitlines()), 2)

    def test_build_failure_never_switches_or_restarts(self):
        (self.root / "fail-build").touch()
        self.run_script("deploy", RELEASE, SHA, *self.archive(), success=False)
        self.assertEqual(self.current.resolve(), self.baseline)
        self.assertFalse((self.root / "restarts").exists())

    def test_restart_failure_restores_baseline(self):
        result = self.run_script("deploy", RELEASE, SHA,
                                 *self.archive({"fail-restart": "yes"}), success=False)
        self.assertIn("Previous deployment restored and healthy", result.stdout)
        self.assertEqual(self.current.resolve(), self.baseline)

    def test_dirty_existing_git_checkout_is_preserved(self):
        subprocess.run(["git", "-C", str(self.baseline), "init", "--quiet"], check=True)
        result = self.run_script("deploy", RELEASE, SHA, *self.archive(), success=False)
        self.assertIn("uncommitted changes", result.stderr)
        self.assertEqual(self.current.resolve(), self.baseline)
        self.assertFalse((self.root / "restarts").exists())

    def test_invalid_checksum_rejected(self):
        archive, _ = self.archive()
        self.run_script("deploy", RELEASE, SHA, archive, "0" * 64, success=False)
        self.assertEqual(self.current.resolve(), self.baseline)

    def test_archive_environment_file_rejected(self):
        self.run_script("deploy", RELEASE, SHA, *self.archive({".env": "SECRET=bad"}), success=False)
        self.assertFalse((self.deploy / "releases" / RELEASE).exists())

    def test_release_runtime_mismatch_never_switches(self):
        self.run_script("deploy", RELEASE, SHA,
                        *self.archive({".node-version": "22.22.1\n"}), success=False)
        self.assertEqual(self.current.resolve(), self.baseline)
        self.assertFalse((self.root / "restarts").exists())

    def test_wrong_service_directory_rejected(self):
        (self.root / "wrong-service").touch()
        self.run_script("deploy", RELEASE, SHA, *self.archive(), success=False)
        self.assertFalse((self.root / "restarts").exists())

    def test_missing_restart_permission_never_switches(self):
        (self.root / "fail-sudo").touch()
        self.run_script("deploy", RELEASE, SHA, *self.archive(), success=False)
        self.assertEqual(self.current.resolve(), self.baseline)
        self.assertFalse((self.root / "restarts").exists())

    def test_stale_rollback_cannot_undo_newer_release(self):
        self.run_script("deploy", RELEASE, SHA, *self.archive(), success=True)
        self.run_script("rollback", SHA + "-122-1", success=False)
        self.assertEqual(self.current.resolve(), self.deploy / "releases" / RELEASE)

    def test_manual_rollback_recovers_unhealthy_release(self):
        self.run_script("deploy", RELEASE, SHA, *self.archive(), success=True)
        (self.current / "fail-health").touch()
        self.run_script("rollback", success=True)
        self.assertEqual(self.current.resolve(), self.baseline)


class BackendReleaseTests(ReleaseTests):
    component = "backend"

    def test_mismatched_database_never_switches(self):
        self.env_file.write_text("DATABASE_PATH=/tmp/wrong.db\n")
        result = subprocess.run(["bash", str(SCRIPT), "backend", "deploy", RELEASE, SHA,
                                 *self.archive()], env=self.environment, text=True,
                                capture_output=True, timeout=15)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("preserved database", result.stderr)
        self.assertEqual(self.current.resolve(), self.baseline)

    def test_archive_cannot_ship_database(self):
        self.run_script("deploy", RELEASE, SHA,
                        *self.archive({"data/scrolled.db": "bad"}), success=False)
        self.assertFalse((self.deploy / "releases" / RELEASE).exists())


if __name__ == "__main__":
    unittest.main()
