#!/usr/bin/env bash
set -euo pipefail

DEFAULT_HOST="${FOREX_BOT_HOST:-adam@img.oakroad}"
DEFAULT_DB_PATH="${FOREX_BOT_DB_PATH:-/opt/forex-trading-bot/backend/data/trading.db}"

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "Missing required command: $1" >&2
        exit 1
    fi
}

usage() {
    cat <<EOF
Usage: $(basename "$0") [days]

Exports live trade and signal CSVs from the production bot.

Environment overrides:
  FOREX_BOT_HOST     SSH host or host alias (default: $DEFAULT_HOST)
  FOREX_BOT_DB_PATH  Remote SQLite path (default: $DEFAULT_DB_PATH)
EOF
}

prompt_days() {
    local response="${1:-}"

    if [[ -n "$response" ]]; then
        printf '%s\n' "$response"
        return 0
    fi

    read -r -p "How many days of history do you want to export? [7]: " response
    response="${response:-7}"
    printf '%s\n' "$response"
}

main() {
    local days="${1:-}"
    local host="$DEFAULT_HOST"
    local db_path="$DEFAULT_DB_PATH"
    local output_dir
    local stamp
    local prefix
    local remote_tmp=""
    local tarball_name

    if [[ "${days:-}" == "-h" || "${days:-}" == "--help" ]]; then
        usage
        exit 0
    fi

    require_command ssh
    require_command scp
    require_command tar

    days="$(prompt_days "$days")"

    if ! [[ "$days" =~ ^[1-9][0-9]*$ ]]; then
        echo "Days must be a positive whole number." >&2
        exit 1
    fi

    output_dir="$(pwd)"
    if [[ ! -w "$output_dir" ]]; then
        echo "Output directory is not writable: $output_dir" >&2
        exit 1
    fi

    stamp="$(date -u +%Y%m%d_%H%M%S)"
    prefix="forex_history_${days}d_${stamp}"
    tarball_name="${prefix}.tar.gz"

    cleanup_remote() {
        if [[ -n "$remote_tmp" ]]; then
            ssh "$host" "rm -rf '$remote_tmp'" >/dev/null 2>&1 || true
        fi
    }

    trap cleanup_remote EXIT

    echo "Connecting to $host"
    remote_tmp="$(ssh "$host" "mktemp -d /tmp/forex-history-export.XXXXXX")"

    echo "Building CSV exports on the bot"
    ssh "$host" bash -s -- "$days" "$db_path" "$remote_tmp" "$prefix" <<'REMOTE'
set -euo pipefail

days="$1"
db_path="$2"
remote_tmp="$3"
prefix="$4"

if ! command -v sqlite3 >/dev/null 2>&1; then
    echo "sqlite3 is required on the remote host." >&2
    exit 1
fi

if ! command -v tar >/dev/null 2>&1; then
    echo "tar is required on the remote host." >&2
    exit 1
fi

if [[ ! -f "$db_path" ]]; then
    echo "Database not found on remote host: $db_path" >&2
    exit 1
fi

snapshot="$remote_tmp/trading_snapshot.db"
sqlite3 "$db_path" ".backup '$snapshot'"

signal_columns="$(sqlite3 "$snapshot" "PRAGMA table_info(signals);" | cut -d'|' -f2)"
trade_columns="$(sqlite3 "$snapshot" "PRAGMA table_info(trades);" | cut -d'|' -f2)"

has_column() {
    local columns="$1"
    local column_name="$2"
    grep -qx "$column_name" <<<"$columns"
}

signal_actionable_class_filter="signal IN ('BUY', 'SELL')"

if has_column "$signal_columns" "reason_code"; then
    signal_reason_code_expr="COALESCE(reason_code, '') AS reason_code"
else
    signal_reason_code_expr="'' AS reason_code"
fi

if has_column "$signal_columns" "signal_class"; then
    signal_class_expr="COALESCE(signal_class, '') AS signal_class"
    signal_actionable_class_filter="(COALESCE(signal_class, '') IN ('ACTIONABLE', 'EXIT_ONLY') OR signal IN ('BUY', 'SELL'))"
else
    signal_class_expr="'' AS signal_class"
fi

if has_column "$signal_columns" "intent"; then
    signal_intent_expr="COALESCE(intent, '') AS intent"
    signal_cohort_type_expr="COALESCE(NULLIF(entry_type, ''), NULLIF(intent, ''), NULLIF(signal_class, ''), signal, 'UNKNOWN')"
    signal_side_expr="CASE
        WHEN COALESCE(intent, '') LIKE 'ENTER_LONG%' THEN 'BUY'
        WHEN COALESCE(intent, '') LIKE 'ENTER_SHORT%' THEN 'SELL'
        WHEN COALESCE(intent, '') LIKE 'EXIT_LONG%' THEN 'SELL'
        WHEN COALESCE(intent, '') LIKE 'EXIT_SHORT%' THEN 'BUY'
        WHEN signal IN ('BUY', 'SELL') THEN signal
        ELSE 'UNKNOWN'
    END"
    signal_actionable_class_filter="(${signal_actionable_class_filter} OR COALESCE(intent, '') LIKE 'ENTER_%' OR COALESCE(intent, '') LIKE 'EXIT_%')"
else
    signal_intent_expr="'' AS intent"
    signal_cohort_type_expr="COALESCE(NULLIF(entry_type, ''), signal, 'UNKNOWN')"
    signal_side_expr="CASE WHEN signal IN ('BUY', 'SELL') THEN signal ELSE 'UNKNOWN' END"
fi

if has_column "$signal_columns" "setup_id"; then
    signal_setup_id_expr="COALESCE(setup_id, '') AS setup_id"
else
    signal_setup_id_expr="'' AS setup_id"
fi

if has_column "$signal_columns" "signal_candle_time"; then
    signal_candle_time_expr="signal_candle_time"
else
    signal_candle_time_expr="NULL AS signal_candle_time"
fi

if has_column "$signal_columns" "unique_event"; then
    signal_unique_event_expr="unique_event"
    signal_unique_event_filter="COALESCE(unique_event, CASE WHEN signal = 'COOLDOWN' THEN 0 WHEN signal = 'HOLD' THEN 0 ELSE 1 END) = 1"
else
    signal_unique_event_expr="NULL AS unique_event"
    signal_unique_event_filter="signal <> 'COOLDOWN'"
fi

if has_column "$signal_columns" "cooldown_suppressed"; then
    signal_cooldown_suppressed_expr="cooldown_suppressed"
    signal_cooldown_filter="COALESCE(cooldown_suppressed, CASE WHEN signal = 'COOLDOWN' THEN 1 ELSE 0 END) = 0"
    signal_cooldown_duplicate_filter="COALESCE(cooldown_suppressed, 0) = 1 OR COALESCE(signal_class, '') IN ('COOLDOWN', 'SUPPRESSED') OR signal = 'COOLDOWN'"
else
    signal_cooldown_suppressed_expr="NULL AS cooldown_suppressed"
    signal_cooldown_filter="signal <> 'COOLDOWN'"
    signal_cooldown_duplicate_filter="signal = 'COOLDOWN'"
fi

if has_column "$signal_columns" "config_hash"; then
    signal_config_hash_expr="COALESCE(config_hash, '') AS config_hash"
    signal_config_hash_group_expr="COALESCE(NULLIF(config_hash, ''), 'unknown')"
else
    signal_config_hash_expr="'' AS config_hash"
    signal_config_hash_group_expr="'unknown'"
fi

if has_column "$signal_columns" "decision_context"; then
    signal_decision_context_expr="COALESCE(decision_context, '') AS decision_context"
else
    signal_decision_context_expr="'' AS decision_context"
fi

if has_column "$trade_columns" "config_hash"; then
    trade_config_hash_expr="COALESCE(config_hash, '') AS config_hash"
    trade_config_hash_group_expr="COALESCE(NULLIF(config_hash, ''), 'unknown')"
else
    trade_config_hash_expr="'' AS config_hash"
    trade_config_hash_group_expr="'unknown'"
fi

sqlite3 -header -csv "$snapshot" <<SQL > "$remote_tmp/${prefix}_trades.csv"
SELECT trade_id, oanda_trade_id, instrument, side, signal,
       COALESCE(entry_type,'UNKNOWN') AS entry_type, signal_strength, atr_pips, spread_pips,
       units, entry_price, exit_price, stop_loss_price, take_profit_price, trailing_stop_price,
       margin_used_aud, pnl_aud, pnl_pips, pnl_percent, swap_aud, commission_aud,
       holding_period_ms, entry_time, datetime(entry_time/1000,'unixepoch') AS entry_utc,
       exit_time, datetime(exit_time/1000,'unixepoch') AS exit_utc, exit_reason,
       ${trade_config_hash_expr}
FROM trades
WHERE mode='live' AND is_open=0
  AND exit_time >= (strftime('%s','now','-${days} days') * 1000)
ORDER BY exit_time ASC;
SQL

sqlite3 -header -csv "$snapshot" <<SQL > "$remote_tmp/${prefix}_trade_entries.csv"
SELECT trade_id, oanda_trade_id, instrument, side, signal,
       COALESCE(entry_type,'UNKNOWN') AS entry_type, signal_strength, atr_pips, spread_pips,
       units, entry_price, stop_loss_price, take_profit_price, trailing_stop_price,
       margin_used_aud, entry_time, datetime(entry_time/1000,'unixepoch') AS entry_utc,
       is_open, exit_time, datetime(exit_time/1000,'unixepoch') AS exit_utc, exit_reason,
       pnl_aud, pnl_pips, pnl_percent, ${trade_config_hash_expr}
FROM trades
WHERE mode='live'
  AND entry_time >= (strftime('%s','now','-${days} days') * 1000)
ORDER BY entry_time ASC;
SQL

sqlite3 -header -csv "$snapshot" <<SQL > "$remote_tmp/${prefix}_trade_summary.csv"
SELECT instrument, side, COALESCE(entry_type,'UNKNOWN') AS entry_type,
       COUNT(*) AS trades,
       ROUND(100.0 * SUM(CASE WHEN pnl_aud > 0 THEN 1 ELSE 0 END) / COUNT(*), 1) AS win_rate_pct,
       ROUND(SUM(COALESCE(pnl_aud,0)), 2) AS total_pnl_aud,
       ROUND(AVG(COALESCE(pnl_aud,0)), 2) AS avg_pnl_aud,
       ROUND(AVG(COALESCE(pnl_pips,0)), 1) AS avg_pnl_pips,
       ROUND(AVG(CASE WHEN pnl_aud > 0 THEN pnl_aud END), 2) AS avg_win_aud,
       ROUND(ABS(AVG(CASE WHEN pnl_aud < 0 THEN pnl_aud END)), 2) AS avg_loss_aud,
       ROUND(
           ABS(SUM(CASE WHEN pnl_aud > 0 THEN pnl_aud ELSE 0 END)) /
           NULLIF(ABS(SUM(CASE WHEN pnl_aud < 0 THEN pnl_aud ELSE 0 END)), 0),
           2
       ) AS profit_factor
FROM trades
WHERE mode='live' AND is_open=0
  AND exit_time >= (strftime('%s','now','-${days} days') * 1000)
GROUP BY instrument, side, COALESCE(entry_type,'UNKNOWN')
ORDER BY total_pnl_aud DESC;
SQL

sqlite3 -header -csv "$snapshot" <<SQL > "$remote_tmp/${prefix}_signals.csv"
SELECT instrument, signal, COALESCE(entry_type,'UNKNOWN') AS entry_type,
       strength, adx, rsi, atr_pips, price, supertrend_direction, timeframe,
       REPLACE(REPLACE(COALESCE(message,''), char(10), ' '), char(13), ' ') AS message,
       ${signal_reason_code_expr},
       ${signal_class_expr},
       ${signal_intent_expr},
       ${signal_setup_id_expr},
       ${signal_candle_time_expr},
       ${signal_unique_event_expr},
       ${signal_cooldown_suppressed_expr},
       ${signal_config_hash_expr},
       ${signal_decision_context_expr},
       timestamp, datetime(timestamp/1000,'unixepoch') AS signal_utc
FROM signals
WHERE timestamp >= (strftime('%s','now','-${days} days') * 1000)
ORDER BY timestamp ASC;
SQL

sqlite3 -header -csv "$snapshot" <<SQL > "$remote_tmp/${prefix}_signals_actionable.csv"
SELECT instrument, signal, COALESCE(entry_type,'UNKNOWN') AS entry_type,
       strength, adx, rsi, atr_pips, price, supertrend_direction, timeframe,
       REPLACE(REPLACE(COALESCE(message,''), char(10), ' '), char(13), ' ') AS message,
       ${signal_reason_code_expr},
       ${signal_class_expr},
       ${signal_intent_expr},
       ${signal_setup_id_expr},
       ${signal_candle_time_expr},
       ${signal_unique_event_expr},
       ${signal_cooldown_suppressed_expr},
       ${signal_config_hash_expr},
       timestamp, datetime(timestamp/1000,'unixepoch') AS signal_utc
FROM signals
WHERE timestamp >= (strftime('%s','now','-${days} days') * 1000)
  AND ${signal_actionable_class_filter}
  AND ${signal_unique_event_filter}
  AND ${signal_cooldown_filter}
ORDER BY timestamp ASC;
SQL

sqlite3 -header -csv "$snapshot" <<SQL > "$remote_tmp/${prefix}_signals_cooldown_duplicates.csv"
SELECT instrument, signal, COALESCE(entry_type,'UNKNOWN') AS entry_type,
       strength, adx, rsi, atr_pips, price, supertrend_direction, timeframe,
       REPLACE(REPLACE(COALESCE(message,''), char(10), ' '), char(13), ' ') AS message,
       ${signal_reason_code_expr},
       ${signal_class_expr},
       ${signal_intent_expr},
       ${signal_setup_id_expr},
       ${signal_candle_time_expr},
       ${signal_unique_event_expr},
       ${signal_cooldown_suppressed_expr},
       ${signal_config_hash_expr},
       timestamp, datetime(timestamp/1000,'unixepoch') AS signal_utc
FROM signals
WHERE timestamp >= (strftime('%s','now','-${days} days') * 1000)
  AND (${signal_cooldown_duplicate_filter})
ORDER BY timestamp ASC;
SQL

sqlite3 -header -csv "$snapshot" <<SQL > "$remote_tmp/${prefix}_expectation_vs_actual.csv"
WITH signal_events AS (
    SELECT
        ${signal_config_hash_group_expr} AS config_hash,
        instrument,
        ${signal_side_expr} AS side,
        ${signal_cohort_type_expr} AS cohort_type,
        COUNT(*) AS expected_signals,
        ROUND(AVG(COALESCE(strength, 0)), 2) AS avg_signal_strength
    FROM signals
    WHERE timestamp >= (strftime('%s','now','-${days} days') * 1000)
      AND ${signal_actionable_class_filter}
      AND ${signal_unique_event_filter}
      AND ${signal_cooldown_filter}
    GROUP BY 1, 2, 3, 4
),
closed_trades AS (
    SELECT
        ${trade_config_hash_group_expr} AS config_hash,
        instrument,
        COALESCE(side, 'UNKNOWN') AS side,
        COALESCE(NULLIF(entry_type, ''), NULLIF(signal, ''), 'UNKNOWN') AS cohort_type,
        COUNT(*) AS actual_trades,
        ROUND(100.0 * SUM(CASE WHEN COALESCE(pnl_aud, 0) > 0 THEN 1 ELSE 0 END) / COUNT(*), 1) AS actual_win_rate_pct,
        ROUND(SUM(COALESCE(pnl_aud, 0)), 2) AS actual_pnl_aud,
        ROUND(SUM(COALESCE(pnl_pips, 0)), 1) AS actual_pnl_pips
    FROM trades
    WHERE mode = 'live'
      AND is_open = 0
      AND exit_time >= (strftime('%s','now','-${days} days') * 1000)
    GROUP BY 1, 2, 3, 4
),
cohort_keys AS (
    SELECT config_hash, instrument, side, cohort_type FROM signal_events
    UNION
    SELECT config_hash, instrument, side, cohort_type FROM closed_trades
)
SELECT
    cohort_keys.config_hash,
    cohort_keys.instrument,
    cohort_keys.side,
    cohort_keys.cohort_type,
    COALESCE(signal_events.expected_signals, 0) AS expected_signals,
    COALESCE(signal_events.avg_signal_strength, 0) AS avg_signal_strength,
    COALESCE(closed_trades.actual_trades, 0) AS actual_trades,
    CASE
        WHEN COALESCE(signal_events.expected_signals, 0) > 0
            THEN ROUND(100.0 * COALESCE(closed_trades.actual_trades, 0) / signal_events.expected_signals, 1)
        ELSE 0
    END AS execution_rate_pct,
    COALESCE(closed_trades.actual_win_rate_pct, 0) AS actual_win_rate_pct,
    COALESCE(closed_trades.actual_pnl_aud, 0) AS actual_pnl_aud,
    COALESCE(closed_trades.actual_pnl_pips, 0) AS actual_pnl_pips
FROM cohort_keys
LEFT JOIN signal_events
    ON signal_events.config_hash = cohort_keys.config_hash
   AND signal_events.instrument = cohort_keys.instrument
   AND signal_events.side = cohort_keys.side
   AND signal_events.cohort_type = cohort_keys.cohort_type
LEFT JOIN closed_trades
    ON closed_trades.config_hash = cohort_keys.config_hash
   AND closed_trades.instrument = cohort_keys.instrument
   AND closed_trades.side = cohort_keys.side
   AND closed_trades.cohort_type = cohort_keys.cohort_type
ORDER BY expected_signals DESC, actual_trades DESC, cohort_keys.instrument, cohort_keys.side, cohort_keys.cohort_type;
SQL

tar -czf "$remote_tmp/${prefix}.tar.gz" -C "$remote_tmp" \
    "${prefix}_trades.csv" \
    "${prefix}_trade_entries.csv" \
    "${prefix}_trade_summary.csv" \
    "${prefix}_signals.csv" \
    "${prefix}_signals_actionable.csv" \
    "${prefix}_signals_cooldown_duplicates.csv" \
    "${prefix}_expectation_vs_actual.csv"
REMOTE

    echo "Copying CSVs into $output_dir"
    scp "$host:$remote_tmp/$tarball_name" "$output_dir/$tarball_name" >/dev/null
    tar -xzf "$output_dir/$tarball_name" -C "$output_dir"
    rm -f "$output_dir/$tarball_name"

    echo "Export complete. Files written to $output_dir"
    printf '  %s\n' \
        "$output_dir/${prefix}_trades.csv" \
        "$output_dir/${prefix}_trade_entries.csv" \
        "$output_dir/${prefix}_trade_summary.csv" \
        "$output_dir/${prefix}_signals.csv" \
        "$output_dir/${prefix}_signals_actionable.csv" \
        "$output_dir/${prefix}_signals_cooldown_duplicates.csv" \
        "$output_dir/${prefix}_expectation_vs_actual.csv"
}

main "$@"
