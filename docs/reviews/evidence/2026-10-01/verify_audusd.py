"""Verify the retained read-only trade-3487 evidence; Python stdlib only."""
import json
from datetime import datetime
from decimal import Decimal as D
from pathlib import Path

root = Path(__file__).resolve().parent
e = json.loads((root / "audusd-3487.json").read_text())
t, b = e["trade"], e["brokerTrade"]
transactions = {x["id"]: x for x in e["brokerTransactions"]}
opened, closed = transactions["3487"], transactions["3494"]


def ms(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000


assert b["id"] == t["oandaTradeId"] == "3487"
assert b["instrument"] == t["instrument"] == "AUD_USD"
assert t["side"] == "SELL" and b["initialUnits"] == opened["units"] == "-146"
assert closed["units"] == "146" and closed["reason"] == "STOP_LOSS_ORDER"
assert D(b["price"]) == D(str(t["entryPrice"])) == D("0.69559")
assert D(b["averageClosePrice"]) == D(str(t["exitPrice"])) == D("0.69642")
for field, broker_field in [("entryTime", "openTime"), ("exitTime", "closeTime")]:
    assert abs(t[field] - ms(b[broker_field])) < 1
stop = b["stopLossOrder"]
assert stop["state"] == "FILLED" and stop["fillingTransactionID"] == "3494"
assert D(stop["price"]) == D("0.69640")
assert D(transactions["3489"]["price"]) == D(transactions["3493"]["price"])
assert ms(stop["createTime"]) < t["exitTime"]
assert D(closed["price"]) == D(closed["fullPrice"]["asks"][0]["price"])
assert D(closed["price"]) - D(stop["price"]) == D("0.00002")
quote_pnl = (D(opened["price"]) - D(closed["price"])) * 146
assert quote_pnl == D(closed["quotePL"]) == D("-0.12118")
converted = quote_pnl * D(closed["lossQuoteHomeConversionFactor"])
assert abs(converted - D(closed["pl"])) < D("0.00005")
assert D(closed["pl"]) == D(b["realizedPL"]) == D(str(t["pnlAud"]))

# The first/last minute may include prices outside the exact lifetime. Their
# inclusion makes the breakeven non-touch check conservative. The minimum
# itself is in a wholly in-lifetime minute, so +4.3 pips is supported.
overlapping = [c for c in e["m1"]
               if ms(c["time"]) + 60000 > t["entryTime"]
               and ms(c["time"]) <= t["exitTime"]]
best = min(overlapping, key=lambda c: D(c["ask"]["l"]))
assert t["entryTime"] < ms(best["time"]) < ms(best["time"]) + 60000 < t["exitTime"]
assert D(best["ask"]["l"]) == D("0.69516")
assert (D(b["price"]) - D(best["ask"]["l"])) / D("0.0001") == D("4.3")
assert all(D(c["ask"]["l"]) > D("0.69478") for c in overlapping)
assert all(t["entryTime"] <= s[0] <= t["exitTime"]
           for s in t["sampledExcursion"]["samples"])
assert t["sampledExcursion"]["lifetimeStatus"] == "VERIFIED"
spike = next(c for c in e["m15"] if c["time"].startswith("2026-09-30T14:45:"))
assert spike["mid"]["h"] == "0.69644" and spike["mid"]["c"] == "0.69564"
later_target = next(c for c in e["m1"]
                    if ms(c["time"]) > t["exitTime"] and D(c["ask"]["l"]) <= D("0.69437"))
assert later_target["time"].startswith("2026-09-30T20:03:")
context = t["entryTelemetry"]["strategyContext"]
assert context["reentry"]["classification"] == "NORMAL"
assert context["reentry"]["originalSide"] == context["reentry"]["executedSide"] == "SELL"
assert context["m15"]["triggerCombination"] == "breakout_only"
assert context["lossReset"]["classification"] == "H1_RESET_REARMED"
assert context["lossReset"]["state"]["resetAt"] < context["lossReset"]["state"]["rearmedAt"] < t["entryTime"]
streak = []
for trade in e["recentLedgerRows"]:
    if trade["pnlAud"] >= 0:
        break
    streak.append(trade)
assert len(streak) == 10
assert sum(D(str(x["pnlAud"])) for x in streak) == D("-1.4332")
assert sum(x["exitReason"] == "STOP_LOSS" for x in streak) == 8
print("Verified broker direction, fill/stop/P&L, lifetime prices, hidden M15 spike, entry attribution and recent ledger totals.")
