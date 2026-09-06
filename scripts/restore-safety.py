#!/usr/bin/env python3
"""Read-only persisted pause/uncertainty guard, also usable by deployments."""
import json
from pathlib import Path
import sqlite3
import sys

project = Path(sys.argv[1])
config = json.loads((project / "backend/data/trading_config.json").read_text())
if config.get("enableTrading") is not False:
    raise SystemExit("Pause and durably save new entries before maintenance")
database = sqlite3.connect((project / "backend/data/trading.db").resolve().as_uri() + "?mode=ro", uri=True)
queries = [
    "SELECT COUNT(*) FROM broker_order_intents WHERE status IN ('PREPARED','SUBMITTING','AMBIGUOUS','RECOVERY_PENDING','FILLED_UNPERSISTED')",
    "SELECT COUNT(*) FROM broker_position_quarantines WHERE status='OPEN'",
]
try:
    if any(database.execute(query).fetchone()[0] for query in queries):
        raise SystemExit("Resolve durable broker uncertainty before maintenance")
finally:
    database.close()
