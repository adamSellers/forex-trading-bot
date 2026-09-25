#!/usr/bin/env python3
"""Prespecified opposite-direction level sensitivity on four observed TP repeats.

Offline research only. Uses retained production telemetry and broker candles;
does not import the live runtime, make requests, or place orders. The opposite
entry is a quote proxy, not an observed fill. This is not a portfolio backtest.
"""
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import json
from pathlib import Path
from zoneinfo import ZoneInfo


HERE = Path(__file__).resolve().parent
EVIDENCE = HERE.parent.parent
INPUTS = {
    "production": EVIDENCE / "2026-09-26/production-evidence.json",
    "old_market": EVIDENCE / "2026-09-21/evaluation/market-data.json",
    "new_market": EVIDENCE / "2026-09-26/broker-evidence.json",
}
EPISODES = [("3073", "3085"), ("3121", "3133"),
            ("3195", "3207"), ("3381", "3393")]


def ms(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000


def iso(value):
    return datetime.fromtimestamp(value / 1000, timezone.utc).isoformat()


def price(value, precision):
    return float(Decimal(str(value)).quantize(
        Decimal(1).scaleb(-precision), rounding=ROUND_HALF_UP))


def runtime(trade):
    payload = trade["broker_reconciliation_payload"]
    if isinstance(payload, str):
        payload = json.loads(payload)
    return payload["liveRuntime"]


def deadline(trade):
    config = runtime(trade)["exitConfig"]
    entry = datetime.fromtimestamp(trade["entry_time"] / 1000,
                                   ZoneInfo(config["sessionCloseTimeZone"]))
    session = entry.replace(hour=config["sessionCloseLocalHour"],
                            minute=config["sessionCloseLocalMinute"],
                            second=0, microsecond=0).timestamp() * 1000
    assert session >= trade["entry_time"], "No selected entry is after session close"
    return min(trade["entry_time"] + config["timeStopHours"] * 3_600_000, session)


def freshness(anchor, trade, market):
    context = runtime(trade)["entryTelemetry"]["strategyContext"]
    signal_start = context["signalCandleCloseTime"] - 900_000
    data = market["M15"][trade["instrument"]]
    data = data.get("data", data)
    bars = [row for row in data["candles"]
            if signal_start - 4 * 900_000 <= ms(row["time"]) < signal_start]
    assert len(bars) == 4 and all(row["complete"] for row in bars)
    ema = context["m15"]["fastEma"]
    evidence = [{
        "start_utc": row["time"],
        "wholly_post_exit": ms(row["time"]) >= anchor["exit_time"],
        "touches_signal_ema20": (
            float(row["mid"]["l"]) <= ema if trade["side"] == "BUY"
            else float(row["mid"]["h"]) >= ema),
    } for row in bars]
    fresh = any(row["wholly_post_exit"] and row["touches_signal_ema20"]
                for row in evidence)
    assert not fresh, "The selected episode must lack a fresh touch"
    return {"signal_ema20": ema, "fresh_touch": fresh, "prior_four_bars": evidence}


def evaluate(trade, market):
    rt = runtime(trade)
    telemetry = rt["entryTelemetry"]
    pip = 10 ** rt["instrumentMetadata"]["pipLocation"]
    precision = rt["instrumentMetadata"]["displayPrecision"]
    original_direction = 1 if trade["side"] == "BUY" else -1
    direction = -original_direction
    side = "BUY" if direction == 1 else "SELL"
    # executablePrice is the final original-side quote; reverse to the other
    # quote using that same snapshot's recorded spread, NOT the original fill.
    spread = telemetry["finalSpreadPips"] * pip
    entry = price(telemetry["executablePrice"] + direction * spread, precision)
    distance = rt["initialStopDistance"]
    levels = {
        "initial_stop": price(entry - direction * distance, precision),
        "target": price(entry + direction * 1.5 * distance, precision),
        "breakeven_stop": entry,
        # The trigger is an arithmetic distance, not a submitted order price.
        "breakeven_trigger": entry + direction * distance,
    }
    quote_side = "bid" if direction == 1 else "ask"
    cutoff = deadline(trade)
    rows = []
    for candle in market["M1"][str(trade["oanda_trade_id"])]["data"]["candles"]:
        start, end = ms(candle["time"]), ms(candle["time"]) + 60_000
        if end <= trade["entry_time"] or start >= cutoff:
            continue
        assert candle["complete"]
        quote = {key: float(value) for key, value in candle[quote_side].items()}
        assert quote["l"] <= min(quote["o"], quote["c"]) <= max(quote["o"], quote["c"]) <= quote["h"]
        favourable = quote["h"] if direction == 1 else quote["l"]
        adverse = quote["l"] if direction == 1 else quote["h"]
        rows.append({
            "start_utc": iso(start), "end_utc": iso(end), "start_ms": start,
            "quote_ohlc": quote,
            "straddles_entry": start < trade["entry_time"],
            "straddles_deadline": end > cutoff,
            "initial_stop_touch": direction * (adverse - levels["initial_stop"]) <= 0,
            "target_touch": direction * (favourable - levels["target"]) >= 0,
            "breakeven_trigger_touch": direction * (favourable - levels["breakeven_trigger"]) >= 0,
            "breakeven_stop_touch": direction * (adverse - entry) <= 0,
        })
    # Do not attribute partial entry-bar extrema to an already-open position.
    # Here no initial protection or BE trigger is touched in that bar anyway.
    assert rows and rows[0]["straddles_entry"]
    assert not any(rows[0][key] for key in (
        "initial_stop_touch", "target_touch", "breakeven_trigger_touch"))
    assert all(b["start_ms"] - a["start_ms"] == 60_000 for a, b in zip(rows, rows[1:])), "Missing quote candles"
    first_trigger = None
    first_be_retouch = None
    event = None
    for row in rows[1:]:
        if first_trigger is None and row["breakeven_trigger_touch"]:
            first_trigger = row
        if first_trigger is not None and row["breakeven_stop_touch"]:
            first_be_retouch = first_be_retouch or row
        if row["target_touch"] or row["initial_stop_touch"]:
            assert not row["straddles_deadline"]
            assert not (row["target_touch"] and row["initial_stop_touch"]), "Intrabar order unresolved"
            event = row
            break
    assert event, "Selected path must resolve before incomplete deadline coverage"
    # In these four paths immediate BE activation or missing all BE polls leads
    # to the same terminal level. Do not assume continuous successful polling.
    assert first_be_retouch is None, "BE timing would affect this path"
    kind = "TARGET" if event["target_touch"] else "INITIAL_STOP"
    exit_price = levels["target"] if kind == "TARGET" else levels["initial_stop"]
    return {
        "side": side, "quote_side_for_exit": quote_side,
        "entry_quote_proxy": entry,
        "original_final_executable_quote": telemetry["executablePrice"],
        "final_spread_pips": telemetry["finalSpreadPips"],
        "quote_event_utc": iso(telemetry["quoteTime"]),
        "entry_time_proxy_utc": iso(trade["entry_time"]),
        "initial_stop_distance": distance,
        "display_precision": precision, "levels": levels,
        "deadline_utc": iso(cutoff),
        "first_breakeven_trigger_interval": first_trigger,
        "first_breakeven_retouch_before_terminal": first_be_retouch,
        "conditional_terminal_level": kind,
        "conditional_exit_level": exit_price,
        "conditional_price_distance_r": direction * (exit_price - entry) / distance,
        "terminal_interval": event,
        "be_poll_timing_changes_observed_level_result": False,
        "path_through_terminal": [row for row in rows if row["start_ms"] <= event["start_ms"]],
    }


def main():
    inputs = {name: json.loads(path.read_text()) for name, path in INPUTS.items()}
    trades = inputs["production"]["trades"]
    lookup = {str(trade["oanda_trade_id"]): trade for trade in trades}
    results = []
    for anchor_id, candidate_id in EPISODES:
        anchor, trade = lookup[anchor_id], lookup[candidate_id]
        latest = max((other for other in trades if other["instrument"] == trade["instrument"]
                      and other["exit_time"] < trade["entry_time"]),
                     key=lambda other: other["exit_time"])
        assert str(latest["oanda_trade_id"]) == anchor_id
        assert anchor["exit_reason"] == "TAKE_PROFIT" and anchor["side"] == trade["side"]
        signal_close = runtime(trade)["entryTelemetry"]["strategyContext"]["signalCandleCloseTime"]
        assert signal_close > anchor["exit_time"], "A candle completed before/at the TP cannot be reused as a fade signal"
        market = inputs["new_market"] if candidate_id == "3393" else inputs["old_market"]
        results.append({
            "normal_tp_anchor_id": anchor_id, "observed_reentry_id": candidate_id,
            "instrument": trade["instrument"], "original_side": trade["side"],
            "release": runtime(trade)["exitConfig"]["liveReleaseVersion"],
            "anchor_exit_utc": iso(anchor["exit_time"]),
            "signal_candle_close_utc": iso(signal_close),
            "signal_completion_after_tp_seconds": (signal_close - anchor["exit_time"]) / 1000,
            "qualifies_post_exit_signal_completion": True,
            "gap_seconds": (trade["entry_time"] - anchor["exit_time"]) / 1000,
            "actual_original_exit_reason": trade["exit_reason"],
            "actual_original_pnl_aud": trade["pnl_aud"],
            "freshness": freshness(anchor, trade, market),
            "fade": evaluate(trade, market),
        })
    output = {
        "method": "Conditional opposite-quote entry and executable-side M1 level sensitivity; not observed fade fills or a portfolio backtest.",
        "prespecified_policy": {"stop_distance": "Original signal initial stop distance",
                               "target_r": 1.5, "breakeven_trigger_r": 1,
                               "time_stop_hours": 6, "session_close": "16:45 America/New_York"},
        "limitations": [
            "Four selected observed filled repeats spanning releases, all original SELL; no complete opportunity replay or observed BUY-to-SELL fade example.",
            "Final opposite quote reconstructed from original executable quote plus/minus the same snapshot spread; hypothetical entry at that quote and observed entry time, without claiming a possible fill was obtained.",
            "Initial stop/target levels rounded to broker precision and assumed filled at the level; alternative slippage, market gaps beyond candle extrema, conversion, fees and sizing not modeled.",
            "Spread enters through buying ask/selling bid and exiting on the opposite quote side; do not subtract another spread charge.",
            "M1 extrema have no event timestamps. Entry-boundary and simultaneous-level ambiguity checked. None affects these four conditional level results.",
            "BE is polled, not continuously broker-triggered. For these paths neither immediate BE nor no BE activation changes the first terminal level, because no entry-price retouch occurs between first +1R and target.",
            "Retained M1 windows may end before exact six-hour deadlines; all four selected results resolve well before that missing tail.",
            "No alternative portfolio returns: occupancy, eligible replacement signals, changed trade anchors/cooldowns and dynamic account state are not replayed.",
            "No threshold or target search was performed. Positive sum of four conditional R outcomes is not evidence of a stable profitable edge.",
        ],
        "sources": [{"path": str(path.relative_to(EVIDENCE)),
                     "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
                    for path in INPUTS.values()],
        "episodes": results,
        "conditional_total_price_r": sum(row["fade"]["conditional_price_distance_r"] for row in results),
    }
    destination = HERE / "fade-results.json"
    destination.write_text(json.dumps(output, indent=2) + "\n")
    print(json.dumps({"output": str(destination), "episodes": [
        {"id": row["observed_reentry_id"], "result": row["fade"]["conditional_terminal_level"],
         "price_r": row["fade"]["conditional_price_distance_r"],
         "interval_start_utc": row["fade"]["terminal_interval"]["start_utc"]}
        for row in results], "conditional_total_price_r": output["conditional_total_price_r"]}, indent=2))


if __name__ == "__main__":
    main()
