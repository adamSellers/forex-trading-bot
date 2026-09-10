#!/usr/bin/env python3
"""Exercise deployment orchestration with disposable source and command stubs.

No SSH connection, real Git mutation, package installation, build, PM2 process or
broker request is made. Startup cases encrypt only disposable broker fixtures.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1]

COMMAND_STUB = r'''#!/usr/bin/env python3
import json, os, pathlib, subprocess, sys, tarfile
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
root = pathlib.Path(os.environ["TEST_ROOT"])
state_path = root / "state.json"
state = json.loads(state_path.read_text())
def save(): state_path.write_text(json.dumps(state))
def log(event):
    with (root / "calls.jsonl").open("a") as output:
        output.write(json.dumps(event) + "\n")
def fail(point):
    if os.environ.get("FAIL_AT") == point: sys.exit(1)
if name == "ssh":
    log(["ssh", *args, sys.stdin.read()]); sys.exit(0)
if name == "flock":
    os.fstat(9)
    log(["flock", *args])
    sys.exit(1 if os.environ.get("LOCK_BUSY") == "1" else 0)
if name == "sleep": sys.exit(0)
if name == "git":
    if args[:1] == ["-C"]: args = args[2:]
    log(["git", *args])
    if args[0] == "check-ref-format": sys.exit(0)
    if args[0] == "status":
        print(" M tracked-file" if os.environ.get("DIRTY") == "1" else "")
    elif args[0] == "rev-parse":
        print(state["head"] if args[-1] == "HEAD" else os.environ["FOREX_DEPLOY_REVISION"])
    elif args[0] == "merge-base": fail("not-fast-forward")
    elif args[0] == "fetch": fail("fetch")
    elif args[0] == "archive":
        source = pathlib.Path(os.environ["ARCHIVE_SOURCE"])
        with tarfile.open(fileobj=sys.stdout.buffer, mode="w|") as archive:
            for entry in source.iterdir(): archive.add(entry, arcname=entry.name)
    elif args[0] == "merge":
        fail("merge")
        state["head"] = args[-1]; save()
    else: raise SystemExit("Unexpected git command: " + repr(args))
    sys.exit(0)
if name == "npm":
    component = pathlib.Path.cwd().name
    log(["npm", component, *args])
    point = component + ":" + " ".join(args)
    fail(point)
    if args[0] == "ci":
        directory = pathlib.Path("node_modules"); directory.mkdir(exist_ok=True)
        (directory / "prepared.txt").write_text("new dependencies")
    if args == ["run", "build"]:
        directory = pathlib.Path("dist"); directory.mkdir(exist_ok=True)
        (directory / "index.html").write_text("new dashboard")
    if args[0] == "test":
        for key in ["OANDA_API_KEY", "OANDA_ACCOUNT_ID", "OANDA_ENVIRONMENT",
                    "FOREX_PROJECT_DIR", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
                    "AWS_SESSION_TOKEN", "EMAIL_PASS", "SMTP_PASSWORD"]:
            if key in os.environ: raise SystemExit("Test inherited credential: " + key)
        assert os.environ.get("NODE_ENV") == "test"
        assert os.environ.get("ENABLE_S3_ANALYTICS") == "false"
        assert os.environ.get("DB_PATH") == str(root / "release/backend/data/deployment-test.db")
    if args == ["run", "db:migrate"]:
        assert os.environ.get("DB_PATH") == str(root / "production/backend/data/trading.db")
        assert os.environ.get("NODE_ENV") == "production"
    sys.exit(0)
if name == "pm2":
    log(["pm2", *args]); fail("pm2:" + args[0])
    if args[0] == "start":
        if "FOREX_DEPLOY_LOCK_FD" in os.environ: raise SystemExit("PM2 inherited lock marker")
        if "FOREX_DEPLOY_LEGACY_ACCESS" in os.environ: raise SystemExit("PM2 inherited legacy access mode")
        try: os.fstat(9)
        except OSError: pass
        else: raise SystemExit("PM2 inherited lock descriptor")
    if args[0] in ["start", "restart"]: state["running"] = True; save()
    if args[0] == "stop": state["running"] = False; save()
    if args[0] == "pid": print("4321" if state["running"] else "0")
    sys.exit(0)
if name == "fixture-command":
    action = args.pop(0)
    if action == "api":
        endpoint = args[-1].split("/api/")[-1]
        log(["api", endpoint])
        if endpoint == "health":
            if not state["running"]: sys.exit(22)
            value = "unknown" if os.environ.get("INVALID_STATE") == "1" else state["enabled"]
            print(json.dumps({"config": {"enableTrading": value}}))
        elif endpoint == "trading/stop":
            state["enabled"] = False; save(); fail("pause-response")
        elif endpoint == "trading/start":
            if os.environ.get("READINESS_BLOCKED") == "1": sys.exit(22)
            if os.environ.get("STUB_ACTUAL_ACTIVATION") == "1":
                config_path = pathlib.Path(os.environ["FOREX_PROJECT_DIR"]) / "backend/data/trading_config.json"
                config_path.parent.mkdir(parents=True, exist_ok=True)
                config_path.write_text(json.dumps({"enableTrading": state["enabled"]}))
                result = subprocess.run([os.environ["MAINTENANCE_TEST_NODE"],
                                         os.environ["MAINTENANCE_TEST_API"], "start"],
                                        capture_output=True, text=True)
                if result.returncode:
                    sys.stderr.write(result.stderr + result.stdout); sys.exit(22)
                reply = json.loads(result.stdout)
                log(["actual-readiness", reply["liveReadiness"]["status"],
                     reply["liveReadiness"]["entryRisk"]["entryAllowed"]])
                state["enabled"] = json.loads(config_path.read_text())["enableTrading"]
                save(); sys.exit(0)
            state["enabled"] = True; save(); fail("resume-response")
        else: raise SystemExit("Unexpected API request " + endpoint)
    elif action == "guard":
        state["guards"] += 1; save(); log(["guard", state["guards"]])
        if state["enabled"] or not state["running"]: sys.exit(1)
        if os.environ.get("NOT_FLAT") == "1": sys.exit(1)
        if os.environ.get("LATE_NOT_FLAT") == "1" and state["guards"] > 1: sys.exit(1)
    elif action == "backup":
        log(["backup", os.environ.get("FOREX_BACKUP_REQUIRE_RUN")]); fail("backup")
    elif action == "health":
        if "FOREX_DEPLOY_LEGACY_ACCESS" in os.environ: raise SystemExit("New release health inherited legacy access mode")
        log(["health"]); fail("health")
    elif action == "lock": log(["lock", *args])
    elif action == "bootstrap-runner":
        log(["bootstrap-runner", os.environ["FOREX_DEPLOY_REVISION"],
             os.environ["FOREX_DEPLOY_EXPECTED_HEAD"], str(pathlib.Path.cwd())])
        fail("bootstrap-runner")
    else: raise SystemExit("Unexpected fixture command " + action)
    sys.exit(0)
raise SystemExit("Unexpected executable " + name)
'''


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="forex-deploy-test-")
        self.root = Path(self.temporary.name)
        self.project = self.root / "production"
        self.stage = self.root / "release"
        self.backups = self.root / "backups"
        self.bin = self.root / "bin"
        for directory in [self.project / "backend/node_modules", self.project / "frontend/dist",
                          self.project / "scripts", self.stage / "backend", self.stage / "frontend",
                          self.stage / "scripts", self.backups, self.bin]:
            directory.mkdir(parents=True)
        (self.project / "backend/node_modules/original.txt").write_text("old dependencies")
        (self.project / "frontend/dist/index.html").write_text("old dashboard")
        self.state_path = self.root / "state.json"
        self.state_path.write_text(json.dumps({"head": "old-revision", "enabled": True,
                                               "running": True, "guards": 0}))
        for name in ["ssh", "git", "flock", "npm", "pm2", "sleep", "fixture-command"]:
            target = self.bin / name
            target.write_text(COMMAND_STUB)
            target.chmod(0o700)
        shutil.copy2(SCRIPTS / "deploy-release.sh", self.stage / "scripts/deploy-release.sh")
        self.helper("load-node-runtime.sh", ":")
        self.helper("load-maintenance-api.sh", '''
forex_api_curl() { fixture-command api "$@"; }
forex_require_paused_flat_running() { fixture-command guard; }
''')
        self.helper("deployment-lock.sh", '''
forex_acquire_deployment_lock() {
    exec 9>"$1"
    export FOREX_DEPLOY_LOCK_FD=9
    fixture-command lock "$@"
}
''')
        for name, action in [("backup.sh", "backup"),
                             ("health-check.sh", "health")]:
            self.helper(name, f'fixture-command {action} "$@"')
        self.env = {key: value for key, value in os.environ.items()
                    if not key.startswith(("FOREX_", "OANDA_", "AWS_"))}
        self.env.update({"PATH": f"{self.bin}:{os.environ['PATH']}", "TEST_ROOT": str(self.root),
                         "FOREX_PROJECT_DIR": str(self.project), "FOREX_BACKUP_DIR": str(self.backups),
                         "FOREX_DEPLOY_REVISION": "new-revision", "FOREX_DEPLOY_EXPECTED_HEAD": "old-revision"})

    def tearDown(self):
        self.temporary.cleanup()

    def helper(self, name, body):
        (self.stage / "scripts" / name).write_text("#!/bin/bash\nset -e\n" + body + "\n")

    def state(self, **changes):
        state = json.loads(self.state_path.read_text())
        if changes:
            state.update(changes)
            self.state_path.write_text(json.dumps(state))
        return state

    def calls(self):
        path = self.root / "calls.jsonl"
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def run_script(self, script, *args, **env):
        return subprocess.run(["bash", str(script), *args], env={**self.env, **env},
                              text=True, capture_output=True, timeout=30)

    def release(self, **env):
        return self.run_script(self.stage / "scripts/deploy-release.sh", **env)

    def assert_old_install(self):
        self.assertEqual(self.state()["head"], "old-revision")
        self.assertEqual((self.project / "backend/node_modules/original.txt").read_text(), "old dependencies")
        self.assertEqual((self.project / "frontend/dist/index.html").read_text(), "old dashboard")

    def test_launcher_transports_bootstrap_and_quotes_remote_arguments(self):
        result = self.run_script(SCRIPTS / "deploy.sh", FOREX_BRANCH="release/review-1")
        self.assertEqual(result.returncode, 0, result.stderr)
        call, = self.calls()
        self.assertEqual(call[:3], ["ssh", "adam@img.oakroad",
                                   f"bash -s -- '{self.project}' 'release/review-1'"])
        self.assertEqual(call[3], (SCRIPTS / "deploy-remote.sh").read_text())

    def test_launcher_rejects_shell_injection_and_option_arguments_before_ssh(self):
        for key, value in [("FOREX_DEPLOY_HOST", "-oProxyCommand=bad"),
                           ("FOREX_DEPLOY_HOST", "host;bad"),
                           ("FOREX_PROJECT_DIR", "/opt/app';bad;#"),
                           ("FOREX_PROJECT_DIR", "/opt/../app"),
                           ("FOREX_BRANCH", "main$(bad)"),
                           ("FOREX_BRANCH", "main'bad")]:
            with self.subTest(key=key, value=value):
                result = self.run_script(SCRIPTS / "deploy.sh", **{key: value})
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.calls(), [])

    def test_bootstrap_uses_pinned_archive_when_old_checkout_has_no_helpers(self):
        self.helper("deploy-release.sh", "fixture-command bootstrap-runner")
        result = self.run_script(SCRIPTS / "deploy-remote.sh", str(self.project), "main",
                                 ARCHIVE_SOURCE=str(self.stage))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(list((self.project / "scripts").iterdir()), [])
        self.assertIn(["git", "archive", "new-revision"], self.calls())
        self.assertTrue(any(call[:3] == ["bootstrap-runner", "new-revision", "old-revision"]
                            for call in self.calls()))
        self.assertFalse(list(self.backups.glob(".deploy-stage.*")))

    def test_bootstrap_repeats_archive_runner_at_same_revision(self):
        self.state(head="new-revision")
        self.helper("deploy-release.sh", "fixture-command bootstrap-runner")
        for _ in range(2):
            result = self.run_script(SCRIPTS / "deploy-remote.sh", str(self.project), "main",
                                     ARCHIVE_SOURCE=str(self.stage))
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(sum(call[0] == "bootstrap-runner" for call in self.calls()), 2)

    def test_bootstrap_keeps_recovery_stage_only_after_failed_cutover(self):
        for cutover in [False, True]:
            with self.subTest(cutover=cutover):
                marker = 'touch "$(dirname "$0")/../.cutover-started"\n' if cutover else ""
                self.helper("deploy-release.sh", marker + "fixture-command bootstrap-runner")
                result = self.run_script(SCRIPTS / "deploy-remote.sh", str(self.project), "main",
                                         ARCHIVE_SOURCE=str(self.stage), FAIL_AT="bootstrap-runner")
                self.assertNotEqual(result.returncode, 0)
                retained = list(self.backups.glob(".deploy-stage.*"))
                self.assertEqual(len(retained), int(cutover))
                self.assertIn(["flock", "-u", "9"], self.calls())
                if cutover:
                    self.assertIn(str(retained[0]), result.stderr)
                    self.assertTrue((retained[0] / ".cutover-started").exists())

    def test_non_fast_forward_is_rejected_before_archiving_or_running_release(self):
        result = self.run_script(SCRIPTS / "deploy-remote.sh", str(self.project), "main",
                                 ARCHIVE_SOURCE=str(self.stage), FAIL_AT="not-fast-forward")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(call[:2] == ["git", "archive"] or call[0] == "bootstrap-runner"
                             for call in self.calls()))

    def test_bootstrap_contention_and_dirty_checkout_do_not_fetch_or_pause(self):
        for settings in [{"LOCK_BUSY": "1"}, {"DIRTY": "1"}]:
            with self.subTest(settings=settings):
                result = self.run_script(SCRIPTS / "deploy-remote.sh", str(self.project), "main", **settings)
                self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(call[:2] == ["git", "fetch"] or call[0] == "api" for call in self.calls()))

    def test_success_gates_cutover_and_restores_enabled_only_after_health(self):
        result = self.release(OANDA_API_KEY="fixture-only", OANDA_ACCOUNT_ID="fixture-only",
                              OANDA_ENVIRONMENT="fixture-only",
                              AWS_ACCESS_KEY_ID="fixture-only", AWS_SECRET_ACCESS_KEY="fixture-only",
                              AWS_SESSION_TOKEN="fixture-only", EMAIL_PASS="fixture-only", SMTP_PASSWORD="fixture-only")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        calls = self.calls()
        milestones = [["api", "trading/stop"], ["guard", 1],
                      ["npm", "backend", "test", "--", "--runInBand"],
                      ["npm", "frontend", "run", "build"], ["backup", "1"], ["guard", 2],
                      ["pm2", "stop", "forex-backend", "--silent"],
                      ["git", "merge", "--ff-only", "new-revision"],
                      ["npm", "backend", "run", "db:migrate"],
                      ["pm2", "start", "ecosystem.config.js", "--env", "production"],
                      ["health"], ["api", "trading/start"]]
        indices = [calls.index(event) for event in milestones]
        self.assertEqual(indices, sorted(indices))
        self.assertEqual(self.state()["head"], "new-revision")
        self.assertTrue(self.state()["enabled"])
        self.assertTrue(self.state()["running"])
        self.assertEqual((self.project / "frontend/dist/index.html").read_text(), "new dashboard")
        self.assertTrue((self.project / "backend/node_modules/prepared.txt").exists())

    def test_deployment_needs_no_operator_token_or_credential_provisioning(self):
        result = self.release()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse((self.project / ".keys").exists())
        self.assertFalse((self.project / ".secrets").exists())
        self.assertFalse(any(call[0] == "setup" for call in self.calls()))
        self.assertNotIn("login token", result.stdout.lower())
        self.assertTrue(self.state()["enabled"])

    def test_same_revision_still_runs_tests_build_backup_and_health(self):
        self.state(head="new-revision")
        result = self.release(FOREX_DEPLOY_EXPECTED_HEAD="new-revision")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for event in [["npm", "backend", "test", "--", "--runInBand"],
                      ["npm", "frontend", "run", "build"], ["backup", "1"], ["health"]]:
            self.assertIn(event, self.calls())

    def test_preparation_failures_preserve_install_and_restore_previous_state(self):
        for point in ["backend:ci --include=dev", "backend:test -- --runInBand", "frontend:run build", "backup"]:
            with self.subTest(point=point):
                result = self.release(FAIL_AT=point)
                self.assertNotEqual(result.returncode, 0)
                self.assert_old_install()
                self.assertTrue(self.state()["enabled"])
                self.assertTrue(self.state()["running"])
                self.assertFalse(any(call[:2] == ["pm2", "stop"] for call in self.calls()))

    def test_initially_paused_remains_paused(self):
        self.state(enabled=False)
        result = self.release()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse(self.state()["enabled"])
        self.assertNotIn(["api", "trading/start"], self.calls())

    def test_restores_enabled_intent_through_real_activation_during_cooldown(self):
        import time
        result = self.release(
            STUB_ACTUAL_ACTIVATION="1", STUB_LAST_LOSS_AT=str(int(time.time() * 1000) - 60000),
            MAINTENANCE_TEST_NODE=shutil.which("node"),
            MAINTENANCE_TEST_API=str(SCRIPTS / "tests/maintenance_api_fixture.cjs"),
            MAINTENANCE_TEST_PROJECT=str(self.project),
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue(self.state()["enabled"])
        self.assertIn(["actual-readiness", "COOLDOWN", False], self.calls())
        self.assertLess(self.calls().index(["health"]), self.calls().index(["api", "trading/start"]))

    def test_flat_guard_defers_without_stopping_position_management(self):
        result = self.release(NOT_FLAT="1")
        self.assertNotEqual(result.returncode, 0)
        self.assert_old_install()
        self.assertTrue(self.state()["running"])
        self.assertTrue(self.state()["enabled"])
        self.assertFalse(any(call[0] in ["pm2", "npm", "backup"] for call in self.calls()))

    def test_late_flat_guard_prevents_cutover(self):
        result = self.release(LATE_NOT_FLAT="1")
        self.assertNotEqual(result.returncode, 0)
        self.assert_old_install()
        self.assertTrue(self.state()["running"])
        self.assertFalse(any(call[:2] == ["pm2", "stop"] for call in self.calls()))

    def test_unknown_trading_state_is_not_guessed(self):
        result = self.release(INVALID_STATE="1")
        self.assertNotEqual(result.returncode, 0)
        self.assert_old_install()
        self.assertNotIn(["api", "trading/stop"], self.calls())
        self.assertNotIn(["api", "trading/start"], self.calls())

    def test_lost_pause_response_attempts_restoration(self):
        result = self.release(FAIL_AT="pause-response")
        self.assertNotEqual(result.returncode, 0)
        self.assert_old_install()
        self.assertTrue(self.state()["enabled"])
        self.assertIn(["api", "trading/start"], self.calls())

    def test_lost_resume_response_is_resolved_by_observed_persisted_state(self):
        result = self.release(FAIL_AT="resume-response")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue(self.state()["enabled"])
        self.assertEqual(self.calls().count(["api", "trading/start"]), 1)

    def test_readiness_rejection_leaves_successful_release_paused(self):
        result = self.release(READINESS_BLOCKED="1")
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertEqual(self.state()["head"], "new-revision")
        self.assertFalse(self.state()["enabled"])
        self.assertTrue(self.state()["running"])
        self.assertIn(["health"], self.calls())

    def test_post_cutover_failure_never_resumes_entries(self):
        result = self.release(FAIL_AT="health")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.state()["enabled"])
        self.assertNotIn(["api", "trading/start"], self.calls())
        self.assertIn(["pm2", "stop", "forex-backend", "--silent"], self.calls())


class MaintenanceStartupTests(unittest.TestCase):
    """Run real startup/API helpers with isolated files and fake executables."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="forex-maintenance-test-")
        self.project = Path(self.temporary.name)
        self.bin = self.project / "bin"
        self.bin.mkdir()
        (self.project / "backend").mkdir()
        self.env = {key: value for key, value in os.environ.items()
                    if not key.startswith(("FOREX_", "OANDA_", "AWS_", "EMAIL_", "SMTP_"))}
        self.env.update({"FOREX_PROJECT_DIR": str(self.project), "FOREX_NODE_RUNTIME_LOADED": "1",
                         "PATH": f"{self.bin}:{os.environ['PATH']}"})
        self.command("node", '''#!/usr/bin/env python3
import json, os, pathlib, sys
assert sys.argv[1:] == ["server.js"]
assert os.environ.get("OANDA_API_KEY") == "fixture-broker-token"
assert os.environ.get("OANDA_ACCOUNT_ID") == "001-002-003"
assert os.environ.get("OANDA_ENVIRONMENT") == "practice"
(pathlib.Path(os.environ["FOREX_PROJECT_DIR"]) / "node-started.json").write_text(json.dumps(sys.argv[1:]))
''')

    def tearDown(self):
        self.temporary.cleanup()

    def command(self, name, source):
        path = self.bin / name
        path.write_text(source)
        path.chmod(0o700)

    def encrypt_fixture(self, name, value):
        keys = self.project / ".keys"
        secrets = self.project / ".secrets"
        keys.mkdir(exist_ok=True)
        secrets.mkdir(exist_ok=True)
        key = keys / "encryption.key"
        key.write_text("disposable-fixture-encryption-key\n")
        key.chmod(0o600)
        subprocess.run(["openssl", "enc", "-aes-256-cbc", "-pbkdf2", "-iter", "100000", "-salt",
                        "-pass", f"file:{key}", "-out", str(secrets / name)],
                       input=value + "\n", text=True, capture_output=True, check=True, timeout=10)

    def broker_fixtures(self):
        for name, value in [("oanda_api_key.enc", "fixture-broker-token"),
                            ("oanda_account_id.enc", "001-002-003"),
                            ("oanda_environment.enc", "practice")]:
            self.encrypt_fixture(name, value)

    def wrapper(self):
        return subprocess.run(["bash", str(SCRIPTS / "start-wrapper.sh")], env=self.env,
                              cwd=self.project / "backend", text=True, capture_output=True, timeout=10)

    def test_start_wrapper_loads_broker_credentials_without_operator_files_or_token(self):
        self.broker_fixtures()
        result = self.wrapper()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue((self.project / "node-started.json").exists())
        self.assertEqual({path.name for path in (self.project / ".keys").iterdir()}, {"encryption.key"})
        self.assertEqual({path.name for path in (self.project / ".secrets").iterdir()},
                         {"oanda_api_key.enc", "oanda_account_id.enc", "oanda_environment.enc"})
        self.assertNotIn("fixture-broker-token", result.stdout + result.stderr)

    def test_retired_invalid_operator_file_does_not_block_startup(self):
        self.broker_fixtures()
        (self.project / ".secrets/operator_token.enc").write_text("retired-invalid-ciphertext")
        result = self.wrapper()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue((self.project / "node-started.json").exists())

    def test_plain_maintenance_api_requires_no_credentials_and_keeps_timeouts(self):
        self.command("curl", '''#!/usr/bin/env python3
import json, os, pathlib, sys
args=sys.argv[1:]
assert not any("Authorization:" in arg for arg in args)
assert "--config" not in args
assert args[args.index("--connect-timeout")+1] == "5"
assert args[args.index("--max-time")+1] == "20"
(pathlib.Path(os.environ["FOREX_PROJECT_DIR"]) / "curl-called.json").write_text(json.dumps(args))
print('{"status":"ok"}')
''')
        result = subprocess.run(["bash", "-c", 'source "$1"; forex_api_curl http://localhost:3101/api/health',
                                 "maintenance-test", str(SCRIPTS / "load-maintenance-api.sh")],
                                env=self.env, text=True, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout), {"status": "ok"})
        self.assertTrue((self.project / "curl-called.json").exists())
        self.assertFalse((self.project / ".keys").exists())
        self.assertFalse((self.project / ".secrets").exists())

    def legacy_curl_fixture(self):
        self.command("curl", '''#!/usr/bin/env python3
import json, os, pathlib, sys
args=sys.argv[1:]
authorized="--config" in args
if authorized:
    header=sys.stdin.read()
    assert header == 'header = "Authorization: Bearer ' + 'ab' * 32 + '"\\n'
assert not any("Authorization:" in arg for arg in args)
root=pathlib.Path(os.environ["FOREX_PROJECT_DIR"])
with (root / "api-calls.jsonl").open("a") as output:
    output.write(json.dumps({"authorized":authorized,"args":args}) + "\\n")
if authorized:
    print('{"success":true}')
    sys.exit(0)
body=os.environ.get("FIXTURE_FIRST_BODY", "discarded unauthenticated response")
status=int(os.environ.get("FIXTURE_FIRST_EXIT", "22"))
if "--output" in args:
    pathlib.Path(args[args.index("--output")+1]).write_text(body)
    assert args[args.index("--write-out")+1] == "%{http_code}"
    sys.stdout.write(os.environ.get("FIXTURE_FIRST_HTTP", "401"))
else:
    sys.stdout.write(body)
sys.exit(status)
''')

    def maintenance_mutation(self, **env):
        return subprocess.run(["bash", "-c",
                               'source "$1"; forex_api_curl -X POST http://localhost:3101/api/trading/stop',
                               "maintenance-test", str(SCRIPTS / "load-maintenance-api.sh")],
                              env={**self.env, **env}, text=True, capture_output=True, timeout=10)

    def api_calls(self):
        return [json.loads(line) for line in (self.project / "api-calls.jsonl").read_text().splitlines()]

    def test_legacy_upgrade_retries_only_rejected_401_with_existing_saved_credential(self):
        self.encrypt_fixture("operator_token.enc", "ab" * 32)
        before = {path: path.read_bytes() for directory in [".keys", ".secrets"]
                  for path in (self.project / directory).iterdir()}
        self.legacy_curl_fixture()
        result = self.maintenance_mutation(FOREX_DEPLOY_LEGACY_ACCESS="1")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout), {"success": True})
        self.assertEqual([call["authorized"] for call in self.api_calls()], [False, True])
        self.assertEqual({path: path.read_bytes() for directory in [".keys", ".secrets"]
                          for path in (self.project / directory).iterdir()}, before)
        self.assertNotIn("ab" * 32, result.stdout + result.stderr + (self.project / "api-calls.jsonl").read_text())

    def test_legacy_access_never_replays_success_or_ambiguous_mutation_failures(self):
        self.legacy_curl_fixture()
        for code, status in [("200", 0), ("500", 22), ("403", 22), ("000", 28), ("401", 28)]:
            with self.subTest(code=code, status=status):
                (self.project / "api-calls.jsonl").unlink(missing_ok=True)
                result = self.maintenance_mutation(FOREX_DEPLOY_LEGACY_ACCESS="1", FIXTURE_FIRST_HTTP=code,
                                                   FIXTURE_FIRST_EXIT=str(status), FIXTURE_FIRST_BODY="original response")
                self.assertEqual(result.returncode, status, result.stdout + result.stderr)
                self.assertEqual(result.stdout, "original response")
                self.assertEqual([call["authorized"] for call in self.api_calls()], [False])
                self.assertFalse((self.project / ".keys").exists())
                self.assertFalse((self.project / ".secrets").exists())

    def test_legacy_401_without_saved_credential_refuses_provisioning(self):
        self.legacy_curl_fixture()
        result = self.maintenance_mutation(FOREX_DEPLOY_LEGACY_ACCESS="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual([call["authorized"] for call in self.api_calls()], [False])
        self.assertFalse((self.project / ".keys").exists())
        self.assertFalse((self.project / ".secrets").exists())
        self.assertNotIn("discarded unauthenticated response", result.stdout)

    def test_normal_maintenance_never_uses_retired_credential_on_401(self):
        self.encrypt_fixture("operator_token.enc", "ab" * 32)
        self.legacy_curl_fixture()
        result = self.maintenance_mutation()
        self.assertEqual(result.returncode, 22)
        self.assertEqual([call["authorized"] for call in self.api_calls()], [False])


if __name__ == "__main__":
    unittest.main()
