#!/usr/bin/env python3
"""Build and validate a restore candidate without touching the installation."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sqlite3
import sys
import tarfile


def verify_database(database):
    connection = sqlite3.connect(database.resolve().as_uri() + "?mode=ro&immutable=1", uri=True)
    try:
        result = connection.execute("PRAGMA quick_check").fetchall()
        if result != [("ok",)]:
            raise ValueError("Snapshot failed SQLite quick_check")
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        required = {"trades", "strategy_runs", "broker_order_intents", "broker_position_quarantines"}
        if not required <= tables:
            raise ValueError("Snapshot lacks the supported live lifecycle schema")
        checks = [
            "SELECT COUNT(*) FROM trades WHERE mode='live' AND is_open=1",
            "SELECT COUNT(*) FROM broker_order_intents WHERE status IN ('PREPARED','SUBMITTING','AMBIGUOUS','RECOVERY_PENDING','FILLED_UNPERSISTED')",
            "SELECT COUNT(*) FROM broker_position_quarantines WHERE status='OPEN'",
        ]
        if any(connection.execute(query).fetchone()[0] for query in checks):
            raise ValueError("Snapshot contains open or uncertain broker state; reconcile it before restoration")
    finally:
        connection.close()


def stage_restore(project, backup, staging):
    root_name = project.name
    target = staging / root_name
    if backup.name.startswith("forex_backup_") and backup.name.endswith(".tar.gz"):
        stamp = backup.name[len("forex_backup_"):-len(".tar.gz")]
        database = backup.with_name(f"trading_{stamp}.db")
        if not database.is_file():
            raise ValueError("Archive requires the SQLite snapshot with the exact matching timestamp")
        with tarfile.open(backup, "r:gz") as archive:
            members = archive.getmembers()
            for member in members:
                parts = PurePosixPath(member.name).parts
                if not parts or parts[0] != root_name or ".." in parts or member.name.startswith("/"):
                    raise ValueError("Archive contains an unsafe or unexpected path")
                if not (member.isdir() or member.isfile()):
                    raise ValueError("Archive links and special files are not supported")
                if any(part in {".keys", ".secrets", ".env"} for part in parts):
                    raise ValueError("Credentials must come from the preserved installation, not the archive")
            for member in members:
                destination = staging.joinpath(*PurePosixPath(member.name).parts)
                if member.isdir():
                    destination.mkdir(parents=True, exist_ok=True)
                else:
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    with archive.extractfile(member) as source, destination.open("wb") as output:
                        shutil.copyfileobj(source, output)
                    os.chmod(destination, member.mode & 0o777)
    elif backup.suffix == ".db":
        database = backup
        def ignored(_directory, names):
            return [name for name in names if name in {"node_modules", "dist", "logs", ".git", ".keys", ".secrets", ".env"} or name.startswith("trading.db")]
        shutil.copytree(project, target, ignore=ignored, symlinks=True)
    else:
        raise ValueError("Choose a forex_backup_TIMESTAMP.tar.gz archive or standalone .db snapshot")

    if not database.is_file() or Path(str(database) + "-wal").exists():
        raise ValueError("A complete standalone SQLite snapshot is required")
    verify_database(database)
    for required in ["backend/package.json", "backend/server.js", "ecosystem.config.js", "scripts/start-wrapper.sh", "scripts/load-operator-auth.sh"]:
        if not (target / required).is_file():
            raise ValueError(f"Restore candidate is missing {required}; use database-only restore for older source archives")
    data_dir = target / "backend/data"
    data_dir.mkdir(parents=True, exist_ok=True)
    for previous in data_dir.glob("trading.db*"):
        previous.unlink()
    shutil.copy2(database, data_dir / "trading.db")

    # Preserve all local secrets, TLS material and Git recovery context. The
    # original installation will also remain intact in the rollback directory.
    for relative in [".keys", ".secrets", ".env", "backend/.env", "ssl", ".git"]:
        original, destination = project / relative, target / relative
        if original.exists():
            if destination.is_dir():
                shutil.rmtree(destination)
            elif destination.exists():
                destination.unlink()
            destination.parent.mkdir(parents=True, exist_ok=True)
            if original.is_dir():
                shutil.copytree(original, destination, symlinks=True)
            else:
                shutil.copy2(original, destination)

    config_path = data_dir / "trading_config.json"
    config = json.loads(config_path.read_text())
    config["enableTrading"] = False
    config["enforceConfigFreeze"] = True
    temporary = config_path.with_suffix(".restore.tmp")
    with temporary.open("w") as output:
        os.chmod(temporary, 0o600)
        json.dump(config, output, indent=4)
        output.flush()
        os.fsync(output.fileno())
    temporary.replace(config_path)
    snapshot_digest = hashlib.sha256()
    with database.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            snapshot_digest.update(chunk)
    manifest = {
        "source": str(backup.resolve()), "snapshot": str(database.resolve()),
        "snapshotSha256": snapshot_digest.hexdigest(),
        "enableTrading": False,
    }
    (target / "RESTORE_MANIFEST.json").write_text(json.dumps(manifest, indent=2))
    return target


if __name__ == "__main__":
    try:
        if sys.argv[1] == "--verify-db":
            verify_database(Path(sys.argv[2]))
        else:
            print(stage_restore(*(Path(value) for value in sys.argv[1:4])))
    except Exception as error:
        print(f"Restore validation failed: {error}", file=sys.stderr)
        sys.exit(1)
