#!/usr/bin/env python3
"""Isolated restore/credential tests: npm, PM2, curl and locks are stubs."""
import io
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tarfile
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1]


class RestoreTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="forex-restore-test-")
        self.root = Path(self.temporary.name)
        self.project = self.root / "install/forex-trading-bot"
        self.backups = self.root / "backups"
        self.bin = self.root / "bin"
        self.log = self.root / "calls.log"
        for directory in [self.project / "backend/data", self.project / "scripts", self.project / ".keys", self.project / ".secrets", self.backups, self.bin]:
            directory.mkdir(parents=True)
        self.config = self.project / "backend/data/trading_config.json"
        self.config.write_text(json.dumps({"enableTrading": False, "enforceConfigFreeze": True}))
        for relative in ["backend/package.json", "backend/server.js", "ecosystem.config.js", "scripts/start-wrapper.sh", "scripts/load-operator-auth.sh"]:
            (self.project / relative).write_text("{}\n")
        health = self.project / "scripts/health-check.sh"
        health.write_text("#!/bin/bash\nexit 0\n")
        health.chmod(0o700)
        (self.project / ".keys/encryption.key").write_text("original-key")
        (self.project / ".secrets/operator_token.enc").write_text("original-operator-secret")
        (self.project / ".secrets/oanda_api_key.enc").write_text("original-broker-secret")
        self.database = self.project / "backend/data/trading.db"
        db = sqlite3.connect(self.database)
        db.executescript("CREATE TABLE trades(mode TEXT,is_open INT); CREATE TABLE strategy_runs(id INT); CREATE TABLE broker_order_intents(status TEXT); CREATE TABLE broker_position_quarantines(status TEXT);")
        db.close()
        self.snapshot = self.backups / "trading_20990101_000000.db"
        shutil.copy2(self.database, self.snapshot)
        self.archive = self.backups / "forex_backup_20990101_000000.tar.gz"
        self.make_archive()
        self.stub("flock", "exit 0")
        self.stub("sleep", "exit 0")
        self.stub("npm", 'echo "npm $*" >> "$CALL_LOG"; [ "${FAIL_NPM:-0}" != 1 ]')
        self.stub("pm2", '''echo "pm2 $*" >> "$CALL_LOG"
case "$1" in pid) echo "${PM2_PID:-1234}";; start) [ "${FAIL_START:-0}" != 1 ] || exit 1;; esac''')
        self.stub("curl", '''echo "curl $*" >> "$CALL_LOG"
header=$(cat)
case "$header" in *'Authorization: Bearer '*) ;; *) exit 99;; esac
case "$*" in
 *'/summary'*) printf '{"account":{"openTradeCount":"%s","pendingOrderCount":"%s"}}' "${OPEN_TRADES:-0}" "${PENDING_ORDERS:-0}";;
 *'/health'*) [ "${API_DOWN:-0}" != 1 ] || exit 22; printf '{"config":{"enableTrading":%s}}' "${API_ENABLED:-false}";;
 *) exit 98;;
esac''')
        self.env = {**os.environ, "PATH": f"{self.bin}:{os.environ['PATH']}",
                    "FOREX_NODE_RUNTIME_LOADED": "1", "FOREX_PROJECT_DIR": str(self.project),
                    "FOREX_BACKUP_DIR": str(self.backups), "CALL_LOG": str(self.log),
                    "FOREX_OPERATOR_TOKEN": "a3" * 32, "OANDA_API_KEY": "test-broker-token",
                    "OANDA_ACCOUNT_ID": "001-002-003", "OANDA_ENVIRONMENT": "practice"}

    def tearDown(self):
        self.temporary.cleanup()

    def stub(self, name, body):
        target = self.bin / name
        target.write_text("#!/bin/bash\nset -e\n" + body + "\n")
        target.chmod(0o700)

    def make_archive(self):
        with tarfile.open(self.archive, "w:gz") as archive:
            archive.add(self.project, arcname=self.project.name,
                        filter=lambda item: None if any(x in {".keys", ".secrets"} for x in Path(item.name).parts) or "trading.db" in item.name else item)

    def restore(self, backup=None, verify=False, **env):
        return subprocess.run(["bash", str(SCRIPTS / "restore.sh"), str(backup or self.archive),
                               *(["--verify-only"] if verify else ["--confirm", "RESTORE"])],
                              env={**self.env, **env}, text=True, capture_output=True, timeout=30)

    def assert_not_stopped(self):
        self.assertNotIn("pm2 stop", self.log.read_text() if self.log.exists() else "")
        self.assertTrue((self.project / ".keys/encryption.key").exists())

    def test_success_preserves_credentials_original_install_and_paused_state(self):
        result = self.restore()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        rollback, = self.project.parent.glob("forex-trading-bot.rollback.*")
        for location in [self.project, rollback]:
            self.assertEqual((location / ".secrets/operator_token.enc").read_text(), "original-operator-secret")
            self.assertEqual((location / ".keys/encryption.key").read_text(), "original-key")
        self.assertIs(json.loads(self.config.read_text())["enableTrading"], False)
        self.assertNotIn("/trading/start", self.log.read_text())
        self.assertNotIn(self.env["FOREX_OPERATOR_TOKEN"], result.stdout + result.stderr + self.log.read_text())
        self.assertNotIn("test-broker-token", self.log.read_text())

    def test_database_only_restore_uses_current_source(self):
        result = self.restore(self.snapshot)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue((self.project / "RESTORE_MANIFEST.json").exists())

    def test_verify_only_never_contacts_broker_or_stops_service(self):
        result = self.restore(verify=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse(self.log.exists())

    def test_missing_matched_snapshot_refuses_newest_fallback(self):
        self.snapshot.rename(self.backups / "trading_unrelated.db")
        self.assertNotEqual(self.restore().returncode, 0)
        self.assert_not_stopped()

    def test_corrupt_snapshot_rejected_before_stop(self):
        self.snapshot.write_text("not SQLite")
        self.assertNotEqual(self.restore().returncode, 0)
        self.assert_not_stopped()

    def test_archive_traversal_and_links_rejected_before_stop(self):
        for name, link in [("../escape", False), ("forex-trading-bot/link", True)]:
            with tarfile.open(self.archive, "w:gz") as archive:
                entry = tarfile.TarInfo(name)
                if link:
                    entry.type, entry.linkname = tarfile.SYMTYPE, "/etc"
                    archive.addfile(entry)
                else:
                    entry.size = 1
                    archive.addfile(entry, io.BytesIO(b"x"))
            self.assertNotEqual(self.restore().returncode, 0)
            self.assert_not_stopped()

    def test_snapshot_with_open_trade_rejected_before_stop(self):
        db = sqlite3.connect(self.snapshot)
        db.execute("INSERT INTO trades VALUES('live',1)")
        db.commit(); db.close()
        self.assertNotEqual(self.restore().returncode, 0)
        self.assert_not_stopped()

    def test_live_enable_or_current_ambiguity_rejected(self):
        self.config.write_text('{"enableTrading":true}')
        self.assertNotEqual(self.restore().returncode, 0)
        self.assert_not_stopped()
        self.config.write_text('{"enableTrading":false}')
        db = sqlite3.connect(self.database)
        db.execute("INSERT INTO broker_order_intents VALUES('AMBIGUOUS')")
        db.commit(); db.close()
        self.assertNotEqual(self.restore().returncode, 0)
        self.assert_not_stopped()

    def test_broker_pending_or_open_blocks_restore(self):
        for values in [{"PENDING_ORDERS": "1"}, {"OPEN_TRADES": "1"}]:
            self.assertNotEqual(self.restore(**values).returncode, 0)
            self.assert_not_stopped()

    def test_preparation_failure_does_not_stop_current_runtime(self):
        self.assertNotEqual(self.restore(FAIL_NPM="1").returncode, 0)
        self.assert_not_stopped()

    def test_cutover_failure_preserves_original_and_never_enables(self):
        result = self.restore(FAIL_START="1")
        self.assertNotEqual(result.returncode, 0)
        rollback, = self.project.parent.glob("forex-trading-bot.rollback.*")
        self.assertEqual((rollback / ".secrets/oanda_api_key.enc").read_text(), "original-broker-secret")
        calls = self.log.read_text()
        self.assertEqual(calls.count("pm2 start"), 1)
        self.assertNotIn("/trading/start", calls)
        self.assertIn("Runtime remains stopped", result.stderr)

    def test_stopped_api_recovery_still_requires_direct_broker_flatness(self):
        result = self.restore(API_DOWN="1", PM2_PID="0", PENDING_ORDERS="1")
        self.assertNotEqual(result.returncode, 0)
        self.assert_not_stopped()

    def test_operator_setup_does_not_print_token_or_replace_existing_without_rotation(self):
        (self.project / ".secrets/operator_token.enc").unlink()
        command = ["bash", str(SCRIPTS / "setup-operator-access.sh")]
        result = subprocess.run(command, env=self.env, text=True, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        token = (self.project / ".keys/operator-access-token.txt").read_text().strip()
        self.assertEqual(len(token), 64)
        self.assertNotIn(token, result.stdout + result.stderr)
        again = subprocess.run(command, env=self.env, text=True, capture_output=True, timeout=10)
        self.assertNotEqual(again.returncode, 0)

    def test_operator_setup_cannot_replace_a_lost_key_for_existing_credentials(self):
        key = self.project / ".keys/encryption.key"
        key.unlink()
        result = subprocess.run(["bash", str(SCRIPTS / "setup-operator-access.sh"), "--rotate"],
                                env=self.env, text=True, capture_output=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(key.exists())
        self.assertEqual((self.project / ".secrets/oanda_api_key.enc").read_text(), "original-broker-secret")

    def test_cutover_guard_rechecks_broker_and_api_after_preparation(self):
        command = ["bash", "-c", 'source "$1"; forex_require_paused_flat_running',
                   "guard-test", str(SCRIPTS / "load-operator-auth.sh")]
        def check(**environment):
            return subprocess.run(command, env={**self.env, **environment}, text=True,
                                  capture_output=True, timeout=10)
        self.assertEqual(check().returncode, 0)
        for environment in [{"OPEN_TRADES": "1"}, {"PENDING_ORDERS": "1"},
                            {"API_DOWN": "1"}, {"API_ENABLED": "true"}]:
            self.assertNotEqual(check(**environment).returncode, 0)
        self.config.write_text('{"enableTrading":true}')
        self.assertNotEqual(check().returncode, 0)
        self.assert_not_stopped()


if __name__ == "__main__":
    unittest.main(verbosity=2)
